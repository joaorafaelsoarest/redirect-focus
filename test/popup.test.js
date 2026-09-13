import test from 'node:test';
import assert from 'node:assert/strict';

class FakeElement {
  constructor() { this.listeners = new Map(); this.classNames = new Set(); this.hidden = false; this.disabled = false; this._textContent = ''; this.classList = { toggle: (name, force) => force ? this.classNames.add(name) : this.classNames.delete(name) }; }
  set textContent(value) { this._textContent = String(value); }
  get textContent() { return this._textContent; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { return this.disabled ? undefined : this.listeners.get('click')?.(); }
}

let scenario = 0;
async function mountPopup(pause, {
  tabUrl = 'https://www.instagram.com/reels',
  blockedDomains = ['instagram.com'],
  productiveUrls = ['https://trello.com'],
  permissionGranted = true,
  classificationResponse = null,
} = {}) {
  const elements = new Map();
  globalThis.document = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new FakeElement()); return elements.get(selector); } };
  const messages = [];
  const permissionRequests = [];
  globalThis.chrome = {
    tabs: { async query() { return tabUrl ? [{ url: tabUrl }] : []; } },
    permissions: { async request(request) { permissionRequests.push(request); return permissionGranted; } },
    runtime: {
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'classifySite') {
          return classificationResponse ?? {
            ok: true, changed: true, category: message.category,
            domain: new URL(message.url).hostname.replace(/^www\./, ''), hasFocusDestination: true,
          };
        }
        return { blockedDomains, productiveUrls, unpermittedDomains: [], pause, statistics: { today: 2, last7Days: 4 } };
      },
      openOptionsPage() {},
    },
  };
  await import(`../popup.js?scenario=${++scenario}`);
  await new Promise((resolve) => setImmediate(resolve));
  return { elements, messages, permissionRequests };
}

test('popup mostra minutos restantes e expõe retomada somente durante pausa', async () => {
  const paused = await mountPopup({ paused: true, pauseUntil: Date.now() + 60_000 });
  assert.match(paused.elements.get('#protection-status').textContent, /1 minuto restante/);
  assert.equal(paused.elements.get('#resume').hidden, false);
  await paused.elements.get('#resume').click();
  assert.equal(paused.messages.some(({ type }) => type === 'resume'), true);

  const active = await mountPopup({ paused: false, pauseUntil: null });
  assert.equal(active.elements.get('#resume').hidden, true);
});

test('popup mostra a categoria existente e mantém disponível a troca', async () => {
  const popup = await mountPopup({ paused: false, pauseUntil: null }, {
    tabUrl: 'https://www.reddit.com/r/focus?private=1',
    blockedDomains: ['reddit.com'],
  });

  assert.equal(popup.elements.get('#current-site-domain').textContent, 'reddit.com');
  assert.match(popup.elements.get('#classification-status').textContent, /Distração/);
  assert.equal(popup.elements.get('#classify-distraction').disabled, true);
  assert.equal(popup.elements.get('#classify-focus').disabled, false);
});

test('classificar como foco salva a URL da aba e confirma a mudança', async () => {
  const url = 'https://www.example.com/work?token=private#section';
  const popup = await mountPopup({ paused: false, pauseUntil: null }, {
    tabUrl: url, blockedDomains: [], productiveUrls: [],
  });

  await popup.elements.get('#classify-focus').click();

  assert.equal(popup.messages.some((message) => message.type === 'classifySite' && message.url === url && message.category === 'productive'), true);
  assert.match(popup.elements.get('#classification-status').textContent, /adicionado.*Foco/i);
  assert.equal(popup.elements.get('#classify-focus').disabled, true);
});

test('recusa de permissão para distração não grava categoria e mostra feedback', async () => {
  const popup = await mountPopup({ paused: false, pauseUntil: null }, {
    tabUrl: 'https://www.reddit.com/r/focus',
    blockedDomains: [], productiveUrls: [], permissionGranted: false,
  });

  await popup.elements.get('#classify-distraction').click();

  assert.deepEqual(popup.permissionRequests, [{ origins: ['*://reddit.com/*', '*://*.reddit.com/*'] }]);
  assert.equal(popup.messages.some((message) => message.type === 'classifySite'), false);
  assert.match(popup.elements.get('#classification-status').textContent, /permissão.*negada/i);
});

test('popup explica quando uma distração é salva sem destino de foco', async () => {
  const popup = await mountPopup({ paused: false, pauseUntil: null }, {
    tabUrl: 'https://reddit.com', blockedDomains: [], productiveUrls: [],
    classificationResponse: {
      ok: true, changed: true, category: 'blocked', domain: 'reddit.com', hasFocusDestination: false,
    },
  });

  await popup.elements.get('#classify-distraction').click();

  assert.match(popup.elements.get('#classification-status').textContent, /adicionado.*destino de Foco/i);
  assert.equal(popup.elements.get('#classify-distraction').disabled, true);
});

test('popup desativa classificação em páginas internas do navegador', async () => {
  const popup = await mountPopup({ paused: false, pauseUntil: null }, { tabUrl: 'chrome://settings/' });

  assert.match(popup.elements.get('#classification-status').textContent, /não pode ser classificada/i);
  assert.equal(popup.elements.get('#classify-focus').disabled, true);
  assert.equal(popup.elements.get('#classify-distraction').disabled, true);
});
