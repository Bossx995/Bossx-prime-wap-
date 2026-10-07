const { app, BrowserWindow, session, shell } = require('electron');
const path = require('path');

const WEB_URL = process.env.BOSS_WEB_URL || process.argv.find(a => a.startsWith('--boss-web-url='))?.split('=')[1] || 'https://YOUR-RAILWAY-DOMAIN.up.railway.app/';
const EXTENSION_DIR = path.join(__dirname, '..', 'bundled', 'BOSS-Premium-Mic');
let mainWindow;

function createWindow(url = WEB_URL) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: '#020509',
    title: 'BOSS X PRIME',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://web.whatsapp.com/')) {
      const child = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1050,
        minHeight: 700,
        backgroundColor: '#111b21',
        title: 'WhatsApp Web • BOSS X PRIME',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          preload: path.join(__dirname, 'preload.cjs')
        }
      });
      child.loadURL(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(url);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    await session.defaultSession.loadExtension(EXTENSION_DIR, { allowFileAccess: true });
    console.log('[BOSS X PRIME] BOSS Premium Mic extension loaded.');
  } catch (err) {
    console.error('[BOSS X PRIME] Extension load failed:', err);
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
