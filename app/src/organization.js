import bcrypt from 'bcryptjs';

const contexts = new WeakMap();
const encoder = new TextEncoder();
const COOKIE = 'apforms_session';
const roles = new Set(['ADMIN', 'EDITOR', 'RESPONDENT']);
const sessionHours = 8;
const userView = row => row && ({ id: row.id, username: row.username, name: row.name, role: row.role, status: row.status });
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const fail = (error, status = 400, code = undefined) => json({ error, ...(code ? { code } : {}) }, status);
const uid = () => `user_${crypto.randomUUID().replaceAll('-', '')}`;
const now = () => new Date().toISOString();
const expires = hours => new Date(Date.now() + hours * 3600000).toISOString();
const bearer = request => (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
function cookieToken(request) {
  return (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
}
function sessionCookie(request, token, age = sessionHours * 3600) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export function accountContext(request) { return contexts.get(request); }
export function isStaff(request, env) {
  const context = contexts.get(request);
  if (context?.organization) return context.user?.status === 'ACTIVE' && ['ADMIN', 'EDITOR'].includes(context.user.role);
  return !!env.TEAM_KEY && bearer(request) === env.TEAM_KEY;
}
function username(value) { return String(value || '').trim().toLowerCase(); }
function validUsername(value) { return /^[a-z0-9][a-z0-9_.@+-]{2,119}$/.test(value); }
function passwordError(value) {
  if (typeof value !== 'string' || value.length < 12) return 'รหัสผ่านต้องยาวอย่างน้อย 12 ตัวอักษร';
  if (encoder.encode(value).length > 72) return 'รหัสผ่านต้องมีขนาดไม่เกิน 72 ไบต์';
  return null;
}
function branding(body) {
  const name = String(body.organizationName || '').trim().slice(0, 120);
  const logo = String(body.logoUrl || '').trim();
  if (!name) return { error: 'กรุณาระบุชื่อองค์กร' };
  if (logo && (!/^https:\/\//i.test(logo) || logo.length > 2000)) return { error: 'URL โลโก้ต้องเริ่มด้วย https://' };
  return { name, logo };
}
async function readBody(request) {
  try { const raw = await request.text(); return encoder.encode(raw).length <= 16384 ? JSON.parse(raw) : null; }
  catch { return null; }
}
async function rateLimit(env, request, category, limit = 20, hours = 0.25) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const bucket = await hash(`${category}:${ip}`);
  await env.DB.prepare(`INSERT INTO organization_attempts (bucket,attempts,expires_at) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`).bind(bucket, expires(hours), now(), now()).run();
  const row = await env.DB.prepare('SELECT attempts FROM organization_attempts WHERE bucket=?').bind(bucket).first();
  return row.attempts <= limit;
}
async function createSession(env, request, user) {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM organization_sessions WHERE expires_at<=?').bind(now()),
    env.DB.prepare('DELETE FROM organization_tokens WHERE expires_at<=?').bind(now()),
    env.DB.prepare('DELETE FROM organization_attempts WHERE expires_at<=?').bind(now()),
    env.DB.prepare('INSERT INTO organization_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await hash(token), user.id, expires(sessionHours)),
  ]);
  return json({ user: userView(user) }, 200, { 'set-cookie': sessionCookie(request, token) });
}
async function issueToken(env, request, user, purpose) {
  const token = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM organization_tokens WHERE user_id=?').bind(user.id),
    env.DB.prepare('INSERT INTO organization_tokens (token_hash,user_id,purpose,expires_at) VALUES (?,?,?,?)').bind(await hash(token), user.id, purpose, expires(24)),
  ]);
  // Keep one-time links out of server access logs and referrer headers.
  return json({ user: userView(user), invitationUrl: `${new URL(request.url).origin}/account.html#token=${token}`, expiresInHours: 24 }, 201);
}
function sameOrigin(request) {
  return request.headers.get('origin') === new URL(request.url).origin && request.headers.get('x-apforms-request') === '1';
}

export async function prepareAccountRequest(request, env) {
  if (!env.DB) return null;
  let organization;
  try { organization = await env.DB.prepare('SELECT * FROM organization WHERE id=1').first(); }
  catch (error) {
    if (/no such table.*organization/i.test(String(error))) return null;
    throw error;
  }
  let user = null, tokenHash = null;
  const token = cookieToken(request);
  if (organization && /^[a-f0-9]{64}$/.test(token)) {
    tokenHash = await hash(token);
    user = await env.DB.prepare(`SELECT u.* FROM organization_users u JOIN organization_sessions s ON s.user_id=u.id
      WHERE s.token_hash=? AND s.expires_at>? AND u.status='ACTIVE'`).bind(tokenHash, now()).first();
  }
  contexts.set(request, { organization, user, tokenHash });
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  const authPath = path.startsWith('/api/account/') || path.startsWith('/api/organization');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && (authPath || (organization && token))) {
    if (!sameOrigin(request)) return fail('คำขอนี้ต้องมาจากหน้าเว็บของระบบ', 403, 'ORIGIN_REQUIRED');
  }
  if (authPath) return handleAccountRequest(request, env, path);
  if (!organization) return null;
  if (path === '/api/login') return user && user.role !== 'RESPONDENT' ? json({ ok: true, user: userView(user) }) : fail('กรุณาเข้าสู่ระบบด้วยบัญชีสมาชิก', 401);
  const staffPath = /^\/api\/(forms(?:\/|$)|admin(?:\/|$)|collab-ticket$)/.test(path);
  if (staffPath) {
    if (!user) return fail('กรุณาเข้าสู่ระบบ', 401, 'LOGIN_REQUIRED');
    if (user.role === 'RESPONDENT') return fail('บัญชีนี้ไม่มีสิทธิ์จัดการฟอร์ม', 403);
    if (path.startsWith('/api/admin/integrations/') && user.role !== 'ADMIN') return fail('เฉพาะผู้ดูแลเท่านั้นที่จัดการการเชื่อมต่อแอปได้', 403);
  }
  return null;
}

async function handleAccountRequest(request, env, path) {
  const { organization, user, tokenHash } = accountContext(request);
  const method = request.method;
  if (path === '/api/account/status' && method === 'GET') return json({
    configured: !!organization, organization: organization && { name: organization.name, logoUrl: organization.logo_url }, user: userView(user),
  });
  if (path === '/api/account/setup' && method === 'POST') {
    if (organization) return fail('ระบบตั้งค่าแล้ว', 409);
    if (!env.TEAM_KEY || bearer(request) !== env.TEAM_KEY) return fail('รหัสตั้งค่าระบบไม่ถูกต้อง', 401);
    if (!await rateLimit(env, request, 'setup', 10, 1)) return fail('ลองใหม่อีกครั้งภายหลัง', 429);
    const body = await readBody(request);
    if (!body) return fail('ข้อมูลไม่ถูกต้อง');
    const brand = branding(body), login = username(body.username), name = String(body.name || '').trim().slice(0, 120);
    const error = brand.error || (!validUsername(login) && 'ชื่อบัญชีต้องใช้ตัวอักษรอังกฤษ ตัวเลข หรือ . _ @ + - อย่างน้อย 3 ตัว') || (!name && 'กรุณาระบุชื่อผู้ดูแล') || passwordError(body.password);
    if (error) return fail(error);
    const admin = { id: uid(), username: login, name, role: 'ADMIN', status: 'ACTIVE' };
    const passwordHash = await bcrypt.hash(body.password, 10);
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO organization (id,name,logo_url,created_at) VALUES (1,?,?,?)').bind(brand.name, brand.logo, now()),
        env.DB.prepare('INSERT INTO organization_users (id,username,name,password_hash,role,status,created_at) VALUES (?,?,?,?,?,?,?)').bind(admin.id, login, name, passwordHash, admin.role, admin.status, now()),
      ]);
    } catch (error) { if (/unique|constraint/i.test(String(error))) return fail('ระบบตั้งค่าแล้ว กรุณาเข้าสู่ระบบ', 409); throw error; }
    return createSession(env, request, admin);
  }
  if (!organization) return fail('ยังไม่ได้ตั้งค่าองค์กร', 409, 'SETUP_REQUIRED');
  if (path === '/api/account/login' && method === 'POST') {
    const body = await readBody(request);
    if (!body || typeof body.password !== 'string' || encoder.encode(body.password).length > 72) return fail('ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง', 401);
    const login = username(body.username);
    if (!await rateLimit(env, request, 'login', 100) || !await rateLimit(env, request, `login:${login}`, 12)) return fail('พยายามเข้าสู่ระบบหลายครั้ง กรุณารอ 15 นาที', 429);
    const member = await env.DB.prepare("SELECT * FROM organization_users WHERE username=? AND status='ACTIVE'").bind(login).first();
    // A valid fixed bcrypt hash gives unknown usernames the same expensive check.
    const dummy = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    const verified = await bcrypt.compare(body.password, member?.password_hash || dummy);
    if (!member || !verified) return fail('ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง', 401);
    return createSession(env, request, member);
  }
  if (path === '/api/account/accept' && method === 'POST') {
    if (!await rateLimit(env, request, 'accept', 20, 1)) return fail('ลองใหม่อีกครั้งภายหลัง', 429);
    const body = await readBody(request);
    if (!body || !/^[a-f0-9]{64}$/.test(body.token || '')) return fail('ลิงก์ไม่ถูกต้องหรือหมดอายุ', 410);
    const passwordIssue = passwordError(body.password);
    if (passwordIssue) return fail(passwordIssue);
    const digest = await hash(body.token);
    const token = await env.DB.prepare(`SELECT t.*,u.status FROM organization_tokens t JOIN organization_users u ON u.id=t.user_id
      WHERE t.token_hash=? AND t.expires_at>? AND u.status!='DISABLED'`).bind(digest, now()).first();
    if (!token) return fail('ลิงก์ไม่ถูกต้องหรือหมดอายุ', 410);
    const passwordHash = await bcrypt.hash(body.password, 10);
    const result = await env.DB.batch([
      env.DB.prepare(`UPDATE organization_users SET password_hash=?,status='ACTIVE' WHERE id=? AND status!='DISABLED'
        AND EXISTS (SELECT 1 FROM organization_tokens WHERE token_hash=? AND expires_at>?)`).bind(passwordHash, token.user_id, digest, now()),
      env.DB.prepare('DELETE FROM organization_tokens WHERE token_hash=?').bind(digest),
      env.DB.prepare('DELETE FROM organization_sessions WHERE user_id=?').bind(token.user_id),
    ]);
    if (!result[0].meta?.changes) return fail('ลิงก์นี้ถูกใช้แล้ว', 410);
    return json({ ok: true });
  }
  if (path === '/api/account/logout' && method === 'POST') {
    if (tokenHash) await env.DB.prepare('DELETE FROM organization_sessions WHERE token_hash=?').bind(tokenHash).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
  }
  if (!user) return fail('กรุณาเข้าสู่ระบบ', 401, 'LOGIN_REQUIRED');
  if (path === '/api/account/password' && method === 'POST') {
    if (!await rateLimit(env, request, `password:${user.id}`, 12)) return fail('ลองใหม่อีกครั้งภายหลัง', 429);
    const body = await readBody(request), error = passwordError(body?.password);
    if (error) return fail(error);
    if (typeof body.currentPassword !== 'string' || !await bcrypt.compare(body.currentPassword, user.password_hash)) return fail('รหัสผ่านเดิมไม่ถูกต้อง', 401);
    await env.DB.batch([
      env.DB.prepare('UPDATE organization_users SET password_hash=? WHERE id=?').bind(await bcrypt.hash(body.password, 10), user.id),
      env.DB.prepare('DELETE FROM organization_sessions WHERE user_id=?').bind(user.id),
      env.DB.prepare('DELETE FROM organization_tokens WHERE user_id=?').bind(user.id),
    ]);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
  }
  if (path === '/api/account/forms' && method === 'GET') {
    const rows = await env.DB.prepare(`SELECT f.public_id,f.title FROM forms f WHERE f.published=1 AND f.public_id IS NOT NULL
      AND f.publication_state IN ('OPEN','SCHEDULED') AND (f.open_at IS NULL OR f.open_at<=?) AND (f.close_at IS NULL OR f.close_at>?)
      AND (f.access_mode IN ('PUBLIC','MEMBERS') OR EXISTS (SELECT 1 FROM form_members m WHERE m.form_id=f.id AND m.user_id=?)) ORDER BY f.updated_at DESC`).bind(now(), now(), user.id).all();
    return json({ forms: rows.results || [] });
  }
  if (user.role !== 'ADMIN') return fail('เฉพาะผู้ดูแลเท่านั้นที่จัดการองค์กรได้', 403);
  if (path === '/api/organization' && method === 'PATCH') {
    const body = await readBody(request), brand = branding(body || {});
    if (brand.error) return fail(brand.error);
    await env.DB.prepare('UPDATE organization SET name=?,logo_url=? WHERE id=1').bind(brand.name, brand.logo).run();
    return json({ ok: true });
  }
  if (path === '/api/organization/users' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT id,username,name,role,status,created_at FROM organization_users ORDER BY created_at').all();
    return json({ users: rows.results || [] });
  }
  if (path === '/api/organization/users' && method === 'POST') {
    const body = await readBody(request), login = username(body?.username), name = String(body?.name || '').trim().slice(0, 120);
    if (!validUsername(login) || !name || !roles.has(body?.role)) return fail('ชื่อบัญชี ชื่อสมาชิก หรือสิทธิ์ไม่ถูกต้อง');
    const member = { id: uid(), username: login, name, role: body.role, status: 'INVITED' };
    try { await env.DB.prepare('INSERT INTO organization_users (id,username,name,role,status,created_at) VALUES (?,?,?,?,?,?)').bind(member.id, login, name, member.role, member.status, now()).run(); }
    catch (error) { if (/unique/i.test(String(error))) return fail('ชื่อบัญชีนี้ถูกใช้แล้ว', 409); throw error; }
    return issueToken(env, request, member, 'INVITE');
  }
  const match = path.match(/^\/api\/organization\/users\/([^/]+)(\/reset)?$/);
  if (match) {
    const member = await env.DB.prepare('SELECT * FROM organization_users WHERE id=?').bind(decodeURIComponent(match[1])).first();
    if (!member) return fail('ไม่พบสมาชิก', 404);
    if (match[2] && method === 'POST') {
      if (member.status === 'DISABLED') return fail('เปิดใช้งานบัญชีก่อนออกลิงก์ใหม่');
      return issueToken(env, request, member, member.status === 'INVITED' ? 'INVITE' : 'RESET');
    }
    if (!match[2] && method === 'PATCH') {
      const body = await readBody(request), role = body?.role || member.role, status = body?.status || member.status;
      if (!roles.has(role) || !['ACTIVE', 'DISABLED'].includes(status) || (member.status === 'INVITED' && status === 'ACTIVE')) return fail('สิทธิ์หรือสถานะไม่ถูกต้อง');
      const result = await env.DB.batch([
        env.DB.prepare(`UPDATE organization_users SET role=?,status=? WHERE id=? AND
          (role!='ADMIN' OR status!='ACTIVE' OR (?='ADMIN' AND ?='ACTIVE') OR
          EXISTS (SELECT 1 FROM organization_users WHERE role='ADMIN' AND status='ACTIVE' AND id!=?))`).bind(role, status, member.id, role, status, member.id),
        env.DB.prepare('DELETE FROM organization_sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM organization_users WHERE id=? AND (role!=? OR status!=?))').bind(member.id, member.id, member.role, member.status),
      ]);
      if (!result[0].meta?.changes) return fail('ต้องมีผู้ดูแลที่ใช้งานได้อย่างน้อยหนึ่งคน', 409);
      if (status === 'DISABLED') await env.DB.prepare('DELETE FROM organization_tokens WHERE user_id=?').bind(member.id).run();
      return json({ ok: true });
    }
  }
  return fail('ไม่พบเส้นทาง', 404);
}

export async function formAccessPolicy(request, env, formId) {
  if (!accountContext(request)?.organization) return { mode: 'PUBLIC', memberIds: [] };
  const form = await env.DB.prepare('SELECT access_mode FROM forms WHERE id=?').bind(formId).first();
  if (!form) return null;
  const rows = await env.DB.prepare('SELECT user_id FROM form_members WHERE form_id=?').bind(formId).all();
  return { mode: form.access_mode, memberIds: rows.results.map(row => row.user_id) };
}
export async function checkFormAccess(request, env, formId) {
  const context = accountContext(request);
  if (!context?.organization) return null;
  const form = await env.DB.prepare('SELECT access_mode FROM forms WHERE id=?').bind(formId).first();
  if (!form || form.access_mode === 'PUBLIC') return null;
  if (!context.user) return fail('ฟอร์มนี้ต้องเข้าสู่ระบบด้วยบัญชีสมาชิก', 401, 'LOGIN_REQUIRED');
  if (form.access_mode === 'MEMBERS') return null;
  const allowed = await env.DB.prepare('SELECT 1 FROM form_members WHERE form_id=? AND user_id=?').bind(formId, context.user.id).first();
  return allowed ? null : fail('บัญชีนี้ไม่ได้รับอนุญาตให้ตอบฟอร์มนี้', 403, 'FORM_ACCESS_DENIED');
}
export async function handleFormAccessSettings(request, env, formId) {
  const context = accountContext(request);
  if (!context?.organization) return fail('ตั้งค่าองค์กรก่อนกำหนดสิทธิ์ผู้ตอบ', 409);
  if (!isStaff(request, env)) return fail('ไม่มีสิทธิ์', 403);
  const policy = await formAccessPolicy(request, env, formId);
  if (!policy) return fail('ไม่พบฟอร์ม', 404);
  const members = await env.DB.prepare("SELECT id,name,username FROM organization_users WHERE status='ACTIVE' ORDER BY name").all();
  if (request.method === 'GET') return json({ ...policy, members: members.results });
  if (request.method !== 'PUT') return fail('Method not allowed', 405);
  const body = await readBody(request);
  if (!['PUBLIC', 'MEMBERS', 'SELECTED'].includes(body?.mode)) return fail('รูปแบบการเข้าถึงไม่ถูกต้อง');
  const ids = [...new Set(Array.isArray(body.memberIds) ? body.memberIds : [])];
  if (ids.length > 500 || ids.some(id => !members.results.some(member => member.id === id))) return fail('รายชื่อสมาชิกไม่ถูกต้อง');
  await env.DB.batch([
    env.DB.prepare('UPDATE forms SET access_mode=? WHERE id=?').bind(body.mode, formId),
    env.DB.prepare('DELETE FROM form_members WHERE form_id=?').bind(formId),
    ...(body.mode === 'SELECTED' ? ids.map(id => env.DB.prepare('INSERT INTO form_members (form_id,user_id) VALUES (?,?)').bind(formId, id)) : []),
  ]);
  return json({ ok: true, mode: body.mode, memberIds: body.mode === 'SELECTED' ? ids : [] });
}
