import {
  domainsOverlap,
  hostPermissionOrigins,
  normalizeCurrentSite,
  normalizeProductiveUrl,
  remainingPauseMinutes,
} from './lib/core.js';

const status = document.querySelector('#protection-status');
const today = document.querySelector('#today-total');
const week = document.querySelector('#week-total');
const resumeButton = document.querySelector('#resume');
const currentSiteDomain = document.querySelector('#current-site-domain');
const classificationStatus = document.querySelector('#classification-status');
const focusButton = document.querySelector('#classify-focus');
const distractionButton = document.querySelector('#classify-distraction');
let currentPause = null;
let displayedPauseMinutes = null;
let pauseRefreshTimer;
let currentTabUrl = null;
let currentSite = null;
let currentCategory = null;
let stateLoaded = false;
let isClassifying = false;

async function message(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}

function setClassificationStatus(text, error = false) {
  classificationStatus.textContent = text;
  classificationStatus.classList.toggle('error', error);
}

function updateClassificationButtons() {
  focusButton.textContent = currentCategory === 'productive' ? 'Já está em Foco' : 'Adicionar à lista de Foco';
  distractionButton.textContent = currentCategory === 'blocked' ? 'Já está em Distração' : 'Adicionar à lista de Distração';
  focusButton.disabled = !currentSite || !stateLoaded || isClassifying || currentCategory === 'productive';
  distractionButton.disabled = !currentSite || !stateLoaded || isClassifying || currentCategory === 'blocked';
}

function renderCurrentCategory(state) {
  const blocked = (state.blockedDomains ?? []).some((domain) => {
    try { return domainsOverlap(currentSite.domain, domain); } catch { return false; }
  });
  const productive = (state.productiveUrls ?? []).some((url) => {
    try { return domainsOverlap(currentSite.domain, new URL(normalizeProductiveUrl(url)).hostname); } catch { return false; }
  });

  currentCategory = blocked && productive ? 'conflict' : blocked ? 'blocked' : productive ? 'productive' : null;
  if (currentCategory === 'conflict') setClassificationStatus('Este domínio aparece nas duas listas. Escolha uma categoria para corrigir.');
  else if (currentCategory === 'blocked') setClassificationStatus('Este site já está em Distração.');
  else if (currentCategory === 'productive') setClassificationStatus('Este site já está em Foco.');
  else setClassificationStatus('Este site ainda não está classificado.');
  updateClassificationButtons();
}

async function classify(category) {
  if (!currentSite || !currentTabUrl || !stateLoaded || isClassifying) return;
  isClassifying = true;
  updateClassificationButtons();

  try {
    if (category === 'blocked') {
      const granted = await chrome.permissions.request({ origins: hostPermissionOrigins([currentSite.domain]) });
      if (!granted) {
        setClassificationStatus('Permissão negada. Nada foi alterado.', true);
        return;
      }
    }

    const result = await message('classifySite', { url: currentTabUrl, category });
    if (!result?.ok) {
      setClassificationStatus(result?.error || 'Não foi possível atualizar a categoria.', true);
      return;
    }

    currentCategory = category;
    updateClassificationButtons();
    if (!result.changed) {
      setClassificationStatus(`${currentSite.domain} já está em ${category === 'blocked' ? 'Distração' : 'Foco'}.`);
    } else if (category === 'blocked' && !result.hasFocusDestination) {
      setClassificationStatus(`${currentSite.domain} adicionado à lista de Distração. Configure ao menos um destino de Foco para ativar a proteção.`);
    } else {
      setClassificationStatus(`${currentSite.domain} adicionado à lista de ${category === 'blocked' ? 'Distração' : 'Foco'}.`);
    }
  } catch {
    setClassificationStatus('Não foi possível atualizar a categoria agora.', true);
  } finally {
    isClassifying = false;
    updateClassificationButtons();
  }
}

async function load() {
  const [stateResult, tabsResult] = await Promise.allSettled([
    message('getState'),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);

  let state = null;
  if (stateResult.status === 'fulfilled') {
    state = stateResult.value;
    stateLoaded = true;
    today.textContent = state.statistics.today;
    week.textContent = state.statistics.last7Days;
    const protectedDomains = state.blockedDomains.length - state.unpermittedDomains.length;
    const active = protectedDomains > 0 && state.productiveUrls.length > 0 && !state.pause.paused;
    currentPause = state.pause;
    const remainingMinutes = state.pause.paused ? remainingPauseMinutes(state.pause.pauseUntil) : null;
    resumeButton.hidden = remainingMinutes === null;
    if (!state.pause.paused || remainingMinutes !== displayedPauseMinutes) {
      status.textContent = state.pause.paused
      ? `Proteção pausada. ${remainingMinutes} minuto${remainingMinutes === 1 ? '' : 's'} restante${remainingMinutes === 1 ? '' : 's'}.`
      : state.unpermittedDomains.length > 0
        ? `${protectedDomains} de ${state.blockedDomains.length} domínios protegidos. Reautorize os demais nas configurações.`
        : active ? `Proteção ativa em ${protectedDomains} domínio${protectedDomains === 1 ? '' : 's'}.` : 'Proteção precisa de domínios e um destino produtivo.';
      displayedPauseMinutes = remainingMinutes;
    }
    status.classList.toggle('active', active);
    clearTimeout(pauseRefreshTimer);
    if (remainingMinutes !== null) {
      const delay = Math.max(1, state.pause.pauseUntil - Date.now() - (remainingMinutes - 1) * 60_000) + 10;
      pauseRefreshTimer = setTimeout(load, delay);
      pauseRefreshTimer.unref?.();
    }
  } else {
    status.textContent = 'Não foi possível carregar o estado da proteção.';
    setClassificationStatus('Não foi possível carregar as categorias salvas.', true);
  }

  if (tabsResult.status === 'fulfilled') {
    currentTabUrl = tabsResult.value[0]?.url ?? null;
    try {
      currentSite = normalizeCurrentSite(currentTabUrl);
      currentSiteDomain.textContent = currentSite.domain;
      if (state) renderCurrentCategory(state);
      else updateClassificationButtons();
    } catch (error) {
      currentSite = null;
      currentSiteDomain.textContent = '';
      setClassificationStatus(error.message, true);
      updateClassificationButtons();
    }
  } else {
    currentSite = null;
    currentTabUrl = null;
    currentSiteDomain.textContent = '';
    setClassificationStatus('Não foi possível identificar a aba ativa.', true);
    updateClassificationButtons();
  }
}

document.querySelector('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
focusButton.addEventListener('click', () => classify('productive'));
distractionButton.addEventListener('click', () => classify('blocked'));
resumeButton.addEventListener('click', async () => {
  await message('resume');
  displayedPauseMinutes = null;
  await load();
});
load();
