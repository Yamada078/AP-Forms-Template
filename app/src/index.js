import { handleIntegrationRequest } from './integration.js';
import { handleQuestionBankRequest } from './question-banks.js';
import { handleQuestionBankPackageRequest } from './question-bank-packages.js';
import { handleQuestionPackRequest } from './question-packs.js';
import { handleAssessmentRequest } from './assessments.js';
import { prepareAccountRequest, isStaff, accountContext, checkFormAccess, handleFormAccessSettings } from './organization.js';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
const bad = (message, status = 400, extra = {}) => json({ error: message, ...extra }, status);
const bearer = request => (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
const isAdmin = isStaff;
const id = (prefix = 'id') => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;
const enc = new TextEncoder();
const PUBLICATION_STATES = new Set(['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'ARCHIVED']);

function generatePublicId() {
  return base64url(crypto.getRandomValues(new Uint8Array(12)));
}

function normalizedPublicationState(row) {
  const state = String(row?.publication_state || '').toUpperCase();
  if (PUBLICATION_STATES.has(state)) return state;
  return row?.published ? 'OPEN' : 'DRAFT';
}

function effectivePublicationState(row, nowMs = Date.now()) {
  const stored = normalizedPublicationState(row);
  if (!row?.published_data || Number(row?.published_version || 0) < 1) return stored === 'ARCHIVED' ? 'ARCHIVED' : 'DRAFT';
  if (stored === 'ARCHIVED' || stored === 'CLOSED' || stored === 'DRAFT') return stored;
  const openMs = row.open_at ? Date.parse(row.open_at) : NaN;
  const closeMs = row.close_at ? Date.parse(row.close_at) : NaN;
  if (Number.isFinite(openMs) && nowMs < openMs) return 'SCHEDULED';
  if (Number.isFinite(closeMs) && nowMs >= closeMs) return 'CLOSED';
  return 'OPEN';
}

function publicationView(row, nowMs = Date.now()) {
  return {
    state: effectivePublicationState(row, nowMs),
    storedState: normalizedPublicationState(row),
    publicId: row?.public_id || null,
    publishedVersion: Number(row?.published_version || 0),
    publishedAt: row?.published_at || null,
    openAt: row?.open_at || null,
    closeAt: row?.close_at || null,
    hasPublishedSnapshot: !!row?.published_data && Number(row?.published_version || 0) > 0,
  };
}

function parseSchedule(body = {}) {
  const parse = (value, field) => {
    if (value == null || value === '') return { value: null };
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? { value: new Date(ms).toISOString() } : { error: `${field} ไม่ใช่วันเวลาที่ถูกต้อง` };
  };
  const open = parse(body.openAt, 'เวลาเปิด'), close = parse(body.closeAt, 'เวลาปิด');
  if (open.error || close.error) return { error: open.error || close.error };
  if (open.value && close.value && Date.parse(close.value) <= Date.parse(open.value)) return { error: 'เวลาปิดต้องอยู่หลังเวลาเปิด' };
  return { openAt: open.value, closeAt: close.value };
}

function stateForSchedule(openAt, closeAt, nowMs = Date.now()) {
  if (openAt && nowMs < Date.parse(openAt)) return 'SCHEDULED';
  if (closeAt && nowMs >= Date.parse(closeAt)) return 'CLOSED';
  return 'OPEN';
}

async function ensurePublicId(env, row) {
  if (row?.public_id || !row?.published_data) return row;
  for (let attempt = 0; attempt < 6; attempt++) {
    const publicId = generatePublicId();
    try {
      const revoked = await env.DB.prepare('SELECT public_id FROM revoked_public_links WHERE public_id=?').bind(publicId).first();
      if (revoked) continue;
      const result = await env.DB.prepare('UPDATE forms SET public_id=? WHERE id=? AND public_id IS NULL').bind(publicId, row.id).run();
      if (result.meta?.changes) return { ...row, public_id: publicId };
      const current = await env.DB.prepare('SELECT public_id FROM forms WHERE id=?').bind(row.id).first();
      if (current?.public_id) return { ...row, public_id: current.public_id };
    } catch (error) {
      if (/unique|constraint/i.test(String(error?.message || error)) && attempt < 5) continue;
      throw error;
    }
  }
  throw new Error('Unable to allocate a unique public id');
}

async function readBody(request, maxBytes = 1024 * 1024) {
  try {
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > maxBytes) return null;
    const raw = await request.text();
    if (enc.encode(raw).byteLength > maxBytes) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function freshForm(title = 'แบบสอบถามใหม่', language = 'th') {
  const sectionId = id('sec');
  const startPage = defaultStartPage(title, '');
  if (language === 'en') { startPage.fields[0].label = 'Name'; startPage.fields[0].placeholder = 'Enter your name or nickname'; }
  return {
    version: 5,
    title,
    description: '',
    startPage,
    theme: { accent: '#7c9cff', paperWidth: 900 },
    sections: [{ id: sectionId, title: language === 'en' ? 'Section 1' : 'ส่วนที่ 1', description: '', nextLabel: language === 'en' ? 'Next' : 'ถัดไป', blocks: [], routingRules: [] }],
  };
}

function defaultStartPage(title = 'แบบสอบถาม', description = '') {
  return {
    title: String(title || 'แบบสอบถาม'),
    description: String(description || ''),
    fields: [{ id: 'respondent_name', type: 'short', label: 'ชื่อ', description: '', placeholder: 'พิมพ์ชื่อหรือชื่อเล่น', required: true, primary: true, options: [], validation: { enabled: false, operator: 'forbid_equals', value: '', message: '' } }],
  };
}

function normalizeStartPage(form) {
  const source = form?.startPage && typeof form.startPage === 'object' ? form.startPage : defaultStartPage(form?.title, form?.description);
  const fields = (Array.isArray(source.fields) ? source.fields : []).slice(0, 30).map((field, index) => {
    const type = ['short', 'long', 'dropdown'].includes(field?.type) ? field.type : 'short';
    return {
      id: String(field?.id || `respondent_${index + 1}`).slice(0, 120),
      type,
      label: String(field?.label || `ข้อมูลผู้ตอบ ${index + 1}`).slice(0, 240),
      description: String(field?.description || '').slice(0, 1000),
      placeholder: String(field?.placeholder || '').slice(0, 500),
      required: !!field?.required,
      primary: !!field?.primary,
      options: type === 'dropdown' ? (Array.isArray(field?.options) ? field.options : []).map(String).map(value => value.trim()).filter(Boolean).slice(0, 200) : [],
      validation: { enabled: !!field?.validation?.enabled, operator: field?.validation?.operator === 'forbid_contains' ? 'forbid_contains' : 'forbid_equals', value: String(field?.validation?.value || '').slice(0, 500), message: String(field?.validation?.message || '').slice(0, 500) },
    };
  });
  let primarySeen = false;
  for (const field of fields) {
    if (field.primary && !primarySeen) primarySeen = true;
    else field.primary = false;
  }
  return { title: String(source.title ?? form?.title ?? 'แบบสอบถาม').slice(0, 500), description: String(source.description ?? form?.description ?? '').slice(0, 4000), fields };
}

function validateRespondentMeta(form, inputMeta, legacyName = '') {
  const startPage = normalizeStartPage(form), source = inputMeta && typeof inputMeta === 'object' && !Array.isArray(inputMeta) ? { ...inputMeta } : {};
  const clean = {};
  if (!Object.keys(source).length && legacyName && startPage.fields.length === 1) source[startPage.fields[0].id] = legacyName;
  for (const field of startPage.fields) {
    const raw = source[field.id];
    if (raw != null && typeof raw !== 'string' && typeof raw !== 'number') return { error: `รูปแบบข้อมูลผู้ตอบไม่ถูกต้อง: ${field.label}` };
    const value = String(raw ?? '').trim().slice(0, field.type === 'long' ? 4000 : 500);
    if (field.required && !value) return { error: `กรุณากรอกข้อมูลที่จำเป็น: ${field.label}` };
    if (value && field.type === 'dropdown' && !field.options.includes(value)) return { error: `ตัวเลือกข้อมูลผู้ตอบไม่ถูกต้อง: ${field.label}` };
    const validation = field.validation || {};
    if (value && validation.enabled && validation.value) {
      const fail = validation.operator === 'forbid_contains' ? value.includes(validation.value) : value === validation.value;
      if (fail) return { error: validation.message || `ไม่อนุญาตให้กรอก “${validation.value}” ใน ${field.label}` };
    }
    if (value) clean[field.id] = value;
  }
  const primary = startPage.fields.find(field => field.primary);
  const respondentName = String((primary && clean[primary.id]) || legacyName || Object.values(clean)[0] || 'Anonymous').trim().slice(0, 160) || 'Anonymous';
  return { meta: clean, respondentName };
}

const SNAPSHOT_TRANSIENT_KEYS = new Set(['id', 'published', 'publication', 'updated_at', 'baseUpdatedAt', '_migrated']);

function standardMatrixOptions(maximum = 5) {
  const max = Math.max(2, Math.min(10, Number(maximum || 5)));
  return Array.from({ length: max }, (_, index) => ({ id: `standard_${index + 1}`, displayLabel: String(index + 1), value: index + 1 }));
}

function normalizeMatrixScale(question) {
  const source = question?.matrixScale && typeof question.matrixScale === 'object' ? question.matrixScale : {};
  const requested = String(source.preset || '').toLowerCase();
  const preset = ['standard', 'custom', 'ioc'].includes(requested) ? requested : 'standard';
  if (preset === 'standard') return { preset, options: standardMatrixOptions(question?.ratingMax), iocThreshold: 0.5 };
  const fallback = preset === 'ioc'
    ? [
        { id: 'ioc_minus_1', displayLabel: 'ไม่สอดคล้อง', value: -1 },
        { id: 'ioc_zero', displayLabel: 'ไม่แน่ใจ', value: 0 },
        { id: 'ioc_plus_1', displayLabel: 'สอดคล้อง', value: 1 },
      ]
    : standardMatrixOptions(question?.ratingMax);
  const options = (Array.isArray(source.options) ? source.options : []).map((option, index) => {
    if (option?.value == null || option.value === '' || !Number.isFinite(Number(option.value))) return null;
    return {
      id: String(option.id || `${preset}_${index + 1}`),
      displayLabel: String(option.displayLabel ?? option.label ?? option.value),
      value: Number(option.value),
    };
  }).filter(Boolean);
  const uniqueValues = new Set(options.map(option => option.value));
  const iocValuesAreExact = options.length === 3 && [-1, 0, 1].every(value => uniqueValues.has(value));
  const threshold = source.iocThreshold == null || source.iocThreshold === '' ? 0.5 : Number(source.iocThreshold);
  return {
    preset,
    options: preset === 'ioc'
      ? (iocValuesAreExact ? [-1, 0, 1].map(value => options.find(option => option.value === value)) : fallback)
      : (options.length >= 2 && uniqueValues.size === options.length ? options : fallback),
    iocThreshold: Number.isFinite(threshold) ? threshold : 0.5,
  };
}

function normalizeMatrixQuestions(blocks) {
  for (const block of blocks || []) {
    if (block?.type !== 'question') continue;
    if (block.questionType === 'rating_matrix') block.matrixScale = normalizeMatrixScale(block);
    for (const option of block.options || []) {
      normalizeMatrixQuestions(option.blocks || []);
      const visitChildren = options => {
        for (const child of options || []) {
          normalizeMatrixQuestions(child.blocks || []);
          visitChildren(child.children || []);
        }
      };
      visitChildren(option.children || []);
    }
  }
}

function matrixScaleSchemaError(form) {
  let error = '';
  const visitOptions = options => {
    for (const option of options || []) {
      visitBlocks(option.blocks || []);
      visitOptions(option.children || []);
    }
  };
  const visitBlocks = blocks => {
    for (const block of blocks || []) {
      if (error || block?.type !== 'question') continue;
      if (block.questionType === 'rating_matrix') {
        const source = block.matrixScale && typeof block.matrixScale === 'object' ? block.matrixScale : {};
        const requested = String(source.preset || '').toLowerCase();
        const preset = ['standard', 'custom', 'ioc'].includes(requested) ? requested : 'standard';
        if (preset !== 'standard') {
          const options = Array.isArray(source.options) ? source.options : [];
          const values = options.map(option => option?.value == null || option.value === '' ? NaN : Number(option.value));
          if (options.length < 2 || values.some(value => !Number.isFinite(value)) || new Set(values).size !== values.length) error = `Scale ของ “${block.title || 'คำถาม'}” ต้องมี Numeric Value ไม่ซ้ำกันอย่างน้อย 2 ค่า`;
          else if (preset === 'ioc' && (values.length !== 3 || ![-1, 0, 1].every(value => values.includes(value)))) error = `IOC Scale ของ “${block.title || 'คำถาม'}” ต้องเป็น -1, 0, +1`;
          else if (preset === 'ioc' && (source.iocThreshold == null || source.iocThreshold === '' || !Number.isFinite(Number(source.iocThreshold)))) error = `IOC Threshold ของ “${block.title || 'คำถาม'}” ไม่ถูกต้อง`;
        }
      }
      visitOptions(block.options || []);
    }
  };
  for (const section of form?.sections || []) visitBlocks(section.blocks || []);
  return error;
}

function canonicalValue(value, stripTransient = false) {
  if (Array.isArray(value)) return value.map(item => canonicalValue(item, stripTransient));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (stripTransient && SNAPSHOT_TRANSIENT_KEYS.has(key)) continue;
    if (value[key] === undefined) continue;
    out[key] = canonicalValue(value[key], stripTransient);
  }
  return out;
}

function meaningfulSnapshotJson(snapshot) {
  const raw = typeof snapshot === 'string' ? JSON.parse(snapshot) : structuredClone(snapshot || {}), form = normalizeRuntimeForm(raw) || raw;
  return JSON.stringify(canonicalValue(form || {}, true));
}

function responseOptionProjection(option) {
  return {
    id: option?.id || '', label: option?.label || '', score: Number(option?.score || 0), allowText: !!option?.allowText,
    placeholder: option?.placeholder || '', children: (option?.children || []).map(responseOptionProjection),
    blocks: (option?.blocks || []).map(responseBlockProjection).filter(Boolean),
  };
}

function responseBlockProjection(block) {
  if (block?.type !== 'question') return null;
  return {
    id: block.id || '', type: 'question', questionType: block.questionType || 'short', title: block.title || '', description: block.description || '',
    placeholder: block.placeholder || '', required: !!block.required, validation: block.validation || {}, condition: block.condition || {},
    ratingMax: Number(block.ratingMax || 5), matrixRows: block.matrixRows || [], matrixScale: block.questionType === 'rating_matrix' ? normalizeMatrixScale(block) : undefined,
    radarMax: Number(block.radarMax || 5), radarAxes: block.radarAxes || [],
    options: (block.options || []).map(responseOptionProjection),
  };
}

function responseProjection(snapshot) {
  const raw = typeof snapshot === 'string' ? JSON.parse(snapshot) : structuredClone(snapshot || {}), form = normalizeRuntimeForm(raw);
  if (!form) return {};
  const startPage = normalizeStartPage(form);
  return {
    title: form.title || '', description: form.description || '',
    startPage: { fields: startPage.fields },
    sections: (form.sections || []).map(section => ({
      id: section.id || '', title: section.title || '', description: section.description || '',
      routingRules: section.routingRules || [], blocks: (section.blocks || []).map(responseBlockProjection).filter(Boolean),
    })),
  };
}

function classifySnapshots(previous, next) {
  if (meaningfulSnapshotJson(previous) === meaningfulSnapshotJson(next)) return { classification: 'IDENTICAL', compatible: true, reasons: [] };
  const before = responseProjection(previous), after = responseProjection(next);
  if (JSON.stringify(canonicalValue(before)) === JSON.stringify(canonicalValue(after))) return { classification: 'PRESENTATION_ONLY', compatible: true, reasons: ['เปลี่ยนเฉพาะ theme, layout หรือ Block ที่ไม่เก็บคำตอบ'] };
  const reasons = [];
  if (JSON.stringify(canonicalValue(before.startPage)) !== JSON.stringify(canonicalValue(after.startPage))) reasons.push('Respondent Info เปลี่ยน');
  const pageShape = value => (value.sections || []).map(section => ({ id: section.id, title: section.title, description: section.description, routingRules: section.routingRules }));
  if (JSON.stringify(canonicalValue(pageShape(before))) !== JSON.stringify(canonicalValue(pageShape(after)))) reasons.push('Section หรือ Page Routing เปลี่ยน');
  const questions = value => (value.sections || []).map(section => section.blocks);
  if (JSON.stringify(canonicalValue(questions(before))) !== JSON.stringify(canonicalValue(questions(after)))) reasons.push('คำถาม ตัวเลือก Validation หรือ Conditional Logic เปลี่ยน');
  return { classification: 'RESPONSE_AFFECTING', compatible: false, reasons: reasons.length ? reasons : ['โครงสร้างที่มีผลต่อการตีความคำตอบเปลี่ยน'] };
}

const answerValues = answer => {
  if (answer == null) return [];
  if (Array.isArray(answer)) return answer;
  if (typeof answer === 'object') {
    if (Array.isArray(answer.selected)) return answer.selected;
    if (answer.__type === 'matrix') return Object.values(answer.rows || {});
    if (answer.__type === 'radar') return Object.values(answer.values || {});
    return Object.values(answer);
  }
  return [answer];
};
const answerTextMap = answer => answer && typeof answer === 'object' && !Array.isArray(answer) && answer.text ? answer.text : {};
const answerSelectedIds = answer => answer && typeof answer === 'object' && !Array.isArray(answer) && Array.isArray(answer.selectedIds) ? answer.selectedIds : [];
const parseListValue = value => String(value ?? '').split(',').map(x => x.trim()).filter(Boolean);

function flattenOptions(options, out = []) {
  for (const option of options || []) {
    out.push(option);
    flattenOptions(option.children, out);
  }
  return out;
}

function hasConditionAnswer(answer) {
  if (answer == null) return false;
  if (answer && typeof answer === 'object' && answer.__type === 'matrix') return Object.keys(answer.rows || {}).length > 0;
  return answerValues(answer).some(v => String(v ?? '').trim() !== '') || Object.values(answerTextMap(answer)).some(v => String(v ?? '').trim() !== '');
}

function matrixAverage(answer) {
  if (!answer || typeof answer !== 'object' || !['matrix', 'radar'].includes(answer.__type)) return null;
  const values = Object.values(answer.__type === 'radar' ? answer.values || {} : answer.rows || {}).map(Number).filter(Number.isFinite);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function evaluateAnswer(answer, operator = 'equals', value = '', value2 = '') {
  if (!hasConditionAnswer(answer)) return false;
  const norm = v => String(v ?? '').trim().toLocaleLowerCase();
  const values = [...answerValues(answer), ...Object.values(answerTextMap(answer))].map(norm).filter(Boolean);
  const target = norm(value);
  if (operator === 'equals') return !!target && values.some(v => v === target);
  if (operator === 'not_equals') return !!target && !values.some(v => v === target);
  if (operator === 'contains') return !!target && values.some(v => v.includes(target));
  if (operator === 'one_of' || operator === 'not_one_of') {
    const wanted = parseListValue(value).map(norm).filter(Boolean);
    if (!wanted.length) return false;
    const hit = values.some(v => wanted.includes(v));
    return operator === 'one_of' ? hit : !hit;
  }
  const average = matrixAverage(answer);
  const number = average == null ? Number(answerValues(answer).map(Number).find(Number.isFinite)) : average;
  const a = Number(value), b = Number(value2);
  if (!Number.isFinite(number) || !Number.isFinite(a)) return false;
  if (operator === 'gte') return number >= a;
  if (operator === 'lte') return number <= a;
  if (operator === 'between') return Number.isFinite(b) && number >= Math.min(a, b) && number <= Math.max(a, b);
  return false;
}

const visibleBlock = (block, answers) => !block?.condition?.enabled || (!!block.condition.questionId && evaluateAnswer(answers?.[block.condition.questionId], block.condition.operator, block.condition.value, block.condition.value2));

function selectedOptionBlocks(question, answer) {
  const labels = answerValues(answer), ids = answerSelectedIds(answer), out = [];
  const knownIds = new Set(flattenOptions(question.options || []).map(option => option.id).filter(Boolean));
  const useIds = ids.length > 0 && ids.every(optionId => knownIds.has(optionId));
  const walk = options => {
    for (const option of options || []) {
      if (useIds ? ids.includes(option.id) : labels.includes(option.label)) {
        out.push(...(option.blocks || []));
        walk(option.children);
      }
    }
  };
  walk(question.options || []);
  return out;
}

function validSingleSelection(question, answer) {
  const labels = answerValues(answer), ids = answerSelectedIds(answer);
  const knownIds = new Set(flattenOptions(question.options || []).map(option => option.id).filter(Boolean));
  const useIds = ids.length > 0 && ids.every(optionId => knownIds.has(optionId));
  const selected = option => useIds ? ids.includes(option.id) : labels.includes(option.label);
  const scan = options => {
    const active = (options || []).filter(selected);
    if (active.length > 1) return false;
    return active.every(option => scan(option.children));
  };
  return scan(question.options || []);
}

function normalizeRuntimeForm(raw) {
  if (raw && Array.isArray(raw.sections)) {
    raw.startPage = normalizeStartPage(raw);
    for (const section of raw.sections) normalizeMatrixQuestions(section.blocks || []);
    return raw;
  }
  if (raw && Array.isArray(raw.questions)) {
    const form = {
      version: 5,
      title: raw.title || 'แบบสอบถาม',
      description: raw.description || '',
      sections: [{
        id: 'legacy_section', title: 'คำถามเดิม', description: '', nextLabel: 'ถัดไป', routingRules: [],
        blocks: raw.questions.map(question => ({
          id: question.id || `legacy_${crypto.randomUUID()}`,
          type: 'question', width: 100, condition: { enabled: false, questionId: '', operator: 'equals', value: '', value2: '' },
          questionType: question.type === 'single' ? 'single' : question.type === 'rating' ? 'rating' : question.type === 'longtext' ? 'long' : 'short',
          title: question.title || 'คำถาม', description: '', required: !!question.required, placeholder: '', validation: { enabled: false, operator: 'forbid_equals', value: '', message: '' },
          ratingMax: question.ratingMax || 5, options: Array.isArray(question.options) ? question.options : [], matrixRows: [],
        })),
      }],
    };
    form.startPage = defaultStartPage(form.title, form.description);
    return form;
  }
  return null;
}

function collectVisibleBlocks(blocks, answers, out = []) {
  for (const block of blocks || []) {
    if (!visibleBlock(block, answers)) continue;
    out.push(block);
    if (block.type === 'question') {
      for (const child of selectedOptionBlocks(block, answers?.[block.id])) collectVisibleBlocks([child], answers, out);
    }
  }
  return out;
}

function responsePath(form, answers) {
  const sections = Array.isArray(form?.sections) ? form.sections : [];
  const path = [], visits = new Map(), trustedAnswers = {};
  let sectionId = sections[0]?.id || 'END';
  while (sectionId !== 'END' && path.length < 100) {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return { error: `Page Routing อ้างถึง Section ที่ไม่มีอยู่: ${sectionId}` };
    const count = (visits.get(sectionId) || 0) + 1;
    visits.set(sectionId, count);
    if (count > 15) return { error: 'Page Routing เกิด loop มากเกินไป' };
    path.push(sectionId);
    while (true) {
      let changed = false;
      for (const block of collectVisibleBlocks(section.blocks || [], trustedAnswers, [])) {
        if (block.type !== 'question' || !Object.prototype.hasOwnProperty.call(answers, block.id) || Object.prototype.hasOwnProperty.call(trustedAnswers, block.id)) continue;
        trustedAnswers[block.id] = answers[block.id];
        changed = true;
      }
      if (!changed) break;
    }
    const rule = (section.routingRules || []).find(r => r.questionId && r.targetSectionId && Object.prototype.hasOwnProperty.call(trustedAnswers, r.questionId) && evaluateAnswer(trustedAnswers[r.questionId], r.operator, r.value, r.value2));
    const index = sections.findIndex(s => s.id === sectionId);
    sectionId = rule?.targetSectionId || sections[index + 1]?.id || 'END';
  }
  if (path.length >= 100) return { error: 'Page Routing ยาวเกินขีดจำกัด' };
  return { path, trustedAnswers };
}

function validatePublicResponse(form, inputAnswers) {
  const submittedAnswers = inputAnswers && typeof inputAnswers === 'object' && !Array.isArray(inputAnswers) ? inputAnswers : {};
  const route = responsePath(form, submittedAnswers);
  if (route.error) return route;
  const answers = route.trustedAnswers;
  const sectionIds = new Set(route.path);
  const visibleQuestions = [];
  for (const section of form.sections || []) {
    if (!sectionIds.has(section.id)) continue;
    for (const block of collectVisibleBlocks(section.blocks || [], answers, [])) if (block.type === 'question') visibleQuestions.push(block);
  }
  const cleanAnswers = {}, scoreOptions = [];
  for (const question of visibleQuestions) {
    const answer = answers[question.id];
    const values = answerValues(answer);
    const nonBlank = values.some(v => String(v ?? '').trim() !== '');
    if (question.required) {
      const missingMatrix = question.questionType === 'rating_matrix' && (question.matrixRows || []).some(row => {
        const rows = answer?.rows;
        return !rows || !Object.prototype.hasOwnProperty.call(rows, row.id) || rows[row.id] == null || rows[row.id] === '';
      });
      if (!nonBlank || missingMatrix) return { error: `กรุณาตอบคำถามที่จำเป็น: ${question.title || 'คำถาม'}` };
    }
    if (['short', 'long'].includes(question.questionType)) {
      if (answer != null && typeof answer !== 'string') return { error: `รูปแบบคำตอบไม่ถูกต้อง: ${question.title || 'คำถาม'}` };
      const text = String(answer ?? '').trim();
      const validation = question.validation || {};
      const forbidden = String(validation.value ?? '');
      if (validation.enabled && forbidden) {
        const fail = validation.operator === 'forbid_contains' ? text.includes(forbidden) : text === forbidden;
        if (fail) return { error: validation.message || `ไม่อนุญาตให้ตอบ “${forbidden}”` };
      }
      if (text) cleanAnswers[question.id] = text;
      continue;
    }
    if (['single', 'multi', 'dropdown'].includes(question.questionType)) {
      const options = flattenOptions(question.options || []);
      const allowedLabels = new Set(options.map(option => option.label));
      const allowedIds = new Set(options.map(option => option.id));
      const ids = answerSelectedIds(answer);
      const idsSupported = options.length > 0 && options.every(option => option.id);
      if (values.some(value => !allowedLabels.has(value)) || (idsSupported && ids.some(value => !allowedIds.has(value)))) return { error: `คำตอบมีตัวเลือกที่ไม่ถูกต้อง: ${question.title || 'คำถาม'}` };
      if (question.questionType === 'single' && !validSingleSelection(question, answer)) return { error: `เลือกคำตอบได้เพียงหนึ่งข้อในแต่ละระดับ: ${question.title || 'คำถาม'}` };
      if (nonBlank) {
        if (question.questionType === 'dropdown') {
          if (values.length > 1) return { error: `เลือกคำตอบได้เพียงหนึ่งข้อ: ${question.title || 'คำถาม'}` };
          cleanAnswers[question.id] = String(values[0]);
        } else {
          const text = {}, sourceText = answerTextMap(answer);
          for (const option of options) {
            if (!option.allowText || !sourceText[option.id]) continue;
            text[option.id] = String(sourceText[option.id]).trim().slice(0, 4000);
          }
          cleanAnswers[question.id] = { selected: values.map(String), selectedIds: idsSupported ? ids.map(String) : [], text };
        }
        scoreOptions.push({ question, answer });
      }
      continue;
    }
    if (question.questionType === 'rating') {
      const value = Number(answer);
      if (answer != null && answer !== '' && (!Number.isInteger(value) || value < 1 || value > Number(question.ratingMax || 5))) return { error: `คะแนนไม่ถูกต้อง: ${question.title || 'คำถาม'}` };
      if (Number.isFinite(value)) cleanAnswers[question.id] = value;
      continue;
    }
    if (question.questionType === 'rating_matrix') {
      const rows = {}, allowed = new Set(normalizeMatrixScale(question).options.map(option => option.value));
      for (const row of question.matrixRows || []) {
        const raw = answer?.rows?.[row.id];
        if (raw == null || raw === '') continue;
        if (!['number', 'string'].includes(typeof raw)) return { error: `คะแนนตารางไม่ถูกต้อง: ${question.title || 'คำถาม'}` };
        const value = Number(raw);
        if (!Number.isFinite(value) || !allowed.has(value)) return { error: `คะแนนตารางไม่ถูกต้อง: ${question.title || 'คำถาม'}` };
        rows[row.id] = value;
      }
      if (Object.keys(rows).length) cleanAnswers[question.id] = { __type: 'matrix', rows };
      continue;
    }
    if (question.questionType === 'radar') {
      const axes = Array.isArray(question.radarAxes) ? question.radarAxes.slice(0, 10) : [];
      if (axes.length < 3) return { error: `กราฟทักษะต้องมีอย่างน้อย 3 แกน: ${question.title || 'คำถาม'}` };
      const max = Math.max(2, Math.min(10, Number(question.radarMax || 5))), values = {};
      for (const axis of axes) {
        const raw = answer?.values?.[axis.id];
        if (raw == null) continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0 || value > max) return { error: `ค่ากราฟไม่ถูกต้อง: ${question.title || 'คำถาม'}` };
        values[axis.id] = Math.round(value * 10) / 10;
      }
      if (question.required && axes.some(axis => !Object.prototype.hasOwnProperty.call(values, axis.id))) return { error: `กรุณาประเมินกราฟให้ครบทุกแกน: ${question.title || 'คำถาม'}` };
      if (Object.keys(values).length) cleanAnswers[question.id] = { __type: 'radar', values };
    }
  }
  let score = 0;
  for (const { question, answer } of scoreOptions) {
    const options = flattenOptions(question.options || []), ids = answerSelectedIds(answer);
    const useIds = ids.length > 0 && ids.every(optionId => options.some(option => option.id === optionId));
    if (useIds) for (const optionId of ids) score += Number(options.find(option => option.id === optionId)?.score || 0);
    else for (const label of answerValues(answer)) score += Number(options.find(option => option.label === label)?.score || 0);
  }
  return { answers: cleanAnswers, path: route.path, score };
}

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function decodeBase64url(s) {
  s = s.replaceAll('-', '+').replaceAll('_', '/');
  while (s.length % 4) s += '=';
  const raw = atob(s);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function makeTicket(env, payload) {
  const body = base64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.TEAM_KEY), enc.encode(body));
  return `${body}.${base64url(new Uint8Array(sig))}`;
}
async function verifyTicket(env, ticket) {
  try {
    const [body, sig] = String(ticket || '').split('.');
    if (!body || !sig) return null;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env.TEAM_KEY), decodeBase64url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64url(body)));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

export class FormRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // Live drafts are broadcast immediately, but recovery snapshots are persisted sparingly.
    this.pendingDraft = null;
    this.lastDraftPersistAt = 0;
  }

  async persistPendingDraft(force = false) {
    if (!this.pendingDraft) return;
    const now = Date.now();
    if (!force && now - this.lastDraftPersistAt < 15000) return;
    await this.ctx.storage.put('latestDraft', this.pendingDraft);
    this.lastDraftPersistAt = now;
  }

  peers(exclude = null) {
    return this.ctx.getWebSockets()
      .filter(ws => ws !== exclude)
      .map(ws => ws.deserializeAttachment?.())
      .filter(Boolean)
      .map(a => ({ sessionId: a.sessionId, name: a.name, role: a.role, joinedAt: a.joinedAt }));
  }

  editor(exclude = null) {
    return this.peers(exclude).find(p => p.role === 'editor') || null;
  }

  send(ws, data) {
    try { ws.send(JSON.stringify(data)); } catch {}
  }

  broadcast(data, exclude = null) {
    const raw = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      try { ws.send(raw); } catch {}
    }
  }

  broadcastPresence(exclude = null) {
    const peers = this.peers(exclude);
    const editor = peers.find(p => p.role === 'editor') || null;
    this.broadcast({ type: 'presence', peers, editor }, exclude);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/status')) {
      return json({ editor: this.editor(), peers: this.peers() });
    }
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return bad('Expected WebSocket', 426);

    const sessionId = request.headers.get('x-goi-session-id') || id('session');
    const name = (request.headers.get('x-goi-member-name') || 'สมาชิกทีม').slice(0, 60);
    const formId = request.headers.get('x-goi-form-id') || '';
    const currentEditor = this.editor();
    const role = currentEditor ? 'viewer' : 'editor';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ sessionId, name, formId, role, joinedAt: Date.now(), userId: request.headers.get('x-apforms-user-id') || '', tokenHash: request.headers.get('x-apforms-token-hash') || '', ticketExp: Number(request.headers.get('x-apforms-ticket-exp') || 0) });

    const storedDraft = await this.ctx.storage.get('latestDraft');
    const latestDraft = this.pendingDraft && (!storedDraft || this.pendingDraft.draftAt >= (storedDraft.draftAt || 0)) ? this.pendingDraft : storedDraft;
    this.send(server, {
      type: 'welcome',
      role,
      editor: role === 'editor' ? { sessionId, name, role: 'editor' } : currentEditor,
      peers: this.peers(),
      latestDraft: latestDraft || null,
    });
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let m;
    try { m = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); }
    catch { return this.send(ws, { type: 'error', error: 'ข้อความ Live ไม่ถูกต้อง' }); }
    const a = ws.deserializeAttachment?.();
    if (!a) return;
    if (a.userId) {
      const active = a.ticketExp > Date.now() && await this.env.DB.prepare("SELECT 1 FROM organization_users u JOIN organization_sessions s ON s.user_id=u.id WHERE u.id=? AND u.status='ACTIVE' AND u.role IN ('ADMIN','EDITOR') AND s.token_hash=? AND s.expires_at>?").bind(a.userId, a.tokenHash, new Date().toISOString()).first();
      if (!active) { ws.close(1008, 'account session expired'); return; }
    } else {
      let configured;
      try { configured = await this.env.DB.prepare('SELECT id FROM organization WHERE id=1').first(); }
      catch (error) { if (!/no such table.*organization/i.test(String(error))) throw error; }
      if (configured) { ws.close(1008, 'account login required'); return; }
    }

    if (m.type === 'ping') return this.send(ws, { type: 'pong', ts: Date.now() });

    if (m.type === 'request_lock') {
      const editor = this.editor(ws);
      if (!editor) {
        a.role = 'editor';
        ws.serializeAttachment(a);
        this.send(ws, { type: 'lock_granted' });
        this.broadcastPresence();
      } else {
        this.send(ws, { type: 'lock_denied', editor });
      }
      return;
    }

    if (m.type === 'release_lock') {
      if (a.role === 'editor') {
        await this.persistPendingDraft(true);
        a.role = 'viewer';
        ws.serializeAttachment(a);
        this.broadcast({ type: 'lock_available' }, ws);
        this.broadcastPresence();
      }
      return;
    }

    if (m.type === 'draft') {
      if (a.role !== 'editor') return this.send(ws, { type: 'error', error: 'คุณไม่ได้ถือสิทธิ์แก้ไขฟอร์มนี้' });
      if (!m.form || !Array.isArray(m.form.sections)) return this.send(ws, { type: 'error', error: 'ข้อมูล Draft ไม่ถูกต้อง' });
      const draft = { form: m.form, updated_at: String(m.updated_at || ''), draftAt: Date.now(), committed: false, editor: { sessionId: a.sessionId, name: a.name } };
      this.pendingDraft = draft;
      // Viewers still see edits live. Storage is intentionally throttled to protect Free-tier write quotas.
      this.broadcast({ type: 'draft', ...draft }, ws);
      await this.persistPendingDraft(false);
      return;
    }

    if (m.type === 'commit') {
      const fail = error => this.send(ws, { type: 'error', reqId: m.reqId, error });
      if (a.role !== 'editor') return fail('คุณไม่ได้ถือสิทธิ์แก้ไขฟอร์มนี้');
      if (!m.form || !Array.isArray(m.form.sections)) return fail('ข้อมูลฟอร์มไม่ถูกต้อง');
      if (!this.env.DB) return fail('D1 DB ไม่พร้อมใช้งาน');
      try {
        const now = new Date().toISOString();
        const stored = structuredClone(m.form);
        delete stored.id;
        delete stored.published;
        delete stored.updated_at;
        const baseUpdatedAt = String(m.baseUpdatedAt || '');
        const result = baseUpdatedAt
          ? await this.env.DB.prepare('UPDATE forms SET title=?,data=?,updated_at=? WHERE id=? AND updated_at=?')
            .bind(stored.title || 'Untitled', JSON.stringify(stored), now, a.formId, baseUpdatedAt).run()
          : await this.env.DB.prepare('UPDATE forms SET title=?,data=?,updated_at=? WHERE id=?')
            .bind(stored.title || 'Untitled', JSON.stringify(stored), now, a.formId).run();
        if (!result.meta?.changes) {
          const exists = await this.env.DB.prepare('SELECT updated_at FROM forms WHERE id=?').bind(a.formId).first();
          return fail(exists ? 'ฟอร์มถูกบันทึกจากช่องทางอื่นแล้ว กรุณา Reload ก่อนบันทึกทับ' : 'ไม่พบฟอร์มที่จะบันทึก');
        }
        const committed = { form: stored, updated_at: now, draftAt: Date.now(), committed: true, editor: { sessionId: a.sessionId, name: a.name } };
        await this.ctx.storage.put('latestDraft', committed);
        this.pendingDraft = null;
        this.lastDraftPersistAt = Date.now();
        this.send(ws, { type: 'commit_ack', reqId: m.reqId, updated_at: now });
        this.broadcast({ type: 'committed', ...committed }, ws);
      } catch {
        fail('บันทึกผ่าน Live Collaboration ไม่สำเร็จ');
      }
      return;
    }
  }

  async webSocketClose(ws) {
    const a = ws.deserializeAttachment?.();
    if (a?.role === 'editor') {
      await this.persistPendingDraft(true).catch(() => {});
      this.broadcast({ type: 'lock_available' }, ws);
    }
    this.broadcastPresence(ws);
  }

  async webSocketError(ws) {
    const a = ws.deserializeAttachment?.();
    if (a?.role === 'editor') {
      await this.persistPendingDraft(true).catch(() => {});
      this.broadcast({ type: 'lock_available' }, ws);
    }
    this.broadcastPresence(ws);
  }
}

export { effectivePublicationState, generatePublicId, parseSchedule, publicationView, stateForSchedule, validatePublicResponse };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    if (p.startsWith('/api/')) {
      const accountResponse = await prepareAccountRequest(request, env);
      if (accountResponse) return accountResponse;
    }

    if (p === '/api/health') {
      return json({ ok: true, db: !!env.DB, teamKeyConfigured: !!env.TEAM_KEY, realtimeCollab: !!env.COLLAB, appVersion: '6.0.0-organization-preview' });
    }

    if (/^\/f\/[^/]+$/.test(p) && request.method === 'GET') {
      const assetUrl = new URL('/', url);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    if (p === '/api/login' && request.method === 'POST') {
      return isAdmin(request, env) ? json({ ok: true }) : bad('TEAM KEY ไม่ถูกต้อง', 401);
    }

    if (p === '/api/collab-ticket' && request.method === 'POST') {
      if (!isAdmin(request, env)) return bad('Unauthorized', 401);
      if (!env.COLLAB) return bad('ยังไม่ได้เปิด Durable Object binding ชื่อ COLLAB', 503);
      const body = await readBody(request) || {};
      const formId = String(body.formId || '');
      const sessionId = String(body.sessionId || '');
      const name = String(body.name || '').trim().slice(0, 60);
      if (!formId || !sessionId || !name) return bad('ข้อมูล Live Collaboration ไม่ครบ');
      const account = accountContext(request);
      const ticket = await makeTicket(env, { formId, sessionId, name: account?.user?.name || name, userId: account?.user?.id || null, tokenHash: account?.tokenHash || null, exp: Date.now() + 10 * 60 * 1000 });
      return json({ ticket });
    }

    let collab = p.match(/^\/api\/collab\/([^/]+)$/);
    if (collab) {
      if (!env.COLLAB) return bad('COLLAB binding unavailable', 503);
      const formId = decodeURIComponent(collab[1]);
      const ticket = await verifyTicket(env, url.searchParams.get('ticket'));
      if (!ticket || ticket.formId !== formId) return bad('Live Collaboration ticket ไม่ถูกต้องหรือหมดอายุ', 401);
      if (accountContext(request)?.organization) {
        const active = ticket.userId && ticket.tokenHash && await env.DB.prepare("SELECT 1 FROM organization_users u JOIN organization_sessions s ON s.user_id=u.id WHERE u.id=? AND u.status='ACTIVE' AND u.role IN ('ADMIN','EDITOR') AND s.token_hash=? AND s.expires_at>?").bind(ticket.userId, ticket.tokenHash, new Date().toISOString()).first();
        if (!active) return bad('บัญชีหรือเซสชันนี้ไม่มีสิทธิ์แก้ไขฟอร์มแล้ว', 403);
      }
      const headers = new Headers(request.headers);
      headers.set('x-goi-session-id', ticket.sessionId);
      headers.set('x-goi-member-name', ticket.name);
      headers.set('x-goi-form-id', formId);
      headers.set('x-apforms-user-id', ticket.userId || '');
      headers.set('x-apforms-token-hash', ticket.tokenHash || '');
      headers.set('x-apforms-ticket-exp', String(ticket.exp));
      const stub = env.COLLAB.getByName(formId);
      return stub.fetch(new Request(request, { headers }));
    }

    if (p.startsWith('/api/') && !env.DB) return bad('ยังไม่ได้ผูก D1 binding ชื่อ DB', 503);

    const questionBankPackageResponse = await handleQuestionBankPackageRequest(request, env, { json, bad, readBody, id, isAdmin });
    if (questionBankPackageResponse) return questionBankPackageResponse;

    const questionBankResponse = await handleQuestionBankRequest(request, env, { json, bad, readBody, id, isAdmin });
    if (questionBankResponse) return questionBankResponse;

    const questionPackResponse = await handleQuestionPackRequest(request, env, { json, bad, readBody, id, isAdmin });
    if (questionPackResponse) return questionPackResponse;

    const assessmentResponse = await handleAssessmentRequest(request, env, { json, bad, readBody, id, isAdmin });
    if (assessmentResponse) return assessmentResponse;

    const integrationResponse = await handleIntegrationRequest(request, env, {
      json, bad, readBody, id, base64url, isAdmin,
      normalizeRuntimeForm, validateRespondentMeta, validatePublicResponse, publicationView,
    });
    if (integrationResponse) return integrationResponse;

    if (p === '/api/forms') {
      if (!isAdmin(request, env)) return bad('Unauthorized', 401);
      if (request.method === 'GET') {
        const q = await env.DB.prepare('SELECT id,title,published,public_id,publication_state,published_data,published_version,published_at,open_at,close_at,created_at,updated_at FROM forms ORDER BY updated_at DESC').all();
        const forms = (q.results || []).map(row => ({
          id: row.id, title: row.title, published: !!row.published, created_at: row.created_at, updated_at: row.updated_at,
          publication: publicationView(row),
        }));
        return json({ forms });
      }
      if (request.method === 'POST') {
        const body = await readBody(request) || {};
        const formId = id('form');
        const language = body.language === 'en' ? 'en' : 'th';
        const form = freshForm(body.title || (language === 'en' ? 'New questionnaire' : 'แบบสอบถามใหม่'), language);
        const now = new Date().toISOString();
        const organization = accountContext(request)?.organization;
        await env.DB.prepare(`INSERT INTO forms (id,title,data,published,created_at,updated_at${organization ? ',access_mode' : ''}) VALUES (?,?,?,?,?,?${organization ? ",'MEMBERS'" : ''})`)
          .bind(formId, form.title, JSON.stringify(form), 0, now, now).run();
        return json({ id: formId }, 201);
      }
      return bad('Method not allowed', 405);
    }

    let m = p.match(/^\/api\/forms\/([^/]+)\/access$/);
    if (m) return handleFormAccessSettings(request, env, decodeURIComponent(m[1]));
    m = p.match(/^\/api\/forms\/([^/]+)$/);
    if (m) {
      if (!isAdmin(request, env)) return bad('Unauthorized', 401);
      const formId = decodeURIComponent(m[1]);
      if (request.method === 'GET') {
        let row = await env.DB.prepare('SELECT id,title,data,published,public_id,publication_state,published_data,published_version,published_at,open_at,close_at,updated_at FROM forms WHERE id=?').bind(formId).first();
        if (!row) return bad('ไม่พบฟอร์ม', 404);
        row = await ensurePublicId(env, row);
        return json({ form: JSON.parse(row.data), published: !!row.published, updated_at: row.updated_at, publication: publicationView(row) });
      }
      if (request.method === 'PUT') {
        if (env.COLLAB) {
          let status;
          try {
            const response = await env.COLLAB.getByName(formId).fetch('https://room/status');
            if (!response.ok) throw new Error('COLLAB status unavailable');
            status = await response.json();
          } catch {
            return bad('ตรวจสอบสิทธิ์ Live Collaboration ไม่สำเร็จ กรุณาลองใหม่เพื่อป้องกันข้อมูลทับกัน', 503);
          }
          const sid = request.headers.get('x-goi-session-id') || '';
          if (status.editor && status.editor.sessionId !== sid) return bad(`${status.editor.name || 'สมาชิกคนอื่น'} กำลังแก้ไขฟอร์มนี้ กรุณารอ`, 423, { locked: true, editor: status.editor });
        }
        const body = await readBody(request);
        if (!body || (!Array.isArray(body.sections) && !Array.isArray(body.questions))) return bad('ข้อมูลฟอร์มไม่ถูกต้อง');
        const now = new Date().toISOString();
        const baseUpdatedAt = String(body.baseUpdatedAt || '');
        const stored = { ...body };
        delete stored.baseUpdatedAt;
        let result;
        if (baseUpdatedAt) {
          result = await env.DB.prepare('UPDATE forms SET title=?,data=?,updated_at=? WHERE id=? AND updated_at=?')
            .bind(stored.title || 'Untitled', JSON.stringify(stored), now, formId, baseUpdatedAt).run();
          if (!result.meta?.changes) {
            const exists = await env.DB.prepare('SELECT updated_at FROM forms WHERE id=?').bind(formId).first();
            if (!exists) return bad('ไม่พบฟอร์ม', 404);
            return bad('ฟอร์มนี้ถูกแก้ไขจากหน้าต่างหรือสมาชิกคนอื่นแล้ว กรุณา Reload ก่อนบันทึกทับ', 409, { conflict: true, updated_at: exists.updated_at });
          }
        } else {
          result = await env.DB.prepare('UPDATE forms SET title=?,data=?,updated_at=? WHERE id=?')
            .bind(stored.title || 'Untitled', JSON.stringify(stored), now, formId).run();
          if (!result.meta?.changes) return bad('ไม่พบฟอร์ม', 404);
        }
        return json({ ok: true, updated_at: now });
      }
      if (request.method === 'DELETE') {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM responses WHERE form_id=?').bind(formId),
          env.DB.prepare('DELETE FROM forms WHERE id=?').bind(formId),
        ]);
        return json({ ok: true });
      }
      return bad('Method not allowed', 405);
    }

    m = p.match(/^\/api\/forms\/([^/]+)\/publish$/);
    if (m && request.method === 'POST') {
      if (!isAdmin(request, env)) return bad('Unauthorized', 401);
      const formId = decodeURIComponent(m[1]), body = await readBody(request) || {};
      const schedule = parseSchedule(body);
      if (schedule.error) return bad(schedule.error);
      const row = await env.DB.prepare('SELECT id,data,published,public_id,publication_state,published_data,published_version,published_at,open_at,close_at,updated_at FROM forms WHERE id=?').bind(formId).first();
      if (!row) return bad('ไม่พบฟอร์ม', 404);
      let draft;
      try { draft = JSON.parse(row.data); } catch { return bad('ข้อมูลฟอร์มไม่สมบูรณ์'); }
      const matrixError = matrixScaleSchemaError(draft);
      if (matrixError) return bad(matrixError);
      let publicId = row.public_id || null;
      const now = new Date().toISOString();
      const keepClosed = normalizedPublicationState(row) === 'CLOSED';
      const keepArchived = normalizedPublicationState(row) === 'ARCHIVED';
      const publicationState = keepArchived ? 'ARCHIVED' : keepClosed ? 'CLOSED' : stateForSchedule(schedule.openAt, schedule.closeAt);
      if (row.published_data && meaningfulSnapshotJson(row.data) === meaningfulSnapshotJson(row.published_data)) {
        const changedSchedule = (row.open_at || null) !== schedule.openAt || (row.close_at || null) !== schedule.closeAt || normalizedPublicationState(row) !== publicationState;
        if (changedSchedule) {
          await env.DB.prepare('UPDATE forms SET publication_state=?,open_at=?,close_at=?,updated_at=? WHERE id=?').bind(publicationState, schedule.openAt, schedule.closeAt, now, formId).run();
        }
        const updated = { ...row, publication_state: publicationState, open_at: schedule.openAt, close_at: schedule.closeAt, updated_at: changedSchedule ? now : row.updated_at };
        return json({ ok: true, unchanged: true, updated_at: updated.updated_at, publication: publicationView(updated), compatibility: { classification: 'IDENTICAL', compatible: true, reasons: [] } });
      }
      const nextVersion = Number(row.published_version || 0) + 1;
      const compatibility = row.published_data ? classifySnapshots(row.published_data, row.data) : null;
      for (let attempt = 0; attempt < 6; attempt++) {
        if (!publicId) publicId = generatePublicId();
        try {
          if (!row.public_id) {
            const revoked = await env.DB.prepare('SELECT public_id FROM revoked_public_links WHERE public_id=?').bind(publicId).first();
            if (revoked) { publicId = null; continue; }
          }
          const results = await env.DB.batch([
            env.DB.prepare('UPDATE forms SET published=1,public_id=?,publication_state=?,published_data=?,published_version=?,published_at=?,open_at=?,close_at=?,updated_at=? WHERE id=? AND published_version=?')
              .bind(publicId, publicationState, row.data, nextVersion, now, schedule.openAt, schedule.closeAt, now, formId, Number(row.published_version || 0)),
            env.DB.prepare('INSERT INTO form_versions (form_id,version,data,published_at) VALUES (?,?,?,?)')
              .bind(formId, nextVersion, row.data, now),
          ]);
          if (!results[0]?.meta?.changes) return bad('มีการ Publish ฟอร์มนี้จากหน้าต่างอื่นแล้ว กรุณา Reload', 409);
          const updated = { ...row, published: 1, public_id: publicId, publication_state: publicationState, published_data: row.data, published_version: nextVersion, published_at: now, open_at: schedule.openAt, close_at: schedule.closeAt, updated_at: now };
          return json({ ok: true, unchanged: false, updated_at: now, publication: publicationView(updated), compatibility });
        } catch (error) {
          if (!row.public_id && /unique|constraint/i.test(String(error?.message || error)) && attempt < 5) {
            publicId = null;
            continue;
          }
          if (/unique|constraint/i.test(String(error?.message || error))) return bad('มีการ Publish ฟอร์มนี้พร้อมกัน กรุณา Reload', 409);
          throw error;
        }
      }
      return bad('ไม่สามารถสร้าง Public Link ที่ไม่ซ้ำได้ กรุณาลองใหม่', 503);
    }

    m = p.match(/^\/api\/forms\/([^/]+)\/publication$/);
    if (m && request.method === 'POST') {
      if (!isAdmin(request, env)) return bad('Unauthorized', 401);
      const formId = decodeURIComponent(m[1]), body = await readBody(request) || {}, action = String(body.action || '');
      const row = await env.DB.prepare('SELECT id,published,public_id,publication_state,published_data,published_version,published_at,open_at,close_at,updated_at FROM forms WHERE id=?').bind(formId).first();
      if (!row) return bad('ไม่พบฟอร์ม', 404);
      const hasSnapshot = !!row.published_data && Number(row.published_version || 0) > 0;
      if (!hasSnapshot && !['archive', 'restore'].includes(action)) return bad('ฟอร์มนี้ยังไม่เคย Publish');
      let state = normalizedPublicationState(row), openAt = row.open_at || null, closeAt = row.close_at || null;
      if (action === 'close') state = 'CLOSED';
      else if (action === 'reopen') { state = 'OPEN'; openAt = null; closeAt = null; }
      else if (action === 'schedule') {
        const schedule = parseSchedule(body);
        if (schedule.error) return bad(schedule.error);
        openAt = schedule.openAt; closeAt = schedule.closeAt;
        state = stateForSchedule(openAt, closeAt);
      } else if (action === 'archive') state = 'ARCHIVED';
      else if (action === 'restore') state = hasSnapshot ? 'CLOSED' : 'DRAFT';
      else return bad('Publication action ไม่ถูกต้อง');
      const now = new Date().toISOString();
      const result = await env.DB.prepare('UPDATE forms SET publication_state=?,open_at=?,close_at=?,updated_at=? WHERE id=?')
        .bind(state, openAt, closeAt, now, formId).run();
      if (!result.meta?.changes) return bad('ไม่พบฟอร์ม', 404);
      return json({ ok: true, updated_at: now, publication: publicationView({ ...row, publication_state: state, open_at: openAt, close_at: closeAt, updated_at: now }) });
    }

    m = p.match(/^\/api\/forms\/([^/]+)\/regenerate-public-link$/);
    if (m && request.method === 'POST') {
      if (!isAdmin(request, env)) return bad('Unauthorized', 401);
      const formId = decodeURIComponent(m[1]);
      const row = await env.DB.prepare('SELECT id,published,public_id,publication_state,published_data,published_version,published_at,open_at,close_at,updated_at FROM forms WHERE id=?').bind(formId).first();
      if (!row) return bad('ไม่พบฟอร์ม', 404);
      if (!row.public_id || !row.published_data) return bad('ฟอร์มนี้ยังไม่มี Public Link');
      const oldPublicId = row.public_id, now = new Date().toISOString();
      for (let attempt = 0; attempt < 6; attempt++) {
        const nextPublicId = generatePublicId();
        if (nextPublicId === oldPublicId) continue;
        try {
          const alreadyRevoked = await env.DB.prepare('SELECT public_id FROM revoked_public_links WHERE public_id=?').bind(nextPublicId).first();
          if (alreadyRevoked) continue;
          const results = await env.DB.batch([
            env.DB.prepare('INSERT OR IGNORE INTO revoked_public_links (public_id,form_id,revoked_at) VALUES (?,?,?)').bind(oldPublicId, formId, now),
            env.DB.prepare('UPDATE forms SET public_id=?,updated_at=? WHERE id=? AND public_id=?').bind(nextPublicId, now, formId, oldPublicId),
          ]);
          if (!results[1]?.meta?.changes) return bad('Public Link ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว กรุณา Reload', 409);
          return json({ ok: true, revokedPublicId: oldPublicId, updated_at: now, publication: publicationView({ ...row, public_id: nextPublicId, updated_at: now }) });
        } catch (error) {
          if (/unique|constraint/i.test(String(error?.message || error)) && attempt < 5) continue;
          throw error;
        }
      }
      return bad('ไม่สามารถสร้าง Public Link ที่ไม่ซ้ำได้ กรุณาลองใหม่', 503);
    }

    m = p.match(/^\/api\/forms\/([^/]+)\/responses\/bulk-delete$/);
    if (m && request.method === 'POST') {
      if (!isAdmin(request, env)) return bad('Unauthorized', 401);
      const formId = decodeURIComponent(m[1]);
      const body = await readBody(request) || {};
      const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(String).filter(Boolean))].slice(0, 2000);
      if (!ids.length) return bad('ไม่ได้เลือกคำตอบที่จะลบ');
      let deleted = 0;
      // Stay well under SQLite/D1 bound-parameter limits by deleting in chunks.
      for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80);
        const placeholders = chunk.map(() => '?').join(',');
        const result = await env.DB.prepare(`DELETE FROM responses WHERE form_id=? AND id IN (${placeholders})`)
          .bind(formId, ...chunk).run();
        deleted += Number(result.meta?.changes || 0);
      }
      return json({ ok: true, deleted });
    }

    m = p.match(/^\/api\/forms\/([^/]+)\/responses$/);
    if (m && request.method === 'GET') {
      if (!isAdmin(request, env)) return bad('Unauthorized', 401);
      const formId = decodeURIComponent(m[1]);
      const [q, versionRows] = await Promise.all([
        env.DB.prepare('SELECT r.id,r.respondent_name,r.respondent_meta,r.answers,r.path,r.score,r.published_version,r.created_at,r.source,r.source_app_id,r.source_version,r.source_session,r.source_platform,r.source_metadata,a.name AS source_app_name FROM responses r LEFT JOIN applications a ON a.id=r.source_app_id WHERE r.form_id=? ORDER BY r.created_at DESC').bind(formId).all(),
        env.DB.prepare('SELECT version,data,published_at FROM form_versions WHERE form_id=? ORDER BY version DESC').bind(formId).all(),
      ]);
        const responses = (q.results || []).map(r => ({ ...r, respondent_meta: JSON.parse(r.respondent_meta || '{}'), answers: JSON.parse(r.answers || '{}'), path: JSON.parse(r.path || '[]'), source_metadata: JSON.parse(r.source_metadata || '{}') }));
      const versions = (versionRows.results || []).map(v => ({ version: Number(v.version), form: JSON.parse(v.data), publishedAt: v.published_at }));
      const ascending = [...versions].sort((a, b) => a.version - b.version), compatibility = [];
      for (let i = 1; i < ascending.length; i++) compatibility.push({ fromVersion: ascending[i - 1].version, toVersion: ascending[i].version, ...classifySnapshots(ascending[i - 1].form, ascending[i].form) });
      return json({ responses, versions, compatibility });
    }

    m = p.match(/^\/api\/public\/forms\/([^/]+)$/);
    if (m && request.method === 'GET') {
      const publicId = decodeURIComponent(m[1]);
      const row = await env.DB.prepare('SELECT id,published,public_id,publication_state,published_data,published_version,published_at,open_at,close_at FROM forms WHERE public_id=?').bind(publicId).first();
      if (!row) {
        const revoked = await env.DB.prepare('SELECT public_id FROM revoked_public_links WHERE public_id=?').bind(publicId).first();
        return revoked ? bad('ลิงก์แบบฟอร์มนี้ไม่สามารถใช้งานได้แล้ว', 410, { code: 'LINK_REVOKED', state: 'REVOKED' }) : bad('ไม่พบลิงก์แบบฟอร์มนี้', 404, { code: 'LINK_NOT_FOUND' });
      }
      const publication = publicationView(row);
      if (publication.state !== 'OPEN') return json({ publication });
      const accessError = await checkFormAccess(request, env, row.id);
      if (accessError) return accessError;
      let form;
      try { form = JSON.parse(row.published_data); } catch { return bad('ข้อมูลฟอร์มไม่สมบูรณ์ กรุณาแจ้งผู้ดูแล', 500); }
      return json({ publication, form });
    }

    m = p.match(/^\/api\/public\/forms\/([^/]+)\/responses$/);
    if (m && request.method === 'POST') {
      const publicId = decodeURIComponent(m[1]);
      const body = await readBody(request, 256 * 1024);
      if (!body) return bad('ข้อมูลคำตอบไม่ถูกต้อง');
      const row = await env.DB.prepare('SELECT id,published,public_id,publication_state,published_data,published_version,published_at,open_at,close_at FROM forms WHERE public_id=?').bind(publicId).first();
      if (!row) {
        const revoked = await env.DB.prepare('SELECT public_id FROM revoked_public_links WHERE public_id=?').bind(publicId).first();
        return revoked ? bad('ลิงก์แบบฟอร์มนี้ไม่สามารถใช้งานได้แล้ว', 410, { code: 'LINK_REVOKED' }) : bad('ไม่พบลิงก์แบบฟอร์มนี้', 404);
      }
      const publication = publicationView(row);
      if (publication.state !== 'OPEN') return bad(publication.state === 'SCHEDULED' ? 'แบบฟอร์มนี้ยังไม่เปิดรับคำตอบ' : publication.state === 'CLOSED' ? 'แบบฟอร์มนี้ปิดรับคำตอบแล้ว' : 'แบบฟอร์มนี้ไม่พร้อมใช้งาน', 403, { state: publication.state });
      const accessError = await checkFormAccess(request, env, row.id);
      if (accessError) return accessError;
      let form;
      try { form = normalizeRuntimeForm(JSON.parse(row.published_data)); } catch { return bad('ข้อมูลฟอร์มไม่สมบูรณ์ กรุณาแจ้งผู้ดูแล', 500); }
      if (!form) return bad('ข้อมูลฟอร์มไม่สมบูรณ์ กรุณาแจ้งผู้ดูแล', 500);
      const respondent = validateRespondentMeta(form, body.respondentMeta, typeof body.respondentName === 'string' ? body.respondentName : '');
      if (respondent.error) return bad(respondent.error);
      const checked = validatePublicResponse(form, body.answers);
      if (checked.error) return bad(checked.error);
      const account = accountContext(request);
      delete respondent.meta._account;
      if (account?.user) respondent.meta._account = { userId: account.user.id, username: account.user.username, name: account.user.name };
      const now = new Date().toISOString();
      const respId = id('resp');
      const secured = !!account?.organization;
      const accessGuard = secured ? " AND (access_mode='PUBLIC' OR (? IS NOT NULL AND (access_mode='MEMBERS' OR EXISTS (SELECT 1 FROM form_members m WHERE m.form_id=forms.id AND m.user_id=?))))" : '';
      const inserted = await env.DB.prepare(`INSERT INTO responses (id,form_id,respondent_name,respondent_meta,answers,path,score,published_version,created_at${secured ? ',respondent_user_id' : ''}) SELECT ?,?,?,?,?,?,?,?,?${secured ? ',?' : ''} WHERE EXISTS (SELECT 1 FROM forms WHERE id=? AND public_id=? AND published_version=? AND published_data IS NOT NULL AND publication_state IN ('OPEN','SCHEDULED') AND (open_at IS NULL OR open_at<=?) AND (close_at IS NULL OR close_at>?)${accessGuard})`)
        .bind(respId, row.id, respondent.respondentName, JSON.stringify(respondent.meta), JSON.stringify(checked.answers), JSON.stringify(checked.path), checked.score, Number(row.published_version), now, ...(secured ? [account.user?.id || null] : []), row.id, publicId, Number(row.published_version), now, now, ...(secured ? [account.user?.id || null, account.user?.id || null] : [])).run();
      if (!inserted.meta?.changes) return bad('สถานะหรือ Version ของแบบฟอร์มเปลี่ยนไป กรุณาเปิดลิงก์ใหม่ก่อนส่งคำตอบ', 409);
      return json({ ok: true, id: respId, publishedVersion: Number(row.published_version) }, 201);
    }

    if (p.startsWith('/api/')) return bad('API route not found', 404);
    return env.ASSETS.fetch(request);
  },
};
