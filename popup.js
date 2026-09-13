const status = document.querySelector('#protection-status');
const today = document.querySelector('#today-total');
const week = document.querySelector('#week-total');

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
    status.textContent = state.pause.paused
      ? `Proteção pausada até ${new Date(state.pause.pauseUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`
      : state.unpermittedDomains.length > 0
        ? `${protectedDomains} de ${state.blockedDomains.length} domínios protegidos. Reautorize os demais nas configurações.`
        : active ? `Proteção ativa em ${protectedDomains} domínio${protectedDomains === 1 ? '' : 's'}.` : 'Proteção precisa de domínios e um destino produtivo.';
    status.classList.toggle('active', active);
  } catch {
    status.textContent = 'Não foi possível carregar o estado da proteção.';
  }
}

document.querySelector('#open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
load();
