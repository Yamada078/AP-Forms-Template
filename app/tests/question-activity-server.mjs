import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const projectRoot = new URL('../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, value => value.slice(1));
const publicRoot = join(decodeURIComponent(projectRoot), 'public');
const media = text => ({
  path: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" rx="12" fill="#dfe7ff"/><text x="60" y="48" text-anchor="middle" font-size="28">${text}</text></svg>`)}`,
  alt: `ภาพ ${text}`,
});
const base = { difficulty: 2, status: 'READY', description: '', explanation: 'คำอธิบายทดสอบ', internalNotes: '', sourceReference: '', tags: [], readiness: { valid: true, errors: [] }, media: null };
const questions = [
  { ...base, id: 'q_matching', type: 'MATCHING', prompt: 'จับคู่คำกับความหมาย', answerConfig: { pairs: [
    { id: 'p1', leftId: 'l1', rightId: 'r1', leftText: 'แมว', rightText: 'Cat', leftMedia: media('🐈'), rightMedia: null },
    { id: 'p2', leftId: 'l2', rightId: 'r2', leftText: 'สุนัขข้อความยาวสำหรับตรวจการตัดบรรทัดบนหน้าจอแคบ', rightText: 'Dog', leftMedia: null, rightMedia: media('🐕') },
  ], rightDistractors: [{ id: 'fake1', rightId: 'rf1', rightText: 'Tiger', rightMedia: media('🐅') }], leftOrder: ['l2', 'l1'], rightOrder: ['rf1', 'r1', 'r2'] } },
  { ...base, id: 'q_drag', type: 'DRAG_DROP', prompt: 'ลากสัตว์ไปยังประเภทที่ถูกต้อง', answerConfig: { targets: [
    { id: 't1', label: 'สัตว์เลี้ยง', media: media('🏠') },
    { id: 't2', label: 'สัตว์ป่า', media: null },
  ], tokens: [
    { id: 'd1', text: 'แมว', media: media('🐈'), targetId: 't1' },
    { id: 'd2', text: 'เสือ', media: null, targetId: 't2' },
    { id: 'd3', text: 'เครื่องบิน', media: media('✈️'), targetId: '' },
  ] } },
  { ...base, id: 'q_order', type: 'ORDERING', prompt: 'เรียงลำดับ', answerConfig: { items: [{ id: 'o1', text: 'หนึ่ง' }, { id: 'o2', text: 'สอง' }], correctOrder: ['o1', 'o2'] } },
  { ...base, id: 'q_single', type: 'SINGLE_CHOICE', prompt: 'เลือก A', answerConfig: { choices: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctIds: ['a'] } },
  { ...base, id: 'q_multiple', type: 'MULTIPLE_CHOICE', prompt: 'เลือก A และ B', answerConfig: { choices: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctIds: ['a', 'b'] } },
  { ...base, id: 'q_true', type: 'TRUE_FALSE', prompt: 'จริงหรือเท็จ', answerConfig: { correctAnswer: true } },
  { ...base, id: 'q_short', type: 'SHORT_ANSWER', prompt: 'พิมพ์ test', answerConfig: { acceptedAnswers: ['test'], caseSensitive: false, trimWhitespace: true, normalizeUnicode: true } },
];

const json = (res, data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
const readJson = req => new Promise(resolve => { let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } }); });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4174');
  if (url.pathname === '/api/login') return json(res, { ok: true });
  if (url.pathname === '/api/admin/question-packs' && req.method === 'GET') return json(res, { packs: [] });
  if (url.pathname === '/api/admin/question-banks/activity-fixture') return json(res, { bank: { id: 'activity-fixture', name: 'Activity interaction fixture', description: 'Browser QA', status: 'ACTIVE', question_count: questions.length } });
  if (url.pathname === '/api/admin/question-banks/activity-fixture/tags') return json(res, { tags: [] });
  if (url.pathname === '/api/admin/question-banks/activity-fixture/questions' && req.method === 'GET') return json(res, { questions, total: questions.length });
  const questionMatch = url.pathname.match(/^\/api\/admin\/question-banks\/activity-fixture\/questions\/([^/]+)$/);
  if (questionMatch && req.method === 'PATCH') {
    const question = questions.find(item => item.id === decodeURIComponent(questionMatch[1]));
    if (!question) return json(res, { error: 'Question not found' }, 404);
    const body = await readJson(req);
    Object.assign(question, body, { tags: question.tags, readiness: { valid: true, errors: [] }, updatedAt: new Date().toISOString() });
    return json(res, { question });
  }
  if (url.pathname.startsWith('/api/')) return json(res, { error: 'Fixture route not found' }, 404);
  const relative = url.pathname === '/' ? 'question-banks.html' : url.pathname.replace(/^\//, '');
  const filePath = normalize(join(publicRoot, relative));
  if (!filePath.startsWith(normalize(publicRoot))) return json(res, { error: 'Not found' }, 404);
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { json(res, { error: 'Not found' }, 404); }
});

const port = Number(process.env.GOI_ACTIVITY_FIXTURE_PORT || 4174);
server.listen(port, '127.0.0.1', () => console.log(`Question activity fixture listening on http://127.0.0.1:${port}/question-banks.html?bank=activity-fixture`));
