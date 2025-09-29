const WebSocket = require('ws');
const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const yargs = require('yargs');

const argv = yargs
    .option('port', {
        alias: 'p',
        type: 'number',
        default: 8080,
        description: 'WebSocket server port'
    })
    .option('file', {
        alias: 'f',
        type: 'string',
        description: 'File to sync with ftcsim\'s java editor'
    })
    .option('host', {
        alias: 'h',
        type: 'string',
        default: 'localhost',
        description: 'Host to bind the server to'
    })
    .option('sync-mode', {
        alias: 's',
        type: 'string',
        choices: ['bidirectional', 'server-only', 'client-only'],
        default: 'bidirectional',
        description: 'Sync direction: bidirectional, server-only, or client-only'
    })
    .help()
    .argv;

class FTCSIMConnectServer {
    constructor(options) {
        this.config = this.loadConfig(path.resolve('config.json'));

        // Prioritize command-line args, config file, then defaults
        this.port = options.port || (this.config.server && this.config.server.port) || 8080;
        this.host = options.host || (this.config.server && this.config.server.host) || 'localhost';
        this.syncMode = options.syncMode || (this.config.sync && this.config.sync.mode) || 'bidirectional';
        this.watchFile = options.file || this.config.watchFile;

        this.wss = null;
        this.watcher = null;
        this.clients = new Set();
        this.lastContent = '';
        this.isUpdatingFromRemote = false;

        if (!this.watchFile) {
            console.error('❌ No watch file specified. Use --file <filePath> or set "watchFile" in config.json');
            process.exit(1);
        }

        this.watchFile = path.resolve(this.watchFile);
    }

    loadConfig(configPath) {
        let config = {};
        try {
            if (fs.existsSync(configPath)) {
                const configData = fs.readFileSync(configPath, 'utf8');
                config = JSON.parse(configData);

                if (config.sync && config.sync.mode) {
                    this.syncMode = config.sync.mode;
                }
                if (config.server) {
                    this.port = config.server.port || this.port;
                    this.host = config.server.host || this.host;
                }

                console.log(`📋 Configuration loaded from ${configPath}`);
                console.log(`🔄 Sync mode: ${this.syncMode}`);
                return config;
            }
        } catch (error) {
            console.error('❌ Error loading configuration:', error);
        }
        return config;
    }

    async start() {
        try {
            if (!fs.existsSync(this.watchFile)) {
                console.error(`❌ Watch file does not exist: ${this.watchFile}`);
                process.exit(1);
            }
            this.lastContent = fs.readFileSync(this.watchFile, 'utf8');

            this.startWebSocketServer();
            this.startFileWatcher();

            console.log(`🚀 FTCSIM-Connect Server started`);
            console.log(`📡 WebSocket server running on ws://${this.host}:${this.port}`);
            console.log(`📝 Watching file: ${this.watchFile}`);
            console.log(`🔄 Sync mode: ${this.syncMode}`);
            console.log(`🔌 Press Ctrl + C to stop`);

        } catch (error) {
            console.error('❌ Couldn\'t start server:', error);
            process.exit(1);
        }
    }

    startWebSocketServer() {
        this.wss = new WebSocket.Server({
            host: this.host,
            port: this.port
        });

        this.wss.on('connection', (ws, req) => {
            console.log(`🔗 Client connected from ${req.socket.remoteAddress}`);
            this.clients.add(ws);

            this.sendToClient(ws, {
                type: 'file_content_update',
                content: this.lastContent,
                timestamp: Date.now()
            });

            this.sendToClient(ws, {
                type: 'sync_mode_update',
                syncMode: this.syncMode,
                timestamp: Date.now()
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleClientMessage(ws, message);
                } catch (error) {
                    console.error('❌ Error parsing client message:', error);
                }
            });

            ws.on('close', () => {
                console.log('🔌 Client disconnected');
                this.clients.delete(ws);
            });

            ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                this.clients.delete(ws);
            });
        });

        this.wss.on('error', (error) => {
            console.error('❌ WebSocket server error:', error);
        });
    }

    startFileWatcher() {
        this.watcher = chokidar.watch(this.watchFile, {
            ignored: /(^|[\/\\])\../,
            persistent: true,
            usePolling: false,
            interval: 100
        });

        this.watcher.on('change', () => {
            if (this.isUpdatingFromRemote) {
                this.isUpdatingFromRemote = false;
                return;
            }

            if (this.syncMode === 'client-only') {
                console.log('📕 File changed but sync mode is client-only, ignoring server changes');
                return;
            }

            try {
                const newContent = fs.readFileSync(this.watchFile, 'utf8');
                if (newContent !== this.lastContent) {
                    console.log(`📝 File changed, syncing to clients... (mode: ${this.syncMode})`);
                    this.lastContent = newContent;
                    this.broadcastToClients({
                        type: 'file_content_update',
                        content: newContent.replace(/^(import .+;[\r\n]*)+/gm, ''), // Remove dummy import statements before sending to client
                        timestamp: Date.now()
                    });
                    console.log('✅ Sync complete');
                }
            } catch (error) {
                console.error('❌ Error reading file:', error);
            }
        });

        this.watcher.on('error', (error) => {
            console.error('❌ File watcher error:', error);
        });
    }

    handleClientMessage(ws, message) {
        console.log('📨 Received from client:', message.type);

        switch (message.type) {
            case 'content_update':
                this.updateLocalFile(message.content);
                break;

            default:
                console.log('⚠️ Unknown message type:', message.type);
        }
    }

    updateLocalFile(content) {
        if (this.syncMode === 'server-only') {
            console.log('📕 Client update received but sync mode is server-only, ignoring client changes.');
            return;
        }

        try {
            if (content !== this.lastContent) {
                console.log(`📝 Updating local file from client... (mode: ${this.syncMode})`);
                content = content.replace(/^(import .+;[\r\n]*)+/gm, ''); // Making sure theres never an extra import statement
                this.isUpdatingFromRemote = true;
                this.lastContent = content;

                // Adding import statements to prevent VSCode errors
                const imports = this.config.imports;
                const importStatements = imports.map(imp => `import ${imp};`).join('\n');
                const contentWithImports = importStatements + '\n\n' + content;

                fs.writeFileSync(this.watchFile, contentWithImports, 'utf8');
                setTimeout(() => {
                    this.isUpdatingFromRemote = false;
                }, 100);
            }
        } catch (error) {
            console.error('❌ Error updating local file:', error);
        }
    }

    sendToClient(ws, message) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    broadcastToClients(message) {
        const data = JSON.stringify(message);
        this.clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        });
    }

    stop() {
        console.log('\n🛑 Shutting down server...');

        if (this.watcher) {
            this.watcher.close();
        }

        if (this.wss) {
            this.wss.close();
        }

        console.log('✅ Server stopped');
        process.exit(0);
    }
}

process.on('SIGINT', () => {
    if (server) {
        server.stop();
    } else {
        process.exit(0);
    }
});

process.on('SIGTERM', () => {
    if (server) {
        server.stop();
    } else {
        process.exit(0);
    }
});

const server = new FTCSIMConnectServer({
    port: argv.port,
    host: argv.host,
    file: argv.file,
    syncMode: argv['sync-mode'],
});

server.start().catch(error => {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
});