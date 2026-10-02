import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

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

async function migratedDatabase() {
  const [schema, migration1, migration3, migration4, migration6, migration9] = await Promise.all([
    read('schema.sql'),
    read('migrations/0001_publish_system.sql'),
    read('migrations/0003_integration_foundation.sql'),
    read('migrations/0004_application_form_access.sql'),
    read('migrations/0006_question_pack_foundation.sql'),
    read('migrations/0009_question_pack_integration.sql'),
  ]);
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys=ON');
  database.exec(schema);
  database.exec(migration1);
  database.exec(migration3);
  database.exec(migration4);
  database.exec(migration6);
  database.exec(migration9);
  return database;
}

async function api(env, path, { method = 'GET', admin = false, token, body } = {}) {
  const headers = new Headers();
  if (admin) headers.set('authorization', `Bearer ${env.TEAM_KEY}`);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const response = await worker.fetch(new Request(`https://forms.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { response, data: await response.json() };
}

test('integration migration applies additively and preserves existing form/response data', async () => {
  const [schema, migration1, migration3, migration4, migration6, migration9] = await Promise.all([
    read('schema.sql'),
    read('migrations/0001_publish_system.sql'),
    read('migrations/0003_integration_foundation.sql'),
    read('migrations/0004_application_form_access.sql'),
    read('migrations/0006_question_pack_foundation.sql'),
    read('migrations/0009_question_pack_integration.sql'),
  ]);
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(schema);
  db.prepare('INSERT INTO forms (id,title,data,published,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('form_existing', 'Existing', '{}', 0, '2026-01-01', '2026-01-01');
  db.prepare('INSERT INTO responses (id,form_id,respondent_name,answers,path,score,created_at) VALUES (?,?,?,?,?,?,?)').run('resp_existing', 'form_existing', 'Tester', '{}', '[]', 0, '2026-01-01');
  db.exec(migration1);
  // schema.sql already contains the 0002 respondent_meta column and represents
  // the current pre-V5 database shape used for this additive migration check.
  db.exec(migration3);
  db.exec(migration4);
  db.exec(migration6);
  db.exec(migration9);

  const preserved = db.prepare('SELECT id,form_id,source FROM responses WHERE id=?').get('resp_existing');
  assert.deepEqual({ ...preserved }, { id: 'resp_existing', form_id: 'form_existing', source: 'public_form' });
  const columns = db.prepare("SELECT name FROM pragma_table_info('responses')").all().map(row => row.name);
  for (const column of ['source', 'source_app_id', 'source_version', 'source_session', 'source_platform', 'source_metadata']) assert.ok(columns.includes(column));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
  for (const table of ['applications', 'integration_credentials', 'application_permissions', 'application_forms', 'question_packs', 'application_question_packs']) assert.ok(tables.includes(table));
  db.close();
});

test('integration routes execute against the migrated SQLite schema', async () => {
  const database = await migratedDatabase(), db = new SqliteD1(database), env = { DB: db, TEAM_KEY: 'sqlite-team-key' };
  const schema = {
    version: 5,
    title: 'SQLite Feedback',
    startPage: { title: 'SQLite Feedback', description: '', fields: [] },
    sections: [{ id: 'page_1', title: 'Feedback', description: '', routingRules: [], blocks: [{ id: 'detail', type: 'question', questionType: 'short', title: 'Detail', required: true, validation: {} }] }],
  };
  const now = '2026-08-24T04:00:00.000Z', serialized = JSON.stringify(schema);
  database.prepare(`INSERT INTO forms
    (id,title,data,published,created_at,updated_at,public_id,publication_state,published_data,published_version,published_at,open_at,close_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('form_sqlite', schema.title, serialized, 1, now, now, 'public_sqlite', 'OPEN', serialized, 1, now, null, null);
  database.prepare('INSERT INTO form_versions (form_id,version,data,published_at) VALUES (?,?,?,?)').run('form_sqlite', 1, serialized, now);

  const application = await api(env, '/api/admin/integrations/applications', { method: 'POST', admin: true, body: { name: 'SQLite Client' } });
  assert.equal(application.response.status, 201);
  const appId = application.data.application.id;
  assert.equal((await api(env, `/api/admin/integrations/applications/${appId}/permissions`, { method: 'PUT', admin: true, body: { permissions: ['read_form_schema', 'submit_response', 'read_question_pack', 'submit_game_result'] } })).response.status, 200);
  const deniedBeforeGrant = await api(env, '/api/integrations/forms/public_sqlite/schema', { token: (await api(env, `/api/admin/integrations/applications/${appId}/credentials`, { method: 'POST', admin: true, body: { label: 'temporary' } })).data.secret });
  assert.equal(deniedBeforeGrant.response.status, 403);
  assert.equal(deniedBeforeGrant.data.code, 'FORM_ACCESS_DENIED');
  assert.equal((await api(env, `/api/admin/integrations/applications/${appId}/forms`, { method: 'PUT', admin: true, body: { formIds: ['form_sqlite'] } })).response.status, 200);
  const credential = await api(env, `/api/admin/integrations/applications/${appId}/credentials`, { method: 'POST', admin: true, body: {} });
  assert.equal(credential.response.status, 201);
  const fetched = await api(env, '/api/integrations/forms/public_sqlite/schema?version=1', { token: credential.data.secret });
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.data.schema.title, schema.title);
  const submitted = await api(env, '/api/integrations/forms/public_sqlite/responses', { method: 'POST', token: credential.data.secret, body: { publishedVersion: 1, answers: { detail: 'works' }, source: { version: '1.0.0', metadata: { scene: 'QA' } } } });
  assert.equal(submitted.response.status, 201);
  const stored = database.prepare('SELECT source,source_app_id,source_version,source_metadata,published_version FROM responses WHERE id=?').get(submitted.data.id);
  assert.equal(stored.source, 'integration');
  assert.equal(stored.source_app_id, appId);
  assert.equal(stored.source_version, '1.0.0');
  assert.equal(stored.published_version, 1);
  assert.deepEqual(JSON.parse(stored.source_metadata), { scene: 'QA' });

  const packSnapshot = {
    schemaVersion: 1,
    packId: 'pack_sqlite',
    packName: 'SQLite Quiz',
    version: 1,
    questions: [{
      order: 1,
      sourceQuestionId: 'question_sqlite',
      type: 'SINGLE_CHOICE',
      prompt: '2 + 2 = ?',
      description: '',
      difficulty: 1,
      media: null,
      tags: [],
      answerConfig: { choices: [{ id: 'choice_3', text: '3' }, { id: 'choice_4', text: '4' }], correctIds: ['choice_4'] },
    }],
  };
  database.prepare(`INSERT INTO question_packs (id,name,description,status,published_version,published_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run('pack_sqlite', 'SQLite Quiz', '', 'ACTIVE', 1, now, now, now);
  database.prepare('INSERT INTO question_pack_versions (pack_id,version,snapshot_json,question_count,published_at) VALUES (?,?,?,?,?)')
    .run('pack_sqlite', 1, JSON.stringify(packSnapshot), 1, now);
  assert.equal((await api(env, `/api/admin/integrations/applications/${appId}/question-packs`, { method: 'PUT', admin: true, body: { questionPackIds: ['pack_sqlite'] } })).response.status, 200);
  const pack = await api(env, '/api/integrations/question-packs/pack_sqlite?version=1', { token: credential.data.secret });
  assert.equal(pack.response.status, 200);
  assert.equal(pack.data.questions[0].prompt, '2 + 2 = ?');
  assert.equal(Object.hasOwn(pack.data.questions[0], 'answerConfig'), false);
  const graded = await api(env, '/api/integrations/question-packs/pack_sqlite/grade', { method: 'POST', token: credential.data.secret, body: { publishedVersion: 1, answers: { question_sqlite: 'choice_4' } } });
  assert.equal(graded.response.status, 200);
  assert.equal(graded.data.correctCount, 1);
  assert.equal(graded.data.percentage, 100);
  database.close();
});
