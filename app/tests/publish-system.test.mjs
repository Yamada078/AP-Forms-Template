import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { effectivePublicationState, generatePublicId } from '../src/index.js';

const normalizeSql = sql => sql.replace(/\s+/g, ' ').trim();

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = normalizeSql(sql); this.args = []; }
  bind(...args) { this.args = args; return this; }
  first() { return this.db.first(this.sql, this.args); }
  all() { return this.db.all(this.sql, this.args); }
  run() { return this.db.run(this.sql, this.args); }
}

class FakeD1 {
  constructor() {
    this.forms = new Map();
    this.versions = new Map();
    this.responses = new Map();
    this.revoked = new Map();
  }
  prepare(sql) { return new FakeStatement(this, sql); }
  async batch(statements) {
    const backup = structuredClone({ forms: this.forms, versions: this.versions, responses: this.responses, revoked: this.revoked });
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      Object.assign(this, backup);
      throw error;
    }
  }
  first(sql, args) {
    if (sql === 'SELECT * FROM organization WHERE id=1') return null;
    if (sql.includes('FROM forms WHERE public_id=?')) return structuredClone([...this.forms.values()].find(row => row.public_id === args[0]) || null);
    if (sql.includes('FROM revoked_public_links WHERE public_id=?')) return this.revoked.has(args[0]) ? { public_id: args[0] } : null;
    if (sql === 'SELECT public_id FROM forms WHERE id=?') return this.forms.has(args[0]) ? { public_id: this.forms.get(args[0]).public_id } : null;
    if (sql === 'SELECT updated_at FROM forms WHERE id=?') return this.forms.has(args[0]) ? { updated_at: this.forms.get(args[0]).updated_at } : null;
    if (sql.includes('FROM forms WHERE id=?')) return structuredClone(this.forms.get(args[0]) || null);
    throw new Error(`Unhandled first: ${sql}`);
  }
  all(sql, args) {
    if (sql.includes('FROM responses WHERE form_id=?') || sql.includes('FROM responses r LEFT JOIN applications')) return { results: [...this.responses.values()].filter(row => row.form_id === args[0]).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(row => structuredClone(row)) };
    if (sql.includes('FROM form_versions WHERE form_id=?')) return { results: [...this.versions.values()].filter(row => row.form_id === args[0]).sort((a, b) => b.version - a.version).map(row => structuredClone(row)) };
    if (sql.includes('FROM forms ORDER BY updated_at DESC')) return { results: [...this.forms.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(row => structuredClone(row)) };
    throw new Error(`Unhandled all: ${sql}`);
  }
  run(sql, args) {
    if (sql.startsWith('UPDATE forms SET title=?,data=?,updated_at=? WHERE id=?')) {
      const [title, data, updatedAt, formId, expected] = args, row = this.forms.get(formId);
      if (!row || (expected && row.updated_at !== expected)) return { meta: { changes: 0 } };
      Object.assign(row, { title, data, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE forms SET published=1,public_id=')) {
      const [publicId, state, data, version, publishedAt, openAt, closeAt, updatedAt, formId, expectedVersion] = args, row = this.forms.get(formId);
      if (!row || Number(row.published_version) !== Number(expectedVersion)) return { meta: { changes: 0 } };
      if ([...this.forms.values()].some(other => other.id !== formId && other.public_id === publicId)) throw new Error('UNIQUE constraint failed: forms.public_id');
      Object.assign(row, { published: 1, public_id: publicId, publication_state: state, published_data: data, published_version: version, published_at: publishedAt, open_at: openAt, close_at: closeAt, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO form_versions')) {
      const [formId, version, data, publishedAt] = args, key = `${formId}:${version}`;
      if (this.versions.has(key)) throw new Error('UNIQUE constraint failed: form_versions');
      this.versions.set(key, { form_id: formId, version, data, published_at: publishedAt });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE forms SET publication_state=')) {
      const [state, openAt, closeAt, updatedAt, formId] = args, row = this.forms.get(formId);
      if (!row) return { meta: { changes: 0 } };
      Object.assign(row, { publication_state: state, open_at: openAt, close_at: closeAt, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT OR IGNORE INTO revoked_public_links')) {
      const [publicId, formId, revokedAt] = args;
      if (!this.revoked.has(publicId)) this.revoked.set(publicId, { public_id: publicId, form_id: formId, revoked_at: revokedAt });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE forms SET public_id=?,updated_at=?')) {
      const [publicId, updatedAt, formId, expected] = args, row = this.forms.get(formId);
      if (!row || row.public_id !== expected) return { meta: { changes: 0 } };
      if ([...this.forms.values()].some(other => other.id !== formId && other.public_id === publicId)) throw new Error('UNIQUE constraint failed: forms.public_id');
      Object.assign(row, { public_id: publicId, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('UPDATE forms SET public_id=? WHERE id=?')) {
      const [publicId, formId] = args, row = this.forms.get(formId);
      if (!row || row.public_id) return { meta: { changes: 0 } };
      Object.assign(row, { public_id: publicId });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO responses')) {
      const [id, formId, respondentName, respondentMeta, answers, path, score, publishedVersion, createdAt] = args;
      if (sql.includes('WHERE EXISTS')) {
        const [, , , , , , , , , checkedFormId, publicId, checkedVersion, openNow, closeNow] = args, row = this.forms.get(checkedFormId);
        const allowed = row && row.public_id === publicId && Number(row.published_version) === Number(checkedVersion) && row.published_data && ['OPEN', 'SCHEDULED'].includes(row.publication_state) && (!row.open_at || row.open_at <= openNow) && (!row.close_at || row.close_at > closeNow);
        if (!allowed) return { meta: { changes: 0 } };
      }
      this.responses.set(id, { id, form_id: formId, respondent_name: respondentName, respondent_meta: respondentMeta, answers, path, score, published_version: publishedVersion, created_at: createdAt });
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unhandled run: ${sql}`);
  }
}

const formData = title => JSON.stringify({ version: 5, title, description: '', theme: { accent: '#7c9cff' }, sections: [{ id: 'section', title: 'Page', description: '', nextLabel: 'ส่ง', blocks: [], routingRules: [] }] });
const seed = (db, id, title) => db.forms.set(id, { id, title, data: formData(title), published: 0, public_id: null, publication_state: 'DRAFT', published_data: null, published_version: 0, published_at: null, open_at: null, close_at: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' });

async function call(env, path, { method = 'GET', body, admin = false } = {}) {
  const headers = new Headers();
  if (admin) headers.set('Authorization', `Bearer ${env.TEAM_KEY}`);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await worker.fetch(new Request(`https://forms.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const data = await response.json();
  return { response, data };
}

test('secure public ids and schedule state boundaries', () => {
  const ids = new Set(Array.from({ length: 500 }, generatePublicId));
  assert.equal(ids.size, 500);
  assert.ok([...ids].every(value => /^[A-Za-z0-9_-]{16}$/.test(value)));
  const row = { published_data: '{}', published_version: 1, publication_state: 'SCHEDULED', open_at: '2026-01-02T00:00:00.000Z', close_at: '2026-01-03T00:00:00.000Z' };
  assert.equal(effectivePublicationState(row, Date.parse('2026-01-01T00:00:00.000Z')), 'SCHEDULED');
  assert.equal(effectivePublicationState(row, Date.parse('2026-01-02T12:00:00.000Z')), 'OPEN');
  assert.equal(effectivePublicationState(row, Date.parse('2026-01-03T00:00:00.000Z')), 'CLOSED');
});

test('published snapshot and public submission preserve a custom IOC scale including zero', async () => {
  const db = new FakeD1(), env = { DB: db, TEAM_KEY: 'ioc-publish-key' };
  seed(db, 'form_ioc', 'IOC Form');
  const iocForm = {
    version: 5, title: 'IOC Form', description: '', startPage: { title: 'IOC Form', description: '', fields: [] }, theme: { accent: '#7c9cff' },
    sections: [{ id: 'section', title: 'IOC', description: '', nextLabel: 'ส่ง', routingRules: [], blocks: [{
      id: 'matrix', type: 'question', questionType: 'rating_matrix', title: 'ประเมิน', required: true, condition: { enabled: false },
      matrixRows: [{ id: 'row', label: 'รายการ' }],
      matrixScale: { preset: 'ioc', iocThreshold: 0.55, options: [
        { id: 'minus', displayLabel: 'ไม่สอดคล้อง', value: -1 },
        { id: 'zero', displayLabel: 'ไม่แน่ใจ', value: 0 },
        { id: 'plus', displayLabel: 'สอดคล้อง', value: 1 },
      ] },
    }] }],
  };
  db.forms.get('form_ioc').data = JSON.stringify(iocForm);
  const published = await call(env, '/api/forms/form_ioc/publish', { method: 'POST', admin: true, body: {} });
  assert.equal(published.response.status, 200);
  const storedSnapshot = JSON.parse(db.forms.get('form_ioc').published_data);
  assert.deepEqual(storedSnapshot.sections[0].blocks[0].matrixScale, iocForm.sections[0].blocks[0].matrixScale);

  const publicId = published.data.publication.publicId;
  const loaded = await call(env, `/api/public/forms/${publicId}`);
  assert.equal(loaded.data.form.sections[0].blocks[0].matrixScale.iocThreshold, 0.55);
  const submitted = await call(env, `/api/public/forms/${publicId}/responses`, { method: 'POST', body: { answers: { matrix: { __type: 'matrix', rows: { row: 0 } } } } });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.data));
  assert.equal(JSON.parse(db.responses.get(submitted.data.id).answers).matrix.rows.row, 0);

  const invalidDraft = structuredClone(iocForm);
  invalidDraft.sections[0].blocks[0].matrixScale = { preset: 'custom', options: [
    { id: 'a', displayLabel: 'A', value: 0 },
    { id: 'b', displayLabel: 'B', value: 0 },
  ] };
  db.forms.get('form_ioc').data = JSON.stringify(invalidDraft);
  const rejected = await call(env, '/api/forms/form_ioc/publish', { method: 'POST', admin: true, body: {} });
  assert.equal(rejected.response.status, 400);
  assert.match(rejected.data.error, /Numeric Value/);
  assert.equal(db.forms.get('form_ioc').published_version, 1);
});

test('publish snapshots, close/reopen, versioned responses and regenerated links', async () => {
  const db = new FakeD1(), env = { DB: db, TEAM_KEY: 'test-team-key' };
  seed(db, 'form_a', 'Form A V1');
  seed(db, 'form_b', 'Form B V1');

  const publishA = await call(env, '/api/forms/form_a/publish', { method: 'POST', body: {}, admin: true });
  const publishB = await call(env, '/api/forms/form_b/publish', { method: 'POST', body: {}, admin: true });
  assert.equal(publishA.response.status, 200);
  assert.equal(publishB.response.status, 200);
  assert.notEqual(publishA.data.publication.publicId, publishB.data.publication.publicId);
  const publicA = publishA.data.publication.publicId;
  const publicB = publishB.data.publication.publicId;

  const hour = 60 * 60 * 1000, now = Date.now();
  await call(env, '/api/forms/form_b/publication', { method: 'POST', body: { action: 'schedule', openAt: new Date(now + hour).toISOString(), closeAt: new Date(now + 2 * hour).toISOString() }, admin: true });
  const beforeOpen = await call(env, `/api/public/forms/${publicB}`);
  assert.equal(beforeOpen.data.publication.state, 'SCHEDULED');
  const beforeSubmit = await call(env, `/api/public/forms/${publicB}/responses`, { method: 'POST', body: { respondentName: 'too early', answers: {} } });
  assert.equal(beforeSubmit.response.status, 403);
  await call(env, '/api/forms/form_b/publication', { method: 'POST', body: { action: 'schedule', openAt: new Date(now - hour).toISOString(), closeAt: new Date(now + hour).toISOString() }, admin: true });
  const duringSubmit = await call(env, `/api/public/forms/${publicB}/responses`, { method: 'POST', body: { respondentName: 'during schedule', answers: {} } });
  assert.equal(duringSubmit.response.status, 201);
  await call(env, '/api/forms/form_b/publication', { method: 'POST', body: { action: 'schedule', openAt: new Date(now - 2 * hour).toISOString(), closeAt: new Date(now - hour).toISOString() }, admin: true });
  const afterClose = await call(env, `/api/public/forms/${publicB}`);
  assert.equal(afterClose.data.publication.state, 'CLOSED');
  const afterSubmit = await call(env, `/api/public/forms/${publicB}/responses`, { method: 'POST', body: { respondentName: 'too late', answers: {} } });
  assert.equal(afterSubmit.response.status, 403);

  const firstPublic = await call(env, `/api/public/forms/${publicA}`);
  assert.equal(firstPublic.data.form.title, 'Form A V1');

  const draftV2 = JSON.parse(formData('Form A Draft V2'));
  const saveDraft = await call(env, '/api/forms/form_a', { method: 'PUT', body: { ...draftV2, baseUpdatedAt: db.forms.get('form_a').updated_at }, admin: true });
  assert.equal(saveDraft.response.status, 200);
  const stillV1 = await call(env, `/api/public/forms/${publicA}`);
  assert.equal(stillV1.data.form.title, 'Form A V1');

  const submitV1 = await call(env, `/api/public/forms/${publicA}/responses`, { method: 'POST', body: { respondentName: 'V1 respondent', answers: {} } });
  assert.equal(submitV1.response.status, 201);
  assert.equal(submitV1.data.publishedVersion, 1);

  const publishV2 = await call(env, '/api/forms/form_a/publish', { method: 'POST', body: {}, admin: true });
  assert.equal(publishV2.data.publication.publishedVersion, 2);
  assert.equal(publishV2.data.publication.publicId, publicA);
  const duplicatePublish = await call(env, '/api/forms/form_a/publish', { method: 'POST', body: {}, admin: true });
  assert.equal(duplicatePublish.data.unchanged, true);
  assert.equal(duplicatePublish.data.publication.publishedVersion, 2);
  const nowV2 = await call(env, `/api/public/forms/${publicA}`);
  assert.equal(nowV2.data.form.title, 'Form A Draft V2');

  const close = await call(env, '/api/forms/form_a/publication', { method: 'POST', body: { action: 'close' }, admin: true });
  assert.equal(close.data.publication.state, 'CLOSED');
  const closedGet = await call(env, `/api/public/forms/${publicA}`);
  assert.equal(closedGet.data.publication.state, 'CLOSED');
  assert.equal(closedGet.data.form, undefined);
  const closedSubmit = await call(env, `/api/public/forms/${publicA}/responses`, { method: 'POST', body: { respondentName: 'blocked', answers: {} } });
  assert.equal(closedSubmit.response.status, 403);

  const reopen = await call(env, '/api/forms/form_a/publication', { method: 'POST', body: { action: 'reopen' }, admin: true });
  assert.equal(reopen.data.publication.publicId, publicA);
  const submitV2 = await call(env, `/api/public/forms/${publicA}/responses`, { method: 'POST', body: { respondentName: 'V2 respondent', answers: {} } });
  assert.equal(submitV2.response.status, 201);
  assert.equal(submitV2.data.publishedVersion, 2);

  const responses = await call(env, '/api/forms/form_a/responses', { admin: true });
  assert.deepEqual(responses.data.responses.map(row => row.published_version).sort(), [1, 2]);
  assert.deepEqual(responses.data.versions.map(row => row.version), [2, 1]);
  assert.equal(responses.data.compatibility[0].classification, 'RESPONSE_AFFECTING');

  const regenerate = await call(env, '/api/forms/form_a/regenerate-public-link', { method: 'POST', body: {}, admin: true });
  const newPublicA = regenerate.data.publication.publicId;
  assert.notEqual(newPublicA, publicA);
  const revoked = await call(env, `/api/public/forms/${publicA}`);
  assert.equal(revoked.response.status, 410);
  assert.equal(revoked.data.code, 'LINK_REVOKED');
  const replacement = await call(env, `/api/public/forms/${newPublicA}`);
  assert.equal(replacement.response.status, 200);
  assert.equal(replacement.data.form.title, 'Form A Draft V2');
});
