const PACK_STATUSES = new Set(['ACTIVE', 'ARCHIVED']);
const QUESTION_TYPES = new Set(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'ORDERING', 'MATCHING', 'DRAG_DROP']);

const cleanText = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const safeDecode = value => { try { return decodeURIComponent(value); } catch { return ''; } };
const parseJson = (value, fallback = {}) => { try { return JSON.parse(value); } catch { return fallback; } };
const effectiveType = row => String(row?.activity_type || row?.type || '').toUpperCase();
const orderedMatchingItems = config => {
  const pairs = config?.pairs || [], distractors = config?.rightDistractors || [];
  const left = pairs.map(pair => ({ id: pair.leftId, text: pair.leftText, media: pair.leftMedia || null }));
  const right = [...pairs.map(pair => ({ id: pair.rightId, text: pair.rightText, media: pair.rightMedia || null })), ...distractors.map(item => ({ id: item.rightId, text: item.rightText, media: item.rightMedia || null }))];
  const order = (requested, items, fallback) => { const map = new Map(items.map(item => [String(item.id),item])), result = []; for (const id of Array.isArray(requested) ? requested : fallback) if (map.has(String(id)) && !result.includes(map.get(String(id)))) result.push(map.get(String(id))); for (const item of items) if (!result.includes(item)) result.push(item); return result; };
  return { left: order(config?.leftOrder, left, left.map(item => item.id)), right: order(config?.rightOrder, right, pairs.map(pair => pair.rightId).reverse().concat(distractors.map(item => item.rightId))) };
};

function packView(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    publishedVersion: Number(row.published_version || 0),
    publishedAt: row.published_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    itemCount: Number(row.item_count || 0),
    manualCount: Number(row.manual_count || 0),
    poolCount: Number(row.pool_count || 0),
  };
}

function itemView(row) {
  return {
    id: row.id,
    packId: row.pack_id,
    kind: row.kind,
    position: Number(row.position),
    config: parseJson(row.config_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePoolConfig(input = {}) {
  const type = cleanText(input.type, 40).toUpperCase();
  const includeTagMode = cleanText(input.includeTagMode, 12).toUpperCase();
  const difficultyMin = Number(input.difficultyMin ?? 1);
  const difficultyMax = Number(input.difficultyMax ?? 5);
  const pickCount = Number(input.pickCount ?? 1);
  return {
    name: cleanText(input.name, 160) || 'พูลคำถาม',
    bankId: cleanText(input.bankId, 160),
    type: type || null,
    difficultyMin,
    difficultyMax,
    includeTagMode: includeTagMode === 'ALL' ? 'ALL' : 'ANY',
    includeTagIds: [...new Set((Array.isArray(input.includeTagIds) ? input.includeTagIds : []).map(String).filter(Boolean))].slice(0, 30),
    excludeTagIds: [...new Set((Array.isArray(input.excludeTagIds) ? input.excludeTagIds : []).map(String).filter(Boolean))].slice(0, 30),
    pickCount,
  };
}

function validatePoolShape(config) {
  const errors = [];
  if (!config.bankId) errors.push('กรุณาเลือกคลังคำถาม');
  if (config.type && !QUESTION_TYPES.has(config.type)) errors.push('ประเภทคำถามไม่ถูกต้อง');
  if (!Number.isInteger(config.difficultyMin) || config.difficultyMin < 1 || config.difficultyMin > 5) errors.push('Difficulty ต่ำสุดต้องเป็นจำนวนเต็ม 1–5');
  if (!Number.isInteger(config.difficultyMax) || config.difficultyMax < 1 || config.difficultyMax > 5) errors.push('Difficulty สูงสุดต้องเป็นจำนวนเต็ม 1–5');
  if (config.difficultyMin > config.difficultyMax) errors.push('Difficulty ต่ำสุดต้องไม่มากกว่าสูงสุด');
  if (!Number.isInteger(config.pickCount) || config.pickCount < 1 || config.pickCount > 1000) errors.push('จำนวนที่สุ่มต้องเป็นจำนวนเต็ม 1–1,000');
  if (!['ANY', 'ALL'].includes(config.includeTagMode)) errors.push('รูปแบบการจับคู่ Tag ไม่ถูกต้อง');
  const overlap = config.includeTagIds.find(tagId => config.excludeTagIds.includes(tagId));
  if (overlap) errors.push('Tag เดียวกันอยู่ทั้ง Must include และ Exclude ไม่ได้');
  return errors;
}

async function requirePack(env, packId) {
  return env.DB.prepare('SELECT id,name,description,status,published_version,published_at,created_at,updated_at FROM question_packs WHERE id=?').bind(packId).first();
}

async function loadItems(env, packId) {
  const result = await env.DB.prepare('SELECT id,pack_id,kind,position,config_json,created_at,updated_at FROM question_pack_items WHERE pack_id=? ORDER BY position').bind(packId).all();
  return (result.results || []).map(itemView);
}

async function tagsForQuestions(env, questionIds) {
  if (!questionIds.length) return new Map();
  const output = new Map(questionIds.map(questionId => [questionId, []]));
  for (let offset = 0; offset < questionIds.length; offset += 80) {
    const chunk = questionIds.slice(offset, offset + 80), placeholders = chunk.map(() => '?').join(',');
    const result = await env.DB.prepare(`SELECT l.question_id,t.id,t.name,t.group_name FROM question_tag_links l JOIN question_tags t ON t.id=l.tag_id WHERE l.question_id IN (${placeholders}) ORDER BY COALESCE(t.group_name,''),t.name`).bind(...chunk).all();
    for (const row of result.results || []) output.get(row.question_id)?.push({ id: row.id, name: row.name, groupName: row.group_name || '' });
  }
  return output;
}

function randomInt(max) {
  if (!Number.isInteger(max) || max <= 0) throw new Error('randomInt max must be positive');
  const range = 0x100000000, limit = range - (range % max), buffer = new Uint32Array(1);
  let value;
  do { crypto.getRandomValues(buffer); value = buffer[0]; } while (value >= limit);
  return value % max;
}

function shuffled(values) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index--) {
    const swapIndex = randomInt(index + 1);
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

async function validatePoolReferences(env, config) {
  const errors = validatePoolShape(config);
  if (errors.length) return errors;
  const bank = await env.DB.prepare('SELECT id,status FROM question_banks WHERE id=?').bind(config.bankId).first();
  if (!bank) return ['ไม่พบคลังคำถามของ Pool'];
  if (bank.status !== 'ACTIVE') errors.push('คลังคำถามของ Pool ถูก Archive อยู่');
  const tagIds = [...new Set([...config.includeTagIds, ...config.excludeTagIds])];
  if (tagIds.length) {
    const placeholders = tagIds.map(() => '?').join(',');
    const result = await env.DB.prepare(`SELECT id FROM question_tags WHERE bank_id=? AND id IN (${placeholders})`).bind(config.bankId, ...tagIds).all();
    if ((result.results || []).length !== tagIds.length) errors.push('มี Tag ที่ไม่ได้อยู่ในคลังคำถามที่เลือก');
  }
  return errors;
}

async function poolCandidates(env, config) {
  const where = ["q.bank_id=?", "q.status='READY'", 'q.difficulty BETWEEN ? AND ?'];
  const args = [config.bankId, config.difficultyMin, config.difficultyMax];
  if (config.type) { where.push('COALESCE(q.activity_type,q.type)=?'); args.push(config.type); }
  if (config.includeTagIds.length && config.includeTagMode === 'ANY') {
    const placeholders = config.includeTagIds.map(() => '?').join(',');
    where.push(`EXISTS (SELECT 1 FROM question_tag_links include_link WHERE include_link.question_id=q.id AND include_link.tag_id IN (${placeholders}))`);
    args.push(...config.includeTagIds);
  } else {
    for (const tagId of config.includeTagIds) {
      where.push('EXISTS (SELECT 1 FROM question_tag_links include_link WHERE include_link.question_id=q.id AND include_link.tag_id=?)');
      args.push(tagId);
    }
  }
  for (const tagId of config.excludeTagIds) {
    where.push('NOT EXISTS (SELECT 1 FROM question_tag_links exclude_link WHERE exclude_link.question_id=q.id AND exclude_link.tag_id=?)');
    args.push(tagId);
  }
  const result = await env.DB.prepare(`SELECT q.* FROM bank_questions q WHERE ${where.join(' AND ')} ORDER BY q.id`).bind(...args).all();
  return result.results || [];
}

function trustedQuestionSnapshot(row, tags, item, order) {
  return {
    order,
    sourceQuestionId: row.id,
    sourceBankId: row.bank_id,
    compositionItemId: item.id,
    compositionKind: item.kind,
    type: effectiveType(row),
    prompt: row.prompt,
    description: row.description,
    difficulty: Number(row.difficulty),
    answerConfig: parseJson(row.answer_config, {}),
    media: parseJson(row.media_json, null),
    explanation: row.explanation,
    sourceReference: row.source_reference,
    tags,
  };
}

export function consumerPackProjection(snapshot) {
  return {
    schemaVersion: snapshot?.schemaVersion || 1,
    packId: snapshot?.packId,
    packName: snapshot?.packName || '',
    version: Number(snapshot?.version || 0),
    questions: (snapshot?.questions || []).map(question => ({
      order: question.order,
      sourceQuestionId: question.sourceQuestionId,
      type: question.type,
      prompt: question.prompt,
      description: question.description,
      difficulty: question.difficulty,
      media: question.media || null,
      choices: ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'].includes(question.type)
        ? (question.answerConfig?.choices || []).map(({ id, text, media }) => ({ id, text, media: media || null })) : undefined,
      items: question.type === 'ORDERING'
        ? (question.answerConfig?.items || []).map(({ id, text, media }) => ({ id, text, media: media || null })) : undefined,
      leftItems: question.type === 'MATCHING' ? orderedMatchingItems(question.answerConfig).left : undefined,
      rightItems: question.type === 'MATCHING' ? orderedMatchingItems(question.answerConfig).right : undefined,
      targets: question.type === 'DRAG_DROP'
        ? (question.answerConfig?.targets || []).map(({ id, label, media }) => ({ id, label, media: media || null })) : undefined,
      tokens: question.type === 'DRAG_DROP'
        ? (question.answerConfig?.tokens || []).map(({ id, text, media }) => ({ id, text, media: media || null })) : undefined,
      tags: question.tags || [],
    })),
  };
}

export async function resolvePackDraft(env, pack, items, { randomize = true, version = 0 } = {}) {
  const errors = [], used = new Set(), selected = [], itemSummaries = [];
  if (!items.length) errors.push('Pack ยังไม่มีเนื้อหา');
  for (const item of items) {
    if (item.kind === 'MANUAL') {
      const questionId = cleanText(item.config.questionId, 160);
      const question = questionId ? await env.DB.prepare('SELECT * FROM bank_questions WHERE id=?').bind(questionId).first() : null;
      const itemErrors = [];
      if (!question) itemErrors.push('ไม่พบคำถามที่เลือก');
      else if (question.status !== 'READY') itemErrors.push(`คำถาม “${question.prompt || question.id}” ไม่อยู่ในสถานะ READY`);
      else if (used.has(question.id)) itemErrors.push('คำถามนี้ซ้ำกับรายการก่อนหน้า');
      if (!itemErrors.length) { used.add(question.id); selected.push({ row: question, item }); }
      errors.push(...itemErrors.map(message => `รายการ ${item.position + 1}: ${message}`));
      itemSummaries.push({ itemId: item.id, kind: item.kind, position: item.position, questionId, prompt: question?.prompt || '', selectedCount: itemErrors.length ? 0 : 1, candidateCount: question ? 1 : 0, errors: itemErrors });
      continue;
    }
    const config = normalizePoolConfig(item.config), itemErrors = await validatePoolReferences(env, config);
    let candidates = [];
    if (!itemErrors.length) candidates = (await poolCandidates(env, config)).filter(question => !used.has(question.id));
    if (!itemErrors.length && candidates.length < config.pickCount) itemErrors.push(`คำถามที่ใช้ได้ไม่เพียงพอ: มี ${candidates.length} ข้อ / ต้องการ ${config.pickCount} ข้อ`);
    const picked = itemErrors.length ? [] : (randomize ? shuffled(candidates) : candidates).slice(0, config.pickCount);
    for (const question of picked) { used.add(question.id); selected.push({ row: question, item }); }
    errors.push(...itemErrors.map(message => `รายการ ${item.position + 1} (${config.name}): ${message}`));
    itemSummaries.push({ itemId: item.id, kind: item.kind, position: item.position, name: config.name, bankId: config.bankId, candidateCount: candidates.length, requestedCount: config.pickCount, selectedCount: picked.length, errors: itemErrors });
  }
  const tagsByQuestion = await tagsForQuestions(env, selected.map(entry => entry.row.id));
  const questions = selected.map((entry, index) => trustedQuestionSnapshot(entry.row, tagsByQuestion.get(entry.row.id) || [], entry.item, index + 1));
  return {
    valid: errors.length === 0,
    errors,
    estimatedQuestionCount: items.reduce((count, item) => count + (item.kind === 'MANUAL' ? 1 : Math.max(0, Number(item.config.pickCount) || 0)), 0),
    resolvedQuestionCount: questions.length,
    items: itemSummaries,
    snapshot: {
      schemaVersion: 2,
      packId: pack.id,
      packName: pack.name,
      packDescription: pack.description,
      version,
      resolvedAt: new Date().toISOString(),
      questions,
    },
  };
}

async function nextPosition(env, packId) {
  const row = await env.DB.prepare('SELECT COALESCE(MAX(position),-1)+1 AS position FROM question_pack_items WHERE pack_id=?').bind(packId).first();
  return Number(row?.position || 0);
}

export async function handleQuestionPackRequest(request, env, helpers) {
  const { json, bad, readBody, id, isAdmin } = helpers;
  const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '') || '/';
  if (!path.startsWith('/api/admin/question-packs')) return null;
  if (!isAdmin(request, env)) return bad('Unauthorized', 401);

  if (path === '/api/admin/question-packs') {
    if (request.method === 'GET') {
      const status = String(url.searchParams.get('status') || 'ACTIVE').toUpperCase(), search = cleanText(url.searchParams.get('search'), 200).toLocaleLowerCase();
      if (!PACK_STATUSES.has(status) && status !== 'ALL') return bad('สถานะ Pack ไม่ถูกต้อง');
      const where = [], args = [];
      if (status !== 'ALL') { where.push('p.status=?'); args.push(status); }
      if (search) { const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`; where.push("(LOWER(p.name) LIKE ? ESCAPE '\\' OR LOWER(p.description) LIKE ? ESCAPE '\\')"); args.push(like, like); }
      const result = await env.DB.prepare(`SELECT p.*,COUNT(i.id) AS item_count,SUM(CASE WHEN i.kind='MANUAL' THEN 1 ELSE 0 END) AS manual_count,SUM(CASE WHEN i.kind='POOL' THEN 1 ELSE 0 END) AS pool_count FROM question_packs p LEFT JOIN question_pack_items i ON i.pack_id=p.id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} GROUP BY p.id ORDER BY p.updated_at DESC`).bind(...args).all();
      return json({ packs: (result.results || []).map(packView) });
    }
    if (request.method === 'POST') {
      const body = await readBody(request, 32 * 1024), name = cleanText(body?.name, 200), description = cleanText(body?.description, 4000);
      if (!name) return bad('กรุณาใส่ชื่อ Pack');
      const packId = id('pack'), now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO question_packs (id,name,description,status,published_version,published_at,created_at,updated_at) VALUES (?,?,?,'ACTIVE',0,NULL,?,?)").bind(packId, name, description, now, now).run();
      return json({ pack: packView({ id: packId, name, description, status: 'ACTIVE', published_version: 0, published_at: null, created_at: now, updated_at: now }) }, 201);
    }
    return bad('Method not allowed', 405);
  }

  let match = path.match(/^\/api\/admin\/question-packs\/([^/]+)$/);
  if (match) {
    const packId = safeDecode(match[1]), pack = packId && await requirePack(env, packId);
    if (!pack) return bad('ไม่พบ Question Pack', 404);
    if (request.method === 'GET') {
      const versions = await env.DB.prepare('SELECT version,question_count,published_at FROM question_pack_versions WHERE pack_id=? ORDER BY version DESC').bind(packId).all();
      return json({ pack: packView(pack), items: await loadItems(env, packId), versions: (versions.results || []).map(row => ({ version: Number(row.version), questionCount: Number(row.question_count), publishedAt: row.published_at })) });
    }
    if (request.method === 'PATCH') {
      const body = await readBody(request, 32 * 1024);
      if (!body) return bad('ข้อมูล Pack ไม่ถูกต้อง');
      const name = body.name == null ? pack.name : cleanText(body.name, 200), description = body.description == null ? pack.description : cleanText(body.description, 4000), status = body.status == null ? pack.status : String(body.status).toUpperCase();
      if (!name) return bad('กรุณาใส่ชื่อ Pack');
      if (!PACK_STATUSES.has(status)) return bad('สถานะ Pack ไม่ถูกต้อง');
      if (pack.status === 'ARCHIVED' && status === 'ARCHIVED' && (body.name != null || body.description != null)) return bad('Pack ที่ Archive แล้วเป็น read-only กรุณา Restore ก่อนแก้ไข', 409);
      if (body.baseUpdatedAt && String(body.baseUpdatedAt) !== pack.updated_at) return bad('ชุดคำถามถูกแก้ไขจากหน้าต่างอื่นแล้ว กรุณาโหลดใหม่', 409, { code: 'EDIT_CONFLICT', updatedAt: pack.updated_at });
      const now = new Date().toISOString();
      const updated = body.baseUpdatedAt
        ? await env.DB.prepare('UPDATE question_packs SET name=?,description=?,status=?,updated_at=? WHERE id=? AND updated_at=?').bind(name, description, status, now, packId, String(body.baseUpdatedAt)).run()
        : await env.DB.prepare('UPDATE question_packs SET name=?,description=?,status=?,updated_at=? WHERE id=?').bind(name, description, status, now, packId).run();
      if (!updated.meta?.changes) return bad('ชุดคำถามถูกแก้ไขจากหน้าต่างอื่นแล้ว กรุณาโหลดใหม่', 409, { code: 'EDIT_CONFLICT' });
      return json({ pack: packView({ ...pack, name, description, status, updated_at: now }) });
    }
    if (request.method === 'DELETE') {
      if (pack.status !== 'ARCHIVED') return bad('ต้อง Archive Pack ก่อนจึงจะลบได้', 409, { code: 'PACK_ACTIVE' });
      if (Number(pack.published_version || 0) > 0) return bad('Pack ที่เคย Publish แล้วห้ามลบถาวร เพื่อรักษาประวัติ Version', 409, { code: 'PACK_HAS_PUBLISHED_VERSIONS' });
      const body = await readBody(request, 16 * 1024);
      if (!body || cleanText(body.confirmName, 200) !== pack.name) return bad('กรุณาพิมพ์ชื่อ Pack ให้ตรงเพื่อยืนยันการลบ', 409, { code: 'CONFIRMATION_REQUIRED' });
      const results = await env.DB.batch([
        env.DB.prepare('DELETE FROM question_pack_items WHERE pack_id=?').bind(packId),
        env.DB.prepare("DELETE FROM question_packs WHERE id=? AND status='ARCHIVED' AND published_version=0").bind(packId),
      ]);
      if (!results.at(-1)?.meta?.changes) return bad('ลบ Pack ไม่สำเร็จ', 409);
      return json({ ok: true, packId, deleted: true });
    }
    return bad('Method not allowed', 405);
  }

  match = path.match(/^\/api\/admin\/question-packs\/([^/]+)\/items$/);
  if (match && request.method === 'POST') {
    const packId = safeDecode(match[1]), pack = packId && await requirePack(env, packId);
    if (!pack) return bad('ไม่พบ Question Pack', 404);
    if (pack.status !== 'ACTIVE') return bad('Pack ที่ Archive แล้วแก้ Composition ไม่ได้', 409);
    const body = await readBody(request, 256 * 1024), kind = String(body?.kind || '').toUpperCase(), now = new Date().toISOString();
    if (!['MANUAL', 'POOL'].includes(kind)) return bad('ชนิดรายการ Pack ไม่ถูกต้อง');
    let configs;
    if (kind === 'MANUAL') {
      const requested = Array.isArray(body?.questionIds) ? body.questionIds : [body?.questionId];
      const questionIds = [...new Set(requested.map(value => cleanText(value, 160)).filter(Boolean))].slice(0, 200);
      if (!questionIds.length) return bad('ไม่ได้เลือกคำถาม');
      const placeholders = questionIds.map(() => '?').join(',');
      const rows = await env.DB.prepare(`SELECT id,bank_id,status FROM bank_questions WHERE id IN (${placeholders})`).bind(...questionIds).all();
      const byId = new Map((rows.results || []).map(question => [question.id, question]));
      if (byId.size !== questionIds.length) return bad('มีคำถามที่ไม่พบ', 404);
      if (questionIds.some(questionId => byId.get(questionId)?.status !== 'READY')) return bad('เพิ่มเข้า Pack ได้เฉพาะคำถามพร้อมใช้', 409, { code: 'QUESTION_NOT_READY' });
      const duplicates = await env.DB.prepare(`SELECT json_extract(config_json,'$.questionId') AS question_id FROM question_pack_items WHERE pack_id=? AND kind='MANUAL' AND json_extract(config_json,'$.questionId') IN (${placeholders})`).bind(packId, ...questionIds).all();
      if ((duplicates.results || []).length) return bad('มีคำถามที่อยู่ในชุดนี้แล้ว', 409, { code: 'DUPLICATE_MANUAL_QUESTION', questionIds: (duplicates.results || []).map(row => row.question_id) });
      configs = questionIds.map(questionId => ({ questionId, bankId: byId.get(questionId).bank_id }));
    } else {
      const config = normalizePoolConfig(body?.config || body);
      const errors = await validatePoolReferences(env, config);
      if (errors.length) return bad('Pool configuration ไม่ถูกต้อง', 422, { errors });
      configs = [config];
    }
    const position = await nextPosition(env, packId);
    const items = configs.map((config, index) => ({ id: id('packitem'), pack_id: packId, kind, position: position + index, config_json: JSON.stringify(config), created_at: now, updated_at: now }));
    await env.DB.batch([
      ...items.map(item => env.DB.prepare('INSERT INTO question_pack_items (id,pack_id,kind,position,config_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(item.id, item.pack_id, item.kind, item.position, item.config_json, item.created_at, item.updated_at)),
      env.DB.prepare('UPDATE question_packs SET updated_at=? WHERE id=?').bind(now, packId),
    ]);
    return json({ item: itemView(items[0]), items: items.map(itemView), added: items.length }, 201);
  }

  match = path.match(/^\/api\/admin\/question-packs\/([^/]+)\/items\/order$/);
  if (match && request.method === 'PUT') {
    const packId = safeDecode(match[1]), pack = packId && await requirePack(env, packId);
    if (!pack) return bad('ไม่พบ Question Pack', 404);
    if (pack.status !== 'ACTIVE') return bad('Pack ที่ Archive แล้วจัดลำดับไม่ได้', 409);
    const body = await readBody(request, 128 * 1024), itemIds = Array.isArray(body?.itemIds) ? body.itemIds.map(String) : [];
    const existing = await loadItems(env, packId), expected = new Set(existing.map(item => item.id));
    if (itemIds.length !== expected.size || new Set(itemIds).size !== expected.size || itemIds.some(itemId => !expected.has(itemId))) return bad('รายการลำดับไม่ครบหรือมี Item ที่ไม่อยู่ใน Pack');
    const now = new Date().toISOString(), temporary = itemIds.map((itemId, index) => env.DB.prepare('UPDATE question_pack_items SET position=?,updated_at=? WHERE id=? AND pack_id=?').bind(index + 1000000, now, itemId, packId));
    const final = itemIds.map((itemId, index) => env.DB.prepare('UPDATE question_pack_items SET position=?,updated_at=? WHERE id=? AND pack_id=?').bind(index, now, itemId, packId));
    await env.DB.batch([...temporary, ...final, env.DB.prepare('UPDATE question_packs SET updated_at=? WHERE id=?').bind(now, packId)]);
    return json({ ok: true, itemIds });
  }

  match = path.match(/^\/api\/admin\/question-packs\/([^/]+)\/items\/([^/]+)$/);
  if (match) {
    const packId = safeDecode(match[1]), itemId = safeDecode(match[2]), pack = packId && await requirePack(env, packId);
    if (!pack) return bad('ไม่พบ Question Pack', 404);
    if (pack.status !== 'ACTIVE') return bad('Pack ที่ Archive แล้วแก้ Composition ไม่ได้', 409);
    const row = await env.DB.prepare('SELECT id,pack_id,kind,position,config_json,created_at,updated_at FROM question_pack_items WHERE id=? AND pack_id=?').bind(itemId, packId).first();
    if (!row) return bad('ไม่พบ Pack Item', 404);
    if (request.method === 'PATCH') {
      const body = await readBody(request, 128 * 1024), current = itemView(row); let config;
      if (current.kind === 'MANUAL') {
        const questionId = cleanText(body?.questionId ?? current.config.questionId, 160), question = questionId && await env.DB.prepare('SELECT id,bank_id,status FROM bank_questions WHERE id=?').bind(questionId).first();
        if (!question) return bad('ไม่พบคำถาม', 404);
        if (question.status !== 'READY') return bad('ใช้ใน Pack ได้เฉพาะคำถามสถานะ READY', 409);
        config = { questionId, bankId: question.bank_id };
      } else {
        config = normalizePoolConfig(body?.config || body || current.config);
        const errors = await validatePoolReferences(env, config);
        if (errors.length) return bad('Pool configuration ไม่ถูกต้อง', 422, { errors });
      }
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare('UPDATE question_pack_items SET config_json=?,updated_at=? WHERE id=? AND pack_id=?').bind(JSON.stringify(config), now, itemId, packId),
        env.DB.prepare('UPDATE question_packs SET updated_at=? WHERE id=?').bind(now, packId),
      ]);
      return json({ item: itemView({ ...row, config_json: JSON.stringify(config), updated_at: now }) });
    }
    if (request.method === 'DELETE') {
      const all = await loadItems(env, packId), remaining = all.filter(item => item.id !== itemId), now = new Date().toISOString();
      const statements = [env.DB.prepare('DELETE FROM question_pack_items WHERE id=? AND pack_id=?').bind(itemId, packId)];
      for (const [index, item] of remaining.entries()) statements.push(env.DB.prepare('UPDATE question_pack_items SET position=?,updated_at=? WHERE id=? AND pack_id=?').bind(index, now, item.id, packId));
      statements.push(env.DB.prepare('UPDATE question_packs SET updated_at=? WHERE id=?').bind(now, packId));
      await env.DB.batch(statements);
      return json({ ok: true, itemId, deleted: true });
    }
    return bad('Method not allowed', 405);
  }

  match = path.match(/^\/api\/admin\/question-packs\/([^/]+)\/preview$/);
  if (match && request.method === 'POST') {
    const packId = safeDecode(match[1]), pack = packId && await requirePack(env, packId);
    if (!pack) return bad('ไม่พบ Question Pack', 404);
    const result = await resolvePackDraft(env, packView(pack), await loadItems(env, packId), { randomize: true, version: 0 });
    return json({ preview: { valid: result.valid, errors: result.errors, estimatedQuestionCount: result.estimatedQuestionCount, resolvedQuestionCount: result.resolvedQuestionCount, items: result.items, questions: consumerPackProjection(result.snapshot).questions } });
  }

  match = path.match(/^\/api\/admin\/question-packs\/([^/]+)\/publish$/);
  if (match && request.method === 'POST') {
    const packId = safeDecode(match[1]), pack = packId && await requirePack(env, packId);
    if (!pack) return bad('ไม่พบ Question Pack', 404);
    if (pack.status !== 'ACTIVE') return bad('ต้อง Restore Pack ก่อน Publish', 409);
    const nextVersion = Number(pack.published_version || 0) + 1;
    const result = await resolvePackDraft(env, packView(pack), await loadItems(env, packId), { randomize: true, version: nextVersion });
    if (!result.valid) return bad('Pack ยัง Publish ไม่ได้', 422, { validation: { valid: false, errors: result.errors, items: result.items } });
    const now = new Date().toISOString();
    result.snapshot.resolvedAt = now;
    try {
      const expectedVersion = Number(pack.published_version || 0);
      const writes = await env.DB.batch([
        env.DB.prepare('INSERT INTO question_pack_versions (pack_id,version,snapshot_json,question_count,published_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM question_packs WHERE id=? AND published_version=? AND status=\'ACTIVE\')').bind(packId, nextVersion, JSON.stringify(result.snapshot), result.snapshot.questions.length, now, packId, expectedVersion),
        env.DB.prepare('UPDATE question_packs SET published_version=?,published_at=?,updated_at=? WHERE id=? AND published_version=? AND status=\'ACTIVE\'').bind(nextVersion, now, now, packId, expectedVersion),
      ]);
      if (writes[0]?.meta?.changes !== 1 || writes[1]?.meta?.changes !== 1) return bad('Pack ถูก Publish หรือเปลี่ยนสถานะจากหน้าต่างอื่นแล้ว กรุณาโหลดใหม่', 409);
    } catch (error) {
      if (/unique|constraint/i.test(String(error?.message || error))) return bad('Pack ถูก Publish พร้อมกัน กรุณาโหลดใหม่', 409);
      throw error;
    }
    return json({ ok: true, publication: { version: nextVersion, questionCount: result.snapshot.questions.length, publishedAt: now } }, 201);
  }

  match = path.match(/^\/api\/admin\/question-packs\/([^/]+)\/versions$/);
  if (match && request.method === 'GET') {
    const packId = safeDecode(match[1]), pack = packId && await requirePack(env, packId);
    if (!pack) return bad('ไม่พบ Question Pack', 404);
    const result = await env.DB.prepare('SELECT version,question_count,published_at FROM question_pack_versions WHERE pack_id=? ORDER BY version DESC').bind(packId).all();
    return json({ versions: (result.results || []).map(row => ({ version: Number(row.version), questionCount: Number(row.question_count), publishedAt: row.published_at })) });
  }

  match = path.match(/^\/api\/admin\/question-packs\/([^/]+)\/versions\/(\d+)$/);
  if (match && request.method === 'GET') {
    const packId = safeDecode(match[1]), version = Number(match[2]), pack = packId && await requirePack(env, packId);
    if (!pack) return bad('ไม่พบ Question Pack', 404);
    const row = await env.DB.prepare('SELECT snapshot_json,question_count,published_at FROM question_pack_versions WHERE pack_id=? AND version=?').bind(packId, version).first();
    if (!row) return bad('ไม่พบ Published Pack Version', 404);
    return json({ version: { version, questionCount: Number(row.question_count), publishedAt: row.published_at, snapshot: parseJson(row.snapshot_json, {}) }, trustedAdminOnly: true });
  }

  return bad('Question Pack admin route not found', 404);
}
