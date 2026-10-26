// Study rooms, on SemesterSync's own server (backend/app/routers/rooms.py): one WebSocket per room for who's
// studying, their timer and a chat. Nothing is stored, and no account is needed. Runs in the main process; the
// page reaches it through preload IPC with the same calls it used before.
const { apiBase } = require('./account');

// One room per window, keyed by its webContents id: { code, ws, you, presence, sender, left, tries, timer }
const open = new Map();
const watched = new Set(); // windows whose closing already leaves their room
const isCurrent = r => open.get(r.sender.id) === r && !r.left;
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n);
// Everything from other people is untrusted (the server cleans it too): keep only short strings and a well-formed timer.
function cleanPresence(p) {
  const t = p && p.timer;
  const timer = t && (t.mode === 'focus' || t.mode === 'break') && Number.isFinite(+t.ends) ? { mode: t.mode, ends: +t.ends } : null;
  return { name: clip(p && p.name, 32), task: clip(p && p.task, 120), timer };
}
const RETRY = [1, 2, 5, 10, 30];

function emit(r, name, data) { if (!r.sender.isDestroyed()) r.sender.send('room:' + name, data); }

// Opens the room's connection. Resolves { ok } once the server says hello, or { ok: false, message }.
function connect(r) {
  return new Promise(resolve => {
    let ws;
    try { ws = new WebSocket(apiBase().replace(/^http/, 'ws') + '/v1/rooms/' + r.code); } catch { resolve({ ok: false }); return; }
    let settled = false;
    const done = res => { if (!settled) { settled = true; clearTimeout(timer); resolve(res); } };
    const timer = setTimeout(() => { done({ ok: false }); try { ws.close(); } catch { /* not open */ } }, 10000);
    ws.addEventListener('message', ev => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (!m || typeof m !== 'object' || !isCurrent(r) || r.ws !== ws) return;
      if (m.t === 'hello') {
        r.you = String(m.you || '');
        r.tries = 0;
        if (r.presence) ws.send(JSON.stringify({ t: 'presence', ...r.presence }));
        emit(r, 'connection', true);
        done({ ok: true });
      } else if (m.t === 'error') {
        r.refused = clip(m.message, 200);
        done({ ok: false, message: r.refused });
      } else if (m.t === 'peers' && Array.isArray(m.peers)) {
        emit(r, 'peers', m.peers.slice(0, 50).map(p => ({ id: clip(p && p.id, 40), me: !!p && p.id === r.you, ...cleanPresence(p) })));
      } else if (m.t === 'chat') {
        const text = clip(m.text, 500);
        if (text) emit(r, 'message', { id: clip(m.id, 40), name: clip(m.name, 32), text, at: Date.now() });
      }
    });
    ws.addEventListener('close', () => {
      done({ ok: false });
      if (!isCurrent(r) || r.ws !== ws) return;
      // Dropped (sleep, Wi-Fi, a server restart): say so and keep trying.
      emit(r, 'connection', false);
      const wait = RETRY[Math.min(r.tries++, RETRY.length - 1)] * 1000;
      r.timer = setTimeout(() => { if (isCurrent(r)) connect(r); }, wait);
    });
    ws.addEventListener('error', () => { /* followed by close */ });
    r.ws = ws;
  });
}

function leaveRoom(id) {
  const r = open.get(id);
  open.delete(id);
  if (r) { r.left = true; clearTimeout(r.timer); try { r.ws.close(1000); } catch { /* already closed */ } }
  return { ok: true };
}

function register(ipcMain) {
  ipcMain.handle('room:join', async (event, { code }) => {
    if (!apiBase()) return { ok: false, message: 'Study rooms need the SemesterSync server, which isn’t set up in this build yet.' };
    code = clip(code, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) return { ok: false, message: 'Room codes are at least 4 letters or numbers.' };
    const id = event.sender.id;
    leaveRoom(id);
    const r = { code, ws: null, you: '', presence: null, sender: event.sender, left: false, tries: 0, timer: null, refused: '' };
    open.set(id, r);
    if (!watched.has(id)) { watched.add(id); r.sender.once('destroyed', () => { watched.delete(id); leaveRoom(id); }); }
    const res = await connect(r);
    if (!res.ok) {
      if (open.get(id) === r) leaveRoom(id);
      return { ok: false, message: res.message || 'Couldn’t connect to the study room. Check your internet connection and try again.' };
    }
    return { ok: true };
  });
  ipcMain.handle('room:presence', async (e, p) => {
    const room = open.get(e.sender.id);
    if (!room) return { ok: false };
    room.presence = cleanPresence(p);
    if (room.ws && room.ws.readyState === WebSocket.OPEN) room.ws.send(JSON.stringify({ t: 'presence', ...room.presence }));
    return { ok: true };
  });
  ipcMain.handle('room:send', async (e, { text }) => {
    const room = open.get(e.sender.id);
    if (!room || !room.ws || room.ws.readyState !== WebSocket.OPEN) return { ok: false, code: 'not_connected', message: 'Not connected to the room right now.' };
    const t = clip(text, 500).trim();
    if (!t) return { ok: false, code: 'empty', message: 'Message is empty.' };
    room.ws.send(JSON.stringify({ t: 'chat', text: t }));
    return { ok: true };
  });
  ipcMain.handle('room:leave', e => leaveRoom(e.sender.id));
}

module.exports = { register };
