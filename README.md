# FTCSIM-Connect

Real-time syncing between VS Code and ftcsim.org's OnBot Java editor.
## Features
- Sync Control: Be able to choose between bidirectional, client-only, and server-only syncing.
- Instant Updates: Websocket based communication allows for instant changes on either end.
- Smart Detection: The Chrome Extension seamlessly detects the site and connects to the server.
- Easy Setup: Simple setup process for both the extension and the server.
- Import Stub Injections: Auto creates placeholder import statements so VSCode won't complain about missing libraries.

## Quick Start

### 1. Install the Chrome Extension
1. Open Chrome and go to `chrome://extensions/`.
2. Turn on Developer mode at the top right.
3. Click "Load unpacked" and select the `chrome-extension` folder.
4. All done! It should now appear in your extensions.

### 2. Set up the Node.js Server
#### Method 1: (In progress)
1. Locate the `.bat` file in the server folder and run it.
2. Follow the prompts on screen.

#### Method 2:
1. Open a terminal and go into the server folder.
2. Run `npm install`.
3. Start up the websocket server.
```bash
# Basic usage (uses settings from config.json file)
npm start
```

> #### Note: Command-line arguments take priority over your config file.

### Options

- `--port <number>` — Specify a custom port (e.g., 3000)
- `--host <address>` — Specify a custom host (e.g., 0.0.0.0)
- `--file <filename>` — Specify a watch file (e.g., MyOpMode.java)
- `--sync-mode <mode>` — Set sync mode:
  - `server-only`
  - `client-only`
  - `bidirectional`


### 3. Usage
1. Open [ftcsim.org](https://ftcsim.org) in your browser.
2. The extension should now automatically connect!
