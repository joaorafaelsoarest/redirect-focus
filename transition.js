const countdown = document.querySelector('#countdown');
const destination = document.querySelector('#destination');
const status = document.querySelector('#transition-status');

function prettyUrl(url) { try { return new URL(url).hostname; } catch { return url; } }

async function message(type) { return chrome.runtime.sendMessage({ type }); }

async function start() {
  try {
    const target = await message('getRedirectTarget');
    if (!target.ok) throw new Error(target.error);
    destination.textContent = prettyUrl(target.url);
    let seconds = 3;
    const timer = setInterval(async () => {
      seconds -= 1; countdown.textContent = seconds;
      if (seconds > 0) return;
      clearInterval(timer);
      window.location.replace(target.url);
    }, 1000);
  } catch (error) { status.textContent = error.message || 'Não foi possível continuar agora.'; }
}
start();
