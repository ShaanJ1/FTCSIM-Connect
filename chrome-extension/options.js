document.addEventListener('DOMContentLoaded', function () {
    const serverUrlInput = document.getElementById('serverUrl');
    const connectionStatus = document.getElementById('connectionStatus');
    const saveButton = document.getElementById('saveButton');
    const testButton = document.getElementById('testConnection');
    const statusMessage = document.getElementById('statusMessage');

    const verboseLoggingCheckbox = document.getElementById('verboseLogging');

    chrome.storage.local.get(['serverUrl', 'verboseLogging'], function (result) {
        if (result.serverUrl) {
            serverUrlInput.value = result.serverUrl;
        } else {
            serverUrlInput.value = 'ws://localhost:8080';
        }

        verboseLoggingCheckbox.checked = !!result.verboseLogging;
        console.log('FTCSIM Connect: Loaded verbose logging setting:', verboseLoggingCheckbox.checked);
    });

    updateConnectionStatus();

    setInterval(updateConnectionStatus, 5000);

    saveButton.addEventListener('click', function () {
        const url = serverUrlInput.value.trim();

        if (!url) {
            showStatus('Server URL cannot be empty', false);
            return;
        }

        if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
            showStatus('Server URL must start with ws:// or wss://', false);
            return;
        }

        const verboseLogging = verboseLoggingCheckbox.checked;
        chrome.storage.local.set({ verboseLogging: verboseLogging });
        console.log('FTCSIM Connect: Saving verbose logging setting:', verboseLogging);

        chrome.runtime.sendMessage(
            {
                action: 'set_server_url',
                data: { url: url }
            },
            function (response) {
                if (response && response.success) {
                    chrome.runtime.sendMessage({
                        action: 'set_verbose_logging',
                        data: { enabled: verboseLogging }
                    });

                    showStatus('Settings saved successfully', true);
                    updateConnectionStatus();
                } else {
                    showStatus('Failed to save settings: ' + (response.error || 'Unknown error'), false);
                }
            }
        );
    });

    verboseLoggingCheckbox.addEventListener('change', function () {
        const verboseLogging = verboseLoggingCheckbox.checked;
        console.log('FTCSIM Connect: Verbose logging toggled to:', verboseLogging);
        chrome.storage.local.set({ verboseLogging: verboseLogging });

        chrome.runtime.sendMessage({
            action: 'set_verbose_logging',
            data: { enabled: verboseLogging }
        });
    });

    testButton.addEventListener('click', function () {
        showStatus('Testing connection...', true);

        chrome.runtime.sendMessage(
            { action: 'get_status' },
            function (response) {
                if (response && response.status) {
                    if (response.status === 'connected') {
                        showStatus('Connection successful!', true);
                    } else {
                        chrome.runtime.sendMessage(
                            { action: 'connect' },
                            function (connectResponse) {
                                if (connectResponse && connectResponse.success) {
                                    showStatus('Connecting... Please wait a moment and test again.', true);
                                    setTimeout(updateConnectionStatus, 2000);
                                } else {
                                    showStatus('Failed to connect: ' + (connectResponse.error || 'Unknown error'), false);
                                }
                            }
                        );
                    }
                } else {
                    showStatus('Failed to get connection status', false);
                }
            }
        );
    });

    function updateConnectionStatus() {
        chrome.runtime.sendMessage(
            { action: 'get_status' },
            function (response) {
                if (response && response.status) {
                    switch (response.status) {
                        case 'connected':
                            connectionStatus.textContent = 'Connected';
                            connectionStatus.style.color = 'green';
                            break;
                        case 'disconnected':
                            connectionStatus.textContent = 'Disconnected';
                            connectionStatus.style.color = 'red';
                            break;
                        case 'error':
                            connectionStatus.textContent = 'Error';
                            connectionStatus.style.color = 'orange';
                            break;
                        default:
                            connectionStatus.textContent = response.status;
                            connectionStatus.style.color = 'black';
                    }
                } else {
                    connectionStatus.textContent = 'Unknown';
                    connectionStatus.style.color = 'gray';
                }
            }
        );
    }

    function showStatus(message, isSuccess) {
        statusMessage.textContent = message;
        statusMessage.style.display = 'block';

        if (isSuccess) {
            statusMessage.className = 'status success';
        } else {
            statusMessage.className = 'status error';
        }

        setTimeout(function () {
            statusMessage.style.display = 'none';
        }, 5000);
    }
});