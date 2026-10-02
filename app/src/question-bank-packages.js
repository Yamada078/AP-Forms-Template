import { normalizeAnswerConfig, normalizeQuestionMedia, readyValidation } from './question-banks.js';

const KIND = 'goi.question-bank.package';
const TYPES = new Set(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'ORDERING', 'MATCHING', 'DRAG_DROP']);
const LEGACY_TYPES = new Set(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER']);
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const MAX_QUESTIONS = 300;
const MAX_TAGS = 100;
const MAX_TAG_LINKS = 2000;
const MAX_BULK_JSON_BYTES = 400 * 1024;
const encoder = new TextEncoder();
const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const decode = value => { try { return decodeURIComponent(value); } catch { return ''; } };
const parse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const effectiveType = row => String(row?.activity_type || row?.type || '').toUpperCase();
const normalizedPrompt = value => clean(value, 12000).normalize('NFC').replace(/\s+/g, ' ').toLocaleLowerCase();
const fingerprint = (type, prompt) => `${type}\n${normalizedPrompt(prompt)}`;

function jsonChunks(records) {
  const chunks = [];
  let current = [], currentBytes = 2;
  for (const record of records) {
    const serialized = JSON.stringify(record);
    const recordBytes = encoder.encode(serialized).byteLength + (current.length ? 1 : 0);
    if (current.length && currentBytes + recordBytes > MAX_BULK_JSON_BYTES) {
      chunks.push(JSON.stringify(current));
      current = []; currentBytes = 2;
    }
    current.push(record);
    currentBytes += encoder.encode(serialized).byteLength + (current.length > 1 ? 1 : 0);
  }
  if (current.length) chunks.push(JSON.stringify(current));
  return chunks;
}

function collectMediaPaths(value, output = []) {
  if (!value || typeof value !== 'object') return output;
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, 'path')) output.push(String(value.path || ''));
  for (const nested of Array.isArray(value) ? value : Object.values(value)) collectMediaPaths(nested, output);
  return output;
}

async function availableMediaPaths(env) {
  try {
    if (!env.ASSETS?.fetch) return new Set();
    const response = await env.ASSETS.fetch(new Request('https://goi-assets.local/assets/question-media/manifest.json'));
    if (!response.ok) return new Set();
    const manifest = await response.json();
    return new Set((Array.isArray(manifest.assets) ? manifest.assets : []).map(asset => String(asset?.path || '')).filter(Boolean));
  } catch { return new Set(); }
}

async function normalizePackage(env, input, targetBankId, makeId) {
  const errors = [], warnings = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: ['Package ต้องเป็น JSON Object'], warnings, normalized: null };
  if (input.kind !== KIND) errors.push(`kind ต้องเป็น “${KIND}”`);
  if (Number(input.schemaVersion) !== 1) errors.push('รองรับ schemaVersion 1 เท่านั้น');
  if (!input.bank || typeof input.bank !== 'object' || Array.isArray(input.bank)) errors.push('bank ต้องเป็น Object');
  const bank = { name: clean(input.bank?.name, 200), description: clean(input.bank?.description, 4000) };
  if (!bank.name) errors.push('กรุณาใส่ชื่อ Bank ใน Package');
  if (!Array.isArray(input.tags)) errors.push('tags ต้องเป็น Array');
  if (!Array.isArray(input.questions)) errors.push('questions ต้องเป็น Array');
  const rawTags = Array.isArray(input.tags) ? input.tags : [], rawQuestions = Array.isArray(input.questions) ? input.questions : [];
  if (rawTags.length > MAX_TAGS) errors.push(`Package มี Tag เกิน ${MAX_TAGS} รายการ`);
  if (rawQuestions.length > MAX_QUESTIONS) errors.push(`Package มีคำถามเกิน ${MAX_QUESTIONS} ข้อ`);

  const tags = [], tagKeys = new Set(), tagNames = new Set();
  for (const [index, tag] of rawTags.slice(0, MAX_TAGS).entries()) {
    if (!tag || typeof tag !== 'object' || Array.isArray(tag)) { errors.push(`Tag ลำดับ ${index + 1} ต้องเป็น Object`); continue; }
    const key = clean(tag.key, 120), name = clean(tag.name, 120), group = clean(tag.group ?? tag.groupName, 120);
    if (!key || !name) { errors.push(`Tag ลำดับ ${index + 1} ต้องมี key และ name`); continue; }
    if (tagKeys.has(key)) { errors.push(`Tag key ซ้ำ: ${key}`); continue; }
    const nameKey = `${group.toLocaleLowerCase()}\n${name.toLocaleLowerCase()}`;
    if (tagNames.has(nameKey)) { errors.push(`ชื่อ Tag ซ้ำในกลุ่มเดียวกัน: ${group ? `${group} / ` : ''}${name}`); continue; }
    tagKeys.add(key); tagNames.add(nameKey); tags.push({ key, name, group });
  }

  let targetBank = null;
  if (targetBankId) {
    targetBank = await env.DB.prepare('SELECT id,name,status FROM question_banks WHERE id=?').bind(targetBankId).first();
    if (!targetBank) errors.push('ไม่พบ Question Bank ปลายทาง');
    else if (targetBank.status !== 'ACTIVE') errors.push('เพิ่ม Package ได้เฉพาะ Question Bank ที่กำลังใช้งาน');
  }
  const existingFingerprints = new Set();
  if (targetBank) {
    const rows = await env.DB.prepare('SELECT type,activity_type,prompt FROM bank_questions WHERE bank_id=?').bind(targetBank.id).all();
    for (const row of rows.results || []) existingFingerprints.add(fingerprint(effectiveType(row), row.prompt));
  }
  const mediaPaths = await availableMediaPaths(env), packageFingerprints = new Set(), questions = [];
  let tagLinkCount = 0, ready = 0, draft = 0, duplicateCount = 0;
  for (const [index, raw] of rawQuestions.slice(0, MAX_QUESTIONS).entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`คำถามลำดับ ${index + 1} ต้องเป็น Object`); continue; }
    const type = clean(raw.type, 40).toUpperCase();
    if (!TYPES.has(type)) { errors.push(`คำถามลำดับ ${index + 1} มี type ที่ไม่รองรับ`); continue; }
    if (raw.answerConfig != null && (typeof raw.answerConfig !== 'object' || Array.isArray(raw.answerConfig))) { errors.push(`answerConfig ของคำถามลำดับ ${index + 1} ต้องเป็น Object`); continue; }
    const difficulty = raw.difficulty == null ? 3 : Number(raw.difficulty);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) { errors.push(`difficulty ของคำถามลำดับ ${index + 1} ต้องเป็นจำนวนเต็ม 1–5`); continue; }
    const rawQuestionTags = Array.isArray(raw.tags) ? raw.tags : [];
    if (rawQuestionTags.length > 50) { errors.push(`คำถามลำดับ ${index + 1} มี Tag เกิน 50 รายการ`); continue; }
    const requestedTags = [...new Set(rawQuestionTags.map(String).filter(Boolean))];
    if (raw.tags != null && !Array.isArray(raw.tags)) { errors.push(`tags ของคำถามลำดับ ${index + 1} ต้องเป็น Array ของ Tag key`); continue; }
    const missingTag = requestedTags.find(key => !tagKeys.has(key));
    if (missingTag) { errors.push(`คำถามลำดับ ${index + 1} อ้าง Tag key ที่ไม่มี: ${missingTag}`); continue; }
    tagLinkCount += requestedTags.length;
    const answerConfig = normalizeAnswerConfig(type, raw.answerConfig || {}, makeId);
    const media = normalizeQuestionMedia(raw.media);
    const question = {
      packageId: clean(raw.id ?? raw.key, 120) || `question_${index + 1}`,
      type, prompt: clean(raw.prompt, 12000), description: clean(raw.description, 12000), difficulty,
      answerConfig, media, explanation: clean(raw.explanation, 12000), internalNotes: clean(raw.internalNotes, 12000),
      sourceReference: clean(raw.sourceReference, 2000), tagKeys: requestedTags,
    };
    const readiness = readyValidation(question), status = readiness.valid ? 'READY' : 'DRAFT';
    status === 'READY' ? ready++ : draft++;
    const key = fingerprint(type, question.prompt), duplicate = existingFingerprints.has(key) || packageFingerprints.has(key);
    if (duplicate) { duplicateCount++; warnings.push(`คำถามลำดับ ${index + 1} อาจซ้ำ: ${question.prompt || '(ไม่มีโจทย์)'}`); }
    packageFingerprints.add(key);
    for (const rawPath of collectMediaPaths({ media: raw.media, answerConfig: raw.answerConfig })) {
      const normalized = normalizeQuestionMedia({ path: rawPath });
      if (!normalized) warnings.push(`คำถามลำดับ ${index + 1} มี media path ที่ไม่รองรับและจะไม่นำเข้า: ${clean(rawPath, 200)}`);
      else if (!mediaPaths.has(normalized.path)) warnings.push(`คำถามลำดับ ${index + 1} อ้างรูปที่ไม่พบใน Static Media: ${normalized.path}`);
    }
    questions.push({ ...question, readiness, status, duplicate });
  }
  if (tagLinkCount > MAX_TAG_LINKS) errors.push(`Package มีการเชื่อม Tag รวมเกิน ${MAX_TAG_LINKS} รายการ`);

  let reusedTags = 0;
  if (targetBank && tags.length) {
    const rows = await env.DB.prepare('SELECT name,group_name FROM question_tags WHERE bank_id=?').bind(targetBank.id).all();
    const existing = new Set((rows.results || []).map(row => `${String(row.group_name || '').toLocaleLowerCase()}\n${String(row.name || '').toLocaleLowerCase()}`));
    reusedTags = tags.filter(tag => existing.has(`${tag.group.toLocaleLowerCase()}\n${tag.name.toLocaleLowerCase()}`)).length;
  }
  return {
    errors, warnings: [...new Set(warnings)],
    normalized: { bank, tags, questions, targetBank },
    summary: { bankName: bank.name, targetBankName: targetBank?.name || '', questionsTotal: rawQuestions.length, tagsTotal: rawTags.length, ready, draft, duplicates: duplicateCount, reusedTags, newTags: tags.length - reusedTags },
  };
}

function previewResponse(result) {
  return {
    valid: result.errors.length === 0,
    errors: result.errors,
    warnings: result.warnings,
    summary: result.summary,
    questions: (result.normalized?.questions || []).map((question, index) => ({ index: index + 1, type: question.type, prompt: question.prompt, status: question.status, errors: question.readiness.errors, duplicate: question.duplicate })),
  };
}

async function exportPackage(env, bankId) {
  const bank = await env.DB.prepare('SELECT id,name,description FROM question_banks WHERE id=?').bind(bankId).first();
  if (!bank) return null;
  const tagRows = (await env.DB.prepare('SELECT id,name,group_name FROM question_tags WHERE bank_id=? ORDER BY group_name,name').bind(bankId).all()).results || [];
  const tags = tagRows.map((tag, index) => ({ key: `tag_${index + 1}`, name: tag.name, group: tag.group_name || '' }));
  const tagKeyById = new Map(tagRows.map((tag, index) => [tag.id, `tag_${index + 1}`]));
  const rows = (await env.DB.prepare('SELECT * FROM bank_questions WHERE bank_id=? ORDER BY created_at,id').bind(bankId).all()).results || [];
  const links = (await env.DB.prepare('SELECT question_id,tag_id FROM question_tag_links WHERE question_id IN (SELECT id FROM bank_questions WHERE bank_id=?)').bind(bankId).all()).results || [];
  const linksByQuestion = new Map();
  for (const link of links) { if (!linksByQuestion.has(link.question_id)) linksByQuestion.set(link.question_id, []); const key = tagKeyById.get(link.tag_id); if (key) linksByQuestion.get(link.question_id).push(key); }
  return {
    kind: KIND, schemaVersion: 1,
    bank: { name: bank.name, description: bank.description || '' }, tags,
    questions: rows.map((row, index) => ({
      id: `question_${index + 1}`, type: effectiveType(row), prompt: row.prompt, description: row.description || '', difficulty: Number(row.difficulty),
      answerConfig: parse(row.answer_config, {}), media: normalizeQuestionMedia(parse(row.media_json, null)),
      tags: linksByQuestion.get(row.id) || [], explanation: row.explanation || '', internalNotes: row.internal_notes || '', sourceReference: row.source_reference || '',
    })),
  };
}

export async function handleQuestionBankPackageRequest(request, env, helpers) {
  const { json, bad, readBody, id, isAdmin } = helpers;
  const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '') || '/';
  if (!path.startsWith('/api/admin/question-bank-packages') && !/\/api\/admin\/question-banks\/[^/]+\/export$/.test(path)) return null;
  if (!isAdmin(request, env)) return bad('Unauthorized', 401);

  let match = path.match(/^\/api\/admin\/question-banks\/([^/]+)\/export$/);
  if (match && request.method === 'GET') {
    const packageData = await exportPackage(env, decode(match[1]));
    if (!packageData) return bad('ไม่พบ Question Bank', 404);
    const filename = `${packageData.bank.name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'question-bank'}.json`;
    return json(packageData, 200, { 'content-disposition': `attachment; filename="${filename}"` });
  }
  if (path === '/api/admin/question-bank-packages/preview' && request.method === 'POST') {
    const body = await readBody(request, MAX_PACKAGE_BYTES);
    if (!body) return bad('ไฟล์ Package ไม่ถูกต้องหรือมีขนาดเกิน 2 MB', 413);
    const makeId = (() => { let index = 0; return prefix => `${prefix}_package_${++index}`; })();
    const result = await normalizePackage(env, body.package, clean(body.targetBankId, 160), makeId);
    return json({ preview: previewResponse(result) }, result.errors.length ? 422 : 200);
  }
  if (path === '/api/admin/question-bank-packages/import' && request.method === 'POST') {
    const body = await readBody(request, MAX_PACKAGE_BYTES);
    if (!body) return bad('ไฟล์ Package ไม่ถูกต้องหรือมีขนาดเกิน 2 MB', 413);
    const targetBankId = clean(body.targetBankId, 160), duplicateMode = clean(body.duplicateMode, 20).toLowerCase();
    const result = await normalizePackage(env, body.package, targetBankId, prefix => id(prefix));
    if (result.errors.length) return bad('Package ไม่ผ่านการตรวจสอบ', 422, { preview: previewResponse(result) });
    if (result.summary.duplicates && !['skip', 'import'].includes(duplicateMode)) return bad('กรุณาเลือกว่าจะข้ามหรือนำเข้าคำถามที่อาจซ้ำ', 409, { code: 'DUPLICATE_DECISION_REQUIRED', preview: previewResponse(result) });
    const bankId = result.normalized.targetBank?.id || id('bank'), now = new Date().toISOString();
    const questions = result.normalized.questions.filter(question => duplicateMode !== 'skip' || !question.duplicate);
    const statements = [], tagRows = result.normalized.tags.map(tag => ({ id: id('tag'), name: tag.name, group: tag.group }));
    if (!result.normalized.targetBank) statements.push(env.DB.prepare("INSERT INTO question_banks (id,name,description,status,created_at,updated_at) VALUES (?,?,?,'ACTIVE',?,?)").bind(bankId, result.normalized.bank.name, result.normalized.bank.description, now, now));
    for (const payload of jsonChunks(tagRows)) statements.push(env.DB.prepare(`
      INSERT OR IGNORE INTO question_tags (id,bank_id,name,group_name,created_at,updated_at)
      SELECT json_extract(value,'$.id'),?,json_extract(value,'$.name'),json_extract(value,'$.group'),?,?
      FROM json_each(?)
    `).bind(bankId, now, now, payload));
    const questionRows = [], linkRows = [];
    for (const question of questions) {
      const questionId = id('question'), storageType = LEGACY_TYPES.has(question.type) ? question.type : 'SHORT_ANSWER', activityType = LEGACY_TYPES.has(question.type) ? null : question.type;
      questionRows.push({
        id: questionId, storageType, activityType, prompt: question.prompt, description: question.description,
        difficulty: question.difficulty, status: question.status, answerConfigJson: JSON.stringify(question.answerConfig),
        mediaJson: JSON.stringify(question.media), explanation: question.explanation, internalNotes: question.internalNotes,
        sourceReference: question.sourceReference,
      });
      for (const key of question.tagKeys) {
        const tag = result.normalized.tags.find(item => item.key === key);
        linkRows.push({ questionId, group: tag.group, name: tag.name });
      }
    }
    for (const payload of jsonChunks(questionRows)) statements.push(env.DB.prepare(`
      INSERT INTO bank_questions (id,bank_id,type,activity_type,prompt,description,difficulty,status,answer_config,media_json,explanation,internal_notes,source_reference,created_at,updated_at)
      SELECT json_extract(value,'$.id'),?,json_extract(value,'$.storageType'),json_extract(value,'$.activityType'),
        json_extract(value,'$.prompt'),json_extract(value,'$.description'),CAST(json_extract(value,'$.difficulty') AS INTEGER),
        json_extract(value,'$.status'),json_extract(value,'$.answerConfigJson'),json_extract(value,'$.mediaJson'),
        json_extract(value,'$.explanation'),json_extract(value,'$.internalNotes'),json_extract(value,'$.sourceReference'),?,?
      FROM json_each(?)
    `).bind(bankId, now, now, payload));
    for (const payload of jsonChunks(linkRows)) statements.push(env.DB.prepare(`
      INSERT INTO question_tag_links (question_id,tag_id,assigned_at)
      SELECT json_extract(p.value,'$.questionId'),t.id,?
      FROM json_each(?) AS p
      JOIN question_tags AS t
        ON t.bank_id=?
        AND t.group_name=json_extract(p.value,'$.group') COLLATE NOCASE
        AND t.name=json_extract(p.value,'$.name') COLLATE NOCASE
    `).bind(now, payload, bankId));
    if (result.normalized.targetBank) statements.push(env.DB.prepare('UPDATE question_banks SET updated_at=? WHERE id=?').bind(now, bankId));
    await env.DB.batch(statements);
    return json({ ok: true, bankId, importedQuestions: questions.length, skippedDuplicates: result.normalized.questions.length - questions.length, ready: questions.filter(question => question.status === 'READY').length, draft: questions.filter(question => question.status === 'DRAFT').length, tags: result.normalized.tags.length }, 201);
  }
  return bad('Question Bank Package route not found', 404);
}
