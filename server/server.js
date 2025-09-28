// fix: sometimes creates a new .java file instead of using the watchfile

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
        description: 'File to watch for changes (required)',
        demandOption: true
    })
    .option('host', {
        alias: 'h',
        type: 'string',
        default: 'localhost',
        description: 'Host to bind the server to'
    })
    .help()
    .argv;

class FTCSIMConnectServer {
    constructor(options) {
        this.port = options.port;
        this.host = options.host;
        this.watchFile = path.resolve(options.file);
        this.wss = null;
        this.watcher = null;
        this.clients = new Set();
        this.lastContent = '';
        this.isUpdatingFromRemote = false;
    }

    async start() {
        try {
            if (!fs.existsSync(this.watchFile)) {
                console.error(`❌ Watch file does not exist: ${this.watchFile}`);
                process.exit(1);
            }

            this.lastContent = fs.readFileSync(this.watchFile, 'utf8');
            console.log(`📁 Watching file: ${this.watchFile}`);

            this.startWebSocketServer();

            this.startFileWatcher();

            console.log(`🚀 FTCSIM-Connect Server started`);
            console.log(`📡 WebSocket server running on ws://${this.host}:${this.port}`);
            console.log(`📝 Watching file: ${this.watchFile}`);
            console.log(`⏹️  Press Ctrl+C to stop`);

        } catch (error) {
            console.error('❌ Failed to start server:', error);
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

            try {
                const newContent = fs.readFileSync(this.watchFile, 'utf8');
                if (newContent !== this.lastContent) {
                    console.log('📝 File changed, syncing to clients...');
                    this.lastContent = newContent;
                    this.broadcastToClients({
                        type: 'file_content_update',
                        content: newContent,
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

            case 'ping':
                this.sendToClient(ws, { type: 'pong', timestamp: Date.now() });
                break;

            default:
                console.log('⚠️  Unknown message type:', message.type);
        }
    }

    updateLocalFile(content) {
        try {
            if (content !== this.lastContent) {
                console.log('📝 Updating local file from client...');
                this.isUpdatingFromRemote = true;
                this.lastContent = content;
                fs.writeFileSync(this.watchFile, content, 'utf8');
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
    file: argv.file
});

server.start().catch(error => {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
});