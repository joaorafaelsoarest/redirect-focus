# Redirect Focus

Uma extensão Chrome local, em português do Brasil, que transforma uma navegação distraída em um intervalo curto para voltar ao foco. Ela intercepta somente a navegação principal da aba para os domínios que você escolher; não toca em anúncios, embeds, subrecursos, histórico ou conteúdo das páginas.

## Carregar no Chrome

1. Abra `chrome://extensions` no Chrome.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta deste projeto: EX `/home/joaozinho/Documents/Projects/redirect-focus`.
4. Na primeira instalação, a página de configurações abrirá automaticamente. Depois, ela continua disponível pelo ícone da extensão.

## Usar

1. Em **Domínios que interrompem**, adicione um ou mais domínios. Facebook, Instagram, TikTok, X, Reddit, YouTube, Twitch, Discord e Threads aparecem como sugestões editáveis.
2. Em **Destinos produtivos**, adicione pelo menos uma URL. Trello, Substack, Google Docs, Drive, Calendar, Notion, GitHub, Linear e Todoist aparecem como sugestões.
3. Opcionalmente, clique em **Buscar sites mais acessados** para pedir ao Chrome a lista dos sites frequentes da nova aba. Sites que já estejam nas distrações ou nos destinos produtivos são omitidos. Os demais aparecem em grupos de cinco; clique em **Ver mais** para revelar os próximos. Escolha se cada site deve interromper o foco ou ser um destino produtivo; nada é adicionado até você salvar.
4. Clique em **Salvar e ativar**. A extensão valida domínios, destinos e conflitos antes de pedir acesso. O Chrome solicita autorização para os domínios da lista; se você negar, nada é salvo nem ativado. Ao remover um domínio salvo, a extensão também revoga o acesso opcional correspondente.
5. Ao abrir um domínio protegido, a tela mostra seus destinos produtivos. Escolha um para ir imediatamente ou aguarde cinco segundos para abrir o próximo destino da rotação. A ordem é circular e pode ser reorganizada nas configurações.
6. Clique no ícone da extensão para classificar rapidamente a aba atual como **Foco** ou **Distração**. A classificação é salva na hora; ao escolher Distração, o Chrome pede autorização para proteger aquele domínio. Para redirecionar distrações, mantenha ao menos um destino de Foco configurado. O popup também indica a categoria atual e permite trocá-la.
7. Use o popup para ver se a proteção está ativa/pausada, os redirecionamentos de hoje e dos últimos sete dias. As configurações permitem pausar por 15, 30 ou 60 minutos ou retomar imediatamente.

## Privacidade e permissões

Os dados locais são a configuração salva, a posição da rotação, a pausa e as contagens diárias. A extensão não usa login, servidor, analytics, sincronização, histórico completo de URLs nem leitura do conteúdo das páginas. Se você pedir a lista de sites mais acessados, o Chrome solicita a permissão opcional `topSites`; os resultados são exibidos temporariamente e não são armazenados. A categorização rápida lê a aba atual após o clique no ícone, usando a permissão temporária `activeTab`; ela guarda somente o domínio ou a origem, sem caminho, parâmetros ou fragmento. `storage`, `declarativeNetRequest` e `alarms` são permissões permanentes; `topSites` e os acessos a domínios são opcionais.

## Testes e checagens

Requer Node.js 22 ou superior. Não há dependências para instalar.

```sh
npm test
npm run check
```

## Roteiro de validação manual

1. Após carregar a extensão, salve `instagram.com` e `https://trello.com` e aceite a permissão solicitada.
2. Abra `https://www.instagram.com`; confirme que a tela mostra os destinos produtivos e que, sem escolha, após 5 segundos a própria aba abre o Trello.
3. Acrescente `https://substack.com`. Na próxima interceptação, escolha Substack e confirme o redirecionamento imediato; nas duas seguintes, não escolha e confirme os destinos automáticos Substack e Trello após 5 segundos. Confirme também que os botões funcionam com Tab e Enter/Espaço.
4. Pause por 15 minutos, confirme que Instagram não é interceptado, escolha **Retomar agora** e confirme que a interceptação volta.
5. Tente adicionar `https://instagram.com` como destino e confirme que aparece a mensagem de conflito. Tente negar uma permissão de domínio e confirme que a regra não é ativada.
6. Clique em **Buscar sites mais acessados**, aceite a permissão e confirme que sites HTTP(S) aparecem como sugestões em grupos de cinco, sem repetir domínios já configurados. Adicione um como distração e outro como destino produtivo, confirme que saem das sugestões e reaparecem se removidos, salve e confirme que a configuração foi atualizada.
7. Revogue ou negue a permissão `topSites`, clique em **Buscar sites mais acessados** e confirme que a lista não é carregada e nenhuma configuração é alterada.
8. Clique no ícone da extensão em uma página HTTP(S), confirme que o domínio aparece e classifique-o nas duas categorias. Negue a autorização ao escolher Distração e confirme que a configuração não muda; depois aceite e confirme o cadastro. Repita em uma página `chrome://` e confirme que a classificação fica desativada.

Este ambiente não oferece uma sessão gráfica do Chrome para carregar extensões, portanto a validação acima deve ser feita no navegador local.
