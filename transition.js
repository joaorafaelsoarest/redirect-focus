const countdown = document.querySelector('#countdown');
const destination = document.querySelector('#destination');
const destinationChoices = document.querySelector('#destination-choices');
const status = document.querySelector('#transition-status');
const selectionStatus = document.querySelector('#selection-status');
const REDIRECT_DELAY_SECONDS = 5;

function prettyUrl(url) { try { return new URL(url).hostname; } catch { return url; } }

async function message(type) { return chrome.runtime.sendMessage({ type }); }

function destinationLabel(value, destinations) {
  let url;
  try { url = new URL(value); } catch { return value; }
  const sharesHostname = destinations.some((candidate) => {
    try { return candidate !== value && new URL(candidate).hostname === url.hostname; } catch { return false; }
  });
  return sharesHostname ? url.href : url.hostname;
}

async function start() {
  let timer = null;
  let redirected = false;
  let pointerInside = false;
  let focusInside = false;
  let selectionPaused = false;
  const buttons = [];
  let seconds = REDIRECT_DELAY_SECONDS;

  function stopTimer() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  function startTimer(target) {
    if (timer !== null || redirected || pointerInside || focusInside || seconds <= 0) return;
    timer = setInterval(() => {
      if (redirected || pointerInside || focusInside) return;
      seconds -= 1;
      countdown.textContent = String(seconds);
      if (seconds === 0) redirect(target.url);
    }, 1000);
  }

  function updateSelectionState(target) {
    const selecting = pointerInside || focusInside;
    if (selecting) {
      if (selectionPaused) return;
      selectionPaused = true;
      stopTimer();
      selectionStatus.textContent = 'Contagem pausada enquanto você escolhe um destino.';
      return;
    }
    if (!selectionPaused) return;
    selectionPaused = false;
    selectionStatus.textContent = 'Contagem retomada.';
    startTimer(target);
  }

  function redirect(url) {
    if (redirected) return;
    redirected = true;
    stopTimer();
    buttons.forEach((button) => { button.disabled = true; });
    window.location.replace(url);
  }

  try {
    const target = await message('getRedirectTarget');
    if (!target.ok) throw new Error(target.error);
    destination.textContent = prettyUrl(target.url);
    const destinations = Array.isArray(target.destinations) ? target.destinations : [];
    destinationChoices.replaceChildren(...destinations.map((url) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const label = destinationLabel(url, destinations);
      button.type = 'button';
      button.className = 'destination-choice';
      button.textContent = label;
      button.setAttribute('aria-label', `Ir para ${label} agora`);
      button.addEventListener('click', () => redirect(url));
      buttons.push(button);
      item.append(button);
      return item;
    }));

    destinationChoices.addEventListener('pointerenter', () => {
      pointerInside = true;
      updateSelectionState(target);
    });
    destinationChoices.addEventListener('pointerleave', () => {
      pointerInside = false;
      updateSelectionState(target);
    });
    destinationChoices.addEventListener('focusin', () => {
      focusInside = true;
      updateSelectionState(target);
    });
    destinationChoices.addEventListener('focusout', (event) => {
      if (event.relatedTarget && destinationChoices.contains?.(event.relatedTarget)) return;
      focusInside = false;
      updateSelectionState(target);
    });

    countdown.textContent = String(seconds);
    startTimer(target);
  } catch (error) { status.textContent = error.message || 'Não foi possível continuar agora.'; }
}
start();
