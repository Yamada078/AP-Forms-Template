
function __apText(value) { return globalThis.APFormsI18n ? globalThis.APFormsI18n.text(value) : value; }
function __apHtml(strings, ...values) { return globalThis.APFormsI18n ? globalThis.APFormsI18n.html(strings, ...values) : strings.reduce((result, part, index) => result + part + (index < values.length ? String(values[index] ?? '') : ''), ''); }
function __apLabels(value) { return globalThis.APFormsI18n ? globalThis.APFormsI18n.labels(value) : value; }
(() => {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(options.headers).forEach((value, key) => headers.set(key, value));
      headers.set('x-apforms-request', '1');
      if (headers.get('authorization') === 'Bearer __account_session__') headers.delete('authorization');
      return originalFetch(input, { ...options, headers, credentials: 'same-origin' });
    }
    return originalFetch(input, options);
  };
  window.APAccount = {
    async status() { const response = await fetch('/api/account/status'); if (!response.ok) throw new Error(__apText('กรุณาปรับฐานข้อมูลตามคู่มือติดตั้ง')); return response.json(); },
    login(next = location.pathname + location.search) { location.href = '/account.html?next=' + encodeURIComponent(next); },
    async logout() {
      await fetch('/api/account/logout', { method: 'POST', body: '{}' });
      sessionStorage.removeItem('goi_team_key'); sessionStorage.removeItem('goi_member_name');
      location.href = '/account.html';
    },
  };
})();
