// A stand-in for the Claude API: streams canned replies so the app's Claude features can be tested without a key or network.
const http = require('http');
const seen = [];
function reply(body) {
  const last = body.messages[body.messages.length - 1];
  const text = typeof last.content === 'string' ? last.content : last.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const images = typeof last.content === 'string' ? 0 : last.content.filter(b => b.type === 'image').length;
  seen.push({ kind: text.includes('"cards"') ? 'study' : text.includes('Transcribe') ? 'scan' : 'coach', images, hasSemesterData: body.messages[0].content.includes ? String(body.messages[0].content).includes('<semester_data>') : false, turns: body.messages.length, format: !!(body.output_config && body.output_config.format), firstChars: String(typeof body.messages[0].content === 'string' ? body.messages[0].content : '').slice(0, 2000) });
  const schema = body.output_config && body.output_config.format && body.output_config.format.schema;
  if (schema && schema.properties && schema.properties.categories) return JSON.stringify({
    code: 'HIST 101', title: 'World History',
    categories: [{ label: 'Essays', pct: 60, count: 2 }, { label: 'Final exam', pct: 40, count: null }],
    items: [
      { title: 'Essay 1', type: 'Paper', date: '2026-11-06', time: '23:59', category: 'Essays', weight: 30, ungraded: false, notes: '', line: 4, confidence: 92 },
      { title: 'Essay 2', type: 'Paper', date: '2026-11-20', time: '23:59', category: 'Essays', weight: 30, ungraded: false, notes: '', line: 5, confidence: 64 },
      { title: 'Final exam', type: 'Exam', date: '2026-12-10', time: '09:00', category: 'Final exam', weight: 40, ungraded: false, notes: '', line: 6, confidence: 95 },
    ],
  });
  if (text.includes('"cards"')) return JSON.stringify({
    cards: [{ q: 'What is working memory?', a: 'A limited-capacity system that holds information briefly while you use it.' }, { q: 'Who proposed the multicomponent model?', a: 'Baddeley and Hitch (1974).' }, { q: 'What is the phonological loop?', a: 'The part of working memory that holds sound-based information.' }],
    quiz: [{ q: 'Roughly how many chunks can working memory hold?', choices: ['2', '4', '12', '20'], answer: 1, why: 'Cowan estimates about 4 chunks.' }, { q: 'Which component coordinates the others?', choices: ['Episodic buffer', 'Central executive', 'Visuospatial sketchpad', 'Phonological loop'], answer: 1, why: 'The central executive directs attention.' }],
    guide: '## Working memory\n- **Capacity** is limited to about 4 chunks.\n- The **central executive** coordinates the subsystems.\n\n## Common mistakes\n- Confusing working memory with long-term memory.',
  });
  if (text.includes('Transcribe')) return 'BIO 150: Introduction to Biology, Fall 2026\nGRADING\nLab reports (2) ........ 30%\nFinal exam ........ 70%\nNov 5  Lab Report 1 due\nNov 19  Lab Report 2 due\nDec 12  Final Exam, 9:00 AM';
  return "Here's your focus for this week:\n- **CS 220**: start Problem Set 4 today.\n- Review for your quiz.\n\nYou're on track in most classes.";
}
function serve(port) {
  return http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      if (!req.url.startsWith('/v1/messages')) { res.writeHead(404); res.end('{}'); return; }
      const body = JSON.parse(raw), text = reply(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      for (let i = 0; i < text.length; i += 40) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 40) } });
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 50 } });
      ev('message_stop', {});
      res.end();
    });
  }).listen(port, '127.0.0.1');
}
module.exports = { serve, seen };
