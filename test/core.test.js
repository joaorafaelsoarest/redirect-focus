import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRedirectRules,
  domainsOverlap,
  hostPermissionOrigins,
  nextRotation,
  normalizeDomain,
  normalizeProductiveUrl,
  pauseState,
  recordRedirect,
  statistics,
  validateConfiguration,
} from '../lib/core.js';

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
