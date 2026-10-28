# Painel de Tarefas Opps

Gestão de tarefas da consultoria, com a equipe e com os clientes. Primeira versão, construída a partir do mapa em `replica/recon.md` (que é um rascunho feito sem acesso ao site de referência).

## Rodar

Precisa de Node 22.5 ou mais novo. A única dependência é o SDK da Anthropic, usado só na leitura das atas de reunião.

```bash
cd tarefas
npm install                  # instala o SDK da Anthropic
npm run demo                 # com dados fictícios; logins abaixo, senha demo1234
npm test                     # testes da API
```

Logins da demonstração: `admin@demo.local`, `equipe@demo.local`, `analista@demo.local` (outra pessoa da equipe, para ver que internas alheias não aparecem) e `cliente@demo.local`.

Para uso real, a primeira execução cria a organização e o primeiro administrador:

```bash
ADMIN_EMAIL=voce@suaempresa.com ORG_NAME="Sua Consultoria" npm start
```

A senha temporária aparece uma vez no terminal; troque em Configurações. O banco fica em `tarefas/data/tarefas.db` (fora do git). Um banco de versão anterior não abre: como só tinha dados de teste, apague o arquivo. Variáveis: `PORT` (3000), `DB_FILE`, `COOKIE_SECURE=1` quando estiver atrás de HTTPS.

## As três visões

- **Administrador:** vê todas as externas e as internas que criou ou em que é responsável; gerencia pessoas, clientes, logos e a marca; pode apagar.
- **Equipe Opps:** cria tarefas; vê todas as externas e as internas que criou ou em que é responsável.
- **Cliente:** vê as externas da empresa dele e as internas ligadas a ele marcadas como visíveis, em Kanban, Lista ou Calendário. Atualiza a situação (A fazer, Em andamento, Em revisão), a data de início, o % de execução, marca o checklist e conclui informando a data de término; o resto do card ele só vê. Aprova entregas em revisão ou pede ajuste. Cancelar e reabrir são só da equipe.

## O que faz

- **Interna ou externa.** Externa exige um cliente e aparece para ele e para a equipe toda. Interna é da consultoria e só quem criou e os responsáveis veem (uma interna do administrador sem outros responsáveis só ele vê). Ligada a um cliente, a interna pode ser marcada como "Visível para o cliente"; ligada à própria consultoria, nunca.
- **Quadro com 7 colunas:** A fazer, Em andamento, Em revisão, Atrasada, Concluída no prazo, Concluída fora do prazo, Cancelada. Cancelar exige motivo; cancelada não gera alerta nem a próxima repetição, e pode ser reaberta. "Atrasada" é automática quando o prazo passa. Ao concluir, informa-se a data de término, e ela decide entre no prazo e fora do prazo.
- **Datas:** prazo (ao criar), início (quando a pessoa começou: preenchido sozinho ao ir para Em andamento, e informar o início de uma tarefa a fazer já a leva para Em andamento). Marcar um item do checklist numa tarefa A fazer também: ela vai para Em andamento, o início vem preenchido com hoje (dá para ajustar antes de salvar) e o % passa a seguir o checklist e término (a data real, pedida ao concluir).
- **Card com Salvar e Sair.** As alterações ficam pendentes até Salvar; Sair com alterações pendentes pede confirmação. No topo do card: nome, empresa, início, checklist, % de execução, prazo, prioridade e responsáveis; depois descrição, alertas, repetição, ajustes e comentários.
- **% de execução:** informado à mão; se a tarefa tem checklist, segue os itens marcados.
- **Alertas do prazo:** no dia, 1 dia antes, 3 dias antes, 1 semana antes (vários ao mesmo tempo). Aparecem nos cards, na tela Alertas e no contador do menu.
- **Recorrência:** diária, semanal, quinzenal, mensal, bimestral, trimestral, quadrimestral, semestral, anual ou livre (a cada N dias). Ao concluir, a próxima é criada com o prazo avançado, sem início, com o checklist zerado e os mesmos responsáveis.
- **Checklist já na criação**, item por item; escolher um modelo preenche os itens, que dá para editar antes de criar.
- **Arquivar** tira a tarefa das telas sem apagar; "Ver arquivadas" mostra e permite desarquivar.
- **Logos** dos clientes e da consultoria nos cards (a imagem é reduzida para 128px no navegador).
- **Visões:** Kanban, Lista (agrupada por situação, empresa, responsável, prazo ou tipo) e Calendário (pelo prazo; no celular vira agenda). Filtros por tipo, empresa, responsável, prazo e recorrência (só recorrentes ou só únicas).
- **Também:** ajustes internos e do cliente, comentários (visíveis ao cliente só quando marcados, e nunca em interna), modelos com checklist, relatório por empresa com % no prazo.

## Quem vê, colunas e anexos

- **Quem vê:** quem criou e os responsáveis sempre. Além deles, cada tarefa tem "A equipe vê":
  - Externa (marcado por padrão): o administrador e quem da equipe acompanha o cliente (Clientes → Equipe). Desmarcado: só os responsáveis e o administrador.
  - Interna (desmarcado por padrão): só quem criou e os responsáveis. Marcado: a equipe do cliente ligado ou, sem cliente, toda a equipe.
  - Cliente: as externas da empresa dele e as internas marcadas "Visível para o cliente".
- **Responsáveis:** sem empresa, qualquer pessoa da equipe. Com empresa: os administradores, quem acompanha aquele cliente e as pessoas do cliente (quando ele vê a tarefa).
- **Nova tarefa:** começa como Interna, já aceita anexos e fecha sozinha ao criar.
- **Quem mexeu:** o card mostra quem criou, quem iniciou (quem preencheu o início) e quem concluiu ou cancelou, sem ninguém precisar digitar.
- **Colunas do quadro** (administrador, botão Colunas no Kanban): A fazer e Em andamento ficam no começo; as outras mudam de lugar, e dá para criar, renomear e apagar colunas.
- **Ordem dos cards:** prazo mais próximo primeiro, depois prioridade alta, média e baixa.
- **Anexos** no card (até 10 MB cada): equipe e cliente anexam; a equipe pode marcar "Só a equipe vê".

## Alertas, relatórios e compromissos

- **Alertas:** filtros de empresa e responsável. Com um deles escolhido, aparece a mensagem pronta para o WhatsApp (copiar ou abrir no WhatsApp) e a imagem das tarefas para anexar; cada tarefa também tem o seu botão. Serve enquanto o envio automático por WhatsApp não está ligado.
- **Dashboard clicável:** cada número e barra abre Tarefas com o filtro correspondente.
- **Relatórios:** resumo, por empresa, por responsável, prazos, concluídas, canceladas, evolução mensal, ajustes, recorrentes e lista completa, com filtros de período, empresa, responsável, tipo e situação; baixam em Excel (.xlsx) e PDF, gerados no próprio navegador (`public/exports.js`).
- **Compromissos:** agenda de reuniões e compromissos (lista ou mês), com empresa, participantes (equipe e cliente) e local ou link. Veem quem marcou, os participantes e o administrador; o cliente só os de que participa. Em "Ligar à minha agenda" cada pessoa gera um link particular (`/agenda/<código>.ics`, em `calendar.js`) que o Google Agenda, o Outlook e o iPhone assinam: traz os compromissos dela e os prazos das tarefas abertas que ela vê, só leitura. Gerar um novo link invalida o anterior.

## Chats, notificações e diário de bordo

- **Chat da tarefa:** dentro de cada tarefa, o "Chat da equipe" é só de quem criou, dos responsáveis da equipe e dos administradores (o cliente não vê). Quando o cliente vê a tarefa, a "Conversa com o cliente" fica separada, logo abaixo.
- **Chats:** conversas 1 a 1 ou em grupo, fora das tarefas. Só conversa quem tem empresa em comum (`S.related` em `shared.js`): o administrador com todos, a equipe entre si, a equipe com as pessoas dos clientes que acompanha e as pessoas do mesmo cliente. Num grupo, todos precisam ter relação com todos.
- **Notificações:** o sino no alto da tela mostra mensagens novas dos chats, do chat da tarefa, da conversa com o cliente e tarefas criadas para a pessoa (ou em que ela foi incluída). Mensagens seguidas do mesmo assunto somam numa só notificação. Atualiza a cada 30 segundos.
- **Diário de bordo:** cada pessoa da equipe anota o dia (o que fazer, início, fim) e classifica pela Tríade do Tempo (importante, urgente, circunstancial). Anotar pede só o nome e a Tríade; os itens mudam de lugar (arrastar ou setas). ▶ Iniciar marca o início, ⏸ Pausar e ▶ Retomar descontam o tempo parado e ■ Encerrar marca o término (e conclui); concluir pela caixinha pede início e término. "Clonar" copia o item para a data escolhida, zerado (sem horários, pausas nem marcação de feito). O relatório mostra o dia e os últimos 7 dias, com a referência 70/20/10. Um item vira tarefa (a pessoa fica de responsável) e as tarefas do dia entram no diário só com o título. Feito no diário e ainda aberto no quadro, o card avisa "Feita no diário" para concluir; concluir a tarefa marca o item do diário. Cada um vê o seu; o administrador vê o de todos (só leitura).
- **Modelos:** cada pessoa vê os modelos que criou; o administrador vê todos, com quem criou. Os antigos (sem dono) ficam só com o administrador.
- **Clientes:** a coluna "Equipe que acompanha" aparece só para o administrador.

## Painel e Recorrentes

- **Painel** (tela inicial): saudação com a data e quatro números (executadas na semana, atrasadas, vencem hoje, próximas 7 dias); filtros de período e empresa; produtividade (concluídas, % no prazo, tempo médio do início ao término, canceladas), tarefas por situação, concluídas por semana (8 semanas), carga do time por responsável, em aberto por empresa e a lista das atrasadas. Passar o mouse ou tocar numa barra mostra o valor. Tudo sai das tarefas que a pessoa pode ver, então o cliente tem o painel só das dele.
- **Recorrentes**: só as tarefas que se repetem, agrupadas por frequência, com o próximo prazo de cada uma e o botão "Nova recorrente" (a repetição já vem obrigatória). "Mostrar concluídas e canceladas" traz o histórico.

## Visual

Identidade da Opps (manual de marca): laranja #FB4F14 e degradê #FBD200 → #FF6A00, logo colorido no claro e branco no escuro (`public/brand/`), símbolo "!" nos espaços pequenos. Botões e links usam um tom derivado da cor da marca que passa no contraste de leitura; a cor pode ser trocada em Configurações e o tom é recalculado.


Menu lateral claro com ícones, barra superior com o título e a ação da página, indicadores no topo das tarefas (em aberto, atrasadas, vencem em 7 dias, % no prazo), cards com cantos arredondados. Abre no tema claro; o botão de sol e lua na barra superior alterna para o escuro, e Configurações → Aparência oferece Claro, Escuro ou Automático (segue o aparelho). A escolha fica guardada em cada aparelho. Fonte Plus Jakarta Sans (Google Fonts; sem internet, cai na fonte do sistema).

No celular: o menu vira gaveta, a nova tarefa vira botão flutuante, os filtros recolhem atrás de "Filtros", o quadro rola de lado coluna a coluna, a lista vira cards, o card de tarefa ocupa a tela com Salvar e Sair fixos embaixo e os diálogos sobem de baixo.

## Avisos por e-mail e WhatsApp

Quem recebe: os responsáveis pela tarefa e, quando o cliente vê a tarefa (externa, ou interna marcada como visível), os usuários daquele cliente. Quem criou a tarefa não recebe o aviso da própria criação. Ninguém recebe aviso de tarefa que não pode ver.

| Aviso | Quando |
|---|---|
| Tarefa criada | Na hora. Vale também para a próxima repetição de uma recorrente. |
| Prazo chegando | A partir das 8h, nos alertas escolhidos em cada tarefa (no dia, 1, 3 ou 7 dias antes). |
| Atrasou | No primeiro dia de atraso, uma vez. |
| Resumo semanal | Toda segunda às 8h: atrasadas, as que vencem nos próximos 7 dias e as em andamento. Só para quem tem tarefa aberta. |

O servidor verifica a cada 5 minutos, usa o horário de Brasília (`TZ=America/Sao_Paulo` é o padrão) e não manda o mesmo aviso duas vezes. Se o servidor estiver desligado às 8h de segunda, o resumo sai quando ele voltar, ainda na segunda. Envio que falha é tentado de novo até 3 vezes. Cada pessoa liga e desliga e-mail e WhatsApp em Configurações → Avisos. O administrador vê o que saiu (e o que falhou, com o motivo) no menu Avisos, onde também manda um e-mail de teste para si.

O e-mail traz um botão que abre a tarefa: defina `APP_URL` com o endereço público do sistema (ex.: `https://tarefas.oppsconsultoria.com`).

Na demonstração (`npm run demo`) e no protótipo nada é enviado: os avisos aparecem na tela Avisos como "não enviado".

### E-mail pelo Google Workspace

1. Na conta Google que vai enviar (de preferência uma conta própria para isso, como `avisos@...`), ative a verificação em duas etapas.
2. Em Conta Google → Segurança → Senhas de app, crie uma senha de app. Se a opção não aparecer, o administrador do Workspace precisa permitir. Alternativa: o administrador configura um "Serviço de redirecionamento SMTP" (`smtp-relay.gmail.com`) no Admin Console.
3. Rode o servidor com:

```bash
SMTP_HOST=smtp.gmail.com SMTP_PORT=465 \
SMTP_USER=avisos@oppsconsultoria.com SMTP_PASS='senha de app de 16 letras' \
SMTP_FROM='Painel de Tarefas Opps <avisos@oppsconsultoria.com>' \
APP_URL=https://tarefas.oppsconsultoria.com npm start
```

Porta 587 também funciona (STARTTLS). O Google limita a cerca de 2.000 mensagens por dia por conta, bem acima do uso de uma consultoria. Depois de ligar, use "Enviar e-mail de teste para mim" na tela Avisos.

### WhatsApp pela API oficial da Meta

Mensagens que a empresa inicia só saem por modelos aprovados pela Meta. Não se usa número pessoal nem WhatsApp Web.

1. Crie uma conta no Meta Business (business.facebook.com), um app do tipo Business em developers.facebook.com e adicione o produto WhatsApp.
2. Cadastre um número que não esteja em uso no WhatsApp comum. Pegue o **ID do número** (`WHATSAPP_PHONE_ID`) e gere um **token de usuário do sistema** permanente (`WHATSAPP_TOKEN`).
3. Em Modelos de mensagem, crie três modelos na categoria Utilidade, em português (pt_BR), com estes nomes e parâmetros:

| Modelo | Texto sugerido |
|---|---|
| `tarefa_criada` | Olá, {{1}}. Nova tarefa: {{2}} ({{3}}). Prazo: {{4}}. |
| `tarefa_vencendo` | Olá, {{1}}. A tarefa {{2}} {{3}} (prazo {{4}}). |
| `resumo_semanal` | Olá, {{1}}. Sua semana: {{2}} atrasada(s), {{3}} vencendo nos próximos 7 dias e {{4}} em andamento. |

Os parâmetros precisam ficar nessa ordem; o texto em volta pode mudar. Para usar outros nomes: `WHATSAPP_TEMPLATE_CREATED`, `WHATSAPP_TEMPLATE_DUE`, `WHATSAPP_TEMPLATE_WEEKLY`.

4. Rode o servidor com `WHATSAPP_TOKEN=... WHATSAPP_PHONE_ID=...` (junto com as variáveis do e-mail).

Cada pessoa informa o celular e marca a autorização em Configurações → Avisos; sem a autorização, nada vai para o WhatsApp dela. A Meta cobra por conversa iniciada pela empresa (tabela em developers.facebook.com/docs/whatsapp/pricing).

## Reuniões: anotações do Google Meet viram tarefas

Menu **Reuniões** (equipe e administrador; o cliente não vê):

1. Escolha o **PDF das Anotações do Gemini** (Google Drive → o documento da reunião → Arquivo → Fazer download → PDF): o navegador tira o texto do PDF, preenche a parte "Próximas etapas" e a data da reunião, e o PDF fica guardado junto. Ou cole o texto direto. Escolha a empresa e marque **quem estava presente**.
2. O sistema lê a seção "Próximas etapas" (ou "Próximos passos", "Ações", "Encaminhamentos"; sem seção, os itens em lista) e cada linha vira uma sugestão de tarefa, **sem IA e sem custo**:
   - Responsável: o nome entre colchetes (`[Ana Souza] ...`) ou no começo da frase (`Ana vai ...`), ligado aos participantes. Nome que não é de ninguém do sistema vai para "Responsável no cliente".
   - Prazo, a partir da data da reunião: `até 25/10`, `25/10/2026`, `até o dia 5`, `sexta-feira`, `amanhã`, `em 3 dias`, `semana que vem`, `esta semana`, `fim do mês`.
   - Prioridade alta quando aparece "urgente", "o quanto antes" ou "prioridade alta". Texto depois de dois-pontos vira a descrição.
   - Itens com mais de um nome (`[Ana, Bruno]`) ficam com os dois responsáveis; "[O grupo]"/"[The group]" fica sem responsável. Nome com uma letra de diferença (Eloía/Eloisa) é reconhecido quando não há dúvida.
   - A regra fica em `shared.js` (`parseNextSteps`), usada pelo servidor e pelo protótipo. O texto do PDF é tirado em `public/pdftext.js`, sem bibliotecas (testado com PDFs do Google Docs).
3. Na triagem você corrige (salva na hora), descarta, adiciona o que faltou e dá **OK, lançar** ou **Lançar todas**. Só depois do OK a tarefa vai para o quadro. Errou um nome no texto? Corrija em "Anotações coladas" e **Salvar e ler de novo** (as já lançadas ficam).

Com `ANTHROPIC_API_KEY` no servidor e um PDF anexado, a leitura passa a ser feita pela IA (Claude), que entende atas sem o formato de "Próximas etapas". Sem a chave, tudo funciona pela leitura acima.

## O que ainda não faz

- Convite e recuperação de senha por e-mail.
- Anexos.
- Um único servidor com SQLite: serve bem uma consultoria. Para muitos acessos simultâneos ou mais de um servidor, trocar por Postgres.

As regras de colunas, alertas, recorrência, % e quem vê ficam em `shared.js`, usado pelo servidor e pelo protótipo. Defina `TZ` (por exemplo `TZ=America/Sao_Paulo`) para o "hoje" do servidor ser o da consultoria.

## Publicar no Render

O `render.yaml` na raiz do repositório descreve o serviço: Docker (`tarefas/Dockerfile`), plano Starter com disco de 1 GB em `/app/data` (banco e backups), região Virginia e verificação em `/api/health`.

1. Em render.com, entre com o GitHub e dê acesso ao repositório `bpo-opps/verita`.
2. **New → Blueprint**, escolha o repositório. O Render lê o `render.yaml` e pede os valores em aberto: deixe em branco o que ainda não tiver (e-mail, WhatsApp, IA) e preencha depois em *Environment*.
3. Confirme. Ao terminar, abra **Logs**: a senha temporária do administrador (`bpo@oppsconsultoria.com`) aparece uma vez. Entre e troque em Configurações.

Sem `APP_URL`, os links dos e-mails usam o endereço `.onrender.com`. Para usar `tarefas.oppsconsultoria.com`: em *Settings → Custom Domains* adicione o domínio, crie no DNS o CNAME que o Render mostrar e preencha `APP_URL`.

## Mudanças depois de publicado

O Render publica sozinho cada envio ao ramo `claude/replica-skill-sakpz4`. Por isso, cada ajuste segue:

1. A mudança é feita e testada aqui (testes automáticos e teste de tela).
2. O protótipo é atualizado com a mudança: é a prévia para conferir antes, sem tocar nos dados reais.
3. Só depois de duas confirmações na conversa ("pode publicar" e a confirmação final) a mudança é enviada ao GitHub. Em uns 3 a 5 minutos está no ar.

Os dados ficam no disco e uma publicação não apaga nada. Proteções:
- Backup diário (14 dias) e, quando a atualização muda a estrutura do banco, uma cópia de antes (`antes-da-atualizacao-*.db`, últimas 5), em `/app/data/backups`.
- Se algo der errado: no Render, em **Events**, escolha a publicação anterior e toque em **Rollback**. Volta o sistema como estava; os dados continuam. O banco nunca é "rebaixado", então dá para publicar de novo depois da correção.

## Segurança

Senhas com scrypt, sessão em cookie HttpOnly e SameSite, verificação de origem em toda escrita, limite de tentativas de login, toda consulta filtrada por organização e, para cliente, pelo próprio cliente. Os testes em `test/api.test.js` cobrem um cliente tentando ver tarefa de outro e outra organização tentando ver esta.

## Protótipo em um arquivo HTML

`prototype/tarefas-prototipo.html` abre direto no navegador, sem servidor e sem instalar nada. É a mesma interface (`public/`), com uma versão da API rodando no próprio navegador (`prototype/mock-api.js`) e os dados fictícios da demonstração, salvos só naquele navegador. Serve para mostrar o fluxo, não para uso real: não tem senha de verdade nem dados compartilhados entre pessoas.

Depois de mudar `public/` ou `prototype/mock-api.js`, gere de novo:

```bash
node prototype/build.js
```

`node prototype/build.js` também gera `prototype/tarefas-pagina.html`, a mesma página sem o esqueleto HTML, publicada como página privada no claude.ai para abrir no celular. Ali não existem `confirm()` nem `prompt()`, por isso a interface usa diálogos próprios (`ask` e `askText` em `public/main.js`).
