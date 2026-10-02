(() => {
  'use strict';
  const catalog = globalThis.APFormsTranslations || { en: {}, messages: [] };
  const storageKey = 'apforms_language';
  const supported = new Set(['en', 'th']);
  const reverse = new Map();
  for (const [thai, english] of Object.entries(catalog.en)) if (!reverse.has(english)) reverse.set(english, thai);
  const fragmentPattern = /[^\r\n<>"']*[\u0e00-\u0e7f][^\r\n<>"']*/g;
  const handlers = new Set();
  let language = 'en';
  let switching = false;
  const browser = String(globalThis.navigator?.language || '').toLowerCase().startsWith('th') ? 'th' : 'en';
  const requested = new URLSearchParams(globalThis.location?.search || '').get('lang');
  let stored = null;
  try { stored = globalThis.localStorage?.getItem(storageKey); } catch {}
  language = supported.has(requested) ? requested : supported.has(stored) ? stored : browser;
  if (supported.has(requested)) { try { globalThis.localStorage?.setItem(storageKey, requested); } catch {} }

  function exact(text) {
    if (language === 'en') return Object.hasOwn(catalog.en, text) ? catalog.en[text] : text;
    return reverse.get(text) || text;
  }
  function text(value) {
    const source = String(value ?? '');
    const direct = exact(source);
    if (direct !== source) return direct;
    return source.replace(fragmentPattern, fragment => {
      const key = fragment.trim();
      const translated = exact(key);
      if (translated === key) return fragment;
      return fragment.slice(0, fragment.indexOf(key)) + translated + fragment.slice(fragment.indexOf(key) + key.length);
    });
  }
  function html(strings, ...values) {
    // Interpolated values are authored content or already escaped markup.
    return strings.reduce((result, part, index) => result + text(part) + (index < values.length ? String(values[index] ?? '') : ''), '');
  }
  const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const messagePatterns = catalog.messages.map(parts => ({
    parts,
    pattern: new RegExp('^' + parts.map(escapeRegex).join('([\\s\\S]*?)') + '$'),
  }));
  function message(value) {
    const source = String(value ?? '');
    const key = source.trim();
    if (Object.hasOwn(catalog.en, key) || reverse.has(key)) return text(source);
    for (const { parts, pattern } of messagePatterns) {
      const match = source.match(pattern);
      if (match) return parts.reduce((result, part, index) => result + text(part) + (index < parts.length - 1 ? match[index + 1] : ''), '');
    }
    return source;
  }
  function labels(value) {
    return new Proxy(value, { get(target, key, receiver) {
      const item = Reflect.get(target, key, receiver);
      return typeof item === 'string' ? text(item) : item && typeof item === 'object' ? labels(item) : item;
    } });
  }
  function controls() {
    return [...(globalThis.document?.querySelectorAll('input,textarea,select') || [])].filter(element => element.id !== 'apformsLanguage');
  }
  function controlKey(element, index) {
    if (element.id) return 'id:' + element.id;
    const member = element.closest?.('[data-user]')?.getAttribute('data-user') || '';
    const attributes = element.getAttributeNames().filter(name => name === 'name' || name.startsWith('data-')).sort().map(name => name + '=' + element.getAttribute(name)).join(';');
    const choice = ['checkbox', 'radio'].includes(element.type) ? ';value=' + element.getAttribute('value') : '';
    return member || attributes || choice ? member + ';' + element.type + ';' + attributes + choice : 'index:' + index;
  }
  function captureControls() {
    return controls().map((element, index) => ({ index, key: controlKey(element, index), id: element.id, value: element.value, checked: element.checked, type: element.type,
      selected: element.multiple ? [...element.selectedOptions].map(option => option.value) : null,
      focused: element === document.activeElement, start: element.selectionStart, end: element.selectionEnd,
    }));
  }
  function restoreControls(snapshot) {
    const elements = controls();
    const byKey = new Map(elements.map((element, index) => [controlKey(element, index), element]));
    for (const saved of snapshot) {
      const element = byKey.get(saved.key);
      if (!element || element.type !== saved.type || element.type === 'file') continue;
      if (saved.selected) for (const option of element.options) option.selected = saved.selected.includes(option.value);
      else element.value = saved.value;
      if (element.type === 'checkbox' || element.type === 'radio') element.checked = saved.checked;
      if (saved.focused) { element.focus({ preventScroll: true }); try { element.setSelectionRange(saved.start, saved.end); } catch {} }
    }
  }
  function updateStatic() {
    if (!globalThis.document) return;
    document.documentElement.lang = language;
    document.querySelectorAll('[data-ap-i18n]').forEach(element => {
      const key = element.getAttribute('data-ap-i18n');
      element.textContent = text(key);
    });
    const picker = document.getElementById('apformsLanguage');
    if (picker) picker.value = language;
  }
  const hasDialog = () => !!globalThis.document?.querySelector('.modal-bg, .qb-modal-bg, dialog[open]');
  async function setLanguage(next) {
    if (!supported.has(next) || next === language || switching) return false;
    if (hasDialog()) { const picker = document.getElementById('apformsLanguage'); if(picker)picker.value=language; return false; }
    const snapshot = globalThis.document ? captureControls() : [];
    switching = true;
    const picker = globalThis.document?.getElementById('apformsLanguage');
    if (picker) picker.disabled = true;
    try {
      for (const handler of handlers) await handler.before?.();
      language = next;
      try { globalThis.localStorage?.setItem(storageKey, next); } catch {}
      updateStatic();
      for (const handler of handlers) await handler.render?.();
      if (globalThis.document) restoreControls(snapshot);
      for (const handler of handlers) await handler.after?.();
      globalThis.dispatchEvent?.(new CustomEvent('apforms:languagechange', { detail: { language } }));
      return true;
    } finally { switching = false; if (picker) picker.disabled = false; }
  }
  function mount() {
    updateStatic();
    if (!document.body || document.getElementById('apformsLanguage')) return;
    const style = document.createElement('style');
    style.textContent = '.apforms-language{position:fixed;left:12px;bottom:12px;z-index:9999;display:flex;align-items:center;gap:7px;background:#172033;color:#e8edfa;border:1px solid #42506b;border-radius:12px;padding:7px 10px;box-shadow:0 4px 16px #0003;font:12px system-ui}.apforms-language select{width:auto;min-width:82px;border:0;background:#172033;color:#e8edfa;font:inherit;padding:3px;cursor:pointer}.apforms-language select:focus{outline:2px solid #9eafff;outline-offset:3px}.apforms-language label{font-weight:600}@media(max-width:600px){.apforms-language{left:8px;bottom:8px;padding:5px 8px}}';
    document.head.append(style);
    const control = document.createElement('div');
    control.className = 'apforms-language';
    control.innerHTML = '<label for="apformsLanguage">Language / ภาษา</label><select id="apformsLanguage" aria-label="Interface language / ภาษาหน้าจอ"><option value="en">English</option><option value="th">ไทย</option></select>';
    document.body.append(control);
    const picker = control.querySelector('select');
    picker.value = language;
    picker.addEventListener('change', () => setLanguage(picker.value).catch(error => console.error('Unable to switch interface language', error)));
    const updateAvailability = () => {
      picker.disabled = switching || hasDialog();
      control.title = hasDialog() ? (language === 'en' ? 'Close the dialog to change language.' : 'ปิดหน้าต่างย่อยก่อนเปลี่ยนภาษา') : '';
      if (!hasDialog()) { try { const saved = localStorage.getItem(storageKey); if(supported.has(saved) && saved !== language)setLanguage(saved); } catch {} }
    };
    new MutationObserver(updateAvailability).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    updateAvailability();
  }
  globalThis.APFormsI18n = Object.freeze({ text, html, message, labels, setLanguage,
    register(handler) { handlers.add(handler); return () => handlers.delete(handler); },
    get language() { return language; }, get locale() { return language === 'th' ? 'th-TH' : 'en-US'; },
  });
  if (globalThis.document) {
    document.documentElement.lang = language;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
    globalThis.addEventListener?.('storage', event => { if (event.key === storageKey && supported.has(event.newValue)) setLanguage(event.newValue); });
  }
})();