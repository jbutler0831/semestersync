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
    verify: (email, code) => ipcRenderer.invoke('account:verify', { email, code }),
    resend: email => ipcRenderer.invoke('account:resend', { email }),
    signIn: (email, password) => ipcRenderer.invoke('account:sign-in', { email, password }),
    signOut: () => ipcRenderer.invoke('account:sign-out'),
    requestReset: email => ipcRenderer.invoke('account:reset-request', { email }),
    completeReset: (email, code, password) => ipcRenderer.invoke('account:reset-complete', { email, code, password }),
    changePassword: (current, next) => ipcRenderer.invoke('account:change-password', { current, next }),
    sessions: () => ipcRenderer.invoke('account:sessions'),
    revokeSession: id => ipcRenderer.invoke('account:revoke-session', { id }),
    revokeOthers: () => ipcRenderer.invoke('account:revoke-others'),
    deleteAccount: password => ipcRenderer.invoke('account:delete', { password }),
  },
  // A one-time copy of an old (Supabase) account's courses to this computer.
  legacy: {
    status: () => ipcRenderer.invoke('legacy:status'),
    export: () => ipcRenderer.invoke('legacy:export'),
    forget: () => ipcRenderer.invoke('legacy:forget'),
  },
  // Cloud sync with the account server (versioned documents; see renderer/cloudsync.js).
  sync: {
    changes: since => ipcRenderer.invoke('sync:changes', { since }),
    push: (changes, epoch) => ipcRenderer.invoke('sync:push', { changes, epoch }),
    usage: () => ipcRenderer.invoke('sync:usage'),
    clear: password => ipcRenderer.invoke('sync:clear', { password }),
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
  files: { save: (name, text, open) => ipcRenderer.invoke('file:save', { name, text, open }) },
  backup: {
    auto: text => ipcRenderer.invoke('backup:auto', text),
    write: (name, text) => ipcRenderer.invoke('backup:write', { name, text }),
    clear: () => ipcRenderer.invoke('backup:clear'),
    list: () => ipcRenderer.invoke('backup:list'),
    read: name => ipcRenderer.invoke('backup:read', name),
    openFolder: () => ipcRenderer.invoke('backup:open-folder'),
  },
  sources: {
    keep: (cid, name, bytes) => ipcRenderer.invoke('source:keep', { cid, name, bytes }),
    open: cid => ipcRenderer.invoke('source:open', cid),
    clear: () => ipcRenderer.invoke('source:clear'),
  },
  onMenu: (name, fn) => ipcRenderer.on('menu:' + name, (_e, arg) => fn(arg)),
  tray: { update: summary => ipcRenderer.send('tray:update', summary) },
  app: { show: () => ipcRenderer.send('app:show') },
  quick: {
    submit: task => ipcRenderer.invoke('quick:submit', task),
    getContext: () => ipcRenderer.invoke('quick:context'),
    context: c => ipcRenderer.send('quick:set-context', c),
    drain: () => ipcRenderer.invoke('quick:drain'),
    ack: id => ipcRenderer.send('quick:ack', id),
    status: () => ipcRenderer.invoke('quick:status'),
    hide: () => ipcRenderer.send('quick:hide'),
    resize: h => ipcRenderer.send('quick:resize', h),
    onShown: fn => ipcRenderer.on('quick:shown', () => fn()),
  },
});
