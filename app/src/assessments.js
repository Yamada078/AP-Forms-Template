import { consumerPackProjection } from './question-packs.js';

const encoder = new TextEncoder();
const parseJson = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const safeDecode = value => { try { return decodeURIComponent(value); } catch { return ''; } };

function positiveVersion(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : NaN;
}

function runnerQuestions(snapshot) {
  const trustedById = new Map((snapshot.questions || []).map(question => [String(question.sourceQuestionId), question]));
  return consumerPackProjection(snapshot).questions.map(question => {
    const trusted = trustedById.get(String(question.sourceQuestionId)), config = trusted?.answerConfig || {};
    return ({
    id: String(question.sourceQuestionId), order: Number(question.order), type: question.type,
    prompt: question.prompt, description: question.description, difficulty: Number(question.difficulty),
    ...(question.choices ? { choices: question.choices } : {}),
    ...(question.items ? { items: question.items } : {}),
    ...(question.leftItems ? { leftItems: question.leftItems, rightItems: question.rightItems || [] } : {}),
    ...(question.targets ? { targets: question.targets, tokens: question.tokens || [] } : {}),
    ...((question.type === 'MATCHING') ? { requiredAnswerCount: (config.pairs || []).length } : {}),
    ...((question.type === 'DRAG_DROP') ? { requiredAnswerCount: (config.tokens || []).filter(token => token.targetId).length } : {}),
    media: question.media || null, tags: question.tags || [],
    });
  });
}

async function publishedPack(env, packId, requestedVersion) {
  const row = requestedVersion == null
    ? await env.DB.prepare(`SELECT p.id AS pack_id,p.name AS pack_name,p.published_version AS pack_version,v.snapshot_json,v.published_at
      FROM question_packs p JOIN question_pack_versions v ON v.pack_id=p.id AND v.version=p.published_version
      WHERE p.id=? AND p.status='ACTIVE' AND p.published_version>0`).bind(packId).first()
    : await env.DB.prepare(`SELECT p.id AS pack_id,p.name AS pack_name,v.version AS pack_version,v.snapshot_json,v.published_at
      FROM question_packs p JOIN question_pack_versions v ON v.pack_id=p.id AND v.version=?
      WHERE p.id=? AND p.status='ACTIVE' AND p.published_version>=v.version`).bind(requestedVersion, packId).first();
  if (!row) return null;
  const snapshot = parseJson(row.snapshot_json, null);
  return snapshot && Array.isArray(snapshot.questions) ? { row, snapshot } : { error: 'Published Question Pack Snapshot ไม่สมบูรณ์' };
}

function normalizeShort(value, config) {
  let output = String(value ?? '');
  if (config?.normalizeUnicode !== false && output.normalize) output = output.normalize('NFC');
  if (config?.trimWhitespace !== false) output = output.trim();
  if (!config?.caseSensitive) output = output.toLowerCase();
  return output;
}

export function gradeQuestionPackSnapshot(snapshot, rawAnswers) {
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) return { error: 'answers ต้องเป็น Object', code: 'INVALID_ANSWERS' };
  const questions = snapshot.questions || [], knownIds = new Set(questions.map(question => String(question.sourceQuestionId)));
  const unknownId = Object.keys(rawAnswers).find(questionId => !knownIds.has(questionId));
  if (unknownId) return { error: `ไม่พบ Question ID ใน Session: ${unknownId}`, code: 'UNKNOWN_QUESTION' };
  const canonicalAnswers = {}, grading = [];
  let answeredCount = 0, correctCount = 0;
  for (const question of questions) {
    const questionId = String(question.sourceQuestionId), config = question.answerConfig || {};
    const supplied = Object.prototype.hasOwnProperty.call(rawAnswers, questionId), raw = supplied ? rawAnswers[questionId] : null;
    let answer = null, answered = false, correct = false;
    if (question.type === 'SINGLE_CHOICE') {
      if (raw != null && typeof raw !== 'string') return { error: `คำตอบ ${questionId} ต้องเป็น Choice ID`, code: 'INVALID_ANSWER_SHAPE' };
      const valid = new Set((config.choices || []).map(choice => String(choice.id)));
      if (raw != null && !valid.has(raw)) return { error: `Choice ID ของ ${questionId} ไม่ถูกต้อง`, code: 'INVALID_CHOICE' };
      answer = raw; answered = raw != null; correct = answered && raw === String((config.correctIds || [])[0]);
    } else if (question.type === 'MULTIPLE_CHOICE') {
      if (raw != null && (!Array.isArray(raw) || raw.some(value => typeof value !== 'string'))) return { error: `คำตอบ ${questionId} ต้องเป็น Array ของ Choice ID`, code: 'INVALID_ANSWER_SHAPE' };
      const order = (config.choices || []).map(choice => String(choice.id)), valid = new Set(order), submitted = new Set(raw || []);
      const invalid = [...submitted].find(choiceId => !valid.has(choiceId));
      if (invalid) return { error: `Choice ID ของ ${questionId} ไม่ถูกต้อง`, code: 'INVALID_CHOICE' };
      answer = order.filter(choiceId => submitted.has(choiceId)); answered = answer.length > 0;
      const expected = new Set((config.correctIds || []).map(String));
      correct = answered && answer.length === expected.size && answer.every(choiceId => expected.has(choiceId));
    } else if (question.type === 'TRUE_FALSE') {
      if (raw != null && typeof raw !== 'boolean') return { error: `คำตอบ ${questionId} ต้องเป็น Boolean`, code: 'INVALID_ANSWER_SHAPE' };
      answer = raw; answered = typeof raw === 'boolean'; correct = answered && raw === config.correctAnswer;
    } else if (question.type === 'SHORT_ANSWER') {
      if (raw != null && typeof raw !== 'string') return { error: `คำตอบ ${questionId} ต้องเป็นข้อความ`, code: 'INVALID_ANSWER_SHAPE' };
      if (typeof raw === 'string' && encoder.encode(raw).byteLength > 4096) return { error: `คำตอบ ${questionId} ยาวเกินกำหนด`, code: 'ANSWER_TOO_LONG' };
      answer = raw; const normalized = normalizeShort(raw, config); answered = normalized.length > 0;
      correct = answered && (config.acceptedAnswers || []).some(candidate => normalizeShort(candidate, config) === normalized);
    } else if (question.type === 'ORDERING') {
      if (raw != null && (!Array.isArray(raw) || raw.some(value => typeof value !== 'string'))) return { error: `คำตอบ ${questionId} ต้องเป็น Array ของ Item ID`, code: 'INVALID_ANSWER_SHAPE' };
      const validOrder = (config.items || []).map(item => String(item.id)), valid = new Set(validOrder), suppliedOrder = raw || [];
      if (new Set(suppliedOrder).size !== suppliedOrder.length || suppliedOrder.some(itemId => !valid.has(itemId))) return { error: `Item ID ของ ${questionId} ไม่ถูกต้อง`, code: 'INVALID_CHOICE' };
      answer = suppliedOrder; answered = answer.length === validOrder.length;
      const expected = (config.correctOrder || validOrder).map(String);
      correct = answered && answer.every((itemId, index) => itemId === expected[index]);
    } else if (question.type === 'MATCHING') {
      if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) return { error: `คำตอบ ${questionId} ต้องเป็น Object จับคู่`, code: 'INVALID_ANSWER_SHAPE' };
      const pairs = config.pairs || [], validLeft = new Set(pairs.map(pair => String(pair.leftId))), validRight = new Set([...pairs.map(pair => String(pair.rightId)), ...(config.rightDistractors || []).map(item => String(item.rightId))]);
      answer = raw || {};
      if (Object.keys(answer).some(leftId => !validLeft.has(leftId)) || Object.values(answer).some(rightId => typeof rightId !== 'string' || !validRight.has(rightId))) return { error: `Item ID ของ ${questionId} ไม่ถูกต้อง`, code: 'INVALID_CHOICE' };
      answered = Object.keys(answer).length === pairs.length;
      correct = answered && pairs.every(pair => answer[String(pair.leftId)] === String(pair.rightId));
    } else if (question.type === 'DRAG_DROP') {
      if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) return { error: `คำตอบ ${questionId} ต้องเป็น Object ลากไปวาง`, code: 'INVALID_ANSWER_SHAPE' };
      const tokens = config.tokens || [], validTokens = new Set(tokens.map(token => String(token.id))), validTargets = new Set((config.targets || []).map(target => String(target.id)));
      answer = raw || {};
      if (Object.keys(answer).some(tokenId => !validTokens.has(tokenId)) || Object.values(answer).some(targetId => typeof targetId !== 'string' || !validTargets.has(targetId))) return { error: `ตำแหน่งของ ${questionId} ไม่ถูกต้อง`, code: 'INVALID_CHOICE' };
      const requiredTokens = tokens.filter(token => token.targetId);
      answered = requiredTokens.length ? requiredTokens.every(token => Object.hasOwn(answer, String(token.id))) : Object.keys(answer).length > 0 || tokens.length > 0;
      correct = answered && tokens.every(token => token.targetId ? answer[String(token.id)] === String(token.targetId) : answer[String(token.id)] == null || answer[String(token.id)] === '');
    } else return { error: `Question Type ของ ${questionId} ไม่รองรับ`, code: 'UNSUPPORTED_QUESTION_TYPE' };
    canonicalAnswers[questionId] = answer;
    if (answered) answeredCount += 1;
    if (correct) correctCount += 1;
    grading.push({ questionId, answered, correct });
  }
  const totalQuestions = questions.length, incorrectCount = answeredCount - correctCount, unansweredCount = totalQuestions - answeredCount;
  const score = correctCount, maxScore = totalQuestions, percentage = maxScore ? Math.round((score / maxScore) * 10000) / 100 : 0;
  return { canonicalAnswers, grading, totalQuestions, answeredCount, correctCount, incorrectCount, unansweredCount, score, maxScore, percentage };
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function resultResponse(row) {
  return {
    sessionId: row.session_id, resultId: row.id, packId: row.pack_id, packVersion: Number(row.pack_version),
    totalQuestions: Number(row.total_questions), answeredCount: Number(row.answered_count), correctCount: Number(row.correct_count),
    incorrectCount: Number(row.incorrect_count), unansweredCount: Number(row.unanswered_count), score: Number(row.score),
    maxScore: Number(row.max_score), percentage: Number(row.percentage), questions: parseJson(row.grading_json, []), submittedAt: row.submitted_at,
  };
}

async function storedResult(env, sessionId) {
  return env.DB.prepare(`SELECT r.id,r.session_id,r.pack_id,r.pack_version,r.submission_hash,r.answers_json,r.grading_json,r.total_questions,r.answered_count,
    r.correct_count,r.incorrect_count,r.unanswered_count,r.score,r.max_score,r.percentage,r.submitted_at,p.name AS pack_name
    FROM assessment_results r JOIN question_packs p ON p.id=r.pack_id WHERE r.session_id=?`).bind(sessionId).first();
}

function correctAnswer(question) {
  const config = question.answerConfig || {};
  if (question.type === 'SINGLE_CHOICE') return (config.correctIds || [])[0] ?? null;
  if (question.type === 'MULTIPLE_CHOICE') return config.correctIds || [];
  if (question.type === 'TRUE_FALSE') return config.correctAnswer;
  if (question.type === 'SHORT_ANSWER') return config.acceptedAnswers || [];
  if (question.type === 'ORDERING') return config.correctOrder || (config.items || []).map(item => item.id);
  if (question.type === 'MATCHING') return Object.fromEntries((config.pairs || []).map(pair => [pair.leftId, pair.rightId]));
  if (question.type === 'DRAG_DROP') return Object.fromEntries((config.tokens || []).map(token => [token.id, token.targetId]));
  return null;
}

function resultDetail(row, snapshot) {
  const answers = parseJson(row.answers_json, {}), grading = new Map(parseJson(row.grading_json, []).map(item => [item.questionId, item]));
  return { ...resultResponse(row), packName: row.pack_name, questions: (snapshot.questions || []).map(question => {
    const questionId = String(question.sourceQuestionId), grade = grading.get(questionId) || {};
    return { questionId, prompt: question.prompt, type: question.type,
      choices: ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'].includes(question.type) ? question.answerConfig?.choices || [] : undefined,
      items: question.type === 'ORDERING' ? question.answerConfig?.items || [] : undefined,
      pairs: question.type === 'MATCHING' ? question.answerConfig?.pairs || [] : undefined,
      targets: question.type === 'DRAG_DROP' ? question.answerConfig?.targets || [] : undefined,
      tokens: question.type === 'DRAG_DROP' ? question.answerConfig?.tokens || [] : undefined,
      submittedAnswer: answers[questionId] ?? null, correctAnswer: correctAnswer(question), answered: !!grade.answered,
      correct: !!grade.correct, explanation: question.explanation || '' };
  }) };
}

export async function handleAssessmentRequest(request, env, helpers) {
  const { json, bad, readBody, id, isAdmin } = helpers, path = new URL(request.url).pathname;
  if (!path.startsWith('/api/admin/assessments')) return null;
  if (!isAdmin(request, env)) return bad('Unauthorized', 401);

  let match = path.match(/^\/api\/admin\/assessments\/question-packs\/([^/]+)\/sessions$/);
  if (match && request.method === 'POST') {
    const packId = safeDecode(match[1]);
    if (!packId || packId.length > 200) return bad('Pack ID ไม่ถูกต้อง');
    const body = await readBody(request, 64 * 1024) || {}, requestedVersion = positiveVersion(body.version);
    if (Number.isNaN(requestedVersion)) return bad('Pack Version ต้องเป็นจำนวนเต็มบวก', 400, { code: 'INVALID_VERSION' });
    const published = await publishedPack(env, packId, requestedVersion);
    if (!published) return bad('ไม่พบ Published Question Pack ที่พร้อมเริ่ม Assessment', 404, { code: 'PUBLISHED_PACK_NOT_FOUND' });
    if (published.error) return bad(published.error, 500, { code: 'INVALID_PACK_SNAPSHOT' });
    const sessionId = id('assessment'), now = new Date().toISOString(), version = Number(published.row.pack_version), latestGuard = requestedVersion == null ? 1 : 0;
    const inserted = await env.DB.prepare(`INSERT INTO assessment_sessions (id,pack_id,pack_version,status,started_at)
      SELECT ?,?,?, 'ACTIVE',? WHERE EXISTS (SELECT 1 FROM question_packs p JOIN question_pack_versions v ON v.pack_id=p.id AND v.version=?
        WHERE p.id=? AND p.status='ACTIVE' AND p.published_version>=v.version AND (?=0 OR p.published_version=?))`)
      .bind(sessionId, packId, version, now, version, packId, latestGuard, version).run();
    if (!inserted.meta?.changes) return bad('สถานะหรือ Version ของ Question Pack เปลี่ยนไปก่อนเริ่ม Session', 409, { code: 'PACK_STATE_CHANGED' });
    return json({ sessionId, packId, packName: published.row.pack_name, packVersion: version, status: 'ACTIVE', startedAt: now, questions: runnerQuestions(published.snapshot) }, 201);
  }

  match = path.match(/^\/api\/admin\/assessments\/sessions\/([^/]+)$/);
  if (match && request.method === 'GET') {
    const sessionId = safeDecode(match[1]);
    if (!sessionId || sessionId.length > 200) return bad('Session ID ไม่ถูกต้อง');
    const row = await env.DB.prepare(`SELECT s.id,s.pack_id,s.pack_version,s.status,s.started_at,p.name AS pack_name,v.snapshot_json
      FROM assessment_sessions s JOIN question_pack_versions v ON v.pack_id=s.pack_id AND v.version=s.pack_version
      JOIN question_packs p ON p.id=s.pack_id WHERE s.id=?`).bind(sessionId).first();
    if (!row) return bad('ไม่พบ Assessment Session', 404, { code: 'SESSION_NOT_FOUND' });
    const snapshot = parseJson(row.snapshot_json, null);
    if (!snapshot || !Array.isArray(snapshot.questions)) return bad('Published Snapshot ของ Session ไม่สมบูรณ์', 500, { code: 'INVALID_PACK_SNAPSHOT' });
    const response = { sessionId, packId: row.pack_id, packName: row.pack_name, packVersion: Number(row.pack_version), status: row.status, startedAt: row.started_at, questions: runnerQuestions(snapshot) };
    if (row.status === 'SUBMITTED') {
      const result = await env.DB.prepare(`SELECT r.*,p.name AS pack_name FROM assessment_results r JOIN question_packs p ON p.id=r.pack_id WHERE r.session_id=?`).bind(sessionId).first();
      if (result) response.result = resultDetail(result, snapshot);
    }
    return json(response);
  }

  match = path.match(/^\/api\/admin\/assessments\/sessions\/([^/]+)\/submit$/);
  if (match && request.method === 'POST') {
    const sessionId = safeDecode(match[1]);
    if (!sessionId || sessionId.length > 200) return bad('Session ID ไม่ถูกต้อง');
    const body = await readBody(request, 512 * 1024) || {};
    const session = await env.DB.prepare('SELECT id,pack_id,pack_version,status FROM assessment_sessions WHERE id=?').bind(sessionId).first();
    if (!session) return bad('ไม่พบ Assessment Session', 404, { code: 'SESSION_NOT_FOUND' });
    const versionRow = await env.DB.prepare('SELECT snapshot_json FROM question_pack_versions WHERE pack_id=? AND version=?').bind(session.pack_id, session.pack_version).first();
    const snapshot = versionRow ? parseJson(versionRow.snapshot_json, null) : null;
    if (!snapshot || !Array.isArray(snapshot.questions)) return bad('Published Snapshot ของ Session ไม่สมบูรณ์', 500, { code: 'INVALID_PACK_SNAPSHOT' });
    const graded = gradeQuestionPackSnapshot(snapshot, body.answers);
    if (graded.error) return bad(graded.error, 422, { code: graded.code });
    const answersJson = JSON.stringify(graded.canonicalAnswers), submissionHash = await sha256(answersJson), existing = await storedResult(env, sessionId);
    if (existing) return existing.submission_hash === submissionHash ? json({ ok: true, idempotentReplay: true, ...resultDetail(existing, snapshot) })
      : bad('Assessment Session ถูก Submit ด้วยคำตอบชุดอื่นไปแล้ว', 409, { code: 'SESSION_ALREADY_SUBMITTED' });
    if (session.status !== 'ACTIVE') return bad('Assessment Session ไม่พร้อมรับคำตอบ', 409, { code: 'SESSION_NOT_ACTIVE' });
    const resultId = id('assessment_result'), now = new Date().toISOString(), gradingJson = JSON.stringify(graded.grading);
    try {
      const writes = await env.DB.batch([
        env.DB.prepare(`INSERT INTO assessment_results
          (id,session_id,pack_id,pack_version,submission_hash,answers_json,grading_json,total_questions,answered_count,correct_count,incorrect_count,unanswered_count,score,max_score,percentage,submitted_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM assessment_sessions WHERE id=? AND status='ACTIVE')`)
          .bind(resultId, sessionId, session.pack_id, Number(session.pack_version), submissionHash, answersJson, gradingJson, graded.totalQuestions,
            graded.answeredCount, graded.correctCount, graded.incorrectCount, graded.unansweredCount, graded.score, graded.maxScore, graded.percentage, now, sessionId),
        env.DB.prepare(`UPDATE assessment_sessions SET status='SUBMITTED',submitted_at=? WHERE id=? AND status='ACTIVE'
          AND EXISTS (SELECT 1 FROM assessment_results WHERE session_id=? AND submission_hash=?)`).bind(now, sessionId, sessionId, submissionHash),
      ]);
      if (writes[0]?.meta?.changes === 1 && writes[1]?.meta?.changes === 1) {
        const created = await env.DB.prepare(`SELECT r.*,p.name AS pack_name FROM assessment_results r JOIN question_packs p ON p.id=r.pack_id WHERE r.id=?`).bind(resultId).first();
        return json({ ok: true, idempotentReplay: false, ...resultDetail(created, snapshot) }, 201);
      }
    } catch (error) { if (!/unique|constraint/i.test(String(error?.message || error))) throw error; }
    const raced = await storedResult(env, sessionId);
    if (raced && raced.submission_hash === submissionHash) return json({ ok: true, idempotentReplay: true, ...resultDetail(raced, snapshot) });
    if (raced) return bad('Assessment Session ถูก Submit ด้วยคำตอบชุดอื่นไปแล้ว', 409, { code: 'SESSION_ALREADY_SUBMITTED' });
    return bad('Session ถูกเปลี่ยนสถานะจากคำขออื่นก่อนบันทึก Result', 409, { code: 'SUBMISSION_CONFLICT' });
  }

  if (path === '/api/admin/assessments/results' && request.method === 'GET') {
    const url = new URL(request.url), limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100)), offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const result = await env.DB.prepare(`SELECT r.id,r.session_id,r.pack_id,p.name AS pack_name,r.pack_version,r.total_questions,r.answered_count,
      r.correct_count,r.incorrect_count,r.unanswered_count,r.score,r.max_score,r.percentage,r.submitted_at
      FROM assessment_results r JOIN question_packs p ON p.id=r.pack_id ORDER BY r.submitted_at DESC LIMIT ? OFFSET ?`).bind(limit, offset).all();
    const total = await env.DB.prepare('SELECT COUNT(*) AS count FROM assessment_results').first();
    return json({ results: result.results || [], total: Number(total?.count || 0), limit, offset });
  }

  match = path.match(/^\/api\/admin\/assessments\/results\/([^/]+)$/);
  if (match && request.method === 'GET') {
    const resultId = safeDecode(match[1]);
    if (!resultId || resultId.length > 200) return bad('Result ID ไม่ถูกต้อง');
    const row = await env.DB.prepare(`SELECT r.*,p.name AS pack_name,v.snapshot_json FROM assessment_results r
      JOIN question_packs p ON p.id=r.pack_id JOIN question_pack_versions v ON v.pack_id=r.pack_id AND v.version=r.pack_version WHERE r.id=?`).bind(resultId).first();
    if (!row) return bad('ไม่พบ Assessment Result', 404);
    const snapshot = parseJson(row.snapshot_json, null);
    if (!snapshot || !Array.isArray(snapshot.questions)) return bad('Published Snapshot ของ Result ไม่สมบูรณ์', 500, { code: 'INVALID_PACK_SNAPSHOT' });
    return json({ result: resultDetail(row, snapshot) });
  }
  return bad('Method not allowed', 405);
}
