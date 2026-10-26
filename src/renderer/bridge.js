// Gives the page the same `claude.use(name)` entry point it has as a web artifact,
// backed by the desktop app's own Claude API connection. Saving falls back to
// localStorage, which Electron keeps on disk in the app's data folder.
// Syllabus extraction uses the fixed schema in main.js; other JSON calls pass their own `schema`.
(() => {
  const d = window.desktop;
  // pdf.js parses PDFs in a background worker bundled with the app.
  if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  let seq = 0;

  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const turnsOf = input => typeof input === 'string' ? [{ role: 'user', content: input }] : input.map(m => ({ role: m.role, content: String(m.content) }));
  // Free-form calls (coach, study sets, photo scanning) go through claude:ask; `onText` gets the whole answer so far.
  async function ask(input, opts = {}) {
    const id = `a${++seq}-${Date.now()}`;
    if (opts.signal) {
      if (opts.signal.aborted) throw { code: 'cancelled', message: 'Stopped' };
      opts.signal.addEventListener('abort', () => d.claude.cancel(id), { once: true });
    }
    const imgs = opts.images ? [...(opts.images instanceof Blob ? [opts.images] : opts.images)] : [];
    const images = [];
    for (const b of imgs) {
      if (!IMAGE_TYPES.includes(b.type)) throw { code: 'image_rejected', message: 'Unsupported image type' };
      images.push({ type: b.type, data: new Uint8Array(await b.arrayBuffer()) });
    }
    let text = '';
    const onDelta = opts.onText ? delta => { text += delta; opts.onText({ text, delta }); } : null;
    const res = await d.claude.ask(id, { messages: turnsOf(input), images, schema: opts.schema, effort: opts.effort }, onDelta);
    if (!res.ok) throw { code: res.code, message: res.message, text: text || undefined };
    return res;
  }

  function makeSample() {
    const sample = async (input, opts = {}) => { const res = await ask(input, opts); return { text: res.text, truncated: !!res.truncated }; };
    sample.limits = async () => ({ images: { maxCount: 8, maxBytes: 5 * 1024 * 1024, mediaTypes: IMAGE_TYPES } });
    sample.json = (input, opts = {}) => opts.schema ? ask(input, opts).then(res => {
      if (res.truncated) throw { code: 'invalid_json', message: 'The reply was cut off.' };
      try { return JSON.parse(res.text); } catch { throw { code: 'invalid_json', message: 'Claude returned malformed JSON.', text: res.text }; }
    }) : new Promise((resolve, reject) => {
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

  // The desktop page keeps courses on this computer and never uses the web version's account storage;
  // cloud sync with SemesterSync accounts is cloudsync.js.
  window.claude = {
    async use(name) {
      if (name === 'sample') return (await d.claude.available()) ? makeSample() : null;
      return null;
    },
  };
})();
