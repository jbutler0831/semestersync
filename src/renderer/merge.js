// Combines two versions of a synced document that both changed since they last matched (the base).
// Courses and study sets are compared deliverable by deliverable (and card by card), field by field:
// a change on only one side is taken; the same field changed differently on both sides is a conflict for the
// person to decide. Settings and study history never conflict: entries are combined, and where the same
// setting changed on both computers, the newer edit wins.
// Pure functions, no page access, so they can be unit-tested (test/merge.test.js).
(function (root) {
  // Compares by content, not key order.
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  const eq = (a, b) => canon(a) === canon(b);
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const keysOf = (...objs) => [...new Set(objs.flatMap(o => (isObj(o) ? Object.keys(o) : [])))];

  // One value, three ways. Returns { v } or { conflict: true }.
  function pick(b, m, t) {
    if (eq(m, t)) return { v: m };
    if (eq(b, m)) return { v: t };
    if (eq(b, t)) return { v: m };
    return { conflict: true };
  }

  // Merges the plain fields of two objects (skipping `skip`), recording conflicting fields.
  function fields(b, m, t, skip, conflicts, where) {
    const out = {};
    for (const k of keysOf(b, m, t)) {
      if (skip.includes(k)) continue;
      const r = pick(b && b[k], m && m[k], t && t[k]);
      if (r.conflict) { conflicts.push({ ...where, field: k, mine: m[k], theirs: t[k] }); out[k] = m[k]; } else if (r.v !== undefined) out[k] = r.v;
    }
    return out;
  }

  // Lists of things with stable ids (deliverables, Inbox drafts, flashcards).
  function list(bl, ml, tl, conflicts, label) {
    const ix = l => new Map((Array.isArray(l) ? l : []).filter(x => x && x.id != null).map(x => [String(x.id), x]));
    const B = ix(bl), Mi = ix(ml), T = ix(tl);
    const order = [...Mi.keys(), ...[...T.keys()].filter(k => !Mi.has(k))];
    const out = [];
    for (const id of order) {
      const b = B.get(id), m = Mi.get(id), t = T.get(id);
      if (m && t) {
        if (eq(m, t)) { out.push(m); continue; }
        out.push(fields(b, m, t, [], conflicts, { id, what: label(m) }));
      } else if (m) {
        if (!b) out.push(m); // added here
        else if (!eq(b, m)) { conflicts.push({ id, what: label(m), field: 'deleted', mine: 'changed here', theirs: 'deleted' }); out.push(m); }
        // else: deleted there, untouched here: it goes
      } else if (t) {
        if (!b) out.push(t); // added there
        else if (!eq(b, t)) { conflicts.push({ id, what: label(t), field: 'deleted', mine: 'deleted', theirs: 'changed there' }); }
        // else: deleted here, untouched there: it stays deleted
      }
    }
    return out;
  }

  // A whole document deleted on one side.
  function deletion(b, m, t, conflicts) {
    if (!m && !t) return { done: true, value: null };
    if (m && t) return null;
    const kept = m || t;
    if (!b) return { done: true, value: kept }; // created on one side only
    if (eq(b, kept)) return { done: true, value: null }; // the other side deleted it and this one didn't change it
    conflicts.push({ field: 'document', mine: m ? 'changed here' : 'deleted here', theirs: t ? 'changed there' : 'deleted there' });
    return { done: true, value: m };
  }

  function course(b, m, t) {
    const conflicts = [];
    const del = deletion(b, m, t, conflicts);
    if (del) return { value: del.value, conflicts };
    const out = fields(b, m, t, ['items', 'drafts'], conflicts, { what: 'Course' });
    out.items = list(b && b.items, m.items, t.items, conflicts, x => x.title || 'A deliverable');
    if (m.drafts || t.drafts) out.drafts = list(b && b.drafts, m.drafts, t.drafts, conflicts, x => x.title || 'A task');
    return { value: out, conflicts };
  }

  function deck(b, m, t) {
    const conflicts = [];
    const del = deletion(b, m, t, conflicts);
    if (del) return { value: del.value, conflicts };
    const out = fields(b, m, t, ['cards', 'log', 'quiz'], conflicts, { what: 'Study set' });
    out.cards = list(b && b.cards, m.cards, t.cards, conflicts, x => String(x.q || 'A card').slice(0, 60));
    // Review history: every answer from both computers, in time order.
    const seen = new Set(), log = [];
    for (const a of [...(m.log || []), ...(t.log || [])]) { const k = canon(a); if (!seen.has(k)) { seen.add(k); log.push(a); } }
    out.log = log.sort((x, y) => (+x.at || 0) - (+y.at || 0));
    const q = pick(b && b.quiz, m.quiz, t.quiz);
    out.quiz = q.conflict ? m.quiz : q.v;
    return { value: out, conflicts };
  }

  // Settings and history: combined without asking.
  function deep(b, m, t, preferTheirs) {
    const r = pick(b, m, t);
    if (!r.conflict) return r.v;
    if (isObj(m) && isObj(t)) {
      const out = {};
      for (const k of keysOf(m, t)) {
        const v = k in m && k in t ? deep(isObj(b) ? b[k] : undefined, m[k], t[k], preferTheirs) : k in m ? (isObj(b) && k in b && eq(b[k], m[k]) ? undefined : m[k]) : (isObj(b) && k in b && eq(b[k], t[k]) ? undefined : t[k]);
        if (v !== undefined) out[k] = v;
      }
      return out;
    }
    // Lists of records (history, logs) are combined; a list of plain values is one setting.
    const records = l => l.every(x => isObj(x));
    if (Array.isArray(m) && Array.isArray(t) && records(m) && records(t)) {
      const key = x => (x && typeof x === 'object' ? (x.id != null ? 'id:' + x.id : x.at != null ? 'at:' + x.at + ':' + canon(x) : canon(x)) : canon(x));
      const bk = new Set((Array.isArray(b) ? b : []).map(key));
      const mk = new Set(m.map(key)), tk = new Set(t.map(key));
      const out = [];
      const seen = new Set();
      for (const x of [...m, ...t]) {
        const k = key(x);
        if (seen.has(k)) continue;
        // Removed on one side (in the base and missing there): stays removed.
        if (bk.has(k) && (!mk.has(k) || !tk.has(k))) continue;
        seen.add(k);
        if (x && x.id != null && mk.has(k) && tk.has(k)) {
          const mx = m.find(y => key(y) === k), tx = t.find(y => key(y) === k), bx = (Array.isArray(b) ? b : []).find(y => key(y) === k);
          out.push(deep(bx, mx, tx, preferTheirs));
        } else out.push(x);
      }
      if (out.some(x => x && x.at != null)) out.sort((x, y) => (+x.at || 0) - (+y.at || 0));
      return out;
    }
    return preferTheirs ? t : m;
  }
  function extras(b, m, t, preferTheirs) {
    if (!m || !t) return { value: m || t || null, conflicts: [] };
    return { value: deep(b, m, t, !!preferTheirs), conflicts: [] };
  }

  /** kind: 'course' | 'deck' | 'extras'. Objects are parsed documents, or null when deleted / never synced (base). */
  function merge(kind, base, mine, theirs, opts = {}) {
    if (kind === 'course') return course(base, mine, theirs);
    if (kind === 'deck') return deck(base, mine, theirs);
    return extras(base, mine, theirs, opts.preferTheirs);
  }

  const api = { merge, eq, canon };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SyncMerge = api;
})(typeof window !== 'undefined' ? window : globalThis);
