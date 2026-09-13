import {
  buildRedirectRules,
  hostPermissionOrigins,
  nextRotation,
  normalizeDomain,
  normalizeProductiveUrl,
  normalizeTopSites,
  pauseState,
  recordRedirect,
  statistics,
  validateConfiguration,
} from './lib/core.js';

const DEFAULTS = {
  blockedDomains: [],
  productiveUrls: [],
  rotationIndex: 0,
  pauseUntil: null,
  dailyRedirects: {},
  onboardingShown: false,
};
const RESUME_ALARM = 'resumeProtection';

function dateBefore(days, now = new Date()) {
  const value = new Date(now);
  value.setDate(value.getDate() - days);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function pruneDaily(daily, now = new Date()) {
  const minimum = dateBefore(7, now);
  return Object.fromEntries(Object.entries(daily).filter(([key]) => key >= minimum));
}

export function createFocusService(chromeApi) {
  let operationQueue = Promise.resolve();
  function serialize(operation) {
    const task = operationQueue.then(operation);
    operationQueue = task.catch(() => undefined);
    return task;
  }
  async function configuration() {
    return chromeApi.storage.local.get(DEFAULTS);
  }

  async function synchronizeRulesInternal(state) {
    const currentState = state ?? await configuration();
    const current = await chromeApi.declarativeNetRequest.getDynamicRules();
    const paused = pauseState(currentState.pauseUntil).paused;
    const permittedDomains = await Promise.all(currentState.blockedDomains.map(async (domain) => (
      await chromeApi.permissions.contains({ origins: hostPermissionOrigins([domain]) }) ? domain : null
    )));
    const addRules = !paused && currentState.productiveUrls.length > 0
      ? buildRedirectRules(permittedDomains.filter(Boolean))
      : [];
    await chromeApi.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: current.map((rule) => rule.id),
      addRules,
    });
  }
  function synchronizeRules(state) { return serialize(() => synchronizeRulesInternal(state)); }

  async function normalizeState(state) {
    const pause = pauseState(state.pauseUntil);
    if (state.pauseUntil && !pause.paused) {
      await chromeApi.storage.local.set({ pauseUntil: null });
      return { ...state, pauseUntil: null };
    }
    return state;
  }

  async function initializeInternal() {
    const state = await normalizeState(await configuration());
    const initialized = { ...state, dailyRedirects: pruneDaily(state.dailyRedirects) };
    await chromeApi.storage.local.set(initialized);
    if (pauseState(initialized.pauseUntil).paused) {
      const alarm = await chromeApi.alarms.get(RESUME_ALARM);
      if (!alarm) await chromeApi.alarms.create(RESUME_ALARM, { when: initialized.pauseUntil });
    }
    await synchronizeRulesInternal(initialized);
  }
  function initialize() { return serialize(initializeInternal); }

  async function missingPermissions(domains) {
    const checks = await Promise.all(domains.map(async (domain) => ({
      domain,
      granted: await chromeApi.permissions.contains({ origins: hostPermissionOrigins([domain]) }),
    })));
    return checks.filter(({ granted }) => !granted).map(({ domain }) => domain);
  }

  async function saveConfigurationInternal(raw) {
    const validation = validateConfiguration(raw);
    if (!validation.ok) return validation;
    const blockedDomains = raw.blockedDomains.map(normalizeDomain);
    const productiveUrls = raw.productiveUrls.map(normalizeProductiveUrl);
    const missing = await missingPermissions(blockedDomains);
    if (missing.length) return { ok: false, error: `Autorize ${missing[0]} em Salvar e ativar para protegê-lo.` };
    const state = await configuration();
    const removedDomains = state.blockedDomains.filter((domain) => !blockedDomains.includes(domain));
    if (removedDomains.length) {
      const removed = await chromeApi.permissions.remove({ origins: hostPermissionOrigins(removedDomains) });
      if (!removed) return { ok: false, error: 'Não foi possível revogar a permissão do domínio removido.' };
    }
    const next = { ...state, blockedDomains, productiveUrls };
    await chromeApi.storage.local.set({ blockedDomains, productiveUrls });
    await synchronizeRulesInternal(next);
    return { ok: true };
  }
  function saveConfiguration(raw) { return serialize(() => saveConfigurationInternal(raw)); }

  async function pauseInternal(minutes, now = Date.now()) {
    if (![15, 30, 60].includes(Number(minutes))) {
      return { ok: false, error: 'Escolha uma pausa de 15, 30 ou 60 minutos.' };
    }
    const pauseUntil = now + Number(minutes) * 60_000;
    await chromeApi.storage.local.set({ pauseUntil });
    chromeApi.alarms.create(RESUME_ALARM, { when: pauseUntil });
    await synchronizeRulesInternal({ ...await configuration(), pauseUntil });
    return { ok: true, pauseUntil };
  }
  function pause(minutes, now) { return serialize(() => pauseInternal(minutes, now)); }

  async function resumeInternal() {
    await chromeApi.storage.local.set({ pauseUntil: null });
    await chromeApi.alarms.clear(RESUME_ALARM);
    await synchronizeRulesInternal({ ...await configuration(), pauseUntil: null });
    return { ok: true };
  }
  function resume() { return serialize(resumeInternal); }

  async function getStateInternal() {
    const rawState = await configuration();
    const expired = rawState.pauseUntil && !pauseState(rawState.pauseUntil).paused;
    const state = await normalizeState(rawState);
    if (expired) await synchronizeRulesInternal(state);
    const unpermittedDomains = await missingPermissions(state.blockedDomains);
    const rotation = nextRotation(state.productiveUrls, state.rotationIndex);
    return {
      blockedDomains: state.blockedDomains,
      productiveUrls: state.productiveUrls,
      rotationIndex: state.rotationIndex,
      nextDestination: rotation?.url ?? null,
      unpermittedDomains,
      pause: pauseState(state.pauseUntil),
      statistics: statistics(state.dailyRedirects),
    };
  }
  function getState() { return serialize(getStateInternal); }

  async function allocateRedirectTarget() {
    const state = await normalizeState(await configuration());
    if (pauseState(state.pauseUntil).paused) return { ok: false, error: 'A proteção está pausada.' };
    const rotation = nextRotation(state.productiveUrls, state.rotationIndex);
    if (!rotation) return { ok: false, error: 'Nenhum destino produtivo está configurado.' };
    const dailyRedirects = pruneDaily(recordRedirect(state.dailyRedirects));
    await chromeApi.storage.local.set({ rotationIndex: rotation.nextIndex, dailyRedirects });
    return { ok: true, url: rotation.url, destinations: [...state.productiveUrls] };
  }

  function getRedirectTarget() {
    return serialize(allocateRedirectTarget);
  }

  async function getTopSites() {
    const permitted = await chromeApi.permissions.contains({ permissions: ['topSites'] });
    if (!permitted) {
      return { ok: false, error: 'Autorize o acesso aos sites mais visitados do Chrome para buscar sugestões.' };
    }
    try {
      const entries = await chromeApi.topSites.get();
      return { ok: true, sites: normalizeTopSites(entries) };
    } catch (error) {
      return { ok: false, error: error.message || 'Não foi possível buscar os sites mais visitados.' };
    }
  }

  async function handleInstalled(details) {
    await initialize();
    if (details?.reason !== 'install') return;
    const state = await configuration();
    if (state.onboardingShown) return;
    await chromeApi.storage.local.set({ onboardingShown: true });
    await chromeApi.runtime.openOptionsPage();
  }

  function bindEvents() {
    chromeApi.runtime.onInstalled.addListener(handleInstalled);
    chromeApi.runtime.onStartup.addListener(() => initialize());
    chromeApi.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === RESUME_ALARM) resume();
    });
    chromeApi.permissions.onRemoved.addListener(() => synchronizeRules());
    chromeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const actions = {
        getState,
        saveConfiguration: () => saveConfiguration(message.configuration),
        pause: () => pause(message.minutes),
        resume,
        getRedirectTarget,
        getTopSites,
      };
      const action = actions[message?.type];
      if (!action) return false;
      action().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    });
  }

  return { initialize, saveConfiguration, pause, resume, getState, getRedirectTarget, getTopSites, synchronizeRules, bindEvents };
}

if (typeof globalThis.chrome !== 'undefined') {
  createFocusService(globalThis.chrome).bindEvents();
}
