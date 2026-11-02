// Electron main process: opens the window and is the only place that talks
// to HubSpot. The token lives in the `client` variable below and nowhere else.

const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { createClient } = require('./hubspot');
const { OBJECTS } = require('./objects');
const { csvToContacts } = require('./csv');

let win = null;
let client = null; // in memory only; gone when the app closes or you disconnect
// Parsed CSV rows wait here between preview and confirm, so the page
// only sends a "go" and can't slip in different data.
let pendingImport = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'Shortcut CRM',
    backgroundColor: '#f6f5f2',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Links open in the normal browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// Every handler returns { ok, data } or { ok: false, error } so the page
// never has to deal with thrown errors crossing the IPC boundary.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      console.error(`[main] ${channel} failed:`, err.message);
      return { ok: false, error: err.message, status: err.status || null };
    }
  });
}

function requireClient() {
  if (!client) throw new Error('Not connected. Paste your HubSpot token first.');
  return client;
}

handle('app:objects', () => OBJECTS);

handle('auth:connect', async (token) => {
  const candidate = createClient(String(token || '').trim());
  await candidate.verify();
  client = candidate;
  return true;
});

handle('auth:disconnect', () => {
  client = null;
  return true;
});

handle('crm:list', (type, opts) => requireClient().list(type, opts));
handle('crm:get', (type, id) => requireClient().get(type, id));
handle('crm:update', (type, id, props) => requireClient().update(type, id, props));
handle('crm:create', (type, props) => requireClient().create(type, props));

handle('import:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Choose a CSV file with contacts',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  const text = await fs.readFile(filePaths[0], 'utf8');
  const preview = csvToContacts(text);
  pendingImport = preview.contacts;
  return {
    fileName: path.basename(filePaths[0]),
    count: preview.contacts.length,
    sample: preview.contacts.slice(0, 5),
    skipped: preview.skipped,
    unknownHeaders: preview.unknownHeaders,
  };
});

handle('import:run', async () => {
  const rows = pendingImport;
  if (!rows || rows.length === 0) throw new Error('Nothing to import. Pick a file first.');
  pendingImport = null;
  return requireClient().importContacts(rows, (done, total) => {
    win?.webContents.send('import:progress', { done, total });
  });
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  client = null;
  app.quit();
});
