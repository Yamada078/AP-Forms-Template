import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicResponse } from '../src/index.js';

const question = (id, questionType, extra = {}) => ({
  id,
  type: 'question',
  questionType,
  title: id,
  required: false,
  validation: { enabled: false },
  condition: { enabled: false },
  options: [],
  ...extra,
});

const choice = (label, id) => ({ selected: [label], selectedIds: [id], text: {} });
const multi = () => ({ selected: ['A'], selectedIds: ['a'], text: {} });
const matrix = () => ({ __type: 'matrix', rows: { r1: 2, r2: 4 } });
const radar = () => ({ __type: 'radar', values: { x: 1, y: 2, z: 3 } });

function formSchema() {
  return {
    version: 5,
    title: 'Contract',
    startPage: { fields: [] },
    sections: [
      {
        id: 'page_1',
        routingRules: [{ questionId: 'single', operator: 'equals', value: 'Skip', targetSectionId: 'page_3' }],
        blocks: [
          question('short', 'short', { required: true }),
          question('single', 'single', { required: true, options: [
            { id: 'show', label: 'Show', children: [], blocks: [question('nested', 'long', { required: true })] },
            { id: 'skip', label: 'Skip', children: [], blocks: [] },
          ] }),
          question('multi', 'multi', { required: true, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }),
          question('matrix', 'rating_matrix', { required: true, ratingMax: 4, matrixRows: [{ id: 'r1' }, { id: 'r2' }] }),
          question('radar', 'radar', { required: true, radarMax: 6, radarAxes: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] }),
          question('conditional', 'short', { required: true, condition: { enabled: true, questionId: 'single', operator: 'equals', value: 'Show' } }),
        ],
      },
      { id: 'page_2', routingRules: [], blocks: [question('page_2_required', 'short', { required: true })] },
      { id: 'page_3', routingRules: [], blocks: [question('rating', 'rating', { ratingMax: 7 })] },
    ],
  };
}

const completeSkipAnswers = () => ({
  short: 'ok',
  single: choice('Skip', 'skip'),
  multi: multi(),
  matrix: matrix(),
  radar: radar(),
  rating: 7,
});

test('server rejects every incomplete required V5 response shape', () => {
  const form = formSchema(), baseline = completeSkipAnswers();
  for (const id of ['short', 'single', 'multi', 'matrix', 'radar']) {
    const answers = structuredClone(baseline);
    delete answers[id];
    assert.match(validatePublicResponse(form, answers).error, /กรุณา/);
  }
  const partialMatrix = structuredClone(baseline);
  partialMatrix.matrix.rows = { r1: 2 };
  assert.match(validatePublicResponse(form, partialMatrix).error, /กรุณา/);
  const partialRadar = structuredClone(baseline);
  partialRadar.radar.values = { x: 1, y: 2 };
  assert.match(validatePublicResponse(form, partialRadar).error, /กรุณา/);
});

test('server validates published forbid operators and custom messages', () => {
  const form = formSchema();
  form.sections[0].blocks[0].validation = { enabled: true, operator: 'forbid_equals', value: 'blocked', message: 'custom equals' };
  assert.equal(validatePublicResponse(form, { ...completeSkipAnswers(), short: 'blocked' }).error, 'custom equals');
  form.sections[0].blocks[0].validation = { enabled: true, operator: 'forbid_contains', value: '- ', message: 'custom contains' };
  assert.equal(validatePublicResponse(form, { ...completeSkipAnswers(), short: 'bad - value' }).error, 'custom contains');
});

test('server ignores required conditional and nested questions only while inactive', () => {
  const form = formSchema();
  assert.equal(validatePublicResponse(form, completeSkipAnswers()).error, undefined);
  const shown = { ...completeSkipAnswers(), single: choice('Show', 'show'), page_2_required: 'page 2' };
  assert.match(validatePublicResponse(form, shown).error, /nested/);
  shown.nested = 'nested answer';
  assert.match(validatePublicResponse(form, shown).error, /conditional/);
  shown.conditional = 'visible answer';
  assert.equal(validatePublicResponse(form, shown).error, undefined);
});

test('server strips inactive branch and unvisited route answers by stable ids', () => {
  const form = formSchema();
  const checked = validatePublicResponse(form, {
    ...completeSkipAnswers(),
    nested: 'stale nested',
    conditional: 'stale conditional',
    page_2_required: 'stale skipped page',
  });
  assert.deepEqual(checked.path, ['page_1', 'page_3']);
  assert.equal(Object.hasOwn(checked.answers, 'nested'), false);
  assert.equal(Object.hasOwn(checked.answers, 'conditional'), false);
  assert.equal(Object.hasOwn(checked.answers, 'page_2_required'), false);
});

test('server rejects invalid option, rating, matrix and radar values', () => {
  const form = formSchema();
  assert.match(validatePublicResponse(form, { ...completeSkipAnswers(), multi: choice('Unknown', 'unknown') }).error, /ตัวเลือก/);
  assert.match(validatePublicResponse(form, { ...completeSkipAnswers(), rating: 8 }).error, /คะแนน/);
  assert.match(validatePublicResponse(form, { ...completeSkipAnswers(), matrix: { __type: 'matrix', rows: { r1: 5, r2: 4 } } }).error, /คะแนนตาราง/);
  assert.match(validatePublicResponse(form, { ...completeSkipAnswers(), radar: { __type: 'radar', values: { x: 7, y: 2, z: 3 } } }).error, /ค่ากราฟ/);
});

test('server accepts and persists IOC zero as a required matrix answer', () => {
  const form = {
    version: 5,
    title: 'IOC',
    startPage: { fields: [] },
    sections: [{ id: 'page_1', routingRules: [], blocks: [question('ioc', 'rating_matrix', {
      required: true,
      matrixRows: [{ id: 'row_1', label: 'รายการ 1' }],
      matrixScale: {
        preset: 'ioc',
        iocThreshold: 0.5,
        options: [
          { id: 'minus', displayLabel: 'ไม่สอดคล้อง', value: -1 },
          { id: 'zero', displayLabel: 'ไม่แน่ใจ', value: 0 },
          { id: 'plus', displayLabel: 'สอดคล้อง', value: 1 },
        ],
      },
    })] }],
  };
  const checked = validatePublicResponse(form, { ioc: { __type: 'matrix', rows: { row_1: 0 } } });
  assert.equal(checked.error, undefined);
  assert.equal(checked.answers.ioc.rows.row_1, 0);
  assert.match(validatePublicResponse(form, { ioc: { __type: 'matrix', rows: {} } }).error, /กรุณา/);
  assert.match(validatePublicResponse(form, { ioc: { __type: 'matrix', rows: { row_1: 2 } } }).error, /คะแนนตาราง/);
});

test('server validates reusable custom matrix numeric values without relying on column position', () => {
  const form = {
    version: 5, title: 'Custom Matrix', startPage: { fields: [] },
    sections: [{ id: 'page_1', routingRules: [], blocks: [question('custom', 'rating_matrix', {
      required: true,
      matrixRows: [{ id: 'row_1' }],
      matrixScale: { preset: 'custom', options: [
        { id: 'low', displayLabel: 'ต่ำ', value: -2 },
        { id: 'middle', displayLabel: 'กลาง', value: 0 },
        { id: 'high', displayLabel: 'สูง', value: 2 },
      ] },
    })] }],
  };
  const checked = validatePublicResponse(form, { custom: { __type: 'matrix', rows: { row_1: 0 } } });
  assert.equal(checked.error, undefined);
  assert.equal(checked.answers.custom.rows.row_1, 0);
  assert.match(validatePublicResponse(form, { custom: { __type: 'matrix', rows: { row_1: 1 } } }).error, /คะแนนตาราง/);
  assert.match(validatePublicResponse(form, { custom: { __type: 'matrix', rows: { row_1: false } } }).error, /คะแนนตาราง/);
});
