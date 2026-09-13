const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function normalizeDomain(value) {
  const candidate = String(value ?? '').trim();
  if (!candidate) throw new Error('Domínio inválido.');

  let hostname;
  try {
    hostname = new URL(candidate.includes('://') ? candidate : `https://${candidate}`).hostname;
  } catch {
    throw new Error('Domínio inválido.');
  }

  const domain = hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!DOMAIN_PATTERN.test(domain)) throw new Error('Domínio inválido.');
  return domain;
}

export function domainsOverlap(first, second) {
  const a = normalizeDomain(first);
  const b = normalizeDomain(second);
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function normalizeProductiveUrl(value) {
  const candidate = String(value ?? '').trim();
  if (!candidate) throw new Error('URL inválida.');
  let url;
  try {
    url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
  } catch {
    throw new Error('URL inválida.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || !DOMAIN_PATTERN.test(url.hostname)) {
    throw new Error('URL inválida.');
  }
  return url.href.replace(/\/$/, '');
}

export function normalizeTopSites(entries) {
  const seen = new Set();
  const sites = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    let url;
    try {
      url = new URL(String(entry?.url ?? ''));
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) continue;

    let domain;
    try {
      domain = normalizeDomain(url.hostname);
    } catch {
      continue;
    }
    if (seen.has(domain)) continue;
    seen.add(domain);

    const port = url.port ? `:${url.port}` : '';
    sites.push({
      domain,
      productiveUrl: `${url.protocol}//${domain}${port}`,
    });
  }

  return sites;
}

export function classifyTopSite(configuration, site, category) {
  const blockedDomains = configuration?.blockedDomains ?? [];
  const productiveUrls = configuration?.productiveUrls ?? [];

  if (category === 'blocked') {
    let domain;
    try {
      domain = normalizeDomain(site?.domain);
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const alreadyBlocked = blockedDomains.some((value) => {
      try { return domainsOverlap(value, domain); } catch { return false; }
    });
    if (alreadyBlocked) return { ok: false, error: 'Esse item já está na lista.' };
    const conflictsWithProductive = productiveUrls.some((value) => {
      try { return domainsOverlap(domain, new URL(normalizeProductiveUrl(value)).hostname); } catch { return false; }
    });
    if (conflictsWithProductive) {
      return { ok: false, error: 'Um destino produtivo não pode usar um domínio bloqueado.' };
    }
    return {
      ok: true,
      configuration: { blockedDomains: [...blockedDomains, domain], productiveUrls: [...productiveUrls] },
    };
  }

  if (category === 'productive') {
    let productiveUrl;
    try {
      productiveUrl = normalizeProductiveUrl(site?.productiveUrl);
    } catch (error) {
      return { ok: false, error: error.message };
    }
    const domain = new URL(productiveUrl).hostname;
    const conflictsWithBlocked = blockedDomains.some((value) => {
      try { return domainsOverlap(value, domain); } catch { return false; }
    });
    if (conflictsWithBlocked) {
      return { ok: false, error: 'Um destino produtivo não pode usar um domínio bloqueado.' };
    }
    const alreadyProductive = productiveUrls.some((value) => {
      try { return normalizeProductiveUrl(value) === productiveUrl; } catch { return false; }
    });
    if (alreadyProductive) return { ok: false, error: 'Esse item já está na lista.' };
    return {
      ok: true,
      configuration: { blockedDomains: [...blockedDomains], productiveUrls: [...productiveUrls, productiveUrl] },
    };
  }

  return { ok: false, error: 'Categoria inválida.' };
}

export function validateConfiguration({ blockedDomains = [], productiveUrls = [] }) {
  let domains;
  let urls;
  try {
    domains = blockedDomains.map(normalizeDomain);
    urls = productiveUrls.map(normalizeProductiveUrl);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  if (urls.length === 0) {
    return { ok: false, error: 'Adicione ao menos um destino produtivo para ativar a proteção.' };
  }
  if (new Set(domains).size !== domains.length) {
    return { ok: false, error: 'Não repita o mesmo domínio bloqueado.' };
  }
  for (const domain of domains) {
    if (urls.some((url) => domainsOverlap(domain, new URL(url).hostname))) {
      return { ok: false, error: 'Um destino produtivo não pode usar um domínio bloqueado.' };
    }
  }
  return { ok: true };
}

export function buildRedirectRules(domains) {
  return domains.map((domain, index) => ({
    id: index + 1,
    priority: 1,
    action: { type: 'redirect', redirect: { extensionPath: '/transition.html' } },
    condition: { urlFilter: `||${normalizeDomain(domain)}^`, resourceTypes: ['main_frame'] },
  }));
}

export function hostPermissionOrigins(domains) {
  return [...new Set(domains.flatMap((domain) => {
    const normalized = normalizeDomain(domain);
    return [`*://${normalized}/*`, `*://*.${normalized}/*`];
  }))];
}

export function nextRotation(urls, index = 0) {
  if (!urls.length) return null;
  const position = ((Number(index) || 0) % urls.length + urls.length) % urls.length;
  return { url: urls[position], nextIndex: (position + 1) % urls.length };
}

function dateKey(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function recordRedirect(daily, now = new Date()) {
  const key = dateKey(now);
  return { ...daily, [key]: (daily[key] || 0) + 1 };
}

export function statistics(daily, now = new Date()) {
  const start = new Date(now);
  start.setDate(start.getDate() - 6);
  const startKey = dateKey(start);
  const today = dateKey(now);
  const entries = Object.entries(daily).filter(([key]) => key >= startKey && key <= today);
  return {
    today: daily[today] || 0,
    last7Days: entries.reduce((sum, [, count]) => sum + Number(count || 0), 0),
  };
}

export function pauseState(until, now = Date.now()) {
  const pauseUntil = Number(until);
  return Number.isFinite(pauseUntil) && pauseUntil > now
    ? { paused: true, pauseUntil }
    : { paused: false, pauseUntil: null };
}
