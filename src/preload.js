// The only bridge between the page and the main process. The page never gets Node access.
const { contextBridge, ipcRenderer } = require('electron');

const progressHandlers = new Map();
ipcRenderer.on('claude:progress', (_e, { id, chars }) => { const fn = progressHandlers.get(id); if (fn) fn(chars); });
const deltaHandlers = new Map();
ipcRenderer.on('claude:delta', (_e, { id, delta }) => { const fn = deltaHandlers.get(id); if (fn) fn(delta); });

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  claude: {
    available: () => ipcRenderer.invoke('claude:available'),
    async extract(id, prompt, onProgress) {
      if (onProgress) progressHandlers.set(id, onProgress);
      try { return await ipcRenderer.invoke('claude:extract', { id, prompt }); }
      finally { progressHandlers.delete(id); }
    },
    async ask(id, payload, onDelta) {
      if (onDelta) deltaHandlers.set(id, onDelta);
      try { return await ipcRenderer.invoke('claude:ask', { id, ...payload }); }
      finally { deltaHandlers.delete(id); }
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
  rooms: {
    join: code => ipcRenderer.invoke('room:join', { code }),
    presence: p => ipcRenderer.invoke('room:presence', p),
    send: text => ipcRenderer.invoke('room:send', { text }),
    leave: () => ipcRenderer.invoke('room:leave'),
    on(name, fn) {
      if (!['peers', 'message', 'connection'].includes(name)) return () => {};
      const h = (_e, data) => fn(data);
      ipcRenderer.on('room:' + name, h);
      return () => ipcRenderer.removeListener('room:' + name, h);
    },
  },
  saveIcs: (text, open) => ipcRenderer.invoke('ics:save', { text, open }),
  onMenu: (name, fn) => ipcRenderer.on('menu:' + name, () => fn()),
});
