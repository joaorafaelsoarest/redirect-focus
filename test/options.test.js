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
    this.classList = {
      toggle: (name, force) => {
        if (force) this.classNames.add(name);
        else this.classNames.delete(name);
      },
    };
  }

  set textContent(value) {
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
  click() { return this.listeners.get('click')?.({ preventDefault() {} }); }
}

function makeDocument() {
  const elements = new Map();
  return {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new FakeElement());
      return elements.get(selector);
    },
    querySelectorAll() { return []; },
    createElement() { return new FakeElement(); },
    createTextNode(text) { return { textContent: String(text) }; },
  };
}

let scenario = 0;
async function mountOptionsPage() {
  const document = makeDocument();
  const messages = [];
  const permissionRequests = [];
  let permissionGranted = false;
  let topSitesResponse = { ok: true, sites: [] };
  const initialState = {
    blockedDomains: ['instagram.com'],
    productiveUrls: ['https://trello.com'],
  };
  globalThis.document = document;
  globalThis.chrome = {
    permissions: {
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
  ] });
  await loadButton.click();
  assert.equal(topSitesList.children.length, 3);
  const reddit = topSitesList.children[0];
  const redditActions = reddit.children[1].children;

  await redditActions[0].click();
  assert.match(page.document.querySelector('#blocked-list').textContent, /reddit\.com/);
  const redditFeedback = topSitesList.children[0].children[1];
  assert.equal(redditFeedback.textContent, 'Adicionado às distrações');
  assert.equal(redditFeedback.attributes.role, 'status');

  await topSitesList.children[1].children[1].children[1].click();
  assert.match(page.document.querySelector('#productive-list').textContent, /docs\.google\.com/);
  assert.equal(topSitesList.children[1].children[1].textContent, 'Adicionado aos destinos produtivos');
  assert.equal(page.messages.some(({ type }) => type === 'saveConfiguration'), false);
  const instagramActions = topSitesList.children[2].children[1].children;
  await instagramActions[1].click();
  assert.match(status.textContent, /não pode usar um domínio bloqueado/);
  assert.doesNotMatch(page.document.querySelector('#productive-list').textContent, /instagram\.com/);

  page.setTopSitesResponse({ ok: false, error: 'Falha simulada na consulta.' });
  await loadButton.click();
  assert.match(status.textContent, /Falha simulada na consulta/);
  assert.equal(topSitesList.children.length, 0);
});
