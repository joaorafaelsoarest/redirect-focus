# Redirect Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir uma extensão Chrome local que redireciona distrações para destinos produtivos, com escolha manual imediata ou rotação automática após cinco segundos.

**Architecture:** Funções puras em `lib/core.js`; `service-worker.js` traduz ações da extensão para armazenamento, permissões, DNR e alarmes. As páginas internas comunicam-se por mensagens e não acessam páginas externas.

**Tech Stack:** Manifest V3, JavaScript ES modules, HTML/CSS e `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-12-redirect-focus-design.md`

## Global Constraints

- Usar somente permissões `storage`, `declarativeNetRequest`, `alarms` e hosts opcionais específicos por domínio.
- Regras DNR afetam exclusivamente `main_frame`.
- Não persistir histórico, URLs bloqueadas, conteúdos, login ou analytics.
- Aplicar TDD: cada módulo de produção nasce após teste que falha pelo comportamento novo.

---

### Task 1: Fundação e regras puras

**Files:** criar `package.json`, `lib/core.js`, `test/core.test.js`.

**Interfaces:** `normalizeDomain(value)`, `domainsOverlap(a,b)`, `normalizeProductiveUrl(value)`, `validateConfiguration(config)`, `buildRedirectRules(domains)`, `nextRotation(urls,index)`, `recordRedirect(daily, now)`, `statistics(daily, now)`, `pauseState(until, now)`.

- [ ] Escrever testes para cada comportamento puro, começando por domínio válido/inválido e executá-los com `node --test test/core.test.js` para confirmar ausência da exportação.
- [ ] Implementar a menor função para fazê-los passar e repetir a execução.
- [ ] Repetir o ciclo para matching, URLs, conflitos, DNR, rotação, estatísticas e pausa.

### Task 2: Serviço e integração Chrome

**Files:** criar `service-worker.js`, `test/service-worker.test.js`.

**Interfaces:** mensagens `getState`, `saveConfiguration`, `pause`, `resume`, `getRedirectTarget`; eventos `onInstalled`, `onStartup`, `alarms.onAlarm`.

- [ ] Criar mock mínimo de `chrome` no teste e testar instalação, sincronização de regras, pausa/retomada e recusa de permissão; executar para confirmar que falha por módulo ausente.
- [ ] Implementar integração mínima e executar os testes isolados e completos.

### Task 3: Manifesto e interfaces

**Files:** criar `manifest.json`, `popup.html`, `popup.js`, `options.html`, `options.js`, `transition.html`, `transition.js`, `styles.css`.

- [ ] Criar o manifesto com recursos e páginas consistentes.
- [ ] Implementar popup, onboarding/opções e transição sobre a API de mensagens existente; usar controles rotulados, foco visível e regiões `aria-live`.
- [ ] Confirmar sintaxe com `node --check` e inspecionar referências de scripts/manifest.

### Task 4: Documentação e verificação final

**Files:** criar `README.md`.

- [ ] Documentar instalação descompactada, fluxo, permissões, execução de testes e roteiro de validação manual no Chrome.
- [ ] Executar `npm test`, checagem sintática de todos os JS e inspeção estrutural do manifesto/HTML.
