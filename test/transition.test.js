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
  emit(type, event = {}) { return this.listeners.get(type)?.(event); }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) { this._textContent = undefined; this.children.push(...nodes); }
  replaceChildren(...nodes) { this._textContent = undefined; this.children = [...nodes]; }
  contains(node) { return node === this || this.children.some((child) => child === node || child.contains?.(node)); }
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
  const intervals = [];
  let activeInterval = null;
  let nextIntervalId = 17;
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
    activeInterval = { callback, id: nextIntervalId++, active: true };
    intervals.push(activeInterval);
    intervalDelay = delay;
    return activeInterval.id;
  };
  globalThis.clearInterval = (id) => {
    clearedIntervals.push(id);
    const interval = intervals.find((candidate) => candidate.id === id);
    if (interval) interval.active = false;
    if (activeInterval?.id === id) activeInterval = null;
  };

  await import(`../transition.js?scenario=${++scenario}`);
  await new Promise((resolve) => setImmediate(resolve));

  return {
    document,
    messages,
    navigations,
    clearedIntervals,
    get intervalDelay() { return intervalDelay; },
    get intervalCount() { return intervals.length; },
    get liveIntervalCount() { return intervals.filter(({ active }) => active).length; },
    tick() { return activeInterval?.callback?.(); },
    emitChoice(type, event = {}) { return document.querySelector('#destination-choices').emit(type, event); },
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

test('foco na lista pausa a contagem e retoma do mesmo segundo ao sair', async (t) => {
  const page = await mountTransition(t, {
    ok: true,
    url: 'https://trello.com',
    destinations: ['https://trello.com', 'https://substack.com'],
  });
  const countdown = page.document.querySelector('#countdown');
  const selectionStatus = page.document.querySelector('#selection-status');

  await page.emitChoice('focusin');
  await page.tick();

  assert.equal(countdown.textContent, '5');
  assert.equal(selectionStatus.textContent, 'Contagem pausada enquanto você escolhe um destino.');
  assert.deepEqual(page.clearedIntervals, [17]);

  await page.emitChoice('focusout');
  assert.equal(selectionStatus.textContent, 'Contagem retomada.');
  await page.tick();
  assert.equal(countdown.textContent, '4');
  assert.equal(page.intervalDelay, 1000);
});

test('ponteiro pausa a contagem para seleção e só retoma quando deixa a área', async (t) => {
  const page = await mountTransition(t, {
    ok: true,
    url: 'https://trello.com',
    destinations: ['https://trello.com', 'https://substack.com'],
  });
  const countdown = page.document.querySelector('#countdown');

  await page.emitChoice('pointerenter', { pointerType: 'mouse' });
  await page.tick();
  assert.equal(countdown.textContent, '5');

  await page.emitChoice('pointerleave', { pointerType: 'mouse' });
  await page.tick();
  assert.equal(countdown.textContent, '4');

  await page.emitChoice('pointerenter', { pointerType: 'touch' });
  await page.tick();
  assert.equal(countdown.textContent, '4');
});

test('foco e ponteiro combinados mantêm o timer pausado até ambos terminarem', async (t) => {
  const page = await mountTransition(t, {
    ok: true,
    url: 'https://trello.com',
    destinations: ['https://trello.com', 'https://substack.com'],
  });
  const countdown = page.document.querySelector('#countdown');

  await page.emitChoice('pointerenter');
  await page.emitChoice('focusin');
  await page.emitChoice('pointerleave');
  await page.tick();
  assert.equal(countdown.textContent, '5');

  await page.emitChoice('focusout');
  await page.tick();
  assert.equal(countdown.textContent, '4');
  assert.deepEqual(page.clearedIntervals, [17]);
});

test('mover o foco entre destinos não retoma o timer durante a navegação', async (t) => {
  const page = await mountTransition(t, {
    ok: true,
    url: 'https://trello.com',
    destinations: ['https://trello.com', 'https://substack.com'],
  });
  const choices = page.document.querySelector('#destination-choices');
  const firstButton = choices.children[0].children[0];
  const secondButton = choices.children[1].children[0];
  const countdown = page.document.querySelector('#countdown');

  await page.emitChoice('focusin', { target: firstButton });
  await page.emitChoice('focusout', { target: firstButton, relatedTarget: secondButton });
  await page.tick();

  assert.equal(countdown.textContent, '5');
  assert.deepEqual(page.clearedIntervals, [17]);

  await page.emitChoice('focusin', { target: secondButton, relatedTarget: firstButton });
  await page.emitChoice('focusout', { target: secondButton });
  await page.tick();
  assert.equal(countdown.textContent, '4');
});

test('eventos repetidos mantêm no máximo um timer ativo', async (t) => {
  const page = await mountTransition(t, {
    ok: true,
    url: 'https://trello.com',
    destinations: ['https://trello.com', 'https://substack.com'],
  });

  await page.emitChoice('pointerenter');
  await page.emitChoice('pointerenter');
  await page.emitChoice('focusin');
  await page.emitChoice('focusin');
  assert.equal(page.intervalCount, 1);
  assert.equal(page.liveIntervalCount, 0);

  await page.emitChoice('pointerleave');
  assert.equal(page.intervalCount, 1);
  assert.equal(page.liveIntervalCount, 0);

  await page.emitChoice('focusout');
  await page.emitChoice('focusout');
  assert.equal(page.intervalCount, 2);
  assert.equal(page.liveIntervalCount, 1);
});

test('erro ao obter destino é anunciado e não inicia contagem nem oferece opções', async (t) => {
  const page = await mountTransition(t, { ok: false, error: 'Nenhum destino produtivo está configurado.' });

  assert.equal(page.document.querySelector('#transition-status').textContent, 'Nenhum destino produtivo está configurado.');
  assert.equal(page.document.querySelector('#destination-choices').children.length, 0);
  assert.equal(page.intervalDelay, undefined);
  assert.deepEqual(page.navigations, []);
});
