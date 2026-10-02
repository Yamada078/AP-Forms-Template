import { assignDragDropToken, assignMatchingPair, gradeQuestionResponse } from './question-authoring-core.js';

const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);

function mediaHtml(media) {
  return media?.path ? `<img class="qb-media-preview" src="${esc(media.path)}" alt="${esc(media.alt || '')}" loading="lazy">` : '';
}

function ordered(items, requested, fallback = items.map(item => item.id)) {
  const byId = new Map(items.map(item => [String(item.id), item])), result = [];
  for (const id of Array.isArray(requested) ? requested : fallback) {
    const item = byId.get(String(id));
    if (item && !result.includes(item)) result.push(item);
  }
  for (const item of items) if (!result.includes(item)) result.push(item);
  return result;
}

function matchingView(config = {}) {
  const pairs = config.pairs || [], distractors = config.rightDistractors || [];
  const leftItems = pairs.map(pair => ({ id: pair.leftId, text: pair.leftText, media: pair.leftMedia || null, pair }));
  const rightItems = [
    ...pairs.map(pair => ({ id: pair.rightId, text: pair.rightText, media: pair.rightMedia || null })),
    ...distractors.map(item => ({ id: item.rightId, text: item.rightText, media: item.rightMedia || null })),
  ];
  return {
    pairs,
    leftItems: ordered(leftItems, config.leftOrder),
    rightItems: ordered(rightItems, config.rightOrder, pairs.map(pair => pair.rightId).reverse().concat(distractors.map(item => item.rightId))),
  };
}

export function createQuestionActivityState(question) {
  let response = question?.type === 'MULTIPLE_CHOICE' ? [] : null;
  if (question?.type === 'ORDERING') response = [...(question.answerConfig?.items || []).map(item => item.id)].reverse();
  if (question?.type === 'MATCHING' || question?.type === 'DRAG_DROP') response = {};
  return {
    questionId: String(question?.id ?? question?.sourceQuestionId ?? ''),
    response,
    checked: false,
    correct: null,
    revealAnswer: false,
    revealExplanation: false,
    selectedMatchLeftId: null,
    selectedDragTokenId: null,
  };
}

export function ensureQuestionActivityState(question, current) {
  const questionId = String(question?.id ?? question?.sourceQuestionId ?? '');
  return current?.questionId === questionId ? current : createQuestionActivityState(question);
}

export function answerKeyHtml(question) {
  const config = question.answerConfig || {};
  if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') return (config.choices || []).filter(choice => (config.correctIds || []).includes(choice.id)).map(choice => esc(choice.text || '(ยังไม่มีข้อความ)')).join('<br>');
  if (question.type === 'TRUE_FALSE') return config.correctAnswer === true ? 'จริง' : config.correctAnswer === false ? 'เท็จ' : 'ยังไม่ได้ตั้งเฉลย';
  if (question.type === 'ORDERING') { const byId = new Map((config.items || []).map(item => [item.id, item.text])); return (config.correctOrder || []).map((id, index) => `${index + 1}. ${esc(byId.get(id) || 'รูปภาพ')}`).join('<br>'); }
  if (question.type === 'MATCHING') return (config.pairs || []).map(pair => `${esc(pair.leftText || 'รูปภาพ')} ↔ ${esc(pair.rightText || 'รูปภาพ')}`).join('<br>');
  if (question.type === 'DRAG_DROP') { const targets = new Map((config.targets || []).map(target => [target.id, target.label])); return (config.tokens || []).map(token => `${esc(token.text || 'รูปภาพ')} → ${token.targetId ? esc(targets.get(token.targetId) || 'พื้นที่วาง') : 'ไม่ต้องวาง (ตัวหลอก)'}`).join('<br>'); }
  return (config.acceptedAnswers || []).filter(Boolean).map(esc).join('<br>') || 'ยังไม่ได้ตั้งคำตอบที่ยอมรับ';
}

function activityContent(text, media) {
  return `<span class="qb-test-activity-content">${mediaHtml(media)}<span>${esc(text || 'รายการรูปภาพ')}</span></span>`;
}

function matchingEditor(config, activity) {
  const view = matchingView(config), response = activity.response || {};
  const leftById = new Map(view.pairs.map(pair => [pair.leftId, pair]));
  const rightById = new Map(view.rightItems.map(item => [item.id, item]));
  const leftForRight = new Map(Object.entries(response).map(([leftId, rightId]) => [rightId, leftId]));
  const activeLeftId = activity.selectedMatchLeftId;
  const leftCards = view.leftItems.map(item => {
    const right = rightById.get(response[item.pair.leftId]);
    return `<button type="button" class="qb-match-item ${activeLeftId === item.pair.leftId ? 'active' : ''} ${right ? 'paired' : ''}" data-activity-match-left="${esc(item.pair.leftId)}" aria-pressed="${activeLeftId === item.pair.leftId}">${activityContent(item.text, item.media)}<small>${right ? `จับคู่กับ ${esc(right.text || 'รายการรูปภาพ')}` : 'เลือกเพื่อจับคู่'}</small></button>`;
  }).join('');
  const rightCards = view.rightItems.map(item => {
    const left = leftById.get(leftForRight.get(item.id));
    return `<button type="button" class="qb-match-item qb-match-right ${left ? 'paired' : ''}" data-activity-match-right="${esc(item.id)}" ${activeLeftId ? '' : 'aria-disabled="true"'}>${activityContent(item.text, item.media)}<small>${left ? `จับคู่กับ ${esc(left.leftText || 'รายการรูปภาพ')}` : activeLeftId ? 'เลือกเป็นคู่' : 'เลือกฝั่งซ้ายก่อน'}</small></button>`;
  }).join('');
  const pairRows = view.pairs.filter(pair => response[pair.leftId]).map(pair => {
    const right = rightById.get(response[pair.leftId]);
    return `<div class="qb-match-pair-row"><span>${esc(pair.leftText || 'รายการรูปภาพ')}</span><b aria-hidden="true">↔</b><span>${esc(right?.text || 'รายการรูปภาพ')}</span><button type="button" data-activity-match-remove="${esc(pair.leftId)}" aria-label="ยกเลิกคู่ ${esc(pair.leftText || 'รายการรูปภาพ')}">×</button></div>`;
  }).join('');
  return `<div class="qb-test-matching"><p class="qb-activity-instruction">เลือกหนึ่งรายการจากฝั่งซ้าย แล้วเลือกคู่จากฝั่งขวา บางรายการฝั่งขวาอาจเป็นตัวหลอก</p><div class="qb-match-columns"><section><h3>ฝั่งซ้าย</h3><div class="qb-match-list">${leftCards}</div></section><section><h3>ฝั่งขวา</h3><div class="qb-match-list">${rightCards}</div></section></div><div class="qb-match-summary"><strong>คู่ที่เลือก ${Object.keys(response).length} / ${view.pairs.length}</strong>${pairRows || '<span>ยังไม่ได้จับคู่</span>'}</div></div>`;
}

function dragTokenHtml(token, response, targets, selectedTokenId) {
  const target = targets.find(item => item.id === response[token.id]);
  return `<div class="qb-drag-token-card ${selectedTokenId === token.id ? 'selected' : ''}" data-activity-drag-token="${esc(token.id)}" role="button" tabindex="0" aria-pressed="${selectedTokenId === token.id}" aria-label="${esc(token.text || 'ชิ้นรูปภาพ')}${target ? ` อยู่ที่ ${esc(target.label || 'พื้นที่วาง')}` : ' ยังไม่ได้วาง'}">${activityContent(token.text, token.media)}<small>${target ? `อยู่ที่ ${esc(target.label || 'พื้นที่วาง')}` : 'ลากชิ้นนี้ไปยังพื้นที่วาง'}</small></div>`;
}

function dragDropEditor(config, activity) {
  const targets = config.targets || [], tokens = config.tokens || [], response = activity.response || {};
  const tokenBank = tokens.filter(token => !response[token.id]).map(token => dragTokenHtml(token, response, targets, activity.selectedDragTokenId)).join('') || '<span class="qb-drop-empty">วางครบทุกชิ้นแล้ว</span>';
  const targetCards = targets.map(target => {
    const placed = tokens.filter(token => response[token.id] === target.id);
    return `<section class="qb-drop-target" data-activity-drop-target="${esc(target.id)}"><header>${activityContent(target.label, target.media)}</header><div class="qb-drop-zone">${placed.map(token => dragTokenHtml(token, response, targets, activity.selectedDragTokenId)).join('') || '<span class="qb-drop-empty">ลากชิ้นมาวางที่นี่</span>'}</div></section>`;
  }).join('');
  return `<div class="qb-test-dragdrop"><p class="qb-activity-instruction">ลากชิ้นไปยังพื้นที่วาง หากชิ้นใดไม่เข้ากับพื้นที่ไหนให้คงไว้ด้านบน ชิ้นที่วางแล้วลากย้ายกลับได้</p><section class="qb-drag-bank" data-activity-drop-target=""><h3>ชิ้นที่จะลาก / ชิ้นที่ไม่ใช้</h3><div class="qb-drag-bank-items">${tokenBank}</div></section><div class="qb-drop-grid">${targetCards}</div><div class="qb-drag-status">วางในพื้นที่แล้ว ${Object.keys(response).length} ชิ้น</div></div>`;
}

function answerEditor(question, activity) {
  const config = question.answerConfig || {};
  if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTIPLE_CHOICE') {
    const control = question.type === 'SINGLE_CHOICE' ? 'radio' : 'checkbox';
    return (config.choices || []).map(choice => { const checked = question.type === 'SINGLE_CHOICE' ? activity.response === choice.id : (activity.response || []).includes(choice.id); return `<label class="qb-test-choice"><input type="${control}" name="activityChoice" data-activity-choice="${esc(choice.id)}" ${checked ? 'checked' : ''}><span>${esc(choice.text || 'ตัวเลือกที่ยังไม่มีข้อความ')}</span></label>`; }).join('');
  }
  if (question.type === 'TRUE_FALSE') return `<div class="qb-test-true"><label class="qb-test-choice"><input type="radio" name="activityTrue" value="true" ${activity.response === true ? 'checked' : ''}><span>จริง</span></label><label class="qb-test-choice"><input type="radio" name="activityTrue" value="false" ${activity.response === false ? 'checked' : ''}><span>เท็จ</span></label></div>`;
  if (question.type === 'ORDERING') { const byId = new Map((config.items || []).map(item => [item.id, item])); return (activity.response || []).map((id, index) => { const item = byId.get(id) || {}; return `<div class="qb-test-choice"><span class="qb-answer-number">${index + 1}</span><span class="grow">${esc(item.text || 'รูปภาพ')}</span><button class="qb-btn sm" data-activity-order="${esc(id)}" data-direction="-1" ${index === 0 ? 'disabled' : ''}>↑</button><button class="qb-btn sm" data-activity-order="${esc(id)}" data-direction="1" ${index === (activity.response || []).length - 1 ? 'disabled' : ''}>↓</button></div>`; }).join(''); }
  if (question.type === 'MATCHING') return matchingEditor(config, activity);
  if (question.type === 'DRAG_DROP') return dragDropEditor(config, activity);
  return `<input class="qb-test-short" data-activity-short value="${esc(activity.response || '')}" placeholder="พิมพ์คำตอบของผู้เรียน…" autocomplete="off">`;
}

export function renderQuestionActivity(question, activity, options = {}) {
  const controls = { check: true, reset: true, revealAnswer: true, revealExplanation: true, ...(options.controls || {}) };
  const actions = [
    controls.check ? '<button data-activity-check class="qb-btn primary">ตรวจคำตอบ</button>' : '',
    controls.reset ? '<button data-activity-reset class="qb-btn">เริ่มใหม่</button>' : '',
    controls.revealAnswer ? `<button data-activity-reveal-answer class="qb-btn">${activity.revealAnswer ? 'ซ่อนเฉลย' : 'แสดงเฉลย'}</button>` : '',
    controls.revealExplanation && question.explanation ? `<button data-activity-reveal-explanation class="qb-btn">${activity.revealExplanation ? 'ซ่อนคำอธิบาย' : 'แสดงคำอธิบาย'}</button>` : '',
  ].filter(Boolean).join('');
  const result = activity.checked ? `<div class="qb-test-result ${activity.correct ? 'correct' : 'incorrect'}"><strong>${activity.correct ? '✓ ตอบถูก' : '✕ ยังไม่ถูก'}</strong><span>${activity.correct ? 'คำตอบนี้ตรงกับเฉลย' : 'ลองเปลี่ยนคำตอบแล้วตรวจอีกครั้งได้'}</span></div>` : '';
  const kicker = options.kicker || 'ทดลองตอบ';
  return `<div class="qb-paper-kicker">${esc(kicker)} · ${esc(options.typeLabel || question.type)}</div><h2 class="qb-test-prompt">${esc(question.prompt || 'คำถามที่ยังไม่มีโจทย์')}</h2>${question.description ? `<p class="qb-test-description">${esc(question.description)}</p>` : ''}${mediaHtml(question.media)}<div class="qb-test-answers">${answerEditor(question, activity)}</div>${result}${actions ? `<div class="qb-test-actions">${actions}</div>` : ''}${controls.revealAnswer && activity.revealAnswer ? `<div class="qb-reveal"><strong>เฉลย</strong><div>${answerKeyHtml(question)}</div></div>` : ''}${controls.revealExplanation && activity.revealExplanation && question.explanation ? `<div class="qb-reveal explanation"><strong>คำอธิบาย</strong><div>${esc(question.explanation)}</div></div>` : ''}${options.note ? `<div class="qb-test-note">${esc(options.note)}</div>` : ''}`;
}

export function bindQuestionActivity(root, question, activity, options = {}) {
  const rerender = options.rerender || (() => {}), changed = options.onChange || (() => {});
  const clearChecked = () => { activity.checked = false; activity.correct = null; root.querySelector('.qb-test-result')?.remove(); changed(activity); };
  root.querySelectorAll('[data-activity-choice]').forEach(input => input.onchange = () => { if (question.type === 'SINGLE_CHOICE') activity.response = input.dataset.activityChoice; else { const values = new Set(activity.response || []); input.checked ? values.add(input.dataset.activityChoice) : values.delete(input.dataset.activityChoice); activity.response = [...values]; } clearChecked(); });
  root.querySelectorAll('input[name="activityTrue"]').forEach(input => input.onchange = () => { activity.response = input.value === 'true'; clearChecked(); });
  const short = root.querySelector('[data-activity-short]'); if (short) short.oninput = () => { activity.response = short.value; clearChecked(); };
  root.querySelectorAll('[data-activity-order]').forEach(button => button.onclick = () => { const from = activity.response.indexOf(button.dataset.activityOrder), to = from + Number(button.dataset.direction); if (from < 0 || to < 0 || to >= activity.response.length) return; const [id] = activity.response.splice(from, 1); activity.response.splice(to, 0, id); clearChecked(); rerender(); });
  root.querySelectorAll('[data-activity-match-left]').forEach(button => button.onclick = () => { activity.selectedMatchLeftId = button.dataset.activityMatchLeft; rerender(); });
  root.querySelectorAll('[data-activity-match-right]').forEach(button => button.onclick = () => { if (!activity.selectedMatchLeftId) return; activity.response = assignMatchingPair(activity.response, activity.selectedMatchLeftId, button.dataset.activityMatchRight); activity.selectedMatchLeftId = null; clearChecked(); rerender(); });
  root.querySelectorAll('[data-activity-match-remove]').forEach(button => button.onclick = () => { activity.response = assignMatchingPair(activity.response, button.dataset.activityMatchRemove, ''); if (activity.selectedMatchLeftId === button.dataset.activityMatchRemove) activity.selectedMatchLeftId = null; clearChecked(); rerender(); });
  const placeToken = (tokenId, targetId) => { activity.response = assignDragDropToken(activity.response, tokenId, targetId); activity.selectedDragTokenId = null; clearChecked(); rerender(); };
  let pointerDrag = null, movePointerDrag = null, cancelPointerDrag = null;
  const finishPointerDrag = (event, cancelled = false) => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    const drag = pointerDrag; pointerDrag = null;
    window.removeEventListener('pointermove', movePointerDrag);
    window.removeEventListener('pointerup', finishPointerDrag);
    window.removeEventListener('pointercancel', cancelPointerDrag);
    drag.ghost?.remove();
    root.querySelectorAll('.qb-drop-target.drag-over,.qb-drag-bank.drag-over').forEach(target => target.classList.remove('drag-over'));
    document.body.classList.remove('qb-is-dragging');
    if (!cancelled && drag.moved) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-activity-drop-target]');
      const targetId = drag.dropTargetId ?? target?.dataset.activityDropTarget;
      if (targetId != null) placeToken(drag.tokenId, targetId);
      return;
    }
    if (!cancelled) { activity.selectedDragTokenId = activity.selectedDragTokenId === drag.tokenId ? null : drag.tokenId; rerender(); }
  };
  movePointerDrag = event => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    event.preventDefault();
    if (!pointerDrag.moved && Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY) < 6) return;
    if (!pointerDrag.moved) {
      pointerDrag.moved = true;
      pointerDrag.ghost = pointerDrag.card.cloneNode(true);
      pointerDrag.ghost.classList.add('qb-drag-ghost');
      pointerDrag.ghost.removeAttribute('data-activity-drag-token');
      document.body.append(pointerDrag.ghost);
      document.body.classList.add('qb-is-dragging');
    }
    pointerDrag.ghost.style.transform = `translate(${event.clientX + 12}px,${event.clientY + 12}px)`;
    root.querySelectorAll('.qb-drop-target.drag-over,.qb-drag-bank.drag-over').forEach(target => target.classList.remove('drag-over'));
    const dropTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-activity-drop-target]');
    pointerDrag.dropTargetId = dropTarget?.dataset.activityDropTarget ?? null;
    dropTarget?.classList.add('drag-over');
  };
  cancelPointerDrag = event => finishPointerDrag(event, true);
  root.querySelectorAll('[data-activity-drag-token]').forEach(card => {
    card.onpointerdown = event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      pointerDrag = { pointerId: event.pointerId, tokenId: card.dataset.activityDragToken, card, startX: event.clientX, startY: event.clientY, moved: false, ghost: null, dropTargetId: null };
      window.addEventListener('pointermove', movePointerDrag, { passive: false });
      window.addEventListener('pointerup', finishPointerDrag);
      window.addEventListener('pointercancel', cancelPointerDrag);
    };
    card.onkeydown = event => { if (event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault(); activity.selectedDragTokenId = activity.selectedDragTokenId === card.dataset.activityDragToken ? null : card.dataset.activityDragToken; rerender(); };
  });
  root.querySelectorAll('[data-activity-drop-target]').forEach(target => { target.onclick = event => { if (event.target.closest('[data-activity-drag-token]') || !activity.selectedDragTokenId) return; placeToken(activity.selectedDragTokenId, target.dataset.activityDropTarget); }; });
  root.querySelector('[data-activity-check]')?.addEventListener('click', () => { activity.correct = gradeQuestionResponse(question, activity.response); activity.checked = true; changed(activity); rerender(); });
  root.querySelector('[data-activity-reset]')?.addEventListener('click', () => { Object.assign(activity, createQuestionActivityState(question)); changed(activity); rerender(); });
  root.querySelector('[data-activity-reveal-answer]')?.addEventListener('click', () => { activity.revealAnswer = !activity.revealAnswer; rerender(); });
  root.querySelector('[data-activity-reveal-explanation]')?.addEventListener('click', () => { activity.revealExplanation = !activity.revealExplanation; rerender(); });
}
