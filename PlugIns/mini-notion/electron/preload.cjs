const { contextBridge, ipcRenderer } = require('electron');

// A single acknowledgement covers every registered editor. Independent IPC
// listeners used to acknowledge as soon as the workspace store finished, even
// while a folder document still had unsaved text in flight.
const flushCallbacks = new Set();
ipcRenderer.on('workspace:flush', async (_, id) => {
  try {
    await Promise.all([...flushCallbacks].map(callback => Promise.resolve().then(callback)));
    ipcRenderer.send('workspace:flushed', id);
  } catch (error) {
    ipcRenderer.send('workspace:flushed', id, String(error?.message || error));
  }
});

contextBridge.exposeInMainWorld('native', {
  folderMode: process.argv.includes('--mini-notion-folder-mode'),
  startupContent: process.argv.find(value => value.startsWith('--mini-notion-startup-content='))?.split('=')[1],
  workspaceURL: relative => 'asset://local/workspace/'+relative.split('/').map(encodeURIComponent).join('/'),
  api: (method, params, id) => ipcRenderer.invoke('api:request', method, params, id),
  onState: (callback) => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on('workspace:state', listener);
    return () => ipcRenderer.removeListener('workspace:state', listener);
  },
  onUI: (callback) => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on('ui:event', listener);
    return () => ipcRenderer.removeListener('ui:event', listener);
  },
  onAgent: (callback) => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener);
  },
  onFlush: (callback) => {
    flushCallbacks.add(callback);
    return () => flushCallbacks.delete(callback);
  },
  exportPage: (pageId, type) => ipcRenderer.invoke('page:export', pageId, type),
  chooseImports: () => ipcRenderer.invoke('file:choose-imports'),
  load: () => ipcRenderer.invoke('workspace:load'),
  loadSerialized: () => ipcRenderer.invoke('workspace:load-json'),
  save: (workspace) => ipcRenderer.invoke('workspace:save', workspace),
  saveAsset: (name, bytes) => ipcRenderer.invoke('asset:save', name, bytes),
  uploadToSpace: (pageId, folderId, name, bytes) =>
    ipcRenderer.invoke('space:upload', pageId, folderId, name, bytes),
  revealSpace: (pageId) => ipcRenderer.invoke('space:reveal', pageId),
  chooseEngine: () => ipcRenderer.invoke('agent:choose-engine'),
  exportAsset: (url, name) => ipcRenderer.invoke('asset:export', url, name),
  exportFile: (name, content) => ipcRenderer.invoke('file:export', name, content),
  importFiles: () => ipcRenderer.invoke('file:import'),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  revealData: () => ipcRenderer.invoke('data:reveal'),
  versions: (pageId) => ipcRenderer.invoke('history:list', pageId),
  snapshot: (page) => ipcRenderer.invoke('history:snapshot', page),
  printPDF: (name) => ipcRenderer.invoke('page:pdf', name),
  setTheme: (theme) => ipcRenderer.send('theme:set', theme),
  openExternal: (url) => ipcRenderer.invoke('link:open', url),
  onCommand: (callback) => {
    const listener = (_, command) => callback(command);
    ipcRenderer.on('command', listener);
    return () => ipcRenderer.removeListener('command', listener);
  },
});
