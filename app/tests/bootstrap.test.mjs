import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { buildBootstrapSchema } from '../scripts/generate-bootstrap-schema.mjs';

class Statement {
  constructor(database, sql) { this.database = database; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() { return this.database.prepare(this.sql).get(...this.args) || null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.args) }; }
  async run() { const result = this.database.prepare(this.sql).run(...this.args); return { meta: { changes: Number(result.changes) } }; }
}
class D1 {
  constructor(database) { this.database = database; }
  prepare(sql) { return new Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); this.database.exec('COMMIT'); return result; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
}

test('new database bootstrap matches the migration recipe and starts with no instance data', async () => {
  const schema = await readFile(new URL('../database/bootstrap.sql', import.meta.url), 'utf8');
  assert.equal(schema, await buildBootstrapSchema());
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA foreign_keys=ON');
    database.exec(schema);
    const requiredTables = ['forms', 'responses', 'form_versions', 'revoked_public_links', 'applications', 'integration_credentials', 'application_permissions', 'application_forms', 'question_banks', 'bank_questions', 'question_tags', 'question_tag_links', 'question_packs', 'question_pack_items', 'question_pack_versions', 'assessment_sessions', 'assessment_results', 'application_question_packs'];
    for (const table of requiredTables) assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
    const env = { DB: new D1(database), TEAM_KEY: 'bootstrap-test-key' };
    const call = (path, body) => worker.fetch(new Request(`https://forms.test${path}`, { method: 'POST', headers: { authorization: `Bearer ${env.TEAM_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);
    for (const [path, body] of [
      ['/api/forms', { title: 'Example form' }],
      ['/api/admin/question-banks', { name: 'Example bank' }],
      ['/api/admin/question-packs', { name: 'Example pack' }],
      ['/api/admin/integrations/applications', { name: 'Example application' }],
    ]) {
      const response = await call(path, body);
      assert.equal(response.status, 201, `${path}: ${await response.text()}`);
    }
    assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { database.close(); }
});
