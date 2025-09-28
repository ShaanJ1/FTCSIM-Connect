# FTCSIM-Connect

Real-time syncing between VS Code and ftcsim.org's OnBot Java editor.
## Features
- Bidirectional Sync: Changes in VS Code instantly appear on FTCSIM and vice versa, with settings to limit one way or another.
- Instant Updates: Websocket based communication allows for instant changes on either end.
- Smart Detection: The Chrome Extension seamlessly detects the site and connects to the server
- Easy Setup: Simple setup process for both the extension and the server.

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
2. Run `npm install`
3. Start up the websocket server
```
npm start -- --file /path/to/your/file.java
```

### 3. Usage
1. Open [ftcsim.org](https://ftcsim.org) in your browser.
2. The extension should now automatically connect!
