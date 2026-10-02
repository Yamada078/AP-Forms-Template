import http from 'node:http';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url));
const form = { version: 5, title: 'UI Publish QA', description: 'Published snapshot', theme: { accent: '#7c9cff', paperWidth: 900 }, sections: [{ id: 'page_1', title: 'หน้าแรก', description: '', nextLabel: 'ส่งคำตอบ', blocks: [{ id: 'name_q', type: 'question', questionType: 'short', title: 'คำตอบทดสอบ', required: false, width: 100, condition: { enabled: false }, validation: { enabled: false }, options: [], matrixRows: [] }], routingRules: [] }] };
let publication = { state: 'OPEN', storedState: 'OPEN', publicId: 'UiTestPublic1234', publishedVersion: 2, publishedAt: '2026-08-20T01:00:00.000Z', openAt: null, closeAt: null, hasPublishedSnapshot: true };
let applications = [], applicationSequence = 0, credentialSequence = 0;
const send = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
const readJson = req => new Promise(resolve => { let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } }); });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4173'), path = url.pathname;
  if (path === '/api/health') return send(res, 200, { ok: true, db: true, teamKeyConfigured: true, realtimeCollab: false, appVersion: 'ui-fixture' });
  if (path === '/api/login') return send(res, 200, { ok: true });
  if (path === '/api/forms' && req.method === 'GET') return send(res, 200, { forms: [{ id: 'form_ui', title: form.title, published: true, updated_at: '2026-08-20T01:00:00.000Z', publication }] });
  if (path === '/api/forms/form_ui' && req.method === 'GET') return send(res, 200, { form, published: true, updated_at: '2026-08-20T01:00:00.000Z', publication });
  if (path === '/api/forms/form_ui/responses' && req.method === 'GET') return send(res, 200, { responses: [{ id: 'response_ui', respondent_name: 'QA Respondent', respondent_meta: {}, answers: { name_q: 'คำตอบ Version 2' }, path: ['page_1'], score: 0, published_version: 2, source: 'public_form', source_metadata: {}, created_at: '2026-08-20T02:00:00.000Z' }, { id: 'response_integration_ui', respondent_name: 'Player QA', respondent_meta: {}, answers: { name_q: 'Integration feedback' }, path: ['page_1'], score: 0, published_version: 2, source: 'integration', source_app_id: applications[0]?.id || 'app_ui', source_app_name: applications[0]?.name || 'Example application', source_version: '0.4.7', source_platform: 'Windows', source_session: 'session_ui', source_metadata: { scene: 'example-step' }, created_at: '2026-08-20T03:00:00.000Z' }], versions: [{ version: 2, form, publishedAt: publication.publishedAt }] });
  if (path === '/api/admin/integrations/applications' && req.method === 'GET') return send(res, 200, { capabilities: ['read_form_schema', 'submit_response', 'read_question_pack', 'submit_game_result', 'read_responses'], forms: [{ id: 'form_ui', title: form.title, public_id: publication.publicId, published_version: publication.publishedVersion, publication_state: publication.state }], applications });
  if (path === '/api/admin/integrations/applications' && req.method === 'POST') {
    const body = await readJson(req), now = new Date().toISOString();
    const application = { id: `app_ui_${++applicationSequence}`, name: String(body.name || 'Application'), status: 'ACTIVE', permissions: [], credentials: [], allowedFormIds: [], created_at: now, updated_at: now };
    applications.unshift(application);
    return send(res, 201, { application });
  }
  let integrationMatch = path.match(/^\/api\/admin\/integrations\/applications\/([^/]+)$/);
  if (integrationMatch && req.method === 'PATCH') {
    const application = applications.find(item => item.id === decodeURIComponent(integrationMatch[1]));
    if (!application) return send(res, 404, { error: 'ไม่พบ Application' });
    const body = await readJson(req); application.status = String(body.status || application.status); application.updated_at = new Date().toISOString();
    if (application.status === 'REVOKED') application.credentials.forEach(credential => { credential.status = 'REVOKED'; credential.revoked_at = application.updated_at; });
    return send(res, 200, { application });
  }
  if (integrationMatch && req.method === 'DELETE') {
    const index = applications.findIndex(item => item.id === decodeURIComponent(integrationMatch[1]));
    if (index < 0) return send(res, 404, { error: 'ไม่พบ Application' });
    if (applications[index].status !== 'REVOKED') return send(res, 409, { error: 'ต้อง Revoke Application ก่อนจึงจะลบได้', code: 'APPLICATION_ACTIVE' });
    const [application] = applications.splice(index, 1);
    return send(res, 200, { ok: true, applicationId: application.id, deleted: true });
  }
  integrationMatch = path.match(/^\/api\/admin\/integrations\/applications\/([^/]+)\/permissions$/);
  if (integrationMatch && req.method === 'PUT') {
    const application = applications.find(item => item.id === decodeURIComponent(integrationMatch[1]));
    if (!application) return send(res, 404, { error: 'ไม่พบ Application' });
    const body = await readJson(req); application.permissions = Array.isArray(body.permissions) ? body.permissions : []; application.updated_at = new Date().toISOString();
    return send(res, 200, { applicationId: application.id, permissions: application.permissions });
  }
  integrationMatch = path.match(/^\/api\/admin\/integrations\/applications\/([^/]+)\/forms$/);
  if (integrationMatch && req.method === 'PUT') {
    const application = applications.find(item => item.id === decodeURIComponent(integrationMatch[1]));
    if (!application) return send(res, 404, { error: 'ไม่พบ Application' });
    const body = await readJson(req); application.allowedFormIds = Array.isArray(body.formIds) ? body.formIds : []; application.updated_at = new Date().toISOString();
    return send(res, 200, { applicationId: application.id, allowedFormIds: application.allowedFormIds });
  }
  integrationMatch = path.match(/^\/api\/admin\/integrations\/applications\/([^/]+)\/credentials$/);
  if (integrationMatch && req.method === 'POST') {
    const application = applications.find(item => item.id === decodeURIComponent(integrationMatch[1]));
    if (!application) return send(res, 404, { error: 'ไม่พบ Application' });
    const body = await readJson(req), now = new Date().toISOString(), secret = `goi_int_ui_once_${String(++credentialSequence).padStart(24, 'x')}`;
    const credential = { id: `cred_ui_${credentialSequence}`, application_id: application.id, label: body.label || null, secret_prefix: `${secret.slice(0, 16)}…`, status: 'ACTIVE', expires_at: body.expiresAt || null, created_at: now, updated_at: now, revoked_at: null };
    application.credentials.unshift(credential); application.updated_at = now;
    return send(res, 201, { credential: { id: credential.id, applicationId: application.id, label: credential.label, secretPrefix: credential.secret_prefix, status: credential.status, createdAt: now }, secret, warning: 'shown once' });
  }
  integrationMatch = path.match(/^\/api\/admin\/integrations\/applications\/([^/]+)\/credentials\/([^/]+)\/revoke$/);
  if (integrationMatch && req.method === 'POST') {
    const application = applications.find(item => item.id === decodeURIComponent(integrationMatch[1])), credential = application?.credentials.find(item => item.id === decodeURIComponent(integrationMatch[2]));
    if (!credential) return send(res, 404, { error: 'ไม่พบ Credential' });
    credential.status = 'REVOKED'; credential.revoked_at = new Date().toISOString(); credential.updated_at = credential.revoked_at;
    return send(res, 200, { ok: true, credentialId: credential.id, revokedAt: credential.revoked_at });
  }
  integrationMatch = path.match(/^\/api\/admin\/integrations\/applications\/([^/]+)\/credentials\/([^/]+)$/);
  if (integrationMatch && req.method === 'DELETE') {
    const application = applications.find(item => item.id === decodeURIComponent(integrationMatch[1])), index = application?.credentials.findIndex(item => item.id === decodeURIComponent(integrationMatch[2]));
    if (index == null || index < 0) return send(res, 404, { error: 'ไม่พบ Credential' });
    if (application.credentials[index].status !== 'REVOKED') return send(res, 409, { error: 'ต้อง Revoke Credential ก่อนจึงจะลบได้', code: 'CREDENTIAL_ACTIVE' });
    const [credential] = application.credentials.splice(index, 1);
    return send(res, 200, { ok: true, credentialId: credential.id, deleted: true });
  }
  if (path === '/api/collab-ticket') return send(res, 503, { error: 'Fixture has no collaboration socket' });
  if (path === '/api/public/forms/ui-scheduled') return send(res, 200, { publication: { ...publication, state: 'SCHEDULED', openAt: '2026-08-21T01:00:00.000Z' } });
  if (path === '/api/public/forms/ui-closed') return send(res, 200, { publication: { ...publication, state: 'CLOSED', closeAt: '2026-08-20T01:00:00.000Z' } });
  if (path === '/api/public/forms/ui-open') return send(res, 200, { publication, form });
  if (path === '/api/public/forms/ui-revoked') return send(res, 410, { error: 'ลิงก์แบบฟอร์มนี้ไม่สามารถใช้งานได้แล้ว', code: 'LINK_REVOKED', state: 'REVOKED' });
  if (path.startsWith('/api/')) return send(res, 404, { error: 'Fixture route not found' });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
});

const fixturePort = Number(process.env.GOI_UI_FIXTURE_PORT || 4173);
server.listen(fixturePort, '127.0.0.1', () => console.log(`UI fixture listening on http://127.0.0.1:${fixturePort}`));
