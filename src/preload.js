// The only bridge between the page and the main process.
// The page gets these functions and nothing else (no Node, no token).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crm', {
  objects: () => ipcRenderer.invoke('app:objects'),
  connect: (token) => ipcRenderer.invoke('auth:connect', token),
  disconnect: () => ipcRenderer.invoke('auth:disconnect'),
  list: (type, opts) => ipcRenderer.invoke('crm:list', type, opts),
  get: (type, id) => ipcRenderer.invoke('crm:get', type, id),
  update: (type, id, props) => ipcRenderer.invoke('crm:update', type, id, props),
  create: (type, props) => ipcRenderer.invoke('crm:create', type, props),
  pickImport: () => ipcRenderer.invoke('import:pick'),
  runImport: () => ipcRenderer.invoke('import:run'),
  onImportProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('import:progress', listener);
    return () => ipcRenderer.removeListener('import:progress', listener);
  },
});
