// Cloud sync against the real API: two app windows (two "computers" with separate storage, signed in to the
// same account) sync through backend/ on a throwaway database. Needs PostgreSQL 17 and backend/.venv.
//
//   npm run test:sync
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'semestersync-sync-'));
const PORT = 8766;
const API = `http://127.0.0.1:${PORT}`;
process.env.SEMESTERSYNC_DATA_DIR = path.join(TMP, 'profile');
process.env.SEMESTERSYNC_API_URL = API;
process.env.ANTHROPIC_API_KEY = '';

const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
setTimeout(() => { console.log('FAIL  test run took over 8 minutes; stopping'); finish(1); }, 8 * 60 * 1000).unref();

const mail = [];
const server = spawn(path.join(__dirname, '..', 'backend', 'scripts', 'serve-test.sh'), [], { env: { ...process.env, API_TEST_PORT: String(PORT), PG_TEST_PORT: '54331' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '', errOut = '';
server.stdout.on('data', b => { out += b.toString(); let m; while ((m = /--- email to (\S+): ([^\n]*)\n([\s\S]*?)\n---\n/.exec(out))) { mail.push({ to: m[1], text: m[3] }); out = out.slice(m.index + m[0].length); } });
server.stderr.on('data', b => { errOut += b.toString(); });
function finish(code) { try { server.kill('SIGTERM'); } catch (_) {} setTimeout(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} app.exit(code); }, 1500); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `\n      got: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (_) {} await sleep(200); } return false; };
const post = (route, body, token) => fetch(API + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }).then(r => r.json());
let probe = null; // a separate session, to look at what the server holds
const serverDocs = async () => { const r = await fetch(API + '/v1/sync/changes?since=0', { headers: { Authorization: 'Bearer ' + probe } }).then(x => x.json()); return r.docs.filter(d => !d.deleted); };
const serverCourse = async code => (await serverDocs()).map(d => { try { return JSON.parse(d.body); } catch (_) { return null; } }).find(c => c && c.code === code);

function device(win) {
  const errors = [];
  win.webContents.on('console-message', e => { if (e.level === 'error' || e.level >= 3) errors.push(String(e.message).slice(0, 300)); });
  const js = src => win.webContents.executeJavaScript(src);
  const until = async (src, ms = 10000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { try { v = await js(src); if (v) return v; } catch (_) {} await sleep(150); } return v; };
  const click = sel => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const loaded = () => new Promise(ok => win.webContents.once('did-finish-load', ok));
  const reload = async () => { const p = loaded(); win.webContents.reload(); await p; await until(`!!document.querySelector('#coursebar [data-view]')`); await sleep(1000); };
  const status = () => js(`document.getElementById('saveStatus').textContent`);
  const flushed = async () => { await sleep(1100); await until(`!/Saving/.test(document.getElementById('saveStatus').textContent)`, 6000); };
  const syncNow = () => js(`window.CloudSync.syncNow().then(() => true)`);
  const open = code => js(`(() => { const b = [...document.querySelectorAll('#coursebar [data-view]')].find(x => x.textContent.startsWith(${JSON.stringify(code)})); if (b) b.click(); return !!b; })()`);
  const title = n => js(`document.querySelectorAll('#rows tr[data-id] [data-k="title"]')[${n}].value`);
  const setTitle = (n, v) => js(`(() => { const i = document.querySelectorAll('#rows tr[data-id] [data-k="title"]')[${n}]; i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('change', { bubbles: true })); i.blur(); return true; })()`);
  const chooser = () => until(`document.querySelector('dialog.sync-choose[open]') && document.querySelector('dialog.sync-choose').innerText`);
  return { win, js, until, click, reload, status, flushed, syncNow, open, title, setTitle, chooser, errors, loaded };
}
function newWindow(partition) {
  const win = new BrowserWindow({ width: 1000, height: 760, x: 80, y: 60, show: true, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition } });
  const D = device(win);
  const p = D.loaded();
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  return p.then(() => D.until(`!!document.querySelector('#coursebar [data-view]')`)).then(() => sleep(1000)).then(() => D);
}
async function addCourse(D, text, code) {
  await D.js(`document.querySelector('dialog.onboard [data-ob="skip"]')?.click(); document.querySelector('dialog.onboard')?.close(); 1`);
  await D.js(`document.getElementById('addCourse').click()`);
  await D.js(`document.getElementById('syllabusInput').value = ${JSON.stringify(text)}`);
  await D.click('#useLocal'); await D.click('#parseBtn');
  await D.until(`document.getElementById('coursebar').innerText.includes(${JSON.stringify(code)}) && !document.getElementById('parseBtn').disabled`, 15000);
  await D.flushed();
}
const SYLLABUS = `BIO 150: Introduction to Biology\nGRADING\nLab reports (3) ........ 30%\nMidterm exam ........ 30%\nFinal exam ........ 40%\n\nDUE DATES\n9/10  Lab Report 1 due\nOct 1  Lab Report 2 due\nOct 14  Midterm Exam, 10:00 AM\nDec 9  Final Exam, 9:00 AM`;

require('../src/main.js');

app.on('browser-window-created', (_e, win) => {
  if (BrowserWindow.getAllWindows().length !== 1) return;
  const A = device(win);
  win.webContents.once('did-finish-load', async () => {
    try {
      let up = false;
      for (let i = 0; i < 150 && !up; i++) { try { up = (await fetch(API + '/healthz')).ok; } catch (_) { await sleep(200); } }
      check('the API started on a throwaway database', up, errOut.slice(-800));
      if (!up) throw new Error('no API');
      await A.until(`!!document.querySelector('#coursebar [data-view]')`); await sleep(1000);

      console.log('\n# Account and first upload');
      await post('/v1/auth/register', { email: 'sync@example.edu', password: 'sync password 1', device: 'probe' });
      probe = (await post('/v1/auth/login', { email: 'sync@example.edu', password: 'sync password 1', device: 'probe' })).token;
      await addCourse(A, SYLLABUS, 'BIO 150');
      await A.click('#accountBtn'); await sleep(300);
      await A.js(`(() => { document.getElementById('authEmail').value = 'sync@example.edu'; document.getElementById('authPass').value = 'sync password 1'; document.getElementById('authForm').requestSubmit(); })()`);
      const ask = await A.chooser();
      check('signing in asks before uploading', /BIO 150/.test(ask) && /Upload and turn on sync/.test(ask), ask);
      check('nothing is on the server before agreeing', (await serverDocs()).length === 0);
      await A.click('dialog.sync-choose [data-sc="yes"]');
      check('agreeing uploads the course and settings', await waitFor(async () => !!(await serverCourse('BIO 150')) && (await serverDocs()).some(d => d.doc_id === 'extras')));
      check('samples stay on this computer', !(await serverDocs()).some(d => /"sample":true/.test(d.body)));

      console.log('\n# A second computer');
      const B = await newWindow('persist:sync-b');
      await B.js(`document.querySelector('dialog.onboard')?.close(); document.dispatchEvent(new CustomEvent('ssync:open', { detail: 'sync' }))`);
      check('the second computer asks too, and lists the account’s course', /account also has 1 course/.test(await B.chooser() || ''));
      await B.click('dialog.sync-choose [data-sc="yes"]');
      check('it gets the course', !!(await B.until(`document.getElementById('coursebar').innerText.includes('BIO 150')`)));
      check('in place of its samples', (await B.js(`document.querySelectorAll('#coursebar [data-view]').length`)) === 2);

      console.log('\n# Edits flow, merge and conflict through the server');
      for (const D of [A, B]) await D.open('BIO 150');
      await A.setTitle(0, 'Edited on A'); await A.flushed(); await A.syncNow();
      await B.syncNow();
      check('an edit on A reaches B', (await B.title(0)) === 'Edited on A');
      process.env.SEMESTERSYNC_API_URL = 'http://127.0.0.1:59998'; // both computers offline
      await A.setTitle(1, 'A offline'); await A.flushed();
      await B.setTitle(2, 'B offline'); await B.flushed();
      await A.syncNow();
      check('offline, it says so and keeps the change', /Offline/.test(await A.status()) && (await A.js(`localStorage.getItem('ssync-courses-v1')`)).includes('A offline'), await A.status());
      process.env.SEMESTERSYNC_API_URL = API;
      // Both computers sync at the same moment: the server accepts one, refuses the other's stale copy, which then combines.
      await Promise.all([A.syncNow(), B.syncNow()]);
      await A.syncNow(); await B.syncNow(); await A.syncNow();
      const c1 = await serverCourse('BIO 150');
      check('edits to different deliverables made at the same time are combined', c1.items.some(i => i.title === 'A offline') && c1.items.some(i => i.title === 'B offline'), c1.items.map(i => i.title));
      check('both computers end up with both', (await A.title(2)) === 'B offline' && (await B.title(1)) === 'A offline');
      process.env.SEMESTERSYNC_API_URL = 'http://127.0.0.1:59998';
      await A.setTitle(3, 'Final from A'); await A.flushed();
      await B.setTitle(3, 'Final from B'); await B.flushed();
      process.env.SEMESTERSYNC_API_URL = API;
      await A.syncNow(); await B.syncNow();
      check('the same deliverable changed on both asks on the second computer', /1 change needs your choice/.test(await B.status()), await B.status());
      check('the server keeps the first computer’s version meanwhile', (await serverCourse('BIO 150')).items.some(i => i.title === 'Final from A'));
      await B.click('#saveStatus');
      await B.until(`!!document.querySelector('[data-conflict] [data-pick="mine"]')`);
      await B.click('[data-conflict] [data-pick="mine"]'); await sleep(500); await B.syncNow(); await A.syncNow();
      check('choosing B’s version sends it to A', (await A.title(3)) === 'Final from B' && (await serverCourse('BIO 150')).items.some(i => i.title === 'Final from B'));
      await B.js(`document.querySelector('dialog.data-dlg').close()`);

      console.log('\n# Removing data from the account');
      await A.js(`document.dispatchEvent(new CustomEvent('ssync:data', { detail: 'data' }))`);
      await A.until(`!!document.getElementById('csClear')`);
      await A.click('#csClear');
      await A.js(`document.getElementById('csPass').value = 'wrong password'; document.getElementById('csClearGo').click()`);
      check('it needs the right password', !!(await A.until(`!document.getElementById('csMsg').hidden && document.getElementById('csMsg').textContent`)));
      await A.js(`document.getElementById('csPass').value = 'sync password 1'; document.getElementById('csClearGo').click()`);
      check('the server’s copy is deleted', await waitFor(async () => (await serverDocs()).length === 0));
      await B.syncNow();
      check('the other computer stops syncing and keeps its course', !(await B.js(`window.CloudSync.isOn()`)) && (await B.js(`document.getElementById('coursebar').innerText`)).includes('BIO 150'));
      check('so does this one', !(await A.js(`window.CloudSync.isOn()`)) && (await A.js(`document.getElementById('coursebar').innerText`)).includes('BIO 150'));
      console.log('\n# Study rooms through the server');
      const people = D => D.js(`document.getElementById('roomPeople').innerText`);
      const joinRoom = async (D, name, code) => {
        await D.js(`document.querySelector('[data-tab="rooms"]').click(); document.getElementById('roomName').value = ${JSON.stringify(name)}; document.getElementById('roomCode').value = ${JSON.stringify(code)}; document.getElementById('roomForm').requestSubmit(); 1`);
      };
      await joinRoom(A, 'Ana', '');
      const code = await A.until(`!document.getElementById('roomLive').hidden && document.getElementById('roomCodeShow').textContent`);
      check('starting a room gives a code', /^[A-Z0-9]{6}$/.test(code || ''), code);
      await joinRoom(B, 'Ben', code);
      check('both people see each other', !!(await A.until(`/Ben/.test(document.getElementById('roomPeople').innerText)`)) && /Ana \(you\)/.test(await A.js(`document.getElementById('roomPeople').innerText`)) && !!(await B.until(`/Ana/.test(document.getElementById('roomPeople').innerText) && /Ben \\(you\\)/.test(document.getElementById('roomPeople').innerText)`)), [await people(A), await people(B)]);
      await A.click('#timerFocus');
      check('a focus timer shows for the other person', !!(await B.until(`/Focusing/.test(document.getElementById('roomPeople').innerText)`)), await people(B));
      await A.js(`document.getElementById('roomChatIn').value = 'hello from A'; document.getElementById('roomChatForm').requestSubmit(); 1`);
      check('chat reaches the other person, with the sender’s name', !!(await B.until(`/Ana\\s*hello from A/.test(document.getElementById('roomChat').innerText)`)), await B.js(`document.getElementById('roomChat').innerText`));
      await B.click('#roomLeave');
      check('leaving takes them off the list', !!(await A.until(`!/Ben/.test(document.getElementById('roomPeople').innerText)`)), await people(A));
      await A.click('#roomLeave');
      await joinRoom(B, 'Ben', 'AB');
      check('a short code is refused', /at least 4/.test(await B.until(`document.getElementById('roomMsg').textContent`) || ''));

      check('the server never logged course content, names or chat', !/Edited on A|Final from|A offline|hello from A|Ana|Ben/.test(errOut + out));
      const errs = [...A.errors, ...B.errors].filter(e => !/Failed to load resource|fonts\.g/.test(e));
      check('no errors in the page console', !errs.length, errs);
    } catch (e) { check('test run finished without crashing', false, String(e && e.stack || e)); }
    const failed = results.filter(x => !x).length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    finish(failed ? 1 : 0);
  });
});
