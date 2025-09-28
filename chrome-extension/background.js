// migrate to typescript later

let verboseLogging = false;

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

class WebSocketManager {
    constructor() {
        this.ws = null;
        this.status = 'disconnected'; // 'disconnected', 'connected', 'error'
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 3000;
        this.serverUrl = 'ws://localhost:8080'; // default
        this.activeTabId = null;

        chrome.storage.local.get(['serverUrl'], (result) => {
            if (result.serverUrl) {
                logger.log('Using stored server URL:', result.serverUrl);
                this.serverUrl = result.serverUrl;
            }
        });

        logger.log('WebSocketManager initialized');
    }

    updateStatus(status) {
        logger.log('Updating status to:', status);
        this.status = status;
        let badgeText = 'Init';
        let badgeColor = '#ffaa00';

        if (status === 'connected') {
            badgeText = 'Conn';
            badgeColor = '#00ff00';
            logger.log('Status is connected, updating badge to green');
        } else if (status === 'disconnected') {
            badgeText = 'Disc';
            badgeColor = '#ff0000';
            logger.log('Status is disconnected, updating badge to red');
        } else if (status === 'error') {
            badgeText = 'Erro';
            badgeColor = '#ff0000';
            logger.log('Status is error, updating badge to red');
        } else {
            logger.log('Status is initializing, updating badge to yellow');
        }

        logger.debug('Setting badge text to:', badgeText);
        chrome.action.setBadgeText({ text: badgeText });
        chrome.action.setBadgeBackgroundColor({ color: badgeColor });
        logger.debug('Badge updated');

        console.log('FTCSIM Connect: Broadcasting status update to all extension components');
        try {
            chrome.runtime.sendMessage({ action: 'status_update', status: this.status });
            console.log('FTCSIM Connect: Status update message sent');
        } catch (error) {
            if (error.message.includes('Receiving end does not exist')) {
                console.log('FTCSIM Connect: No receivers for status update (expected if popup is closed)');
            } else {
                console.error("FTCSIM Connect: Error sending status update:", error);
            }
        }
    }

    async connect() {
        try {
            console.log('FTCSIM Connect: Attempting to connect to WebSocket server at', this.serverUrl);

            console.log('FTCSIM Connect: Creating new WebSocket instance');
            this.ws = new WebSocket(this.serverUrl);
            console.log('FTCSIM Connect: WebSocket instance created');

            this.ws.onopen = () => {
                console.log('FTCSIM Connect: WebSocket connected successfully');
                console.log('FTCSIM Connect: Resetting reconnect attempts counter');
                this.reconnectAttempts = 0;
                console.log('FTCSIM Connect: Updating status to connected');
                this.updateStatus('connected');
            };

            this.ws.onmessage = (event) => {
                console.log('FTCSIM Connect: WebSocket message received');
                console.log('FTCSIM Connect: Event details:', event);
                console.log('FTCSIM Connect: Message data:', typeof event.data, event.data.length || 0);
                this.handleMessage(event.data);
            };

            this.ws.onclose = (event) => {
                console.log('FTCSIM Connect: WebSocket disconnected');
                console.log('FTCSIM Connect: Close event details:', event.code, event.reason);
                if (this.status === 'connected') {
                    console.log('FTCSIM Connect: Updating status to disconnected due to close event');
                    this.updateStatus('disconnected');
                }
                console.log('FTCSIM Connect: Scheduling reconnect attempt');
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error('FTCSIM Connect: WebSocket error occurred:', error);
                console.log('FTCSIM Connect: Updating status to error');
                this.updateStatus('error');
            };

            console.log('FTCSIM Connect: All WebSocket event handlers registered');

        } catch (error) {
            console.error('FTCSIM Connect: Failed to create WebSocket connection:', error);
            console.log('FTCSIM Connect: Updating status to error');
            this.updateStatus('error');
            console.log('FTCSIM Connect: Scheduling reconnect attempt');
            this.scheduleReconnect();
        }
    }

    handleMessage(data) {
        try {
            console.log('FTCSIM Connect: Parsing WebSocket message data');
            const message = JSON.parse(data);
            console.log('FTCSIM Connect: Received message:', message);
            console.log('FTCSIM Connect: Message type:', message.type);

            if (message.type === 'file_content_update') {
                console.log('FTCSIM Connect: Received file_content_update, content length:',
                    message.content ? message.content.length : 0);
                console.log('FTCSIM Connect: Forwarding content update to content script');
                this.sendToContentScript('update_content', { content: message.content });
            } else {
                console.log('FTCSIM Connect: Unhandled message type:', message.type);
            }
        } catch (error) {
            console.error('FTCSIM Connect: Error parsing message:', error);
            console.log('FTCSIM Connect: Raw data received:', typeof data, data.substring ? data.substring(0, 100) : 'non-string data');
        }
    }

    sendMessage(data) {
        console.log('FTCSIM Connect: Attempting to send message to WebSocket server');

        if (this.status === 'connected' && this.ws) {
            try {
                if (this.ws.readyState !== WebSocket.OPEN) {
                    console.warn('FTCSIM Connect: WebSocket not in OPEN state, readyState =', this.ws.readyState);
                    console.log('FTCSIM Connect: Reconnecting WebSocket before sending');
                    this.connect();
                    console.warn('FTCSIM Connect: Message not sent, please try again after reconnection');
                    return;
                }

                console.log('FTCSIM Connect: Connection is active, serializing message');
                const jsonData = JSON.stringify(data);
                console.log('FTCSIM Connect: Sending data of length', jsonData.length);
                this.ws.send(jsonData);
                console.log('FTCSIM Connect: Message sent successfully');
            } catch (error) {
                console.error('FTCSIM Connect: Error sending message:', error);
                this.updateStatus('error');
                this.scheduleReconnect();
            }
        } else {
            console.log('FTCSIM Connect: Cannot send message, connection status:', this.status);
            console.log('FTCSIM Connect: WebSocket object exists:', !!this.ws);
            console.log('FTCSIM Connect: Attempting to reconnect before sending');
            this.connect();
        }
    }

    async sendToContentScript(action, data) {
        console.log('FTCSIM Connect: Sending message to content script, action:', action);

        if (!this.activeTabId) {
            console.log('FTCSIM Connect: No active tab ID, searching for ftcsim.org tabs');
            const tabs = await chrome.tabs.query({
                active: true,
                url: 'https://ftcsim.org/*'
            });

            console.log('FTCSIM Connect: Found', tabs.length, 'matching tabs');

            if (tabs.length > 0) {
                console.log('FTCSIM Connect: Setting active tab ID to', tabs[0].id);
                this.activeTabId = tabs[0].id;
            } else {
                console.log('FTCSIM Connect: No matching tabs found');
            }
        }

        if (this.activeTabId) {
            try {
                console.log('FTCSIM Connect: Sending message to tab', this.activeTabId);
                await chrome.tabs.sendMessage(this.activeTabId, {
                    action: action,
                    data: data
                });
                console.log('FTCSIM Connect: Message sent to content script successfully');
            } catch (error) {
                console.error('FTCSIM Connect: Error sending message to content script:', error);
                console.log('FTCSIM Connect: Resetting active tab ID due to error');
                this.activeTabId = null;
            }
        } else {
            console.log('FTCSIM Connect: No active tab ID available, message not sent');
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`FTCSIM Connect: Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
            console.log('FTCSIM Connect: Will try again in', this.reconnectDelay, 'ms');

            setTimeout(() => {
                console.log('FTCSIM Connect: Reconnect timeout elapsed, attempting connection');
                this.connect();
            }, this.reconnectDelay);
        } else {
            console.log('FTCSIM Connect: Max reconnect attempts reached');
            console.log('FTCSIM Connect: Setting final status to error');
            this.updateStatus('error');
        }
    }

    disconnect() {
        console.log('FTCSIM Connect: Disconnecting WebSocket');

        if (this.ws) {
            console.log('FTCSIM Connect: WebSocket exists, closing connection');
            this.ws.close();
            this.ws = null;
            console.log('FTCSIM Connect: WebSocket closed and reference cleared');
        } else {
            console.log('FTCSIM Connect: No active WebSocket to disconnect');
        }

        console.log('FTCSIM Connect: Setting status to disconnected');
        this.status = 'disconnected';
    }

    setServerUrl(url) {
        console.log('FTCSIM Connect: Setting server URL to:', url);
        this.serverUrl = url;
        chrome.storage.local.set({ serverUrl: url });

        this.disconnect();
        this.connect();
    }
}

const wsManager = new WebSocketManager();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    logger.log('Background received message:', message);
    logger.debug('Message action:', message.action);

    if (sender && sender.tab) {
        logger.debug('Message from tab', sender.tab.id, sender.tab.url);
    } else {
        logger.debug('Message from extension component (not a tab)');
    }

    switch (message.action) {
        case 'connect_websocket':
            console.log('FTCSIM Connect: Received connect_websocket request');

            if (sender && sender.tab) {
                console.log('FTCSIM Connect: Setting active tab ID to', sender.tab.id);
                wsManager.activeTabId = sender.tab.id;
            } else {
                console.log('FTCSIM Connect: No tab ID in sender, cannot set active tab');
            }

            if (wsManager.status !== 'connected') {
                console.log('FTCSIM Connect: WebSocket not connected, initiating connection');
                wsManager.connect();
            } else {
                console.log('FTCSIM Connect: WebSocket already connected, no action needed');
            }

            console.log('FTCSIM Connect: Sending success response');
            sendResponse({ success: true });
            break;

        case 'content_changed':
            console.log('FTCSIM Connect: Received content_changed event');
            const contentLength = message.data.content ? message.data.content.length : 0;
            console.log('FTCSIM Connect: Content length:', contentLength);

            console.log('FTCSIM Connect: WebSocket status before sending:', wsManager.status);
            console.log('FTCSIM Connect: WebSocket ready state:', wsManager.ws ? wsManager.ws.readyState : 'no websocket');

            console.log('FTCSIM Connect: Forwarding to WebSocket server');
            wsManager.sendMessage({
                type: 'content_update',
                content: message.data.content,
                timestamp: Date.now()
            });

            console.log('FTCSIM Connect: Sending success response');
            sendResponse({ success: true });
            break;

        case 'get_status':
            console.log('FTCSIM Connect: Received status request, current status:', wsManager.status);
            sendResponse({ status: wsManager.status });
            break;

        case 'reconnect':
            console.log('FTCSIM Connect: Received reconnect request');
            console.log('FTCSIM Connect: Disconnecting current WebSocket');
            wsManager.disconnect();
            console.log('FTCSIM Connect: Initiating new connection');
            wsManager.connect();
            console.log('FTCSIM Connect: Sending success response');
            sendResponse({ success: true });
            break;

        case 'set_server_url':
            logger.log('Received set_server_url request');
            if (typeof message.data?.url === 'string') {
                wsManager.setServerUrl(message.data.url);
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: 'Invalid URL' });
            }
            break;

        case 'set_verbose_logging':
            logger.log('Received set_verbose_logging request', message.data?.enabled);
            if (typeof message.data?.enabled === 'boolean') {
                logger.setVerboseLogging(message.data.enabled);

                chrome.tabs.query({}, (tabs) => {
                    tabs.forEach(tab => {
                        if (tab.id) {
                            chrome.tabs.sendMessage(tab.id, {
                                action: 'logging_status_changed',
                                enabled: message.data.enabled
                            }).catch(() => { });
                        }
                    });
                });

                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: 'Invalid enabled value' });
            }
            break;

        default:
            console.log('FTCSIM Connect: Unknown action:', message.action);
            sendResponse({ success: false, error: 'Unknown action' });
    }

    console.log('FTCSIM Connect: Returning true to keep message channel open');
    return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    console.log('FTCSIM Connect: Tab updated:', tabId);
    console.log('FTCSIM Connect: Change info:', changeInfo);

    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('ftcsim.org')) {
        console.log('FTCSIM Connect: Found ftcsim.org tab, setting as active tab:', tabId);
        wsManager.activeTabId = tabId;
    } else {
        console.log('FTCSIM Connect: Not a complete ftcsim.org tab load, ignoring');
        if (changeInfo.status !== 'complete') {
            console.log('FTCSIM Connect: Status is not complete:', changeInfo.status);
        }
        if (!tab.url) {
            console.log('FTCSIM Connect: URL is empty');
        } else if (!tab.url.includes('ftcsim.org')) {
            console.log('FTCSIM Connect: URL does not contain ftcsim.org:', tab.url);
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    console.log('FTCSIM Connect: Tab removed:', tabId);
    console.log('FTCSIM Connect: Current active tab:', wsManager.activeTabId);

    if (wsManager.activeTabId === tabId) {
        console.log('FTCSIM Connect: Active tab was removed, clearing active tab ID');
        wsManager.activeTabId = null;
    } else {
        console.log('FTCSIM Connect: Removed tab was not the active tab, no action needed');
    }
});

console.log('FTCSIM Connect: Background script initialized');
console.log('FTCSIM Connect: Setting initial status to disconnected');
wsManager.updateStatus('disconnected');

console.log('FTCSIM Connect: Auto-connecting to WebSocket server');
wsManager.connect();

console.log('FTCSIM Connect: Initialization complete');