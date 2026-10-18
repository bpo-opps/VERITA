# Build log

2026-10-18. Primeira versão em `tarefas/` (Node 22 + SQLite embutido, sem dependências). Construída sobre o recon em rascunho: as telas seguem as hipóteses do mapa, não telas vistas do original.

| ID | tela | status | o que falta |
| --- | --- | --- | --- |
| S01 | login | feito | recuperação de senha por email |
| S02 | clientes | feito | |
| S03 | quadro por etapas | feito | |
| S04 | detalhe da tarefa | feito | anexos |
| S05 | nova tarefa e modelos | feito | |
| S06 | ajustes | feito (dentro de S04) | |
| S07 | portal do cliente | feito | |
| S08 | minhas tarefas | feito | |
| S09 | pessoas | feito | convite por email |
| S10 | ajustes por cliente | feito | novo, não estava no mapa |
| S11 | configurações (marca, senha) | feito | logo |

Verificado: 9 testes de API (`npm test`) e um passeio no navegador (Chromium, 1440px e 390px) por criar tarefa por modelo, checklist, comentário visível, arrastar entre colunas, cliente pedir ajuste, cliente barrado nas telas da equipe. Sem erros no console. `sweep.py` limpo para "Pautta" e "Don Digital".
