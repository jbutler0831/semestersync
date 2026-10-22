// Gives the page the same `claude.use(name)` entry point it has as a web artifact,
// backed by the desktop app's own Claude API connection. Saving falls back to
// localStorage, which Electron keeps on disk in the app's data folder.
(() => {
  const d = window.desktop;
  // pdf.js parses PDFs in a background worker bundled with the app.
  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  let seq = 0;

  function makeSample() {
    const sample = () => Promise.reject({ code: 'invalid_request', message: 'Only structured extraction is available in the desktop app.' });
    sample.json = (input, opts = {}) => new Promise((resolve, reject) => {
      const id = `r${++seq}-${Date.now()}`;
      const prompt = typeof input === 'string' ? input : input.filter(m => m.role === 'user').map(m => m.content).join('\n\n');
      if (opts.signal) {
        if (opts.signal.aborted) { reject({ code: 'cancelled', message: 'Stopped' }); return; }
        opts.signal.addEventListener('abort', () => d.claude.cancel(id), { once: true });
      }
      // The page only reads the length of the streamed text to show progress.
      const onProgress = opts.onText ? chars => opts.onText({ text: { length: chars }, delta: '' }) : null;
      d.claude.extract(id, prompt, onProgress).then(res => {
        if (res.ok) resolve(res.data);
        else reject({ code: res.code, message: res.message });
      }, () => reject({ code: 'upstream_error', message: 'Request failed' }));
    });
    return sample;
  }

  // When someone is signed in, the page's saving goes to their account (cloud.js);
  // signed out, `db` is null and the page keeps courses on this computer.
  const account = d.account.status().catch(() => ({ configured: false, user: null }));
  const fail = res => { throw { code: 'unavailable', message: res.message }; };
  const db = {
    collection: () => ({
      async get() {
        const res = await d.cloud.list();
        if (!res.ok) fail(res);
        return { docs: res.docs.map(x => ({ id: x.id, exists: true, data: () => x.body })) };
      },
      doc: id => ({
        async set(body) { const res = await d.cloud.set(id, body); if (!res.ok) fail(res); },
        async delete() { const res = await d.cloud.remove(id); if (!res.ok) fail(res); },
      }),
    }),
  };

  window.claude = {
    async use(name) {
      if (name === 'sample') return (await d.claude.available()) ? makeSample() : null;
      const { user } = await account;
      if (!user) return null;
      if (name === 'db') return db;
      if (name === 'user') return { id: async () => user.id, can: async () => true, me: async () => ({ id: user.id, name: user.email }) };
      return null;
    },
  };
})();
