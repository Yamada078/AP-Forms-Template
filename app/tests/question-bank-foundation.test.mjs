import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { readyValidation, toConsumerQuestion } from '../src/question-banks.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

class SqliteD1Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() { return this.database.prepare(this.sql).get(...this.args) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.args) }; }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
  }
}

class SqliteD1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new SqliteD1Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

async function databaseWithQuestionBanks() {
  const [schema, migration1, migration3, migration4, migration5, migration8] = await Promise.all([
    read('schema.sql'),
    read('migrations/0001_publish_system.sql'),
    read('migrations/0003_integration_foundation.sql'),
    read('migrations/0004_application_form_access.sql'),
    read('migrations/0005_question_bank_foundation.sql'),
    read('migrations/0008_question_activity_media.sql'),
  ]);
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  database.exec(schema);
  database.exec(migration1);
  database.exec(migration3);
  database.exec(migration4);
  database.exec(migration5);
  database.exec(migration8);
  return database;
}

async function call(env, path, { method = 'GET', admin = true, body } = {}) {
  const headers = new Headers();
  if (admin) headers.set('authorization', `Bearer ${env.TEAM_KEY}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const response = await worker.fetch(new Request(`https://forms.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { response, data: await response.json() };
}

test('question bank migration is additive and creates relational foundation', async () => {
  const database = await databaseWithQuestionBanks();
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  for (const table of ['forms', 'responses', 'question_banks', 'bank_questions', 'question_tags', 'question_tag_links']) assert.ok(tables.includes(table));
  const columns = database.prepare("SELECT name FROM pragma_table_info('bank_questions')").all().map(row => row.name);
  for (const column of ['bank_id', 'type', 'activity_type', 'difficulty', 'status', 'answer_config', 'media_json', 'explanation', 'internal_notes', 'source_reference', 'created_at', 'updated_at']) assert.ok(columns.includes(column));
  database.close();
});

test('Question Studio API persists four types, answer keys, tags, filters, duplicate IDs, and lifecycle rules', async () => {
  const database = await databaseWithQuestionBanks(), env = { DB: new SqliteD1(database), TEAM_KEY: 'question-team-key' };
  const denied = await call(env, '/api/admin/question-banks', { admin: false });
  assert.equal(denied.response.status, 401);

  const createdBank = await call(env, '/api/admin/question-banks', { method: 'POST', body: { name: 'Example question bank', description: 'Assessment content' } });
  assert.equal(createdBank.response.status, 201);
  const bankId = createdBank.data.bank.id;

  const createdTag = await call(env, `/api/admin/question-banks/${bankId}/tags`, { method: 'POST', body: { name: 'N5', groupName: 'JLPT' } });
  assert.equal(createdTag.response.status, 201);
  const tagId = createdTag.data.tag.id;

  const fixtures = [
    {
      type: 'SINGLE_CHOICE', prompt: 'Choose one',
      config: { choices: [{ id: 'single_a', text: 'A' }, { id: 'single_b', text: 'B' }], correctIds: ['single_a'] },
    },
    {
      type: 'MULTIPLE_CHOICE', prompt: 'Choose many',
      config: { choices: [{ id: 'multi_a', text: 'A' }, { id: 'multi_b', text: 'B' }, { id: 'multi_c', text: 'C' }], correctIds: ['multi_a', 'multi_c'] },
    },
    { type: 'TRUE_FALSE', prompt: 'The sky is blue', config: { correctAnswer: true } },
    { type: 'SHORT_ANSWER', prompt: 'Name the animal', config: { acceptedAnswers: ['cat', 'Cat'], caseSensitive: false, trimWhitespace: true, normalizeUnicode: true } },
  ];
  const saved = [];
  for (let index = 0; index < fixtures.length; index++) {
    const fixture = fixtures[index];
    const draft = await call(env, `/api/admin/question-banks/${bankId}/questions`, { method: 'POST', body: { type: fixture.type } });
    assert.equal(draft.response.status, 201);
    const updated = await call(env, `/api/admin/question-banks/${bankId}/questions/${draft.data.question.id}`, {
      method: 'PATCH',
      body: {
        type: fixture.type, prompt: fixture.prompt, description: 'Searchable context', difficulty: index + 1,
        status: 'READY', answerConfig: fixture.config, explanation: 'Because it is correct',
        internalNotes: 'Trusted team only', sourceReference: 'Teacher-created', tagIds: [tagId],
        baseUpdatedAt: draft.data.question.updatedAt,
      },
    });
    assert.equal(updated.response.status, 200, JSON.stringify(updated.data));
    assert.equal(updated.data.question.status, 'READY');
    assert.equal(updated.data.question.difficulty, index + 1);
    assert.deepEqual(updated.data.question.tags.map(tag => tag.id), [tagId]);
    saved.push(updated.data.question);
  }

  const invalidDraft = await call(env, `/api/admin/question-banks/${bankId}/questions`, { method: 'POST', body: { type: 'SHORT_ANSWER' } });
  const invalidReady = await call(env, `/api/admin/question-banks/${bankId}/questions/${invalidDraft.data.question.id}`, { method: 'PATCH', body: { status: 'READY', baseUpdatedAt: invalidDraft.data.question.updatedAt } });
  assert.equal(invalidReady.response.status, 422);
  assert.equal(invalidReady.data.readiness.valid, false);
  assert.ok(invalidReady.data.readiness.errors.length >= 2);

  const filtered = await call(env, `/api/admin/question-banks/${bankId}/questions?search=teacher&type=SHORT_ANSWER&difficulty=4&tag=${tagId}&sort=prompt`);
  assert.equal(filtered.response.status, 200);
  assert.equal(filtered.data.total, 1);
  assert.equal(filtered.data.questions[0].prompt, 'Name the animal');

  const duplicate = await call(env, `/api/admin/question-banks/${bankId}/questions/${saved[0].id}/duplicate`, { method: 'POST', body: {} });
  assert.equal(duplicate.response.status, 201);
  assert.notEqual(duplicate.data.question.id, saved[0].id);
  assert.equal(duplicate.data.question.status, 'READY');
  assert.notDeepEqual(duplicate.data.question.answerConfig.choices.map(choice => choice.id), saved[0].answerConfig.choices.map(choice => choice.id));
  assert.deepEqual(duplicate.data.question.answerConfig.correctIds.length, saved[0].answerConfig.correctIds.length);

  const bulk = await call(env, `/api/admin/question-banks/${bankId}/questions/bulk`, { method: 'POST', body: { action: 'difficulty', difficulty: 5, questionIds: [saved[0].id, saved[1].id] } });
  assert.equal(bulk.response.status, 200);
  const difficultyFive = await call(env, `/api/admin/question-banks/${bankId}/questions?difficulty=5`);
  assert.ok(difficultyFive.data.questions.some(question => question.id === saved[0].id));

  const persisted = database.prepare('SELECT answer_config,internal_notes,source_reference FROM bank_questions WHERE id=?').get(saved[3].id);
  assert.deepEqual(JSON.parse(persisted.answer_config).acceptedAnswers, ['cat', 'Cat']);
  assert.equal(persisted.internal_notes, 'Trusted team only');
  assert.equal(persisted.source_reference, 'Teacher-created');

  const archived = await call(env, `/api/admin/question-banks/${bankId}`, { method: 'PATCH', body: { status: 'ARCHIVED' } });
  assert.equal(archived.response.status, 200);
  const deleteTagFromArchive = await call(env, `/api/admin/question-banks/${bankId}/tags/${tagId}`, { method: 'DELETE', body: {} });
  assert.equal(deleteTagFromArchive.response.status, 409);
  assert.equal(deleteTagFromArchive.data.code, 'BANK_ARCHIVED_READ_ONLY');
  const createInArchive = await call(env, `/api/admin/question-banks/${bankId}/questions`, { method: 'POST', body: {} });
  assert.equal(createInArchive.response.status, 409);
  const badDelete = await call(env, `/api/admin/question-banks/${bankId}`, { method: 'DELETE', body: { confirmName: 'wrong' } });
  assert.equal(badDelete.response.status, 409);
  const deleted = await call(env, `/api/admin/question-banks/${bankId}`, { method: 'DELETE', body: { confirmName: 'Example question bank' } });
  assert.equal(deleted.response.status, 200);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM question_banks').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM bank_questions').get().count, 0);
  database.close();
});

test('consumer representation excludes correct answers and internal notes by construction', () => {
  const trusted = {
    id: 'question_1', type: 'MULTIPLE_CHOICE', prompt: 'Private key boundary', description: '', difficulty: 3,
    answerConfig: { choices: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctIds: ['a'] },
    explanation: 'Public after answering', internalNotes: 'Never public', sourceReference: 'Private source',
    tags: [{ id: 'tag_1', name: 'Safety', groupName: 'Type' }],
  };
  assert.equal(readyValidation(trusted).valid, true);
  const consumer = toConsumerQuestion(trusted), serialized = JSON.stringify(consumer);
  assert.deepEqual(consumer.answerConfig.choices, [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }]);
  assert.equal(serialized.includes('correctIds'), false);
  assert.equal(serialized.includes('Never public'), false);
  assert.equal(serialized.includes('Private source'), false);
});

test('automatic readiness, new activities, media references, bulk lifecycle, and tag deletion are safe', async () => {
  const database = await databaseWithQuestionBanks(), env = { DB: new SqliteD1(database), TEAM_KEY: 'activity-team-key' };
  const bank = (await call(env, '/api/admin/question-banks', { method: 'POST', body: { name: 'คลังกิจกรรม' } })).data.bank;
  const tag = (await call(env, `/api/admin/question-banks/${bank.id}/tags`, { method: 'POST', body: { name: 'ภาพ', groupName: 'สื่อ' } })).data.tag;
  const media = { path: '/assets/question-media/versioned/diagram.0123456789abcdef.png', alt: 'แผนภาพทดสอบ' };
  const fixtures = [
    { type: 'ORDERING', prompt: 'เรียงขั้นตอน', answerConfig: { items: [{ id: 'o1', text: 'หนึ่ง' }, { id: 'o2', text: 'สอง', media }], correctOrder: ['o1', 'o2'] } },
    { type: 'MATCHING', prompt: 'จับคู่คำ', answerConfig: { pairs: [{ id: 'p1', leftId: 'l1', rightId: 'r1', leftText: 'A', rightText: '1' }, { id: 'p2', leftId: 'l2', rightId: 'r2', leftText: 'B', rightText: '2' }], rightDistractors: [{ id: 'fake1', rightId: 'rf1', rightText: 'ตัวหลอก' }], leftOrder: ['l2', 'l1'], rightOrder: ['rf1', 'r2', 'r1'] } },
    { type: 'DRAG_DROP', prompt: 'ลากให้ถูกช่อง', answerConfig: { targets: [{ id: 't1', label: 'ช่องหนึ่ง' }, { id: 't2', label: 'ช่องสอง' }], tokens: [{ id: 'd1', text: 'ชิ้นหนึ่ง', targetId: 't1' }, { id: 'd2', text: 'ชิ้นสอง', targetId: 't2', media }, { id: 'd3', text: 'ตัวหลอก', targetId: '' }] } },
  ];
  const created = [];
  for (const fixture of fixtures) {
    const result = await call(env, `/api/admin/question-banks/${bank.id}/questions`, { method: 'POST', body: { ...fixture, media, tagIds: [tag.id] } });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.question.status, 'READY');
    assert.equal(result.data.question.readiness.valid, true);
    assert.equal(result.data.question.media.path, media.path);
    created.push(result.data.question);
  }
  const stored = database.prepare('SELECT type,activity_type,media_json FROM bank_questions WHERE id=?').get(created[0].id);
  assert.equal(stored.type, 'SHORT_ANSWER');
  assert.equal(stored.activity_type, 'ORDERING');
  assert.equal(JSON.parse(stored.media_json).path, media.path);
  const matchingConsumer = toConsumerQuestion(created[1]);
  assert.deepEqual(matchingConsumer.answerConfig.leftItems.map(item => item.id), ['l2', 'l1']);
  assert.deepEqual(matchingConsumer.answerConfig.rightItems.map(item => item.id), ['rf1', 'r2', 'r1']);
  assert.equal(JSON.stringify(matchingConsumer).includes('rightDistractors'), false);
  const dragConsumer = toConsumerQuestion(created[2]);
  assert.equal(dragConsumer.answerConfig.tokens.length, 3);
  assert.equal(JSON.stringify(dragConsumer).includes('targetId'), false);
  assert.equal(readyValidation({ type: 'DRAG_DROP', prompt: 'ตัวหลอกทั้งหมด', answerConfig: { targets: [{ id: 't1', label: 'ช่องหนึ่ง' }], tokens: [{ id: 'd1', text: 'ตัวหลอก', targetId: '' }] } }).valid, false);
  assert.equal(readyValidation(created[2]).valid, true);

  const draft = (await call(env, `/api/admin/question-banks/${bank.id}/questions`, { method: 'POST', body: { type: 'SINGLE_CHOICE' } })).data.question;
  const choices = [{ id: 'auto_a', text: 'ก' }, { id: 'auto_b', text: 'ข' }];
  const autoReady = await call(env, `/api/admin/question-banks/${bank.id}/questions/${draft.id}`, { method: 'PATCH', body: { prompt: 'พร้อมอัตโนมัติ', answerConfig: { choices, correctIds: ['auto_a'] }, baseUpdatedAt: draft.updatedAt } });
  assert.equal(autoReady.data.question.status, 'READY');

  const ids = created.map(question => question.id);
  assert.equal((await call(env, `/api/admin/question-banks/${bank.id}/questions/bulk`, { method: 'POST', body: { action: 'difficulty', difficulty: 5, questionIds: ids } })).response.status, 200);
  assert.equal((await call(env, `/api/admin/question-banks/${bank.id}/questions/bulk`, { method: 'POST', body: { action: 'remove_tags', tagIds: [tag.id], questionIds: ids } })).response.status, 200);
  const renamed = await call(env, `/api/admin/question-banks/${bank.id}/tags/${tag.id}`, { method: 'PATCH', body: { name: 'ภาพประกอบ', groupName: 'สื่อการสอน' } });
  assert.equal(renamed.data.tag.name, 'ภาพประกอบ');
  assert.equal((await call(env, `/api/admin/question-banks/${bank.id}/questions/bulk`, { method: 'POST', body: { action: 'add_tags', tagIds: [tag.id], questionIds: ids } })).response.status, 200);
  assert.equal((await call(env, `/api/admin/question-banks/${bank.id}/tags/${tag.id}`, { method: 'DELETE', body: {} })).response.status, 200);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM bank_questions WHERE bank_id=?').get(bank.id).count, 4);

  assert.equal((await call(env, `/api/admin/question-banks/${bank.id}/questions/bulk`, { method: 'POST', body: { action: 'delete', questionIds: ids } })).response.status, 409);
  assert.equal((await call(env, `/api/admin/question-banks/${bank.id}/questions/bulk`, { method: 'POST', body: { action: 'archive', questionIds: ids } })).response.status, 200);
  assert.equal((await call(env, `/api/admin/question-banks/${bank.id}/questions/bulk`, { method: 'POST', body: { action: 'delete', questionIds: ids } })).response.status, 200);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM bank_questions WHERE id IN (?,?,?)').get(...ids).count, 0);
  database.close();
});
