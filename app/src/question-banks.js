const BANK_STATUSES = new Set(['ACTIVE', 'ARCHIVED']);
const QUESTION_STATUSES = new Set(['DRAFT', 'READY', 'ARCHIVED']);
const LEGACY_QUESTION_TYPES = new Set(['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER']);
const QUESTION_TYPES = new Set([...LEGACY_QUESTION_TYPES, 'ORDERING', 'MATCHING', 'DRAG_DROP']);
const MEDIA_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const SORT_SQL = {
  updated: 'q.updated_at DESC',
  created: 'q.created_at DESC',
  difficulty_asc: 'q.difficulty ASC, q.updated_at DESC',
  difficulty_desc: 'q.difficulty DESC, q.updated_at DESC',
  prompt: 'q.prompt COLLATE NOCASE ASC, q.updated_at DESC',
};

const cleanText = (value, max = 4000) => String(value ?? '').trim().slice(0, max);
const safeDecode = value => { try { return decodeURIComponent(value); } catch { return ''; } };
const parseJson = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const effectiveType = row => String(row?.activity_type || row?.type || '').toUpperCase();

function normalizeMedia(input) {
  if (!input) return null;
  const source = typeof input === 'string' ? { path: input } : input;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const path = String(source.path || '').trim().replaceAll('\\', '/').slice(0, 600);
  const extension = path.split('.').pop()?.toLowerCase();
  if (!path.startsWith('/assets/question-media/versioned/') || path.includes('..') || !MEDIA_EXTENSIONS.has(extension)) return null;
  return { path, alt: cleanText(source.alt, 500) };
}
export const normalizeQuestionMedia = normalizeMedia;

const contentPresent = item => !!cleanText(item?.text ?? item?.label, 1000) || !!item?.media?.path;
const completeOrder = (requested, ids, fallback = ids) => {
  const available = new Set(ids), result = [...new Set((Array.isArray(requested) ? requested : []).map(String))].filter(id => available.has(id));
  for (const id of fallback) if (!result.includes(id)) result.push(id);
  for (const id of ids) if (!result.includes(id)) result.push(id);
  return result;
};

function defaultAnswerConfig(type, makeId) {
  if (type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE') return {
    choices: [
      { id: makeId('choice'), text: '' },
      { id: makeId('choice'), text: '' },
    ],
    correctIds: [],
  };
  if (type === 'TRUE_FALSE') return { correctAnswer: null };
  if (type === 'ORDERING') return {
    items: [{ id: makeId('order'), text: '', media: null }, { id: makeId('order'), text: '', media: null }],
    correctOrder: [],
  };
  if (type === 'MATCHING') return {
    pairs: [
      { id: makeId('pair'), leftId: makeId('left'), rightId: makeId('right'), leftText: '', rightText: '', leftMedia: null, rightMedia: null },
      { id: makeId('pair'), leftId: makeId('left'), rightId: makeId('right'), leftText: '', rightText: '', leftMedia: null, rightMedia: null },
    ],
    rightDistractors: [], leftOrder: [], rightOrder: [],
  };
  if (type === 'DRAG_DROP') return {
    targets: [{ id: makeId('target'), label: '', media: null }],
    tokens: [{ id: makeId('token'), text: '', media: null, targetId: '' }],
  };
  return { acceptedAnswers: [], caseSensitive: false, trimWhitespace: true, normalizeUnicode: true };
}

export function normalizeAnswerConfig(type, input, makeId = prefix => `${prefix}_${crypto.randomUUID()}`) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE') {
    const seen = new Set();
    let choices = (Array.isArray(source.choices) ? source.choices : []).slice(0, 100).map(choice => {
      let choiceId = cleanText(choice?.id, 120);
      if (!choiceId || seen.has(choiceId)) choiceId = makeId('choice');
      seen.add(choiceId);
      return { id: choiceId, text: cleanText(choice?.text, 1000), media: normalizeMedia(choice?.media) };
    });
    while (choices.length < 2) choices.push({ id: makeId('choice'), text: '' });
    const available = new Set(choices.map(choice => choice.id));
    let correctIds = [...new Set((Array.isArray(source.correctIds) ? source.correctIds : []).map(String))].filter(value => available.has(value));
    if (type === 'SINGLE_CHOICE') correctIds = correctIds.slice(0, 1);
    return { choices, correctIds };
  }
  if (type === 'TRUE_FALSE') return { correctAnswer: typeof source.correctAnswer === 'boolean' ? source.correctAnswer : null };
  if (type === 'ORDERING') {
    const seen = new Set();
    let items = (Array.isArray(source.items) ? source.items : []).slice(0, 100).map(item => {
      let itemId = cleanText(item?.id, 120);
      if (!itemId || seen.has(itemId)) itemId = makeId('order');
      seen.add(itemId);
      return { id: itemId, text: cleanText(item?.text, 1000), media: normalizeMedia(item?.media) };
    });
    while (items.length < 2) { const id = makeId('order'); items.push({ id, text: '', media: null }); }
    const ids = items.map(item => item.id), available = new Set(ids);
    const requested = [...new Set((Array.isArray(source.correctOrder) ? source.correctOrder : []).map(String))].filter(id => available.has(id));
    return { items, correctOrder: requested.length === ids.length ? requested : ids };
  }
  if (type === 'MATCHING') {
    const pairIds = new Set(), leftIds = new Set(), rightIds = new Set();
    const pairs = (Array.isArray(source.pairs) ? source.pairs : []).slice(0, 100).map(pair => {
      let id = cleanText(pair?.id, 120), leftId = cleanText(pair?.leftId, 120), rightId = cleanText(pair?.rightId, 120);
      if (!id || pairIds.has(id)) id = makeId('pair');
      if (!leftId || leftIds.has(leftId)) leftId = makeId('left');
      if (!rightId || rightIds.has(rightId)) rightId = makeId('right');
      pairIds.add(id); leftIds.add(leftId); rightIds.add(rightId);
      return { id, leftId, rightId, leftText: cleanText(pair?.leftText, 1000), rightText: cleanText(pair?.rightText, 1000), leftMedia: normalizeMedia(pair?.leftMedia), rightMedia: normalizeMedia(pair?.rightMedia) };
    });
    while (pairs.length < 2) pairs.push({ id: makeId('pair'), leftId: makeId('left'), rightId: makeId('right'), leftText: '', rightText: '', leftMedia: null, rightMedia: null });
    pairs.forEach(pair => { pairIds.add(pair.id); leftIds.add(pair.leftId); rightIds.add(pair.rightId); });
    const distractorIds = new Set();
    const rightDistractors = (Array.isArray(source.rightDistractors) ? source.rightDistractors : []).slice(0, 100).map(item => {
      let id = cleanText(item?.id, 120), rightId = cleanText(item?.rightId, 120);
      if (!id || pairIds.has(id) || distractorIds.has(id)) id = makeId('distractor');
      if (!rightId || rightIds.has(rightId)) rightId = makeId('right');
      distractorIds.add(id); rightIds.add(rightId);
      return { id, rightId, rightText: cleanText(item?.rightText, 1000), rightMedia: normalizeMedia(item?.rightMedia) };
    });
    const leftList = pairs.map(pair => pair.leftId), rightList = [...pairs.map(pair => pair.rightId), ...rightDistractors.map(item => item.rightId)];
    return {
      pairs, rightDistractors,
      leftOrder: completeOrder(source.leftOrder, leftList),
      rightOrder: completeOrder(source.rightOrder, rightList, [...pairs.map(pair => pair.rightId)].reverse().concat(rightDistractors.map(item => item.rightId))),
    };
  }
  if (type === 'DRAG_DROP') {
    const targetIds = new Set(), tokenIds = new Set();
    const targets = (Array.isArray(source.targets) ? source.targets : []).slice(0, 50).map(target => {
      let id = cleanText(target?.id, 120); if (!id || targetIds.has(id)) id = makeId('target'); targetIds.add(id);
      return { id, label: cleanText(target?.label, 1000), media: normalizeMedia(target?.media) };
    });
    if (!targets.length) { const id = makeId('target'); targets.push({ id, label: '', media: null }); targetIds.add(id); }
    const tokens = (Array.isArray(source.tokens) ? source.tokens : []).slice(0, 100).map(token => {
      let id = cleanText(token?.id, 120); if (!id || tokenIds.has(id)) id = makeId('token'); tokenIds.add(id);
      const targetId = cleanText(token?.targetId, 120);
      return { id, text: cleanText(token?.text, 1000), media: normalizeMedia(token?.media), targetId: targetIds.has(targetId) ? targetId : '' };
    });
    if (!tokens.length) tokens.push({ id: makeId('token'), text: '', media: null, targetId: '' });
    return { targets, tokens };
  }
  return {
    acceptedAnswers: [...new Set((Array.isArray(source.acceptedAnswers) ? source.acceptedAnswers : []).map(value => cleanText(value, 1000)).filter(Boolean))].slice(0, 100),
    caseSensitive: !!source.caseSensitive,
    trimWhitespace: source.trimWhitespace !== false,
    normalizeUnicode: source.normalizeUnicode !== false,
  };
}

export function readyValidation(question) {
  const errors = [];
  const type = String(question?.type || '');
  const config = question?.answerConfig || question?.answer_config || {};
  if (!cleanText(question?.prompt, 12000)) errors.push('กรุณาใส่คำถาม');
  if (type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE') {
    const choices = (config.choices || []).filter(contentPresent);
    if (choices.length < 2) errors.push('ต้องมีตัวเลือกที่มีข้อความหรือรูปอย่างน้อย 2 ตัวเลือก');
    const validIds = new Set(choices.map(choice => choice.id));
    const correct = (config.correctIds || []).filter(value => validIds.has(value));
    if (!correct.length) errors.push(type === 'SINGLE_CHOICE' ? 'กรุณาเลือกคำตอบที่ถูกต้อง' : 'กรุณาเลือกคำตอบที่ถูกต้องอย่างน้อยหนึ่งข้อ');
    if (type === 'SINGLE_CHOICE' && correct.length !== 1) errors.push('Single Choice ต้องมีคำตอบที่ถูกต้องเพียงหนึ่งข้อ');
  } else if (type === 'TRUE_FALSE') {
    if (typeof config.correctAnswer !== 'boolean') errors.push('กรุณาเลือก True หรือ False เป็นคำตอบที่ถูกต้อง');
  } else if (type === 'SHORT_ANSWER') {
    if (!(config.acceptedAnswers || []).some(value => cleanText(value, 1000))) errors.push('กรุณาใส่คำตอบที่ยอมรับอย่างน้อยหนึ่งค่า');
  } else if (type === 'ORDERING') {
    const items = config.items || [], complete = items.filter(contentPresent), ids = new Set(items.map(item => item.id));
    if (complete.length < 2 || complete.length !== items.length) errors.push('ต้องมีรายการเรียงลำดับที่มีข้อความหรือรูปอย่างน้อย 2 รายการ');
    if ((config.correctOrder || []).length !== items.length || (config.correctOrder || []).some(id => !ids.has(id))) errors.push('ลำดับคำตอบที่ถูกต้องยังไม่ครบ');
  } else if (type === 'MATCHING') {
    const pairs = config.pairs || [], distractors = config.rightDistractors || [];
    if (pairs.length < 2 || pairs.some(pair => !contentPresent({ text: pair.leftText, media: pair.leftMedia }) || !contentPresent({ text: pair.rightText, media: pair.rightMedia }))) errors.push('ต้องมีคู่ที่กรอกครบทั้งสองฝั่งอย่างน้อย 2 คู่');
    if (distractors.some(item => !contentPresent({ text: item.rightText, media: item.rightMedia }))) errors.push('กรอกตัวหลอกฝั่งขวาให้ครบ หรือเอารายการที่ว่างออก');
  } else if (type === 'DRAG_DROP') {
    const targets = config.targets || [], tokens = config.tokens || [], targetIds = new Set(targets.map(target => target.id));
    if (!targets.length || targets.some(target => !contentPresent(target))) errors.push('ต้องมีพื้นที่วางที่มีชื่อหรือรูปอย่างน้อย 1 จุด');
    if (!tokens.length || tokens.some(token => !contentPresent(token))) errors.push('ต้องมีชิ้นที่จะลากที่มีข้อความหรือรูปอย่างน้อย 1 ชิ้น');
    if (tokens.some(token => token.targetId && !targetIds.has(token.targetId))) errors.push('พื้นที่วางที่เลือกไม่ถูกต้อง');
    if (tokens.length && !tokens.some(token => token.targetId)) errors.push('ต้องมีชิ้นคำตอบที่วางลงพื้นที่อย่างน้อย 1 ชิ้น');
  } else errors.push('ประเภทคำถามไม่ถูกต้อง');
  return { valid: errors.length === 0, errors };
}

function questionView(row, tagRows = []) {
  const answerConfig = parseJson(row.answer_config, {});
  const type = effectiveType(row);
  return {
    id: row.id,
    bankId: row.bank_id,
    type,
    prompt: row.prompt,
    description: row.description,
    difficulty: Number(row.difficulty),
    status: row.status,
    answerConfig,
    media: normalizeMedia(parseJson(row.media_json, null)),
    explanation: row.explanation,
    internalNotes: row.internal_notes,
    sourceReference: row.source_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags: tagRows.filter(tag => tag.question_id === row.id).map(({ question_id, ...tag }) => ({
      id: tag.id, name: tag.name, groupName: tag.group_name || '',
    })),
    readiness: readyValidation({ ...row, type, answerConfig }),
  };
}

// Deliberately separate from the trusted editor representation. Future pack APIs
// can build on this without leaking correct answers, internal notes, or metadata.
export function toConsumerQuestion(question) {
  const answerConfig = question?.answerConfig || {};
  const publicAnswer = question?.type === 'SINGLE_CHOICE' || question?.type === 'MULTIPLE_CHOICE'
    ? { choices: (answerConfig.choices || []).map(({ id, text, media }) => ({ id, text, ...(normalizeMedia(media) ? { media: normalizeMedia(media) } : {}) })) }
    : question?.type === 'SHORT_ANSWER'
      ? { caseSensitive: !!answerConfig.caseSensitive, trimWhitespace: answerConfig.trimWhitespace !== false, normalizeUnicode: answerConfig.normalizeUnicode !== false }
      : question?.type === 'ORDERING'
        ? { items: (answerConfig.items || []).map(({ id, text, media }) => ({ id, text, media: normalizeMedia(media) })) }
        : question?.type === 'MATCHING'
          ? (() => {
            const pairs = answerConfig.pairs || [], distractors = answerConfig.rightDistractors || [];
            const left = pairs.map(pair => ({ id: pair.leftId, text: pair.leftText, media: normalizeMedia(pair.leftMedia) }));
            const right = [...pairs.map(pair => ({ id: pair.rightId, text: pair.rightText, media: normalizeMedia(pair.rightMedia) })), ...distractors.map(item => ({ id: item.rightId, text: item.rightText, media: normalizeMedia(item.rightMedia) }))];
            const leftMap = new Map(left.map(item => [item.id, item])), rightMap = new Map(right.map(item => [item.id, item]));
            return { leftItems: completeOrder(answerConfig.leftOrder, left.map(item => item.id)).map(id => leftMap.get(id)), rightItems: completeOrder(answerConfig.rightOrder, right.map(item => item.id), pairs.map(pair => pair.rightId).reverse().concat(distractors.map(item => item.rightId))).map(id => rightMap.get(id)) };
          })()
          : question?.type === 'DRAG_DROP'
            ? { targets: (answerConfig.targets || []).map(({ id, label, media }) => ({ id, label, media: normalizeMedia(media) })), tokens: (answerConfig.tokens || []).map(({ id, text, media }) => ({ id, text, media: normalizeMedia(media) })) }
            : {};
  return {
    id: question?.id,
    type: question?.type,
    prompt: question?.prompt || '',
    description: question?.description || '',
    difficulty: Number(question?.difficulty || 3),
    answerConfig: publicAnswer,
    media: normalizeMedia(question?.media),
    explanation: question?.explanation || '',
    tags: (question?.tags || []).map(tag => ({ id: tag.id, name: tag.name, groupName: tag.groupName || '' })),
  };
}

async function requireBank(env, bankId) {
  return env.DB.prepare('SELECT id,name,description,status,created_at,updated_at FROM question_banks WHERE id=?').bind(bankId).first();
}

async function tagsForQuestions(env, ids) {
  if (!ids.length) return [];
  const rows = [];
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80), placeholders = chunk.map(() => '?').join(',');
    const result = await env.DB.prepare(`SELECT l.question_id,t.id,t.name,t.group_name FROM question_tag_links l JOIN question_tags t ON t.id=l.tag_id WHERE l.question_id IN (${placeholders}) ORDER BY COALESCE(t.group_name,''),t.name`).bind(...chunk).all();
    rows.push(...(result.results || []));
  }
  return rows;
}

async function replaceTags(env, bankId, questionId, requested, now) {
  const tagIds = [...new Set((Array.isArray(requested) ? requested : []).map(String).filter(Boolean))].slice(0, 50);
  if (tagIds.length) {
    const placeholders = tagIds.map(() => '?').join(',');
    const found = await env.DB.prepare(`SELECT id FROM question_tags WHERE bank_id=? AND id IN (${placeholders})`).bind(bankId, ...tagIds).all();
    if ((found.results || []).length !== tagIds.length) return { error: 'มี Tag ที่ไม่ได้อยู่ใน Bank นี้' };
  }
  const statements = [env.DB.prepare('DELETE FROM question_tag_links WHERE question_id=?').bind(questionId)];
  for (const tagId of tagIds) statements.push(env.DB.prepare('INSERT INTO question_tag_links (question_id,tag_id,assigned_at) VALUES (?,?,?)').bind(questionId, tagId, now));
  await env.DB.batch(statements);
  return { tagIds };
}

function questionFields(body, current, makeId) {
  const currentType = effectiveType(current);
  const type = body.type == null ? currentType : String(body.type).toUpperCase();
  if (!QUESTION_TYPES.has(type)) return { error: 'ประเภทคำถามไม่ถูกต้อง' };
  const difficulty = body.difficulty == null ? Number(current.difficulty) : Number(body.difficulty);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) return { error: 'Difficulty ต้องเป็นจำนวนเต็ม 1–5' };
  const requestedStatus = body.status == null ? current.status : String(body.status).toUpperCase();
  if (!QUESTION_STATUSES.has(requestedStatus)) return { error: 'สถานะคำถามไม่ถูกต้อง' };
  const oldConfig = parseJson(current.answer_config, {});
  const changedType = type !== currentType;
  const configSource = body.answerConfig == null ? (changedType ? defaultAnswerConfig(type, makeId) : oldConfig) : body.answerConfig;
  const answerConfig = normalizeAnswerConfig(type, configSource, makeId);
  const fields = {
    type,
    prompt: body.prompt == null ? current.prompt : cleanText(body.prompt, 12000),
    description: body.description == null ? current.description : cleanText(body.description, 12000),
    difficulty,
    status: requestedStatus,
    answerConfig,
    media: body.media == null ? normalizeMedia(parseJson(current.media_json, null)) : normalizeMedia(body.media),
    explanation: body.explanation == null ? current.explanation : cleanText(body.explanation, 12000),
    internalNotes: body.internalNotes == null ? current.internal_notes : cleanText(body.internalNotes, 12000),
    sourceReference: body.sourceReference == null ? current.source_reference : cleanText(body.sourceReference, 2000),
  };
  const readiness = readyValidation(fields);
  if (requestedStatus === 'READY' && !readiness.valid) return { error: 'คำถามยังไม่พร้อมใช้งาน', readiness };
  fields.status = requestedStatus === 'ARCHIVED' ? 'ARCHIVED' : readiness.valid ? 'READY' : 'DRAFT';
  fields.storageType = LEGACY_QUESTION_TYPES.has(type) ? type : 'SHORT_ANSWER';
  fields.activityType = LEGACY_QUESTION_TYPES.has(type) ? null : type;
  return { fields, readiness };
}

function duplicateAnswerConfig(type, input, makeId) {
  const source = parseJson(JSON.stringify(input || {}), {});
  if (type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE') {
    const map = new Map((source.choices || []).map(choice => [choice.id, makeId('choice')]));
    return normalizeAnswerConfig(type, { choices: (source.choices || []).map(choice => ({ ...choice, id: map.get(choice.id) })), correctIds: (source.correctIds || []).map(id => map.get(id)).filter(Boolean) }, makeId);
  }
  if (type === 'ORDERING') {
    const map = new Map((source.items || []).map(item => [item.id, makeId('order')]));
    return normalizeAnswerConfig(type, { items: (source.items || []).map(item => ({ ...item, id: map.get(item.id) })), correctOrder: (source.correctOrder || []).map(id => map.get(id)).filter(Boolean) }, makeId);
  }
  if (type === 'MATCHING') {
    const leftMap = new Map(), rightMap = new Map();
    const pairs = (source.pairs || []).map(pair => {
      const leftId = makeId('left'), rightId = makeId('right'); leftMap.set(pair.leftId, leftId); rightMap.set(pair.rightId, rightId);
      return { ...pair, id: makeId('pair'), leftId, rightId };
    });
    const rightDistractors = (source.rightDistractors || []).map(item => { const rightId = makeId('right'); rightMap.set(item.rightId, rightId); return { ...item, id: makeId('distractor'), rightId }; });
    return normalizeAnswerConfig(type, { pairs, rightDistractors, leftOrder: (source.leftOrder || []).map(id => leftMap.get(id)).filter(Boolean), rightOrder: (source.rightOrder || []).map(id => rightMap.get(id)).filter(Boolean) }, makeId);
  }
  if (type === 'DRAG_DROP') {
    const targets = (source.targets || []).map(target => ({ ...target, id: makeId('target'), oldId: target.id }));
    const map = new Map(targets.map(target => [target.oldId, target.id]));
    return normalizeAnswerConfig(type, { targets: targets.map(({ oldId, ...target }) => target), tokens: (source.tokens || []).map(token => ({ ...token, id: makeId('token'), targetId: map.get(token.targetId) || '' })) }, makeId);
  }
  return normalizeAnswerConfig(type, source, makeId);
}

export async function handleQuestionBankRequest(request, env, helpers) {
  const { json, bad, readBody, id, isAdmin } = helpers;
  const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '') || '/';
  if (!path.startsWith('/api/admin/question-banks')) return null;
  if (!isAdmin(request, env)) return bad('Unauthorized', 401);
  const makeId = prefix => id(prefix);

  if (path === '/api/admin/question-banks') {
    if (request.method === 'GET') {
      const status = String(url.searchParams.get('status') || 'ACTIVE').toUpperCase();
      if (!BANK_STATUSES.has(status) && status !== 'ALL') return bad('สถานะ Bank ไม่ถูกต้อง');
      const search = cleanText(url.searchParams.get('search'), 200).toLocaleLowerCase();
      const where = [], args = [];
      if (status !== 'ALL') { where.push('b.status=?'); args.push(status); }
      if (search) { where.push("(LOWER(b.name) LIKE ? ESCAPE '\\' OR LOWER(b.description) LIKE ? ESCAPE '\\')"); const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`; args.push(like, like); }
      const result = await env.DB.prepare(`SELECT b.id,b.name,b.description,b.status,b.created_at,b.updated_at,COUNT(q.id) AS question_count FROM question_banks b LEFT JOIN bank_questions q ON q.bank_id=b.id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} GROUP BY b.id ORDER BY b.updated_at DESC`).bind(...args).all();
      return json({ banks: (result.results || []).map(row => ({ ...row, question_count: Number(row.question_count || 0) })) });
    }
    if (request.method === 'POST') {
      const body = await readBody(request, 32 * 1024);
      if (!body) return bad('ข้อมูล Bank ไม่ถูกต้อง');
      const name = cleanText(body.name, 200), description = cleanText(body.description, 4000);
      if (!name) return bad('กรุณาใส่ชื่อ Question Bank');
      const bankId = makeId('bank'), now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO question_banks (id,name,description,status,created_at,updated_at) VALUES (?,?,?,'ACTIVE',?,?)").bind(bankId, name, description, now, now).run();
      return json({ bank: { id: bankId, name, description, status: 'ACTIVE', question_count: 0, created_at: now, updated_at: now } }, 201);
    }
    return bad('Method not allowed', 405);
  }

  let match = path.match(/^\/api\/admin\/question-banks\/([^/]+)$/);
  if (match) {
    const bankId = safeDecode(match[1]);
    if (!bankId) return bad('Bank ID ไม่ถูกต้อง');
    const bank = await requireBank(env, bankId);
    if (!bank) return bad('ไม่พบ Question Bank', 404);
    if (request.method === 'GET') {
      const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM bank_questions WHERE bank_id=?').bind(bankId).first();
      return json({ bank: { ...bank, question_count: Number(count?.count || 0) } });
    }
    if (request.method === 'PATCH') {
      const body = await readBody(request, 32 * 1024);
      if (!body) return bad('ข้อมูล Bank ไม่ถูกต้อง');
      const name = body.name == null ? bank.name : cleanText(body.name, 200);
      const description = body.description == null ? bank.description : cleanText(body.description, 4000);
      const status = body.status == null ? bank.status : String(body.status).toUpperCase();
      if (!name) return bad('กรุณาใส่ชื่อ Question Bank');
      if (!BANK_STATUSES.has(status)) return bad('สถานะ Bank ไม่ถูกต้อง');
      const now = new Date().toISOString();
      await env.DB.prepare('UPDATE question_banks SET name=?,description=?,status=?,updated_at=? WHERE id=?').bind(name, description, status, now, bankId).run();
      return json({ bank: { ...bank, name, description, status, updated_at: now } });
    }
    if (request.method === 'DELETE') {
      if (bank.status !== 'ARCHIVED') return bad('ต้อง Archive Bank ก่อนจึงจะลบได้', 409, { code: 'BANK_ACTIVE' });
      const body = await readBody(request, 16 * 1024);
      if (!body || cleanText(body.confirmName, 200) !== bank.name) return bad('กรุณาพิมพ์ชื่อ Bank ให้ตรงเพื่อยืนยันการลบ', 409, { code: 'CONFIRMATION_REQUIRED' });
      const statements = [
        env.DB.prepare('DELETE FROM question_tag_links WHERE question_id IN (SELECT id FROM bank_questions WHERE bank_id=?)').bind(bankId),
        env.DB.prepare('DELETE FROM bank_questions WHERE bank_id=?').bind(bankId),
        env.DB.prepare('DELETE FROM question_tags WHERE bank_id=?').bind(bankId),
        env.DB.prepare("DELETE FROM question_banks WHERE id=? AND status='ARCHIVED'").bind(bankId),
      ];
      const results = await env.DB.batch(statements);
      if (!results.at(-1)?.meta?.changes) return bad('ลบ Question Bank ไม่สำเร็จ', 409);
      return json({ ok: true, bankId, deleted: true });
    }
    return bad('Method not allowed', 405);
  }

  match = path.match(/^\/api\/admin\/question-banks\/([^/]+)\/questions$/);
  if (match) {
    const bankId = safeDecode(match[1]), bank = bankId && await requireBank(env, bankId);
    if (!bank) return bad('ไม่พบ Question Bank', 404);
    if (request.method === 'GET') {
      const where = ['q.bank_id=?'], args = [bankId];
      const search = cleanText(url.searchParams.get('search'), 500).toLocaleLowerCase();
      if (search) { const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`; where.push("(LOWER(q.prompt) LIKE ? ESCAPE '\\' OR LOWER(q.description) LIKE ? ESCAPE '\\' OR LOWER(q.source_reference) LIKE ? ESCAPE '\\')"); args.push(like, like, like); }
      for (const [key, column, allowed] of [['status', 'q.status', QUESTION_STATUSES], ['type', 'q.type', QUESTION_TYPES]]) {
        const value = String(url.searchParams.get(key) || '').toUpperCase();
        if (value) {
          if (key === 'status' && value === 'ACTIVE') where.push("q.status<>'ARCHIVED'");
          else if (key === 'status' && value === 'ALL') { /* no status predicate */ }
          else { if (!allowed.has(value)) return bad(`${key} ไม่ถูกต้อง`); where.push(key === 'type' ? 'COALESCE(q.activity_type,q.type)=?' : `${column}=?`); args.push(value); }
        }
      }
      const difficulty = url.searchParams.get('difficulty');
      if (difficulty) { const value = Number(difficulty); if (!Number.isInteger(value) || value < 1 || value > 5) return bad('Difficulty ไม่ถูกต้อง'); where.push('q.difficulty=?'); args.push(value); }
      const includeTags = [...new Set(url.searchParams.getAll('tag').map(String).filter(Boolean))].slice(0, 20);
      const excludeTags = [...new Set(url.searchParams.getAll('excludeTag').map(String).filter(Boolean))].slice(0, 20);
      for (const tagId of includeTags) { where.push('EXISTS (SELECT 1 FROM question_tag_links il WHERE il.question_id=q.id AND il.tag_id=?)'); args.push(tagId); }
      for (const tagId of excludeTags) { where.push('NOT EXISTS (SELECT 1 FROM question_tag_links el WHERE el.question_id=q.id AND el.tag_id=?)'); args.push(tagId); }
      const sort = SORT_SQL[url.searchParams.get('sort')] || SORT_SQL.updated;
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100));
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM bank_questions q WHERE ${where.join(' AND ')}`).bind(...args).first();
      const result = await env.DB.prepare(`SELECT q.* FROM bank_questions q WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT ? OFFSET ?`).bind(...args, limit, offset).all();
      const rows = result.results || [], tagRows = await tagsForQuestions(env, rows.map(row => row.id));
      return json({ questions: rows.map(row => questionView(row, tagRows)), total: Number(total?.count || 0), limit, offset });
    }
    if (request.method === 'POST') {
      if (bank.status !== 'ACTIVE') return bad('Archived Bank เพิ่มคำถามใหม่ไม่ได้', 409);
      const body = await readBody(request, 256 * 1024) || {};
      const type = String(body.type || 'SINGLE_CHOICE').toUpperCase();
      if (!QUESTION_TYPES.has(type)) return bad('ประเภทคำถามไม่ถูกต้อง');
      const now = new Date().toISOString(), questionId = makeId('question'), config = normalizeAnswerConfig(type, body.answerConfig || defaultAnswerConfig(type, makeId), makeId);
      const difficulty = body.difficulty == null ? 3 : Number(body.difficulty);
      if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) return bad('Difficulty ต้องเป็นจำนวนเต็ม 1–5');
      const prompt = cleanText(body.prompt, 12000), description = cleanText(body.description, 12000), media = normalizeMedia(body.media);
      const readiness = readyValidation({ type, prompt, answerConfig: config }), status = readiness.valid ? 'READY' : 'DRAFT';
      const storageType = LEGACY_QUESTION_TYPES.has(type) ? type : 'SHORT_ANSWER', activityType = LEGACY_QUESTION_TYPES.has(type) ? null : type;
      await env.DB.prepare(`INSERT INTO bank_questions (id,bank_id,type,activity_type,prompt,description,difficulty,status,answer_config,media_json,explanation,internal_notes,source_reference,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(questionId, bankId, storageType, activityType, prompt, description, difficulty, status, JSON.stringify(config), JSON.stringify(media), cleanText(body.explanation, 12000), cleanText(body.internalNotes, 12000), cleanText(body.sourceReference, 2000), now, now).run();
      if (body.tagIds) { const assigned = await replaceTags(env, bankId, questionId, body.tagIds, now); if (assigned.error) return bad(assigned.error); }
      const row = await env.DB.prepare('SELECT * FROM bank_questions WHERE id=? AND bank_id=?').bind(questionId, bankId).first();
      const tagRows = await tagsForQuestions(env, [questionId]);
      return json({ question: questionView(row, tagRows) }, 201);
    }
    return bad('Method not allowed', 405);
  }

  match = path.match(/^\/api\/admin\/question-banks\/([^/]+)\/questions\/(?!bulk$)([^/]+)$/);
  if (match) {
    const bankId = safeDecode(match[1]), questionId = safeDecode(match[2]);
    const bank = bankId && await requireBank(env, bankId);
    if (!bank) return bad('ไม่พบ Question Bank', 404);
    const current = await env.DB.prepare('SELECT * FROM bank_questions WHERE id=? AND bank_id=?').bind(questionId, bankId).first();
    if (!current) return bad('ไม่พบคำถาม', 404);
    if (request.method === 'GET') return json({ question: questionView(current, await tagsForQuestions(env, [questionId])) });
    if (request.method === 'PATCH') {
      if (bank.status !== 'ACTIVE') return bad('Archived Bank แก้ไขคำถามไม่ได้', 409);
      const body = await readBody(request, 256 * 1024);
      if (!body) return bad('ข้อมูลคำถามไม่ถูกต้อง');
      if (body.baseUpdatedAt && String(body.baseUpdatedAt) !== current.updated_at) return bad('คำถามถูกแก้ไขจากหน้าต่างอื่นแล้ว กรุณาโหลดใหม่', 409, { code: 'EDIT_CONFLICT', updatedAt: current.updated_at });
      const normalized = questionFields(body, current, makeId);
      if (normalized.error) return bad(normalized.error, normalized.readiness ? 422 : 400, normalized.readiness ? { readiness: normalized.readiness } : {});
      const value = normalized.fields, now = new Date().toISOString();
      await env.DB.prepare('UPDATE bank_questions SET type=?,activity_type=?,prompt=?,description=?,difficulty=?,status=?,answer_config=?,media_json=?,explanation=?,internal_notes=?,source_reference=?,updated_at=? WHERE id=? AND bank_id=?')
        .bind(value.storageType, value.activityType, value.prompt, value.description, value.difficulty, value.status, JSON.stringify(value.answerConfig), JSON.stringify(value.media), value.explanation, value.internalNotes, value.sourceReference, now, questionId, bankId).run();
      if (body.tagIds != null) { const assigned = await replaceTags(env, bankId, questionId, body.tagIds, now); if (assigned.error) return bad(assigned.error); }
      const row = await env.DB.prepare('SELECT * FROM bank_questions WHERE id=? AND bank_id=?').bind(questionId, bankId).first();
      return json({ question: questionView(row, await tagsForQuestions(env, [questionId])) });
    }
    if (request.method === 'DELETE') {
      if (current.status !== 'ARCHIVED') return bad('ต้อง Archive คำถามก่อนจึงจะลบได้', 409);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM question_tag_links WHERE question_id=?').bind(questionId),
        env.DB.prepare("DELETE FROM bank_questions WHERE id=? AND bank_id=? AND status='ARCHIVED'").bind(questionId, bankId),
      ]);
      return json({ ok: true, questionId, deleted: true });
    }
    return bad('Method not allowed', 405);
  }

  match = path.match(/^\/api\/admin\/question-banks\/([^/]+)\/questions\/([^/]+)\/duplicate$/);
  if (match && request.method === 'POST') {
    const bankId = safeDecode(match[1]), sourceId = safeDecode(match[2]), bank = bankId && await requireBank(env, bankId);
    if (!bank) return bad('ไม่พบ Question Bank', 404);
    if (bank.status !== 'ACTIVE') return bad('Archived Bank Duplicate คำถามไม่ได้', 409);
    const source = await env.DB.prepare('SELECT * FROM bank_questions WHERE id=? AND bank_id=?').bind(sourceId, bankId).first();
    if (!source) return bad('ไม่พบคำถาม', 404);
    const type = effectiveType(source), oldConfig = parseJson(source.answer_config, {}), config = duplicateAnswerConfig(type, oldConfig, makeId);
    const questionId = makeId('question'), now = new Date().toISOString();
    const prompt = `${source.prompt}${source.prompt ? ' (สำเนา)' : ''}`, readiness = readyValidation({ type, prompt, answerConfig: config }), status = readiness.valid ? 'READY' : 'DRAFT';
    await env.DB.prepare(`INSERT INTO bank_questions (id,bank_id,type,activity_type,prompt,description,difficulty,status,answer_config,media_json,explanation,internal_notes,source_reference,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(questionId, bankId, source.type, source.activity_type || null, prompt, source.description, Number(source.difficulty), status, JSON.stringify(config), source.media_json || 'null', source.explanation, source.internal_notes, source.source_reference, now, now).run();
    const sourceTags = await env.DB.prepare('SELECT tag_id FROM question_tag_links WHERE question_id=?').bind(sourceId).all();
    const statements = (sourceTags.results || []).map(row => env.DB.prepare('INSERT INTO question_tag_links (question_id,tag_id,assigned_at) VALUES (?,?,?)').bind(questionId, row.tag_id, now));
    if (statements.length) await env.DB.batch(statements);
    const row = await env.DB.prepare('SELECT * FROM bank_questions WHERE id=? AND bank_id=?').bind(questionId, bankId).first();
    return json({ question: questionView(row, await tagsForQuestions(env, [questionId])) }, 201);
  }

  match = path.match(/^\/api\/admin\/question-banks\/([^/]+)\/questions\/bulk$/);
  if (match && request.method === 'POST') {
    const bankId = safeDecode(match[1]), bank = bankId && await requireBank(env, bankId);
    if (!bank) return bad('ไม่พบ Question Bank', 404);
    if (bank.status !== 'ACTIVE') return bad('Archived Bank แก้ไขคำถามไม่ได้', 409);
    const body = await readBody(request, 128 * 1024);
    const questionIds = [...new Set((Array.isArray(body?.questionIds) ? body.questionIds : []).map(String).filter(Boolean))].slice(0, 500);
    if (!questionIds.length) return bad('ไม่ได้เลือกคำถาม');
    const action = String(body.action || ''), now = new Date().toISOString();
    if (action === 'delete') {
      const placeholders = questionIds.map(() => '?').join(',');
      const selected = await env.DB.prepare(`SELECT id,status FROM bank_questions WHERE bank_id=? AND id IN (${placeholders})`).bind(bankId, ...questionIds).all();
      if ((selected.results || []).length !== questionIds.length) return bad('มีคำถามที่ไม่ได้อยู่ในคลังนี้', 409);
      if ((selected.results || []).some(question => question.status !== 'ARCHIVED')) return bad('ลบถาวรได้เฉพาะคำถามที่เก็บถาวรแล้ว', 409, { code: 'QUESTIONS_MUST_BE_ARCHIVED' });
      for (let offset = 0; offset < questionIds.length; offset += 80) {
        const chunk = questionIds.slice(offset, offset + 80), marks = chunk.map(() => '?').join(',');
        await env.DB.batch([
          env.DB.prepare(`DELETE FROM question_tag_links WHERE question_id IN (SELECT id FROM bank_questions WHERE bank_id=? AND status='ARCHIVED' AND id IN (${marks}))`).bind(bankId, ...chunk),
          env.DB.prepare(`DELETE FROM bank_questions WHERE bank_id=? AND status='ARCHIVED' AND id IN (${marks})`).bind(bankId, ...chunk),
        ]);
      }
      return json({ ok: true, deleted: questionIds.length, action });
    }
    for (let offset = 0; offset < questionIds.length; offset += 80) {
      const chunk = questionIds.slice(offset, offset + 80), placeholders = chunk.map(() => '?').join(',');
      if (action === 'archive') await env.DB.prepare(`UPDATE bank_questions SET status='ARCHIVED',updated_at=? WHERE bank_id=? AND id IN (${placeholders})`).bind(now, bankId, ...chunk).run();
      else if (action === 'difficulty') {
        const difficulty = Number(body.difficulty);
        if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) return bad('Difficulty ต้องเป็นจำนวนเต็ม 1–5');
        await env.DB.prepare(`UPDATE bank_questions SET difficulty=?,updated_at=? WHERE bank_id=? AND id IN (${placeholders})`).bind(difficulty, now, bankId, ...chunk).run();
      } else if (action === 'add_tags' || action === 'remove_tags') {
        const tagIds = [...new Set((Array.isArray(body.tagIds) ? body.tagIds : []).map(String).filter(Boolean))].slice(0, 50);
        if (!tagIds.length) return bad('ไม่ได้เลือก Tag');
        const available = await env.DB.prepare(`SELECT id FROM question_tags WHERE bank_id=? AND id IN (${tagIds.map(() => '?').join(',')})`).bind(bankId, ...tagIds).all();
        if ((available.results || []).length !== tagIds.length) return bad('มี Tag ที่ไม่ได้อยู่ใน Bank นี้');
        const statements = [];
        for (const questionId of chunk) for (const tagId of tagIds) statements.push(action === 'add_tags'
          ? env.DB.prepare('INSERT OR IGNORE INTO question_tag_links (question_id,tag_id,assigned_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM bank_questions WHERE id=? AND bank_id=?)').bind(questionId, tagId, now, questionId, bankId)
          : env.DB.prepare('DELETE FROM question_tag_links WHERE question_id=? AND tag_id=? AND EXISTS (SELECT 1 FROM bank_questions WHERE id=? AND bank_id=?)').bind(questionId, tagId, questionId, bankId));
        for (let statementOffset = 0; statementOffset < statements.length; statementOffset += 80) await env.DB.batch(statements.slice(statementOffset, statementOffset + 80));
      } else return bad('Bulk action ไม่ถูกต้อง');
    }
    return json({ ok: true, updated: questionIds.length, action });
  }

  match = path.match(/^\/api\/admin\/question-banks\/([^/]+)\/tags$/);
  if (match) {
    const bankId = safeDecode(match[1]), bank = bankId && await requireBank(env, bankId);
    if (!bank) return bad('ไม่พบ Question Bank', 404);
    if (request.method === 'GET') {
      const result = await env.DB.prepare('SELECT t.id,t.name,t.group_name,t.created_at,t.updated_at,COUNT(l.question_id) AS usage_count FROM question_tags t LEFT JOIN question_tag_links l ON l.tag_id=t.id WHERE t.bank_id=? GROUP BY t.id ORDER BY COALESCE(t.group_name,\'\'),t.name').bind(bankId).all();
      return json({ tags: (result.results || []).map(row => ({ id: row.id, name: row.name, groupName: row.group_name || '', usageCount: Number(row.usage_count || 0), createdAt: row.created_at, updatedAt: row.updated_at })) });
    }
    if (request.method === 'POST') {
      if (bank.status !== 'ACTIVE') return bad('Archived Bank เพิ่ม Tag ไม่ได้', 409);
      const body = await readBody(request, 32 * 1024);
      const name = cleanText(body?.name, 120), groupName = cleanText(body?.groupName, 120);
      if (!name) return bad('กรุณาใส่ชื่อ Tag');
      const tagId = makeId('tag'), now = new Date().toISOString();
      try { await env.DB.prepare('INSERT INTO question_tags (id,bank_id,name,group_name,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(tagId, bankId, name, groupName, now, now).run(); }
      catch (error) { if (/unique|constraint/i.test(String(error?.message || error))) return bad('Tag นี้มีอยู่ในกลุ่มแล้ว', 409); throw error; }
      return json({ tag: { id: tagId, name, groupName, usageCount: 0, createdAt: now, updatedAt: now } }, 201);
    }
    return bad('Method not allowed', 405);
  }

  match = path.match(/^\/api\/admin\/question-banks\/([^/]+)\/tags\/([^/]+)$/);
  if (match) {
    const bankId = safeDecode(match[1]), tagId = safeDecode(match[2]), bank = bankId && await requireBank(env, bankId);
    if (!bank) return bad('ไม่พบ Question Bank', 404);
    const tag = await env.DB.prepare('SELECT id,bank_id,name,group_name,created_at,updated_at FROM question_tags WHERE id=? AND bank_id=?').bind(tagId, bankId).first();
    if (!tag) return bad('ไม่พบ Tag', 404);
    if (request.method === 'PATCH') {
      if (bank.status !== 'ACTIVE') return bad('Archived Bank แก้ไข Tag ไม่ได้', 409);
      const body = await readBody(request, 32 * 1024), name = body?.name == null ? tag.name : cleanText(body.name, 120), groupName = body?.groupName == null ? tag.group_name : cleanText(body.groupName, 120);
      if (!name) return bad('กรุณาใส่ชื่อ Tag');
      const now = new Date().toISOString();
      try { await env.DB.prepare('UPDATE question_tags SET name=?,group_name=?,updated_at=? WHERE id=? AND bank_id=?').bind(name, groupName, now, tagId, bankId).run(); }
      catch (error) { if (/unique|constraint/i.test(String(error?.message || error))) return bad('Tag นี้มีอยู่ในกลุ่มแล้ว', 409); throw error; }
      return json({ tag: { id: tagId, name, groupName, updatedAt: now } });
    }
    if (request.method === 'DELETE') {
      if (bank.status !== 'ACTIVE') return bad('Archived Bank ลบ Tag ไม่ได้ กรุณา Restore Bank ก่อน', 409, { code: 'BANK_ARCHIVED_READ_ONLY' });
      await env.DB.batch([
        env.DB.prepare('DELETE FROM question_tag_links WHERE tag_id=?').bind(tagId),
        env.DB.prepare('DELETE FROM question_tags WHERE id=? AND bank_id=?').bind(tagId, bankId),
      ]);
      return json({ ok: true, tagId, deleted: true });
    }
    return bad('Method not allowed', 405);
  }

  return bad('Question Bank admin route not found', 404);
}
