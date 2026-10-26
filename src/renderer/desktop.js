// Desktop-only additions: settings, native calendar export, menu shortcuts and deadline reminders.
(() => {
  const d = window.desktop;
  const $ = id => document.getElementById(id);
  const toast = msg => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600); };
  const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  document.documentElement.classList.add('is-desktop', 'platform-' + d.platform);

  /* ---------- Top bar ---------- */
  const gear = document.createElement('button');
  gear.type = 'button'; gear.className = 'theme-btn'; gear.id = 'settingsBtn';
  gear.setAttribute('aria-label', 'Settings'); gear.title = 'Settings'; gear.innerHTML = GEAR;
  $('themeBtn').before(gear);

  /* ---------- Settings dialog ---------- */
  const dlg = document.createElement('dialog');
  dlg.className = 'settings';
  dlg.innerHTML = `
    <form method="dialog" id="settingsForm">
      <h2>Settings</h2>
      <section class="field">
        <label for="apiKey">Claude API key</label>
        <input type="password" id="apiKey" autocomplete="off" spellcheck="false" placeholder="sk-ant-…">
        <p class="hint" id="keyHint">Used to read syllabi with Claude. The key is encrypted with your system keychain and only sent to Anthropic.</p>
        <p class="hint">Don't have one? <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">Create a key in the Claude Console</a>.</p>
        <p class="msg" id="keyMsg" hidden></p>
      </section>
      <div class="toggle-row">
        <div>Keep running when the window is closed<small>Stays in the ${d.platform === 'darwin' ? 'menu bar' : 'system tray'} so reminders keep coming. Quit from there.</small></div>
        <label class="switch"><input type="checkbox" id="trayToggle" aria-label="Keep running when the window is closed"><span></span></label>
      </div>
      <p class="hint">Reminders, the morning summary and quiet hours are on the <button type="button" class="linkish" id="remindLink">Today</button> tab.</p>
      <section class="field">
        <label for="quickKeyIn">Quick Add shortcut</label>
        <div class="row" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <input type="text" id="quickKeyIn" readonly class="key-in" placeholder="Click, then press keys" aria-describedby="quickKeyHint" style="flex:1;min-width:160px">
          <button type="button" class="btn sm" id="quickKeyDefault">Default</button>
          <button type="button" class="btn sm ghost" id="quickKeyOff">Turn off</button>
        </div>
        <p class="hint" id="quickKeyHint">Opens a small window to add a task from anywhere on your computer.</p>
      </section>
      <div class="actions">
        <button type="button" class="btn ghost danger" id="removeKey">Remove key</button>
        <span style="flex:1"></span>
        <button type="button" class="btn" id="cancelSettings">Cancel</button>
        <button type="submit" class="btn primary" id="saveSettings">Save</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);

  let settings = { hasKey: false, keepInTray: true };
  async function openSettings() {
    settings = await d.settings.get();
    $('apiKey').value = '';
    $('apiKey').placeholder = settings.hasKey ? (settings.keyFromEnv ? 'Using ANTHROPIC_API_KEY from your environment' : 'Saved. Paste a new key to replace it') : 'sk-ant-…';
    $('removeKey').hidden = !settings.hasKey || settings.keyFromEnv;
    $('trayToggle').checked = settings.keepInTray !== false;
    quickKey = settings.quickKey || '';
    paintQuickKey(settings.quickStatus);
    $('keyMsg').hidden = true;
    dlg.showModal();
    $('apiKey').focus();
  }
  function keyMsg(text, bad) { const m = $('keyMsg'); m.textContent = text; m.className = 'msg' + (bad ? ' bad' : ''); m.hidden = false; }
  $('cancelSettings').onclick = () => dlg.close();
  $('removeKey').onclick = async () => { await d.settings.set({ apiKey: '' }); dlg.close(); location.reload(); };
  $('settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    const key = $('apiKey').value.trim();
    const keepInTray = $('trayToggle').checked;
    if (quickKey !== (settings.quickKey || '')) {
      const r = await d.settings.set({ quickKey });
      if (!r.ok) { const h = $('quickKeyHint'); h.textContent = r.message; h.style.color = 'var(--crit)'; $('quickKeyIn').focus(); return; }
      settings.quickKey = quickKey;
    }
    if (key) {
      $('saveSettings').disabled = true; keyMsg('Checking key…');
      const test = await d.settings.testKey(key);
      $('saveSettings').disabled = false;
      if (!test.ok) { keyMsg(test.message, true); return; }
      const res = await d.settings.set({ apiKey: key, keepInTray });
      if (!res.ok) { keyMsg(res.message, true); return; }
      dlg.close(); location.reload(); // re-runs the page's Claude check with the new key
      return;
    }
    await d.settings.set({ keepInTray });
    settings.keepInTray = keepInTray;
    dlg.close();
    toast('Settings saved');
  });
  gear.onclick = openSettings;
  // Records a shortcut from the keys pressed: modifiers plus one key, in Electron's accelerator format.
  let quickKey = '';
  const isMacOS = d.platform === 'darwin';
  const label = a => !a ? '' : isMacOS ? a.replace(/Command/g, '⌘').replace(/Control/g, '⌃').replace(/Alt/g, '⌥').replace(/Shift/g, '⇧').replace(/\+/g, '') : a.replace(/Control/g, 'Ctrl').replace(/Super/g, 'Win');
  function paintQuickKey(status) {
    $('quickKeyIn').value = quickKey ? label(quickKey) : 'Off';
    const h = $('quickKeyHint');
    if (status && !status.ok && status.message && quickKey === settings.quickKey) { h.textContent = status.message; h.style.color = 'var(--crit)'; }
    else { h.textContent = quickKey ? 'Opens a small window to add a task from anywhere on your computer.' : 'Off. You can still use File → Quick Add Task, or the Inbox tab.'; h.style.color = ''; }
  }
  $('quickKeyIn').addEventListener('keydown', e => {
    if (e.key === 'Tab') return;
    e.preventDefault();
    if (e.key === 'Escape' || e.key === 'Backspace') { paintQuickKey(); return; }
    const mods = [e.metaKey && 'Command', e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
    const code = e.code;
    const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : code === 'Space' ? 'Space' : /^F\d{1,2}$/.test(code) ? code : null;
    if (!key) { $('quickKeyIn').value = mods.map(m => label(m)).join(isMacOS ? '' : '+') + (isMacOS ? '' : '+') + '…'; return; }
    if (!mods.some(m => m !== 'Shift')) { $('quickKeyHint').textContent = 'Include Command, Control or Option/Alt.'; $('quickKeyHint').style.color = 'var(--crit)'; return; }
    quickKey = [...mods, key].join('+');
    paintQuickKey();
  });
  $('quickKeyDefault').onclick = () => { quickKey = settings.quickDefault; paintQuickKey(); };
  $('quickKeyOff').onclick = () => { quickKey = ''; paintQuickKey(); };
  $('remindLink').onclick = () => { dlg.close(); const b = document.querySelector('.nav [data-tab="today"]'); if (b) b.click(); const p = $('remindPanel'); if (p) p.scrollIntoView({ block: 'start' }); };

  /* ---------- Claude availability hint ---------- */
  d.claude.available().then(ok => {
    if (ok) return;
    const tag = $('modelTag');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn sm'; b.textContent = 'Add Claude API key';
    b.onclick = openSettings;
    tag.after(b);
    setTimeout(() => { $('useAi').title = 'Add a Claude API key in Settings to read syllabi with Claude'; }, 1000);
  });

  /* ---------- Account ---------- */
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PERSON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="5.5" r="2.8"/><path d="M2.8 14c.6-2.7 2.7-4.2 5.2-4.2s4.6 1.5 5.2 4.2"/></svg>';
  const acctBtn = document.createElement('button');
  acctBtn.type = 'button'; acctBtn.className = 'acct-btn'; acctBtn.id = 'accountBtn';
  gear.before(acctBtn);

  const adlg = document.createElement('dialog');
  adlg.className = 'settings account';
  document.body.appendChild(adlg);
  let acct = { configured: false, user: null, sync: false };
  // Signed out: 'in', 'up', 'reset1', 'reset2' (a code is emailed only to reset a password). Signed in: 'me', 'password', 'devices', 'delete'.
  let mode = 'in';
  let pendingEmail = '';

  function paintAcctBtn() {
    if (acct.user) {
      acctBtn.innerHTML = `<span class="avatar">${esc(acct.user.email[0].toUpperCase())}</span><span class="who">${esc(acct.user.email)}</span>`;
      acctBtn.title = `Signed in as ${acct.user.email}`;
    } else {
      acctBtn.innerHTML = `${PERSON}<span class="who">Sign in</span>`;
      acctBtn.title = 'Sign in or create an account (optional)';
    }
  }
  const PASS_HINT = '<p class="hint">At least 8 characters. A short phrase is easy to remember and hard to guess.</p>';
  const actions = (label, cancel = 'Cancel') => `<div class="actions"><span style="flex:1"></span><button type="button" class="btn" id="authCancel">${cancel}</button><button type="submit" class="btn primary" id="authSubmit">${label}</button></div>`;
  const codeField = '<section class="field"><label for="authCode">6-digit code from the email</label><input type="text" id="authCode" class="code-in" inputmode="numeric" autocomplete="one-time-code" pattern="\\s*[0-9]{6}\\s*" maxlength="8" required></section>';
  function renderAccount(msg, bad) {
    const note = msg ? `<p class="msg${bad ? ' bad' : ''}" role="${bad ? 'alert' : 'status'}">${esc(msg)}</p>` : '';
    if (!acct.configured) {
      adlg.innerHTML = `<form method="dialog"><h2>Accounts</h2>
        <p class="hint">Accounts aren’t available in this build yet. You don’t need one: everything works and saves on this computer.</p>
        <div class="actions"><span style="flex:1"></span><button class="btn primary" value="close">OK</button></div></form>`;
      return;
    }
    if (acct.user) { renderSignedIn(note); return; }
    if (mode === 'reset1') {
      adlg.innerHTML = `<form id="authForm"><h2>Reset your password</h2>
        <p class="hint">Enter your account’s email. We’ll send a code you can use to choose a new password.</p>
        <section class="field"><label for="authEmail">Email</label><input type="email" id="authEmail" autocomplete="email" required></section>
        ${note}${actions('Send code')}</form>`;
    } else if (mode === 'reset2') {
      adlg.innerHTML = `<form id="authForm"><h2>Choose a new password</h2>
        <p class="hint">If there’s an account for <b>${esc(pendingEmail)}</b>, we sent it a 6-digit code. Check spam too.</p>
        ${codeField}
        <section class="field"><label for="authPass">New password</label><input type="password" id="authPass" autocomplete="new-password" minlength="8" maxlength="128" required>${PASS_HINT}</section>
        ${note}
        <p class="hint"><button type="button" class="linkish" id="resendCode">Send a new code</button></p>
        ${actions('Save password')}</form>`;
      $('resendCode').onclick = async () => { const r = await d.account.requestReset(pendingEmail); renderAccount(r.ok ? 'Sent a new code. Use the newest email.' : r.message, !r.ok); };
    } else {
      const up = mode === 'up';
      adlg.innerHTML = `<form id="authForm"><h2>${up ? 'Create your account' : 'Sign in'}</h2>
        <p class="hint">Optional. SemesterSync works fully without an account, and your courses stay on this computer either way.</p>
        <div class="seg" role="group" aria-label="Account action"><button type="button" data-m="in" aria-pressed="${!up}">Sign in</button><button type="button" data-m="up" aria-pressed="${up}">Create account</button></div>
        <section class="field"><label for="authEmail">Email</label><input type="email" id="authEmail" autocomplete="email" maxlength="254" required></section>
        <section class="field"><div class="label-row"><label for="authPass">Password</label>${up ? '' : '<button type="button" class="linkish" id="forgotBtn">Forgot password?</button>'}</div>
          <input type="password" id="authPass" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="${up ? 8 : 1}" maxlength="128" required>
          ${up ? PASS_HINT + '<p class="hint">Use an email you can open: if you forget your password, a code to reset it goes there.</p>' : ''}</section>
        ${note}${actions(up ? 'Create account' : 'Sign in')}</form>`;
      adlg.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m; const em = $('authEmail').value; renderAccount(); $('authEmail').value = em; $('authEmail').focus(); });
      if (!up) $('forgotBtn').onclick = () => { const em = $('authEmail').value; mode = 'reset1'; renderAccount(); $('authEmail').value = em; $('authEmail').focus(); };
    }
    $('authCancel').onclick = () => { if (['reset1', 'reset2'].includes(mode)) { mode = 'in'; renderAccount(); if ($('authEmail')) $('authEmail').value = pendingEmail; } else adlg.close(); };
    $('authForm').addEventListener('submit', onAuthSubmit);
  }
  const when = iso => { const t = Date.parse(iso); if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 15 ? 'active now' : m < 60 * 24 ? `active ${Math.round(m / 60) || 1} h ago` : `active ${new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`; };
  async function renderSignedIn(note) {
    const back = '<button type="button" class="btn" id="acctBack">Back</button>';
    if (mode === 'password') {
      adlg.innerHTML = `<form id="authForm"><h2>Change password</h2>
        <section class="field"><label for="curPass">Current password</label><input type="password" id="curPass" autocomplete="current-password" maxlength="128" required></section>
        <section class="field"><label for="authPass">New password</label><input type="password" id="authPass" autocomplete="new-password" minlength="8" maxlength="128" required>${PASS_HINT}</section>
        <p class="hint">Other computers signed in to this account will be signed out.</p>
        ${note}<div class="actions"><span style="flex:1"></span>${back}<button type="submit" class="btn primary" id="authSubmit">Change password</button></div></form>`;
    } else if (mode === 'delete') {
      adlg.innerHTML = `<form id="authForm"><h2>Delete account</h2>
        <p class="hint">This deletes the account <b>${esc(acct.user.email)}</b> right away and signs out every computer. It can’t be undone.</p>
        <p class="hint">Your courses on this computer aren’t touched: they stay here and keep working without an account.</p>
        <section class="field"><label for="authPass">Enter your password to confirm</label><input type="password" id="authPass" autocomplete="current-password" maxlength="128" required></section>
        ${note}<div class="actions"><span style="flex:1"></span>${back}<button type="submit" class="btn danger" id="authSubmit">Delete account</button></div></form>`;
    } else if (mode === 'devices') {
      adlg.innerHTML = `<form method="dialog"><h2>Signed-in computers</h2><div id="devList"><p class="hint">Loading…</p></div>${note}
        <div class="actions"><button type="button" class="btn ghost danger" id="revokeOthers" hidden>Sign out all others</button><span style="flex:1"></span>${back}</div></form>`;
      $('acctBack').onclick = () => { mode = 'me'; renderAccount(); };
      const r = await d.account.sessions();
      if (mode !== 'devices') return;
      if (!r.ok) { if (r.code === 'unauthorized') { await refreshAcct(); return; } $('devList').innerHTML = `<p class="msg bad">${esc(r.message)}</p>`; return; }
      $('devList').innerHTML = `<ul class="dev-list">${r.sessions.map(s => `<li><div><b>${esc(s.device || 'Unknown computer')}</b><span>${s.current ? 'This computer' : esc(when(s.lastSeen))}</span></div>${s.current ? '' : `<button type="button" class="btn sm ghost" data-revoke="${esc(s.id)}">Sign out</button>`}</li>`).join('')}</ul>`;
      $('revokeOthers').hidden = r.sessions.length < 2;
      adlg.querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => { b.disabled = true; const x = await d.account.revokeSession(b.dataset.revoke); if (!x.ok) { renderAccount(x.message, true); return; } renderAccount('Signed out that computer.'); });
      $('revokeOthers').onclick = async () => { const x = await d.account.revokeOthers(); renderAccount(x.ok ? 'Signed out every other computer.' : x.message, !x.ok); };
      return;
    } else {
      mode = 'me';
      const syncText = acct.sync
        ? (window.CloudSync && window.CloudSync.isOn() ? 'Cloud sync is on.' : 'Cloud sync is off: nothing is uploaded.') + ' Manage it in <b>Your data</b>.'
        : 'Your courses are saved on this computer. This account server doesn’t offer cloud sync, so nothing is uploaded.';
      adlg.innerHTML = `<form method="dialog"><h2>Your account</h2>
        <div class="acct-card"><span class="avatar lg">${esc(acct.user.email[0].toUpperCase())}</span><div><b>${esc(acct.user.email)}</b><span>${acct.offline ? 'Offline: couldn’t check with the account server.' : 'Signed in'}</span></div></div>
        <p class="hint">${syncText}</p>
        <div class="row" style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn sm" id="pwBtn">Change password</button><button type="button" class="btn sm" id="devBtn">Signed-in computers</button><button type="button" class="btn sm ghost danger" id="delBtn">Delete account…</button></div>
        <p class="hint">Signing out keeps your courses on this computer. On a shared computer, tick the box to remove them from here too.</p>
        <label class="hint" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="wipeLocal"> Also remove my courses, settings and backups from this computer</label>
        ${note}
        <div class="actions"><button type="button" class="btn ghost danger" id="signOutBtn">Sign out</button><span style="flex:1"></span><button class="btn primary" value="close">Done</button></div></form>`;
      for (const [id, m] of [['pwBtn', 'password'], ['devBtn', 'devices'], ['delBtn', 'delete']]) $(id).onclick = () => { mode = m; renderAccount(); const f = adlg.querySelector('input'); if (f) f.focus(); };
      $('signOutBtn').onclick = async () => {
        const wipe = $('wipeLocal').checked;
        if (window.CloudSync) window.CloudSync.forget(acct.user.id);
        await d.account.signOut();
        try {
          localStorage.removeItem('ssync-account-cache-v1');
          if (wipe) for (const k of Object.keys(localStorage)) if (k.startsWith('ssync-') && !['ssync-format', 'ssync-onboarded', 'ssync-theme', 'ssync-migrated-supabase'].includes(k)) localStorage.removeItem(k);
        } catch { /* nothing to remove */ }
        if (wipe) { await d.backup.clear().catch(() => {}); await d.sources.clear().catch(() => {}); }
        location.reload();
      };
      return;
    }
    $('acctBack').onclick = () => { mode = 'me'; renderAccount(); };
    $('authForm').addEventListener('submit', onAuthSubmit);
  }
  async function refreshAcct(msg, bad) {
    acct = await d.account.status();
    paintAcctBtn();
    if (!acct.user && !['in', 'up', 'reset1', 'reset2'].includes(mode)) mode = 'in';
    renderAccount(msg || (!acct.user && mode === 'in' ? 'You’ve been signed out. Sign in again.' : ''), bad);
  }
  async function finishSignIn() {
    try { localStorage.setItem('ssync-onboarded', '1'); } catch { /* fine */ }
    acct = await d.account.status();
    if (acct.sync) { paintAcctBtn(); adlg.close(); await askToSync(); return; }
    // No sync yet: nothing on the page changes, so there's no need to reload.
    paintAcctBtn(); mode = 'me'; renderAccount(`Signed in as ${acct.user ? acct.user.email : ''}.`);
  }
  // Nothing is uploaded without asking. After signing in (or from Your data), this lists what would go and
  // what's already in the account; unticked courses stay only on this computer. "Not now" uploads nothing.
  const sdlg = document.createElement('dialog');
  sdlg.className = 'settings sync-choose';
  document.body.appendChild(sdlg);
  async function askToSync() {
    const s = await d.account.status();
    if (!s.user || !s.sync || !window.CloudSync) return;
    if (window.CloudSync.isOn()) { toast('Cloud sync is already on.'); return; }
    const remote = await window.CloudSync.accountDocs().catch(() => null);
    if (!remote) { toast('Couldn’t reach your account. Sync stays off for now; turn it on later from Your data.'); return; }
    const mine = window.SSyncPage.state.courses.filter(c => !c.sample);
    const there = new Map(remote.filter(x => x.doc_id.startsWith('course-') && x.doc_id !== 'course-inbox').map(x => { let code = 'A course'; try { code = JSON.parse(x.body).code || code; } catch { /* unreadable */ } return [x.doc_id.slice(7), code]; }));
    const onlyThere = [...there].filter(([id]) => !mine.some(c => c.id === id)).map(([, code]) => code);
    const rows = mine.map(c => `<label class="toggle-row" style="justify-content:flex-start;gap:10px"><input type="checkbox" data-cid="${esc(c.id)}" checked><span><b>${esc(c.code)}</b>${c.title ? ' · ' + esc(c.title) : ''}${there.has(c.id) ? ' <small>(also in your account; the two are combined)</small>' : ''}</span></label>`).join('');
    sdlg.innerHTML = `<form method="dialog"><h2>Cloud sync</h2>
      <p class="hint">Choose what to keep in <b>${esc(s.user.email)}</b>. Each course goes with its deliverables, scores, notes, syllabus text and study sets. Only you can see your account’s data. A complete copy always stays on this computer.</p>
      ${mine.length ? `<div class="sync-list">${rows}</div>` : '<p class="hint">This computer has no courses of its own yet.</p>'}
      <label class="toggle-row" style="justify-content:flex-start;gap:10px"><input type="checkbox" id="syncSettings" checked><span><b>Settings, Inbox and study history</b> <small>reminders, planner hours, GPA inputs, focus history</small></span></label>
      ${onlyThere.length ? `<p class="hint">Your account also has ${onlyThere.length} course${onlyThere.length === 1 ? '' : 's'} that aren’t on this computer: <b>${esc(onlyThere.slice(0, 8).join(', '))}</b>. ${onlyThere.length === 1 ? 'It’s' : 'They’re'} added here.</p>` : ''}
      <p class="hint">If the same course changed here and in the account in a way that can’t be combined, you choose which to keep. You can change all of this later: each course has a sync switch, and <b>Your data</b> turns sync off.</p>
      <p class="msg bad" id="syncMsg" hidden></p>
      <div class="actions"><span style="flex:1"></span><button type="button" class="btn" data-sc="no">Not now</button><button type="button" class="btn primary" data-sc="yes">${mine.length ? 'Upload and turn on sync' : 'Turn on sync'}</button></div></form>`;
    const choice = await new Promise(resolve => {
      sdlg.querySelectorAll('[data-sc]').forEach(b => b.onclick = () => resolve(b.dataset.sc));
      sdlg.addEventListener('cancel', () => resolve('no'), { once: true });
      sdlg.showModal();
    });
    if (choice !== 'yes') { sdlg.close(); return; }
    const off = [...sdlg.querySelectorAll('[data-cid]')].filter(x => !x.checked).map(x => x.dataset.cid);
    const settings = sdlg.querySelector('#syncSettings').checked;
    // A copy of everything on this computer, before the first sync touches it.
    const backup = await d.backup.write('before-first-sync', JSON.stringify(window.SSyncPage.backupData())).catch(() => null);
    if (!backup || !backup.ok) { const m = sdlg.querySelector('#syncMsg'); m.textContent = 'Couldn’t save a backup first, so nothing was changed. Check there’s free disk space and try again.'; m.hidden = false; return; }
    sdlg.close();
    await window.CloudSync.enable({ off, settings });
    toast(window.CloudSync.isOn() ? 'Cloud sync is on' : 'Couldn’t turn on sync');
  }
  async function onAuthSubmit(e) {
    e.preventDefault();
    const btn = $('authSubmit'); btn.disabled = true; btn.textContent = 'Working…';
    const val = id => ($(id) ? $(id).value : '');
    const keep = (msg, bad, ids = ['authEmail', 'authCode']) => { const v = ids.map(val); renderAccount(msg, bad); ids.forEach((id, i) => { if ($(id) && v[i]) $(id).value = v[i]; }); };
    let r;
    switch (mode) {
      case 'reset1':
        pendingEmail = val('authEmail').trim();
        r = await d.account.requestReset(pendingEmail);
        if (!r.ok) { keep(r.message, true); return; }
        mode = 'reset2'; renderAccount(); $('authCode').focus(); return;
      case 'reset2':
        r = await d.account.completeReset(pendingEmail, val('authCode'), val('authPass'));
        if (!r.ok) { keep(r.message, true); return; }
        await finishSignIn(); return;
      case 'password':
        r = await d.account.changePassword(val('curPass'), val('authPass'));
        if (!r.ok) { if (r.code === 'unauthorized') { await refreshAcct(); return; } renderAccount(r.message, true); return; }
        mode = 'me'; renderAccount('Password changed. Other computers were signed out.'); return;
      case 'delete':
        r = await d.account.deleteAccount(val('authPass'));
        if (!r.ok) { if (r.code === 'unauthorized') { await refreshAcct(); return; } renderAccount(r.message, true); return; }
        if (window.CloudSync) window.CloudSync.forget(acct.user.id);
        try { for (const k of Object.keys(localStorage)) if (k.startsWith('ssync-sync-consent-')) localStorage.removeItem(k); localStorage.removeItem('ssync-account-cache-v1'); } catch { /* nothing to remove */ }
        mode = 'in'; await refreshAcct('Your account was deleted. Your courses are still on this computer.'); paintAcctBtn(); return;
    }
    const email = val('authEmail').trim(), password = val('authPass');
    pendingEmail = email;
    r = mode === 'up' ? await d.account.signUp(email, password) : await d.account.signIn(email, password);
    if (r.code === 'email_taken') { mode = 'in'; keep(r.message, true, ['authEmail']); $('authPass').focus(); return; }
    if (!r.ok) { keep(r.message, true, ['authEmail']); return; }
    await finishSignIn();
  }
  async function openAccount(want) {
    acct = await d.account.status();
    paintAcctBtn();
    if (acct.user) mode = 'me';
    else if (want === 'up') mode = 'up';
    else if (!['in', 'up', 'reset1', 'reset2'].includes(mode)) mode = 'in';
    renderAccount();
    if (!adlg.open) adlg.showModal();
    const em = $('authEmail'); if (em) em.focus();
  }
  acctBtn.onclick = () => openAccount();
  d.account.status().then(s => { acct = s; paintAcctBtn(); });
  paintAcctBtn();

  /* ---------- Menu shortcuts ---------- */
  d.onMenu('account', () => openAccount());
  d.onMenu('settings', openSettings);
  d.onMenu('new-course', () => { const b = $('addCourse'); if (b) b.click(); else toast('You can track up to 8 courses'); });
  d.onMenu('open-file', () => $('fileInput').click());
  d.onMenu('export-ics', () => { const b = $('syncBtn'); if (b.disabled) toast('Nothing to export. Turn on calendar sync for some deliverables first.'); else b.click(); });
  d.onMenu('theme', () => $('themeBtn').click());
  const page = detail => document.dispatchEvent(new CustomEvent('ssync:data', { detail }));
  for (const [menu, detail] of [['backup-export', 'export'], ['backup-import', 'import'], ['data', 'data'], ['search', 'search'], ['welcome', 'welcome'], ['keys', 'keys']]) d.onMenu(menu, () => page(detail));
  for (let i = 0; i < 8; i++) d.onMenu('tab-' + i, () => { const b = document.querySelectorAll('.nav [data-tab]')[i]; if (b) b.click(); });
  // The page asks for these from its welcome guide and Your data.
  document.addEventListener('ssync:open', async e => {
    if (e.detail === 'settings') openSettings();
    else if (e.detail === 'account') openAccount('up');
    else if (e.detail === 'sync') { acct = await d.account.status(); if (!acct.user) { openAccount(); return; } if (!acct.sync) { toast('Cloud sync isn’t available on this account server.'); return; } await askToSync(); }
  });

  // Reminders moved to the page (Today tab). Someone who turned them off in 1.2 keeps them off.
  d.settings.get().then(s => { settings = s; if (s.reminders === false) document.dispatchEvent(new CustomEvent('ssync:remind-legacy-off')); });
})();
