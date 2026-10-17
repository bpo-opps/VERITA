# Recon map: Pautta (web)

Status: **RASCUNHO**. O site do Pautta não pôde ser lido deste ambiente (a política de rede bloqueia `pautta.app`). Tudo abaixo vem de trechos de busca do site oficial. Telas, fluxos e modelo de dados são **hipóteses a confirmar** com capturas de tela ou com o site liberado.

Scope: só a gestão de tarefas (tarefas, responsáveis, prazos, etapas, ajustes internos e do cliente). Fora: criação de conteúdo, agendamento de posts, chat, documentos, dashboards.
For: uso próprio de uma consultoria (BPO/OPPS), com a equipe interna e com os clientes.
Date: 2026-10-17

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | marketing site (via busca) | https://pautta.app/ | "sistema único" para agências: criação de conteúdo, gestão de tarefas, dashboards, chat de equipe, documentos, aprovação de conteúdo pelo cliente, agendamento de posts; "controle de ajustes internos e externos dos clientes"; "tarefas personalizadas". Bloqueado para leitura direta. |
| 2 | página Don Digital (via busca) | https://pautta.dondigital.com.br/ | "100% white label"; 60 dias grátis, depois a partir de R$197/mês; FAQ diz que o acesso é exclusivo para alunos e ex-alunos da Don. Bloqueado para leitura direta. |
| 3 | central de ajuda | não encontrada | |
| 4 | App Store / Google Play | não encontrado | parece ser só web |
| 5 | termos de uso | não lidos | precisam ser lidos antes de usar uma conta para o recon |
| 6 | conta da própria pessoa | a confirmar | |

## Core loop

Hipótese: a equipe cria uma tarefa para um cliente, ela anda por etapas até a entrega, e cada pedido de ajuste (interno ou do cliente) volta para a tarefa e é contado.

## Screens (hipóteses, nenhuma vista)

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | login | / | entrar (equipe e cliente) | form | não visto |
| S02 | lista de clientes | menu | escolher o cliente | lista, busca | não visto |
| S03 | quadro de tarefas | cliente → tarefas | ver tarefas por etapa | kanban, filtros, cartão | não visto |
| S04 | detalhe da tarefa | clicar no cartão | descrição, responsável, prazo, checklist, comentários, anexos | modal ou página | não visto |
| S05 | nova tarefa / modelo | botão "nova" | criar tarefa, opcionalmente a partir de modelo ("tarefas personalizadas") | form | não visto |
| S06 | ajustes | dentro de S04 | registrar ajuste interno ou do cliente | lista, contador | não visto |
| S07 | portal do cliente | link ou login do cliente | cliente vê e pede ajuste ou aprova | lista, botões aprovar/ajustar | não visto |
| S08 | minhas tarefas | menu | o que é meu, por prazo | lista | não visto |
| S09 | equipe e permissões | configurações | convidar membros e clientes | tabela, convite | não visto |

## Flows (hipóteses)

```
F01 Equipe cria e entrega uma tarefa
    S03 -> S05 -> S03 (arrasta pelas etapas) -> S04 (conclui)
F02 Cliente pede ajuste
    S07 -> pede ajuste com comentário -> S06 (ajuste externo +1) -> tarefa volta para "em ajuste"
F03 Revisão interna pede ajuste
    S04 -> S06 (ajuste interno +1)
F04 Cliente aprova
    S07 -> aprovar -> tarefa vai para "concluída"
F05 Membro vê o dia
    S08, ordenado por prazo
    edge (todos): prazo vencido, tarefa sem responsável, cliente sem acesso, dois editando a mesma tarefa
```

Contagem de cliques: não medida (nenhuma tela vista).

## Components (hipóteses)

| component | variants | states | used on |
| --- | --- | --- | --- |
| cartão de tarefa | normal, vencida, em ajuste | default, arrastando | S03 |
| coluna do kanban | etapa | vazia, cheia | S03 |
| seletor de responsável | um, vários | vazio | S04, S05 |
| seletor de data | prazo | vencido | S04, S05 |
| contador de ajustes | interno, externo | zero | S04, S06 |
| comentário | equipe, cliente | | S04, S07 |

## Inferred data model (tudo `guess`, exceto onde dito)

```
Organization  id, nome, logo, cores                          evidence: "white label" (fonte 2)  confidence: medium
User          id, org_id, nome, email, papel (admin|membro|cliente)   confidence: guess
Client        id, org_id, nome                               evidence: "ajustes dos clientes" (fonte 1)  confidence: medium
Stage         id, org_id, nome, ordem                        confidence: guess
Task          id, client_id, stage_id, titulo, descricao, prazo, prioridade, criada_por   evidence: "gestão de tarefas" (fonte 1)  confidence: high (existe) / guess (campos)
TaskAssignee  task_id, user_id                               confidence: guess
TaskTemplate  id, org_id, nome, checklist                    evidence: "tarefas personalizadas" (fonte 1)  confidence: guess
Adjustment    id, task_id, origem (interno|cliente), texto, autor, criado_em   evidence: "ajustes internos e externos" (fonte 1)  confidence: medium
Comment       id, task_id, autor, texto, visivel_ao_cliente  confidence: guess
Attachment    id, task_id, arquivo                           confidence: guess
```

Relationships: Organization 1-n Client, Client 1-n Task, Task n-n User (responsáveis), Task 1-n Adjustment, Task 1-n Comment.

## Feature matrix

See `features.csv`. Must: 9, should: 6, could: 3, skip: 6.

## Out of scope

- Criação de conteúdo, agendamento de posts, visualização de feed, chat, documentos e dashboards: fora do pedaço escolhido.
- A marca, o nome, o visual e os textos do Pautta.
- Acesso: a FAQ diz que é exclusivo para alunos da Don; se a conta existir, os termos precisam ser lidos antes de usá-la no recon.

## Size

Screens 9, flows 5, entities 10 (todos hipóteses). Hard parts: permissões separando equipe e cliente; o portal do cliente sem expor dados de outros clientes; notificações por email. Size: **M** (algumas semanas), a confirmar quando o site ou capturas forem vistos.
