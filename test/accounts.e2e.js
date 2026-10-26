// Accounts against the real API: runs the app in Electron on a throwaway profile and the backend on a
// throwaway database (backend/scripts/serve-test.sh), then signs up, signs in and manages the account
// through the real dialog. Needs PostgreSQL 17 and backend/.venv (see backend/README.md).
//
//   npm run test:accounts
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'semestersync-acct-'));
const PORT = 8765;
const API = `http://127.0.0.1:${PORT}`;
process.env.SEMESTERSYNC_DATA_DIR = path.join(TMP, 'profile');
process.env.SEMESTERSYNC_API_URL = API;
process.env.ANTHROPIC_API_KEY = '';

const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
setTimeout(() => { console.log('FAIL  test run took over 6 minutes; stopping'); finish(1); }, 6 * 60 * 1000).unref();

/* ---------- The API, with emails printed to its output ---------- */
const mail = [];
const server = spawn(path.join(__dirname, '..', 'backend', 'scripts', 'serve-test.sh'), [], { env: { ...process.env, API_TEST_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
server.stdout.on('data', b => {
  out += b.toString();
  let m;
  while ((m = /--- email to (\S+): ([^\n]*)\n([\s\S]*?)\n---\n/.exec(out))) { mail.push({ to: m[1], subject: m[2], text: m[3] }); out = out.slice(m.index + m[0].length); }
});
let errOut = '';
server.stderr.on('data', b => { errOut += b.toString(); });
function finish(code) { try { server.kill('SIGTERM'); } catch (_) {} setTimeout(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} app.exit(code); }, 1500); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `\n      got: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
const codeFor = async (to, n) => { for (let i = 0; i < 50; i++) { const list = mail.filter(m => m.to === to); if (list.length >= n) return /\b(\d{6})\b/.exec(list[n - 1].text)[1]; await sleep(100); } return null; };
const post = (route, body, token) => fetch(API + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });

require('../src/main.js');

app.on('browser-window-created', (_e, win) => {
  if (BrowserWindow.getAllWindows().length !== 1) return;
  const js = src => win.webContents.executeJavaScript(src);
  const until = async (src, ms = 8000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { try { v = await js(src); if (v) return v; } catch (_) {} await sleep(100); } return v; };
  const dlg = () => js(`(document.querySelector('dialog.account[open]') || {}).innerText || ''`);
  // Clears the last message first, so each check sees this submit's answer.
  const fill = (vals) => js(`(() => { document.querySelectorAll('dialog.account .msg').forEach(e => e.remove()); const v = ${JSON.stringify(vals)}; for (const [id, x] of Object.entries(v)) { const el = document.getElementById(id); if (!el) return 'missing ' + id; el.value = x; } document.getElementById('authForm').requestSubmit(); return true; })()`);
  const click = sel => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const waitText = (re, ms) => until(`(() => { const t = (document.querySelector('dialog.account[open]') || {}).innerText || ''; return ${re}.test(t) && t; })()`, ms);
  const tokenFile = path.join(TMP, 'profile', 'account.bin');
  // After signing in, the app asks about cloud sync. These tests answer "Not now" (sync has its own test) and reopen the account.
  const notNow = async () => {
    const asked = await until(`document.querySelector('dialog.sync-choose[open]') && document.querySelector('dialog.sync-choose').innerText`);
    if (!asked) return false;
    await click('dialog.sync-choose [data-sc="no"]'); await sleep(200);
    await click('#accountBtn'); await sleep(300);
    return asked;
  };

  win.webContents.once('did-finish-load', async () => {
    try {
      // Wait for the API.
      let up = false;
      for (let i = 0; i < 150 && !up; i++) { try { up = (await fetch(API + '/healthz')).ok; } catch (_) { await sleep(200); } }
      check('the API started on a throwaway database', up, errOut.slice(-800));
      if (!up) throw new Error('no API');
      await until(`!!document.querySelector('#coursebar [data-view]')`); await sleep(1000);
      await js(`document.querySelector('dialog.onboard')?.close(); 1`);
      const coursesBefore = await js(`document.getElementById('coursebar').innerText`);

      console.log('\n# Create an account');
      check('the app opens without asking anyone to sign in', !(await js(`!!document.querySelector('dialog.account[open]')`)) && /Sign in/.test(await js(`document.getElementById('accountBtn').innerText`)));
      await click('#accountBtn'); await sleep(200);
      check('account dialog says accounts are optional', /Optional/.test(await dlg()), await dlg());
      await click('[data-m="up"]');
      await fill({ authEmail: 'student@example.edu', authPass: 'short' });
      check('a short password is refused before sending', /Create your account/.test(await dlg()) && mail.length === 0);
      await fill({ authEmail: 'student@example.edu', authPass: 'first password 1' });
      check('creating an account asks for the emailed code', !!(await waitText(/Check your email/)), await dlg());
      const code1 = await codeFor('student@example.edu', 1);
      check('the email has a 6-digit code', !!code1 && /SemesterSync/.test(mail[0].subject), mail[0]);
      await fill({ authCode: code1 === '000000' ? '111111' : '000000' });
      check('a wrong code is explained', !!(await waitText(/isn’t right|isn't right/)), await dlg());
      await click('#resendCode');
      const code2 = await codeFor('student@example.edu', 2);
      check('“Send a new code” sends another', !!code2);
      await fill({ authCode: code1 });
      if (code1 !== code2) check('the older code no longer works', !!(await waitText(/isn’t right|isn't right/)), await dlg());
      await fill({ authCode: ' ' + code2 + ' ' });
      const asked = await notNow();
      check('after signing in it asks about cloud sync, uploading nothing unless you agree', /Upload and turn on sync|Turn on sync/.test(asked || '') && /Not now/.test(asked || ''), asked);
      check('the newest code signs you in', !!(await waitText(/Your account[\s\S]*student@example\.edu/)), await dlg());
      check('the top bar shows the account', /student@example\.edu/.test(await js(`document.getElementById('accountBtn').innerText`)));
      check('signing in doesn’t change the courses on this computer', (await js(`document.getElementById('coursebar').innerText`)) === coursesBefore);
      check('with sync declined, it says nothing is uploaded', /Cloud sync is off: nothing is uploaded/.test(await dlg()), await dlg());
      const saved = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile) : null;
      check('the session is saved encrypted, not as readable text', saved && !/student@example|token/.test(saved.toString('latin1')));

      console.log('\n# Staying signed in');
      { const p = new Promise(r => win.webContents.once('did-finish-load', r)); win.webContents.reload(); await p; await until(`!!document.querySelector('#coursebar [data-view]')`); await sleep(800); }
      check('still signed in after restarting the page', /student@example\.edu/.test(await until(`/student@/.test(document.getElementById('accountBtn').innerText) && document.getElementById('accountBtn').innerText`)));

      console.log('\n# Change password and signed-in computers');
      const other = await (await post('/v1/auth/login', { email: 'student@example.edu', password: 'first password 1', device: 'Library PC' })).json();
      check('a second computer can sign in', !!other.token);
      await click('#accountBtn'); await sleep(300);
      await click('#devBtn');
      const devs = await waitText(/Library PC/);
      check('signed-in computers are listed, this one marked', !!devs && /This computer/.test(devs), await dlg());
      await click('[data-revoke]');
      await waitText(/Signed out that computer/);
      check('signing out another computer ends its session', (await fetch(API + '/v1/account', { headers: { Authorization: 'Bearer ' + other.token } })).status === 401);
      await click('#acctBack'); await sleep(100); await click('#pwBtn'); await sleep(100);
      await fill({ curPass: 'not my password', authPass: 'second password 2' });
      check('a wrong current password is refused', !!(await waitText(/password isn’t right|password isn't right/)), await dlg());
      await fill({ curPass: 'first password 1', authPass: 'second password 2' });
      check('the password changes', !!(await waitText(/Password changed/)), await dlg());

      console.log('\n# Sign out, sign in, forgot password');
      await click('#signOutBtn');
      await until(`/Sign in/.test(document.getElementById('accountBtn').innerText)`);
      check('signing out removes the saved session', !fs.existsSync(tokenFile));
      check('and keeps the courses here', (await js(`document.getElementById('coursebar').innerText`)) === coursesBefore);
      await click('#accountBtn'); await sleep(300);
      await fill({ authEmail: 'student@example.edu', authPass: 'first password 1' });
      check('the old password no longer works', !!(await waitText(/don’t match|don't match/)), await dlg());
      await fill({ authEmail: 'nobody@example.edu', authPass: 'first password 1' });
      const noAcct = await waitText(/don’t match|don't match/);
      check('an unknown email gets the same message', !!noAcct);
      process.env.SEMESTERSYNC_API_URL = 'http://127.0.0.1:59999';
      await fill({ authEmail: 'student@example.edu', authPass: 'second password 2' });
      check('offline, it says the server can’t be reached', !!(await waitText(/Couldn’t reach/, 20000)), await dlg());
      process.env.SEMESTERSYNC_API_URL = API;
      await click('#forgotBtn'); await sleep(100);
      await fill({ authEmail: 'student@example.edu' });
      check('forgot password asks for the emailed code', !!(await waitText(/Choose a new password/)), await dlg());
      const reset = await codeFor('student@example.edu', 3);
      check('a reset code is emailed', !!reset && /Reset/.test(mail[2].subject), mail[2]);
      await fill({ authCode: reset, authPass: 'third password 3' });
      await notNow();
      check('resetting the password signs you in', !!(await waitText(/Your account[\s\S]*student@example\.edu/)), await dlg());

      console.log('\n# A session ended elsewhere');
      await post('/v1/auth/password-reset/request', { email: 'student@example.edu' });
      const r2 = await codeFor('student@example.edu', 4);
      await post('/v1/auth/password-reset/confirm', { email: 'student@example.edu', code: r2, new_password: 'fourth password 4' });
      await js(`document.querySelector('dialog.account').close()`);
      await click('#accountBtn');
      check('a session ended by a reset elsewhere shows as signed out', !!(await waitText(/Sign in/)) && !fs.existsSync(tokenFile), await dlg());

      console.log('\n# Unconfirmed email');
      await click('[data-m="up"]');
      await fill({ authEmail: 'second@example.edu', authPass: 'another password' });
      await waitText(/Check your email/);
      await click('#authCancel'); await sleep(100);
      await fill({ authEmail: 'second@example.edu', authPass: 'another password' });
      check('signing in before confirming goes to the code screen', !!(await waitText(/Check your email[\s\S]*Confirm your email first/)), await dlg());
      await fill({ authCode: await codeFor('second@example.edu', 1) });
      await notNow();
      check('and the code finishes it', !!(await waitText(/Your account[\s\S]*second@example\.edu/)), await dlg());

      console.log('\n# Delete account');
      await click('#delBtn'); await sleep(100);
      await fill({ authPass: 'wrong password' });
      check('deleting needs the right password', !!(await waitText(/password isn’t right|password isn't right/)), await dlg());
      await fill({ authPass: 'another password' });
      check('deleting the account signs out and says courses stay', !!(await waitText(/account was deleted[\s\S]*still on this computer/)), await dlg());
      check('the account is gone from the server', (await post('/v1/auth/login', { email: 'second@example.edu', password: 'another password' })).status === 401);
      check('the courses on this computer are untouched', (await js(`document.getElementById('coursebar').innerText`)) === coursesBefore);

      const logs = errOut + out;
      check('the server never logged a password or code', !/first password|second password|third password|another password/.test(logs) && ![code1, code2, reset].some(c => c && errOut.includes(c)));
    } catch (e) { check('test run finished without crashing', false, String(e && e.stack || e)); }
    const failed = results.filter(x => !x).length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    finish(failed ? 1 : 0);
  });
});
