import test from 'node:test';
import assert from 'node:assert/strict';

class FakeElement {
  constructor() {
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
    this.dataset = {};
    this.classNames = new Set();
    this.value = '';
    this.disabled = false;
    this.textWrites = 0;
    this.classList = {
      toggle: (name, force) => {
        if (force) this.classNames.add(name);
        else this.classNames.delete(name);
      },
    };
  }

  set textContent(value) {
    this.textWrites += 1;
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    return this._textContent ?? this.children.map((child) => child.textContent ?? '').join('');
  }

  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._textContent = undefined; this.children = [...nodes]; }
  focus() { this.ownerDocument.activeElement = this; }
  click() { return this.listeners.get('click')?.({ preventDefault() {} }); }
}

function makeDocument() {
  const elements = new Map();
  const document = {
    activeElement: null,
    querySelector(selector) {
      if (!elements.has(selector)) {
        const element = new FakeElement();
        element.ownerDocument = document;
        elements.set(selector, element);
      }
      return elements.get(selector);
    },
    querySelectorAll() { return []; },
    createElement() { const element = new FakeElement(); element.ownerDocument = document; return element; },
    createTextNode(text) { return { textContent: String(text) }; },
  };
  return document;
}

function event() {
  const listeners = [];
  return { addListener(listener) { listeners.push(listener); }, async emit(...args) { return Promise.all(listeners.map((listener) => listener(...args))); } };
}

let scenario = 0;
async function mountOptionsPage({ pause = { paused: false, pauseUntil: null }, clock = null } = {}) {
  const document = makeDocument();
  const messages = [];
  const permissionRequests = [];
  let permissionGranted = false;
  let topSitesResponse = { ok: true, sites: [] };
  const initialState = {
    blockedDomains: ['instagram.com'],
    productiveUrls: ['https://trello.com'],
    pause,
  };
  const originalDateNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  const timers = [];
  if (clock) {
    Date.now = () => clock.now;
    globalThis.setTimeout = (callback, delay) => {
      const timer = { callback, at: clock.now + delay };
      timers.push(timer);
      return timer;
    };
  }
  globalThis.document = document;
  globalThis.chrome = {
    storage: { onChanged: event() },
    permissions: {
      async contains() { return false; },
      async request(permission) { permissionRequests.push(permission); return permissionGranted; },
    },
    runtime: {
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'getState') return initialState;
        if (message.type === 'getTopSites') return topSitesResponse;
        return { ok: true };
      },
    },
  };
  await import(`../options.js?scenario=${++scenario}`);
  await new Promise((resolve) => setImmediate(resolve));
  return {
    document, messages, permissionRequests,
    setPermissionGranted(value) { permissionGranted = value; },
    setTopSitesResponse(value) { topSitesResponse = value; },
    setPause(value) { initialState.pause = value; },
    async runNextTimer() {
      const timer = timers.shift();
      clock.now = timer.at;
      timer.callback();
      await new Promise((resolve) => setImmediate(resolve));
    },
    restoreClock() {
      Date.now = originalDateNow;
      globalThis.setTimeout = originalSetTimeout;
    },
  };
}

test('consulta sites só após clique, trata recusa/vazio/erro e classifica sem salvar automaticamente', async () => {
  const page = await mountOptionsPage();
  const loadButton = page.document.querySelector('#load-top-sites');
  const topSitesList = page.document.querySelector('#top-sites-list');
  const status = page.document.querySelector('#settings-status');

  assert.deepEqual(page.permissionRequests, []);
  assert.equal(page.messages.some(({ type }) => type === 'getTopSites'), false);

  await loadButton.click();
  assert.deepEqual(page.permissionRequests, [{ permissions: ['topSites'] }]);
  assert.equal(page.messages.some(({ type }) => type === 'getTopSites'), false);
  assert.match(status.textContent, /Permissão não concedida/);

  page.setPermissionGranted(true);
  await loadButton.click();
  assert.equal(topSitesList.children.length, 0);
  assert.match(status.textContent, /Nenhum site frequente compatível/);

  page.setTopSitesResponse({ ok: true, sites: [
    { domain: 'reddit.com', productiveUrl: 'https://reddit.com' },
    { domain: 'docs.google.com', productiveUrl: 'https://docs.google.com' },
    { domain: 'instagram.com', productiveUrl: 'https://instagram.com' },
    { domain: 'trello.com', productiveUrl: 'https://trello.com' },
  ] });
  await loadButton.click();
  assert.equal(topSitesList.children.length, 2);
  assert.doesNotMatch(topSitesList.textContent, /instagram\.com|trello\.com/);
  const reddit = topSitesList.children[0];
  const redditActions = reddit.children[1].children;

  await redditActions[0].click();
  assert.match(page.document.querySelector('#blocked-list').textContent, /reddit\.com/);
  assert.doesNotMatch(topSitesList.textContent, /reddit\.com/);
  assert.equal(page.document.activeElement, topSitesList.children[0].children[1].children[0]);
  await page.document.querySelector('#blocked-list').children[1].children[1].click();
  assert.match(topSitesList.textContent, /reddit\.com/);

  await topSitesList.children.find((item) => item.textContent.includes('docs.google.com')).children[1].children[1].click();
  assert.match(page.document.querySelector('#productive-list').textContent, /docs\.google\.com/);
  assert.doesNotMatch(topSitesList.textContent, /docs\.google\.com/);
  assert.equal(page.messages.some(({ type }) => type === 'saveConfiguration'), false);
  const docsProductiveItem = page.document.querySelector('#productive-list').children[1];
  await docsProductiveItem.children.at(-1).click();
  assert.match(topSitesList.textContent, /docs\.google\.com/);
  await page.document.querySelector('#blocked-list').children[0].children[1].click();
  assert.match(topSitesList.textContent, /instagram\.com/);

  page.setTopSitesResponse({ ok: false, error: 'Falha simulada na consulta.' });
  await loadButton.click();
  assert.match(status.textContent, /Falha simulada na consulta/);
  assert.equal(topSitesList.children.length, 0);
});

test('revela sites frequentes em grupos de cinco e oculta a ação ao chegar ao fim', async () => {
  const page = await mountOptionsPage();
  page.setPermissionGranted(true);
  page.setTopSitesResponse({ ok: true, sites: Array.from({ length: 12 }, (_, index) => ({
    domain: `site${index + 1}.com`,
    productiveUrl: `https://site${index + 1}.com`,
  })) });

  await page.document.querySelector('#load-top-sites').click();
  const topSitesList = page.document.querySelector('#top-sites-list');
  const showMoreButton = page.document.querySelector('#show-more-top-sites');
  assert.equal(topSitesList.children.length, 5);
  assert.equal(showMoreButton.hidden, false);

  await showMoreButton.click();
  assert.equal(topSitesList.children.length, 10);
  assert.equal(showMoreButton.hidden, false);

  await showMoreButton.click();
  assert.equal(topSitesList.children.length, 12);
  assert.equal(showMoreButton.hidden, true);
});

test('mostra contagem da pausa e permite retomar a proteção', async () => {
  const page = await mountOptionsPage({ pause: { paused: true, pauseUntil: Date.now() + 60_000 } });
  assert.match(page.document.querySelector('#pause-countdown').textContent, /1 minuto restante/);
  assert.equal(page.document.querySelector('#resume').hidden, false);
  await page.document.querySelector('#resume').click();
  assert.equal(page.messages.some(({ type }) => type === 'resume'), true);
});

test('mostra o estado ativo quando carregada sem pausa', async () => {
  const page = await mountOptionsPage();
  assert.equal(page.document.querySelector('#pause-countdown').textContent, 'Proteção ativa.');
});

test('sincroniza somente a pausa externa sem descartar uma edição não salva', async () => {
  const page = await mountOptionsPage();
  const input = page.document.querySelector('#blocked-input');
  input.value = 'draft.example';
  await page.document.querySelector('#blocked-form').listeners.get('submit')({ preventDefault() {} });
  assert.match(page.document.querySelector('#blocked-list').textContent, /draft\.example/);

  const pauseUntil = Date.now() + 30 * 60_000;
  page.setPause({ paused: true, pauseUntil });
  await globalThis.chrome.storage.onChanged.emit({ pauseUntil: { oldValue: null, newValue: pauseUntil } }, 'local');
  assert.match(page.document.querySelector('#pause-countdown').textContent, /30 minutos restantes/);
  assert.equal(page.document.querySelector('#resume').hidden, false);
  assert.match(page.document.querySelector('#blocked-list').textContent, /draft\.example/);

  page.setPause({ paused: false, pauseUntil: null });
  await globalThis.chrome.storage.onChanged.emit({ pauseUntil: { oldValue: pauseUntil, newValue: null } }, 'local');
  assert.equal(page.document.querySelector('#pause-countdown').textContent, 'Proteção ativa.');
  assert.equal(page.document.querySelector('#resume').hidden, true);
  assert.match(page.document.querySelector('#blocked-list').textContent, /draft\.example/);
});

test('atualiza a contagem na virada do minuto sem repetir o mesmo anúncio', async () => {
  const clock = { now: 1_000_000 };
  const pauseUntil = clock.now + 120_000;
  const page = await mountOptionsPage({ pause: { paused: true, pauseUntil }, clock });
  try {
    const countdown = page.document.querySelector('#pause-countdown');
    assert.match(countdown.textContent, /2 minutos restantes/);
    const initialWrites = countdown.textWrites;

    await globalThis.chrome.storage.onChanged.emit({ pauseUntil: { oldValue: pauseUntil, newValue: pauseUntil } }, 'local');
    assert.equal(countdown.textWrites, initialWrites);

    await page.runNextTimer();
    assert.match(countdown.textContent, /1 minuto restante/);
    assert.equal(countdown.textWrites, initialWrites + 1);
  } finally {
    page.restoreClock();
  }
});

test('pede notificações ao pausar e continua quando a permissão é negada', async () => {
  const page = await mountOptionsPage();
  await page.document.querySelector('#pause').click();
  assert.deepEqual(page.permissionRequests, [{ permissions: ['notifications'] }]);
  assert.equal(page.messages.some(({ type }) => type === 'pause'), true);
  assert.match(page.document.querySelector('#pause-status').textContent, /Permissão de notificações não concedida/);
  assert.equal(page.document.querySelector('#settings-status').textContent, '');
});

test('pausa com notificações concedidas sem mostrar feedback de recusa', async () => {
  const page = await mountOptionsPage();
  page.setPermissionGranted(true);
  await page.document.querySelector('#pause').click();
  assert.equal(page.messages.some(({ type }) => type === 'pause'), true);
  assert.match(page.document.querySelector('#pause-status').textContent, /Proteção pausada/);
  assert.doesNotMatch(page.document.querySelector('#pause-status').textContent, /não concedida/);
  assert.equal(page.document.querySelector('#settings-status').textContent, '');
});
