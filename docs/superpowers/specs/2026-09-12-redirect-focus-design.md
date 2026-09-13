# Redirect Focus — desenho

## Objetivo

Extensão Chrome Manifest V3, inteiramente local e em pt-BR, que intercepta somente navegações de nível principal para domínios escolhidos. Uma navegação interceptada abre uma página interna calma por três segundos e, então, redireciona a própria aba para o próximo endereço produtivo em rotação.

## Arquitetura

`lib/core.js` contém funções puras para normalizar e validar domínios/URLs, impedir conflitos, construir regras DNR, escolher a rotação, calcular estatísticas diárias e representar a pausa. `service-worker.js` adapta essas funções ao Chrome: inicializa dados, solicita permissões opcionais específicas, sincroniza regras dinâmicas, controla alarmes e executa o redirecionamento final. A página de transição apenas pede ao serviço o próximo destino, aguarda três segundos e substitui a URL atual. Popup e opções são interfaces separadas que chamam uma pequena API por mensagens.

## Dados locais

`chrome.storage.local` guarda `blockedDomains`, `productiveUrls`, `rotationIndex`, `pauseUntil` e `dailyRedirects` (mapa ISO-date → contador). Não há histórico, URL bloqueada, conteúdo, login, telemetria nem sincronização. O mapa é podado para oito dias a cada leitura/escrita.

## Regras e permissões

O manifest declara apenas `storage`, `declarativeNetRequest` e `alarms`; hosts ficam em `optional_host_permissions`. Ao ativar/adicionar domínio, o serviço pede `*://dominio/*` e `*://*.dominio/*`. Sem concessão, o domínio não é incluído nem recebe regra. Cada regra DNR tem `resourceTypes: ["main_frame"]`, usa `urlFilter: "||dominio^"` e redireciona a `transition.html`. Durante pausa ou sem destinos, todas as regras são removidas; em reinício ou alarme elas são recalculadas. A página interna não é uma URL de rede e não pode coincidir com regra.

## Experiência

No onboarding, Facebook, Instagram, TikTok e X são sugestões de distração editáveis; Trello e Substack são apenas sugestões produtivas. A proteção só pode ser ativada com um destino produtivo válido. Opções permitem gerenciar domínios, URLs e ordem, pausar por 15/30/60 minutos e retomar. Popup mostra estado e os totais de hoje e sete dias. Todos os controles possuem rótulos, foco visível e regiões vivas para erros/estado.

## Casos de erro

Domínios e URLs inválidos são recusados. Um domínio bloqueado não pode aparecer nos destinos produtivos (incluindo subdomínios/raiz em ambos os sentidos). Listas vazias deixam a proteção sem regras; a página de transição exibe erro recuperável se a lista desaparecer antes do fim da contagem. Falhas e recusas de permissão são devolvidas em mensagens claras. Uma pausa expirada é limpa e as regras voltam a ser aplicadas.

## Testes

Node built-in test runner cobre os módulos puros: normalização/matching, validação, conflitos, regras main-frame, rotação, contagens, pausa e listas vazias. Um mock de Chrome controlado testa inicialização, sincronização de regras, pausa/retomada e recusa de permissões do service worker. A validação final executa a suíte inteira, verificação sintática de JavaScript e inspeção do manifest/HTML.
