import test from 'node:test';
import assert from 'node:assert/strict';
import { createFocusService } from '../service-worker.js';

function event() {
  const listeners = [];
  return { addListener(listener) { listeners.push(listener); }, async emit(...args) { return Promise.all(listeners.map((listener) => listener(...args))); } };
}

function createChrome({ permissionGranted = true } = {}) {
  const data = {};
  const rules = [];
  const alarms = new Map();
  const grantedOrigins = new Set();
  const permissionRequests = [];
  const permissionRemovals = [];
  let optionsPageCalls = 0;
  return {
    data, rules, alarmStore: alarms, grantedOrigins, permissionRequests, permissionRemovals,
    get optionsPageCalls() { return optionsPageCalls; },
    grantOrigins(origins) { origins.forEach((origin) => grantedOrigins.add(origin)); },
    revokeOrigins(origins) { origins.forEach((origin) => grantedOrigins.delete(origin)); },
    storage: { local: {
      async get(defaults) { return { ...defaults, ...data }; },
      async set(values) { Object.assign(data, values); },
    } },
    declarativeNetRequest: {
      async getDynamicRules() { return [...rules]; },
      async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
        for (const id of removeRuleIds) { const index = rules.findIndex((rule) => rule.id === id); if (index >= 0) rules.splice(index, 1); }
        rules.push(...addRules);
      },
    },
    permissions: {
      async contains({ origins = [] }) { return origins.every((origin) => grantedOrigins.has(origin)); },
      async request({ origins = [] }) { permissionRequests.push(origins); if (permissionGranted) origins.forEach((origin) => grantedOrigins.add(origin)); return permissionGranted; },
      async remove({ origins = [] }) { permissionRemovals.push(origins); origins.forEach((origin) => grantedOrigins.delete(origin)); this.onRemoved.emit({ origins }); return true; },
      onRemoved: event(),
    },
    alarms: { create(name, info) { alarms.set(name, info); }, async get(name) { return alarms.get(name); }, async clear(name) { alarms.delete(name); return true; }, onAlarm: event() },
    runtime: {
      onInstalled: event(), onStartup: event(), onMessage: event(), lastError: null,
      async openOptionsPage() { optionsPageCalls += 1; },
    },
  };
}

test('instala estado local seguro sem regras quando não há destino', async () => {
  const chrome = createChrome();
  const service = createFocusService(chrome);
  await service.initialize();
  assert.deepEqual(chrome.data.blockedDomains, []);
  assert.deepEqual(chrome.data.productiveUrls, []);
  assert.deepEqual(chrome.rules, []);
});

test('salvar configuração autorizada cria regra main_frame', async () => {
  const chrome = createChrome();
  const service = createFocusService(chrome);
  chrome.grantOrigins(['*://instagram.com/*', '*://*.instagram.com/*']);
  const result = await service.saveConfiguration({
    blockedDomains: ['instagram.com'], productiveUrls: ['https://trello.com/board'],
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(chrome.data.blockedDomains[0], 'instagram.com');
  assert.deepEqual(chrome.rules[0].condition.resourceTypes, ['main_frame']);
});

test('pausar remove regras e retomar restaura regras', async () => {
  const chrome = createChrome();
  const service = createFocusService(chrome);
  chrome.grantOrigins(['*://x.com/*', '*://*.x.com/*']);
  await service.saveConfiguration({ blockedDomains: ['x.com'], productiveUrls: ['https://substack.com'] });
  const now = Date.now();
  await service.pause(15, now);
  assert.deepEqual(chrome.rules, []);
  assert.equal(chrome.alarmStore.get('resumeProtection').when, now + 900_000);
  await service.resume();
  assert.equal(chrome.data.pauseUntil, null);
  assert.equal(chrome.rules.length, 1);
});

test('recusa salvar domínio sem permissão sem solicitar prompt no worker', async () => {
  const chrome = createChrome();
  const service = createFocusService(chrome);
  const result = await service.saveConfiguration({ blockedDomains: ['facebook.com'], productiveUrls: ['https://trello.com'] });
  assert.deepEqual(result, { ok: false, error: 'Autorize facebook.com em Salvar e ativar para protegê-lo.' });
  assert.deepEqual(chrome.permissionRequests, []);
  assert.deepEqual(chrome.rules, []);
});

test('configuração com conflito não persiste estado nem ativa regras', async () => {
  const chrome = createChrome();
  chrome.grantOrigins(['*://instagram.com/*', '*://*.instagram.com/*']);
  const service = createFocusService(chrome);
  const result = await service.saveConfiguration({
    blockedDomains: ['instagram.com'], productiveUrls: ['https://m.instagram.com/trabalho'],
  });
  assert.deepEqual(result, { ok: false, error: 'Um destino produtivo não pode usar um domínio bloqueado.' });
  assert.equal(chrome.data.blockedDomains, undefined);
  assert.deepEqual(chrome.permissionRequests, []);
  assert.deepEqual(chrome.rules, []);
});

test('expõe a posição da rotação para anunciar o próximo destino', async () => {
  const chrome = createChrome();
  chrome.data.productiveUrls = ['https://trello.com', 'https://substack.com'];
  chrome.data.rotationIndex = 1;
  const service = createFocusService(chrome);
  const state = await service.getState();
  assert.equal(state.rotationIndex, 1);
});

test('abre configurações uma única vez depois da primeira instalação', async () => {
  const chrome = createChrome();
  const service = createFocusService(chrome);
  service.bindEvents();
  await chrome.runtime.onInstalled.emit({ reason: 'install' });
  assert.equal(chrome.data.onboardingShown, true);
  assert.equal(chrome.optionsPageCalls, 1);
  await chrome.runtime.onInstalled.emit({ reason: 'update' });
  await chrome.runtime.onStartup.emit();
  await chrome.runtime.onInstalled.emit({ reason: 'install' });
  assert.equal(chrome.optionsPageCalls, 1);
});

test('inicialização remove pausa expirada e restaura regra main_frame', async () => {
  const chrome = createChrome();
  chrome.data.blockedDomains = ['instagram.com'];
  chrome.data.productiveUrls = ['https://trello.com'];
  chrome.data.pauseUntil = Date.now() - 1_000;
  chrome.grantOrigins(['*://instagram.com/*', '*://*.instagram.com/*']);
  const service = createFocusService(chrome);
  await service.initialize();
  assert.equal(chrome.data.pauseUntil, null);
  assert.deepEqual(chrome.rules[0].condition.resourceTypes, ['main_frame']);
});

test('ler estado remove pausa expirada e restaura a regra quando é a primeira operação', async () => {
  const chrome = createChrome();
  chrome.data.blockedDomains = ['instagram.com'];
  chrome.data.productiveUrls = ['https://trello.com'];
  chrome.data.pauseUntil = Date.now() - 1_000;
  chrome.grantOrigins(['*://instagram.com/*', '*://*.instagram.com/*']);
  const service = createFocusService(chrome);
  await service.getState();
  assert.equal(chrome.data.pauseUntil, null);
  assert.deepEqual(chrome.rules[0].condition.resourceTypes, ['main_frame']);
});

test('inicialização recria o alarme ausente para uma pausa futura', async () => {
  const chrome = createChrome();
  const pauseUntil = Date.now() + 15 * 60_000;
  chrome.data.pauseUntil = pauseUntil;
  const service = createFocusService(chrome);
  await service.initialize();
  assert.equal(chrome.alarmStore.get('resumeProtection').when, pauseUntil);
  assert.deepEqual(chrome.rules, []);
});

test('remove regra e informa domínio sem permissão quando a concessão é revogada', async () => {
  const chrome = createChrome();
  chrome.data.blockedDomains = ['instagram.com'];
  chrome.data.productiveUrls = ['https://trello.com'];
  chrome.grantOrigins(['*://instagram.com/*', '*://*.instagram.com/*']);
  const service = createFocusService(chrome);
  service.bindEvents();
  await service.initialize();
  chrome.revokeOrigins(['*://instagram.com/*', '*://*.instagram.com/*']);
  await chrome.permissions.onRemoved.emit({ origins: ['*://instagram.com/*', '*://*.instagram.com/*'] });
  const state = await service.getState();
  assert.deepEqual(chrome.rules, []);
  assert.deepEqual(state.unpermittedDomains, ['instagram.com']);
});

test('inicialização preserva configuração sem concessão, mas não cria sua regra', async () => {
  const chrome = createChrome();
  chrome.data.blockedDomains = ['instagram.com'];
  chrome.data.productiveUrls = ['https://trello.com'];
  const service = createFocusService(chrome);
  await service.initialize();
  const state = await service.getState();
  assert.deepEqual(chrome.rules, []);
  assert.deepEqual(state.unpermittedDomains, ['instagram.com']);
});

test('remover domínio salvo revoga suas origens opcionais', async () => {
  const chrome = createChrome();
  chrome.data.blockedDomains = ['instagram.com'];
  chrome.data.productiveUrls = ['https://trello.com'];
  chrome.grantOrigins(['*://instagram.com/*', '*://*.instagram.com/*']);
  const service = createFocusService(chrome);
  const result = await service.saveConfiguration({ blockedDomains: [], productiveUrls: ['https://trello.com'] });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(chrome.permissionRemovals, [['*://instagram.com/*', '*://*.instagram.com/*']]);
  assert.deepEqual(chrome.data.blockedDomains, []);
});

test('evento de remoção durante salvamento preserva somente a nova regra', async () => {
  const chrome = createChrome();
  chrome.data.blockedDomains = ['instagram.com'];
  chrome.data.productiveUrls = ['https://trello.com'];
  chrome.grantOrigins(['*://instagram.com/*', '*://*.instagram.com/*', '*://facebook.com/*', '*://*.facebook.com/*']);
  const service = createFocusService(chrome);
  service.bindEvents();
  await service.initialize();
  const result = await service.saveConfiguration({ blockedDomains: ['facebook.com'], productiveUrls: ['https://trello.com'] });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(chrome.data.blockedDomains, ['facebook.com']);
  assert.deepEqual(chrome.rules.map((rule) => rule.condition.urlFilter), ['||facebook.com^']);
});

test('transições concorrentes recebem destinos consecutivos e preservam a rotação', async () => {
  const chrome = createChrome();
  chrome.data.productiveUrls = ['https://trello.com', 'https://substack.com'];
  const service = createFocusService(chrome);
  const [first, second] = await Promise.all([service.getRedirectTarget(), service.getRedirectTarget()]);
  assert.deepEqual([first.url, second.url], ['https://trello.com', 'https://substack.com']);
  assert.equal(chrome.data.rotationIndex, 0);
  assert.equal(Object.values(chrome.data.dailyRedirects).reduce((sum, count) => sum + count, 0), 2);
});

test('estado expõe o próximo destino calculado pela rotação atual', async () => {
  const chrome = createChrome();
  chrome.data.productiveUrls = ['https://trello.com', 'https://substack.com'];
  chrome.data.rotationIndex = 1;
  const service = createFocusService(chrome);
  const state = await service.getState();
  assert.equal(state.nextDestination, 'https://substack.com');
});
