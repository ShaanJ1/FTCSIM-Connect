const prefix = 'FTCSIM Connect [POPUP]';
const logger = {
    info: (...args) => console.info(prefix + " [INFO]:", ...args),
    debug: (...args) => console.debug(prefix + " [DEBUG]:", ...args),
    warn: (...args) => console.warn(prefix + " [WARN]:", ...args),
    error: (...args) => console.error(prefix + " [ERROR]:", ...args),
    log: (...args) => console.log(prefix + " [LOG]:", ...args)
};

document.addEventListener('DOMContentLoaded', async () => {
    const statusElement = document.getElementById('status');
    const indicatorElement = document.getElementById('indicator');
    const serverUrlInput = document.getElementById('serverUrl');
    const reconnectBtn = document.getElementById('reconnectBtn');
    const optionsLink = document.getElementById('optionsLink');

    optionsLink.addEventListener('click', function (e) {
        e.preventDefault();
        logger.debug('Opening options page');
        chrome.runtime.openOptionsPage();
    });

    const result = await chrome.storage.local.get(['serverUrl']);
    if (result.serverUrl) {
        serverUrlInput.value = result.serverUrl;
    }

    serverUrlInput.addEventListener('change', () => {
        const url = serverUrlInput.value.trim();
        if (url && (url.startsWith('ws://') || url.startsWith('wss://'))) {
            chrome.storage.local.set({ serverUrl: url });
        }
    });

    reconnectBtn.addEventListener('click', () => {
        const url = serverUrlInput.value.trim();
        if (url && (url.startsWith('ws://') || url.startsWith('wss://'))) {
            chrome.runtime.sendMessage({
                action: 'set_server_url',
                data: { url: url }
            }, (response) => {
                if (response && response.success) {
                    updateUi('connecting...');
                    setTimeout(() => {
                        chrome.runtime.sendMessage({ action: 'get_status' }, (statusResponse) => {
                            if (statusResponse && statusResponse.status) {
                                updateUi(statusResponse.status);
                            }
                        });
                    }, 1000);
                }
            });
        } else {
            alert('Please enter a valid WebSocket URL (ws:// or wss://)');
        }
    });

    const updateUi = (status) => {
        if (status === 'connected') {
            statusElement.className = 'status connected';
            indicatorElement.className = 'indicator connected';
            statusElement.querySelector('span').textContent = 'Server Connected';
        } else if (status === 'disconnected') {
            statusElement.className = 'status disconnected';
            indicatorElement.className = 'indicator disconnected';
            statusElement.querySelector('span').textContent = 'Server Disconnected';
        } else if (status === 'error') {
            statusElement.className = 'status disconnected';
            indicatorElement.className = 'indicator disconnected';
            statusElement.querySelector('span').textContent = 'Connection Error';
        } else {
            statusElement.className = 'status';
            indicatorElement.className = 'indicator';
            statusElement.querySelector('span').textContent = 'Initializing...';
        }
    };

    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === 'status_update') {
            updateUi(message.status);
        }
    });

    chrome.runtime.sendMessage({ action: 'get_status' }, (response) => {
        if (chrome.runtime.lastError) {
            logger.error('Error getting initial status:', chrome.runtime.lastError);
            updateUi('error');
        } else {
            updateUi(response.status);
        }
    });
});