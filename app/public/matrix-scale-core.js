
function __apText(value) { return globalThis.APFormsI18n ? globalThis.APFormsI18n.text(value) : value; }
function __apHtml(strings, ...values) { return globalThis.APFormsI18n ? globalThis.APFormsI18n.html(strings, ...values) : strings.reduce((result, part, index) => result + part + (index < values.length ? String(values[index] ?? '') : ''), ''); }
function __apLabels(value) { return globalThis.APFormsI18n ? globalThis.APFormsI18n.labels(value) : value; }
(function (root) {
  'use strict';

  const PRESETS = Object.freeze({ STANDARD: 'standard', CUSTOM: 'custom', IOC: 'ioc' });

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function standardOptions(maximum) {
    const max = Math.max(2, Math.min(10, Number(maximum || 5)));
    return Array.from({ length: max }, (_, index) => ({
      id: `standard_${index + 1}`,
      displayLabel: String(index + 1),
      value: index + 1,
    }));
  }

  function iocScale(threshold = 0.5) {
    const parsedThreshold = finiteNumber(threshold);
    return {
      preset: PRESETS.IOC,
      options: [
        { id: 'ioc_minus_1', displayLabel: __apText('ไม่สอดคล้อง'), value: -1 },
        { id: 'ioc_zero', displayLabel: __apText('ไม่แน่ใจ'), value: 0 },
        { id: 'ioc_plus_1', displayLabel: __apText('สอดคล้อง'), value: 1 },
      ],
      iocThreshold: parsedThreshold === null ? 0.5 : parsedThreshold,
    };
  }

  function normalizeScale(question) {
    const source = question && question.matrixScale && typeof question.matrixScale === 'object' ? question.matrixScale : {};
    const preset = Object.values(PRESETS).includes(String(source.preset || '').toLowerCase())
      ? String(source.preset).toLowerCase()
      : PRESETS.STANDARD;
    if (preset === PRESETS.STANDARD) {
      return { preset, options: standardOptions(question && question.ratingMax), iocThreshold: 0.5 };
    }
    const fallback = preset === PRESETS.IOC ? iocScale(source.iocThreshold) : { preset, options: standardOptions(question && question.ratingMax), iocThreshold: 0.5 };
    const rawOptions = Array.isArray(source.options) ? source.options : [];
    const options = rawOptions.map((option, index) => {
      const value = finiteNumber(option && option.value);
      if (value === null) return null;
      return {
        id: String((option && option.id) || `${preset}_${index + 1}`),
        displayLabel: String((option && (option.displayLabel ?? option.label)) ?? value),
        value,
      };
    }).filter(Boolean);
    const unique = new Set(options.map(option => option.value));
    const iocValuesAreExact = options.length === 3 && [-1, 0, 1].every(value => unique.has(value));
    const validOptions = preset === PRESETS.IOC
      ? (iocValuesAreExact ? [-1, 0, 1].map(value => options.find(option => option.value === value)) : fallback.options)
      : (options.length >= 2 && unique.size === options.length ? options : fallback.options);
    const threshold = finiteNumber(source.iocThreshold);
    return { preset, options: validOptions, iocThreshold: threshold === null ? 0.5 : threshold };
  }

  function formatValue(value, signed = false) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    return signed && number > 0 ? `+${number}` : String(number);
  }

  function optionHeading(option, preset) {
    const numeric = formatValue(option.value, preset === PRESETS.IOC);
    const label = String(option.displayLabel || '').trim();
    return label && label !== String(option.value) && label !== numeric ? `${numeric} · ${label}` : numeric;
  }

  function iocRows(question, answers) {
    const scale = normalizeScale(question);
    if (scale.preset !== PRESETS.IOC) return [];
    const allowed = new Set(scale.options.map(option => option.value));
    return (question.matrixRows || []).map(row => {
      const values = [];
      for (const answer of answers || []) {
        const rows = answer && answer.__type === 'matrix' && answer.rows && typeof answer.rows === 'object' ? answer.rows : null;
        if (!rows || !Object.prototype.hasOwnProperty.call(rows, row.id)) continue;
        const value = finiteNumber(rows[row.id]);
        if (value !== null && allowed.has(value)) values.push(value);
      }
      const sum = values.reduce((total, value) => total + value, 0);
      const count = values.length;
      const ioc = count ? sum / count : null;
      return {
        rowId: row.id,
        label: row.label || '',
        sum,
        count,
        ioc,
        threshold: scale.iocThreshold,
        passed: ioc === null ? null : ioc >= scale.iocThreshold,
      };
    });
  }

  root.GOI_MATRIX_SCALE = Object.freeze({ PRESETS, finiteNumber, standardOptions, iocScale, normalizeScale, formatValue, optionHeading, iocRows });
})(globalThis);
