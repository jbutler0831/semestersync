// The app's page script is one file, where a second function with the same name silently replaces the
// first. That broke flashcard review once; this check stops it happening again. Run: node test/static.test.js
const fs = require('node:fs'), path = require('node:path');
let failed = 0;
for (const f of ['app.js', 'desktop.js', 'bridge.js', 'quickadd.js', 'taskparse.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', f), 'utf8');
  const names = [...src.matchAll(/^\s{0,2}(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map(m => m[1]);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) { failed++; console.log(`FAIL  ${f} defines these functions twice: ${[...new Set(dup)].join(', ')}`); }
  else console.log(`PASS  ${f}: no function defined twice`);
}
process.exit(failed ? 1 : 0);
