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

## Reuniões: ata do Google Meet vira tarefa

Menu **Reuniões** (equipe e administrador; o cliente não vê):

1. Anexe o PDF da ata (as anotações do Gemini no Meet, exportadas em PDF, ou qualquer ata em PDF com texto), escolha a empresa e marque **quem estava presente**: a equipe e as pessoas do cliente. Quem não tem acesso ao sistema vai em "Outros participantes".
2. A IA (Claude, da Anthropic) lê a ata e faz o pré-lançamento: título, empresa, tipo, responsáveis, prazo, prioridade, checklist e o trecho da ata de onde cada tarefa saiu. Responsável só pode ser alguém da equipe que estava presente; quando quem ficou de fazer é do cliente, o nome vai em "Responsável no cliente". Prazo só entra se foi combinado; "sexta" ou "semana que vem" são convertidos a partir da data da reunião.
3. Na triagem você corrige o que quiser (salva na hora), descarta o que não é tarefa, adiciona o que faltou e dá **OK, lançar** em cada uma, ou **Lançar todas**. Só depois do OK a tarefa vai para o quadro, com os avisos de tarefa criada. A descrição ganha "Da reunião ... de dd/mm/aaaa".

"Ler de novo" refaz a leitura e troca só as sugestões ainda não lançadas. Apagar a reunião apaga o PDF e as sugestões; as tarefas lançadas continuam. O PDF fica guardado no banco (até 15 MB).

**Para ligar a leitura por IA:** crie uma chave em console.anthropic.com (conta da Opps, com cobrança por uso) e rode o servidor com `ANTHROPIC_API_KEY=...`. Sem a chave, a tela funciona igual, mas as tarefas são lançadas à mão na triagem. Modelo: Claude Opus 5.5 (troque com `MEETINGS_MODEL`). Uma ata de 5 a 10 páginas custa em geral de 10 a 40 centavos de dólar (estimativa pelo preço por token do modelo; o valor real aparece no console da Anthropic).

Privacidade: o PDF da ata é enviado à API da Anthropic para ser lido. Avise os clientes, se o contrato pedir, que as atas passam por um serviço de IA.

No protótipo a leitura é simulada: as sugestões são de exemplo, montadas a partir de quem estava presente, e o PDF fica só até recarregar a página.

## O que ainda não faz

- Convite e recuperação de senha por e-mail.
- Anexos.
- Um único servidor com SQLite: serve bem uma consultoria. Para muitos acessos simultâneos ou mais de um servidor, trocar por Postgres.

As regras de colunas, alertas, recorrência, % e quem vê ficam em `shared.js`, usado pelo servidor e pelo protótipo. Defina `TZ` (por exemplo `TZ=America/Sao_Paulo`) para o "hoje" do servidor ser o da consultoria.

## Segurança

Senhas com scrypt, sessão em cookie HttpOnly e SameSite, verificação de origem em toda escrita, limite de tentativas de login, toda consulta filtrada por organização e, para cliente, pelo próprio cliente. Os testes em `test/api.test.js` cobrem um cliente tentando ver tarefa de outro e outra organização tentando ver esta.

## Protótipo em um arquivo HTML

`prototype/tarefas-prototipo.html` abre direto no navegador, sem servidor e sem instalar nada. É a mesma interface (`public/`), com uma versão da API rodando no próprio navegador (`prototype/mock-api.js`) e os dados fictícios da demonstração, salvos só naquele navegador. Serve para mostrar o fluxo, não para uso real: não tem senha de verdade nem dados compartilhados entre pessoas.

Depois de mudar `public/` ou `prototype/mock-api.js`, gere de novo:

```bash
node prototype/build.js
```

`node prototype/build.js` também gera `prototype/tarefas-pagina.html`, a mesma página sem o esqueleto HTML, publicada como página privada no claude.ai para abrir no celular. Ali não existem `confirm()` nem `prompt()`, por isso a interface usa diálogos próprios (`ask` e `askText` em `public/main.js`).
