import { classifyTopSite, domainsOverlap, hostPermissionOrigins, normalizeProductiveUrl, pauseState, remainingPauseMinutes, validateConfiguration } from './lib/core.js';

const TOP_SITE_BATCH_SIZE = 5;
let blockedDomains = [];
let productiveUrls = [];
let frequentSites = [];
let visibleTopSiteCount = TOP_SITE_BATCH_SIZE;
const status = document.querySelector('#settings-status');
const blockedList = document.querySelector('#blocked-list');
const productiveList = document.querySelector('#productive-list');
const topSitesList = document.querySelector('#top-sites-list');
const loadTopSitesButton = document.querySelector('#load-top-sites');
const showMoreTopSitesButton = document.querySelector('#show-more-top-sites');
const pauseCountdown = document.querySelector('#pause-countdown');
const pauseStatus = document.querySelector('#pause-status');
const resumeButton = document.querySelector('#resume');
let currentPause = { paused: false, pauseUntil: null };
let displayedPauseMinutes;
let pauseRefreshTimer;

function announce(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function announcePause(text, error = false) {
  pauseStatus.textContent = text;
  pauseStatus.classList.toggle('error', error);
}

function renderPause(pause) {
  currentPause = pause ?? { paused: false, pauseUntil: null };
  const minutes = currentPause.paused ? remainingPauseMinutes(currentPause.pauseUntil) : null;
  resumeButton.hidden = minutes === null;
  if (minutes !== displayedPauseMinutes) {
    pauseCountdown.textContent = minutes === null ? 'Proteção ativa.' : `${minutes} minuto${minutes === 1 ? '' : 's'} restante${minutes === 1 ? '' : 's'} de pausa.`;
    displayedPauseMinutes = minutes;
  }
  clearTimeout(pauseRefreshTimer);
  if (minutes !== null) {
    const delay = Math.max(1, currentPause.pauseUntil - Date.now() - (minutes - 1) * 60_000) + 10;
    pauseRefreshTimer = setTimeout(() => renderPause(currentPause), delay);
    pauseRefreshTimer.unref?.();
  }
}

function listButton(label, accessibleName, callback) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'text-button'; button.textContent = label; button.setAttribute('aria-label', accessibleName); button.addEventListener('click', callback);
  return button;
}

function isSiteSelected(site) {
  const matchesDomain = (candidate) => {
    try { return domainsOverlap(site.domain, candidate); } catch { return false; }
  };
  if (blockedDomains.some(matchesDomain)) return true;
  return productiveUrls.some((value) => {
    try { return matchesDomain(new URL(normalizeProductiveUrl(value)).hostname); } catch { return false; }
  });
}

function availableTopSites() {
  return frequentSites.filter((site) => !isSiteSelected(site));
}

function renderTopSites() {
  const sites = availableTopSites();
  topSitesList.replaceChildren(...sites.slice(0, visibleTopSiteCount).map((site) => {
    const item = document.createElement('li');
    item.className = 'top-site-item';
    const domain = document.createElement('span');
    domain.textContent = site.domain;
    const actions = document.createElement('div');
    actions.className = 'top-site-actions';
    actions.append(
      listButton('Adicionar às distrações', `Adicionar ${site.domain} como distração`, () => classifyFrequentSite(site, 'blocked')),
      listButton('Usar como destino', `Usar ${site.domain} como destino produtivo`, () => classifyFrequentSite(site, 'productive')),
    );
    item.append(domain, actions);
    return item;
  }));
  showMoreTopSitesButton.hidden = sites.length <= visibleTopSiteCount;
}

function render() {
  blockedList.replaceChildren(...blockedDomains.map((domain, index) => {
    const item = document.createElement('li'); item.append(document.createTextNode(domain), listButton('Remover', `Remover ${domain}`, () => {
      blockedDomains.splice(index, 1);
      render();
    })); return item;
  }));
  productiveList.replaceChildren(...productiveUrls.map((url, index) => {
    const item = document.createElement('li'); item.append(document.createTextNode(url));
    if (index > 0) item.append(listButton('Subir', `Subir ${url}`, () => { [productiveUrls[index - 1], productiveUrls[index]] = [productiveUrls[index], productiveUrls[index - 1]]; render(); }));
    if (index < productiveUrls.length - 1) item.append(listButton('Descer', `Descer ${url}`, () => { [productiveUrls[index], productiveUrls[index + 1]] = [productiveUrls[index + 1], productiveUrls[index]]; render(); }));
    item.append(listButton('Remover', `Remover ${url}`, () => {
      productiveUrls.splice(index, 1);
      render();
    })); return item;
  }));
  renderTopSites();
}

function classifyFrequentSite(site, category) {
  const result = classifyTopSite({ blockedDomains, productiveUrls }, site, category);
  if (!result.ok) {
    announce(result.error, true);
    return;
  }
  blockedDomains = result.configuration.blockedDomains;
  productiveUrls = result.configuration.productiveUrls;
  render();
  const nextAction = topSitesList.children[0]?.children[1]?.children[0];
  (nextAction ?? (showMoreTopSitesButton.hidden ? loadTopSitesButton : showMoreTopSitesButton)).focus();
  announce(category === 'blocked'
    ? `${site.domain} adicionado à lista de distrações.`
    : `${site.domain} adicionado aos destinos produtivos.`);
}

function appendUnique(collection, value) {
  const cleaned = value.trim();
  if (!cleaned) return;
  if (collection.includes(cleaned)) { announce('Esse item já está na lista.', true); return; }
  collection.push(cleaned); render();
}

document.querySelector('#blocked-form').addEventListener('submit', (event) => { event.preventDefault(); const input = document.querySelector('#blocked-input'); appendUnique(blockedDomains, input.value); input.value = ''; });
document.querySelector('#productive-form').addEventListener('submit', (event) => { event.preventDefault(); const input = document.querySelector('#productive-input'); appendUnique(productiveUrls, input.value); input.value = ''; });
document.querySelectorAll('[data-blocked]').forEach((button) => button.addEventListener('click', () => appendUnique(blockedDomains, button.dataset.blocked)));
document.querySelectorAll('[data-productive]').forEach((button) => button.addEventListener('click', () => appendUnique(productiveUrls, button.dataset.productive)));

async function send(type, extra = {}) { return chrome.runtime.sendMessage({ type, ...extra }); }
async function loadTopSites() {
  frequentSites = [];
  visibleTopSiteCount = TOP_SITE_BATCH_SIZE;
  renderTopSites();
  loadTopSitesButton.disabled = true;
  announce('Buscando sites mais visitados…');
  try {
    const granted = await chrome.permissions.request({ permissions: ['topSites'] });
    if (!granted) {
      announce('Permissão não concedida. Nenhum site foi adicionado.', true);
      return;
    }
    const result = await send('getTopSites');
    if (!result.ok) {
      announce(result.error, true);
      return;
    }
    frequentSites = Array.isArray(result.sites) ? result.sites : [];
    renderTopSites();
    const availableCount = availableTopSites().length;
    announce(availableCount
      ? `${availableCount} sites disponíveis para classificar.`
      : 'Nenhum site frequente compatível e ainda não selecionado foi encontrado.');
  } catch {
    announce('Não foi possível buscar os sites mais visitados.', true);
  } finally {
    loadTopSitesButton.disabled = false;
  }
}

loadTopSitesButton.addEventListener('click', () => loadTopSites());
showMoreTopSitesButton.addEventListener('click', () => {
  visibleTopSiteCount += TOP_SITE_BATCH_SIZE;
  renderTopSites();
});

async function save() {
  const result = await send('saveConfiguration', { configuration: { blockedDomains, productiveUrls } });
  announce(result.ok ? 'Configurações salvas. Proteção atualizada.' : result.error, !result.ok);
  if (result.ok) { const state = await send('getState'); blockedDomains = state.blockedDomains; productiveUrls = state.productiveUrls; render(); }
}
document.querySelector('#save').addEventListener('click', () => {
  const validation = validateConfiguration({ blockedDomains, productiveUrls });
  if (!validation.ok) {
    announce(validation.error, true);
    return;
  }
  let origins;
  try {
    origins = hostPermissionOrigins(blockedDomains);
  } catch (error) {
    announce(error.message, true);
    return;
  }
  const permissionRequest = origins.length
    ? chrome.permissions.request({ origins })
    : Promise.resolve(true);
  permissionRequest.then((granted) => {
    if (!granted) {
      announce('Permissão negada. Nenhum domínio foi salvo ou ativado.', true);
      return;
    }
    return save();
  }).catch(() => announce('Não foi possível salvar agora.', true));
});
document.querySelector('#pause').addEventListener('click', async () => {
  let notificationsGranted = false;
  try {
    notificationsGranted = await chrome.permissions.contains({ permissions: ['notifications'] });
    if (!notificationsGranted) notificationsGranted = await chrome.permissions.request({ permissions: ['notifications'] });
  } catch { notificationsGranted = false; }
  const result = await send('pause', { minutes: Number(document.querySelector('#pause-minutes').value) });
  if (result.ok) {
    renderPause({ paused: true, pauseUntil: result.pauseUntil });
    announcePause(notificationsGranted ? 'Proteção pausada.' : 'Proteção pausada. Permissão de notificações não concedida.', !notificationsGranted);
  } else announcePause(result.error, true);
});
resumeButton.addEventListener('click', async () => {
  const result = await send('resume');
  if (result.ok) renderPause({ paused: false, pauseUntil: null });
  announcePause(result.ok ? 'Proteção retomada.' : result.error, !result.ok);
});

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.pauseUntil) renderPause(pauseState(changes.pauseUntil.newValue));
});

(async () => { try { const state = await send('getState'); blockedDomains = state.blockedDomains; productiveUrls = state.productiveUrls; renderPause(state.pause); render(); } catch { announce('Não foi possível carregar as configurações.', true); } })();
