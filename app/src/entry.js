import baseWorker, { FormRoom as BaseFormRoom } from './index.js';

function withHeaders(response, body, contentType = null) {
  const headers = new Headers(response.headers);
  if (contentType) headers.set('content-type', contentType);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('etag');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function freshAssetResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('cdn-cache-control', 'no-store');
  headers.set('cloudflare-cdn-cache-control', 'no-store');
  headers.set('pragma', 'no-cache');
  headers.delete('age');
  headers.delete('etag');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function injectCoreBridge(html) {
  if (html.includes('GOI_FORMS_CORE_BRIDGE')) return html;
  const marker = "sessionStorage.setItem('goi_collab_session',state.sessionId);";
  if (!html.includes(marker)) return html;

  const bridge = `
// AP+forms core bridge: install immediately after Builder state exists.
// This must run before login/public early-return paths so Logic always shares
// the same Form state and Collaboration socket without navigation or reconnect.
window.GOI_FORMS_CORE_BRIDGE = true;
window.app = app;
window.state = state;
window.uid = uid;
window.toast = toast;
window.markDirty = markDirty;
window.topbar = topbar;
window.bindTop = bindTop;
window.syncInspector = syncInspector;
window.newBlock = newBlock;
window.newSection = newSection;
window.duplicateSection = duplicateSection;
window.renewBlockIds = renewBlockIds;
window.defaultRespondentField = defaultRespondentField;
if (typeof normalizeRadarAxes === 'function') window.normalizeRadarAxes = normalizeRadarAxes;
const __goiCoreBaseRenderAdmin = renderAdmin;
window.renderAdmin = function () {
  return __goiCoreBaseRenderAdmin.apply(this, arguments);
};
renderAdmin = function () {
  return window.renderAdmin.apply(this, arguments);
};
window.GOI_FORMS_CORE = Object.freeze({
  get state() { return state; },
  get app() { return app; },
  render() { return renderAdmin.apply(this, arguments); },
  renderBase() { return __goiCoreBaseRenderAdmin.apply(this, arguments); },
});
`;

  return html.replace(marker, `${marker}\n${bridge}`);
}

function logicLoaderTag() {
  return `<script data-goi-logic-loader>
(()=>{
  'use strict';
  const sources = [
    '/logic-bootstrap.js?v=4.3.3',
    '/logic-mode-toggle.js?v=4.3.3',
    '/logic-v2-finalize.js?v=4.3.3',
    '/logic-v2-safety.js?v=4.3.5',
    '/logic-inspector-stability.js?v=4.3.6',
    '/logic-structure-model.js?v=4.4.0',
    '/logic-structural-drag.js?v=4.4.0',
  ];
  let attempts = 0;
  const load = index => {
    if (index >= sources.length) return;
    const src = sources[index];
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => load(index + 1);
    script.onerror = () => console.error('GOI Logic asset failed: ' + src);
    document.body.appendChild(script);
  };
  const start = () => {
    if (!window.GOI_FORMS_CORE_BRIDGE || !window.state || typeof window.renderAdmin !== 'function') {
      attempts += 1;
      if (attempts < 100) {
        setTimeout(start, 50);
        return;
      }
      console.error('GOI Logic core bridge unavailable; Logic disabled without affecting Form Editor');
      return;
    }
    load(0);
  };
  start();
})();
</script>`;
}

async function injectBuilderBootstrap(response) {
  if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html')) return response;
  const html = await response.text();
  let injected = html
    .replace(/<script src="\/logic-bootstrap\.js(?:\?v=[^"]+)?"><\/script>\s*/g, '')
    .replace(/<script src="\/logic-mode-toggle\.js(?:\?v=[^"]+)?"><\/script>\s*/g, '')
    .replace(/<script src="\/logic-v2-(?:extras|finalize|safety)\.js(?:\?v=[^"]+)?"><\/script>\s*/g, '')
    .replace(/<script src="\/logic-inspector-stability\.js(?:\?v=[^"]+)?"><\/script>\s*/g, '');
  injected = injectCoreBridge(injected);
  const loader = logicLoaderTag();
  injected = injected.includes('</body>') ? injected.replace('</body>', `${loader}\n</body>`) : `${injected}\n${loader}`;
  return withHeaders(response, injected, 'text/html; charset=utf-8');
}

// Collaboration safety wrapper: keep one logical member per browser session.
export class FormRoom extends BaseFormRoom {
  peers(exclude = null) {
    const unique = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      const a = ws.deserializeAttachment?.();
      if (!a?.sessionId) continue;
      const peer = { sessionId: a.sessionId, name: a.name, role: a.role, joinedAt: a.joinedAt };
      const previous = unique.get(peer.sessionId);
      if (!previous || (peer.role === 'editor' && previous.role !== 'editor') || Number(peer.joinedAt || 0) >= Number(previous.joinedAt || 0)) unique.set(peer.sessionId, peer);
    }
    return [...unique.values()];
  }

  editor(exclude = null) {
    return this.peers(exclude).find(peer => peer.role === 'editor' && peer.sessionId !== this._replacingSessionId) || null;
  }

  async fetch(request) {
    const isSocket = (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
    if (!isSocket) return super.fetch(request);
    const sessionId = request.headers.get('x-goi-session-id') || '';
    if (!sessionId) return super.fetch(request);
    this._replacingSessionId = sessionId;
    try {
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment?.();
        if (a?.sessionId === sessionId) {
          try { ws.close(1000, 'session replaced'); } catch {}
        }
      }
      return await super.fetch(request);
    } finally {
      this._replacingSessionId = '';
    }
  }

  async _finishSocket(ws) {
    const a = ws.deserializeAttachment?.();
    if (a?.role === 'editor') {
      await this.persistPendingDraft(true).catch(() => {});
      const replacementEditor = this.ctx.getWebSockets().some(other => {
        if (other === ws) return false;
        const b = other.deserializeAttachment?.();
        return b?.sessionId === a.sessionId && b?.role === 'editor';
      });
      if (!replacementEditor) this.broadcast({ type: 'lock_available' }, ws);
    }
    this.broadcastPresence(ws);
  }

  async webSocketClose(ws) { await this._finishSocket(ws); }
  async webSocketError(ws) { await this._finishSocket(ws); }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    const freshQuestionBankAsset = request.method === 'GET' && (
      path === '/question-banks.html' ||
      path === '/question-banks.js' ||
      path === '/question-banks.css' ||
      path.startsWith('/question-bank-templates/')
    );
    if (freshQuestionBankAsset) return freshAssetResponse(await env.ASSETS.fetch(request));

    if ((path === '/' || path === '/index.html') && request.method === 'GET') {
      const response = await baseWorker.fetch(request, env, ctx);
      return injectBuilderBootstrap(response);
    }

    if (path === '/api/health' && request.method === 'GET') {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok) return response;
      const data = await response.json();
      return new Response(JSON.stringify({ ...data, appVersion: '6.0.0-organization-preview' }), {
        status: response.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    return baseWorker.fetch(request, env, ctx);
  },
};
