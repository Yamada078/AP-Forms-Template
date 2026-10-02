import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

class Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() { return this.database.prepare(this.sql).get(...this.args) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.args) }; }
  async run() { const result = this.database.prepare(this.sql).run(...this.args); return { meta: { changes: Number(result.changes || 0) } }; }
}
class D1 {
  constructor(database) { this.database = database; this.batchSizes = []; }
  prepare(sql) { return new Statement(this.database, sql); }
  async batch(statements) {
    this.batchSizes.push(statements.length);
    this.database.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.exec('COMMIT'); return results; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
}
async function environment() {
  const paths = ['schema.sql', 'migrations/0001_publish_system.sql', 'migrations/0003_integration_foundation.sql', 'migrations/0004_application_form_access.sql', 'migrations/0005_question_bank_foundation.sql', 'migrations/0006_question_pack_foundation.sql', 'migrations/0008_question_activity_media.sql'];
  const database = new DatabaseSync(':memory:'); database.exec('PRAGMA foreign_keys=ON');
  for (const source of await Promise.all(paths.map(read))) database.exec(source);
  const mediaPath = '/assets/question-media/versioned/example.123456789abc.png';
  return { database, mediaPath, env: { DB: new D1(database), TEAM_KEY: 'package-key', ASSETS: { fetch: async () => new Response(JSON.stringify({ assets: [{ name: 'example.png', path: mediaPath }] }), { headers: { 'content-type': 'application/json' } }) } } };
}
async function call(env, path, { method = 'GET', body, admin = true } = {}) {
  const headers = new Headers(); if (admin) headers.set('authorization', `Bearer ${env.TEAM_KEY}`); if (body !== undefined) headers.set('content-type', 'application/json');
  const response = await worker.fetch(new Request(`https://forms.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { response, data: await response.json() };
}

test('package preview rejects invalid data without writing D1', async () => {
  const { database, env } = await environment();
  const denied = await call(env, '/api/admin/question-bank-packages/preview', { method: 'POST', admin: false, body: { package: {} } });
  assert.equal(denied.response.status, 401);
  const invalid = await call(env, '/api/admin/question-bank-packages/preview', { method: 'POST', body: { package: { kind: 'wrong', schemaVersion: 99, bank: {}, tags: 'bad', questions: 'bad' } } });
  assert.equal(invalid.response.status, 422);
  assert.equal(invalid.data.preview.valid, false);
  assert.ok(invalid.data.preview.errors.length >= 4);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM question_banks').get().count, 0);
  database.close();
});

test('template uses one import pipeline for all seven types, media-only choices, tags, packs, export and duplicate safety', async () => {
  const { database, env, mediaPath } = await environment();
  const packageData = JSON.parse(await read('public/question-bank-templates/starter-7-types.json'));
  packageData.bank.name = 'Imported Seven Types';
  packageData.questions[0].answerConfig.choices = [
    { id: 'image_a', text: '', media: { path: mediaPath, alt: 'ตัวเลือก ก' } },
    { id: 'image_b', text: '', media: { path: mediaPath, alt: 'ตัวเลือก ข' } },
  ];
  packageData.questions[0].answerConfig.correctIds = ['image_b'];

  const preview = await call(env, '/api/admin/question-bank-packages/preview', { method: 'POST', body: { package: packageData } });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.data));
  assert.equal(preview.data.preview.summary.questionsTotal, 7);
  assert.equal(preview.data.preview.summary.ready, 7);
  assert.equal(preview.data.preview.summary.draft, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM question_banks').get().count, 0, 'preview must not write');

  const imported = await call(env, '/api/admin/question-bank-packages/import', { method: 'POST', body: { package: packageData, duplicateMode: 'import' } });
  assert.equal(imported.response.status, 201, JSON.stringify(imported.data));
  assert.equal(imported.data.importedQuestions, 7);
  assert.equal(imported.data.ready, 7);
  const bankId = imported.data.bankId;
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM question_tags WHERE bank_id=?').get(bankId).count, 2);
  assert.equal(database.prepare('SELECT COUNT(DISTINCT COALESCE(activity_type,type)) AS count FROM bank_questions WHERE bank_id=?').get(bankId).count, 7);
  const mediaOnly = database.prepare("SELECT status,answer_config FROM bank_questions WHERE bank_id=? AND prompt='ข้อใดเป็นจำนวนคู่'").get(bankId);
  assert.equal(mediaOnly.status, 'READY');
  assert.equal(JSON.parse(mediaOnly.answer_config).choices[0].media.path, mediaPath);

  const questionId = database.prepare("SELECT id FROM bank_questions WHERE bank_id=? AND status='READY' LIMIT 1").get(bankId).id;
  const pack = await call(env, '/api/admin/question-packs', { method: 'POST', body: { name: 'Imported Question Pack' } });
  const added = await call(env, `/api/admin/question-packs/${pack.data.pack.id}/items`, { method: 'POST', body: { kind: 'MANUAL', questionIds: [questionId] } });
  assert.equal(added.response.status, 201, JSON.stringify(added.data));

  const exported = await call(env, `/api/admin/question-banks/${bankId}/export`);
  assert.equal(exported.response.status, 200);
  assert.equal(exported.data.kind, 'goi.question-bank.package');
  assert.equal(exported.data.questions.length, 7);
  assert.equal(JSON.stringify(exported.data).includes(bankId), false);
  assert.equal(JSON.stringify(exported.data).includes(env.TEAM_KEY), false);

  const duplicatePreview = await call(env, '/api/admin/question-bank-packages/preview', { method: 'POST', body: { package: exported.data, targetBankId: bankId } });
  assert.equal(duplicatePreview.data.preview.summary.duplicates, 7);
  const undecided = await call(env, '/api/admin/question-bank-packages/import', { method: 'POST', body: { package: exported.data, targetBankId: bankId } });
  assert.equal(undecided.response.status, 409);
  const skipped = await call(env, '/api/admin/question-bank-packages/import', { method: 'POST', body: { package: exported.data, targetBankId: bankId, duplicateMode: 'skip' } });
  assert.equal(skipped.response.status, 201);
  assert.equal(skipped.data.importedQuestions, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM bank_questions WHERE bank_id=?').get(bankId).count, 7);

  const addToExisting = structuredClone(exported.data);
  const questionWithBothTags = addToExisting.questions.find(question => question.prompt === 'ข้อใดเป็นจำนวนคู่');
  assert.equal(questionWithBothTags.tags.length, 2, 'the selected question must exercise both existing tags');
  addToExisting.questions = [{ ...questionWithBothTags, prompt: 'คำถามใหม่ที่ไม่ซ้ำในคลังเดิม' }];
  const reused = await call(env, '/api/admin/question-bank-packages/import', { method: 'POST', body: { package: addToExisting, targetBankId: bankId, duplicateMode: 'import' } });
  assert.equal(reused.response.status, 201, JSON.stringify(reused.data));
  assert.equal(reused.data.importedQuestions, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM question_tags WHERE bank_id=?').get(bankId).count, 2, 'existing group + name tags must be reused');
  const reusedQuestion = database.prepare("SELECT id FROM bank_questions WHERE bank_id=? AND prompt='คำถามใหม่ที่ไม่ซ้ำในคลังเดิม'").get(bankId);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM question_tag_links WHERE question_id=?').get(reusedQuestion.id).count, 2);

  exported.data.bank.name = 'Round Trip Copy';
  const roundTrip = await call(env, '/api/admin/question-bank-packages/import', { method: 'POST', body: { package: exported.data, duplicateMode: 'import' } });
  assert.equal(roundTrip.response.status, 201, JSON.stringify(roundTrip.data));
  assert.equal(roundTrip.data.importedQuestions, 7);
  database.close();
});

test('missing and remote media are warnings and are never fetched', async () => {
  const { database, env } = await environment(); let assetFetches = 0;
  env.ASSETS.fetch = async () => { assetFetches++; return new Response(JSON.stringify({ assets: [] })); };
  const packageData = { kind: 'goi.question-bank.package', schemaVersion: 1, bank: { name: 'Media warnings' }, tags: [], questions: [{ type: 'SINGLE_CHOICE', prompt: 'รูปใดถูก', answerConfig: { choices: [{ id: 'a', text: 'ก', media: { path: '/assets/question-media/versioned/missing.123456789abc.png' } }, { id: 'b', text: 'ข', media: { path: 'https://example.com/image.png' } }], correctIds: ['a'] } }] };
  const preview = await call(env, '/api/admin/question-bank-packages/preview', { method: 'POST', body: { package: packageData } });
  assert.equal(preview.response.status, 200);
  assert.ok(preview.data.preview.warnings.some(message => message.includes('ไม่พบใน Static Media')));
  assert.ok(preview.data.preview.warnings.some(message => message.includes('ไม่รองรับ')));
  assert.equal(assetFetches, 1, 'only the local manifest may be fetched');
  database.close();
});

test('large package stays below the Workers Free D1 query limit', async () => {
  const { database, env } = await environment();
  const tags = Array.from({ length: 5 }, (_, index) => ({ key: `tag_${index}`, name: `แท็ก ${index}`, group: 'ทดสอบจำนวนมาก' }));
  const questions = Array.from({ length: 300 }, (_, index) => ({
    id: `bulk_${index}`,
    type: 'SINGLE_CHOICE',
    prompt: `คำถามจำนวนมากข้อ ${index + 1}`,
    difficulty: (index % 5) + 1,
    answerConfig: { choices: [{ id: 'a', text: 'ก' }, { id: 'b', text: 'ข' }], correctIds: ['a'] },
    tags: tags.map(tag => tag.key),
  }));
  const packageData = { kind: 'goi.question-bank.package', schemaVersion: 1, bank: { name: 'Large Free Tier Import' }, tags, questions };
  const imported = await call(env, '/api/admin/question-bank-packages/import', { method: 'POST', body: { package: packageData, duplicateMode: 'import' } });
  assert.equal(imported.response.status, 201, JSON.stringify(imported.data));
  assert.equal(imported.data.importedQuestions, 300);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM bank_questions WHERE bank_id=?').get(imported.data.bankId).count, 300);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM question_tag_links WHERE question_id IN (SELECT id FROM bank_questions WHERE bank_id=?)').get(imported.data.bankId).count, 1500);
  assert.ok(env.DB.batchSizes.at(-1) < 50, `expected fewer than 50 D1 statements, received ${env.DB.batchSizes.at(-1)}`);
  database.close();
});
