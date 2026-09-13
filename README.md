# Redirect Focus

Uma extensão Chrome local, em português do Brasil, que transforma uma navegação distraída em um intervalo curto para voltar ao foco. Ela intercepta somente a navegação principal da aba para os domínios que você escolher; não toca em anúncios, embeds, subrecursos, histórico ou conteúdo das páginas.

## Carregar no Chrome

1. Abra `chrome://extensions` no Chrome.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta deste projeto: EX `/home/joaozinho/Documents/Projects/redirect-focus`.
4. Na primeira instalação, a página de configurações abrirá automaticamente. Depois, ela continua disponível pelo ícone da extensão.

## Usar

1. Em **Domínios que interrompem**, adicione um ou mais domínios. Facebook, Instagram, TikTok e X aparecem como sugestões editáveis.
2. Em **Destinos produtivos**, adicione pelo menos uma URL. Trello e Substack aparecem somente como sugestões.
3. Clique em **Salvar e ativar**. A extensão valida todos os domínios, destinos e conflitos antes de pedir acesso. Quando válida, no próprio clique o Chrome pede uma única autorização para todos os domínios da lista; se você negar, nada é salvo nem ativado. Ao remover um domínio salvo, a extensão também revoga o acesso opcional correspondente.
4. Ao abrir um domínio protegido, a aba mostrará uma transição de três segundos e seguirá para o próximo destino produtivo. A ordem é circular e pode ser reorganizada nas configurações.
5. Use o popup para ver se a proteção está ativa/pausada, os redirecionamentos de hoje e dos últimos sete dias. As configurações permitem pausar por 15, 30 ou 60 minutos ou retomar imediatamente.

## Privacidade e permissões

Os únicos dados locais são a configuração, a posição da rotação, a pausa e as contagens diárias. A extensão não usa login, servidor, analytics, sincronização, histórico de URLs nem leitura do conteúdo de páginas. `storage`, `declarativeNetRequest` e `alarms` são as permissões permanentes; acessos a sites são opcionais e solicitados por domínio.

## Testes e checagens

Requer Node.js 22 ou superior. Não há dependências para instalar.

```sh
npm test
npm run check
```

## Roteiro de validação manual

1. Após carregar a extensão, salve `instagram.com` e `https://trello.com` e aceite a permissão solicitada.
2. Abra `https://www.instagram.com`; confirme que apenas a própria aba vai para a tela calma e, após 3 segundos, abre o Trello.
3. Acrescente `https://substack.com`, abra novamente Instagram duas vezes e confirme a alternância Trello → Substack → Trello.
4. Pause por 15 minutos, confirme que Instagram não é interceptado, escolha **Retomar agora** e confirme que a interceptação volta.
5. Tente adicionar `https://instagram.com` como destino e confirme que aparece a mensagem de conflito. Tente negar uma permissão de domínio e confirme que a regra não é ativada.

Este ambiente não oferece uma sessão gráfica do Chrome para carregar extensões, portanto a validação acima deve ser feita no navegador local.
