import { remainingPauseMinutes } from './lib/core.js';

const status = document.querySelector('#protection-status');
const today = document.querySelector('#today-total');
const week = document.querySelector('#week-total');
const resumeButton = document.querySelector('#resume');
let currentPause = null;
let displayedPauseMinutes = null;
let pauseRefreshTimer;

async function message(type) {
  return chrome.runtime.sendMessage({ type });
}

async function load() {
  try {
    const state = await message('getState');
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
  } catch {
    status.textContent = 'Não foi possível carregar o estado da proteção.';
  }
}

document.querySelector('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
resumeButton.addEventListener('click', async () => {
  await message('resume');
  displayedPauseMinutes = null;
  await load();
});
load();
