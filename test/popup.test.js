import test from 'node:test';
import assert from 'node:assert/strict';

class FakeElement {
  constructor() { this.listeners = new Map(); this.classNames = new Set(); this.hidden = false; this._textContent = ''; this.classList = { toggle: (name, force) => force ? this.classNames.add(name) : this.classNames.delete(name) }; }
  set textContent(value) { this._textContent = String(value); }
  get textContent() { return this._textContent; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { return this.listeners.get('click')?.(); }
}

let scenario = 0;
async function mountPopup(pause) {
  const elements = new Map();
  globalThis.document = { querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new FakeElement()); return elements.get(selector); } };
  const messages = [];
  globalThis.chrome = { runtime: { async sendMessage(message) { messages.push(message); return { blockedDomains: ['instagram.com'], productiveUrls: ['https://trello.com'], unpermittedDomains: [], pause, statistics: { today: 2, last7Days: 4 } }; }, openOptionsPage() {} } };
  await import(`../popup.js?scenario=${++scenario}`);
  await new Promise((resolve) => setImmediate(resolve));
  return { elements, messages };
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
