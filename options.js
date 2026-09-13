import { hostPermissionOrigins, validateConfiguration } from './lib/core.js';

let blockedDomains = [];
let productiveUrls = [];
const status = document.querySelector('#settings-status');
const blockedList = document.querySelector('#blocked-list');
const productiveList = document.querySelector('#productive-list');

function announce(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function listButton(label, accessibleName, callback) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'text-button'; button.textContent = label; button.setAttribute('aria-label', accessibleName); button.addEventListener('click', callback);
  return button;
}

function render() {
  blockedList.replaceChildren(...blockedDomains.map((domain, index) => {
    const item = document.createElement('li'); item.append(document.createTextNode(domain), listButton('Remover', `Remover ${domain}`, () => { blockedDomains.splice(index, 1); render(); })); return item;
  }));
  productiveList.replaceChildren(...productiveUrls.map((url, index) => {
    const item = document.createElement('li'); item.append(document.createTextNode(url));
    if (index > 0) item.append(listButton('Subir', `Subir ${url}`, () => { [productiveUrls[index - 1], productiveUrls[index]] = [productiveUrls[index], productiveUrls[index - 1]]; render(); }));
    if (index < productiveUrls.length - 1) item.append(listButton('Descer', `Descer ${url}`, () => { [productiveUrls[index], productiveUrls[index + 1]] = [productiveUrls[index + 1], productiveUrls[index]]; render(); }));
    item.append(listButton('Remover', `Remover ${url}`, () => { productiveUrls.splice(index, 1); render(); })); return item;
  }));
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
