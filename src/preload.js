// The only bridge between the page and the main process. The page never gets Node access.
const { contextBridge, ipcRenderer } = require('electron');

const progressHandlers = new Map();
ipcRenderer.on('claude:progress', (_e, { id, chars }) => { const fn = progressHandlers.get(id); if (fn) fn(chars); });

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  claude: {
    available: () => ipcRenderer.invoke('claude:available'),
    async extract(id, prompt, onProgress) {
      if (onProgress) progressHandlers.set(id, onProgress);
      try { return await ipcRenderer.invoke('claude:extract', { id, prompt }); }
      finally { progressHandlers.delete(id); }
    },
    cancel: id => ipcRenderer.send('claude:cancel', id),
    transcribePdf: bytes => ipcRenderer.invoke('claude:transcribe-pdf', bytes),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: patch => ipcRenderer.invoke('settings:set', patch),
    testKey: key => ipcRenderer.invoke('settings:test-key', key),
  },
  account: {
    status: () => ipcRenderer.invoke('account:status'),
    signUp: (email, password) => ipcRenderer.invoke('account:sign-up', { email, password }),
    signIn: (email, password) => ipcRenderer.invoke('account:sign-in', { email, password }),
    signOut: () => ipcRenderer.invoke('account:sign-out'),
    google: () => ipcRenderer.invoke('account:google'),
    cancelGoogle: () => ipcRenderer.send('account:google-cancel'),
    requestReset: email => ipcRenderer.invoke('account:reset-request', { email }),
    completeReset: (email, code, password) => ipcRenderer.invoke('account:reset-complete', { email, code, password }),
  },
  cloud: {
    list: () => ipcRenderer.invoke('cloud:list'),
    set: (id, body) => ipcRenderer.invoke('cloud:set', { id, body }),
    remove: id => ipcRenderer.invoke('cloud:delete', { id }),
  },
  saveIcs: (text, open) => ipcRenderer.invoke('ics:save', { text, open }),
  onMenu: (name, fn) => ipcRenderer.on('menu:' + name, () => fn()),
});
