import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const normalizeSql = sql => sql.replace(/\s+/g, ' ').trim();

class IntegrationD1 {
  constructor() {
    this.applications = new Map();
    this.credentials = new Map();
    this.permissions = new Map();
    this.applicationForms = new Map();
    this.applicationQuestionPacks = new Map();
    this.questionPacks = new Map();
    this.forms = new Map();
    this.versions = new Map();
    this.responses = new Map();
  }

  prepare(sql) {
    const db = this, normalized = normalizeSql(sql);
    return {
      sql: normalized,
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() { const result = db.execute(normalized, this.args); return result.results?.[0] || null; },
      async all() { return db.execute(normalized, this.args); },
      async run() { return db.execute(normalized, this.args); },
    };
  }

  async batch(statements) {
    const backup = structuredClone({
      applications: this.applications,
      credentials: this.credentials,
      permissions: this.permissions,
      applicationForms: this.applicationForms,
      applicationQuestionPacks: this.applicationQuestionPacks,
      responses: this.responses,
    });
    try { return statements.map(statement => this.execute(normalizeSql(statement.sql || ''), statement.args || [])); }
    catch (error) {
      this.applications = backup.applications;
      this.credentials = backup.credentials;
      this.permissions = backup.permissions;
      this.applicationForms = backup.applicationForms;
      this.applicationQuestionPacks = backup.applicationQuestionPacks;
      this.responses = backup.responses;
      throw error;
    }
  }

  execute(sql, args) {
    if (sql === 'SELECT * FROM organization WHERE id=1') return { results: [] };
    if (sql.includes('FROM integration_credentials c JOIN applications a')) {
      const [capability, secretHash] = args;
      const credential = [...this.credentials.values()].find(row => row.secret_hash === secretHash);
      if (!credential) return { results: [] };
      const application = this.applications.get(credential.application_id);
      if (!application) return { results: [] };
      const granted = this.permissions.get(credential.application_id)?.has(capability) ? capability : null;
      return { results: [{
        credential_id: credential.id,
        application_id: credential.application_id,
        credential_status: credential.status,
        expires_at: credential.expires_at,
        application_name: application.name,
        application_status: application.status,
        granted_capability: granted,
      }] };
    }
    if (sql.startsWith('SELECT id AS form_id')) {
      const row = [...this.forms.values()].find(form => form.public_id === args[0] && form.published_data && form.published_version > 0);
      return { results: row ? [{ form_id: row.id, ...row }] : [] };
    }
    if (sql.startsWith('SELECT 1 AS allowed FROM application_forms')) {
      return { results: this.applicationForms.get(args[0])?.has(args[1]) ? [{ allowed: 1 }] : [] };
    }
    if (sql.startsWith('SELECT f.id AS form_id')) {
      const form = [...this.forms.values()].find(row => row.public_id === args[0]);
      const version = form && this.versions.get(`${form.id}:${Number(args[1])}`);
      return { results: version ? [{
        form_id: form.id,
        public_id: form.public_id,
        publication_state: form.publication_state,
        published_data: version.data,
        published_version: version.version,
        published_at: version.published_at,
        open_at: form.open_at,
        close_at: form.close_at,
      }] : [] };
    }
    if (sql.startsWith('INSERT INTO responses') && sql.includes('source_app_id')) {
      const [responseId, formId, respondentName, respondentMeta, answers, path, score, version, createdAt, source, sourceAppId, sourceVersion, sourceSession, sourcePlatform, sourceMetadata, checkedVersion, checkedFormId, publicId, openNow, closeNow] = args;
      const form = this.forms.get(checkedFormId), snapshot = this.versions.get(`${checkedFormId}:${checkedVersion}`);
      const allowed = form && snapshot && form.id === formId && form.public_id === publicId && form.published_data && ['OPEN', 'SCHEDULED'].includes(form.publication_state) && (!form.open_at || form.open_at <= openNow) && (!form.close_at || form.close_at > closeNow);
      if (!allowed) return { meta: { changes: 0 } };
      this.responses.set(responseId, { id: responseId, form_id: formId, respondent_name: respondentName, respondent_meta: respondentMeta, answers, path, score, published_version: version, created_at: createdAt, source, source_app_id: sourceAppId, source_version: sourceVersion, source_session: sourceSession, source_platform: sourcePlatform, source_metadata: sourceMetadata });
      return { meta: { changes: 1 } };
    }
    if (sql === 'SELECT id,name,status,created_at,updated_at FROM applications ORDER BY created_at DESC') return { results: [...this.applications.values()] };
    if (sql === 'SELECT application_id,capability,granted_at FROM application_permissions ORDER BY capability') {
      const results = [];
      for (const [applicationId, values] of this.permissions) for (const capability of values) results.push({ application_id: applicationId, capability, granted_at: '2026-08-24T00:00:00.000Z' });
      return { results };
    }
    if (sql === 'SELECT application_id,form_id,granted_at FROM application_forms ORDER BY granted_at') {
      const results = [];
      for (const [applicationId, values] of this.applicationForms) for (const formId of values) results.push({ application_id: applicationId, form_id: formId, granted_at: '2026-08-24T00:00:00.000Z' });
      return { results };
    }
    if (sql === 'SELECT application_id,pack_id,granted_at FROM application_question_packs ORDER BY granted_at') {
      const results = [];
      for (const [applicationId, values] of this.applicationQuestionPacks) for (const packId of values) results.push({ application_id: applicationId, pack_id: packId, granted_at: '2026-08-24T00:00:00.000Z' });
      return { results };
    }
    if (sql.startsWith("SELECT id,name,published_version,published_at FROM question_packs")) return { results: [...this.questionPacks.values()].filter(row => row.status === 'ACTIVE' && row.published_version > 0) };
    if (sql.startsWith('SELECT id,title,public_id,published_version,publication_state FROM forms')) return { results: [...this.forms.values()].filter(row => row.public_id && row.published_data && row.published_version > 0).map(row => ({ id: row.id, title: row.title || 'Form', public_id: row.public_id, published_version: row.published_version, publication_state: row.publication_state })) };
    if (sql.startsWith('SELECT id FROM forms WHERE id IN')) return { results: args.filter(id => { const row = this.forms.get(id); return row?.public_id && row?.published_data && row?.published_version > 0; }).map(id => ({ id })) };
    if (sql.startsWith('SELECT id,application_id,label,secret_prefix,status,expires_at')) return { results: [...this.credentials.values()].map(({ secret_hash, ...row }) => row) };
    if (sql.startsWith('INSERT INTO applications')) {
      const [id, name, status, createdAt, updatedAt] = args;
      this.applications.set(id, { id, name, status, created_at: createdAt, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (sql === 'SELECT id,status FROM applications WHERE id=?') {
      const app = this.applications.get(args[0]);
      return { results: app ? [{ id: app.id, status: app.status }] : [] };
    }
    if (sql === 'SELECT id,name,status,created_at,updated_at FROM applications WHERE id=?') {
      const app = this.applications.get(args[0]);
      return { results: app ? [structuredClone(app)] : [] };
    }
    if (sql.startsWith('UPDATE applications SET name=')) {
      const [name, status, updatedAt, id] = args, app = this.applications.get(id);
      if (!app) return { meta: { changes: 0 } };
      Object.assign(app, { name, status, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('DELETE FROM application_permissions')) {
      this.permissions.set(args[0], new Set());
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO application_permissions')) {
      const [applicationId, capability] = args;
      if (!this.permissions.has(applicationId)) this.permissions.set(applicationId, new Set());
      this.permissions.get(applicationId).add(capability);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('DELETE FROM application_forms')) {
      this.applicationForms.set(args[0], new Set());
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO application_forms')) {
      const [applicationId, formId] = args;
      if (!this.applicationForms.has(applicationId)) this.applicationForms.set(applicationId, new Set());
      this.applicationForms.get(applicationId).add(formId);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('DELETE FROM application_question_packs')) {
      this.applicationQuestionPacks.set(args[0], new Set());
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO application_question_packs')) {
      const [applicationId, packId] = args;
      if (!this.applicationQuestionPacks.has(applicationId)) this.applicationQuestionPacks.set(applicationId, new Set());
      this.applicationQuestionPacks.get(applicationId).add(packId);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith('INSERT INTO integration_credentials')) {
      const [id, applicationId, label, secretHash, secretPrefix, expiresAt, createdAt, updatedAt] = args;
      this.credentials.set(id, { id, application_id: applicationId, label, secret_hash: secretHash, secret_prefix: secretPrefix, status: 'ACTIVE', expires_at: expiresAt, created_at: createdAt, updated_at: updatedAt, revoked_at: null });
      return { meta: { changes: 1 } };
    }
    if (sql === 'DELETE FROM integration_credentials WHERE application_id=?') {
      let changes = 0;
      for (const [credentialId, credential] of this.credentials) if (credential.application_id === args[0]) { this.credentials.delete(credentialId); changes += 1; }
      return { meta: { changes } };
    }
    if (sql.startsWith("UPDATE integration_credentials SET status='REVOKED',revoked_at=COALESCE")) {
      const [revokedAt, updatedAt, id, applicationId] = args, credential = this.credentials.get(id);
      if (!credential || credential.application_id !== applicationId) return { meta: { changes: 0 } };
      Object.assign(credential, { status: 'REVOKED', revoked_at: credential.revoked_at || revokedAt, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (sql === 'SELECT id,status FROM integration_credentials WHERE id=? AND application_id=?') {
      const credential = this.credentials.get(args[0]);
      return { results: credential?.application_id === args[1] ? [{ id: credential.id, status: credential.status }] : [] };
    }
    if (sql.startsWith("DELETE FROM integration_credentials WHERE id=? AND application_id=? AND status='REVOKED'")) {
      const credential = this.credentials.get(args[0]);
      if (!credential || credential.application_id !== args[1] || credential.status !== 'REVOKED') return { meta: { changes: 0 } };
      this.credentials.delete(args[0]);
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM applications WHERE id=? AND status='REVOKED'")) {
      const application = this.applications.get(args[0]);
      if (!application || application.status !== 'REVOKED') return { meta: { changes: 0 } };
      this.applications.delete(args[0]);
      return { meta: { changes: 1 } };
    }
    if (sql.includes('FROM responses WHERE form_id=?') || sql.includes('FROM responses r LEFT JOIN applications')) return { results: [...this.responses.values()].filter(row => row.form_id === args[0]).map(row => ({ ...row, source_app_name: this.applications.get(row.source_app_id)?.name || null })) };
    if (sql.includes('FROM form_versions WHERE form_id=?')) return { results: [...this.versions.values()].filter(row => row.form_id === args[0]).sort((a, b) => b.version - a.version) };
    throw new Error(`Unhandled SQL in test: ${sql}`);
  }
}

function formSchema(title) {
  return {
    version: 5,
    title,
    description: '',
    startPage: { title, description: '', fields: [] },
    sections: [{ id: 'sec_1', title: 'Feedback', description: '', routingRules: [], blocks: [{ id: 'question_1', type: 'question', questionType: 'short', title: 'Detail', required: true, validation: {} }] }],
  };
}

function seedPublishedForm(db) {
  const v1 = formSchema('Feedback V1'), v2 = formSchema('Feedback V2');
  db.forms.set('form_feedback', { id: 'form_feedback', public_id: 'public_feedback', publication_state: 'OPEN', published_data: JSON.stringify(v2), published_version: 2, published_at: '2026-08-24T02:00:00.000Z', open_at: null, close_at: null });
  db.versions.set('form_feedback:1', { form_id: 'form_feedback', version: 1, data: JSON.stringify(v1), published_at: '2026-08-24T01:00:00.000Z' });
  db.versions.set('form_feedback:2', { form_id: 'form_feedback', version: 2, data: JSON.stringify(v2), published_at: '2026-08-24T02:00:00.000Z' });
}

async function call(env, path, { method = 'GET', token, admin = false, body, rawBody, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`);
  if (admin) requestHeaders.set('Authorization', `Bearer ${env.TEAM_KEY}`);
  if (body !== undefined || rawBody !== undefined) requestHeaders.set('content-type', 'application/json');
  const request = new Request(`https://forms.test${path}`, { method, headers: requestHeaders, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const response = await worker.fetch(request, env);
  return { response, data: await response.json() };
}

test('application registry provisions one-time hashed credentials and least-privilege permissions', async () => {
  const db = new IntegrationD1(), env = { DB: db, TEAM_KEY: 'team-key-for-tests' };
  seedPublishedForm(db);
  const created = await call(env, '/api/admin/integrations/applications', { method: 'POST', admin: true, body: { name: 'Feedback Client' } });
  assert.equal(created.response.status, 201);
  const applicationId = created.data.application.id;
  assert.match(applicationId, /^app_/);

  const permissions = await call(env, `/api/admin/integrations/applications/${applicationId}/permissions`, { method: 'PUT', admin: true, body: { permissions: ['read_form_schema'] } });
  assert.equal(permissions.response.status, 200);
  const credential = await call(env, `/api/admin/integrations/applications/${applicationId}/credentials`, { method: 'POST', admin: true, body: { label: 'primary' } });
  assert.equal(credential.response.status, 201);
  assert.match(credential.data.secret, /^goi_int_/);
  assert.notEqual([...db.credentials.values()][0].secret_hash, credential.data.secret);

  const formDenied = await call(env, '/api/integrations/forms/public_feedback/schema', { token: credential.data.secret });
  assert.equal(formDenied.response.status, 403);
  assert.equal(formDenied.data.code, 'FORM_ACCESS_DENIED');
  const forms = await call(env, `/api/admin/integrations/applications/${applicationId}/forms`, { method: 'PUT', admin: true, body: { formIds: ['form_feedback'] } });
  assert.equal(forms.response.status, 200);
  const schema = await call(env, '/api/integrations/forms/public_feedback/schema', { token: credential.data.secret });
  assert.equal(schema.response.status, 200);
  const denied = await call(env, '/api/integrations/forms/public_feedback/responses', { method: 'POST', token: credential.data.secret, body: { answers: { question_1: 'hello' } } });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.data.code, 'PERMISSION_DENIED');

  const listed = await call(env, '/api/admin/integrations/applications', { admin: true });
  assert.equal(listed.response.status, 200);
  assert.equal(JSON.stringify(listed.data).includes(credential.data.secret), false);
  assert.equal(JSON.stringify(listed.data).includes('secret_hash'), false);

  const activeDelete = await call(env, `/api/admin/integrations/applications/${applicationId}/credentials/${credential.data.credential.id}`, { method: 'DELETE', admin: true });
  assert.equal(activeDelete.response.status, 409);
  assert.equal(activeDelete.data.code, 'CREDENTIAL_ACTIVE');
  const revoked = await call(env, `/api/admin/integrations/applications/${applicationId}/credentials/${credential.data.credential.id}/revoke`, { method: 'POST', admin: true });
  assert.equal(revoked.response.status, 200);
  const rejectedAfterRevoke = await call(env, '/api/integrations/forms/public_feedback/schema', { token: credential.data.secret });
  assert.equal(rejectedAfterRevoke.response.status, 401);
  assert.equal(rejectedAfterRevoke.data.code, 'INVALID_CREDENTIAL');
  const deleted = await call(env, `/api/admin/integrations/applications/${applicationId}/credentials/${credential.data.credential.id}`, { method: 'DELETE', admin: true });
  assert.equal(deleted.response.status, 200);
  assert.equal(db.credentials.has(credential.data.credential.id), false);
  const activeApplicationDelete = await call(env, `/api/admin/integrations/applications/${applicationId}`, { method: 'DELETE', admin: true });
  assert.equal(activeApplicationDelete.response.status, 409);
  assert.equal(activeApplicationDelete.data.code, 'APPLICATION_ACTIVE');
  await call(env, `/api/admin/integrations/applications/${applicationId}`, { method: 'PATCH', admin: true, body: { status: 'REVOKED' } });
  const deletedApplication = await call(env, `/api/admin/integrations/applications/${applicationId}`, { method: 'DELETE', admin: true });
  assert.equal(deletedApplication.response.status, 200);
  assert.equal(db.applications.has(applicationId), false);
});

test('schema API authenticates applications and supports current and pinned published versions only', async () => {
  const db = new IntegrationD1(), env = { DB: db, TEAM_KEY: 'team-key' };
  seedPublishedForm(db);
  db.forms.set('form_draft', { id: 'form_draft', public_id: 'draft_only', publication_state: 'DRAFT', published_data: null, published_version: 0, published_at: null, open_at: null, close_at: null });
  const app = await call(env, '/api/admin/integrations/applications', { method: 'POST', admin: true, body: { name: 'Schema Client' } });
  const appId = app.data.application.id;
  await call(env, `/api/admin/integrations/applications/${appId}/permissions`, { method: 'PUT', admin: true, body: { permissions: ['read_form_schema'] } });
  await call(env, `/api/admin/integrations/applications/${appId}/forms`, { method: 'PUT', admin: true, body: { formIds: ['form_feedback'] } });
  const credential = await call(env, `/api/admin/integrations/applications/${appId}/credentials`, { method: 'POST', admin: true, body: {} });
  const token = credential.data.secret;

  const invalid = await call(env, '/api/integrations/forms/public_feedback/schema', { token: 'invalid-credential-that-is-long-enough-for-lookup' });
  assert.equal(invalid.response.status, 401);
  const teamKeyIsNotCredential = await call(env, '/api/integrations/forms/public_feedback/schema', { token: env.TEAM_KEY });
  assert.equal(teamKeyIsNotCredential.response.status, 401);
  const current = await call(env, '/api/integrations/forms/public_feedback/schema', { token });
  assert.equal(current.data.publishedVersion, 2);
  assert.equal(current.data.schema.title, 'Feedback V2');
  const pinned = await call(env, '/api/integrations/forms/public_feedback/schema?version=1', { token });
  assert.equal(pinned.response.status, 200);
  assert.equal(pinned.data.publishedVersion, 1);
  assert.equal(pinned.data.schema.title, 'Feedback V1');
  const missing = await call(env, '/api/integrations/forms/public_feedback/schema?version=99', { token });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.data.code, 'PUBLISHED_VERSION_NOT_FOUND');
  const draft = await call(env, '/api/integrations/forms/draft_only/schema', { token });
  assert.equal(draft.response.status, 404);

  const changed = await call(env, `/api/admin/integrations/applications/${appId}`, { method: 'PATCH', admin: true, body: { status: 'DISABLED' } });
  assert.equal(changed.response.status, 200);
  const disabled = await call(env, '/api/integrations/forms/public_feedback/schema', { token });
  assert.equal(disabled.response.status, 403);
  assert.equal(disabled.data.code, 'APPLICATION_DISABLED');
  db.applications.get(appId).status = 'REVOKED';
  const revokedApplication = await call(env, '/api/integrations/forms/public_feedback/schema', { token });
  assert.equal(revokedApplication.response.status, 403);
  assert.equal(revokedApplication.data.code, 'APPLICATION_REVOKED');
});

test('integration schema and response contract preserve IOC matrix scale and numeric zero', async () => {
  const db = new IntegrationD1(), env = { DB: db, TEAM_KEY: 'team-key-ioc' };
  seedPublishedForm(db);
  const iocForm = formSchema('IOC Feedback');
  iocForm.sections[0].blocks = [{
    id: 'ioc_matrix', type: 'question', questionType: 'rating_matrix', title: 'ประเมินความสอดคล้อง', required: true,
    condition: { enabled: false }, matrixRows: [{ id: 'content', label: 'เนื้อหาเหมาะสม' }],
    matrixScale: { preset: 'ioc', iocThreshold: 0.6, options: [
      { id: 'minus', displayLabel: 'ไม่สอดคล้อง', value: -1 },
      { id: 'zero', displayLabel: 'ไม่แน่ใจ', value: 0 },
      { id: 'plus', displayLabel: 'สอดคล้อง', value: 1 },
    ] },
  }];
  const published = db.forms.get('form_feedback');
  published.published_data = JSON.stringify(iocForm);
  db.versions.get('form_feedback:2').data = JSON.stringify(iocForm);

  const app = await call(env, '/api/admin/integrations/applications', { method: 'POST', admin: true, body: { name: 'IOC Game Client' } });
  const appId = app.data.application.id;
  await call(env, `/api/admin/integrations/applications/${appId}/permissions`, { method: 'PUT', admin: true, body: { permissions: ['read_form_schema', 'submit_response'] } });
  await call(env, `/api/admin/integrations/applications/${appId}/forms`, { method: 'PUT', admin: true, body: { formIds: ['form_feedback'] } });
  const credential = await call(env, `/api/admin/integrations/applications/${appId}/credentials`, { method: 'POST', admin: true, body: {} });
  const token = credential.data.secret;

  const schema = await call(env, '/api/integrations/forms/public_feedback/schema', { token });
  assert.equal(schema.response.status, 200);
  const matrix = schema.data.schema.sections[0].blocks[0];
  assert.equal(matrix.required, true);
  assert.deepEqual(matrix.matrixRows, [{ id: 'content', label: 'เนื้อหาเหมาะสม' }]);
  assert.equal(matrix.matrixScale.preset, 'ioc');
  assert.equal(matrix.matrixScale.iocThreshold, 0.6);
  assert.deepEqual(matrix.matrixScale.options.map(option => [option.displayLabel, option.value]), [['ไม่สอดคล้อง', -1], ['ไม่แน่ใจ', 0], ['สอดคล้อง', 1]]);

  const submitted = await call(env, '/api/integrations/forms/public_feedback/responses', { method: 'POST', token, body: { answers: { ioc_matrix: { __type: 'matrix', rows: { content: 0 } } } } });
  assert.equal(submitted.response.status, 201, JSON.stringify(submitted.data));
  const stored = JSON.parse(db.responses.get(submitted.data.id).answers);
  assert.equal(stored.ioc_matrix.rows.content, 0);
});

test('integration schema is available only while the current publication state is effectively OPEN', async () => {
  const db = new IntegrationD1(), env = { DB: db, TEAM_KEY: 'team-key' };
  seedPublishedForm(db);
  const app = await call(env, '/api/admin/integrations/applications', { method: 'POST', admin: true, body: { name: 'Publication Gate Client' } });
  const appId = app.data.application.id;
  await call(env, `/api/admin/integrations/applications/${appId}/permissions`, { method: 'PUT', admin: true, body: { permissions: ['read_form_schema'] } });
  await call(env, `/api/admin/integrations/applications/${appId}/forms`, { method: 'PUT', admin: true, body: { formIds: ['form_feedback'] } });
  const credential = await call(env, `/api/admin/integrations/applications/${appId}/credentials`, { method: 'POST', admin: true, body: {} });
  const token = credential.data.secret, published = db.forms.get('form_feedback');

  const open = await call(env, '/api/integrations/forms/public_feedback/schema', { token });
  assert.equal(open.response.status, 200);

  for (const state of ['CLOSED', 'ARCHIVED', 'DRAFT']) {
    Object.assign(published, { publication_state: state, open_at: null, close_at: null });
    const denied = await call(env, '/api/integrations/forms/public_feedback/schema?version=1', { token });
    assert.equal(denied.response.status, 403);
    assert.deepEqual({ code: denied.data.code, state: denied.data.state }, { code: 'FORM_NOT_OPEN', state });
  }

  Object.assign(published, { publication_state: 'SCHEDULED', open_at: new Date(Date.now() + 60_000).toISOString(), close_at: new Date(Date.now() + 120_000).toISOString() });
  const scheduled = await call(env, '/api/integrations/forms/public_feedback/schema', { token });
  assert.equal(scheduled.response.status, 403);
  assert.deepEqual({ code: scheduled.data.code, state: scheduled.data.state }, { code: 'FORM_NOT_OPEN', state: 'SCHEDULED' });

  Object.assign(published, { publication_state: 'SCHEDULED', open_at: new Date(Date.now() - 60_000).toISOString(), close_at: new Date(Date.now() + 60_000).toISOString() });
  const reachedOpenTime = await call(env, '/api/integrations/forms/public_feedback/schema', { token });
  assert.equal(reachedOpenTime.response.status, 200);

  Object.assign(published, { publication_state: 'OPEN', open_at: null, close_at: new Date(Date.now() - 1_000).toISOString() });
  const expired = await call(env, '/api/integrations/forms/public_feedback/schema', { token });
  assert.equal(expired.response.status, 403);
  assert.deepEqual({ code: expired.data.code, state: expired.data.state }, { code: 'FORM_NOT_OPEN', state: 'CLOSED' });
});

test('integration responses retain pinned version and server-derived source metadata', async () => {
  const db = new IntegrationD1(), env = { DB: db, TEAM_KEY: 'team-key' };
  seedPublishedForm(db);
  const app = await call(env, '/api/admin/integrations/applications', { method: 'POST', admin: true, body: { name: 'Game Feedback' } });
  const appId = app.data.application.id;
  await call(env, `/api/admin/integrations/applications/${appId}/permissions`, { method: 'PUT', admin: true, body: { permissions: ['submit_response'] } });
  await call(env, `/api/admin/integrations/applications/${appId}/forms`, { method: 'PUT', admin: true, body: { formIds: ['form_feedback'] } });
  const credential = await call(env, `/api/admin/integrations/applications/${appId}/credentials`, { method: 'POST', admin: true, body: {} });
  const token = credential.data.secret;

  const submitted = await call(env, '/api/integrations/forms/public_feedback/responses', { method: 'POST', token, body: {
    publishedVersion: 1,
    answers: { question_1: 'พบปัญหาในฉาก' },
    source: { version: '0.4.7', session: 'session_abc', platform: 'windows', metadata: { scene: 'example-step' } },
  } });
  assert.equal(submitted.response.status, 201);
  assert.equal(submitted.data.publishedVersion, 1);
  const stored = db.responses.get(submitted.data.id);
  assert.equal(stored.source, 'integration');
  assert.equal(stored.source_app_id, appId);
  assert.equal(stored.source_version, '0.4.7');
  assert.equal(stored.source_session, 'session_abc');
  assert.equal(JSON.parse(stored.source_metadata).scene, 'example-step');

  const spoofed = await call(env, '/api/integrations/forms/public_feedback/responses', { method: 'POST', token, body: { publishedVersion: 1, source_app: 'app_other', answers: { question_1: 'x' } } });
  assert.equal(spoofed.response.status, 400);
  assert.equal(spoofed.data.code, 'SOURCE_APP_DERIVED');
  const malformed = await call(env, '/api/integrations/forms/public_feedback/responses', { method: 'POST', token, rawBody: '{broken' });
  assert.equal(malformed.response.status, 400);
  assert.equal(malformed.data.code, 'MALFORMED_JSON');
  const oversized = await call(env, '/api/integrations/forms/public_feedback/responses', { method: 'POST', token, rawBody: JSON.stringify({ answers: { question_1: 'x'.repeat(270_000) } }) });
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.data.code, 'PAYLOAD_TOO_LARGE');

  db.forms.get('form_feedback').publication_state = 'CLOSED';
  const closed = await call(env, '/api/integrations/forms/public_feedback/responses', { method: 'POST', token, body: { publishedVersion: 1, answers: { question_1: 'bypass' } } });
  assert.equal(closed.response.status, 403);
  assert.deepEqual({ code: closed.data.code, state: closed.data.state }, { code: 'FORM_NOT_OPEN', state: 'CLOSED' });

  const responses = await call(env, '/api/forms/form_feedback/responses', { admin: true });
  assert.equal(responses.response.status, 200);
  assert.equal(responses.data.responses[0].source_app_id, appId);
  assert.equal(responses.data.responses[0].source_app_name, 'Game Feedback');
  assert.deepEqual(responses.data.responses[0].source_metadata, { scene: 'example-step' });
});
