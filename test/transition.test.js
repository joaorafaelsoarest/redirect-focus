import test from 'node:test';
import assert from 'node:assert/strict';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
    this.disabled = false;
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
  append(...nodes) { this._textContent = undefined; this.children.push(...nodes); }
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
    createElement(tagName) { return new FakeElement(tagName); },
  };
}

let scenario = 0;

async function mountTransition(t, response) {
  const previous = {
    document: globalThis.document,
    chrome: globalThis.chrome,
    window: globalThis.window,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  });

  const document = makeDocument();
  const messages = [];
  const navigations = [];
  const clearedIntervals = [];
  let intervalCallback;
  let intervalDelay;
  globalThis.document = document;
  globalThis.chrome = {
    runtime: {
      async sendMessage(message) {
        messages.push(message);
        return response;
      },
    },
  };
  globalThis.window = { location: { replace(url) { navigations.push(url); } } };
  globalThis.setInterval = (callback, delay) => {
    intervalCallback = callback;
    intervalDelay = delay;
    return 17;
  };
  globalThis.clearInterval = (id) => clearedIntervals.push(id);

  await import(`../transition.js?scenario=${++scenario}`);
  await new Promise((resolve) => setImmediate(resolve));

  return {
    document,
    messages,
    navigations,
    clearedIntervals,
    get intervalDelay() { return intervalDelay; },
    tick() { return intervalCallback?.(); },
  };
}

test('sem escolha, a transição mostra cinco segundos e usa o destino automático', async (t) => {
  const page = await mountTransition(t, {
    ok: true,
    url: 'https://trello.com',
    destinations: ['https://trello.com', 'https://substack.com'],
  });
  const countdown = page.document.querySelector('#countdown');

  assert.equal(countdown.textContent, '5');
  assert.equal(page.intervalDelay, 1000);
  assert.equal(page.document.querySelector('#destination-choices').children.length, 2);
  assert.deepEqual(page.navigations, []);

  for (const value of ['4', '3', '2', '1']) {
    await page.tick();
    assert.equal(countdown.textContent, value);
    assert.deepEqual(page.navigations, []);
  }
  await page.tick();

  assert.equal(countdown.textContent, '0');
  assert.deepEqual(page.navigations, ['https://trello.com']);
  assert.deepEqual(page.clearedIntervals, [17]);
});

test('escolher um destino com mesmo domínio redireciona imediatamente e impede o temporizador', async (t) => {
  const page = await mountTransition(t, {
    ok: true,
    url: 'https://trello.com',
    destinations: [
      'https://docs.google.com',
      'https://docs.google.com/document/d/123',
    ],
  });
  const choices = page.document.querySelector('#destination-choices');
  const firstButton = choices.children[0].children[0];
  const secondButton = choices.children[1].children[0];

  assert.notEqual(firstButton.textContent, secondButton.textContent);
  assert.ok(firstButton.attributes['aria-label']);
  assert.ok(secondButton.attributes['aria-label']);
  await secondButton.click();

  assert.deepEqual(page.navigations, ['https://docs.google.com/document/d/123']);
  assert.deepEqual(page.clearedIntervals, [17]);
  await page.tick();
  assert.deepEqual(page.navigations, ['https://docs.google.com/document/d/123']);
});

test('erro ao obter destino é anunciado e não inicia contagem nem oferece opções', async (t) => {
  const page = await mountTransition(t, { ok: false, error: 'Nenhum destino produtivo está configurado.' });

  assert.equal(page.document.querySelector('#transition-status').textContent, 'Nenhum destino produtivo está configurado.');
  assert.equal(page.document.querySelector('#destination-choices').children.length, 0);
  assert.equal(page.intervalDelay, undefined);
  assert.deepEqual(page.navigations, []);
});
