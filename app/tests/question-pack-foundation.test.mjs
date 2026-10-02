import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { consumerPackProjection } from '../src/question-packs.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

class SqliteD1Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() { return this.database.prepare(this.sql).get(...this.args) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.args) }; }
  async run() { const result = this.database.prepare(this.sql).run(...this.args); return { meta: { changes: Number(result.changes || 0) } }; }
}

class SqliteD1 {
  constructor(database) { this.database = database; this.beforeBatch = null; }
  prepare(sql) { return new SqliteD1Statement(this.database, sql); }
  async batch(statements) {
    if (this.beforeBatch) {
      const hook = this.beforeBatch;
      this.beforeBatch = null;
      await hook();
    }
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
}

async function migratedDatabase() {
  const paths = ['schema.sql', 'migrations/0001_publish_system.sql', 'migrations/0003_integration_foundation.sql', 'migrations/0004_application_form_access.sql', 'migrations/0005_question_bank_foundation.sql', 'migrations/0006_question_pack_foundation.sql', 'migrations/0008_question_activity_media.sql'];
  const sql = await Promise.all(paths.map(read));
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  for (const source of sql) database.exec(source);
  return database;
}

async function call(env, path, { method = 'GET', admin = true, body } = {}) {
  const headers = new Headers();
  if (admin) headers.set('authorization', `Bearer ${env.TEAM_KEY}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const response = await worker.fetch(new Request(`https://forms.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { response, data: await response.json() };
}

async function createReadyQuestion(env, bankId, { prompt, difficulty, tagIds, type = 'SINGLE_CHOICE' }) {
  const draft = await call(env, `/api/admin/question-banks/${bankId}/questions`, { method: 'POST', body: { type } });
  const choices = [{ id: `${draft.data.question.id}_a`, text: 'ก' }, { id: `${draft.data.question.id}_b`, text: 'ข' }];
  const answerConfig = type === 'TRUE_FALSE' ? { correctAnswer: true } : type === 'SHORT_ANSWER' ? { acceptedAnswers: ['คำตอบ'], caseSensitive: false, trimWhitespace: true, normalizeUnicode: true } : { choices, correctIds: [choices[0].id] };
  const updated = await call(env, `/api/admin/question-banks/${bankId}/questions/${draft.data.question.id}`, { method: 'PATCH', body: { prompt, difficulty, type, status: 'READY', answerConfig, tagIds, explanation: 'คำอธิบาย', internalNotes: 'ห้ามเข้า Snapshot', sourceReference: 'ครูสร้าง', baseUpdatedAt: draft.data.question.updatedAt } });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.data));
  return updated.data.question;
}

test('question pack migration is additive and separates editable composition from immutable versions', async () => {
  const database = await migratedDatabase();
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  for (const table of ['question_banks', 'bank_questions', 'question_packs', 'question_pack_items', 'question_pack_versions']) assert.ok(tables.includes(table));
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='forms'").get().count, 1);
  database.close();
});

test('pool combines multiple included tags with explicit ANY or ALL semantics', async () => {
  const database = await migratedDatabase(), env = { DB: new SqliteD1(database), TEAM_KEY: 'pack-tag-key' };
  const bank = (await call(env, '/api/admin/question-banks', { method: 'POST', body: { name: 'คลังหลายแท็ก' } })).data.bank;
  const tagA = (await call(env, `/api/admin/question-banks/${bank.id}/tags`, { method: 'POST', body: { name: 'พื้นฐาน', groupName: 'ระดับ' } })).data.tag;
  const tagB = (await call(env, `/api/admin/question-banks/${bank.id}/tags`, { method: 'POST', body: { name: 'ตัวอย่าง', groupName: 'แหล่งที่มา' } })).data.tag;
  const onlyA = await createReadyQuestion(env, bank.id, { prompt: 'มีแท็ก A', difficulty: 2, tagIds: [tagA.id] });
  const onlyB = await createReadyQuestion(env, bank.id, { prompt: 'มีแท็ก B', difficulty: 2, tagIds: [tagB.id] });
  const both = await createReadyQuestion(env, bank.id, { prompt: 'มีทั้ง A และ B', difficulty: 2, tagIds: [tagA.id, tagB.id] });
  const pack = (await call(env, '/api/admin/question-packs', { method: 'POST', body: { name: 'ชุดรวมแท็ก' } })).data.pack;
  const added = await call(env, `/api/admin/question-packs/${pack.id}/items`, { method: 'POST', body: { kind: 'POOL', config: { bankId: bank.id, includeTagIds: [tagA.id, tagB.id], pickCount: 3 } } });
  assert.equal(added.response.status, 201, JSON.stringify(added.data));
  assert.equal(added.data.item.config.includeTagMode, 'ANY');
  const anyPreview = (await call(env, `/api/admin/question-packs/${pack.id}/preview`, { method: 'POST', body: {} })).data.preview;
  assert.equal(anyPreview.valid, true);
  assert.equal(anyPreview.items[0].candidateCount, 3);
  assert.deepEqual(new Set(anyPreview.questions.map(question => question.sourceQuestionId)), new Set([onlyA.id, onlyB.id, both.id]));

  const allConfig = { ...added.data.item.config, includeTagMode: 'ALL', pickCount: 1 };
  await call(env, `/api/admin/question-packs/${pack.id}/items/${added.data.item.id}`, { method: 'PATCH', body: { config: allConfig } });
  const allPreview = (await call(env, `/api/admin/question-packs/${pack.id}/preview`, { method: 'POST', body: {} })).data.preview;
  assert.equal(allPreview.valid, true);
  assert.equal(allPreview.items[0].candidateCount, 1);
  assert.equal(allPreview.questions[0].sourceQuestionId, both.id);
  database.close();
});

test('packs resolve manual and pool content, block invalid drafts, and persist immutable V1/V2 snapshots', async () => {
  const database = await migratedDatabase(), env = { DB: new SqliteD1(database), TEAM_KEY: 'pack-team-key' };
  assert.equal((await call(env, '/api/admin/question-packs', { admin: false })).response.status, 401);

  const bankResult = await call(env, '/api/admin/question-banks', { method: 'POST', body: { name: 'คลัง N5' } });
  const bankId = bankResult.data.bank.id;
  const vocabulary = (await call(env, `/api/admin/question-banks/${bankId}/tags`, { method: 'POST', body: { name: 'คำศัพท์', groupName: 'ประเภท' } })).data.tag;
  const deprecated = (await call(env, `/api/admin/question-banks/${bankId}/tags`, { method: 'POST', body: { name: 'เลิกใช้', groupName: 'สถานะ' } })).data.tag;
  const manual = await createReadyQuestion(env, bankId, { prompt: 'คำถามคงที่เดิม', difficulty: 2, tagIds: [vocabulary.id] });
  const poolA = await createReadyQuestion(env, bankId, { prompt: 'คำศัพท์ A', difficulty: 2, tagIds: [vocabulary.id] });
  const poolB = await createReadyQuestion(env, bankId, { prompt: 'คำศัพท์ B', difficulty: 3, tagIds: [vocabulary.id] });
  await createReadyQuestion(env, bankId, { prompt: 'คำศัพท์ที่เลิกใช้', difficulty: 2, tagIds: [vocabulary.id, deprecated.id] });
  await createReadyQuestion(env, bankId, { prompt: 'ยากเกินช่วง', difficulty: 5, tagIds: [vocabulary.id] });
  const draftQuestion = (await call(env, `/api/admin/question-banks/${bankId}/questions`, { method: 'POST', body: { type: 'TRUE_FALSE' } })).data.question;

  const pack = (await call(env, '/api/admin/question-packs', { method: 'POST', body: { name: 'แบบทดสอบ N5', description: 'Manual + Pool' } })).data.pack;
  const addDraft = await call(env, `/api/admin/question-packs/${pack.id}/items`, { method: 'POST', body: { kind: 'MANUAL', questionId: draftQuestion.id } });
  assert.equal(addDraft.response.status, 409);
  const manualItem = await call(env, `/api/admin/question-packs/${pack.id}/items`, { method: 'POST', body: { kind: 'MANUAL', questionId: manual.id } });
  assert.equal(manualItem.response.status, 201);
  const poolItem = await call(env, `/api/admin/question-packs/${pack.id}/items`, { method: 'POST', body: { kind: 'POOL', config: { name: 'พูลคำศัพท์', bankId, difficultyMin: 2, difficultyMax: 3, includeTagIds: [vocabulary.id], excludeTagIds: [deprecated.id], pickCount: 2 } } });
  assert.equal(poolItem.response.status, 201, JSON.stringify(poolItem.data));

  const preview = await call(env, `/api/admin/question-packs/${pack.id}/preview`, { method: 'POST', body: {} });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.data.preview.valid, true);
  assert.equal(preview.data.preview.resolvedQuestionCount, 3);
  assert.equal(new Set(preview.data.preview.questions.map(question => question.sourceQuestionId)).size, 3);
  assert.deepEqual(new Set(preview.data.preview.questions.slice(1).map(question => question.sourceQuestionId)), new Set([poolA.id, poolB.id]));
  assert.equal(JSON.stringify(preview.data).includes('correctIds'), false);

  const tooMany = await call(env, `/api/admin/question-packs/${pack.id}/items/${poolItem.data.item.id}`, { method: 'PATCH', body: { config: { ...poolItem.data.item.config, pickCount: 3 } } });
  assert.equal(tooMany.response.status, 200);
  const blockedPreview = await call(env, `/api/admin/question-packs/${pack.id}/preview`, { method: 'POST', body: {} });
  assert.equal(blockedPreview.data.preview.valid, false);
  assert.match(blockedPreview.data.preview.errors.join(' '), /ไม่เพียงพอ/);
  const blockedPublish = await call(env, `/api/admin/question-packs/${pack.id}/publish`, { method: 'POST', body: {} });
  assert.equal(blockedPublish.response.status, 422);
  await call(env, `/api/admin/question-packs/${pack.id}/items/${poolItem.data.item.id}`, { method: 'PATCH', body: { config: poolItem.data.item.config } });

  const publishedV1 = await call(env, `/api/admin/question-packs/${pack.id}/publish`, { method: 'POST', body: {} });
  assert.equal(publishedV1.response.status, 201, JSON.stringify(publishedV1.data));
  assert.equal(publishedV1.data.publication.version, 1);
  assert.equal(publishedV1.data.publication.questionCount, 3);
  const v1 = await call(env, `/api/admin/question-packs/${pack.id}/versions/1`);
  assert.equal(v1.data.version.snapshot.questions[0].prompt, 'คำถามคงที่เดิม');
  assert.equal(JSON.stringify(v1.data.version.snapshot).includes('ห้ามเข้า Snapshot'), false);
  assert.ok(v1.data.version.snapshot.questions[0].answerConfig.correctIds.length === 1);

  const currentManual = await call(env, `/api/admin/question-banks/${bankId}/questions/${manual.id}`);
  const changed = await call(env, `/api/admin/question-banks/${bankId}/questions/${manual.id}`, { method: 'PATCH', body: { prompt: 'คำถามคงที่แก้ใหม่', status: 'READY', baseUpdatedAt: currentManual.data.question.updatedAt } });
  assert.equal(changed.response.status, 200);
  const v1AfterEdit = await call(env, `/api/admin/question-packs/${pack.id}/versions/1`);
  assert.equal(v1AfterEdit.data.version.snapshot.questions[0].prompt, 'คำถามคงที่เดิม');
  const publishedV2 = await call(env, `/api/admin/question-packs/${pack.id}/publish`, { method: 'POST', body: {} });
  assert.equal(publishedV2.data.publication.version, 2);
  const v2 = await call(env, `/api/admin/question-packs/${pack.id}/versions/2`);
  assert.equal(v2.data.version.snapshot.questions[0].prompt, 'คำถามคงที่แก้ใหม่');

  const archived = await call(env, `/api/admin/question-packs/${pack.id}`, { method: 'PATCH', body: { status: 'ARCHIVED' } });
  assert.equal(archived.response.status, 200);
  assert.equal((await call(env, `/api/admin/question-packs/${pack.id}/items`, { method: 'POST', body: { kind: 'MANUAL', questionId: poolA.id } })).response.status, 409);
  const deletePublished = await call(env, `/api/admin/question-packs/${pack.id}`, { method: 'DELETE', body: { confirmName: 'แบบทดสอบ N5' } });
  assert.equal(deletePublished.response.status, 409);
  assert.equal(deletePublished.data.code, 'PACK_HAS_PUBLISHED_VERSIONS');
  database.close();
});

test('consumer pack projection removes every trusted answer key field', () => {
  const trusted = { schemaVersion: 1, packId: 'pack_1', packName: 'Pack', version: 1, questions: [{ order: 1, sourceQuestionId: 'q1', type: 'SHORT_ANSWER', prompt: 'ตอบ', description: '', difficulty: 2, answerConfig: { acceptedAnswers: ['ลับ'], caseSensitive: false, trimWhitespace: true, normalizeUnicode: true }, internalNotes: 'ลับกว่า', tags: [] }] };
  const serialized = JSON.stringify(consumerPackProjection(trusted));
  assert.equal(serialized.includes('acceptedAnswers'), false);
  assert.equal(serialized.includes('ลับ'), false);
  assert.equal(serialized.includes('internalNotes'), false);
});

test('stale publish after concurrent archive returns 409 without creating a version', async () => {
  const database = await migratedDatabase();
  const db = new SqliteD1(database);
  const env = { DB: db, TEAM_KEY: 'pack-team-key' };

  const bank = (await call(env, '/api/admin/question-banks', { method: 'POST', body: { name: 'คลังทดสอบ Concurrent Publish' } })).data.bank;
  const question = await createReadyQuestion(env, bank.id, { prompt: 'คำถามสำหรับทดสอบ Publish', difficulty: 2, tagIds: [] });
  const pack = (await call(env, '/api/admin/question-packs', { method: 'POST', body: { name: 'Pack ทดสอบ Concurrent Publish' } })).data.pack;
  const added = await call(env, `/api/admin/question-packs/${pack.id}/items`, { method: 'POST', body: { kind: 'MANUAL', questionId: question.id } });
  assert.equal(added.response.status, 201, JSON.stringify(added.data));

  const readBeforePublish = await call(env, `/api/admin/question-packs/${pack.id}`);
  assert.equal(readBeforePublish.response.status, 200);
  assert.equal(readBeforePublish.data.pack.status, 'ACTIVE');
  assert.equal(readBeforePublish.data.pack.publishedVersion, 0);

  db.beforeBatch = () => {
    database.prepare("UPDATE question_packs SET status='ARCHIVED' WHERE id=?").run(pack.id);
  };
  const published = await call(env, `/api/admin/question-packs/${pack.id}/publish`, { method: 'POST', body: {} });
  assert.equal(published.response.status, 409, JSON.stringify(published.data));

  const versions = database.prepare('SELECT COUNT(*) AS count FROM question_pack_versions WHERE pack_id=?').get(pack.id);
  const storedPack = database.prepare('SELECT status,published_version FROM question_packs WHERE id=?').get(pack.id);
  assert.equal(versions.count, 0);
  assert.equal(storedPack.status, 'ARCHIVED');
  assert.equal(storedPack.published_version, 0);
  database.close();
});

test('multi-add selects ready activities and published media snapshots keep versioned paths immutable', async () => {
  const database = await migratedDatabase(), env = { DB: new SqliteD1(database), TEAM_KEY: 'pack-activity-key' };
  const bank = (await call(env, '/api/admin/question-banks', { method: 'POST', body: { name: 'คลังกิจกรรมชุดคำถาม' } })).data.bank;
  const oldMedia = { path: '/assets/question-media/versioned/scene.1111111111111111.webp', alt: 'ฉากเดิม' };
  const newMedia = { path: '/assets/question-media/versioned/scene.2222222222222222.webp', alt: 'ฉากใหม่' };
  const ordering = (await call(env, `/api/admin/question-banks/${bank.id}/questions`, { method: 'POST', body: {
    type: 'ORDERING', prompt: 'เรียงลำดับ', media: oldMedia,
    answerConfig: { items: [{ id: 'i1', text: 'หนึ่ง' }, { id: 'i2', text: 'สอง' }], correctOrder: ['i1', 'i2'] },
  } })).data.question;
  const matching = (await call(env, `/api/admin/question-banks/${bank.id}/questions`, { method: 'POST', body: {
    type: 'MATCHING', prompt: 'จับคู่', answerConfig: { pairs: [
      { id: 'p1', leftId: 'l1', rightId: 'r1', leftText: 'A', rightText: '1' },
      { id: 'p2', leftId: 'l2', rightId: 'r2', leftText: 'B', rightText: '2' },
    ] },
  } })).data.question;
  assert.equal(ordering.status, 'READY');
  assert.equal(matching.status, 'READY');

  const pack = (await call(env, '/api/admin/question-packs', { method: 'POST', body: { name: 'ชุดกิจกรรม' } })).data.pack;
  const added = await call(env, `/api/admin/question-packs/${pack.id}/items`, { method: 'POST', body: { kind: 'MANUAL', questionIds: [ordering.id, matching.id] } });
  assert.equal(added.response.status, 201, JSON.stringify(added.data));
  assert.equal(added.data.added, 2);
  assert.equal(added.data.items.length, 2);

  const published1 = await call(env, `/api/admin/question-packs/${pack.id}/publish`, { method: 'POST', body: {} });
  assert.equal(published1.response.status, 201, JSON.stringify(published1.data));
  const version1 = (await call(env, `/api/admin/question-packs/${pack.id}/versions/1`)).data.version.snapshot;
  assert.equal(version1.schemaVersion, 2);
  assert.deepEqual(version1.questions.map(question => question.type), ['ORDERING', 'MATCHING']);
  assert.equal(version1.questions[0].media.path, oldMedia.path);

  const current = (await call(env, `/api/admin/question-banks/${bank.id}/questions/${ordering.id}`)).data.question;
  const changed = await call(env, `/api/admin/question-banks/${bank.id}/questions/${ordering.id}`, { method: 'PATCH', body: { media: newMedia, baseUpdatedAt: current.updatedAt } });
  assert.equal(changed.data.question.status, 'READY');
  assert.equal((await call(env, `/api/admin/question-packs/${pack.id}/publish`, { method: 'POST', body: {} })).response.status, 201);
  const version1Again = (await call(env, `/api/admin/question-packs/${pack.id}/versions/1`)).data.version.snapshot;
  const version2 = (await call(env, `/api/admin/question-packs/${pack.id}/versions/2`)).data.version.snapshot;
  assert.equal(version1Again.questions[0].media.path, oldMedia.path);
  assert.equal(version2.questions[0].media.path, newMedia.path);
  database.close();
});
