const prefix = 'FTCSIM Connect [BRIDGE]';
const logger = {
    info: (...args) => console.info(prefix + " [INFO]:", ...args),
    debug: (...args) => console.debug(prefix + " [DEBUG]:", ...args),
    warn: (...args) => console.warn(prefix + " [WARN]:", ...args),
    error: (...args) => console.error(prefix + " [ERROR]:", ...args),
    log: (...args) => console.log(prefix + " [LOG]:", ...args)
};

(function () {
    function findAceEditor() {
        logger.debug('Searching for Ace editor in DOM');

        const aceElement = document.querySelector('.ace_editor');
        if (aceElement) {
            logger.debug('Found .ace_editor element, attempting to get editor instance');
            try {
                const editorInstance = aceElement.env?.editor || ace.edit(aceElement);
                if (editorInstance && typeof editorInstance.getValue === 'function') {
                    logger.debug('Successfully found editor instance via .ace_editor element');
                    return editorInstance;
                }
            } catch (e) {
                logger.debug('Failed to get editor from .ace_editor element:', e.message);
            }
        }

        if (window.ace && window.ace.edit) {
            logger.debug('Ace library available, searching for editor elements');
            const editors = document.querySelectorAll('.ace_editor, .ace-editor, [data-ace-editor], #editor');
            logger.debug('Found', editors.length, 'potential editor elements');

            for (const elem of editors) {
                try {
                    const editorInstance = ace.edit(elem);
                    if (editorInstance && typeof editorInstance.getValue === 'function') {
                        logger.debug('Successfully found editor instance via element search');
                        return editorInstance;
                    }
                } catch (e) {
                    logger.debug('Failed to initialize editor on element:', e.message);
                }
            }
        } else {
            logger.debug('Ace library not available on window object');
        }

        logger.debug('No Ace editor found');
        return null;
    }

    let editor = null;

    function initBridge() {
        try {
            logger.info('Bridge script initializing');
            logger.debug('Attempting to find Ace editor');
            editor = findAceEditor();
            if (!editor) {
                logger.debug('Editor not found yet, retrying in 100ms');
                setTimeout(initBridge, 100);
                return;
            }

            logger.info('Ace editor found and initialized');

            // expose the api
            window.ftcsimBridge = {
                getValue: () => editor.getValue(),
                setValue: (value) => {
                    const cursor = editor.getCursorPosition();
                    editor.setValue(value, -1);
                    editor.moveCursorToPosition(cursor);
                    editor.clearSelection();
                },
                onChange: (callback) => {
                    editor.on('change', () => callback(editor.getValue()));
                },
                getEditor: () => editor
            };

            try {
                logger.info('Bridge API exposed, sending ready signal');
                window.postMessage({ type: 'FTCSIM_BRIDGE_READY' }, '*');
                logger.debug('Bridge ready signal sent successfully');
            } catch (error) {
                logger.error('Failed to send bridge ready signal:', error);
            }

            editor.on('change', () => {
                const content = editor.getValue();
                logger.debug('Editor content changed, length:', content ? content.length : 0);
                window.postMessage({
                    type: 'ACE_CONTENT_CHANGED',
                    content: content
                }, '*');
            });

            logger.debug('Setting up window message listener');
            window.addEventListener('message', (event) => {
                if (event.source !== window) return;
                const msg = event.data;
                if (!msg || typeof msg !== 'object') return;

                logger.debug('Received window message:', msg.type);

                if (msg.type === 'SET_ACE_CONTENT') {
                    logger.debug('Received SET_ACE_CONTENT message, content length:', msg.content ? msg.content.length : 0);
                    try {
                        const value = typeof msg.content === 'string' ? msg.content : '';
                        const cursor = editor.getCursorPosition();
                        logger.debug('Setting editor content, preserving cursor at:', cursor);
                        editor.setValue(value, -1);
                        editor.moveCursorToPosition(cursor);
                        editor.clearSelection();
                        logger.debug('Content set successfully');
                        window.postMessage({ type: 'ACE_SET_RESULT', success: true }, '*');
                    } catch (e) {
                        logger.error('Failed to set editor content:', e);
                        window.postMessage({ type: 'ACE_SET_RESULT', success: false, error: String(e && e.message || e) }, '*');
                    }
                } else if (msg.type === 'REQUEST_ACE_STATUS') {
                    logger.debug('Received REQUEST_ACE_STATUS message');
                    const isReady = !!editor;
                    logger.debug('Responding with editor status:', isReady ? 'ready' : 'not ready');
                    window.postMessage({ type: 'ACE_STATUS', ready: isReady }, '*');
                } else if (msg.type === 'REQUEST_ACE_CONTENT') {
                    const requestId = msg.requestId || 'unknown';
                    logger.debug('Received REQUEST_ACE_CONTENT message, requestId:', requestId);
                    try {
                        const content = editor.getValue();
                        logger.debug('Responding to content request, length:', content ? content.length : 0, 'requestId:', requestId);
                        window.postMessage({ type: 'ACE_CONTENT', content: content, requestId: requestId }, '*');
                    } catch (e) {
                        logger.error('Failed to get editor content for requestId:', requestId, 'error:', e);
                        window.postMessage({ type: 'ACE_CONTENT', content: '', error: String(e), requestId: requestId }, '*');
                    }
                } else {
                    logger.debug('Unhandled message type:', msg.type);
                }
            });

            logger.info('Bridge API ready');
        } catch (error) {
            logger.error('Critical bridge initialization error:', error);
        }
    }

    initBridge();
})();