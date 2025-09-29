// migrate to typescript later

const prefix = 'FTCSIM Connect [BACKGROUND]';
const logger = {
    info: (...args) => console.info(prefix + " [INFO]:", ...args),
    debug: (...args) => console.debug(prefix + " [DEBUG]:", ...args),
    warn: (...args) => console.warn(prefix + " [WARN]:", ...args),
    error: (...args) => console.error(prefix + " [ERROR]:", ...args),
    log: (...args) => console.log(prefix + " [LOG]:", ...args)
};
class WebSocketManager {
    constructor() {
        this.ws = null;
        this.status = 'disconnected'; // 'disconnected', 'connected', 'error'
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 3000;
        this.serverUrl = 'ws://localhost:8080'; // default
        this.activeTabId = null;
        this.clientSyncMode = 'bidirectional'; // default

        chrome.storage.local.get(['serverUrl', 'clientSyncMode'], (result) => {
            if (result.serverUrl) {
                logger.log('Using stored server URL:', result.serverUrl);
                this.serverUrl = result.serverUrl;
            }
            if (result.clientSyncMode) {
                logger.log('Using stored client sync mode:', result.clientSyncMode);
                this.clientSyncMode = result.clientSyncMode;
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

        logger.debug('Broadcasting status update to all extension components');
        try {
            chrome.runtime.sendMessage({ action: 'status_update', status: this.status });
            logger.debug('Status update message sent');
        } catch (error) {
            if (error.message.includes('Receiving end does not exist')) {
                logger.debug('No receivers for status update (expected if popup is closed)');
            } else {
                logger.error("Error sending status update:", error);
            }
        }
    }

    async connect() {
        try {
            logger.info('Attempting to connect to WebSocket server at', this.serverUrl);

            logger.debug('Creating new WebSocket instance');
            this.ws = new WebSocket(this.serverUrl);
            logger.debug('WebSocket instance created');

            this.ws.onopen = () => {
                logger.info('WebSocket connected successfully');
                logger.debug('Resetting reconnect attempts counter');
                this.reconnectAttempts = 0;
                logger.debug('Updating status to connected');
                this.updateStatus('connected');
            };

            this.ws.onmessage = (event) => {
                logger.debug('WebSocket message received');
                logger.debug('Event details:', event);
                logger.debug('Message data:', typeof event.data, event.data.length || 0);
                this.handleMessage(event.data);
            };

            this.ws.onclose = (event) => {
                logger.info('WebSocket disconnected');
                logger.debug('Close event details:', event.code, event.reason);
                if (this.status === 'connected') {
                    logger.debug('Updating status to disconnected due to close event');
                    this.updateStatus('disconnected');
                }
                logger.debug('Scheduling reconnect attempt');
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                logger.error('WebSocket error occurred:', error);
                logger.debug('Updating status to error');
                this.updateStatus('error');
            };

            logger.debug('All WebSocket event handlers registered');

        } catch (error) {
            logger.error('Failed to create WebSocket connection:', error);
            logger.debug('Updating status to error');
            this.updateStatus('error');
            logger.debug('Scheduling reconnect attempt');
            this.scheduleReconnect();
        }
    }

    handleMessage(data) {
        try {
            logger.debug('Parsing WebSocket message data');
            const message = JSON.parse(data);
            logger.debug('Received message:', message);
            logger.debug('Message type:', message.type);

            if (message.type === 'file_content_update') {
                logger.debug('Received file_content_update, content length:',
                    message.content ? message.content.length : 0);
                
                // Check if server-to-client sync is allowed based on client sync mode
                if (this.clientSyncMode === 'client-only') {
                    logger.info('Ignoring server content update - client sync mode is client-only');
                    return;
                }
                
                logger.debug('Forwarding content update to content script');
                this.sendToContentScript('update_content', { content: message.content });
            } else if (message.type === 'sync_mode_update') {
                logger.info('Received sync_mode_update:', message.syncMode);
            } else {
                logger.warn('Unhandled message type:', message.type);
            }
        } catch (error) {
            logger.error('Error parsing message:', error);
            logger.debug('Raw data received:', typeof data, data.substring ? data.substring(0, 100) : 'non-string data');
        }
    }

    sendMessage(data) {
        logger.debug('Attempting to send message to WebSocket server');

        if (this.status === 'connected' && this.ws) {
            try {
                if (this.ws.readyState !== WebSocket.OPEN) {
                    logger.warn('WebSocket not in OPEN state, readyState =', this.ws.readyState);
                    logger.debug('Reconnecting WebSocket before sending');
                    this.connect();
                    logger.warn('Message not sent, please try again after reconnection');
                    return;
                }

                logger.debug('Connection is active, serializing message');
                const jsonData = JSON.stringify(data);
                logger.debug('Sending data of length', jsonData.length);
                this.ws.send(jsonData);
                logger.debug('Message sent successfully');
            } catch (error) {
                logger.error('Error sending message:', error);
                this.updateStatus('error');
                this.scheduleReconnect();
            }
        } else {
            logger.debug('Cannot send message, connection status:', this.status);
            logger.debug('WebSocket object exists:', !!this.ws);
            logger.debug('Attempting to reconnect before sending');
            this.connect();
        }
    }

    async sendToContentScript(action, data) {
        logger.debug('Sending message to content script, action:', action);

        if (!this.activeTabId) {
            logger.debug('No active tab ID, searching for ftcsim.org tabs');
            const tabs = await chrome.tabs.query({
                active: true,
                url: 'https://ftcsim.org/*'
            });

            logger.debug('Found', tabs.length, 'matching tabs');

            if (tabs.length > 0) {
                logger.debug('Setting active tab ID to', tabs[0].id);
                this.activeTabId = tabs[0].id;
            } else {
                logger.debug('No matching tabs found');
            }
        }

        if (this.activeTabId) {
            try {
                logger.debug('Sending message to tab', this.activeTabId);
                await chrome.tabs.sendMessage(this.activeTabId, {
                    action: action,
                    data: data
                });
                logger.debug('Message sent to content script successfully');
            } catch (error) {
                logger.error('Error sending message to content script:', error);
                logger.debug('Resetting active tab ID due to error');
                this.activeTabId = null;
            }
        } else {
            logger.debug('No active tab ID available, message not sent');
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            logger.info(`Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
            logger.debug('Will try again in', this.reconnectDelay, 'ms');

            setTimeout(() => {
                logger.debug('Reconnect timeout elapsed, attempting connection');
                this.connect();
            }, this.reconnectDelay);
        } else {
            logger.warn('Max reconnect attempts reached');
            logger.info('Setting final status to error');
            this.updateStatus('error');
        }
    }

    disconnect() {
        logger.info('Disconnecting WebSocket');

        if (this.ws) {
            logger.debug('WebSocket exists, closing connection');
            this.ws.close();
            this.ws = null;
            logger.debug('WebSocket closed and reference cleared');
        } else {
            logger.debug('No active WebSocket to disconnect');
        }

        logger.debug('Setting status to disconnected');
        this.status = 'disconnected';
    }

    setServerUrl(url) {
        logger.info('Setting server URL to:', url);
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
            logger.debug('Received connect_websocket request');

            if (sender && sender.tab) {
                logger.debug('Setting active tab ID to', sender.tab.id);
                wsManager.activeTabId = sender.tab.id;
            } else {
                logger.debug('No tab ID in sender, cannot set active tab');
            }

            if (wsManager.status !== 'connected') {
                logger.info('WebSocket not connected, initiating connection');
                wsManager.connect();
            } else {
                logger.debug('WebSocket already connected, no action needed');
            }

            logger.debug('Sending success response');
            sendResponse({ success: true });
            break;

        case 'content_changed':
            logger.debug('Received content_changed event');
            const contentLength = message.data.content ? message.data.content.length : 0;
            logger.debug('Content length:', contentLength);

            if (wsManager.clientSyncMode === 'server-only') {
                logger.info('Ignoring client content change - client sync mode is server-only');
                sendResponse({ success: true, ignored: true });
                break;
            }

            logger.debug('WebSocket status before sending:', wsManager.status);
            logger.debug('WebSocket ready state:', wsManager.ws ? wsManager.ws.readyState : 'no websocket');

            logger.debug('Forwarding to WebSocket server');
            wsManager.sendMessage({
                type: 'content_update',
                content: message.data.content,
                timestamp: Date.now()
            });

            logger.debug('Sending success response');
            sendResponse({ success: true });
            break;

        case 'get_status':
            logger.debug('Received status request, current status:', wsManager.status);
            sendResponse({ status: wsManager.status });
            break;

        case 'reconnect':
            logger.info('Received reconnect request');
            logger.debug('Disconnecting current WebSocket');
            wsManager.disconnect();
            logger.debug('Initiating new connection');
            wsManager.connect();
            logger.debug('Sending success response');
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
            logger.warn('Unknown action:', message.action);
            sendResponse({ success: false, error: 'Unknown action' });
    }

    logger.debug('Returning true to keep message channel open');
    return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    logger.debug('Tab updated:', tabId);
    logger.debug('Change info:', changeInfo);

    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('ftcsim.org')) {
        logger.info('Found ftcsim.org tab, setting as active tab:', tabId);
        wsManager.activeTabId = tabId;
    } else {
        logger.debug('Not a complete ftcsim.org tab load, ignoring');
        if (changeInfo.status !== 'complete') {
            logger.debug('Status is not complete:', changeInfo.status);
        }
        if (!tab.url) {
            logger.debug('URL is empty');
        } else if (!tab.url.includes('ftcsim.org')) {
            logger.debug('URL does not contain ftcsim.org:', tab.url);
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    logger.debug('Tab removed:', tabId);
    logger.debug('Current active tab:', wsManager.activeTabId);

    if (wsManager.activeTabId === tabId) {
        logger.info('Active tab was removed, clearing active tab ID');
        wsManager.activeTabId = null;
    } else {
        logger.debug('Removed tab was not the active tab, no action needed');
    }
});

logger.info('Background script initialized');
logger.debug('Setting initial status to disconnected');
wsManager.updateStatus('disconnected');

logger.info('Auto-connecting to WebSocket server');
wsManager.connect();

logger.info('Initialization complete');