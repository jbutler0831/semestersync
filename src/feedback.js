// Help → Send Feedback: sends the six answers to a Google Form the app's owner made. Responses show up in
// Google Forms (and a linked Google Sheet). No server, database or secret is needed: a form's public
// "formResponse" address takes answers from anyone, like filling it in on the web.
//
// Set "feedbackForm" in config.json (or SEMESTERSYNC_FEEDBACK_URL) to the form's pre-filled link, made with
// the answers Q1 … Q6 (see README → Feedback). Only the typed answers are sent: no account, courses, grades or
// anything else from the app.
const { app } = require('electron');
const path = require('node:path');

const QUESTIONS = 6;
const MAX_ANSWER = 2000;

// The pre-filled link, turned into the address to post to and the entry id for each question.
function form() {
  let file = {};
  try { file = JSON.parse(require('node:fs').readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch { /* optional */ }
  const raw = process.env.SEMESTERSYNC_FEEDBACK_URL || file.feedbackForm || '';
  let u;
  try { u = new URL(raw); } catch { return null; }
  const google = u.protocol === 'https:' && u.hostname === 'docs.google.com';
  const local = u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname) && !app.isPackaged; // tests
  const m = /^(\/forms\/(?:u\/\d+\/)?d\/e\/[A-Za-z0-9_-]+)\/viewform$/.exec(u.pathname);
  if (!(google || local) || !m) return null;
  const entries = [];
  for (const [k, v] of u.searchParams) {
    const q = /^Q([1-9])$/.exec(v.trim());
    if (/^entry\.\d+$/.test(k) && q) entries[+q[1] - 1] = k;
  }
  if (entries.length !== QUESTIONS || entries.includes(undefined)) return null;
  return { action: `${u.origin}${m[1]}/formResponse`, entries };
}

let lastSent = 0;
function register(ipcMain) {
  ipcMain.handle('feedback:status', () => ({ configured: !!form() }));
  ipcMain.handle('feedback:send', async (_e, { answers } = {}) => {
    const f = form();
    if (!f) return { ok: false, code: 'not_configured', message: 'Feedback isn’t set up in this version yet.' };
    const list = Array.from({ length: QUESTIONS }, (_, i) => String((Array.isArray(answers) && answers[i]) || '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_ANSWER));
    if (!list.some(Boolean)) return { ok: false, code: 'empty', message: 'Answer at least one question.' };
    if (Date.now() - lastSent < 20000) return { ok: false, code: 'too_soon', message: 'Thanks! You just sent feedback. Wait a few seconds before sending more.' };
    const body = new URLSearchParams();
    list.forEach((a, i) => { if (a) body.append(f.entries[i], a); });
    let res;
    try {
      // No redirects: a form that needs a Google sign-in redirects, and that counts as not sent.
      res = await fetch(f.action, { method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    } catch {
      return { ok: false, code: 'offline', message: 'Couldn’t send your feedback. Check your internet connection and try again.' };
    }
    if (res.status !== 200) return { ok: false, code: 'refused', message: 'The feedback form didn’t accept it. Try again later, or copy your answers and send them another way.' };
    lastSent = Date.now();
    return { ok: true };
  });
}

module.exports = { register, form };
