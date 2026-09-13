import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../lib/core.js';
const {
  buildRedirectRules,
  classifyTopSite,
  domainsOverlap,
  hostPermissionOrigins,
  nextRotation,
  normalizeDomain,
  normalizeProductiveUrl,
  normalizeTopSites,
  pauseState,
  recordRedirect,
  statistics,
  validateConfiguration,
} = core;
const remainingPauseMinutes = core.remainingPauseMinutes ?? (() => null);

test('normaliza domínio e reconhece raiz e subdomínios', () => {
  assert.equal(normalizeDomain(' HTTPS://WWW.Instagram.com/reels/ '), 'instagram.com');
  assert.equal(domainsOverlap('instagram.com', 'm.instagram.com'), true);
  assert.equal(domainsOverlap('instagram.com', 'instagram.org'), false);
});

test('rejeita domínio e URL produtiva inválidos', () => {
  assert.throws(() => normalizeDomain('localhost'), /Domínio inválido/);
  assert.throws(() => normalizeProductiveUrl('ftp://trello.com'), /URL inválida/);
  assert.equal(normalizeProductiveUrl('trello.com/pessoal'), 'https://trello.com/pessoal');
});

test('normaliza sites frequentes em domínios e URLs-base', () => {
  assert.deepEqual(normalizeTopSites([
    { url: 'https://www.youtube.com/watch?v=example' },
    { url: 'http://www.example.com/caminho?segredo=1#secao' },
  ]), [
    { domain: 'youtube.com', productiveUrl: 'https://youtube.com' },
    { domain: 'example.com', productiveUrl: 'http://example.com' },
  ]);
});

test('ignora sites frequentes que não sejam HTTP(S) e remove domínios duplicados', () => {
  assert.deepEqual(normalizeTopSites([
    { url: 'chrome://settings/' },
    { url: 'file:///tmp/page.html' },
    { url: 'https://www.example.com/primeira' },
    { url: 'https://example.com/segunda' },
    { url: 'not a URL' },
  ]), [
    { domain: 'example.com', productiveUrl: 'https://example.com' },
  ]);
});

test('classifica um site frequente na lista escolhida sem alterar a outra lista', () => {
  assert.deepEqual(classifyTopSite({
    blockedDomains: ['instagram.com'],
    productiveUrls: ['https://trello.com'],
  }, { domain: 'reddit.com', productiveUrl: 'https://reddit.com' }, 'blocked'), {
    ok: true,
    configuration: {
      blockedDomains: ['instagram.com', 'reddit.com'],
      productiveUrls: ['https://trello.com'],
    },
  });
  assert.deepEqual(classifyTopSite({
    blockedDomains: ['instagram.com'],
    productiveUrls: ['https://trello.com'],
  }, { domain: 'docs.google.com', productiveUrl: 'https://docs.google.com' }, 'productive'), {
    ok: true,
    configuration: {
      blockedDomains: ['instagram.com'],
      productiveUrls: ['https://trello.com', 'https://docs.google.com'],
    },
  });
  assert.deepEqual(classifyTopSite({
    blockedDomains: ['reddit.com'],
    productiveUrls: ['https://trello.com'],
  }, { domain: 'old.reddit.com', productiveUrl: 'https://old.reddit.com' }, 'blocked'), {
    ok: false,
    error: 'Esse item já está na lista.',
  });
});

test('recusa classificar um site frequente quando ele conflita com a outra lista', () => {
  const configuration = { blockedDomains: ['instagram.com'], productiveUrls: ['https://youtube.com'] };
  assert.deepEqual(classifyTopSite(configuration, {
    domain: 'www.youtube.com', productiveUrl: 'https://youtube.com',
  }, 'blocked'), {
    ok: false,
    error: 'Um destino produtivo não pode usar um domínio bloqueado.',
  });
  assert.deepEqual(classifyTopSite(configuration, {
    domain: 'instagram.com', productiveUrl: 'https://instagram.com',
  }, 'productive'), {
    ok: false,
    error: 'Um destino produtivo não pode usar um domínio bloqueado.',
  });
});

test('impede domínio bloqueado de coincidir com destino produtivo', () => {
  const result = validateConfiguration({
    blockedDomains: ['instagram.com'],
    productiveUrls: ['https://m.instagram.com/trabalho'],
  });
  assert.deepEqual(result, { ok: false, error: 'Um destino produtivo não pode usar um domínio bloqueado.' });
});

test('rejeita domínios bloqueados duplicados após normalização', () => {
  assert.deepEqual(validateConfiguration({
    blockedDomains: ['www.instagram.com', 'instagram.com'],
    productiveUrls: ['https://trello.com'],
  }), { ok: false, error: 'Não repita o mesmo domínio bloqueado.' });
});

test('aceita lista bloqueada vazia e exige ao menos um destino para proteger', () => {
  assert.deepEqual(validateConfiguration({ blockedDomains: [], productiveUrls: [] }), {
    ok: false,
    error: 'Adicione ao menos um destino produtivo para ativar a proteção.',
  });
  assert.deepEqual(validateConfiguration({ blockedDomains: [], productiveUrls: ['https://trello.com'] }), { ok: true });
});

test('gera regras DNR somente para navegações main_frame', () => {
  assert.deepEqual(buildRedirectRules(['facebook.com', 'x.com']), [
    {
      id: 1,
      priority: 1,
      action: { type: 'redirect', redirect: { extensionPath: '/transition.html' } },
      condition: { urlFilter: '||facebook.com^', resourceTypes: ['main_frame'] },
    },
    {
      id: 2,
      priority: 1,
      action: { type: 'redirect', redirect: { extensionPath: '/transition.html' } },
      condition: { urlFilter: '||x.com^', resourceTypes: ['main_frame'] },
    },
  ]);
});

test('gera origens de permissão para raiz e subdomínios em uma única lista', () => {
  assert.deepEqual(hostPermissionOrigins(['instagram.com', 'x.com', 'instagram.com']), [
    '*://instagram.com/*', '*://*.instagram.com/*', '*://x.com/*', '*://*.x.com/*',
  ]);
});

test('rotação retorna próximo destino e persiste índice circular', () => {
  assert.deepEqual(nextRotation(['https://trello.com', 'https://substack.com'], 0), {
    url: 'https://trello.com', nextIndex: 1,
  });
  assert.deepEqual(nextRotation(['https://trello.com', 'https://substack.com'], 3), {
    url: 'https://substack.com', nextIndex: 0,
  });
  assert.equal(nextRotation([], 0), null);
});

test('conta redirecionamentos de hoje e dos últimos sete dias', () => {
  const now = new Date('2026-09-12T12:00:00Z');
  const daily = recordRedirect({ '2026-09-05': 2, '2026-09-11': 3 }, now);
  assert.deepEqual(daily, { '2026-09-05': 2, '2026-09-11': 3, '2026-09-12': 1 });
  assert.deepEqual(statistics(daily, now), { today: 1, last7Days: 4 });
});

test('usa a data local brasileira na virada do dia', () => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'America/Recife';
  try {
    const now = new Date('2026-09-12T02:30:00Z');
    const daily = recordRedirect({}, now);
    assert.deepEqual(daily, { '2026-09-11': 1 });
    assert.deepEqual(statistics(daily, now), { today: 1, last7Days: 1 });
  } finally {
    process.env.TZ = previousZone;
  }
});

test('informa pausa ativa, expirada e ausente', () => {
  const now = 1_000;
  assert.deepEqual(pauseState(2_000, now), { paused: true, pauseUntil: 2_000 });
  assert.deepEqual(pauseState(1_000, now), { paused: false, pauseUntil: null });
  assert.deepEqual(pauseState(null, now), { paused: false, pauseUntil: null });
});

test('calcula minutos inteiros restantes arredondando para cima', () => {
  const now = 1_000_000;
  assert.equal(remainingPauseMinutes(now + 60_000, now), 1);
  assert.equal(remainingPauseMinutes(now + 60_001, now), 2);
  assert.equal(remainingPauseMinutes(now + 1, now), 1);
  assert.equal(remainingPauseMinutes(now, now), null);
  assert.equal(remainingPauseMinutes(null, now), null);
});
