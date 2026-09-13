import test from 'node:test';
import assert from 'node:assert/strict';
import { createFocusService } from '../service-worker.js';

function event() {
  const listeners = [];
  return { addListener(listener) { listeners.push(listener); }, async emit(...args) { return Promise.all(listeners.map((listener) => listener(...args))); } };
}

function createChrome({ permissionGranted = true, grantedPermissions = [], topSites = [], topSitesError = null, notificationCreateError = null, notificationClearError = null } = {}) {
  const data = {};
  const rules = [];
  const alarms = new Map();
  const grantedOrigins = new Set();
  const namedPermissions = new Set(grantedPermissions);
  const permissionChecks = [];
  const permissionRequests = [];
  const permissionRemovals = [];
  const notifications = new Map();
  const notificationCreates = [];
  let optionsPageCalls = 0;
  let topSitesCalls = 0;
  return {
    data, rules, alarmStore: alarms, grantedOrigins, permissionChecks, permissionRequests, permissionRemovals, notificationStore: notifications, notificationCreates,
    get optionsPageCalls() { return optionsPageCalls; },
    get topSitesCalls() { return topSitesCalls; },
    grantOrigins(origins) { origins.forEach((origin) => grantedOrigins.add(origin)); },
    revokeOrigins(origins) { origins.forEach((origin) => grantedOrigins.delete(origin)); },
    grantPermissions(permissions) { permissions.forEach((permission) => namedPermissions.add(permission)); },
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
      async contains(request = {}) {
        permissionChecks.push(request);
        const { origins = [], permissions = [] } = request;
        return origins.every((origin) => grantedOrigins.has(origin))
          && permissions.every((permission) => namedPermissions.has(permission));
      },
      async request({ origins = [], permissions = [] }) { permissionRequests.push({ origins, permissions }); if (permissionGranted) { origins.forEach((origin) => grantedOrigins.add(origin)); permissions.forEach((permission) => namedPermissions.add(permission)); } return permissionGranted; },
      async remove({ origins = [] }) { permissionRemovals.push(origins); origins.forEach((origin) => grantedOrigins.delete(origin)); this.onRemoved.emit({ origins }); return true; },
      onRemoved: event(),
    },
    topSites: {
      async get() {
        topSitesCalls += 1;
        if (topSitesError) throw topSitesError;
        return topSites;
      },
    },
    alarms: { create(name, info) { alarms.set(name, info); }, async get(name) { return alarms.get(name); }, async clear(name) { alarms.delete(name); return true; }, onAlarm: event() },
    notifications: {
      async create(id, options) { if (notificationCreateError) throw notificationCreateError; notificationCreates.push({ id, options }); notifications.set(id, options); },
      async clear(id) { if (notificationClearError) throw notificationClearError; return notifications.delete(id); },
    },
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

test('continua a pausa quando a notificação de início falha', async () => {
  const chrome = createChrome({ grantedPermissions: ['notifications'], notificationCreateError: new Error('notificações indisponíveis') });
  chrome.grantOrigins(['*://x.com/*', '*://*.x.com/*']);
  const service = createFocusService(chrome);
  await service.saveConfiguration({ blockedDomains: ['x.com'], productiveUrls: ['https://substack.com'] });

  const result = await service.pause(15, Date.now());

  assert.equal(result.ok, true);
  assert.equal(typeof chrome.data.pauseUntil, 'number');
  assert.equal(chrome.alarmStore.has('resumeProtection'), true);
  assert.deepEqual(chrome.rules, []);
});

test('recupera regras quando a notificação de conclusão falha', async () => {
  const chrome = createChrome({ grantedPermissions: ['notifications'], notificationCreateError: new Error('notificações indisponíveis') });
  chrome.data.blockedDomains = ['instagram.com'];
  chrome.data.productiveUrls = ['https://trello.com'];
  chrome.data.pauseUntil = Date.now() - 1_000;
  chrome.grantOrigins(['*://instagram.com/*', '*://*.instagram.com/*']);
  const service = createFocusService(chrome);

  await service.getState();

  assert.equal(chrome.data.pauseUntil, null);
  assert.equal(chrome.alarmStore.has('resumeProtection'), false);
  assert.equal(chrome.rules.length, 1);
});

test('retoma regras quando limpar a notificação manual falha', async () => {
  const chrome = createChrome({ grantedPermissions: ['notifications'], notificationClearError: new Error('notificações indisponíveis') });
  chrome.grantOrigins(['*://x.com/*', '*://*.x.com/*']);
  const service = createFocusService(chrome);
  await service.saveConfiguration({ blockedDomains: ['x.com'], productiveUrls: ['https://substack.com'] });
  await service.pause(15, Date.now());

  const result = await service.resume();

  assert.deepEqual(result, { ok: true });
  assert.equal(chrome.data.pauseUntil, null);
  assert.equal(chrome.alarmStore.has('resumeProtection'), false);
  assert.equal(chrome.rules.length, 1);
});

test('notifica o início e a recuperação automática de uma pausa uma vez', async () => {
  const chrome = createChrome({ grantedPermissions: ['notifications'] });
  const service = createFocusService(chrome);
  const now = Date.now();
  await service.pause(15, now);
  assert.equal(chrome.notificationStore.has('pause-status'), true);
  assert.match(chrome.notificationStore.get('pause-status').title, /Pausa iniciada/);

  chrome.data.pauseUntil = now - 1;
  service.bindEvents();
  await chrome.alarms.onAlarm.emit({ name: 'resumeProtection' });
  assert.equal(chrome.data.pauseUntil, null);
  assert.match(chrome.notificationStore.get('pause-status').title, /Proteção retomada/);
  const notification = chrome.notificationStore.get('pause-status');
  await service.getState();
  assert.equal(chrome.notificationStore.get('pause-status'), notification);
});

for (const [entryPoint, invoke] of [
  ['inicialização', (service) => service.initialize()],
  ['leitura de estado', (service) => service.getState()],
  ['alocação de redirecionamento', (service) => service.getRedirectTarget()],
]) {
  test(`recupera pausa expirada por ${entryPoint} uma única vez`, async () => {
    const chrome = createChrome({ grantedPermissions: ['notifications'] });
    chrome.data.blockedDomains = ['instagram.com'];
    chrome.data.productiveUrls = ['https://trello.com'];
    chrome.data.pauseUntil = Date.now() - 1_000;
    chrome.grantOrigins(['*://instagram.com/*', '*://*.instagram.com/*']);
    const service = createFocusService(chrome);

    await invoke(service);
    assert.equal(chrome.data.pauseUntil, null);
    assert.equal(chrome.rules.length, 1);
    assert.match(chrome.notificationStore.get('pause-status').title, /Proteção retomada/);
    assert.equal(chrome.notificationCreates.filter(({ id }) => id === 'pause-status').length, 1);

    await service.getState();
    assert.equal(chrome.notificationCreates.filter(({ id }) => id === 'pause-status').length, 1);
  });
}

test('retomada manual remove alarme e notificação sem avisar conclusão', async () => {
  const chrome = createChrome({ grantedPermissions: ['notifications'] });
  const service = createFocusService(chrome);
  await service.pause(15, Date.now());
  assert.equal(chrome.notificationStore.has('pause-status'), true);
  await service.resume();
  assert.equal(chrome.alarmStore.has('resumeProtection'), false);
  assert.equal(chrome.notificationStore.has('pause-status'), false);
});

test('alarme antigo não encerra a pausa que o usuário substituiu', async () => {
  const chrome = createChrome({ grantedPermissions: ['notifications'] });
  const service = createFocusService(chrome);
  const now = Date.now();
  await service.pause(15, now - 15 * 60_000 - 1);
  await service.pause(30, now);
  const replacementPauseUntil = now + 30 * 60_000;
  const replacementAlarm = chrome.alarmStore.get('resumeProtection');
  const replacementNotification = chrome.notificationStore.get('pause-status');
  service.bindEvents();
  await chrome.alarms.onAlarm.emit({ name: 'resumeProtection', scheduledTime: now - 1 });
  assert.equal(chrome.data.pauseUntil, replacementPauseUntil);
  assert.equal(chrome.alarmStore.get('resumeProtection'), replacementAlarm);
  assert.deepEqual(chrome.rules, []);
  assert.equal(chrome.notificationStore.get('pause-status'), replacementNotification);
});

test('recusa salvar domínio sem permissão sem solicitar prompt no worker', async () => {
  const chrome = createChrome();
  const service = createFocusService(chrome);
  const result = await service.saveConfiguration({ blockedDomains: ['facebook.com'], productiveUrls: ['https://trello.com'] });
  assert.deepEqual(result, { ok: false, error: 'Autorize facebook.com em Salvar e ativar para protegê-lo.' });
  assert.deepEqual(chrome.permissionRequests, []);
  assert.deepEqual(chrome.rules, []);
});

test('classifica distração imediatamente e sincroniza sua regra', async () => {
  const chrome = createChrome();
  chrome.data.productiveUrls = ['https://trello.com'];
  chrome.grantOrigins(['*://reddit.com/*', '*://*.reddit.com/*']);
  const service = createFocusService(chrome);

  const result = await service.classifySite('https://www.reddit.com/r/focus?campaign=private', 'blocked');

  assert.deepEqual(result, {
    ok: true,
    changed: true,
    category: 'blocked',
    domain: 'reddit.com',
    hasFocusDestination: true,
  });
  assert.deepEqual(chrome.data.blockedDomains, ['reddit.com']);
  assert.deepEqual(chrome.data.productiveUrls, ['https://trello.com']);
  assert.deepEqual(chrome.rules.map((rule) => rule.condition.urlFilter), ['||reddit.com^']);
});

test('não grava distração se a permissão de domínio não estiver concedida', async () => {
  const chrome = createChrome();
  const service = createFocusService(chrome);

  const result = await service.classifySite('https://reddit.com/r/focus', 'blocked');

  assert.deepEqual(result, {
    ok: false,
    error: 'Autorize reddit.com para adicioná-lo às distrações.',
  });
  assert.equal(chrome.data.blockedDomains, undefined);
  assert.deepEqual(chrome.permissionRequests, []);
  assert.deepEqual(chrome.rules, []);
});

test('salva distração sem destino de foco e mantém a proteção sem regras', async () => {
  const chrome = createChrome();
  chrome.grantOrigins(['*://reddit.com/*', '*://*.reddit.com/*']);
  const service = createFocusService(chrome);

  const result = await service.classifySite('https://reddit.com', 'blocked');

  assert.deepEqual(result, {
    ok: true,
    changed: true,
    category: 'blocked',
    domain: 'reddit.com',
    hasFocusDestination: false,
  });
  assert.deepEqual(chrome.data.blockedDomains, ['reddit.com']);
  assert.deepEqual(chrome.data.productiveUrls, []);
  assert.deepEqual(chrome.rules, []);
});

test('mover distração para foco remove bloqueio e revoga permissão não mais necessária', async () => {
  const chrome = createChrome();
  chrome.data.blockedDomains = ['example.com'];
  chrome.data.productiveUrls = ['https://trello.com'];
  chrome.grantOrigins(['*://example.com/*', '*://*.example.com/*']);
  const service = createFocusService(chrome);

  const result = await service.classifySite('https://docs.example.com/document/1', 'productive');

  assert.deepEqual(result, {
    ok: true,
    changed: true,
    category: 'productive',
    domain: 'docs.example.com',
    hasFocusDestination: true,
  });
  assert.deepEqual(chrome.data.blockedDomains, []);
  assert.deepEqual(chrome.data.productiveUrls, ['https://trello.com', 'https://docs.example.com']);
  assert.deepEqual(chrome.permissionRemovals, [['*://example.com/*', '*://*.example.com/*']]);
  assert.deepEqual(chrome.rules, []);
});

test('mensagem classifySite expõe a categorização rápida à interface', async () => {
  const chrome = createChrome();
  const service = createFocusService(chrome);
  service.bindEvents();
  let respond;
  const response = new Promise((resolve) => { respond = resolve; });

  const keepChannelOpen = await chrome.runtime.onMessage.emit({
    type: 'classifySite', url: 'chrome://settings/', category: 'productive',
  }, {}, respond);

  assert.deepEqual(keepChannelOpen, [true]);
  assert.deepEqual(await response, { ok: false, error: 'Esta página não pode ser classificada.' });
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

test('retorna os destinos produtivos na ordem salva junto com a escolha automática', async () => {
  const chrome = createChrome();
  chrome.data.productiveUrls = [
    'https://trello.com',
    'https://docs.google.com/document/d/123',
    'https://substack.com',
  ];
  chrome.data.rotationIndex = 1;
  const service = createFocusService(chrome);

  const result = await service.getRedirectTarget();

  assert.deepEqual(result, {
    ok: true,
    url: 'https://docs.google.com/document/d/123',
    destinations: [
      'https://trello.com',
      'https://docs.google.com/document/d/123',
      'https://substack.com',
    ],
  });
  assert.equal(chrome.data.rotationIndex, 2);
  assert.equal(Object.values(chrome.data.dailyRedirects).reduce((sum, count) => sum + count, 0), 1);
});

test('estado expõe o próximo destino calculado pela rotação atual', async () => {
  const chrome = createChrome();
  chrome.data.productiveUrls = ['https://trello.com', 'https://substack.com'];
  chrome.data.rotationIndex = 1;
  const service = createFocusService(chrome);
  const state = await service.getState();
  assert.equal(state.nextDestination, 'https://substack.com');
});

test('não consulta os sites frequentes sem a permissão topSites nem altera a configuração', async () => {
  const chrome = createChrome();
  chrome.data.blockedDomains = ['reddit.com'];
  chrome.data.productiveUrls = ['https://docs.google.com'];
  const savedConfiguration = structuredClone(chrome.data);
  const service = createFocusService(chrome);

  const result = await service.getTopSites?.();

  assert.equal(result?.ok, false);
  assert.equal(typeof result?.error, 'string');
  assert.ok(chrome.permissionChecks.some((request) => JSON.stringify(request) === JSON.stringify({ permissions: ['topSites'] })));
  assert.equal(chrome.topSitesCalls, 0);
  assert.deepEqual(chrome.data, savedConfiguration);
});

test('consulta os sites frequentes permitidos, normaliza e deduplica sem salvá-los', async () => {
  const chrome = createChrome({ topSites: [
    { url: 'https://www.Example.com/path?campaign=1#section', title: 'Example' },
    { url: 'http://example.com/another-page', title: 'Duplicate' },
    { url: 'ftp://files.example.net/download', title: 'Unsupported protocol' },
    { url: 'chrome://settings', title: 'Browser settings' },
    { url: 'https://localhost/local', title: 'Invalid host' },
  ] });
  chrome.grantPermissions(['topSites']);
  chrome.data.blockedDomains = ['reddit.com'];
  chrome.data.productiveUrls = ['https://docs.google.com'];
  const savedConfiguration = structuredClone(chrome.data);
  const service = createFocusService(chrome);

  const result = await service.getTopSites?.();

  assert.deepEqual(result, {
    ok: true,
    sites: [{ domain: 'example.com', productiveUrl: 'https://example.com' }],
  });
  assert.equal(chrome.topSitesCalls, 1);
  assert.deepEqual(chrome.data, savedConfiguration);
});

test('mensagem getTopSites do runtime responde com os sites consultados', async () => {
  const chrome = createChrome({ topSites: [{ url: 'https://www.example.org/path', title: 'Example' }] });
  chrome.grantPermissions(['topSites']);
  const service = createFocusService(chrome);
  service.bindEvents();
  let respond;
  const response = new Promise((resolve) => { respond = resolve; });

  const keepChannelOpen = await chrome.runtime.onMessage.emit({ type: 'getTopSites' }, {}, respond);

  assert.deepEqual(keepChannelOpen, [true]);
  assert.deepEqual(await response, {
    ok: true,
    sites: [{ domain: 'example.org', productiveUrl: 'https://example.org' }],
  });
});
