const logger = {
    verboseEnabled: false,
    prefix: 'FTCSIM Connect:',

    setVerboseLogging(enabled) {
        this.verboseEnabled = !!enabled;
        console.log(this.prefix, `Verbose logging ${this.verboseEnabled ? 'enabled' : 'disabled'}`);
    },

    log(...args) {
        if (this.verboseEnabled) {
            console.log(this.prefix, ...args);
        }
    },

    warn(...args) {
        console.warn(this.prefix, ...args);
    },

    error(...args) {
        console.error(this.prefix, ...args);
    },

    debug(...args) {
        if (this.verboseEnabled) {
            console.debug(this.prefix, ...args);
        }
    },

    info(...args) {
        if (this.verboseEnabled) {
            console.info(this.prefix, ...args);
        } else if (args.length > 0) {
            console.info(this.prefix, args[0]);
        }
    }
};

chrome.storage.local.get(['verboseLogging'], (result) => {
    logger.setVerboseLogging(!!result.verboseLogging);
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'logging_status_changed' && typeof message.enabled === 'boolean') {
        logger.setVerboseLogging(message.enabled);
    }
});

class FTCSIMConnect {
    constructor() {
        this.editor = null;
        this.serverPushInProgress = false;
        this.aceReady = false;
        this.isConnected = false;
        this.lastContent = '';
        logger.log('FTCSIMConnect instance created');
        this.init();
    }

    async waitForBridge() {
        logger.log('Waiting for bridge script...');
        return new Promise((resolve) => {
            let resolved = false;
            let attempts = 0;

            const onMsg = (event) => {
                if (event.source !== window) return;
                const msg = event.data;
                if (msg && msg.type === 'FTCSIM_BRIDGE_READY') {
                    logger.log('Bridge signaled ready');
                    window.removeEventListener('message', onMsg);
                    resolved = true;
                    resolve();
                }
            };
            window.addEventListener('message', onMsg);

            const check = () => {
                attempts++;
                if (window.ftcsimBridge) {
                    logger.log('Bridge API ready (polled)');
                    if (!resolved) {
                        window.removeEventListener('message', onMsg);
                        resolve();
                    }
                } else {
                    if (attempts > 50) {
                        logger.warn('Bridge not found after 5 seconds, continuing anyway');
                        if (!resolved) {
                            window.removeEventListener('message', onMsg);
                            resolve();
                        }
                    } else {
                        logger.debug('Bridge not found yet, attempt:', attempts);
                        setTimeout(check, 100);
                    }
                }
            };
            check();
        });
    }

    async init() {
        logger.log('Initializing content script');
        this.injectBridgeScript();

        await this.waitForBridge();

        logger.log('Waiting for Ace editor...');
        await this.waitForAceEditor();

        if (!this.aceReady) {
            logger.warn('Editor not found');
        } else {
            logger.log('ACE editor is ready and available');
        }

        await this.setupEditor();

        logger.log('Setting up editor via bridge');
        if (this.aceReady) {
            try {
                const initial = await this.requestAceContent();
                this.lastContent = initial ?? '';
                logger.log('Initial content length:', this.lastContent.length);
                logger.debug('First 100 chars:', this.lastContent.substring(0, 100));
            } catch (e) {
                logger.warn('Failed to get initial content from bridge:', e);
            }
        }

        logger.log('Connecting to WebSocket');
        this.connectToWebSocket();

        logger.log('Starting change monitor');
        this.startChangeMonitor();

        logger.log('Initialization complete');
    }

    injectBridgeScript() {
        const loggerScript = document.createElement('script');
        const loggerUrl = chrome.runtime.getURL('logger.js');
        logger.log('Loading logger script from:', loggerUrl);

        loggerScript.src = loggerUrl;
        loggerScript.onload = () => {
            logger.log('Logger script loaded successfully');

            const script = document.createElement('script');
            const bridgeUrl = chrome.runtime.getURL('bridge.js');
            logger.log('Loading bridge script from:', bridgeUrl);

            script.src = bridgeUrl;
            script.onload = () => {
                logger.log('Bridge script loaded successfully');
                logger.debug('Bridge script will now be removed from DOM');
                script.remove();
            };
            script.onerror = (error) => {
                logger.error('Error loading bridge script:', error);
            };

            logger.debug('Appending bridge script to', document.head ? 'head' : 'documentElement');
            (document.head || document.documentElement).appendChild(script);
            logger.debug('Bridge script appended to DOM');
        };

        loggerScript.onerror = (error) => {
            logger.error('Error loading logger script:', error);
        };

        logger.debug('Appending logger script to', document.head ? 'head' : 'documentElement');
        (document.head || document.documentElement).appendChild(loggerScript);
        logger.debug('Logger script appended to DOM');
    }

    waitForAceEditor() {
        return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 100;
            logger.log('Starting editor wait cycle, max attempts:', maxAttempts);

            const checkEditor = () => {
                attempts++;
                window.postMessage({ type: 'REQUEST_ACE_STATUS' }, '*');
                let gotResponse = false;
                const onMsg = (event) => {
                    if (event.source !== window) return;
                    const msg = event.data;
                    if (msg && msg.type === 'ACE_STATUS') {
                        window.removeEventListener('message', onMsg);
                        gotResponse = true;
                        this.aceReady = !!msg.ready;
                        logger.log('Editor instance', this.aceReady ? 'exists' : 'undefined');
                        if (this.aceReady) {
                            resolve();
                        } else if (attempts >= maxAttempts) {
                            logger.warn(`Timed out waiting for editor after ${maxAttempts} attempts`);
                            resolve();
                        } else {
                            if (attempts % 10 === 0) {
                                const aceElements = document.querySelectorAll('.ace_editor, .ace-editor, [data-ace-editor], #editor');
                                logger.log('Found', aceElements.length, 'potential editor elements');
                                if (aceElements.length > 0) {
                                    logger.debug('First potential editor element:', aceElements[0].outerHTML.substring(0, 100) + '...');
                                }
                            }
                            setTimeout(checkEditor, 100);
                        }
                    }
                };
                window.addEventListener('message', onMsg);
                setTimeout(() => {
                    if (!gotResponse) {
                        window.removeEventListener('message', onMsg);
                        logger.debug('Editor status request timed out; retrying');
                        if (attempts >= maxAttempts) {
                            logger.warn(`Timed out waiting for editor after ${maxAttempts} attempts`);
                            resolve();
                        } else {
                            setTimeout(checkEditor, 100);
                        }
                    }
                }, 100);
            };

            checkEditor();
        });
    }

    async setupEditor() {
        if (!this.aceReady) {
            logger.warn('Cannot setup editor - editor not ready');
            return;
        }
        try {
            logger.log('Requesting initial editor content');
            const content = await this.requestAceContent();
            this.lastContent = content ?? '';
            logger.log('Initial content length:', this.lastContent.length);
            logger.debug('First 50 chars:', this.lastContent.substring(0, 50));
        } catch (error) {
            logger.error('Error getting initial content:', error);
        }
        logger.log('Editor setup complete');
    }

    connectToWebSocket() {
        logger.log('Sending connect_websocket message to background script');
        chrome.runtime.sendMessage({ action: 'connect_websocket' }, (response) => {
            if (chrome.runtime.lastError) {
                logger.error('Error sending message to background:', chrome.runtime.lastError);
            } else {
                logger.log('Background script response:', response);
            }
        });
    }

    startChangeMonitor() {
        const intervalMs = 750;
        let errorCount = 0;

        logger.log('Starting change monitor with interval:', intervalMs, 'ms');

        setInterval(async () => {
            try {
                if (!this.aceReady) {
                    logger.debug('Poll skipped - editor not ready');
                    return;
                }
                if (this.serverPushInProgress) {
                    logger.debug('Poll skipped - serverPushInProgress');
                    return;
                }

                let content;
                try {
                    content = await this.requestAceContent();
                    if (errorCount > 0) {
                        console.log('FTCSIM Connect: Content request succeeded after previous failures');
                        errorCount = 0;
                    }
                } catch (contentError) {
                    errorCount++;
                    if (errorCount <= 3) {
                        console.warn(`FTCSIM Connect: Content request failed (${errorCount}/3), will retry next interval`);
                        return;
                    } else {
                        console.error('FTCSIM Connect: Multiple content request failures, continuing with last known content');
                        content = this.lastContent;
                    }
                }

                if (typeof content !== 'string') return;
                if (content !== this.lastContent) {
                    console.log(`FTCSIM Connect: Poll detected change, content=${content.length}, lastContent=${this.lastContent.length}`);
                    this.lastContent = content;
                    console.log('FTCSIM Connect: Poll detected change, forwarding to background');
                    chrome.runtime.sendMessage({
                        action: 'content_changed',
                        data: { content }
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.error('FTCSIM Connect: Error sending polled change:', chrome.runtime.lastError);
                        } else {
                            console.log('FTCSIM Connect: Forwarded polled content change to background');
                        }
                    });
                }
            } catch (err) {
                console.warn('FTCSIM Connect: Error in change monitor:', err);
            }
        }, intervalMs);
    }

    async updateEditorContent(content) {
        console.log('FTCSIM Connect: updateEditorContent called with content length:', content ? content.length : 0);

        if (!this.aceReady) {
            console.log('FTCSIM Connect: Editor not ready yet, deferring update...');
            await this.waitForAceEditor();
        }

        if (!this.aceReady) {
            console.warn('FTCSIM Connect: Still no editor after waiting; skipping update');
            return;
        }

        let currentContent = this.lastContent;
        try {
            const live = await this.requestAceContent();
            if (typeof live === 'string') currentContent = live;
            console.log(`FTCSIM Connect: Editor content differs from lastContent: ${currentContent !== this.lastContent}`);
        } catch { }
        console.log('FTCSIM Connect: Current editor content length:', currentContent.length);

        if (currentContent !== content) {
            console.log('FTCSIM Connect: Content is different, updating editor');
            try {
                this.serverPushInProgress = true;
                console.log('FTCSIM Connect: Setting serverPushInProgress = true');
                await new Promise((resolve) => {
                    const onMsg = (event) => {
                        if (event.source !== window) return;
                        const msg = event.data;
                        if (msg && msg.type === 'ACE_SET_RESULT') {
                            window.removeEventListener('message', onMsg);
                            if (msg.success) {
                                this.lastContent = content;
                                console.log('FTCSIM Connect: Editor update complete (via bridge)');
                            } else {
                                console.error('FTCSIM Connect: Bridge failed to set content:', msg.error);
                            }
                            setTimeout(() => {
                                this.serverPushInProgress = false;
                                console.log('FTCSIM Connect: Cleared serverPushInProgress guard');
                            }, 100);
                            resolve();
                        }
                    };
                    window.addEventListener('message', onMsg);
                    window.postMessage({ type: 'SET_ACE_CONTENT', content }, '*');
                });
            } catch (error) {
                console.error('FTCSIM Connect: Error updating editor content:', error);
                this.serverPushInProgress = false;
                console.log('FTCSIM Connect: Cleared serverPushInProgress guard (error path)');
            }
        } else {
            console.log('FTCSIM Connect: Content is identical, no update needed');
        }
    }

    requestAceContent() {
        logger.debug('Requesting ACE content from bridge');
        return new Promise((resolve, reject) => {
            let done = false;
            const requestId = 'req-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
            logger.debug('ACE content request ID:', requestId);

            const onMsg = (event) => {
                if (event.source !== window) return;
                const msg = event.data;
                if (msg && msg.type === 'ACE_CONTENT' && msg.requestId === requestId) {
                    logger.debug('Received ACE_CONTENT response for request:', requestId);
                    window.removeEventListener('message', onMsg);
                    done = true;
                    if (msg.error) {
                        logger.warn('Bridge reported error getting content:', msg.error);
                    } else {
                        logger.debug('Content received successfully, length:', (msg.content || '').length);
                    }
                    resolve(typeof msg.content === 'string' ? msg.content : '');
                }
            };

            window.addEventListener('message', onMsg);
            console.log('FTCSIM Connect: Requesting ACE content with ID:', requestId);
            window.postMessage({ type: 'REQUEST_ACE_CONTENT', requestId }, '*');

            setTimeout(() => {
                if (!done) {
                    window.removeEventListener('message', onMsg);
                    console.error('FTCSIM Connect: ACE content request timed out for ID:', requestId);
                    reject(new Error(`ACE content request timed out (ID: ${requestId})`));
                }
            }, 1000);
        });
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    logger.log('Message received from background script:', message);

    if (message.action === 'update_content') {
        logger.log('Processing update_content action');
        if (window.ftcsimConnect) {
            logger.debug('Calling updateEditorContent with content length:', message.data?.content?.length || 0);
            window.ftcsimConnect.updateEditorContent(message.data.content);
            logger.log('Editor update requested');
        } else {
            logger.warn('ftcsimConnect instance does not exist, cannot update editor');
        }
    } else if (message.action === 'logging_status_changed') {
        logger.log('Logging status changed to:', message.enabled ? 'enabled' : 'disabled');
    }

    sendResponse({ success: true });
});

window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const msg = event.data;
    logger.debug('Window message received:', msg?.type || 'unknown type');
    if (msg?.type === 'ACE_CONTENT_CHANGED') {
        const contentLen = typeof msg.content === 'string' ? msg.content.length : 0;
        const lastContentLen = window.ftcsimConnect?.lastContent?.length || 0;
        if (window.ftcsimConnect) {
            const newContent = typeof msg.content === 'string' ? msg.content : '';
            console.log(`FTCSIM Connect: ACE_CONTENT_CHANGED: updating lastContent ${lastContentLen} → ${contentLen}`);
            window.ftcsimConnect.lastContent = newContent;
        }
        if (window.ftcsimConnect?.serverPushInProgress) {
            console.log(`FTCSIM Connect: Ignoring ACE change from server push (len=${contentLen})`);
            return;
        }
        console.log('FTCSIM Connect: Forwarding ACE change to background, length:', contentLen);
        chrome.runtime.sendMessage({
            action: 'content_changed',
            data: { content: msg.content }
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('FTCSIM Connect: Error sending message to background:', chrome.runtime.lastError);
            } else {
                console.log('FTCSIM Connect: Forwarded content change to background successfully');
            }
        });
    }
});

console.log('FTCSIM Connect: Content script loaded, document.readyState =', document.readyState);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.ftcsimConnect = new FTCSIMConnect();
    });
} else {
    window.ftcsimConnect = new FTCSIMConnect();
}
