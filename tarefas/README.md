# Tarefas

Gestão de tarefas da consultoria, com a equipe e com os clientes. Primeira versão, construída a partir do mapa em `replica/recon.md` (que é um rascunho feito sem acesso ao site de referência).

## Rodar

Precisa de Node 22.5 ou mais novo. Não tem dependências para instalar.

```bash
cd tarefas
npm run demo                 # com dados fictícios; logins abaixo, senha demo1234
npm test                     # testes da API
```

Logins da demonstração: `admin@demo.local`, `equipe@demo.local`, `cliente@demo.local`.

Para uso real, a primeira execução cria a organização e o primeiro administrador:

```bash
ADMIN_EMAIL=voce@suaempresa.com ORG_NAME="Sua Consultoria" npm start
```

A senha temporária aparece uma vez no terminal; troque em Configurações. O banco fica em `tarefas/data/tarefas.db` (fora do git). Variáveis: `PORT` (3000), `DB_FILE`, `COOKIE_SECURE=1` quando estiver atrás de HTTPS.

## O que faz

- **Quadro por etapas:** A fazer, Em andamento, Revisão interna, Com o cliente, Em ajuste, Concluída. Arrastar entre colunas, ou trocar a etapa no detalhe (funciona pelo teclado).
- **Tarefa:** cliente, responsáveis, prazo, prioridade, descrição, checklist, comentários.
- **Ajustes:** a revisão interna registra ajuste interno; o cliente pede ajuste quando a tarefa está com ele. Os dois mandam a tarefa para "Em ajuste" e ficam contados. A equipe marca como resolvido.
- **Portal do cliente:** o cliente vê só as tarefas dele, aprova a entrega ou pede ajuste. Comentários só aparecem para ele se a equipe marcar "Visível para o cliente"; ajustes internos nunca aparecem.
- **Minhas tarefas:** atrasadas, hoje, próximas, sem prazo.
- **Modelos:** para trabalho que se repete (título, descrição, checklist).
- **Ajustes por cliente:** quantas vezes o trabalho voltou, por cliente.
- **Pessoas:** papéis Administrador, Equipe e Cliente; o administrador cria acessos e desativa.
- **Marca:** nome e cor da consultoria (o texto do botão escolhe preto ou branco pelo contraste).

## O que ainda não faz

- Email (avisos de prazo, convite, recuperação de senha). Hoje o administrador cria o acesso e passa a senha.
- Anexos.
- Logo próprio.
- Um único servidor com SQLite: serve bem uma consultoria. Para muitos clientes simultâneos ou mais de um servidor, trocar por Postgres.

## Segurança

Senhas com scrypt, sessão em cookie HttpOnly e SameSite, verificação de origem em toda escrita, limite de tentativas de login, toda consulta filtrada por organização e, para cliente, pelo próprio cliente. Os testes em `test/api.test.js` cobrem um cliente tentando ver tarefa de outro e outra organização tentando ver esta.
