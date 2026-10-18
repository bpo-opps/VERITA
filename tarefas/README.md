# Tarefas

Gestão de tarefas da consultoria, com a equipe e com os clientes. Primeira versão, construída a partir do mapa em `replica/recon.md` (que é um rascunho feito sem acesso ao site de referência).

## Rodar

Precisa de Node 22.5 ou mais novo. Não tem dependências para instalar.

```bash
cd tarefas
npm run demo                 # com dados fictícios; logins abaixo, senha demo1234
npm test                     # testes da API
```

Logins da demonstração: `admin@demo.local`, `equipe@demo.local`, `analista@demo.local` (outra pessoa da equipe, para ver que internas alheias não aparecem) e `cliente@demo.local`.

Para uso real, a primeira execução cria a organização e o primeiro administrador:

```bash
ADMIN_EMAIL=voce@suaempresa.com ORG_NAME="Sua Consultoria" npm start
```

A senha temporária aparece uma vez no terminal; troque em Configurações. O banco fica em `tarefas/data/tarefas.db` (fora do git). Um banco da versão anterior não abre: como só tinha dados de teste, apague o arquivo. Variáveis: `PORT` (3000), `DB_FILE`, `COOKIE_SECURE=1` quando estiver atrás de HTTPS.

## As três visões

- **Administrador:** vê todas as tarefas, internas e externas; gerencia pessoas, clientes, logos e a marca; pode apagar.
- **Equipe Opps:** cria tarefas; vê todas as externas e as internas que criou ou em que é responsável.
- **Cliente:** vê só as tarefas externas da empresa dele, com % e datas; aprova entregas em revisão ou pede ajuste.

## O que faz

- **Interna ou externa.** Externa exige um cliente e aparece para ele. Interna é da consultoria: pode ficar ligada a um cliente relacionado ou à própria consultoria, e o cliente nunca vê.
- **Quadro com 6 colunas:** A fazer, Em andamento, Em revisão, Atrasada, Concluída no prazo, Concluída fora do prazo. "Atrasada" é automática quando o prazo passa. Ao concluir, informa-se a data de término, e ela decide entre no prazo e fora do prazo.
- **Datas:** início, prazo e término (a data real, pedida ao concluir).
- **% de execução:** informado à mão; se a tarefa tem checklist, segue os itens marcados.
- **Alertas do prazo:** no dia, 1 dia antes, 3 dias antes, 1 semana antes (vários ao mesmo tempo). Aparecem nos cards, na tela Alertas e no contador do menu.
- **Recorrência:** diária, semanal, quinzenal, mensal, bimestral, trimestral, quadrimestral, semestral, anual ou livre (a cada N dias). Ao concluir, a próxima é criada com as datas avançadas, o checklist zerado e os mesmos responsáveis.
- **Arquivar** tira a tarefa das telas sem apagar; "Ver arquivadas" mostra e permite desarquivar.
- **Logos** dos clientes e da consultoria nos cards (a imagem é reduzida para 128px no navegador).
- **Visões:** Kanban, Lista (agrupada por situação, empresa, responsável, prazo ou tipo) e Calendário (pelo prazo; no celular vira agenda). Filtros por tipo, empresa, responsável e prazo.
- **Também:** ajustes internos e do cliente, comentários (visíveis ao cliente só quando marcados, e nunca em interna), modelos com checklist, relatório por empresa com % no prazo.

## O que ainda não faz

- Email (avisos de prazo, convite, recuperação de senha). Os alertas aparecem só dentro do sistema.
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
