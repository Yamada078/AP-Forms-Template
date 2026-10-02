import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assignDragDropToken, assignMatchingPair, gradeQuestionResponse, normalizeShortAnswer } from '../public/question-authoring-core.js';

const [mainHtml, bankHtml, bankJs, activityJs, bankCss, entryJs, wranglerConfig] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/question-banks.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/question-banks.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/question-activity-runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/question-banks.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/entry.js', import.meta.url), 'utf8'),
  readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
]);

test('main navigation exposes Forms, Question Banks, and Applications as separate workspaces', () => {
  assert.match(mainHtml, /<h1>Forms<\/h1>/);
  assert.match(mainHtml, /id="questionBanksBtn"[^>]*>Question Banks/);
  assert.match(mainHtml, /id="applicationsBtn"[^>]*>Applications/);
  assert.match(mainHtml, /location\.href='\/question-banks\.html'/);
  assert.doesNotMatch(mainHtml, /questionType=['"]question[_-]?bank/i);
});

test('Question Studio UI covers authoring, lifecycle, tags, filters, bulk actions, and preview', () => {
  assert.match(bankHtml, /question-banks\.js\?v=5\.4\.5/);
  for (const type of ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'ORDERING', 'MATCHING', 'DRAG_DROP']) assert.match(bankJs, new RegExp(type));
  for (const route of ['/api/admin/question-banks', '/questions', '/duplicate', '/bulk', '/tags']) assert.match(bankJs, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const field of ['prompt', 'description', 'difficulty', 'answerConfig', 'explanation', 'internalNotes', 'sourceReference']) assert.match(bankJs, new RegExp(field));
  for (const feature of ['ทุกแท็ก', 'ไม่ตัดแท็กใดออก', 'แก้ไขล่าสุด', 'แสดงเฉลย', 'กำลังบันทึก…', 'เก็บถาวร']) assert.match(bankJs, new RegExp(feature));
  assert.match(bankJs, /correctIds/);
  assert.match(bankJs, /acceptedAnswers/);
  assert.match(bankJs, /caseSensitive/);
  assert.match(bankJs, /trimWhitespace/);
  assert.match(bankJs, /normalizeUnicode/);
  for (const feature of ['selectAllQuestions', 'clearSelection', 'bulkTag', 'deleteTag', 'saveAndNextQuestion', 'question-media\/manifest\.json', 'data-open-media', 'mediaPickerModal']) assert.match(bankJs, new RegExp(feature));
  for (const feature of ['importBank', 'openTemplates', 'exportCurrentBank', 'question-bank-packages/preview', 'question-bank-packages/import', 'question-bank-templates/manifest.json']) assert.match(bankJs, new RegExp(feature));
  assert.match(bankJs, /พิมพ์ “\$\{bank\.name\}” เพื่อยืนยัน/);
});

test('Question Bank static shell bypasses stale workers.dev asset cache', () => {
  for (const path of ['/question-banks.html', '/question-banks.js', '/question-banks.css', '/question-bank-templates/*']) assert.ok(wranglerConfig.includes(path));
  assert.match(entryJs, /freshQuestionBankAsset/);
  assert.match(entryJs, /cache-control', 'no-store, no-cache, must-revalidate'/);
  assert.match(entryJs, /cloudflare-cdn-cache-control', 'no-store'/);
});

test('Question Studio layout switches from three panes to drawer and full-screen mobile editor', () => {
  assert.match(bankCss, /\.qb-studio-body\{grid-template-columns:320px minmax\(430px,1fr\) 330px/);
  assert.match(bankCss, /@media\(max-width:1100px\)[\s\S]*\.qb-inspector\{display:block;position:fixed/);
  assert.match(bankCss, /@media\(max-width:720px\)[\s\S]*\.qb-studio-body\.has-selection \.qb-library\{display:none/);
  assert.match(bankCss, /height:calc\(100dvh - 58px\)/);
});

test('canvas authoring has inline fields, stable choice controls, focus restoration, and progressive loading', () => {
  for (const feature of ['qb-question-canvas', 'qPrompt', 'data-choice-text', 'data-correct-choice', 'data-move-choice', 'addChoice', 'addAccepted', 'qExplanation']) assert.match(bankJs, new RegExp(feature));
  assert.match(bankJs, /limit: '60'/);
  assert.match(bankJs, /loadMoreQuestions/);
  assert.match(bankJs, /pendingFocus = \{ kind: 'choice'/);
  assert.match(bankJs, /pendingFocus = \{ kind: 'answer'/);
  assert.match(bankJs, /captureStudioView/);
  assert.match(bankJs, /scrollTop = snapshot\.canvas/);
  assert.match(bankJs, /focus\(\{ preventScroll: true \}\)/);
  assert.match(bankJs, /choices\.splice\(to,0,choice\)/);
});

test('Edit and Test modes are interactive and test responses stay separate from author data', () => {
  for (const feature of ['data-mode="edit"', 'data-mode="test"', 'renderQuestionActivity', 'bindQuestionActivity', 'ensureQuestionActivityState']) assert.match(bankJs, new RegExp(feature));
  for (const feature of ['data-activity-check', 'data-activity-reset', 'data-activity-reveal-answer', 'data-activity-reveal-explanation', 'gradeQuestionResponse']) assert.match(activityJs, new RegExp(feature));
  assert.match(activityJs, /activity\.response/);
  assert.doesNotMatch(activityJs, /data-activity-choice[\s\S]{0,300}queueSave/);

  const fixtures = {
    single: { type: 'SINGLE_CHOICE', answerConfig: { correctIds: ['a'] } },
    multiple: { type: 'MULTIPLE_CHOICE', answerConfig: { correctIds: ['a', 'c'] } },
    truth: { type: 'TRUE_FALSE', answerConfig: { correctAnswer: true } },
    short: { type: 'SHORT_ANSWER', answerConfig: { acceptedAnswers: ['Café'], caseSensitive: false, trimWhitespace: true, normalizeUnicode: true } },
  };
  const before = structuredClone(fixtures);
  assert.equal(gradeQuestionResponse(fixtures.single, 'a'), true);
  assert.equal(gradeQuestionResponse(fixtures.single, 'b'), false);
  assert.equal(gradeQuestionResponse(fixtures.multiple, ['c', 'a']), true);
  assert.equal(gradeQuestionResponse(fixtures.multiple, ['a']), false);
  assert.equal(gradeQuestionResponse(fixtures.truth, true), true);
  assert.equal(gradeQuestionResponse(fixtures.truth, false), false);
  assert.equal(gradeQuestionResponse(fixtures.short, '  CAFE\u0301  '), true);
  assert.equal(normalizeShortAnswer('  DOG  ', { trimWhitespace: true, caseSensitive: false }), 'dog');
  assert.deepEqual(fixtures, before);
});

test('Matching and Drag-Drop keep distinct response contracts and interactive controls', () => {
  const matching = { type: 'MATCHING', answerConfig: { pairs: [
    { leftId: 'left_a', rightId: 'right_1' },
    { leftId: 'left_b', rightId: 'right_2' },
  ], rightDistractors: [{ rightId: 'right_fake' }], rightOrder: ['right_fake', 'right_2', 'right_1'] } };
  let matched = assignMatchingPair({}, 'left_a', 'right_2');
  matched = assignMatchingPair(matched, 'left_b', 'right_2');
  assert.deepEqual(matched, { left_b: 'right_2' }, 'a right item can only belong to one left item');
  matched = assignMatchingPair(matched, 'left_a', 'right_1');
  assert.equal(gradeQuestionResponse(matching, matched), true);
  assert.deepEqual(assignMatchingPair(matched, 'left_a', ''), { left_b: 'right_2' });

  const dragDrop = { type: 'DRAG_DROP', answerConfig: { tokens: [
    { id: 'token_a', targetId: 'target_1' },
    { id: 'token_b', targetId: 'target_2' },
    { id: 'token_fake', targetId: '' },
  ] } };
  let dropped = assignDragDropToken({}, 'token_a', 'target_2');
  dropped = assignDragDropToken(dropped, 'token_a', 'target_1');
  dropped = assignDragDropToken(dropped, 'token_b', 'target_2');
  assert.deepEqual(dropped, { token_a: 'target_1', token_b: 'target_2' });
  assert.equal(gradeQuestionResponse(dragDrop, dropped), true);
  assert.equal(gradeQuestionResponse(dragDrop, { ...dropped, token_fake: 'target_1' }), false);
  assert.deepEqual(assignDragDropToken(dropped, 'token_a', ''), { token_b: 'target_2' });

  for (const control of ['data-activity-match-left', 'data-activity-match-right', 'data-activity-match-remove', 'data-activity-drag-token', 'data-activity-drop-target', 'onpointerdown', "addEventListener('pointermove'", "addEventListener('pointerup'", "addEventListener('pointercancel'"]) assert.match(activityJs, new RegExp(control.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const feature of ['rightDistractors', 'leftOrder', 'rightOrder', 'addMatchDistractor', 'ไม่มีพื้นที่ที่ถูกต้อง', 'data-move-match-display', 'data-move-target', 'data-move-token']) assert.match(bankJs, new RegExp(feature));
  assert.match(bankJs, /function matchingOrderItemHtml/);
  assert.doesNotMatch(bankJs, /testActivityItemHtml/);
  assert.doesNotMatch(activityJs, /data-activity-(?:match|drop)=[^\n]*<select/);
  for (const layout of ['qb-test-matching', 'qb-match-columns', 'qb-test-dragdrop', 'qb-drop-grid', 'qb-drag-ghost']) assert.match(bankCss, new RegExp(`\\.${layout}`));
  assert.match(bankCss, /@media\(max-width:720px\)[\s\S]*\.qb-match-columns,\.qb-drop-grid\{grid-template-columns:1fr\}/);
});

test('question actions expose lifecycle-safe archive, restore, and delete flow', () => {
  for (const feature of ['duplicateCurrent', 'archiveQuestion', 'restoreQuestion', 'requestDeleteQuestion', 'ต้องเก็บคำถามก่อนจึงจะลบได้']) assert.match(bankJs, new RegExp(feature));
  assert.match(bankJs, /question\.status !== 'ARCHIVED'/);
  assert.match(bankJs, /saveQuestion\(next\)/);
});

test('autosave is debounced and blocks navigation when a save fails', () => {
  assert.match(bankJs, /setTimeout\(\(\) => saveQuestion\(\), 750\)/);
  assert.match(bankJs, /if \(!\(await flushSave\(\)\)\)/);
  assert.match(bankJs, /state\.saveState !== 'error'/);
  assert.match(bankJs, /บันทึกไม่สำเร็จ · ลองอีกครั้ง/);
  assert.match(bankJs, /beforeunload[\s\S]*state\.saveState === 'error'/);
});
