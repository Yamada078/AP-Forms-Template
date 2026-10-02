import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

class SqliteD1Statement {
  constructor(owner, sql) { this.owner = owner; this.database = owner.database; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() { return this.database.prepare(this.sql).get(...this.args) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.args) }; }
  async run() {
    if (this.owner.beforeRun) await this.owner.beforeRun(this);
    const result = this.database.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
  }
}

class SqliteD1 {
  constructor(database) { this.database = database; this.batchTail = Promise.resolve(); this.beforeRun = null; }
  prepare(sql) { return new SqliteD1Statement(this, sql); }
  async batch(statements) {
    const execute = async () => {
      this.database.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        this.database.exec('COMMIT');
        return results;
      } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    };
    const current = this.batchTail.then(execute, execute);
    this.batchTail = current.catch(() => {});
    return current;
  }
}

async function migratedDatabase() {
  const paths = ['schema.sql', 'migrations/0001_publish_system.sql', 'migrations/0003_integration_foundation.sql', 'migrations/0004_application_form_access.sql', 'migrations/0005_question_bank_foundation.sql', 'migrations/0006_question_pack_foundation.sql', 'migrations/0007_assessment_runtime_results.sql'];
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const source of await Promise.all(paths.map(read))) database.exec(source);
  return database;
}

async function call(env, path, { method = 'GET', admin = false, body } = {}) {
  const headers = new Headers();
  if (admin) headers.set('authorization', `Bearer ${env.TEAM_KEY}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const response = await worker.fetch(new Request(`https://forms.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { response, data: await response.json() };
}

function snapshot(packId, version, singleCorrect = 's_a') {
  return {
    schemaVersion: 1, packId, packName: 'ชุดประเมินภายใน', version,
    questions: [
      { order: 1, sourceQuestionId: 'q_single', type: 'SINGLE_CHOICE', prompt: 'เลือก A', description: '', difficulty: 1, answerConfig: { choices: [{ id: 's_a', text: 'A' }, { id: 's_b', text: 'B' }], correctIds: [singleCorrect] }, explanation: 'คำอธิบาย', internalNotes: 'ห้ามส่ง', tags: [] },
      { order: 2, sourceQuestionId: 'q_multi', type: 'MULTIPLE_CHOICE', prompt: 'เลือก A และ C', description: '', difficulty: 2, answerConfig: { choices: [{ id: 'm_a', text: 'A' }, { id: 'm_b', text: 'B' }, { id: 'm_c', text: 'C' }], correctIds: ['m_a', 'm_c'] }, tags: [] },
      { order: 3, sourceQuestionId: 'q_true', type: 'TRUE_FALSE', prompt: 'จริงหรือไม่', description: '', difficulty: 1, answerConfig: { correctAnswer: true }, tags: [] },
      { order: 4, sourceQuestionId: 'q_short', type: 'SHORT_ANSWER', prompt: 'ตอบ Café', description: '', difficulty: 3, answerConfig: { acceptedAnswers: ['Café'], caseSensitive: false, trimWhitespace: true, normalizeUnicode: true }, tags: [] },
    ],
  };
}

function seedPacks(database) {
  const now = '2026-08-24T00:00:00.000Z';
  database.prepare("INSERT INTO question_packs (id,name,description,status,published_version,published_at,created_at,updated_at) VALUES ('pack_internal','ชุดประเมินภายใน','', 'ACTIVE',1,?,?,?)").run(now, now, now);
  database.prepare('INSERT INTO question_pack_versions (pack_id,version,snapshot_json,question_count,published_at) VALUES (?,?,?,?,?)').run('pack_internal', 1, JSON.stringify(snapshot('pack_internal', 1)), 4, now);
  database.prepare("INSERT INTO question_packs (id,name,description,status,published_version,created_at,updated_at) VALUES ('pack_draft','ยังไม่เผยแพร่','', 'ACTIVE',0,?,?)").run(now, now);
}

const fullAnswers = { q_single: 's_a', q_multi: ['m_c', 'm_a', 'm_a'], q_true: true, q_short: '  CAFE\u0301  ' };

test('assessment migration contains only internal sessions and results', async () => {
  const database = await migratedDatabase();
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  assert.ok(tables.includes('assessment_sessions'));
  assert.ok(tables.includes('assessment_results'));
  assert.equal(tables.includes('application_question_pack_access'), false);
  const sessionColumns = database.prepare('PRAGMA table_info(assessment_sessions)').all().map(row => row.name);
  for (const removed of ['application_id', 'credential_id', 'source_session', 'source_platform']) assert.equal(sessionColumns.includes(removed), false);
  database.close();
});

test('internal runner pins snapshot, grades four types, persists result, and exposes history', async () => {
  const database = await migratedDatabase(); seedPacks(database);
  const env = { DB: new SqliteD1(database), TEAM_KEY: 'assessment-team-key' };
  assert.equal((await call(env, '/api/admin/assessments/results')).response.status, 401);
  assert.equal((await call(env, '/api/integrations/question-packs/pack_internal/content')).response.status, 404);
  assert.equal((await call(env, '/api/integrations/assessment-sessions/example/submit', { method: 'POST', body: { answers: {} } })).response.status, 404);
  assert.equal((await call(env, '/api/admin/assessments/question-packs/pack_draft/sessions', { method: 'POST', admin: true, body: {} })).response.status, 404);

  const started = await call(env, '/api/admin/assessments/question-packs/pack_internal/sessions', { method: 'POST', admin: true, body: {} });
  assert.equal(started.response.status, 201, JSON.stringify(started.data));
  assert.equal(started.data.packVersion, 1);
  assert.deepEqual(started.data.questions.map(question => question.type), ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER']);
  const startJson = JSON.stringify(started.data);
  for (const secret of ['correctIds', 'correctAnswer', 'acceptedAnswers', 'internalNotes']) assert.equal(startJson.includes(secret), false);

  database.prepare('INSERT INTO question_pack_versions (pack_id,version,snapshot_json,question_count,published_at) VALUES (?,?,?,?,?)').run('pack_internal', 2, JSON.stringify(snapshot('pack_internal', 2, 's_b')), 4, '2026-08-24T01:00:00.000Z');
  database.prepare('UPDATE question_packs SET published_version=2,published_at=? WHERE id=?').run('2026-08-24T01:00:00.000Z', 'pack_internal');
  const submitted = await call(env, `/api/admin/assessments/sessions/${started.data.sessionId}/submit`, { method: 'POST', admin: true, body: { answers: fullAnswers, score: 999, packVersion: 999 } });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.data));
  assert.deepEqual({ version: submitted.data.packVersion, correct: submitted.data.correctCount, score: submitted.data.score, percentage: submitted.data.percentage }, { version: 1, correct: 4, score: 4, percentage: 100 });
  const persisted = database.prepare('SELECT pack_id,pack_version,score,correct_count FROM assessment_results WHERE session_id=?').get(started.data.sessionId);
  assert.deepEqual({ pack: persisted.pack_id, version: persisted.pack_version, score: persisted.score, correct: persisted.correct_count }, { pack: 'pack_internal', version: 1, score: 4, correct: 4 });

  const partial = await call(env, '/api/admin/assessments/question-packs/pack_internal/sessions', { method: 'POST', admin: true, body: { version: 1 } });
  const partialResult = await call(env, `/api/admin/assessments/sessions/${partial.data.sessionId}/submit`, { method: 'POST', admin: true, body: { answers: { q_single: 's_a', q_multi: ['m_a'], q_true: false, q_short: 'wrong' } } });
  assert.equal(partialResult.data.correctCount, 1);
  assert.equal(partialResult.data.incorrectCount, 3);
  const invalid = await call(env, '/api/admin/assessments/question-packs/pack_internal/sessions', { method: 'POST', admin: true, body: { version: 1 } });
  assert.equal((await call(env, `/api/admin/assessments/sessions/${invalid.data.sessionId}/submit`, { method: 'POST', admin: true, body: { answers: { unknown: 'x' } } })).response.status, 422);

  const beforeArchive = await call(env, '/api/admin/assessments/question-packs/pack_internal/sessions', { method: 'POST', admin: true, body: { version: 1 } });
  database.prepare("UPDATE question_packs SET status='ARCHIVED' WHERE id='pack_internal'").run();
  assert.equal((await call(env, '/api/admin/assessments/question-packs/pack_internal/sessions', { method: 'POST', admin: true, body: {} })).response.status, 404);
  assert.equal((await call(env, `/api/admin/assessments/sessions/${beforeArchive.data.sessionId}/submit`, { method: 'POST', admin: true, body: { answers: fullAnswers } })).response.status, 201);

  const list = await call(env, '/api/admin/assessments/results', { admin: true });
  assert.ok(list.data.results.length >= 3);
  const detail = await call(env, `/api/admin/assessments/results/${submitted.data.resultId}`, { admin: true });
  assert.equal(detail.data.result.packName, 'ชุดประเมินภายใน');
  assert.equal(detail.data.result.questions[0].prompt, 'เลือก A');
  assert.equal(detail.data.result.questions[0].correct, true);
  database.close();
});

test('start conflict leaves no session and submit is atomic and idempotent', async () => {
  const database = await migratedDatabase(); seedPacks(database);
  const d1 = new SqliteD1(database), env = { DB: d1, TEAM_KEY: 'assessment-team-key' };
  let intercepted = false;
  d1.beforeRun = async statement => {
    if (!intercepted && statement.sql.startsWith('INSERT INTO assessment_sessions')) {
      intercepted = true;
      database.prepare("UPDATE question_packs SET status='ARCHIVED' WHERE id='pack_internal'").run();
    }
  };
  const stale = await call(env, '/api/admin/assessments/question-packs/pack_internal/sessions', { method: 'POST', admin: true, body: {} });
  assert.equal(stale.response.status, 409);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM assessment_sessions').get().count, 0);
  database.prepare("UPDATE question_packs SET status='ACTIVE' WHERE id='pack_internal'").run();
  d1.beforeRun = null;

  const started = await call(env, '/api/admin/assessments/question-packs/pack_internal/sessions', { method: 'POST', admin: true, body: {} });
  const path = `/api/admin/assessments/sessions/${started.data.sessionId}/submit`;
  const [first, second] = await Promise.all([
    call(env, path, { method: 'POST', admin: true, body: { answers: fullAnswers } }),
    call(env, path, { method: 'POST', admin: true, body: { answers: fullAnswers } }),
  ]);
  assert.deepEqual([first.response.status, second.response.status].sort(), [200, 201]);
  assert.equal(first.data.resultId, second.data.resultId);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM assessment_results WHERE session_id=?').get(started.data.sessionId).count, 1);
  const session = database.prepare('SELECT status,submitted_at FROM assessment_sessions WHERE id=?').get(started.data.sessionId);
  assert.equal(session.status, 'SUBMITTED'); assert.ok(session.submitted_at);
  const retry = await call(env, path, { method: 'POST', admin: true, body: { answers: fullAnswers } });
  assert.equal(retry.response.status, 200); assert.equal(retry.data.idempotentReplay, true);
  assert.equal((await call(env, path, { method: 'POST', admin: true, body: { answers: { ...fullAnswers, q_single: 's_b' } } })).response.status, 409);
  database.close();
});

test('assessment runner grades ordering, matching, and drag-drop from immutable snapshots', async () => {
  const database = await migratedDatabase(), now = '2026-08-27T00:00:00.000Z';
  const activitySnapshot = {
    schemaVersion: 2, packId: 'pack_activities', packName: 'กิจกรรม', version: 1,
    questions: [
      { order: 1, sourceQuestionId: 'q_order', type: 'ORDERING', prompt: 'เรียง', difficulty: 2, answerConfig: { items: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctOrder: ['a', 'b'] }, tags: [] },
      { order: 2, sourceQuestionId: 'q_match', type: 'MATCHING', prompt: 'จับคู่', difficulty: 2, answerConfig: { pairs: [{ id: 'p1', leftId: 'l1', rightId: 'r1', leftText: 'A', rightText: '1' }, { id: 'p2', leftId: 'l2', rightId: 'r2', leftText: 'B', rightText: '2' }], rightDistractors: [{ id: 'fake', rightId: 'rf', rightText: 'X' }], rightOrder: ['rf', 'r2', 'r1'] }, tags: [] },
      { order: 3, sourceQuestionId: 'q_drag', type: 'DRAG_DROP', prompt: 'ลาก', difficulty: 2, answerConfig: { targets: [{ id: 't1', label: 'หนึ่ง' }, { id: 't2', label: 'สอง' }], tokens: [{ id: 'd1', text: 'A', targetId: 't1' }, { id: 'd2', text: 'B', targetId: 't2' }, { id: 'd3', text: 'X', targetId: '' }] }, tags: [] },
    ],
  };
  database.prepare("INSERT INTO question_packs (id,name,description,status,published_version,published_at,created_at,updated_at) VALUES ('pack_activities','กิจกรรม','', 'ACTIVE',1,?,?,?)").run(now, now, now);
  database.prepare('INSERT INTO question_pack_versions (pack_id,version,snapshot_json,question_count,published_at) VALUES (?,?,?,?,?)').run('pack_activities', 1, JSON.stringify(activitySnapshot), 3, now);
  const env = { DB: new SqliteD1(database), TEAM_KEY: 'assessment-activity-key' };
  const started = await call(env, '/api/admin/assessments/question-packs/pack_activities/sessions', { method: 'POST', admin: true, body: {} });
  assert.equal(started.response.status, 201, JSON.stringify(started.data));
  assert.deepEqual(started.data.questions.map(question => question.type), ['ORDERING', 'MATCHING', 'DRAG_DROP']);
  assert.equal(JSON.stringify(started.data).includes('targetId'), false);
  assert.deepEqual(started.data.questions[1].rightItems.map(item => item.id), ['rf', 'r2', 'r1']);
  assert.equal(started.data.questions[1].requiredAnswerCount, 2);
  assert.equal(started.data.questions[2].requiredAnswerCount, 2);
  const submitted = await call(env, `/api/admin/assessments/sessions/${started.data.sessionId}/submit`, { method: 'POST', admin: true, body: { answers: {
    q_order: ['a', 'b'], q_match: { l1: 'r1', l2: 'r2' }, q_drag: { d1: 't1', d2: 't2' },
  } } });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.data));
  assert.equal(submitted.data.correctCount, 3);
  assert.equal(submitted.data.percentage, 100);
  const second = await call(env, '/api/admin/assessments/question-packs/pack_activities/sessions', { method: 'POST', admin: true, body: {} });
  const distracted = await call(env, `/api/admin/assessments/sessions/${second.data.sessionId}/submit`, { method: 'POST', admin: true, body: { answers: {
    q_order: ['a', 'b'], q_match: { l1: 'rf', l2: 'r2' }, q_drag: { d1: 't1', d2: 't2', d3: 't1' },
  } } });
  assert.equal(distracted.response.status, 201, JSON.stringify(distracted.data));
  assert.equal(distracted.data.correctCount, 1, 'matching and drag distractors must grade as incorrect when selected');
  database.close();
});
