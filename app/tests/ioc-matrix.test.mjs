import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadMatrixCore() {
  const source = await readFile(new URL('../public/matrix-scale-core.js', import.meta.url), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source, context, { filename: 'matrix-scale-core.js' });
  return context.GOI_MATRIX_SCALE;
}

const question = scale => ({
  id: 'ioc_matrix',
  type: 'question',
  questionType: 'rating_matrix',
  ratingMax: 5,
  matrixScale: scale,
  matrixRows: [{ id: 'content', label: 'เนื้อหาเหมาะสม' }],
});

const answer = value => ({ __type: 'matrix', rows: { content: value } });

test('standard, custom, and IOC scales keep display labels separate from numeric values', async () => {
  const core = await loadMatrixCore();
  const standard = core.normalizeScale({ ratingMax: 5 });
  assert.equal(standard.preset, 'standard');
  assert.deepEqual(Array.from(standard.options, option => option.value), [1, 2, 3, 4, 5]);

  const custom = core.normalizeScale(question({ preset: 'custom', options: [
    { id: 'low', displayLabel: 'ต่ำ', value: -2 },
    { id: 'mid', displayLabel: 'กลาง', value: 0 },
    { id: 'high', displayLabel: 'สูง', value: 2 },
  ] }));
  assert.deepEqual(Array.from(custom.options, option => [option.displayLabel, option.value]), [['ต่ำ', -2], ['กลาง', 0], ['สูง', 2]]);

  const ioc = core.iocScale();
  assert.deepEqual(Array.from(ioc.options, option => option.value), [-1, 0, 1]);
  assert.equal(ioc.iocThreshold, 0.5);
});

test('IOC calculation counts zero, honors threshold, and uses only the analyzed response set', async () => {
  const core = await loadMatrixCore();
  const iocQuestion = question(core.iocScale(0.5));
  const all = [answer(1), answer(1), answer(0), answer(-1), answer(1)];
  const selected = all.slice(0, 3);

  const allResult = core.iocRows(iocQuestion, all)[0];
  assert.deepEqual({ sum: allResult.sum, count: allResult.count, ioc: allResult.ioc, passed: allResult.passed }, { sum: 2, count: 5, ioc: 0.4, passed: false });

  const selectedResult = core.iocRows(iocQuestion, selected)[0];
  assert.equal(selectedResult.sum, 2);
  assert.equal(selectedResult.count, 3);
  assert.ok(Math.abs(selectedResult.ioc - 2 / 3) < 1e-12);
  assert.equal(selectedResult.passed, true);

  const zeroResult = core.iocRows(iocQuestion, [answer(0), { __type: 'matrix', rows: {} }, null])[0];
  assert.deepEqual({ sum: zeroResult.sum, count: zeroResult.count, ioc: zeroResult.ioc }, { sum: 0, count: 1, ioc: 0 });
});

test('builder and public runtime expose custom scale, IOC analytics, and phone-safe matrix labels', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const text of ['Custom Scale Matrix', 'IOC Evaluation', 'IOC Threshold', 'IOC = ΣR / N', 'data-scale-label', 'matrix-scale-core.js']) assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(html, /@media\(max-width:599px\)[\s\S]*rating-matrix thead\{display:none\}/);
  assert.match(html, /Object\.prototype\.hasOwnProperty\.call\(a\.rows,r\.id\)/);
});
