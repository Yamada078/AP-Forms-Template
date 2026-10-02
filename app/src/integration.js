import { consumerPackProjection } from './question-packs.js';
import { gradeQuestionPackSnapshot } from './assessments.js';

const encoder = new TextEncoder();

export const INTEGRATION_CAPABILITIES = Object.freeze([
  'read_form_schema',
  'submit_response',
  'read_question_pack',
  'submit_game_result',
  'read_responses',
]);

const CAPABILITY_SET = new Set(INTEGRATION_CAPABILITIES);
const APPLICATION_STATUSES = new Set(['ACTIVE', 'DISABLED', 'REVOKED']);
const rateWindows = new Map();

function bearer(request) {
  const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function credentialHash(secret) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(secret)));
}

function randomSecret(base64url) {
  return `goi_int_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

function parsePositiveVersion(value) {
  if (value == null || value === '') return { value: null };
  const text = String(value);
  if (!/^[1-9]\d{0,8}$/.test(text)) return { error: 'Published Version ไม่ถูกต้อง' };
  return { value: Number(text) };
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return null; }
}

function limitedString(value, maxLength, field) {
  if (value == null || value === '') return { value: null };
  if (typeof value !== 'string' && typeof value !== 'number') return { error: `${field} ไม่ถูกต้อง` };
  const text = String(value).trim();
  if (text.length > maxLength) return { error: `${field} ยาวเกินกำหนด` };
  return { value: text || null };
}

async function readJson(request, maxBytes) {
  const contentType = request.headers.get('content-type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return { error: 'Content-Type ต้องเป็น application/json', status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' };
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { error: 'Payload ใหญ่เกินกำหนด', status: 413, code: 'PAYLOAD_TOO_LARGE' };
  let raw;
  try { raw = await request.text(); } catch { return { error: 'ไม่สามารถอ่าน Payload ได้', status: 400, code: 'INVALID_PAYLOAD' }; }
  if (encoder.encode(raw).byteLength > maxBytes) return { error: 'Payload ใหญ่เกินกำหนด', status: 413, code: 'PAYLOAD_TOO_LARGE' };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return { value };
  } catch {
    return { error: 'JSON Payload ไม่ถูกต้อง', status: 400, code: 'MALFORMED_JSON' };
  }
}

function rateLimit(key, limit, now = Date.now()) {
  const windowMs = 60_000, bucket = Math.floor(now / windowMs), current = rateWindows.get(key);
  if (!current || current.bucket !== bucket) {
    rateWindows.set(key, { bucket, count: 1 });
    if (rateWindows.size > 2000) {
      for (const [entryKey, entry] of rateWindows) if (entry.bucket < bucket - 1) rateWindows.delete(entryKey);
    }
    return null;
  }
  current.count += 1;
  if (current.count <= limit) return null;
  return Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000));
}

async function authorize(request, env, capability, bad) {
  const token = bearer(request);
  if (token.length < 32 || token.length > 512) return { response: bad('Integration credential ไม่ถูกต้อง', 401, { code: 'INVALID_CREDENTIAL' }) };
  const clientAddress = String(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim().slice(0, 80);
  const authRetryAfter = rateLimit(`auth:${capability}:${clientAddress}`, capability === 'submit_game_result' ? 3000 : 300);
  if (authRetryAfter) return { response: bad('ส่งคำขอ Authentication ถี่เกินกำหนด', 429, { code: 'RATE_LIMITED', retryAfter: authRetryAfter }), retryAfter: authRetryAfter };
  const hash = await credentialHash(token);
  const principal = await env.DB.prepare(`SELECT c.id AS credential_id,c.application_id,c.status AS credential_status,c.expires_at,
      a.name AS application_name,a.status AS application_status,p.capability AS granted_capability
    FROM integration_credentials c
    JOIN applications a ON a.id=c.application_id
    LEFT JOIN application_permissions p ON p.application_id=a.id AND p.capability=?
    WHERE c.secret_hash=? LIMIT 1`).bind(capability, hash).first();
  if (!principal || principal.credential_status !== 'ACTIVE' || (principal.expires_at && Date.parse(principal.expires_at) <= Date.now())) {
    return { response: bad('Integration credential ไม่ถูกต้องหรือถูกเพิกถอนแล้ว', 401, { code: 'INVALID_CREDENTIAL' }) };
  }
  if (principal.application_status !== 'ACTIVE') {
    return { response: bad('Application ไม่พร้อมใช้งาน', 403, { code: principal.application_status === 'REVOKED' ? 'APPLICATION_REVOKED' : 'APPLICATION_DISABLED' }) };
  }
  if (principal.granted_capability !== capability) return { response: bad('Application ไม่มี Permission ที่จำเป็น', 403, { code: 'PERMISSION_DENIED', requiredCapability: capability }) };
  const retryAfter = rateLimit(`${principal.credential_id}:${capability}`, capability === 'submit_response' ? 30 : capability === 'submit_game_result' ? 1200 : 120);
  if (retryAfter) return { response: bad('ส่งคำขอถี่เกินกำหนด', 429, { code: 'RATE_LIMITED', retryAfter }), retryAfter };
  return { principal };
}

async function publishedSnapshot(env, publicId, version) {
  if (version == null) {
    return env.DB.prepare(`SELECT id AS form_id,public_id,publication_state,published_data,
      published_version,published_at,open_at,close_at
      FROM forms WHERE public_id=? AND published_data IS NOT NULL AND published_version>0`).bind(publicId).first();
  }
  return env.DB.prepare(`SELECT f.id AS form_id,f.public_id,f.publication_state,v.data AS published_data,
      v.version AS published_version,v.published_at,f.open_at,f.close_at
      FROM forms f JOIN form_versions v ON v.form_id=f.id
      WHERE f.public_id=? AND v.version=?`).bind(publicId, version).first();
}

async function requireFormAccess(env, applicationId, formId, bad) {
  const allowed = await env.DB.prepare('SELECT 1 AS allowed FROM application_forms WHERE application_id=? AND form_id=? LIMIT 1').bind(applicationId, formId).first();
  return allowed ? null : bad('Application ไม่ได้รับอนุญาตให้ใช้ Form นี้', 403, { code: 'FORM_ACCESS_DENIED', formId });
}

async function publishedQuestionPack(env, packId, version) {
  const row = version == null
    ? await env.DB.prepare(`SELECT p.id AS pack_id,p.name AS pack_name,p.published_version AS pack_version,v.snapshot_json,v.published_at
      FROM question_packs p JOIN question_pack_versions v ON v.pack_id=p.id AND v.version=p.published_version
      WHERE p.id=? AND p.status='ACTIVE' AND p.published_version>0`).bind(packId).first()
    : await env.DB.prepare(`SELECT p.id AS pack_id,p.name AS pack_name,v.version AS pack_version,v.snapshot_json,v.published_at
      FROM question_packs p JOIN question_pack_versions v ON v.pack_id=p.id AND v.version=?
      WHERE p.id=? AND p.status='ACTIVE' AND p.published_version>=v.version`).bind(version, packId).first();
  if (!row) return null;
  let snapshot;
  try { snapshot = JSON.parse(row.snapshot_json); } catch { return { error: 'Published Question Pack Snapshot ไม่สมบูรณ์' }; }
  return Array.isArray(snapshot?.questions) ? { row, snapshot } : { error: 'Published Question Pack Snapshot ไม่สมบูรณ์' };
}

async function requireQuestionPackAccess(env, applicationId, packId, bad) {
  const allowed = await env.DB.prepare('SELECT 1 AS allowed FROM application_question_packs WHERE application_id=? AND pack_id=? LIMIT 1').bind(applicationId, packId).first();
  return allowed ? null : bad('Application ไม่ได้รับอนุญาตให้ใช้ Question Pack นี้', 403, { code: 'QUESTION_PACK_ACCESS_DENIED', packId });
}

async function allowedQuestionPacks(env, applicationId) {
  const result = await env.DB.prepare(`SELECT p.id,p.name,p.description,p.published_version,p.published_at
    FROM application_question_packs a JOIN question_packs p ON p.id=a.pack_id
    WHERE a.application_id=? AND p.status='ACTIVE' AND p.published_version>0
    ORDER BY p.updated_at DESC`).bind(applicationId).all();
  return (result.results || []).map(row => ({
    packId: row.id,
    packName: row.name,
    description: row.description || '',
    publishedVersion: Number(row.published_version),
    publishedAt: row.published_at,
  }));
}

function sourceMetadata(body) {
  if (Object.prototype.hasOwnProperty.call(body, 'source_app') || Object.prototype.hasOwnProperty.call(body, 'sourceApp')) {
    return { error: 'source_app ถูกกำหนดโดย Server เท่านั้น', code: 'SOURCE_APP_DERIVED' };
  }
  const source = body.source && typeof body.source === 'object' && !Array.isArray(body.source) ? body.source : {};
  if (Object.prototype.hasOwnProperty.call(source, 'app') || Object.prototype.hasOwnProperty.call(source, 'appId') || Object.prototype.hasOwnProperty.call(source, 'source_app')) {
    return { error: 'source_app ถูกกำหนดโดย Server เท่านั้น', code: 'SOURCE_APP_DERIVED' };
  }
  const version = limitedString(body.sourceVersion ?? source.version, 100, 'source_version');
  const session = limitedString(body.sourceSession ?? source.session, 200, 'source_session');
  const platform = limitedString(body.sourcePlatform ?? source.platform, 100, 'source_platform');
  if (version.error || session.error || platform.error) return { error: version.error || session.error || platform.error, code: 'INVALID_SOURCE_METADATA' };
  const metadata = body.sourceMetadata ?? source.metadata ?? {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return { error: 'source_metadata ต้องเป็น Object', code: 'INVALID_SOURCE_METADATA' };
  let serialized;
  try { serialized = JSON.stringify(metadata); } catch { return { error: 'source_metadata ไม่ถูกต้อง', code: 'INVALID_SOURCE_METADATA' }; }
  if (encoder.encode(serialized).byteLength > 16 * 1024) return { error: 'source_metadata ใหญ่เกินกำหนด', code: 'SOURCE_METADATA_TOO_LARGE', status: 413 };
  return { version: version.value, session: session.value, platform: platform.value, serialized };
}

function statusValue(input, fallback = null) {
  const value = input == null ? fallback : String(input).toUpperCase();
  return APPLICATION_STATUSES.has(value) ? value : null;
}

async function handleAdmin(request, env, path, helpers) {
  const { json, bad, readBody, id, base64url, isAdmin } = helpers;
  if (!isAdmin(request, env)) return bad('Unauthorized', 401);

  if (path === '/api/admin/integrations/applications') {
    if (request.method === 'GET') {
      const [applications, permissions, credentials, formAccess, forms, questionPackAccess, questionPacks] = await Promise.all([
        env.DB.prepare('SELECT id,name,status,created_at,updated_at FROM applications ORDER BY created_at DESC').all(),
        env.DB.prepare('SELECT application_id,capability,granted_at FROM application_permissions ORDER BY capability').all(),
        env.DB.prepare('SELECT id,application_id,label,secret_prefix,status,expires_at,created_at,updated_at,revoked_at FROM integration_credentials ORDER BY created_at DESC').all(),
        env.DB.prepare('SELECT application_id,form_id,granted_at FROM application_forms ORDER BY granted_at').all(),
        env.DB.prepare('SELECT id,title,public_id,published_version,publication_state FROM forms WHERE public_id IS NOT NULL AND published_data IS NOT NULL AND published_version>0 ORDER BY updated_at DESC').all(),
        env.DB.prepare('SELECT application_id,pack_id,granted_at FROM application_question_packs ORDER BY granted_at').all(),
        env.DB.prepare("SELECT id,name,published_version,published_at FROM question_packs WHERE status='ACTIVE' AND published_version>0 ORDER BY updated_at DESC").all(),
      ]);
      const permissionRows = permissions.results || [], credentialRows = credentials.results || [], formAccessRows = formAccess.results || [], questionPackAccessRows = questionPackAccess.results || [];
      return json({
        capabilities: INTEGRATION_CAPABILITIES,
        forms: forms.results || [],
        questionPacks: questionPacks.results || [],
        applications: (applications.results || []).map(application => ({
          ...application,
          permissions: permissionRows.filter(row => row.application_id === application.id).map(row => row.capability),
          credentials: credentialRows.filter(row => row.application_id === application.id),
          allowedFormIds: formAccessRows.filter(row => row.application_id === application.id).map(row => row.form_id),
          allowedQuestionPackIds: questionPackAccessRows.filter(row => row.application_id === application.id).map(row => row.pack_id),
        })),
      });
    }
    if (request.method === 'POST') {
      const body = await readBody(request, 32 * 1024);
      if (!body) return bad('ข้อมูล Application ไม่ถูกต้อง');
      const name = String(body.name || '').trim();
      const status = statusValue(body.status, 'ACTIVE');
      if (!name || name.length > 160) return bad('ชื่อ Application ต้องมีความยาว 1-160 ตัวอักษร');
      if (!status) return bad('สถานะ Application ไม่ถูกต้อง');
      const applicationId = id('app'), now = new Date().toISOString();
      await env.DB.prepare('INSERT INTO applications (id,name,status,created_at,updated_at) VALUES (?,?,?,?,?)').bind(applicationId, name, status, now, now).run();
      return json({ application: { id: applicationId, name, status, created_at: now, updated_at: now } }, 201);
    }
    return bad('Method not allowed', 405);
  }

  let match = path.match(/^\/api\/admin\/integrations\/applications\/([^/]+)$/);
  if (match && request.method === 'PATCH') {
    const applicationId = safeDecode(match[1]);
    if (!applicationId) return bad('Application ID ไม่ถูกต้อง');
    const current = await env.DB.prepare('SELECT id,name,status,created_at,updated_at FROM applications WHERE id=?').bind(applicationId).first();
    if (!current) return bad('ไม่พบ Application', 404);
    const body = await readBody(request, 32 * 1024);
    if (!body) return bad('ข้อมูล Application ไม่ถูกต้อง');
    const name = body.name == null ? current.name : String(body.name).trim();
    const status = statusValue(body.status, current.status);
    if (!name || name.length > 160) return bad('ชื่อ Application ต้องมีความยาว 1-160 ตัวอักษร');
    if (!status) return bad('สถานะ Application ไม่ถูกต้อง');
    if (current.status === 'REVOKED' && status !== 'REVOKED') return bad('Application ที่ถูก revoke แล้วไม่สามารถเปิดใช้งานอีกได้', 409);
    const now = new Date().toISOString();
    if (status === 'REVOKED' && current.status !== 'REVOKED') {
      await env.DB.batch([
        env.DB.prepare('UPDATE applications SET name=?,status=?,updated_at=? WHERE id=?').bind(name, status, now, applicationId),
        env.DB.prepare("UPDATE integration_credentials SET status='REVOKED',revoked_at=COALESCE(revoked_at,?),updated_at=? WHERE application_id=? AND status='ACTIVE'").bind(now, now, applicationId),
      ]);
    } else {
      await env.DB.prepare('UPDATE applications SET name=?,status=?,updated_at=? WHERE id=?').bind(name, status, now, applicationId).run();
    }
    return json({ application: { ...current, name, status, updated_at: now } });
  }
  if (match && request.method === 'DELETE') {
    const applicationId = safeDecode(match[1]);
    if (!applicationId) return bad('Application ID ไม่ถูกต้อง');
    const current = await env.DB.prepare('SELECT id,status FROM applications WHERE id=?').bind(applicationId).first();
    if (!current) return bad('ไม่พบ Application', 404);
    if (current.status !== 'REVOKED') return bad('ต้อง Revoke Application ก่อนจึงจะลบได้', 409, { code: 'APPLICATION_ACTIVE' });
    const results = await env.DB.batch([
      env.DB.prepare('DELETE FROM integration_credentials WHERE application_id=?').bind(applicationId),
      env.DB.prepare('DELETE FROM application_permissions WHERE application_id=?').bind(applicationId),
      env.DB.prepare('DELETE FROM application_forms WHERE application_id=?').bind(applicationId),
      env.DB.prepare('DELETE FROM application_question_packs WHERE application_id=?').bind(applicationId),
      env.DB.prepare("DELETE FROM applications WHERE id=? AND status='REVOKED'").bind(applicationId),
    ]);
    if (!results.at(-1)?.meta?.changes) return bad('ลบ Application ไม่สำเร็จ', 409);
    return json({ ok: true, applicationId, deleted: true });
  }

  match = path.match(/^\/api\/admin\/integrations\/applications\/([^/]+)\/permissions$/);
  if (match && request.method === 'PUT') {
    const applicationId = safeDecode(match[1]);
    if (!applicationId) return bad('Application ID ไม่ถูกต้อง');
    const application = await env.DB.prepare('SELECT id,status FROM applications WHERE id=?').bind(applicationId).first();
    if (!application) return bad('ไม่พบ Application', 404);
    const body = await readBody(request, 32 * 1024);
    if (!body || !Array.isArray(body.permissions)) return bad('permissions ต้องเป็น Array');
    const permissions = [...new Set(body.permissions.map(String))];
    const invalid = permissions.find(capability => !CAPABILITY_SET.has(capability));
    if (invalid) return bad(`Permission ไม่ถูกต้อง: ${invalid}`);
    const now = new Date().toISOString();
    const statements = [env.DB.prepare('DELETE FROM application_permissions WHERE application_id=?').bind(applicationId)];
    for (const capability of permissions) statements.push(env.DB.prepare('INSERT INTO application_permissions (application_id,capability,granted_at) VALUES (?,?,?)').bind(applicationId, capability, now));
    await env.DB.batch(statements);
    return json({ applicationId, permissions });
  }

  match = path.match(/^\/api\/admin\/integrations\/applications\/([^/]+)\/forms$/);
  if (match && request.method === 'PUT') {
    const applicationId = safeDecode(match[1]);
    if (!applicationId) return bad('Application ID ไม่ถูกต้อง');
    const application = await env.DB.prepare('SELECT id,status FROM applications WHERE id=?').bind(applicationId).first();
    if (!application) return bad('ไม่พบ Application', 404);
    if (application.status === 'REVOKED') return bad('Application ถูก revoke แล้ว', 409);
    const body = await readBody(request, 64 * 1024);
    if (!body || !Array.isArray(body.formIds)) return bad('formIds ต้องเป็น Array');
    const formIds = [...new Set(body.formIds.map(value => String(value).trim()).filter(Boolean))];
    if (formIds.length > 500) return bad('เลือก Form ได้สูงสุด 500 รายการ');
    if (formIds.length) {
      const placeholders = formIds.map(() => '?').join(',');
      const available = await env.DB.prepare(`SELECT id FROM forms WHERE id IN (${placeholders}) AND public_id IS NOT NULL AND published_data IS NOT NULL AND published_version>0`).bind(...formIds).all();
      const availableIds = new Set((available.results || []).map(row => row.id));
      const invalid = formIds.find(formId => !availableIds.has(formId));
      if (invalid) return bad(`Form ไม่พร้อมให้ Integration ใช้งาน: ${invalid}`, 400, { code: 'FORM_NOT_PUBLISHED' });
    }
    const now = new Date().toISOString();
    const statements = [env.DB.prepare('DELETE FROM application_forms WHERE application_id=?').bind(applicationId)];
    for (const formId of formIds) statements.push(env.DB.prepare('INSERT INTO application_forms (application_id,form_id,granted_at) VALUES (?,?,?)').bind(applicationId, formId, now));
    await env.DB.batch(statements);
    return json({ applicationId, allowedFormIds: formIds });
  }

  match = path.match(/^\/api\/admin\/integrations\/applications\/([^/]+)\/question-packs$/);
  if (match && request.method === 'PUT') {
    const applicationId = safeDecode(match[1]);
    if (!applicationId) return bad('Application ID ไม่ถูกต้อง');
    const application = await env.DB.prepare('SELECT id,status FROM applications WHERE id=?').bind(applicationId).first();
    if (!application) return bad('ไม่พบ Application', 404);
    if (application.status === 'REVOKED') return bad('Application ถูก revoke แล้ว', 409);
    const body = await readBody(request, 64 * 1024);
    const requestedIds = body?.questionPackIds ?? body?.packIds;
    if (!Array.isArray(requestedIds)) return bad('questionPackIds ต้องเป็น Array');
    const packIds = [...new Set(requestedIds.map(value => String(value).trim()).filter(Boolean))];
    if (packIds.length > 500) return bad('เลือก Question Pack ได้สูงสุด 500 รายการ');
    if (packIds.length) {
      const placeholders = packIds.map(() => '?').join(',');
      const available = await env.DB.prepare(`SELECT id FROM question_packs WHERE id IN (${placeholders}) AND status='ACTIVE' AND published_version>0`).bind(...packIds).all();
      const availableIds = new Set((available.results || []).map(row => row.id));
      const invalid = packIds.find(packId => !availableIds.has(packId));
      if (invalid) return bad(`Question Pack ไม่พร้อมให้ Integration ใช้งาน: ${invalid}`, 400, { code: 'QUESTION_PACK_NOT_PUBLISHED' });
    }
    const now = new Date().toISOString();
    const statements = [env.DB.prepare('DELETE FROM application_question_packs WHERE application_id=?').bind(applicationId)];
    for (const packId of packIds) statements.push(env.DB.prepare('INSERT INTO application_question_packs (application_id,pack_id,granted_at) VALUES (?,?,?)').bind(applicationId, packId, now));
    await env.DB.batch(statements);
    return json({ applicationId, allowedQuestionPackIds: packIds });
  }

  match = path.match(/^\/api\/admin\/integrations\/applications\/([^/]+)\/credentials$/);
  if (match && request.method === 'POST') {
    const applicationId = safeDecode(match[1]);
    if (!applicationId) return bad('Application ID ไม่ถูกต้อง');
    const application = await env.DB.prepare('SELECT id,status FROM applications WHERE id=?').bind(applicationId).first();
    if (!application) return bad('ไม่พบ Application', 404);
    if (application.status === 'REVOKED') return bad('Application ถูก revoke แล้ว', 409);
    const body = await readBody(request, 32 * 1024);
    if (!body) return bad('ข้อมูล Credential ไม่ถูกต้อง');
    const label = String(body.label || '').trim().slice(0, 120) || null;
    let expiresAt = null;
    if (body.expiresAt != null && body.expiresAt !== '') {
      const expiry = Date.parse(String(body.expiresAt));
      if (!Number.isFinite(expiry) || expiry <= Date.now()) return bad('expiresAt ต้องเป็นเวลาในอนาคต');
      expiresAt = new Date(expiry).toISOString();
    }
    const secret = randomSecret(base64url), secretHash = await credentialHash(secret), credentialId = id('cred'), now = new Date().toISOString();
    const secretPrefix = `${secret.slice(0, 16)}…`;
    await env.DB.prepare(`INSERT INTO integration_credentials
      (id,application_id,label,secret_hash,secret_prefix,status,expires_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'ACTIVE',?,?,?)`).bind(credentialId, applicationId, label, secretHash, secretPrefix, expiresAt, now, now).run();
    return json({
      credential: { id: credentialId, applicationId, label, secretPrefix, status: 'ACTIVE', expiresAt, createdAt: now },
      secret,
      warning: 'Secret นี้จะแสดงเพียงครั้งเดียว กรุณาเก็บไว้ใน Secret Manager ของ Application',
    }, 201);
  }

  match = path.match(/^\/api\/admin\/integrations\/applications\/([^/]+)\/credentials\/([^/]+)\/revoke$/);
  if (match && request.method === 'POST') {
    const applicationId = safeDecode(match[1]), credentialId = safeDecode(match[2]);
    if (!applicationId || !credentialId) return bad('Credential ID ไม่ถูกต้อง');
    const now = new Date().toISOString();
    const result = await env.DB.prepare("UPDATE integration_credentials SET status='REVOKED',revoked_at=COALESCE(revoked_at,?),updated_at=? WHERE id=? AND application_id=?")
      .bind(now, now, credentialId, applicationId).run();
    if (!result.meta?.changes) return bad('ไม่พบ Credential', 404);
    return json({ ok: true, credentialId, revokedAt: now });
  }

  match = path.match(/^\/api\/admin\/integrations\/applications\/([^/]+)\/credentials\/([^/]+)$/);
  if (match && request.method === 'DELETE') {
    const applicationId = safeDecode(match[1]), credentialId = safeDecode(match[2]);
    if (!applicationId || !credentialId) return bad('Credential ID ไม่ถูกต้อง');
    const credential = await env.DB.prepare('SELECT id,status FROM integration_credentials WHERE id=? AND application_id=?').bind(credentialId, applicationId).first();
    if (!credential) return bad('ไม่พบ Credential', 404);
    if (credential.status !== 'REVOKED') return bad('ต้อง Revoke Credential ก่อนจึงจะลบได้', 409, { code: 'CREDENTIAL_ACTIVE' });
    const result = await env.DB.prepare("DELETE FROM integration_credentials WHERE id=? AND application_id=? AND status='REVOKED'").bind(credentialId, applicationId).run();
    if (!result.meta?.changes) return bad('ลบ Credential ไม่สำเร็จ', 409);
    return json({ ok: true, credentialId, deleted: true });
  }

  return bad('Integration admin route not found', 404);
}

function gameQuestionCredit(question, answer, correct) {
  if (correct) return 1;
  const config = question.answerConfig || {};
  if (question.type === 'MULTIPLE_CHOICE') {
    const expected = new Set((config.correctIds || []).map(String));
    if (!expected.size) return 0;
    const supplied = new Set(Array.isArray(answer) ? answer.map(String) : []);
    const matches = [...supplied].filter(id => expected.has(id)).length;
    const mistakes = [...supplied].filter(id => !expected.has(id)).length;
    return Math.max(0, Math.min(1, (matches - mistakes) / expected.size));
  }
  if (question.type === 'ORDERING') {
    const expected = (config.correctOrder || (config.items || []).map(item => item.id)).map(String);
    if (!expected.length || !Array.isArray(answer) || answer.length !== expected.length) return 0;
    return answer.reduce((score, id, index) => score + (String(id) === expected[index] ? 1 : 0), 0) / expected.length;
  }
  if (question.type === 'MATCHING') {
    const pairs = config.pairs || [];
    if (!pairs.length || !answer || typeof answer !== 'object') return 0;
    return pairs.reduce((score, pair) => score + (String(answer[pair.leftId]) === String(pair.rightId) ? 1 : 0), 0) / pairs.length;
  }
  if (question.type === 'DRAG_DROP') {
    const required = (config.tokens || []).filter(token => token.targetId);
    if (!required.length || !answer || typeof answer !== 'object') return 0;
    const correctPlacements = required.filter(token => String(answer[token.id]) === String(token.targetId)).length;
    const wrongPlacements = Object.entries(answer).filter(([tokenId, targetId]) => {
      const token = (config.tokens || []).find(item => String(item.id) === String(tokenId));
      return token && String(token.targetId || '') !== String(targetId || '');
    }).length;
    return Math.max(0, Math.min(1, (correctPlacements - wrongPlacements) / required.length));
  }
  return 0;
}

function gameSolutionText(question) {
  const config = question.answerConfig || {};
  if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') {
    const correctIds = new Set((config.correctIds || []).map(String));
    return (config.choices || []).filter(choice => correctIds.has(String(choice.id))).map(choice => choice.text || 'รูปภาพ').join(', ');
  }
  if (question.type === 'TRUE_FALSE') return config.correctAnswer ? 'จริง' : 'เท็จ';
  if (question.type === 'SHORT_ANSWER') return (config.acceptedAnswers || []).join(' / ');
  if (question.type === 'ORDERING') {
    const byId = new Map((config.items || []).map(item => [String(item.id), item.text || 'รูปภาพ']));
    return (config.correctOrder || (config.items || []).map(item => item.id)).map(id => byId.get(String(id)) || String(id)).join(' → ');
  }
  if (question.type === 'MATCHING') return (config.pairs || []).map(pair => `${pair.leftText || pair.leftId} → ${pair.rightText || pair.rightId}`).join(' · ');
  if (question.type === 'DRAG_DROP') {
    const targets = new Map((config.targets || []).map(target => [String(target.id), target.label || 'พื้นที่วาง']));
    return (config.tokens || []).filter(token => token.targetId).map(token => `${token.text || 'รูปภาพ'} → ${targets.get(String(token.targetId)) || token.targetId}`).join(' · ');
  }
  return '';
}

export async function handleIntegrationRequest(request, env, helpers) {
  const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/api/admin/integrations/')) return handleAdmin(request, env, path, helpers);
  if (!path.startsWith('/api/integrations/')) return null;
  const { json, bad, normalizeRuntimeForm, validateRespondentMeta, validatePublicResponse, publicationView, id } = helpers;

  let match = path.match(/^\/api\/integrations\/forms\/([^/]+)\/schema$/);
  if (match && request.method === 'GET') {
    const auth = await authorize(request, env, 'read_form_schema', bad);
    if (auth.response) {
      if (auth.retryAfter) auth.response.headers.set('retry-after', String(auth.retryAfter));
      return auth.response;
    }
    const publicId = safeDecode(match[1]);
    if (!publicId || publicId.length > 200) return bad('Public ID ไม่ถูกต้อง');
    const requested = parsePositiveVersion(url.searchParams.get('version'));
    if (requested.error) return bad(requested.error, 400, { code: 'INVALID_VERSION' });
    const snapshot = await publishedSnapshot(env, publicId, requested.value);
    if (!snapshot) return bad(requested.value == null ? 'ไม่พบ Published Form' : 'ไม่พบ Published Version ที่ร้องขอ', 404, { code: requested.value == null ? 'PUBLISHED_FORM_NOT_FOUND' : 'PUBLISHED_VERSION_NOT_FOUND' });
    const accessDenied = await requireFormAccess(env, auth.principal.application_id, snapshot.form_id, bad);
    if (accessDenied) return accessDenied;
    const publication = publicationView(snapshot);
    if (publication.state !== 'OPEN') return bad('Form ไม่เปิดรับคำตอบ', 403, { code: 'FORM_NOT_OPEN', state: publication.state });
    let schema;
    try { schema = normalizeRuntimeForm(JSON.parse(snapshot.published_data)); } catch { return bad('Published Schema ไม่สมบูรณ์', 500, { code: 'INVALID_PUBLISHED_SCHEMA' }); }
    if (!schema) return bad('Published Schema ไม่สมบูรณ์', 500, { code: 'INVALID_PUBLISHED_SCHEMA' });
    return json({
      formId: snapshot.form_id,
      publicId: snapshot.public_id,
      publishedVersion: Number(snapshot.published_version),
      publishedAt: snapshot.published_at,
      schema,
    });
  }

  match = path.match(/^\/api\/integrations\/forms\/([^/]+)\/responses$/);
  if (match && request.method === 'POST') {
    const auth = await authorize(request, env, 'submit_response', bad);
    if (auth.response) {
      if (auth.retryAfter) auth.response.headers.set('retry-after', String(auth.retryAfter));
      return auth.response;
    }
    const publicId = safeDecode(match[1]);
    if (!publicId || publicId.length > 200) return bad('Public ID ไม่ถูกต้อง');
    const parsedBody = await readJson(request, 256 * 1024);
    if (parsedBody.error) return bad(parsedBody.error, parsedBody.status, { code: parsedBody.code });
    const body = parsedBody.value;
    const bodyVersion = parsePositiveVersion(body.publishedVersion), queryVersion = parsePositiveVersion(url.searchParams.get('version'));
    if (bodyVersion.error || queryVersion.error) return bad(bodyVersion.error || queryVersion.error, 400, { code: 'INVALID_VERSION' });
    if (bodyVersion.value != null && queryVersion.value != null && bodyVersion.value !== queryVersion.value) return bad('Published Version ใน URL และ Payload ไม่ตรงกัน', 400, { code: 'VERSION_MISMATCH' });
    const requestedVersion = bodyVersion.value ?? queryVersion.value;
    const snapshot = await publishedSnapshot(env, publicId, requestedVersion);
    if (!snapshot) return bad(requestedVersion == null ? 'ไม่พบ Published Form' : 'ไม่พบ Published Version ที่ร้องขอ', 404, { code: requestedVersion == null ? 'PUBLISHED_FORM_NOT_FOUND' : 'PUBLISHED_VERSION_NOT_FOUND' });
    const accessDenied = await requireFormAccess(env, auth.principal.application_id, snapshot.form_id, bad);
    if (accessDenied) return accessDenied;
    const publication = publicationView(snapshot);
    if (publication.state !== 'OPEN') return bad('Form ไม่เปิดรับ Integration Response', 403, { code: 'FORM_NOT_OPEN', state: publication.state });
    const source = sourceMetadata(body);
    if (source.error) return bad(source.error, source.status || 400, { code: source.code });
    let form;
    try { form = normalizeRuntimeForm(JSON.parse(snapshot.published_data)); } catch { return bad('Published Schema ไม่สมบูรณ์', 500, { code: 'INVALID_PUBLISHED_SCHEMA' }); }
    if (!form) return bad('Published Schema ไม่สมบูรณ์', 500, { code: 'INVALID_PUBLISHED_SCHEMA' });
    const respondent = validateRespondentMeta(form, body.respondentMeta, typeof body.respondentName === 'string' ? body.respondentName : '');
    if (respondent.error) return bad(respondent.error, 400, { code: 'INVALID_RESPONDENT' });
    const checked = validatePublicResponse(form, body.answers);
    if (checked.error) return bad(checked.error, 400, { code: 'INVALID_RESPONSE' });
    const now = new Date().toISOString(), responseId = id('resp'), version = Number(snapshot.published_version);
    const inserted = await env.DB.prepare(`INSERT INTO responses
      (id,form_id,respondent_name,respondent_meta,answers,path,score,published_version,created_at,
       source,source_app_id,source_version,source_session,source_platform,source_metadata)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
      WHERE EXISTS (
        SELECT 1 FROM forms f JOIN form_versions v ON v.form_id=f.id AND v.version=?
        WHERE f.id=? AND f.public_id=? AND f.published_data IS NOT NULL
          AND f.publication_state IN ('OPEN','SCHEDULED')
          AND (f.open_at IS NULL OR f.open_at<=?) AND (f.close_at IS NULL OR f.close_at>?)
      )`).bind(
        responseId, snapshot.form_id, respondent.respondentName, JSON.stringify(respondent.meta), JSON.stringify(checked.answers), JSON.stringify(checked.path), checked.score, version, now,
        'integration', auth.principal.application_id, source.version, source.session, source.platform, source.serialized,
        version, snapshot.form_id, publicId, now, now,
      ).run();
    if (!inserted.meta?.changes) return bad('สถานะของ Form เปลี่ยนไปก่อนบันทึกคำตอบ', 409, { code: 'FORM_STATE_CHANGED' });
    return json({ ok: true, id: responseId, formId: snapshot.form_id, publicId, publishedVersion: version, source: { type: 'integration', applicationId: auth.principal.application_id } }, 201);
  }

  if (path === '/api/integrations/question-packs' && request.method === 'GET') {
    const auth = await authorize(request, env, 'read_question_pack', bad);
    if (auth.response) {
      if (auth.retryAfter) auth.response.headers.set('retry-after', String(auth.retryAfter));
      return auth.response;
    }
    return json({ questionPacks: await allowedQuestionPacks(env, auth.principal.application_id) });
  }

  match = path.match(/^\/api\/integrations\/question-packs\/([^/]+)$/);
  if (match && request.method === 'GET') {
    const auth = await authorize(request, env, 'read_question_pack', bad);
    if (auth.response) {
      if (auth.retryAfter) auth.response.headers.set('retry-after', String(auth.retryAfter));
      return auth.response;
    }
    const packId = safeDecode(match[1]);
    if (!packId || packId.length > 200) return bad('Question Pack ID ไม่ถูกต้อง');
    const requested = parsePositiveVersion(url.searchParams.get('version'));
    if (requested.error) return bad(requested.error, 400, { code: 'INVALID_VERSION' });
    const accessDenied = await requireQuestionPackAccess(env, auth.principal.application_id, packId, bad);
    if (accessDenied) return accessDenied;
    const published = await publishedQuestionPack(env, packId, requested.value);
    if (!published) return bad(requested.value == null ? 'ไม่พบ Published Question Pack' : 'ไม่พบ Published Version ที่ร้องขอ', 404, { code: requested.value == null ? 'PUBLISHED_QUESTION_PACK_NOT_FOUND' : 'PUBLISHED_VERSION_NOT_FOUND' });
    if (published.error) return bad(published.error, 500, { code: 'INVALID_PACK_SNAPSHOT' });
    const projection = consumerPackProjection(published.snapshot);
    return json({
      packId: published.row.pack_id,
      packName: published.row.pack_name,
      publishedVersion: Number(published.row.pack_version),
      publishedAt: published.row.published_at,
      schemaVersion: projection.schemaVersion,
      questions: projection.questions,
    });
  }

  match = path.match(/^\/api\/integrations\/question-packs\/([^/]+)\/grade$/);
  if (match && request.method === 'POST') {
    const auth = await authorize(request, env, 'submit_game_result', bad);
    if (auth.response) {
      if (auth.retryAfter) auth.response.headers.set('retry-after', String(auth.retryAfter));
      return auth.response;
    }
    const packId = safeDecode(match[1]);
    if (!packId || packId.length > 200) return bad('Question Pack ID ไม่ถูกต้อง');
    const parsedBody = await readJson(request, 512 * 1024);
    if (parsedBody.error) return bad(parsedBody.error, parsedBody.status, { code: parsedBody.code });
    const body = parsedBody.value;
    const bodyVersion = parsePositiveVersion(body.publishedVersion), queryVersion = parsePositiveVersion(url.searchParams.get('version'));
    if (bodyVersion.error || queryVersion.error) return bad(bodyVersion.error || queryVersion.error, 400, { code: 'INVALID_VERSION' });
    if (bodyVersion.value != null && queryVersion.value != null && bodyVersion.value !== queryVersion.value) return bad('Published Version ใน URL และ Payload ไม่ตรงกัน', 400, { code: 'VERSION_MISMATCH' });
    const requestedVersion = bodyVersion.value ?? queryVersion.value;
    const accessDenied = await requireQuestionPackAccess(env, auth.principal.application_id, packId, bad);
    if (accessDenied) return accessDenied;
    const published = await publishedQuestionPack(env, packId, requestedVersion);
    if (!published) return bad(requestedVersion == null ? 'ไม่พบ Published Question Pack' : 'ไม่พบ Published Version ที่ร้องขอ', 404, { code: requestedVersion == null ? 'PUBLISHED_QUESTION_PACK_NOT_FOUND' : 'PUBLISHED_VERSION_NOT_FOUND' });
    if (published.error) return bad(published.error, 500, { code: 'INVALID_PACK_SNAPSHOT' });
    const graded = gradeQuestionPackSnapshot(published.snapshot, body.answers ?? {});
    if (graded.error) return bad(graded.error, 422, { code: graded.code });
    return json({
      ok: true,
      packId: published.row.pack_id,
      packName: published.row.pack_name,
      publishedVersion: Number(published.row.pack_version),
      totalQuestions: graded.totalQuestions,
      answeredCount: graded.answeredCount,
      correctCount: graded.correctCount,
      incorrectCount: graded.incorrectCount,
      unansweredCount: graded.unansweredCount,
      score: graded.score,
      maxScore: graded.maxScore,
      percentage: graded.percentage,
      questions: graded.grading,
    });
  }

  match = path.match(/^\/api\/integrations\/question-packs\/([^/]+)\/questions\/([^/]+)\/grade$/);
  if (match && request.method === 'POST') {
    const auth = await authorize(request, env, 'submit_game_result', bad);
    if (auth.response) {
      if (auth.retryAfter) auth.response.headers.set('retry-after', String(auth.retryAfter));
      return auth.response;
    }
    const packId = safeDecode(match[1]), questionId = safeDecode(match[2]);
    if (!packId || packId.length > 200 || !questionId || questionId.length > 200) return bad('Pack ID หรือ Question ID ไม่ถูกต้อง');
    const parsedBody = await readJson(request, 32 * 1024);
    if (parsedBody.error) return bad(parsedBody.error, parsedBody.status, { code: parsedBody.code });
    const body = parsedBody.value, requestedVersion = parsePositiveVersion(body.publishedVersion);
    if (requestedVersion.error) return bad(requestedVersion.error, 400, { code: 'INVALID_VERSION' });
    const accessDenied = await requireQuestionPackAccess(env, auth.principal.application_id, packId, bad);
    if (accessDenied) return accessDenied;
    const published = await publishedQuestionPack(env, packId, requestedVersion.value);
    if (!published) return bad('ไม่พบ Published Question Pack', 404, { code: 'PUBLISHED_QUESTION_PACK_NOT_FOUND' });
    if (published.error) return bad(published.error, 500, { code: 'INVALID_PACK_SNAPSHOT' });
    const question = published.snapshot.questions.find(item => String(item.sourceQuestionId) === questionId);
    if (!question) return bad('ไม่พบ Question ID ใน Pack นี้', 404, { code: 'QUESTION_NOT_FOUND' });
    const graded = gradeQuestionPackSnapshot({ ...published.snapshot, questions: [question] }, { [questionId]: body.answer });
    if (graded.error) return bad(graded.error, 422, { code: graded.code });
    const detail = graded.grading[0];
    const credit = Math.round(gameQuestionCredit(question, graded.canonicalAnswers[questionId], detail.correct) * 10000) / 10000;
    return json({
      ok: true,
      packId,
      publishedVersion: Number(published.row.pack_version),
      questionId,
      answered: detail.answered,
      correct: detail.correct,
      result: detail.correct ? 'SUCCESS' : credit > 0 ? 'PARTIAL' : 'FAIL',
      credit,
      solution: gameSolutionText(question),
      explanation: question.explanation || '',
    });
  }

  return bad('Integration API route not found', 404);
}
