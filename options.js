import { classifyTopSite, hostPermissionOrigins, validateConfiguration } from './lib/core.js';

let blockedDomains = [];
let productiveUrls = [];
let frequentSites = [];
const addedTopSites = new Map();
const status = document.querySelector('#settings-status');
const blockedList = document.querySelector('#blocked-list');
const productiveList = document.querySelector('#productive-list');
const topSitesList = document.querySelector('#top-sites-list');
const loadTopSitesButton = document.querySelector('#load-top-sites');

function announce(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function listButton(label, accessibleName, callback) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'text-button'; button.textContent = label; button.setAttribute('aria-label', accessibleName); button.addEventListener('click', callback);
  return button;
}

function renderTopSites(focusDomain = null) {
  let focusedFeedback = null;
  topSitesList.replaceChildren(...frequentSites.map((site) => {
    const item = document.createElement('li');
    item.className = 'top-site-item';
    const domain = document.createElement('span');
    domain.textContent = site.domain;
    const added = addedTopSites.get(site.domain);
    if (added) {
      const feedback = document.createElement('span');
      feedback.className = 'top-site-added';
      feedback.setAttribute('role', 'status');
      feedback.setAttribute('tabindex', '-1');
      feedback.textContent = added.category === 'blocked'
        ? 'Adicionado às distrações'
        : 'Adicionado aos destinos produtivos';
      if (site.domain === focusDomain) focusedFeedback = feedback;
      item.append(domain, feedback);
      return item;
    }
    const actions = document.createElement('div');
    actions.className = 'top-site-actions';
    actions.append(
      listButton('Adicionar às distrações', `Adicionar ${site.domain} como distração`, () => classifyFrequentSite(site, 'blocked')),
      listButton('Usar como destino', `Usar ${site.domain} como destino produtivo`, () => classifyFrequentSite(site, 'productive')),
    );
    item.append(domain, actions);
    return item;
  }));
  return focusedFeedback;
}

function render(focusDomain = null) {
  blockedList.replaceChildren(...blockedDomains.map((domain, index) => {
    const item = document.createElement('li'); item.append(document.createTextNode(domain), listButton('Remover', `Remover ${domain}`, () => {
      blockedDomains.splice(index, 1);
      if (addedTopSites.get(domain)?.category === 'blocked') addedTopSites.delete(domain);
      render();
    })); return item;
  }));
  productiveList.replaceChildren(...productiveUrls.map((url, index) => {
    const item = document.createElement('li'); item.append(document.createTextNode(url));
    if (index > 0) item.append(listButton('Subir', `Subir ${url}`, () => { [productiveUrls[index - 1], productiveUrls[index]] = [productiveUrls[index], productiveUrls[index - 1]]; render(); }));
    if (index < productiveUrls.length - 1) item.append(listButton('Descer', `Descer ${url}`, () => { [productiveUrls[index], productiveUrls[index + 1]] = [productiveUrls[index + 1], productiveUrls[index]]; render(); }));
    item.append(listButton('Remover', `Remover ${url}`, () => {
      productiveUrls.splice(index, 1);
      for (const [domain, added] of addedTopSites) {
        if (added.category === 'productive' && added.value === url) addedTopSites.delete(domain);
      }
      render();
    })); return item;
  }));
  return renderTopSites(focusDomain);
}

function classifyFrequentSite(site, category) {
  const result = classifyTopSite({ blockedDomains, productiveUrls }, site, category);
  if (!result.ok) {
    announce(result.error, true);
    return;
  }
  blockedDomains = result.configuration.blockedDomains;
  productiveUrls = result.configuration.productiveUrls;
  addedTopSites.set(site.domain, {
    category,
    value: category === 'blocked' ? site.domain : site.productiveUrl,
  });
  render(site.domain)?.focus();
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
    announce(frequentSites.length
      ? `${frequentSites.length} sites disponíveis para classificar.`
      : 'Nenhum site frequente compatível foi encontrado.');
  } catch {
    announce('Não foi possível buscar os sites mais visitados.', true);
  } finally {
    loadTopSitesButton.disabled = false;
  }
}

loadTopSitesButton.addEventListener('click', () => loadTopSites());

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
document.querySelector('#pause').addEventListener('click', async () => { const result = await send('pause', { minutes: Number(document.querySelector('#pause-minutes').value) }); announce(result.ok ? 'Proteção pausada.' : result.error, !result.ok); });
document.querySelector('#resume').addEventListener('click', async () => { const result = await send('resume'); announce(result.ok ? 'Proteção retomada.' : result.error, !result.ok); });

(async () => { try { const state = await send('getState'); blockedDomains = state.blockedDomains; productiveUrls = state.productiveUrls; render(); } catch { announce('Não foi possível carregar as configurações.', true); } })();
