(function () {
    function findAceEditor() {
        const aceElement = document.querySelector('.ace_editor');
        if (aceElement) {
            try {
                const editorInstance = aceElement.env?.editor || ace.edit(aceElement);
                if (editorInstance && typeof editorInstance.getValue === 'function') {
                    return editorInstance;
                }
            } catch { }
        }
        if (window.ace && window.ace.edit) {
            const editors = document.querySelectorAll('.ace_editor, .ace-editor, [data-ace-editor], #editor');
            for (const elem of editors) {
                try {
                    const editorInstance = ace.edit(elem);
                    if (editorInstance && typeof editorInstance.getValue === 'function') {
                        return editorInstance;
                    }
                } catch { }
            }
        }
        return null;
    }

    let editor = null;

    function initBridge() {
        console.log('FTCSIM Connect: Bridge script initializing');
        editor = findAceEditor();
        if (!editor) {
            console.log('FTCSIM Connect: Bridge script: Editor not found yet, retrying...');
            setTimeout(initBridge, 100);
            return;
        }

        console.log('FTCSIM Connect: Bridge script: Ace editor found');

        // expose the api
        window.ftcsimBridge = {
            getValue: () => editor.getValue(),
            setValue: (value) => {
                const cursor = editor.getCursorPosition();
                editor.setValue(value, -1); // -1 preserves cursor
                editor.moveCursorToPosition(cursor);
                editor.clearSelection();
            },
            onChange: (callback) => {
                editor.on('change', () => callback(editor.getValue()));
            },
            getEditor: () => editor
        };

        try {
            window.postMessage({ type: 'FTCSIM_BRIDGE_READY' }, '*');
        } catch { }

        editor.on('change', () => {
            window.postMessage({
                type: 'ACE_CONTENT_CHANGED',
                content: editor.getValue()
            }, '*');
        });

        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            const msg = event.data;
            if (!msg || typeof msg !== 'object') return;

            if (msg.type === 'SET_ACE_CONTENT') {
                console.log('FTCSIM Connect: Bridge received SET_ACE_CONTENT message');
                try {
                    const value = typeof msg.content === 'string' ? msg.content : '';
                    const cursor = editor.getCursorPosition();
                    editor.setValue(value, -1);
                    editor.moveCursorToPosition(cursor);
                    editor.clearSelection();
                    window.postMessage({ type: 'ACE_SET_RESULT', success: true }, '*');
                } catch (e) {
                    window.postMessage({ type: 'ACE_SET_RESULT', success: false, error: String(e && e.message || e) }, '*');
                }
            } else if (msg.type === 'REQUEST_ACE_STATUS') {
                console.log('FTCSIM Connect: Bridge received REQUEST_ACE_STATUS message');
                window.postMessage({ type: 'ACE_STATUS', ready: !!editor }, '*');
            } else if (msg.type === 'REQUEST_ACE_CONTENT') {
                console.log('FTCSIM Connect: Bridge received REQUEST_ACE_CONTENT message');
                try {
                    const content = editor.getValue();
                    console.log('FTCSIM Connect: Bridge responding to content request, length:', content ? content.length : 0);
                    window.postMessage({ type: 'ACE_CONTENT', content: content, requestId: msg.requestId || 'unknown' }, '*');
                } catch (e) {
                    console.error('FTCSIM Connect: Bridge error getting content:', e);
                    window.postMessage({ type: 'ACE_CONTENT', content: '', error: String(e), requestId: msg.requestId || 'unknown' }, '*');
                }
            }
        });

        console.log('FTCSIM Connect: Bridge API ready');
    }

    initBridge();
})();