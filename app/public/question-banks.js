
function __apText(value) { return globalThis.APFormsI18n ? globalThis.APFormsI18n.text(value) : value; }
function __apHtml(strings, ...values) { return globalThis.APFormsI18n ? globalThis.APFormsI18n.html(strings, ...values) : strings.reduce((result, part, index) => result + part + (index < values.length ? String(values[index] ?? '') : ''), ''); }
function __apLabels(value) { return globalThis.APFormsI18n ? globalThis.APFormsI18n.labels(value) : value; }
import { bindQuestionActivity, ensureQuestionActivityState, renderQuestionActivity } from './question-activity-runtime.js';

const app = document.querySelector('#questionBanksApp');
const toastElement = document.querySelector('#qbToast');
const TYPES = __apLabels({
  SINGLE_CHOICE: __apText('ตัวเลือกเดียว'),
  MULTIPLE_CHOICE: __apText('หลายตัวเลือก'),
  TRUE_FALSE: __apText('จริง / เท็จ'),
  SHORT_ANSWER: __apText('คำตอบสั้น'),
  ORDERING: __apText('เรียงลำดับ'),
  MATCHING: __apText('จับคู่'),
  DRAG_DROP: __apText('ลากไปวาง'),
});
const DIFFICULTY = __apLabels(['',__apText('ง่ายมาก'),__apText('ง่าย'),__apText('ปานกลาง'),__apText('ยาก'),__apText('ยากมาก')]);
const state = {
  token: sessionStorage.getItem('goi_team_key') || '',
  memberName: sessionStorage.getItem('goi_member_name') || '',
  banks: [], bankStatus: 'ACTIVE', bankSearch: '',
  bank: null, questions: [], total: 0, tags: [], mediaAssets: [], selectedId: null,
  selection: new Set(), filters: { search: '', status: 'ACTIVE', type: '', difficulty: '', tag: '', excludeTag: '', sort: 'updated' },
  bulk: { action: '', tagId: '', difficulty: '3' },
  loading: false, saveState: 'saved', saveTimer: null, savePromise: null, searchTimer: null, editRevision: 0,
  mode: 'edit', metadataOpen: false, pendingFocus: null,
  test: { questionId: null, response: null, checked: false, correct: null, revealAnswer: false, revealExplanation: false, selectedMatchLeftId: null, selectedDragTokenId: null },
};
const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
const uid = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-','').slice(0,18)}`;
const displayDate = value => { try { return new Intl.DateTimeFormat((globalThis.APFormsI18n?.locale || 'th-TH'),{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); } catch { return value || '-'; } };
const selectedQuestion = () => state.questions.find(question => question.id === state.selectedId) || null;

async function loadMediaManifest() {
  try {
    const response = await fetch('/assets/question-media/manifest.json', { cache: 'no-store' });
    const manifest = response.ok ? await response.json() : {};
    state.mediaAssets = Array.isArray(manifest.assets) ? manifest.assets.filter(asset => asset?.path) : [];
  } catch { state.mediaAssets = []; }
}

function mediaPreview(media) {
  return media?.path ? `<img class="qb-media-preview" src="${esc(media.path)}" alt="${esc(media.alt || '')}" loading="lazy">` : '';
}

function mediaEditor(target, itemId, media, label = __apText('ภาพประกอบ')) {
  const asset = state.mediaAssets.find(item => item.path === media?.path);
  const name = asset?.name || media?.path?.split('/').pop() || '';
  return `<div class="qb-media-compact">${media?.path ? `<img src="${esc(media.path)}" alt="${esc(media.alt || '')}" loading="lazy"><span title="${esc(name)}">${esc(label)} · ${esc(name)}</span>` : __apHtml`<span>${esc(label)} (ไม่บังคับ)</span>`}<button type="button" class="qb-btn sm" data-open-media="${target}" data-media-id="${esc(itemId || '')}" data-media-label="${esc(label)}">${media?.path ? __apText('เปลี่ยนรูป') : __apText('+ เพิ่มรูป')}</button></div>`;
}

function activityMedia(question, target, itemId) {
  const config = question.answerConfig || {};
  if (target === 'question') return { owner: question, key: 'media' };
  if (target === 'choice') return { owner: (config.choices || []).find(item => item.id === itemId), key: 'media' };
  if (target === 'ordering') return { owner: (config.items || []).find(item => item.id === itemId), key: 'media' };
  if (target === 'match-left' || target === 'match-right') return { owner: (config.pairs || []).find(item => item.id === itemId), key: target === 'match-left' ? 'leftMedia' : 'rightMedia' };
  if (target === 'match-distractor') return { owner: (config.rightDistractors || []).find(item => item.id === itemId), key: 'rightMedia' };
  if (target === 'drag-target') return { owner: (config.targets || []).find(item => item.id === itemId), key: 'media' };
  if (target === 'drag-token') return { owner: (config.tokens || []).find(item => item.id === itemId), key: 'media' };
  return { owner: null, key: '' };
}

function openMediaPicker(target, itemId, label) {
  const question = selectedQuestion(), slot = activityMedia(question, target, itemId);
  if (!slot.owner) return;
  const current = slot.owner[slot.key] || null;
  const knownCurrent = !current?.path || state.mediaAssets.some(asset => asset.path === current.path);
  document.body.insertAdjacentHTML('beforeend', __apHtml`<div class="qb-modal-bg" id="mediaPickerModal"><div class="qb-modal qb-media-modal"><div class="row"><div><h2>เลือกรูป</h2><div class="small muted">${esc(label || __apText('ภาพประกอบ'))}</div></div><div class="grow"></div><button id="closeMediaPicker" class="qb-btn icon">×</button></div>${state.mediaAssets.length ? __apHtml`<div class="qb-field"><label>ไฟล์รูป</label><select id="mediaPickerPath" class="qb-select"><option value="">ไม่ใช้รูป</option>${!knownCurrent ? __apHtml`<option value="${esc(current.path)}" selected>${esc(current.path.split('/').pop())} (ไฟล์เดิม)</option>` : ''}${state.mediaAssets.map(asset => `<option value="${esc(asset.path)}" ${current?.path === asset.path ? 'selected' : ''}>${esc(asset.name)}</option>`).join('')}</select></div><div class="qb-field"><label>คำอธิบายรูป</label><input id="mediaPickerAlt" class="qb-input" value="${esc(current?.alt || '')}" placeholder="อธิบายสิ่งสำคัญในรูปสำหรับโปรแกรมอ่านหน้าจอ"></div><div id="mediaPickerPreview" class="qb-media-modal-preview">${mediaPreview(current)}</div>` : __apText('<div class="qb-empty"><strong>ยังไม่มีรูปในคลังสื่อ</strong><div class="small">วางไฟล์ใน public/assets/question-media/ แล้วสร้าง manifest ก่อน</div></div>')}<div class="qb-dialog-actions">${current?.path ? __apText('<button id="removeMedia" class="qb-btn danger">เอารูปออก</button>') : ''}<button id="cancelMediaPicker" class="qb-btn">ยกเลิก</button>${state.mediaAssets.length ? __apText('<button id="saveMediaPicker" class="qb-btn primary">ใช้รูปนี้</button>') : ''}</div></div></div>`);
  const close = () => document.querySelector('#mediaPickerModal')?.remove();
  document.querySelector('#closeMediaPicker').onclick = close;
  document.querySelector('#cancelMediaPicker').onclick = close;
  document.querySelector('#mediaPickerModal').onclick = event => { if (event.target.id === 'mediaPickerModal') close(); };
  document.querySelector('#mediaPickerPath')?.addEventListener('change', event => { const preview = document.querySelector('#mediaPickerPreview'); preview.innerHTML = event.target.value ? mediaPreview({ path: event.target.value, alt: document.querySelector('#mediaPickerAlt').value }) : ''; });
  document.querySelector('#saveMediaPicker')?.addEventListener('click', () => { const path = document.querySelector('#mediaPickerPath').value; slot.owner[slot.key] = path ? { path, alt: document.querySelector('#mediaPickerAlt').value.trim() } : null; close(); queueSave(true); renderStudio(); });
  document.querySelector('#removeMedia')?.addEventListener('click', () => { slot.owner[slot.key] = null; close(); queueSave(true); renderStudio(); });
}

function toast(message, duration = 3000) {
  toastElement.textContent = message;
  toastElement.classList.add('show');
  clearTimeout(toastElement._timer);
  toastElement._timer = setTimeout(() => toastElement.classList.remove('show'), duration);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.json !== false) headers['content-type'] = 'application/json';
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(APFormsI18n.message(data.error) || `HTTP ${response.status}`);
    error.status = response.status; error.data = data;
    if (response.status === 401) { state.token = ''; sessionStorage.removeItem('goi_team_key'); renderLogin(); }
    throw error;
  }
  return data;
}

function nav(target) {
  if (target === 'question-banks') { history.replaceState({}, '', '/question-banks.html'); state.bank = null; state.selectedId = null; loadBanks(); return; }
  if (target === 'question-packs') { location.href = '/question-packs.html'; return; }
  if (target === 'applications') sessionStorage.setItem('goi_initial_view', 'applications');
  location.href = '/';
}

function topbar() {
  return __apHtml`<header class="qb-topbar"><div class="qb-brand">AP+<span>forms</span></div><button class="qb-btn ghost sm" data-nav="forms">ฟอร์ม</button><button class="qb-btn ghost sm nav-active" data-nav="question-banks">คลังคำถาม</button><button class="qb-btn ghost sm" data-nav="question-packs">ชุดคำถาม</button><button class="qb-btn ghost sm" data-nav="applications">แอปพลิเคชัน</button><div class="grow"></div>${state.bank ? `<button id="qbSaveState" class="qb-save-state ${esc(state.saveState)}" ${state.saveState === 'error' ? __apText('title="คลิกเพื่อลองบันทึกอีกครั้ง"') : 'disabled'}>${state.saveState === 'saving' ? __apText('กำลังบันทึก…') : state.saveState === 'error' ? __apText('บันทึกไม่สำเร็จ · ลองอีกครั้ง') : __apText('บันทึกแล้ว')}</button>` : ''}<span class="qb-member tiny muted">${esc(state.memberName || __apText('ทีม'))}</span></header>`;
}

function bindNav() { document.querySelectorAll('[data-nav]').forEach(button => button.onclick = () => nav(button.dataset.nav)); }

function localizeStudio() {
  const translations = new Map([
    ['Status',__apText('สถานะ')],['Active (Draft + Ready)',__apText('ใช้งาน (Draft + Ready)')],['All Statuses',__apText('ทุกสถานะ')],
    ['Draft',__apText('ฉบับร่าง')],['Ready',__apText('พร้อมใช้')],['Archived',__apText('เก็บถาวร')],['Question Type',__apText('ประเภทคำถาม')],['All Types',__apText('ทุกประเภท')],
    ['Difficulty',__apText('ระดับความยาก')],['All Levels',__apText('ทุกระดับ')],['Must include tag',__apText('ต้องมี Tag')],['Exclude tag',__apText('ไม่รวม Tag')],
    ['Tags',__apText('แท็ก')],['+ Tag',__apText('+ แท็ก')],['Edit',__apText('แก้ไข')],['Recently Updated',__apText('แก้ไขล่าสุด')],['Created',__apText('วันที่สร้าง')],
    ['Difficulty ↑',__apText('ความยาก ↑')],['Difficulty ↓',__apText('ความยาก ↓')],['Prompt A–Z',__apText('เรียงโจทย์ ก–ฮ / A–Z')],
    ['Question Editor',__apText('ตัวแก้ไขคำถาม')],['Preview',__apText('ดูตัวอย่าง')],['Duplicate',__apText('ทำสำเนา')],['Question',__apText('คำถาม')],
    ['Prompt',__apText('โจทย์')],['Description / Context',__apText('คำอธิบาย / บริบท')],['Answers',__apText('คำตอบ')],['Explanation',__apText('คำอธิบายเฉลย')],
    ['Explanation for learner / reviewer',__apText('คำอธิบายสำหรับผู้เรียน / ผู้ตรวจ')],['Classification',__apText('การจัดหมวดหมู่')],
    ['Internal Information',__apText('ข้อมูลภายในทีม')],['Internal Notes',__apText('บันทึกภายในทีม')],['Source / Reference',__apText('แหล่งที่มา / อ้างอิง')],
    ['Delete Archived Question',__apText('ลบคำถามที่เก็บถาวร')],['Filters',__apText('ตัวกรอง')],['Library & Filters',__apText('คลังและตัวกรอง')],
    ['Load more questions',__apText('โหลดคำถามเพิ่ม')],['Reveal Answer',__apText('แสดงเฉลย')],['Correct Answer',__apText('คำตอบที่ถูกต้อง')],
    ['Draft Preview',__apText('ตัวอย่างฉบับร่าง')],['Apply',__apText('นำไปใช้')],['Archive',__apText('เก็บถาวร')],['Set Difficulty…',__apText('ตั้งระดับความยาก…')],
    ['Add Tag…',__apText('เพิ่ม Tag…')],['Remove Tag…',__apText('นำ Tag ออก…')],['True',__apText('จริง')],['False',__apText('เท็จ')],
    ['← Banks',__apText('← คลังคำถาม')],['+ Question',__apText('+ คำถาม')],
  ]);
  document.querySelectorAll('button,label,h3,.qb-panel-title,option,strong').forEach(element => {
    if (element.matches('label') && element.querySelector('input,select,textarea')) return;
    const translated = translations.get(element.textContent.trim());
    if (translated) element.textContent = translated;
  });
  const placeholders = new Map([
    ['Search prompt, context, source…',__apText('ค้นหาโจทย์ บริบท หรือแหล่งที่มา…')],
    ['Short answer',__apText('คำตอบสั้น')],['Accepted answer 1',__apText('คำตอบที่ยอมรับ 1')],
  ]);
  document.querySelectorAll('[placeholder]').forEach(element => { const translated = placeholders.get(element.placeholder); if (translated) element.placeholder = translated; });
  const studioDescription = document.querySelector('.qb-bank-description');
  if (studioDescription) studioDescription.textContent = __apHtml`สตูดิโอคำถาม · ทั้งหมด ${Number(state.bank?.question_count || state.total).toLocaleString()} ข้อ`;
}

function renderLogin(){if(window.APAccount){APAccount.login();return}
  app.innerHTML = __apHtml`<main class="qb-login"><section class="qb-login-card"><div class="qb-logo">QS</div><h1>สตูดิโอคำถาม</h1><p class="muted">เข้าสู่พื้นที่จัดการคลังคำถามของทีม AP+forms</p><div class="qb-field"><label>ชื่อสมาชิกทีม</label><input id="qbMember" class="qb-input" value="${esc(state.memberName)}" autocomplete="nickname" placeholder="เช่น ผู้ดูแลเนื้อหา"></div><div class="qb-field" style="margin-top:10px"><label>TEAM KEY</label><input id="qbKey" class="qb-input" type="password" autocomplete="current-password"></div><button id="qbLogin" class="qb-btn primary" style="width:100%;margin-top:12px">เข้าสู่สตูดิโอคำถาม</button><div id="qbLoginError" class="qb-error"></div><button class="qb-btn ghost" data-nav="forms" style="width:100%;margin-top:6px">กลับ AP+forms</button></section></main>`;
  bindNav();
  const login = async () => {
    const key = document.querySelector('#qbKey').value, name = document.querySelector('#qbMember').value.trim() || __apText('สมาชิกทีม');
    state.token = key;
    try {
      await api('/api/login', { method: 'POST', body: '{}' });
      state.memberName = name;
      sessionStorage.setItem('goi_team_key', key); sessionStorage.setItem('goi_member_name', name);
      await boot();
    } catch (error) { state.token = ''; document.querySelector('#qbLoginError').textContent = error.message; }
  };
  document.querySelector('#qbLogin').onclick = login;
  document.querySelector('#qbKey').onkeydown = event => { if (event.key === 'Enter') login(); };
}

async function loadBanks() {
  state.loading = true; renderBanks();
  try {
    const params = new URLSearchParams({ status: state.bankStatus });
    if (state.bankSearch) params.set('search', state.bankSearch);
    const data = await api(`/api/admin/question-banks?${params}`);
    state.banks = data.banks || [];
  } catch (error) { toast(__apHtml`โหลดคลังคำถามไม่สำเร็จ: ${error.message}`, 4500); }
  finally { state.loading = false; renderBanks(); }
}

function bankCard(bank) {
  const archived = bank.status === 'ARCHIVED';
  return __apHtml`<article class="qb-card qb-bank-card"><div class="row"><div class="grow"><h3>${esc(bank.name)}</h3><div class="tiny muted">${esc(bank.id)}</div></div><span class="qb-status ${bank.status.toLowerCase()}">${archived ? __apText('เก็บถาวร') : __apText('ใช้งานอยู่')}</span></div><div class="qb-bank-description small muted">${esc(bank.description || __apText('ยังไม่มีคำอธิบาย'))}</div><div class="qb-bank-meta"><div><div class="tiny muted">คำถาม</div><strong>${Number(bank.question_count || 0).toLocaleString()}</strong></div><div><div class="tiny muted">แก้ไขล่าสุด</div><strong class="small">${esc(displayDate(bank.updated_at))}</strong></div></div><div class="qb-bank-actions"><button class="qb-btn primary" data-open-bank="${esc(bank.id)}">${archived ? __apText('เปิดดู') : __apText('เปิดสตูดิโอ')}</button><button class="qb-btn sm" data-export-bank="${esc(bank.id)}">ส่งออก</button><button class="qb-btn sm" data-rename-bank="${esc(bank.id)}">เปลี่ยนชื่อ</button><button class="qb-btn sm" data-toggle-bank="${esc(bank.id)}">${archived ? __apText('นำกลับมาใช้') : __apText('เก็บถาวร')}</button>${archived ? __apHtml`<button class="qb-btn sm danger" data-delete-bank="${esc(bank.id)}">ลบ</button>` : ''}</div></article>`;
}

function renderBanks() {
  if (state.bank) return;
  app.innerHTML = __apHtml`${topbar()}<main class="qb-page"><div class="qb-content"><div class="pack-tabs"><button class="qb-btn active" data-nav="question-banks">คลังคำถาม</button><button class="qb-btn" data-nav="question-packs">ชุดคำถาม</button></div><div class="qb-page-head"><div><h1>คลังคำถาม</h1><div class="muted small">จัดการเนื้อหาแบบประเมินแยกจากคำถามในฟอร์ม</div></div><div class="grow"></div></div><div class="qb-bank-toolbar"><input id="bankSearch" class="qb-input" value="${esc(state.bankSearch)}" placeholder="ค้นหาคลังคำถาม…"><select id="bankStatus" class="qb-select"><option value="ACTIVE" ${state.bankStatus === 'ACTIVE' ? 'selected' : ''}>กำลังใช้งาน</option><option value="ARCHIVED" ${state.bankStatus === 'ARCHIVED' ? 'selected' : ''}>เก็บถาวร</option><option value="ALL" ${state.bankStatus === 'ALL' ? 'selected' : ''}>ทั้งหมด</option></select><div class="qb-bank-primary-actions"><button id="importBank" class="qb-btn">นำเข้าไฟล์</button><button id="openTemplates" class="qb-btn">แม่แบบ</button><button id="createBank" class="qb-btn primary">+ สร้างคลังคำถาม</button></div></div>${state.loading ? __apText('<div class="qb-empty">กำลังโหลดคลังคำถาม…</div>') : state.banks.length ? `<div class="qb-bank-grid">${state.banks.map(bankCard).join('')}</div>` : __apHtml`<div class="qb-empty"><h3>${state.bankStatus === 'ARCHIVED' ? __apText('ยังไม่มีคลังที่เก็บถาวร') : __apText('เริ่มสร้างคลังคำถามแรก')}</h3><div class="small">คลังคำถามเก็บโจทย์ เฉลย ระดับความยาก และ Tag โดยไม่ปะปนกับคำถามในฟอร์ม</div></div>`}</div></main>`;
  bindNav();
  const search = document.querySelector('#bankSearch');
  if (search) search.oninput = () => { state.bankSearch = search.value; clearTimeout(state.searchTimer); state.searchTimer = setTimeout(loadBanks, 300); };
  const status = document.querySelector('#bankStatus'); if (status) status.onchange = () => { state.bankStatus = status.value; loadBanks(); };
  const create = document.querySelector('#createBank'); if (create) create.onclick = createBank;
  document.querySelector('#importBank')?.addEventListener('click', choosePackageFile);
  document.querySelector('#openTemplates')?.addEventListener('click', openTemplates);
  document.querySelectorAll('[data-open-bank]').forEach(button => button.onclick = () => openBank(button.dataset.openBank));
  document.querySelectorAll('[data-export-bank]').forEach(button => button.onclick = () => exportBank(button.dataset.exportBank));
  document.querySelectorAll('[data-rename-bank]').forEach(button => button.onclick = () => renameBank(button.dataset.renameBank));
  document.querySelectorAll('[data-toggle-bank]').forEach(button => button.onclick = () => toggleBank(button.dataset.toggleBank));
  document.querySelectorAll('[data-delete-bank]').forEach(button => button.onclick = () => deleteBank(button.dataset.deleteBank));
}

function closePackageModal() { document.querySelector('#packageModal')?.remove(); }
function activeBankOptions(selected = '') {
  const banks = state.banks.filter(bank => bank.status === 'ACTIVE');
  if (state.bank?.status === 'ACTIVE' && !banks.some(bank => bank.id === state.bank.id)) banks.unshift(state.bank);
  return __apHtml`<option value="">สร้างเป็นคลังใหม่</option>${banks.map(bank => __apHtml`<option value="${esc(bank.id)}" ${selected === bank.id ? 'selected' : ''}>เพิ่มใน ${esc(bank.name)}</option>`).join('')}`;
}
function packageModal(content) {
  closePackageModal();
  document.body.insertAdjacentHTML('beforeend', `<div class="qb-modal-bg" id="packageModal"><div class="qb-modal qb-package-modal"><button id="closePackageModal" class="qb-btn icon qb-modal-close">×</button>${content}</div></div>`);
  document.querySelector('#closePackageModal').onclick = closePackageModal;
  document.querySelector('#packageModal').onclick = event => { if (event.target.id === 'packageModal') closePackageModal(); };
}
function choosePackageFile() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast(__apText('ไฟล์ใหญ่เกิน 2 MB'), 4500); return; }
    try { await openPackagePreview(JSON.parse(await file.text()), file.name); }
    catch (error) { toast(__apHtml`อ่านไฟล์ JSON ไม่สำเร็จ: ${error.message}`, 5000); }
  };
  input.click();
}
async function openPackagePreview(packageData, sourceName, targetBankId = state.bank?.status === 'ACTIVE' ? state.bank.id : '') {
  packageModal(__apHtml`<h2>ตรวจสอบ Package</h2><div class="small muted">${esc(sourceName)}</div><div class="qb-field"><label>ปลายทาง</label><select id="packageTarget" class="qb-select">${activeBankOptions(targetBankId)}</select></div><div id="packagePreviewBody" class="qb-package-loading">กำลังตรวจสอบ…</div>`);
  const runPreview = async () => {
    const target = document.querySelector('#packageTarget')?.value || '';
    const container = document.querySelector('#packagePreviewBody'); if (!container) return;
    container.innerHTML = __apText('กำลังตรวจสอบ…');
    let preview;
    try { preview = (await api('/api/admin/question-bank-packages/preview', { method: 'POST', body: JSON.stringify({ package: packageData, targetBankId: target }) })).preview; }
    catch (error) { preview = error.data?.preview; if (!preview) { container.innerHTML = `<div class="qb-error">${esc(error.message)}</div>`; return; } }
    const summary = preview.summary || {}, incomplete = (preview.questions || []).filter(question => question.errors?.length);
    container.innerHTML = __apHtml`<div class="qb-package-summary"><div><span>ชื่อคลังในไฟล์</span><strong>${esc(summary.bankName || '-')}</strong></div><div><span>คำถาม</span><strong>${Number(summary.questionsTotal || 0)}</strong></div><div><span>แท็ก</span><strong>${Number(summary.tagsTotal || 0)}</strong></div><div><span>พร้อมใช้</span><strong>${Number(summary.ready || 0)}</strong></div><div><span>ข้อมูลยังไม่ครบ</span><strong>${Number(summary.draft || 0)}</strong></div><div><span>อาจซ้ำ</span><strong>${Number(summary.duplicates || 0)}</strong></div></div>${summary.targetBankName ? __apHtml`<div class="qb-package-target">จะเพิ่มเข้า “${esc(summary.targetBankName)}” · ใช้แท็กเดิม ${Number(summary.reusedTags || 0)} / สร้างใหม่ ${Number(summary.newTags || 0)}</div>` : ''}${preview.errors?.length ? __apHtml`<div class="qb-package-messages error"><strong>ข้อผิดพลาด</strong><ul>${preview.errors.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}${incomplete.length ? __apHtml`<div class="qb-package-messages warning"><strong>คำถามที่ข้อมูลยังไม่ครบ (นำเข้าเป็นฉบับร่าง)</strong><ul>${incomplete.map(question => __apHtml`<li>ข้อ ${question.index}: ${question.errors.map(esc).join(' · ')}</li>`).join('')}</ul></div>` : ''}${preview.warnings?.length ? __apHtml`<div class="qb-package-messages warning"><strong>คำเตือน</strong><ul>${preview.warnings.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}${preview.valid ? __apHtml`${summary.duplicates ? __apHtml`<div class="qb-field"><label>คำถามที่อาจซ้ำ</label><label class="qb-check"><input type="radio" name="duplicateMode" value="skip" checked> ข้ามคำถามซ้ำ</label><label class="qb-check"><input type="radio" name="duplicateMode" value="import"> นำเข้าทั้งหมด</label></div>` : ''}<div class="qb-dialog-actions"><button id="cancelPackageImport" class="qb-btn">ยกเลิก</button><button id="confirmPackageImport" class="qb-btn primary">ยืนยันนำเข้า</button></div>` : __apText('<div class="small muted">แก้ไฟล์ Package แล้วเลือกนำเข้าใหม่ ระบบยังไม่ได้เขียนข้อมูลใดลงคลัง</div>')}`;
    document.querySelector('#cancelPackageImport')?.addEventListener('click', closePackageModal);
    document.querySelector('#confirmPackageImport')?.addEventListener('click', async event => {
      event.currentTarget.disabled = true; event.currentTarget.textContent = __apText('กำลังนำเข้า…');
      try {
        const duplicateMode = document.querySelector('input[name="duplicateMode"]:checked')?.value || 'import';
        const result = await api('/api/admin/question-bank-packages/import', { method: 'POST', body: JSON.stringify({ package: packageData, targetBankId: target, duplicateMode }) });
        closePackageModal(); toast(__apHtml`นำเข้าแล้ว ${result.importedQuestions} ข้อ${result.skippedDuplicates ? __apHtml` · ข้ามซ้ำ ${result.skippedDuplicates}` : ''}`, 4500); await openBank(result.bankId);
      } catch (error) { event.currentTarget.disabled = false; event.currentTarget.textContent = __apText('ยืนยันนำเข้า'); toast(error.message, 5000); }
    });
  };
  document.querySelector('#packageTarget').onchange = runPreview;
  await runPreview();
}
async function openTemplates() {
  packageModal(__apText('<h2>แม่แบบคลังคำถาม</h2><p class="small muted">แม่แบบต้นฉบับเป็นแบบอ่านอย่างเดียว เมื่อใช้แล้วจะสร้างเป็นคลังปกติที่แก้ไขได้</p><div id="templateList" class="qb-package-loading">กำลังโหลดแม่แบบ…</div>'));
  const container = document.querySelector('#templateList');
  try {
    const response = await fetch((APFormsI18n.language === 'en' ? '/question-bank-templates/manifest.en.json' : '/question-bank-templates/manifest.json'), { cache: 'no-store' }); if (!response.ok) throw new Error(__apText('ไม่พบรายการแม่แบบ'));
    const manifest = await response.json(), templates = Array.isArray(manifest.templates) ? manifest.templates : [];
    container.innerHTML = templates.length ? templates.map(template => __apHtml`<article class="qb-template-card"><div><strong>${esc(template.name)}</strong><div class="small muted">${esc(template.description || '')}</div></div><button class="qb-btn primary" data-use-template="${esc(template.path)}">ใช้แม่แบบ</button></article>`).join('') : __apText('<div class="qb-empty">ยังไม่มีแม่แบบ</div>');
    document.querySelectorAll('[data-use-template]').forEach(button => button.onclick = async () => { try { const item = await fetch(button.dataset.useTemplate, { cache: 'no-store' }); if (!item.ok) throw new Error(__apText('โหลดแม่แบบไม่สำเร็จ')); await openPackagePreview(await item.json(), button.closest('article').querySelector('strong').textContent); } catch (error) { toast(error.message, 4500); } });
  } catch (error) { container.innerHTML = `<div class="qb-error">${esc(error.message)}</div>`; }
}
async function exportBank(bankId) {
  try {
    if (state.bank?.id === bankId && !(await flushSave())) return;
    const packageData = await api(`/api/admin/question-banks/${encodeURIComponent(bankId)}/export`);
    const blob = new Blob([JSON.stringify(packageData, null, 2)], { type: 'application/json' }), link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `${String(packageData.bank?.name || 'question-bank').replace(/[^a-zA-Z0-9ก-๙_-]+/g, '-')}.json`; link.click(); URL.revokeObjectURL(link.href); toast(__apText('ส่งออก Package แล้ว'));
  } catch (error) { toast(__apHtml`ส่งออกไม่สำเร็จ: ${error.message}`, 4500); }
}

async function createBank() {
  const name = prompt(__apText('ชื่อคลังคำถาม')); if (!name?.trim()) return;
  const description = prompt(__apText('คำอธิบาย (ไม่บังคับ)'), '') ?? '';
  try { const data = await api('/api/admin/question-banks', { method: 'POST', body: JSON.stringify({ name, description }) }); await openBank(data.bank.id); }
  catch (error) { toast(error.message, 4200); }
}
async function renameBank(bankId) {
  const bank = state.banks.find(item => item.id === bankId); if (!bank) return;
  const name = prompt(__apText('ชื่อใหม่ของคลังคำถาม'), bank.name); if (!name?.trim() || name.trim() === bank.name) return;
  try { await api(`/api/admin/question-banks/${encodeURIComponent(bankId)}`, { method: 'PATCH', body: JSON.stringify({ name }) }); await loadBanks(); }
  catch (error) { toast(error.message, 4200); }
}
async function toggleBank(bankId) {
  const bank = state.banks.find(item => item.id === bankId); if (!bank) return;
  const next = bank.status === 'ARCHIVED' ? 'ACTIVE' : 'ARCHIVED';
  if (next === 'ARCHIVED' && !confirm(__apHtml`เก็บคลัง “${bank.name}” ไว้ถาวรหรือไม่? คำถามจะไม่ปรากฏในขั้นตอนการทำงานปกติ`)) return;
  try { await api(`/api/admin/question-banks/${encodeURIComponent(bankId)}`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); await loadBanks(); }
  catch (error) { toast(error.message, 4200); }
}
async function deleteBank(bankId) {
  const bank = state.banks.find(item => item.id === bankId); if (!bank) return;
  const confirmation = prompt(__apHtml`การลบจะลบคำถามและแท็กในคลังนี้อย่างถาวร\nพิมพ์ “${bank.name}” เพื่อยืนยัน`);
  if (confirmation !== bank.name) { if (confirmation != null) toast(__apText('ชื่อยืนยันไม่ตรง จึงไม่ได้ลบ Bank')); return; }
  try { await api(`/api/admin/question-banks/${encodeURIComponent(bankId)}`, { method: 'DELETE', body: JSON.stringify({ confirmName: confirmation }) }); await loadBanks(); toast(__apText('ลบคลังคำถามแล้ว')); }
  catch (error) { toast(error.message, 4500); }
}

async function openBank(bankId, keepSelection = false) {
  state.loading = true;
  try {
    const [bankData, tagData] = await Promise.all([api(`/api/admin/question-banks/${encodeURIComponent(bankId)}`), api(`/api/admin/question-banks/${encodeURIComponent(bankId)}/tags`), loadMediaManifest()]);
    state.bank = bankData.bank; state.tags = tagData.tags || []; state.selection.clear();
    if (!keepSelection) state.selectedId = null;
    history.replaceState({}, '', `/question-banks.html?bank=${encodeURIComponent(bankId)}`);
    await loadQuestions(false);
  } catch (error) { state.bank = null; toast(__apHtml`เปิดสตูดิโอคำถามไม่สำเร็จ: ${error.message}`, 4500); renderBanks(); }
  finally { state.loading = false; }
}

function questionParams(offset = 0) {
  const params = new URLSearchParams({ sort: state.filters.sort, limit: '60', offset: String(offset) });
  for (const key of ['search','status','type','difficulty','tag','excludeTag']) if (state.filters[key]) params.append(key, state.filters[key]);
  return params;
}
async function loadQuestions(renderLoading = true, append = false) {
  if (!state.bank) return;
  if (renderLoading) { state.loading = true; renderStudio(); }
  try {
    const data = await api(`/api/admin/question-banks/${encodeURIComponent(state.bank.id)}/questions?${questionParams(append ? state.questions.length : 0)}`);
    state.questions = append ? [...state.questions, ...(data.questions || [])] : (data.questions || []); state.total = data.total || 0;
    if (state.selectedId && !selectedQuestion()) state.selectedId = null;
  } catch (error) { toast(__apHtml`โหลดคำถามไม่สำเร็จ: ${error.message}`, 4500); }
  finally { state.loading = false; renderStudio(); }
}

function groupedTags() {
  const groups = new Map();
  for (const tag of state.tags) { const group = tag.groupName || __apText('ไม่มีกลุ่ม'); if (!groups.has(group)) groups.set(group, []); groups.get(group).push(tag); }
  return groups;
}
function tagFilterOptions(value = '') { return __apHtml`<option value="">ทุกแท็ก</option>${[...groupedTags()].map(([group,tags]) => `<optgroup label="${esc(group)}">${tags.map(tag => `<option value="${esc(tag.id)}" ${value === tag.id ? 'selected' : ''}>${esc(tag.name)}</option>`).join('')}</optgroup>`).join('')}`; }
const statusLabel = status => ({ DRAFT: __apText('ฉบับร่าง'), READY: __apText('พร้อมใช้'), ARCHIVED: __apText('เก็บถาวร') }[status] || status);

function questionCard(question) {
  return __apHtml`<article class="qb-question-card ${question.id === state.selectedId ? 'selected' : ''} ${question.status === 'ARCHIVED' ? 'archived' : ''}" data-select-question="${esc(question.id)}"><input class="qb-select-question" type="checkbox" data-question-check="${esc(question.id)}" ${state.selection.has(question.id) ? 'checked' : ''} aria-label="เลือกคำถาม"><div class="grow"><div class="qb-question-prompt">${esc(question.prompt || __apText('คำถามใหม่ที่ยังไม่มีโจทย์'))}</div><div class="qb-question-meta"><span class="qb-status ${question.status.toLowerCase()}">${statusLabel(question.status)}</span><span class="qb-type">${esc(TYPES[question.type])}</span><span class="qb-difficulty">ระดับ ${question.difficulty} · ${esc(DIFFICULTY[question.difficulty])}</span>${question.tags.slice(0,2).map(tag => `<span class="qb-tag-chip">${esc(tag.name)}</span>`).join('')}</div></div><button class="qb-btn icon sm" data-duplicate-question="${esc(question.id)}" title="ทำสำเนาคำถาม" ${state.bank.status !== 'ACTIVE' ? 'disabled' : ''}>⧉</button></article>`;
}
function bulkView() {
  if (!state.selection.size) return '';
  const tagAction = state.bulk.action === 'add_tags' || state.bulk.action === 'remove_tags';
  return __apHtml`<div class="qb-bulk"><strong>เลือกแล้ว ${state.selection.size} ข้อ</strong><select id="bulkAction" class="qb-select"><option value="">เลือกการทำงาน</option><option value="add_tags" ${state.bulk.action === 'add_tags' ? 'selected' : ''}>เพิ่มแท็ก</option><option value="remove_tags" ${state.bulk.action === 'remove_tags' ? 'selected' : ''}>นำแท็กออก</option><option value="difficulty" ${state.bulk.action === 'difficulty' ? 'selected' : ''}>ตั้งระดับความยาก</option><option value="archive" ${state.bulk.action === 'archive' ? 'selected' : ''}>เก็บถาวร</option><option value="delete" ${state.bulk.action === 'delete' ? 'selected' : ''}>ลบถาวร (เฉพาะที่เก็บแล้ว)</option></select>${tagAction ? __apHtml`<select id="bulkTag" class="qb-select"><option value="">เลือกแท็ก</option>${[...groupedTags()].map(([group,tags]) => `<optgroup label="${esc(group)}">${tags.map(tag => `<option value="${esc(tag.id)}" ${state.bulk.tagId === tag.id ? 'selected' : ''}>${esc(tag.name)}</option>`).join('')}</optgroup>`).join('')}</select>` : ''}${state.bulk.action === 'difficulty' ? `<select id="bulkDifficulty" class="qb-select">${DIFFICULTY.slice(1).map((label,index) => __apHtml`<option value="${index+1}" ${state.bulk.difficulty === String(index+1) ? 'selected' : ''}>ระดับ ${index+1} · ${label}</option>`).join('')}</select>` : ''}<button id="runBulk" class="qb-btn primary" ${!state.bulk.action ? 'disabled' : ''}>ทำกับรายการที่เลือก</button><button id="clearSelection" class="qb-btn">ล้างการเลือก</button></div>`;
}
function listView() {
  const allLoadedSelected = state.questions.length > 0 && state.questions.every(question => state.selection.has(question.id));
  return __apHtml`<div class="qb-list-summary"><strong>${Number(state.total).toLocaleString()}</strong><span class="small muted">คำถาม</span><div class="grow"></div>${state.questions.length ? `<button id="selectAllQuestions" class="qb-btn sm">${allLoadedSelected ? __apText('เลือกครบแล้ว') : __apHtml`เลือกทั้งหมดที่แสดง (${state.questions.length})`}</button>` : ''}${state.selection.size ? __apHtml`<button id="clearSelectionTop" class="qb-btn sm">ล้างการเลือก</button>` : ''}</div>${bulkView()}<div class="qb-question-scroll">${state.loading ? __apText('<div class="qb-empty">กำลังโหลดคำถาม…</div>') : state.questions.length ? `${state.questions.map(questionCard).join('')}${state.questions.length < state.total ? __apHtml`<button id="loadMoreQuestions" class="qb-btn qb-load-more">โหลดเพิ่ม · แสดง ${state.questions.length.toLocaleString()} จาก ${state.total.toLocaleString()}</button>` : __apText('<div class="qb-list-end">แสดงครบทุกคำถามแล้ว</div>')}` : __apText('<div class="qb-empty"><strong>ไม่พบคำถาม</strong><div class="small" style="margin-top:6px">ลองปรับตัวกรอง หรือสร้างคำถามใหม่</div></div>')}</div>`;
}
function libraryView() {
  return __apHtml`<aside class="qb-library"><div class="qb-library-head"><div class="qb-panel-title">คลังคำถาม</div><button id="createTag" class="qb-btn sm" ${state.bank.status !== 'ACTIVE' ? 'disabled' : ''}>+ แท็ก</button></div><input id="questionSearch" class="qb-input" value="${esc(state.filters.search)}" placeholder="ค้นหาโจทย์ บริบท หรือแหล่งที่มา…"><details class="qb-filter-drawer"><summary>ตัวกรองและจัดการแท็ก</summary><div class="qb-filter-grid"><select class="qb-select" data-filter="status"><option value="ACTIVE" ${state.filters.status === 'ACTIVE' ? 'selected' : ''}>กำลังใช้งาน</option><option value="DRAFT" ${state.filters.status === 'DRAFT' ? 'selected' : ''}>ข้อมูลยังไม่ครบ</option><option value="READY" ${state.filters.status === 'READY' ? 'selected' : ''}>พร้อมใช้</option><option value="ARCHIVED" ${state.filters.status === 'ARCHIVED' ? 'selected' : ''}>เก็บถาวร</option><option value="ALL" ${state.filters.status === 'ALL' ? 'selected' : ''}>ทุกสถานะ</option></select><select class="qb-select" data-filter="type"><option value="">ทุกประเภท</option>${Object.entries(TYPES).map(([value,label]) => `<option value="${value}" ${state.filters.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select><select class="qb-select" data-filter="difficulty"><option value="">ทุกระดับ</option>${DIFFICULTY.slice(1).map((label,index) => __apHtml`<option value="${index+1}" ${String(index+1) === state.filters.difficulty ? 'selected' : ''}>ระดับ ${index+1} · ${label}</option>`).join('')}</select><select class="qb-select" data-filter="sort"><option value="updated" ${state.filters.sort === 'updated' ? 'selected' : ''}>แก้ไขล่าสุด</option><option value="created" ${state.filters.sort === 'created' ? 'selected' : ''}>สร้างล่าสุด</option><option value="difficulty_asc" ${state.filters.sort === 'difficulty_asc' ? 'selected' : ''}>ความยากน้อย → มาก</option><option value="difficulty_desc" ${state.filters.sort === 'difficulty_desc' ? 'selected' : ''}>ความยากมาก → น้อย</option><option value="prompt" ${state.filters.sort === 'prompt' ? 'selected' : ''}>เรียงตามโจทย์</option></select><select class="qb-select" data-filter="tag">${tagFilterOptions(state.filters.tag)}</select><select class="qb-select" data-filter="excludeTag"><option value="">ไม่ตัดแท็กใดออก</option>${tagFilterOptions(state.filters.excludeTag).replace(__apText('<option value="">ทุกแท็ก</option>'),'')}</select></div><div class="qb-tag-manager">${state.tags.length ? [...groupedTags()].map(([group,tags]) => `<div class="qb-tag-group">${esc(group)}</div>${tags.map(tag => __apHtml`<span class="qb-tag-manage"><button class="qb-tag-chip" data-rename-tag="${esc(tag.id)}" ${state.bank.status !== 'ACTIVE' ? 'disabled' : ''}>${esc(tag.name)} <span class="muted">${tag.usageCount}</span></button><button class="qb-tag-delete" data-delete-tag="${esc(tag.id)}" title="ลบแท็ก" ${state.bank.status !== 'ACTIVE' ? 'disabled' : ''}>×</button></span>`).join('')}`).join('') : __apText('<span class="tiny muted">ยังไม่มีแท็ก</span>')}</div></details>${listView()}</aside>`;
}

function readinessHtml(question) {
  const readiness = question.readiness || { valid: false, errors: [] };
  return readiness.valid ? __apText('<div class="qb-readiness valid">✓ เนื้อหาครบ · ระบบจัดเป็น “พร้อมใช้” อัตโนมัติ</div>') : __apHtml`<div class="qb-readiness"><strong>ข้อมูลยังไม่ครบ</strong><ul>${(readiness.errors || []).map(error => `<li>${esc(error)}</li>`).join('')}</ul></div>`;
}
function completeDisplayOrder(requested, ids, fallback = ids) {
  const available = new Set(ids), result = [...new Set((Array.isArray(requested) ? requested : []).map(String))].filter(id => available.has(id));
  for (const id of fallback) if (!result.includes(id)) result.push(id);
  for (const id of ids) if (!result.includes(id)) result.push(id);
  return result;
}
function matchingDisplay(config) {
  const pairs = config.pairs || [], distractors = config.rightDistractors || [];
  const leftItems = pairs.map(pair => ({ id: pair.leftId, text: pair.leftText, media: pair.leftMedia, pair }));
  const rightItems = [...pairs.map(pair => ({ id: pair.rightId, text: pair.rightText, media: pair.rightMedia, pair, distractor: false })), ...distractors.map(item => ({ id: item.rightId, text: item.rightText, media: item.rightMedia, source: item, distractor: true }))];
  const leftMap = new Map(leftItems.map(item => [item.id,item])), rightMap = new Map(rightItems.map(item => [item.id,item]));
  const leftOrder = completeDisplayOrder(config.leftOrder, leftItems.map(item => item.id));
  const rightFallback = pairs.map(pair => pair.rightId).reverse().concat(distractors.map(item => item.rightId));
  const rightOrder = completeDisplayOrder(config.rightOrder, rightItems.map(item => item.id), rightFallback);
  return { pairs, distractors, leftOrder, rightOrder, leftItems: leftOrder.map(id => leftMap.get(id)), rightItems: rightOrder.map(id => rightMap.get(id)) };
}
function matchingOrderItemHtml(text, media) {
  return `<span class="qb-test-activity-content">${mediaPreview(media)}<span>${esc(text || __apText('รายการรูปภาพ'))}</span></span>`;
}
function matchingOrderRow(item, index, total, side) {
  return `<div class="qb-match-order-row"><span class="qb-answer-number">${index+1}</span>${matchingOrderItemHtml(item.text, item.media)}${item.distractor ? __apText('<span class="qb-match-distractor-badge">ตัวหลอก</span>') : ''}<div class="qb-reorder"><button type="button" class="qb-btn icon sm" data-move-match-display="${esc(item.id)}" data-match-side="${side}" data-direction="-1" ${index===0?'disabled':''}>↑</button><button type="button" class="qb-btn icon sm" data-move-match-display="${esc(item.id)}" data-match-side="${side}" data-direction="1" ${index===total-1?'disabled':''}>↓</button></div></div>`;
}
function matchingAuthoringEditor(config) {
  const view = matchingDisplay(config);
  const pairCards = view.pairs.map((pair,index) => __apHtml`<div class="qb-activity-card qb-match-card"><strong>เฉลยคู่ ${index+1}</strong><div class="qb-match-grid"><input class="qb-input" data-match-left="${esc(pair.id)}" value="${esc(pair.leftText)}" placeholder="ฝั่งซ้าย"><input class="qb-input" data-match-right="${esc(pair.id)}" value="${esc(pair.rightText)}" placeholder="ฝั่งขวาที่ถูกต้อง"></div><div class="qb-match-grid">${mediaEditor('match-left', pair.id, pair.leftMedia, __apText('รูปฝั่งซ้าย'))}${mediaEditor('match-right', pair.id, pair.rightMedia, __apText('รูปฝั่งขวา'))}</div><button class="qb-btn danger sm" data-remove-pair="${esc(pair.id)}" ${view.pairs.length <= 2 ? 'disabled' : ''}>ลบคู่นี้</button></div>`).join('');
  const distractorCards = view.distractors.map((item,index) => __apHtml`<div class="qb-activity-card"><div class="qb-choice-row qb-match-distractor-row"><span class="qb-answer-number">${index+1}</span><input class="qb-input" data-match-distractor-text="${esc(item.id)}" value="${esc(item.rightText)}" placeholder="ตัวหลอกฝั่งขวา"><button type="button" class="qb-btn icon danger" data-remove-match-distractor="${esc(item.id)}">×</button></div>${mediaEditor('match-distractor', item.id, item.rightMedia, __apText('รูปตัวหลอก'))}</div>`).join('');
  return __apHtml`<div class="qb-answer-hint">กำหนดเฉลยเป็นคู่ แล้วจัดลำดับสองฝั่งแยกกัน ผู้ตอบจะไม่เห็นแถวเฉลยเหล่านี้</div>${pairCards}<button id="addPair" class="qb-btn sm qb-add-answer">+ เพิ่มคู่</button><h4>ตัวหลอกฝั่งขวา</h4><div class="qb-answer-hint">รายการเหล่านี้แสดงให้เลือกได้ แต่ไม่มีคู่ที่ถูกต้อง</div>${distractorCards || __apText('<div class="qb-activity-empty">ยังไม่มีตัวหลอก</div>')}<button id="addMatchDistractor" class="qb-btn sm qb-add-answer">+ เพิ่มตัวหลอก</button><h4>ลำดับที่ผู้ตอบจะเห็น</h4><div class="qb-answer-hint">ฝั่งซ้ายและฝั่งขวาจัดแยกจากกัน จึงไม่เรียงเฉลยติดกันโดยอัตโนมัติ</div><div class="qb-match-display-grid"><section><h5>ฝั่งซ้าย</h5>${view.leftItems.map((item,index) => matchingOrderRow(item,index,view.leftItems.length,'left')).join('')}</section><section><h5>ฝั่งขวา</h5>${view.rightItems.map((item,index) => matchingOrderRow(item,index,view.rightItems.length,'right')).join('')}</section></div>`;
}
function answerEditor(question) {
  const config = question.answerConfig || {};
  if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') {
    const control = question.type === 'SINGLE_CHOICE' ? 'radio' : 'checkbox';
    const choices = config.choices || [];
    return __apHtml`<div class="qb-answer-hint">เลือก${control === 'radio' ? __apText('วงกลม') : __apText('ช่อง')}หน้าแต่ละคำตอบเพื่อกำหนดเฉลย</div><div class="qb-choice-list">${choices.map((choice,index) => __apHtml`<div class="qb-activity-card"><div class="qb-choice-row" data-choice-row="${esc(choice.id)}"><input class="qb-correct-control" type="${control}" name="correctChoice" data-correct-choice="${esc(choice.id)}" ${(config.correctIds || []).includes(choice.id) ? 'checked' : ''} aria-label="ตั้งเป็นคำตอบที่ถูกต้อง"><span class="qb-choice-letter">${String.fromCharCode(65 + index)}</span><input class="qb-input qb-inline-input" data-choice-text="${esc(choice.id)}" value="${esc(choice.text)}" placeholder="พิมพ์ตัวเลือก ${index+1}"><div class="qb-reorder"><button class="qb-btn icon sm" data-move-choice="${esc(choice.id)}" data-direction="-1" ${index === 0 ? 'disabled' : ''}>↑</button><button class="qb-btn icon sm" data-move-choice="${esc(choice.id)}" data-direction="1" ${index === choices.length - 1 ? 'disabled' : ''}>↓</button></div><button class="qb-btn icon danger" data-remove-choice="${esc(choice.id)}" ${choices.length <= 2 ? 'disabled' : ''}>×</button></div>${mediaEditor('choice', choice.id, choice.media, __apText('รูปของตัวเลือก'))}</div>`).join('')}</div><div class="qb-answer-footer"><button id="addChoice" class="qb-btn sm">+ เพิ่มตัวเลือก</button><span class="tiny muted">ใช้ข้อความ รูป หรือทั้งสองอย่างได้</span></div>`;
  }
  if (question.type === 'TRUE_FALSE') return __apHtml`<div class="qb-true-options"><label class="qb-true-card"><input type="radio" name="trueAnswer" value="true" ${config.correctAnswer === true ? 'checked' : ''}><span><strong>จริง</strong><small>ตั้ง “จริง” เป็นคำตอบที่ถูกต้อง</small></span></label><label class="qb-true-card"><input type="radio" name="trueAnswer" value="false" ${config.correctAnswer === false ? 'checked' : ''}><span><strong>เท็จ</strong><small>ตั้ง “เท็จ” เป็นคำตอบที่ถูกต้อง</small></span></label></div>`;
  if (question.type === 'SHORT_ANSWER') return __apHtml`<div class="qb-answer-hint">เพิ่มคำตอบที่ระบบยอมรับได้หลายรูปแบบ</div>${(config.acceptedAnswers || []).map((answer,index) => __apHtml`<div class="qb-accepted-row"><span class="qb-answer-number">${index+1}</span><input class="qb-input qb-inline-input" data-accepted-index="${index}" value="${esc(answer)}" placeholder="คำตอบที่ยอมรับ ${index+1}"><button class="qb-btn icon danger" data-remove-answer="${index}">×</button></div>`).join('')}<button id="addAccepted" class="qb-btn sm qb-add-answer">+ เพิ่มคำตอบที่ยอมรับ</button>`;
  if (question.type === 'ORDERING') return __apHtml`<div class="qb-answer-hint">เรียงรายการด้านล่างตามลำดับคำตอบที่ถูกต้อง</div>${(config.items || []).map((item,index) => __apHtml`<div class="qb-activity-card"><div class="qb-choice-row"><span class="qb-answer-number">${index+1}</span><input class="qb-input" data-ordering-text="${esc(item.id)}" value="${esc(item.text)}" placeholder="รายการ ${index+1}"><div class="qb-reorder"><button class="qb-btn icon sm" data-move-ordering="${esc(item.id)}" data-direction="-1" ${index === 0 ? 'disabled' : ''}>↑</button><button class="qb-btn icon sm" data-move-ordering="${esc(item.id)}" data-direction="1" ${index === (config.items || []).length - 1 ? 'disabled' : ''}>↓</button></div><button class="qb-btn icon danger" data-remove-ordering="${esc(item.id)}" ${(config.items || []).length <= 2 ? 'disabled' : ''}>×</button></div>${mediaEditor('ordering', item.id, item.media, __apText('รูปของรายการ'))}</div>`).join('')}<button id="addOrdering" class="qb-btn sm qb-add-answer">+ เพิ่มรายการ</button>`;
  if (question.type === 'MATCHING') return matchingAuthoringEditor(config);
  const targets = config.targets || [];
  return __apHtml`<div class="qb-answer-hint">สร้างพื้นที่วาง แล้วกำหนดปลายทางที่ถูกต้องให้แต่ละชิ้น หรือเลือก “ไม่มี” เพื่อสร้างตัวหลอก ใช้ปุ่ม ↑ ↓ เพื่อจัดลำดับที่ผู้ตอบเห็น</div><h4>พื้นที่วาง</h4>${targets.map((target,index) => __apHtml`<div class="qb-activity-card"><div class="qb-choice-row"><span class="qb-answer-number">${index+1}</span><input class="qb-input" data-target-label="${esc(target.id)}" value="${esc(target.label)}" placeholder="ชื่อพื้นที่วาง"><div class="qb-reorder"><button type="button" class="qb-btn icon sm" data-move-target="${esc(target.id)}" data-direction="-1" ${index===0?'disabled':''}>↑</button><button type="button" class="qb-btn icon sm" data-move-target="${esc(target.id)}" data-direction="1" ${index===targets.length-1?'disabled':''}>↓</button></div><button class="qb-btn icon danger" data-remove-target="${esc(target.id)}" ${targets.length <= 1 ? 'disabled' : ''}>×</button></div>${mediaEditor('drag-target', target.id, target.media, __apText('รูปพื้นที่วาง'))}</div>`).join('')}<button id="addTarget" class="qb-btn sm">+ เพิ่มพื้นที่วาง</button><h4>ชิ้นที่จะลาก</h4>${(config.tokens || []).map((token,index) => __apHtml`<div class="qb-activity-card"><div class="qb-drag-token"><span class="qb-answer-number">${index+1}</span><input class="qb-input" data-token-text="${esc(token.id)}" value="${esc(token.text)}" placeholder="ข้อความบนชิ้น"><select class="qb-select" data-token-target="${esc(token.id)}"><option value="" ${!token.targetId?'selected':''}>ไม่มีพื้นที่ที่ถูกต้อง (ตัวหลอก)</option>${targets.map(target => `<option value="${esc(target.id)}" ${token.targetId === target.id ? 'selected' : ''}>${esc(target.label || __apHtml`พื้นที่ ${targets.indexOf(target)+1}`)}</option>`).join('')}</select><div class="qb-reorder"><button type="button" class="qb-btn icon sm" data-move-token="${esc(token.id)}" data-direction="-1" ${index===0?'disabled':''}>↑</button><button type="button" class="qb-btn icon sm" data-move-token="${esc(token.id)}" data-direction="1" ${index===(config.tokens || []).length-1?'disabled':''}>↓</button></div><button class="qb-btn icon danger" data-remove-token="${esc(token.id)}">×</button></div>${mediaEditor('drag-token', token.id, token.media, __apText('รูปบนชิ้น'))}</div>`).join('')}<button id="addToken" class="qb-btn sm qb-add-answer">+ เพิ่มชิ้น</button>`;
}

function questionActions(question) {
  const archived = question.status === 'ARCHIVED';
  return __apHtml`<div class="qb-question-actions"><button id="duplicateCurrent" class="qb-btn sm">ทำสำเนา</button>${archived ? __apText('<button id="restoreQuestion" class="qb-btn good sm">นำกลับมาใช้</button>') : __apText('<button id="archiveQuestion" class="qb-btn sm">เก็บถาวร</button>')}<button id="requestDeleteQuestion" class="qb-btn danger sm">ลบคำถาม</button></div>`;
}
function editCanvas(question) {
  return __apHtml`<div class="qb-paper-kicker">${esc(TYPES[question.type])}</div><textarea id="qPrompt" class="qb-canvas-prompt" rows="2" placeholder="คลิกแล้วพิมพ์โจทย์คำถาม…">${esc(question.prompt)}</textarea><textarea id="qDescription" class="qb-canvas-description" rows="2" placeholder="เพิ่มบริบทหรือคำอธิบายโจทย์ (ไม่บังคับ)">${esc(question.description)}</textarea>${mediaEditor('question', '', question.media, __apText('ภาพประกอบคำถาม'))}<section class="qb-canvas-answers"><div class="qb-canvas-section-title">คำตอบและเฉลย</div>${answerEditor(question)}</section><section class="qb-canvas-explanation"><div class="qb-canvas-section-title">คำอธิบายเฉลย</div><textarea id="qExplanation" class="qb-textarea qb-explanation-input" placeholder="อธิบายเหตุผลหรือเนื้อหาที่ผู้เรียนควรรู้…">${esc(question.explanation)}</textarea></section><div class="qb-rapid-actions"><span class="small muted">บันทึกอัตโนมัติแล้วสร้างข้อต่อไปได้ทันที</span><button id="saveAndNextQuestion" class="qb-btn primary">บันทึกและสร้างข้อต่อไป →</button></div>`;
}
function testCanvas(question) {
  state.test = ensureQuestionActivityState(question, state.test);
  return renderQuestionActivity(question, state.test, { typeLabel: TYPES[question.type], note: __apText('โหมดทดลองตอบทำงานเฉพาะในหน้านี้ ไม่แก้เฉลยและไม่บันทึกผล') });
}
function canvasView() {
  const question = selectedQuestion();
  if (!question) return __apText('<main class="qb-question-canvas"><div class="qb-canvas-empty"><div class="qb-empty-illustration">?</div><h2>เลือกคำถามจากคลัง</h2><p>หรือสร้างคำถามใหม่เพื่อเริ่มเขียนบน Canvas</p><button id="emptyNewQuestion" class="qb-btn primary">+ สร้างคำถาม</button></div></main>');
  return __apHtml`<main class="qb-question-canvas"><header class="qb-canvas-toolbar"><button id="backToQuestionList" class="qb-btn icon qb-mobile-back" title="กลับรายการ">←</button><div class="qb-mode-switch" role="tablist"><button class="${state.mode === 'edit' ? 'active' : ''}" data-mode="edit">แก้ไข</button><button class="${state.mode === 'test' ? 'active' : ''}" data-mode="test">ทดลองตอบ</button></div><div class="grow"></div><button id="previousQuestion" class="qb-btn icon sm" title="คำถามก่อนหน้า">‹</button><button id="nextQuestion" class="qb-btn icon sm" title="คำถามถัดไป">›</button><button id="openMetadata" class="qb-btn sm">ข้อมูลคำถาม</button></header><div class="qb-canvas-scroll"><article class="qb-question-paper ${state.mode === 'test' ? 'test-mode' : 'edit-mode'}">${state.mode === 'edit' ? editCanvas(question) : testCanvas(question)}</article></div></main>`;
}
function inspectorView() {
  const question = selectedQuestion();
  if (!question) return '<aside class="qb-inspector"></aside>';
  const config = question.answerConfig || {}, archived = question.status === 'ARCHIVED';
  return __apHtml`<aside class="qb-inspector ${state.metadataOpen ? 'metadata-open' : ''}"><div class="qb-editor-head"><strong class="grow">ข้อมูลคำถาม</strong><button id="closeMetadata" class="qb-btn icon">×</button></div><div class="qb-editor-body"><section class="qb-editor-section"><h3>รูปแบบ</h3><div class="qb-field"><label>ประเภทคำถาม</label><select id="qType" class="qb-select" ${archived ? 'disabled' : ''}>${Object.entries(TYPES).map(([value,label]) => `<option value="${value}" ${question.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="qb-field"><label>ระดับความยาก</label><select id="qDifficulty" class="qb-select" ${archived ? 'disabled' : ''}>${DIFFICULTY.slice(1).map((label,index) => __apHtml`<option value="${index+1}" ${question.difficulty === index+1 ? 'selected' : ''}>ระดับ ${index+1} · ${label}</option>`).join('')}</select></div></section>${question.type === 'SHORT_ANSWER' ? __apHtml`<section class="qb-editor-section"><h3>การตรวจคำตอบสั้น</h3><label class="qb-check"><input id="caseSensitive" type="checkbox" ${config.caseSensitive ? 'checked' : ''}> แยกตัวพิมพ์เล็ก / ใหญ่</label><label class="qb-check"><input id="trimWhitespace" type="checkbox" ${config.trimWhitespace !== false ? 'checked' : ''}> ตัดช่องว่างหัวท้าย</label><label class="qb-check"><input id="normalizeUnicode" type="checkbox" ${config.normalizeUnicode !== false ? 'checked' : ''}> ปรับ Unicode เป็นรูปแบบเดียวกัน</label></section>` : ''}<section class="qb-editor-section"><h3>แท็ก</h3><div class="qb-editor-tags">${state.tags.length ? state.tags.map(tag => `<label class="qb-check"><input type="checkbox" data-question-tag="${esc(tag.id)}" ${question.tags.some(item => item.id === tag.id) ? 'checked' : ''}> ${esc(tag.groupName ? `${tag.groupName} · ` : '')}${esc(tag.name)}</label>`).join('') : __apText('<span class="tiny muted">สร้างแท็กจากคลังเพื่อจัดหมวดหมู่</span>')}</div></section><section class="qb-editor-section qb-internal"><h3>ข้อมูลภายในทีม</h3><div class="qb-internal-note">ไม่ส่งไปกับข้อมูลคำถามสำหรับผู้เรียน</div><div class="qb-field"><label>บันทึกภายใน</label><textarea id="qInternalNotes" class="qb-textarea">${esc(question.internalNotes)}</textarea></div><div class="qb-field"><label>แหล่งที่มา / อ้างอิง</label><input id="qSource" class="qb-input" value="${esc(question.sourceReference)}" placeholder="เช่น Minna no Nihongo บทที่ 4"></div></section><section class="qb-editor-section"><h3>ความพร้อมใช้งาน</h3><div class="qb-status ${question.status.toLowerCase()}">${statusLabel(question.status)}</div>${readinessHtml(question)}</section>${questionActions(question)}</div></aside>`;
}

function captureStudioView() {
  const active = document.activeElement;
  return { library: document.querySelector('.qb-question-scroll')?.scrollTop || 0, canvas: document.querySelector('.qb-canvas-scroll')?.scrollTop || 0, inspector: document.querySelector('.qb-inspector')?.scrollTop || 0, focusId: active?.id || '', focusChoice: active?.dataset?.choiceText || '', focusAnswer: active?.dataset?.acceptedIndex ?? '', selectionStart: typeof active?.selectionStart === 'number' ? active.selectionStart : null };
}
function restoreStudioView(snapshot) {
  if (snapshot) {
    const list = document.querySelector('.qb-question-scroll'), canvas = document.querySelector('.qb-canvas-scroll'), inspector = document.querySelector('.qb-inspector');
    if (list) list.scrollTop = snapshot.library; if (canvas) canvas.scrollTop = snapshot.canvas; if (inspector) inspector.scrollTop = snapshot.inspector;
  }
  let target = null;
  if (state.pendingFocus?.kind === 'choice') target = document.querySelector(`[data-choice-text="${state.pendingFocus.value}"]`);
  else if (state.pendingFocus?.kind === 'answer') target = document.querySelector(`[data-accepted-index="${state.pendingFocus.value}"]`);
  else if (state.pendingFocus?.selector) target = document.querySelector(state.pendingFocus.selector);
  else if (snapshot?.focusChoice) target = document.querySelector(`[data-choice-text="${snapshot.focusChoice}"]`);
  else if (snapshot?.focusAnswer !== '') target = document.querySelector(`[data-accepted-index="${snapshot.focusAnswer}"]`);
  else if (snapshot?.focusId) target = document.getElementById(snapshot.focusId);
  state.pendingFocus = null;
  if (target && !target.disabled) { target.focus({ preventScroll: true }); if (typeof target.setSelectionRange === 'function') { const position = snapshot?.selectionStart ?? target.value.length; target.setSelectionRange(Math.min(position,target.value.length),Math.min(position,target.value.length)); } target.scrollIntoView({ block: 'nearest' }); }
}
function renderStudio({ preserve = true } = {}) {
  if (!state.bank) { renderBanks(); return; }
  const snapshot = preserve ? captureStudioView() : null;
  app.innerHTML = __apHtml`${topbar()}<section class="qb-studio"><header class="qb-studio-head"><button id="backBanks" class="qb-btn sm">← คลัง</button><div class="qb-studio-title"><h1>${esc(state.bank.name)}</h1><div class="tiny muted qb-bank-description">สตูดิโอคำถาม · ทั้งหมด ${Number(state.bank.question_count || state.total).toLocaleString()} ข้อ</div></div><div class="grow"></div><button id="exportCurrentBank" class="qb-btn">ส่งออก</button><button id="importCurrentBank" class="qb-btn" ${state.bank.status !== 'ACTIVE' ? 'disabled' : ''}>นำเข้าเพิ่ม</button><button id="newQuestion" class="qb-btn primary" ${state.bank.status !== 'ACTIVE' ? 'disabled' : ''}>+ คำถามใหม่</button></header><div class="qb-studio-body ${state.selectedId ? 'has-selection' : ''}">${libraryView()}${canvasView()}${inspectorView()}</div></section>`;
  bindNav(); bindStudio(); localizeStudio();
  requestAnimationFrame(() => restoreStudioView(snapshot));
}

function bindStudio() {
  document.querySelector('#backBanks').onclick = async () => { if (!(await flushSave())) { toast(__apText('ยังออกจากคลังไม่ได้ เพราะมีข้อมูลที่บันทึกไม่สำเร็จ')); return; } state.bank = null; state.selectedId = null; history.replaceState({}, '', '/question-banks.html'); loadBanks(); };
  document.querySelector('#newQuestion').onclick = createQuestion;
  document.querySelector('#exportCurrentBank')?.addEventListener('click', () => exportBank(state.bank.id));
  document.querySelector('#importCurrentBank')?.addEventListener('click', choosePackageFile);
  document.querySelector('#emptyNewQuestion')?.addEventListener('click', createQuestion);
  document.querySelector('#qbSaveState')?.addEventListener('click', () => saveQuestion().catch(() => {}));
  document.querySelectorAll('[data-filter]').forEach(element => element.onchange = async () => { const previous = state.filters[element.dataset.filter]; state.filters[element.dataset.filter] = element.value; if (!(await flushSave())) { state.filters[element.dataset.filter] = previous; renderStudio(); return; } state.selection.clear(); loadQuestions(); });
  const search = document.querySelector('#questionSearch'); if (search) search.oninput = () => { state.filters.search = search.value; clearTimeout(state.searchTimer); state.searchTimer = setTimeout(async () => { if (await flushSave()) loadQuestions(false); }, 320); };
  document.querySelectorAll('[data-select-question]').forEach(card => card.onclick = event => { if (event.target.closest('button,input')) return; selectQuestion(card.dataset.selectQuestion); });
  document.querySelectorAll('[data-question-check]').forEach(box => box.onchange = event => { event.stopPropagation(); if (box.checked) state.selection.add(box.dataset.questionCheck); else state.selection.delete(box.dataset.questionCheck); renderStudio(); });
  document.querySelectorAll('[data-duplicate-question]').forEach(button => button.onclick = event => { event.stopPropagation(); duplicateQuestion(button.dataset.duplicateQuestion); });
  const clear = document.querySelector('#clearSelection'); if (clear) clear.onclick = () => { state.selection.clear(); renderStudio(); };
  document.querySelector('#clearSelectionTop')?.addEventListener('click', () => { state.selection.clear(); renderStudio(); });
  document.querySelector('#selectAllQuestions')?.addEventListener('click', () => { state.questions.forEach(question => state.selection.add(question.id)); renderStudio(); });
  const loadMore = document.querySelector('#loadMoreQuestions'); if (loadMore) loadMore.onclick = () => loadQuestions(true, true);
  const runBulk = document.querySelector('#runBulk'); if (runBulk) runBulk.onclick = runBulkAction;
  document.querySelector('#bulkAction')?.addEventListener('change', event => { state.bulk.action = event.target.value; state.bulk.tagId = ''; renderStudio(); });
  document.querySelector('#bulkTag')?.addEventListener('change', event => { state.bulk.tagId = event.target.value; });
  document.querySelector('#bulkDifficulty')?.addEventListener('change', event => { state.bulk.difficulty = event.target.value; });
  const createTagButton = document.querySelector('#createTag'); if (createTagButton) createTagButton.onclick = createTag;
  document.querySelectorAll('[data-rename-tag]').forEach(button => button.onclick = () => editTag(button.dataset.renameTag));
  document.querySelectorAll('[data-delete-tag]').forEach(button => button.onclick = () => deleteTag(button.dataset.deleteTag));
  document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => { state.mode = button.dataset.mode; renderStudio(); });
  document.querySelector('#openMetadata')?.addEventListener('click', () => { state.metadataOpen = true; renderStudio(); });
  document.querySelector('#closeMetadata')?.addEventListener('click', () => { state.metadataOpen = false; renderStudio(); });
  document.querySelector('#backToQuestionList')?.addEventListener('click', async () => { if (!(await flushSave())) { toast(__apText('ยังกลับรายการไม่ได้ เพราะคำถามนี้บันทึกไม่สำเร็จ')); return; } state.selectedId = null; state.metadataOpen = false; renderStudio(); });
  const index = state.questions.findIndex(question => question.id === state.selectedId);
  const previous = document.querySelector('#previousQuestion'), next = document.querySelector('#nextQuestion');
  if (previous) { previous.disabled = index <= 0; previous.onclick = () => index > 0 && selectQuestion(state.questions[index - 1].id); }
  if (next) { next.disabled = index < 0 || index >= state.questions.length - 1; next.onclick = () => index >= 0 && index < state.questions.length - 1 && selectQuestion(state.questions[index + 1].id); }
  bindEditor();
  bindTestMode();
}

async function selectQuestion(questionId) {
  if (questionId === state.selectedId) return;
  if (!(await flushSave())) { toast(__apText('ยังสลับคำถามไม่ได้ เพราะคำถามปัจจุบันบันทึกไม่สำเร็จ')); return; }
  state.selectedId = questionId; state.metadataOpen = false; state.test.questionId = null; renderStudio();
}
function defaultConfig(type) {
  if (type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE') return { choices: [{id:uid('choice'),text:'',media:null},{id:uid('choice'),text:'',media:null}], correctIds: [] };
  if (type === 'TRUE_FALSE') return { correctAnswer: null };
  if (type === 'ORDERING') { const items = [{id:uid('order'),text:'',media:null},{id:uid('order'),text:'',media:null}]; return { items, correctOrder: items.map(item => item.id) }; }
  if (type === 'MATCHING') { const pairs = [1,2].map(() => ({ id:uid('pair'), leftId:uid('left'), rightId:uid('right'), leftText:'', rightText:'', leftMedia:null, rightMedia:null })); return { pairs, rightDistractors:[], leftOrder:pairs.map(pair=>pair.leftId), rightOrder:pairs.map(pair=>pair.rightId).reverse() }; }
  if (type === 'DRAG_DROP') { const targetId = uid('target'); return { targets:[{id:targetId,label:'',media:null}], tokens:[{id:uid('token'),text:'',media:null,targetId:''}] }; }
  return { acceptedAnswers: [], caseSensitive: false, trimWhitespace: true, normalizeUnicode: true };
}
async function createQuestion() {
  try {
    if (!(await flushSave())) { toast(__apText('ยังสร้างคำถามใหม่ไม่ได้ เพราะคำถามปัจจุบันบันทึกไม่สำเร็จ')); return; }
    const data = await api(`/api/admin/question-banks/${encodeURIComponent(state.bank.id)}/questions`, { method: 'POST', body: JSON.stringify({ type: 'SINGLE_CHOICE' }) });
    state.questions.unshift(data.question); state.total += 1; state.bank.question_count = Number(state.bank.question_count || 0) + 1; state.selectedId = data.question.id; state.mode = 'edit'; state.metadataOpen = false; state.pendingFocus = { selector: '#qPrompt' }; renderStudio({ preserve: false });
  } catch (error) { toast(error.message, 4200); }
}

function updateReadinessLocal(question) {
  const errors = [];
  if (!question.prompt.trim()) errors.push(__apText('กรุณาใส่คำถาม'));
  const config = question.answerConfig || {};
  if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') {
    const choices = (config.choices || []).filter(choice => choice.text.trim() || choice.media?.path), valid = new Set(choices.map(choice => choice.id));
    if (choices.length < 2) errors.push(__apText('ต้องมีตัวเลือกที่มีข้อความหรือรูปอย่างน้อย 2 ตัวเลือก'));
    const correct = (config.correctIds || []).filter(id => valid.has(id));
    if (!correct.length) errors.push(question.type === 'SINGLE_CHOICE' ? __apText('กรุณาเลือกคำตอบที่ถูกต้อง') : __apText('กรุณาเลือกคำตอบที่ถูกต้องอย่างน้อยหนึ่งข้อ'));
  } else if (question.type === 'TRUE_FALSE' && typeof config.correctAnswer !== 'boolean') errors.push(__apText('กรุณาเลือก “จริง” หรือ “เท็จ” เป็นคำตอบที่ถูกต้อง'));
  else if (question.type === 'SHORT_ANSWER' && !(config.acceptedAnswers || []).some(value => value.trim())) errors.push(__apText('กรุณาใส่คำตอบที่ยอมรับอย่างน้อยหนึ่งค่า'));
  else if (question.type === 'ORDERING') { const items = config.items || []; if (items.length < 2 || items.some(item => !item.text.trim() && !item.media?.path)) errors.push(__apText('กรอกรายการเรียงลำดับให้ครบอย่างน้อย 2 รายการ')); }
  else if (question.type === 'MATCHING') { const pairs = config.pairs || [], distractors = config.rightDistractors || []; if (pairs.length < 2 || pairs.some(pair => (!pair.leftText.trim() && !pair.leftMedia?.path) || (!pair.rightText.trim() && !pair.rightMedia?.path))) errors.push(__apText('กรอกคู่ทั้งสองฝั่งให้ครบอย่างน้อย 2 คู่')); if (distractors.some(item => !item.rightText.trim() && !item.rightMedia?.path)) errors.push(__apText('กรอกตัวหลอกฝั่งขวาให้ครบ หรือเอารายการที่ว่างออก')); }
  else if (question.type === 'DRAG_DROP') { const targets = config.targets || [], tokens = config.tokens || [], ids = new Set(targets.map(target => target.id)); if (!targets.length || targets.some(target => !target.label.trim() && !target.media?.path)) errors.push(__apText('กรอกพื้นที่วางอย่างน้อย 1 จุด')); if (!tokens.length || tokens.some(token => (!token.text.trim() && !token.media?.path) || (token.targetId && !ids.has(token.targetId)))) errors.push(__apText('กรอกชิ้นที่จะลากและพื้นที่วางให้ถูกต้อง')); if (tokens.length && !tokens.some(token => token.targetId)) errors.push(__apText('ต้องมีชิ้นคำตอบที่วางลงพื้นที่อย่างน้อย 1 ชิ้น')); }
  question.readiness = { valid: errors.length === 0, errors };
  if (question.status !== 'ARCHIVED') question.status = question.readiness.valid ? 'READY' : 'DRAFT';
}
function queueSave(renderReadiness = false, invalidatesReady = false) {
  const question = selectedQuestion(); if (!question || question.status === 'ARCHIVED') return;
  if (state.bank.status !== 'ACTIVE') return;
  updateReadinessLocal(question); state.editRevision += 1; state.saveState = 'saving'; updateSaveBadge();
  const statusNode = document.querySelector('.qb-inspector .qb-status'); if (statusNode) { statusNode.className = `qb-status ${question.status.toLowerCase()}`; statusNode.textContent = statusLabel(question.status); }
  if (renderReadiness) { const node = document.querySelector('.qb-readiness'); if (node) node.outerHTML = readinessHtml(question); }
  clearTimeout(state.saveTimer); state.saveTimer = setTimeout(() => saveQuestion(), 750);
}
function updateSaveBadge() {
  const badge = document.querySelector('#qbSaveState'); if (!badge) return;
  badge.className = `qb-save-state ${state.saveState}`; badge.textContent = state.saveState === 'saving' ? __apText('กำลังบันทึก…') : state.saveState === 'error' ? __apText('บันทึกไม่สำเร็จ · ลองอีกครั้ง') : __apText('บันทึกแล้ว');
  badge.disabled = state.saveState !== 'error'; badge.title = state.saveState === 'error' ? __apText('คลิกเพื่อลองบันทึกอีกครั้ง') : '';
}
function questionPayload(question) { return { type: question.type, prompt: question.prompt, description: question.description, difficulty: question.difficulty, status: question.status, answerConfig: question.answerConfig, media: question.media || null, explanation: question.explanation, internalNotes: question.internalNotes, sourceReference: question.sourceReference, tagIds: question.tags.map(tag => tag.id), baseUpdatedAt: question.updatedAt }; }
async function saveQuestion(forceStatus = null) {
  if (state.savePromise) {
    try { await state.savePromise; } catch {}
    if (forceStatus || state.saveTimer) return saveQuestion(forceStatus);
    return selectedQuestion();
  }
  clearTimeout(state.saveTimer); state.saveTimer = null;
  const question = selectedQuestion(); if (!question || (question.status === 'ARCHIVED' && forceStatus == null)) return;
  const revision = state.editRevision, previousStatus = question.status;
  if (forceStatus) question.status = forceStatus;
  state.saveState = 'saving'; updateSaveBadge();
  try {
    state.savePromise = api(`/api/admin/question-banks/${encodeURIComponent(state.bank.id)}/questions/${encodeURIComponent(question.id)}`, { method: 'PATCH', body: JSON.stringify(questionPayload(question)) });
    const data = await state.savePromise;
    if (revision === state.editRevision) Object.assign(question, data.question);
    else question.updatedAt = data.question.updatedAt;
    state.saveState = revision === state.editRevision ? 'saved' : 'saving'; updateSaveBadge();
    if (revision !== state.editRevision) { clearTimeout(state.saveTimer); state.saveTimer = setTimeout(() => saveQuestion(), 500); }
    return data.question;
  } catch (error) {
    if (forceStatus) question.status = previousStatus;
    if (error.status === 422 && error.data?.readiness) { question.readiness = error.data.readiness; state.saveState = 'saved'; toast(error.data.readiness.errors.join(' · '), 5000); renderStudio(); }
    else { state.saveState = 'error'; updateSaveBadge(); toast(__apHtml`บันทึกไม่สำเร็จ: ${error.message}`, 4500); }
    throw error;
  } finally { state.savePromise = null; }
}
async function flushSave() {
  try {
    if (state.saveTimer) await saveQuestion();
    else if (state.savePromise) { await state.savePromise; if (state.saveTimer) await saveQuestion(); }
    return state.saveState !== 'error';
  } catch { return false; }
}

function bindEditor() {
  const question = selectedQuestion(); if (!question) return;
  const locked = state.bank.status !== 'ACTIVE' || question.status === 'ARCHIVED';
  const text = (selector, field, invalidatesReady = false) => { const element = document.querySelector(selector); if (element) element.oninput = () => { question[field] = element.value; queueSave(true, invalidatesReady); }; };
  text('#qPrompt','prompt',true); text('#qDescription','description',true); text('#qExplanation','explanation',true); text('#qInternalNotes','internalNotes'); text('#qSource','sourceReference');
  const type = document.querySelector('#qType'); if (type) type.onchange = () => { question.type = type.value; question.answerConfig = defaultConfig(type.value); state.pendingFocus = { selector: '#qType' }; queueSave(false, true); renderStudio(); };
  const difficulty = document.querySelector('#qDifficulty'); if (difficulty) difficulty.onchange = () => { question.difficulty = Number(difficulty.value); queueSave(); };
  document.querySelectorAll('[data-choice-text]').forEach(input => input.oninput = () => { const choice = question.answerConfig.choices.find(item => item.id === input.dataset.choiceText); if (choice) choice.text = input.value; queueSave(true, true); });
  document.querySelectorAll('[data-correct-choice]').forEach(input => input.onchange = () => { const id = input.dataset.correctChoice; if (question.type === 'SINGLE_CHOICE') question.answerConfig.correctIds = [id]; else if (input.checked) question.answerConfig.correctIds = [...new Set([...(question.answerConfig.correctIds || []), id])]; else question.answerConfig.correctIds = (question.answerConfig.correctIds || []).filter(value => value !== id); queueSave(true, true); });
  const addChoice = document.querySelector('#addChoice'); if (addChoice) addChoice.onclick = () => { const choice = { id: uid('choice'), text: '', media: null }; question.answerConfig.choices.push(choice); state.pendingFocus = { kind: 'choice', value: choice.id }; queueSave(false, true); renderStudio(); };
  document.querySelectorAll('[data-remove-choice]').forEach(button => button.onclick = () => { const id = button.dataset.removeChoice, index = question.answerConfig.choices.findIndex(choice => choice.id === id); question.answerConfig.choices = question.answerConfig.choices.filter(choice => choice.id !== id); question.answerConfig.correctIds = (question.answerConfig.correctIds || []).filter(value => value !== id); const neighbor = question.answerConfig.choices[Math.min(index,question.answerConfig.choices.length - 1)]; state.pendingFocus = neighbor ? { kind: 'choice', value: neighbor.id } : { selector: '#addChoice' }; queueSave(false, true); renderStudio(); });
  document.querySelectorAll('[data-move-choice]').forEach(button => button.onclick = () => { const id = button.dataset.moveChoice, from = question.answerConfig.choices.findIndex(choice => choice.id === id), to = from + Number(button.dataset.direction); if (from < 0 || to < 0 || to >= question.answerConfig.choices.length) return; const [choice] = question.answerConfig.choices.splice(from,1); question.answerConfig.choices.splice(to,0,choice); state.pendingFocus = { kind: 'choice', value: id }; queueSave(false, true); renderStudio(); });
  document.querySelectorAll('input[name="trueAnswer"]').forEach(input => input.onchange = () => { question.answerConfig.correctAnswer = input.value === 'true'; queueSave(true, true); });
  document.querySelectorAll('[data-accepted-index]').forEach(input => input.oninput = () => { question.answerConfig.acceptedAnswers[Number(input.dataset.acceptedIndex)] = input.value; queueSave(true, true); });
  const addAccepted = document.querySelector('#addAccepted'); if (addAccepted) addAccepted.onclick = () => { const index = question.answerConfig.acceptedAnswers.length; question.answerConfig.acceptedAnswers.push(''); state.pendingFocus = { kind: 'answer', value: index }; queueSave(false, true); renderStudio(); };
  document.querySelectorAll('[data-remove-answer]').forEach(button => button.onclick = () => { const index = Number(button.dataset.removeAnswer); question.answerConfig.acceptedAnswers.splice(index,1); state.pendingFocus = question.answerConfig.acceptedAnswers.length ? { kind: 'answer', value: Math.min(index,question.answerConfig.acceptedAnswers.length - 1) } : { selector: '#addAccepted' }; queueSave(false, true); renderStudio(); });
  for (const [selector,key] of [['#caseSensitive','caseSensitive'],['#trimWhitespace','trimWhitespace'],['#normalizeUnicode','normalizeUnicode']]) { const input = document.querySelector(selector); if (input) input.onchange = () => { question.answerConfig[key] = input.checked; queueSave(false, true); }; }
  document.querySelectorAll('[data-ordering-text]').forEach(input => input.oninput = () => { const item = question.answerConfig.items.find(value => value.id === input.dataset.orderingText); if (item) item.text = input.value; queueSave(true); });
  document.querySelectorAll('[data-move-ordering]').forEach(button => button.onclick = () => { const items = question.answerConfig.items, from = items.findIndex(item => item.id === button.dataset.moveOrdering), to = from + Number(button.dataset.direction); if (from < 0 || to < 0 || to >= items.length) return; const [item] = items.splice(from,1); items.splice(to,0,item); question.answerConfig.correctOrder = items.map(value => value.id); queueSave(true); renderStudio(); });
  document.querySelectorAll('[data-remove-ordering]').forEach(button => button.onclick = () => { question.answerConfig.items = question.answerConfig.items.filter(item => item.id !== button.dataset.removeOrdering); question.answerConfig.correctOrder = question.answerConfig.items.map(item => item.id); queueSave(true); renderStudio(); });
  document.querySelector('#addOrdering')?.addEventListener('click', () => { const item = { id:uid('order'), text:'', media:null }; question.answerConfig.items.push(item); question.answerConfig.correctOrder = question.answerConfig.items.map(value => value.id); queueSave(true); renderStudio(); });
  document.querySelectorAll('[data-match-left]').forEach(input => input.oninput = () => { const pair = question.answerConfig.pairs.find(value => value.id === input.dataset.matchLeft); if (pair) pair.leftText = input.value; queueSave(true); });
  document.querySelectorAll('[data-match-right]').forEach(input => input.oninput = () => { const pair = question.answerConfig.pairs.find(value => value.id === input.dataset.matchRight); if (pair) pair.rightText = input.value; queueSave(true); });
  document.querySelectorAll('[data-remove-pair]').forEach(button => button.onclick = () => { question.answerConfig.pairs = question.answerConfig.pairs.filter(pair => pair.id !== button.dataset.removePair); const view = matchingDisplay(question.answerConfig); question.answerConfig.leftOrder = view.leftOrder; question.answerConfig.rightOrder = view.rightOrder; queueSave(true); renderStudio(); });
  document.querySelector('#addPair')?.addEventListener('click', () => { const before = matchingDisplay(question.answerConfig), pair = { id:uid('pair'), leftId:uid('left'), rightId:uid('right'), leftText:'', rightText:'', leftMedia:null, rightMedia:null }; question.answerConfig.pairs.push(pair); question.answerConfig.leftOrder = [...before.leftOrder,pair.leftId]; question.answerConfig.rightOrder = [...before.rightOrder,pair.rightId]; queueSave(true); renderStudio(); });
  document.querySelectorAll('[data-match-distractor-text]').forEach(input => input.oninput = () => { const item = (question.answerConfig.rightDistractors || []).find(value => value.id === input.dataset.matchDistractorText); if (item) item.rightText = input.value; queueSave(true); });
  document.querySelector('#addMatchDistractor')?.addEventListener('click', () => { const before = matchingDisplay(question.answerConfig), item = { id:uid('distractor'), rightId:uid('right'), rightText:'', rightMedia:null }; question.answerConfig.rightDistractors = [...(question.answerConfig.rightDistractors || []),item]; question.answerConfig.leftOrder = before.leftOrder; question.answerConfig.rightOrder = [...before.rightOrder,item.rightId]; queueSave(true); renderStudio(); });
  document.querySelectorAll('[data-remove-match-distractor]').forEach(button => button.onclick = () => { question.answerConfig.rightDistractors = (question.answerConfig.rightDistractors || []).filter(item => item.id !== button.dataset.removeMatchDistractor); const view = matchingDisplay(question.answerConfig); question.answerConfig.leftOrder = view.leftOrder; question.answerConfig.rightOrder = view.rightOrder; queueSave(true); renderStudio(); });
  document.querySelectorAll('[data-move-match-display]').forEach(button => button.onclick = () => { const view = matchingDisplay(question.answerConfig), key = button.dataset.matchSide === 'left' ? 'leftOrder' : 'rightOrder', order = [...view[key]], from = order.indexOf(button.dataset.moveMatchDisplay), to = from + Number(button.dataset.direction); if (from < 0 || to < 0 || to >= order.length) return; [order[from],order[to]] = [order[to],order[from]]; question.answerConfig[key] = order; queueSave(true); renderStudio(); });
  document.querySelectorAll('[data-target-label]').forEach(input => input.oninput = () => { const target = question.answerConfig.targets.find(value => value.id === input.dataset.targetLabel); if (target) target.label = input.value; queueSave(true); });
  document.querySelectorAll('[data-move-target]').forEach(button => button.onclick = () => { const items = question.answerConfig.targets, from = items.findIndex(item => item.id === button.dataset.moveTarget), to = from + Number(button.dataset.direction); if (from < 0 || to < 0 || to >= items.length) return; const [item] = items.splice(from,1); items.splice(to,0,item); queueSave(true); renderStudio(); });
  document.querySelectorAll('[data-remove-target]').forEach(button => button.onclick = () => { const id = button.dataset.removeTarget; question.answerConfig.targets = question.answerConfig.targets.filter(target => target.id !== id); question.answerConfig.tokens.forEach(token => { if (token.targetId === id) token.targetId = ''; }); queueSave(true); renderStudio(); });
  document.querySelector('#addTarget')?.addEventListener('click', () => { question.answerConfig.targets.push({id:uid('target'),label:'',media:null}); queueSave(true); renderStudio(); });
  document.querySelectorAll('[data-token-text]').forEach(input => input.oninput = () => { const token = question.answerConfig.tokens.find(value => value.id === input.dataset.tokenText); if (token) token.text = input.value; queueSave(true); });
  document.querySelectorAll('[data-move-token]').forEach(button => button.onclick = () => { const items = question.answerConfig.tokens, from = items.findIndex(item => item.id === button.dataset.moveToken), to = from + Number(button.dataset.direction); if (from < 0 || to < 0 || to >= items.length) return; const [item] = items.splice(from,1); items.splice(to,0,item); queueSave(true); renderStudio(); });
  document.querySelectorAll('[data-token-target]').forEach(select => select.onchange = () => { const token = question.answerConfig.tokens.find(value => value.id === select.dataset.tokenTarget); if (token) token.targetId = select.value; queueSave(true); });
  document.querySelectorAll('[data-remove-token]').forEach(button => button.onclick = () => { question.answerConfig.tokens = question.answerConfig.tokens.filter(token => token.id !== button.dataset.removeToken); queueSave(true); renderStudio(); });
  document.querySelector('#addToken')?.addEventListener('click', () => { question.answerConfig.tokens.push({id:uid('token'),text:'',media:null,targetId:''}); queueSave(true); renderStudio(); });
  document.querySelectorAll('[data-open-media]').forEach(button => button.onclick = () => openMediaPicker(button.dataset.openMedia, button.dataset.mediaId, button.dataset.mediaLabel));
  document.querySelectorAll('[data-question-tag]').forEach(input => input.onchange = () => { const tag = state.tags.find(item => item.id === input.dataset.questionTag); if (!tag) return; if (input.checked) question.tags.push({ id: tag.id, name: tag.name, groupName: tag.groupName }); else question.tags = question.tags.filter(item => item.id !== tag.id); queueSave(); });
  document.querySelector('#saveAndNextQuestion')?.addEventListener('click', createQuestion);
  const duplicate = document.querySelector('#duplicateCurrent'); if (duplicate) duplicate.onclick = () => duplicateQuestion(question.id);
  document.querySelector('#archiveQuestion')?.addEventListener('click', () => changeQuestionStatus('ARCHIVED'));
  document.querySelector('#restoreQuestion')?.addEventListener('click', () => changeQuestionStatus('DRAFT'));
  document.querySelector('#requestDeleteQuestion')?.addEventListener('click', requestDeleteQuestion);
  if (state.bank.status !== 'ACTIVE') document.querySelectorAll('.qb-question-paper.edit-mode input,.qb-question-paper.edit-mode textarea,.qb-question-paper.edit-mode button,.qb-inspector input,.qb-inspector textarea,.qb-inspector select,.qb-inspector button').forEach(element => { element.disabled = true; });
  else if (locked) document.querySelectorAll('.qb-question-paper.edit-mode input,.qb-question-paper.edit-mode textarea,.qb-question-paper.edit-mode button,.qb-inspector input,.qb-inspector textarea,.qb-inspector select').forEach(element => { if (element.id !== 'qStatus') element.disabled = true; });
}

function bindTestMode() {
  const question = selectedQuestion(); if (!question || state.mode !== 'test') return;
  bindQuestionActivity(document, question, state.test, { rerender: renderStudio });
}

async function duplicateQuestion(questionId) {
  try { if (!(await flushSave())) { toast(__apText('ยังทำสำเนาไม่ได้ เพราะคำถามปัจจุบันบันทึกไม่สำเร็จ')); return; } const data = await api(`/api/admin/question-banks/${encodeURIComponent(state.bank.id)}/questions/${encodeURIComponent(questionId)}/duplicate`, { method: 'POST', body: '{}' }); state.questions.unshift(data.question); state.total += 1; state.bank.question_count = Number(state.bank.question_count || 0) + 1; state.selectedId = data.question.id; state.mode = 'edit'; state.pendingFocus = { selector: '#qPrompt' }; renderStudio(); toast(__apText('สร้างสำเนาเป็นฉบับร่างใหม่แล้ว')); }
  catch (error) { toast(error.message, 4300); }
}
async function changeQuestionStatus(next, selectElement = null, options = {}) {
  const question = selectedQuestion(); if (!question || next === question.status) return;
  if (next === 'ARCHIVED' && !options.skipConfirm && !confirm(__apText('เก็บคำถามนี้ไว้ในคลังถาวรหรือไม่? ยังเปิดดูและนำกลับมาใช้ได้ภายหลัง'))) { if (selectElement) selectElement.value = question.status; return; }
  try { if (!(await flushSave())) { if (selectElement) selectElement.value = question.status; return; } await saveQuestion(next); if (options.showArchived) state.filters.status = 'ARCHIVED'; await loadQuestions(false); toast(next === 'READY' ? __apText('คำถามพร้อมใช้งานแล้ว') : next === 'ARCHIVED' ? __apText('เก็บคำถามไว้ในคลังถาวรแล้ว') : __apText('นำคำถามกลับมาเป็นฉบับร่างแล้ว')); }
  catch { if (selectElement) selectElement.value = question.status; }
}
function requestDeleteQuestion() {
  const question = selectedQuestion(); if (!question) return;
  if (question.status === 'ARCHIVED') { deleteQuestion(); return; }
  document.body.insertAdjacentHTML('beforeend', __apHtml`<div class="qb-modal-bg" id="deleteFlow"><div class="qb-modal qb-confirm-dialog"><h2>ต้องเก็บคำถามก่อนจึงจะลบได้</h2><p>เพื่อป้องกันการลบโดยไม่ตั้งใจ ระบบกำหนดให้คำถามที่กำลังใช้งานต้องเข้าสถานะ “เก็บถาวร” ก่อน แล้วจึงลบได้</p><div class="qb-dialog-actions"><button id="cancelDeleteFlow" class="qb-btn">ยกเลิก</button><button id="archiveFromDelete" class="qb-btn danger">เก็บคำถามนี้ไว้ก่อน</button></div></div></div>`);
  document.querySelector('#cancelDeleteFlow').onclick = () => document.querySelector('#deleteFlow')?.remove();
  document.querySelector('#archiveFromDelete').onclick = () => { document.querySelector('#deleteFlow')?.remove(); changeQuestionStatus('ARCHIVED', null, { skipConfirm: true, showArchived: true }); };
}
async function deleteQuestion() {
  const question = selectedQuestion(); if (!question || question.status !== 'ARCHIVED' || !confirm(__apText('ลบคำถามที่เก็บถาวรนี้อย่างถาวรหรือไม่? การลบย้อนกลับไม่ได้'))) return;
  try { await api(`/api/admin/question-banks/${encodeURIComponent(state.bank.id)}/questions/${encodeURIComponent(question.id)}`, { method: 'DELETE', body: '{}' }); state.selectedId = null; state.bank.question_count = Math.max(0, Number(state.bank.question_count || 1) - 1); await loadQuestions(false); toast(__apText('ลบคำถามแล้ว')); }
  catch (error) { toast(error.message, 4200); }
}

async function createTag() {
  const name = prompt(__apText('ชื่อ Tag')); if (!name?.trim()) return; const groupName = prompt(__apText('Group / Category (ไม่บังคับ)'), '') ?? '';
  try { const data = await api(`/api/admin/question-banks/${encodeURIComponent(state.bank.id)}/tags`, { method: 'POST', body: JSON.stringify({ name, groupName }) }); state.tags.push(data.tag); renderStudio(); }
  catch (error) { toast(error.message, 4200); }
}
async function editTag(tagId) {
  const tag = state.tags.find(item => item.id === tagId); if (!tag) return;
  const name = prompt(__apText('ชื่อ Tag'), tag.name); if (!name?.trim()) return;
  const groupName = prompt(__apText('Group / Category (เว้นว่างได้)'), tag.groupName || ''); if (groupName == null) return;
  try { if (!(await flushSave())) return; const data = await api(`/api/admin/question-banks/${encodeURIComponent(state.bank.id)}/tags/${encodeURIComponent(tagId)}`, { method: 'PATCH', body: JSON.stringify({ name, groupName }) }); Object.assign(tag, data.tag); await loadQuestions(false); }
  catch (error) { toast(error.message, 4200); }
}
async function deleteTag(tagId) {
  const tag = state.tags.find(item => item.id === tagId); if (!tag) return;
  if (!confirm(__apHtml`ลบแท็ก “${tag.groupName ? `${tag.groupName} / ` : ''}${tag.name}” หรือไม่?\nคำถาม ${tag.usageCount || 0} ข้อจะยังอยู่ครบ เพียงนำแท็กนี้ออก`)) return;
  try { if (!(await flushSave())) return; await api(`/api/admin/question-banks/${encodeURIComponent(state.bank.id)}/tags/${encodeURIComponent(tagId)}`, { method:'DELETE', body:'{}' }); state.tags = state.tags.filter(item => item.id !== tagId); state.questions.forEach(question => { question.tags = (question.tags || []).filter(item => item.id !== tagId); }); renderStudio(); toast(__apText('ลบแท็กแล้ว · คำถามยังอยู่ครบ')); }
  catch (error) { toast(error.message, 4200); }
}

async function runBulkAction() {
  const action = state.bulk.action; if (!action) return;
  const payload = { action, questionIds: [...state.selection] };
  if (action === 'archive' && !confirm(__apHtml`เก็บคำถาม ${state.selection.size} ข้อไว้ในคลังถาวรหรือไม่?`)) return;
  if (action === 'delete' && !confirm(__apHtml`ลบคำถามที่เก็บถาวร ${state.selection.size} ข้ออย่างถาวรหรือไม่?\nถ้ามีข้อที่ยังไม่เก็บ ระบบจะไม่ลบรายการใดเลย`)) return;
  if (action === 'difficulty') payload.difficulty = Number(state.bulk.difficulty);
  if (action === 'add_tags' || action === 'remove_tags') { if (!state.bulk.tagId) { toast(__apText('กรุณาเลือกแท็ก')); return; } payload.tagIds = [state.bulk.tagId]; }
  try { if (!(await flushSave())) return; await api(`/api/admin/question-banks/${encodeURIComponent(state.bank.id)}/questions/bulk`, { method: 'POST', body: JSON.stringify(payload) }); if (action === 'delete') state.bank.question_count = Math.max(0, Number(state.bank.question_count || 0) - state.selection.size); state.selection.clear(); state.bulk.action = ''; state.bulk.tagId = ''; await loadQuestions(false); toast(__apText('ทำรายการกับคำถามที่เลือกแล้ว')); }
  catch (error) { toast(error.message, 4500); }
}

async function boot() {
  if (!state.token) { renderLogin(); return; }
  try {
    await api('/api/login', { method: 'POST', body: '{}' });
    const bankId = new URL(location.href).searchParams.get('bank');
    if (bankId) await openBank(bankId); else await loadBanks();
  } catch (error) { if (error.status !== 401) { toast(error.message); renderLogin(); } }
}

window.addEventListener('beforeunload', event => { if (state.saveTimer || state.saveState === 'saving' || state.saveState === 'error') { event.preventDefault(); event.returnValue = ''; } });
boot();

APFormsI18n.register({render(){if(!state.token)renderLogin();else if(state.bank)renderStudio();else renderBanks();}});
