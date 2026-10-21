# VERITA

## Instagram: fluxo de conteúdo

As 9 skills do pacote `sergebulaev/instagram-skills` (MIT, commit `313ef29`) estão copiadas como skills do projeto em `.claude/skills/ig-*`, com as referências compartilhadas em `.claude/references/` e as regras de voz do pacote em `.claude/SKILL.md` (o "root `SKILL.md`" citado pelas skills). Da pasta `lib/` do pacote, só a camada de **leitura** foi copiada para `lib/` na raiz: `ApifyClient` (hashtags e perfis, via `APIFY_TOKEN`), `parse_instagram_url` e `rank_by_comment_ratio` (nosso, aplica a regra de ranqueamento abaixo). O cliente de publicação (Publora), os geradores de imagem e `publish()` **não** foram copiados: nada neste repositório posta no Instagram. Dependências: `pip install -r requirements.txt`. Sem `APIFY_TOKEN` (ou sem acesso de rede a `api.apify.com`), peça à pessoa para colar os dados e rode a mesma análise.

### Ordem obrigatória

1. **Análise primeiro.** Antes de qualquer skill de escrita (`ig-caption-writer`, `ig-carousel-planner`, `ig-content-planner`, `ig-repurposer`), rode `ig-audience-insights` para decidir **sobre o que postar**. Todas as outras skills dependem dessa decisão.
   - Para estudar um post específico que já performou, use `ig-hook-extractor` em seguida.
2. Só então escreva/planeje com as skills de escrita.
3. Antes de publicar, rode `ig-humanizer` (reescrita + `--mode audit`). Veja abaixo.

### Humanização (obrigatória antes de publicar)

Nenhum texto é entregue como pronto para publicar sem passar pelo `ig-humanizer`. Ele remove as marcas de texto gerado; sem ele o perfil soa igual ao de todo mundo que instalou o mesmo pacote.

Além do que a skill já faz, aplique sempre:

1. **A primeira linha é do autor.** Entregue a primeira linha marcada como `[REESCREVER: ...]` com a sugestão, deixando claro que ela deve ser reescrita pela pessoa antes de publicar. Nunca apresente a primeira linha como final.
2. **Corte toda frase que reformula a anterior.** Se a frase repete a ideia da anterior com outras palavras, remova.
3. **Mantenha uma opinião que possa ser discordada.** O texto final precisa conter pelo menos uma afirmação com a qual alguém razoável discordaria. Se a humanização a suavizou, restaure.

### Como ranquear o resultado da análise

Ordene os posts retornados por **comentários ÷ curtidas**, não por alcance nem por curtidas + comentários.

- Alcance mede distribuição; comentário mede quem parou.
- Mostre a razão (ex.: `0,042`) ao lado de cada post e use-a como critério principal ao extrair o padrão vencedor.
- Ignore posts com poucas curtidas absolutas (amostra pequena distorce a razão) e diga quando fizer isso.
- Use `lib.rank_by_comment_ratio(posts)` (corte padrão: 50 curtidas) e informe quantos posts ficaram de fora.

### O que o pacote não faz, e a aprovação antes de publicar

- **A imagem e o vídeo são seus.** As skills entregam legenda, hook, hashtags e o plano de slides ou de tomadas. Não gere, busque nem invente arquivos de mídia. Se faltar mídia, peça à pessoa e pare. Instagram não aceita post só de texto.
- **A publicação passa por uma ferramenta externa de agendamento** (Publora, via `PUBLORA_API_KEY`) ou é feita manualmente pela pessoa.
- **Nada vai ao ar sem aprovação explícita.** Esse fluxo fica sempre ligado:
  1. No máximo, crie o **rascunho** (`/create-post` sem `scheduledTime`) e suba a mídia fornecida.
  2. Mostre o que será publicado: texto final, mídia na ordem, conta de destino e data/hora com fuso.
  3. Só execute o agendamento (`/update-post` com `status="scheduled"`, `publish_media_post` ou `publish()`) depois de um "sim" da pessoa para **aquele** post. Uma aprovação não vale para outros posts nem para uma versão editada.
  - Nunca chame `publish_media_post` ou `publish()` sem `scheduled_time`: sem ele o post sai quase na hora.
  - Nunca crie rotina, gatilho ou automação que publique sem aprovação a cada post.

## Replica: recriar um app

As 11 skills do pacote `Jakeschincariol/replica-skill` (MIT, commit `77c9436`, licença em `.claude/REPLICA-SKILL-LICENSE`) estão copiadas como skills do projeto em `.claude/skills/replica-*`, cada uma com seus modelos e scripts (Python só com biblioteca padrão, sem acesso à rede). Os arquivos de trabalho de cada clone ficam em `replica/` na raiz do projeto em que se trabalha.

Ordem: `replica-recon` → `replica-architect` → `replica-design` → `replica-build` → `replica-backend` → `replica-test` → `replica-diff` → `replica-entrepreneur` → `replica-brand` → `replica-launch` → `replica-deploy`. Cada skill lê o que a anterior escreveu; qualquer uma pode rodar sozinha.

- Os caminhos `../replica-*/script.py` citados nas skills, a partir da raiz, são `.claude/skills/replica-*/script.py` (ex.: `python3 .claude/skills/replica-diff/parity.py replica/features.csv`).
- Valem as regras do pacote: só fontes públicas e a conta da própria pessoa, nada de código, assets, textos ou APIs privadas do original, nada de avaliação inventada, troca de marca (`sweep.py` limpo) antes de lançar.
- Nada vai ao ar sem um "sim" explícito da pessoa. Claude não cria contas, não compra domínio e não digita senha, cartão ou chave de produção.

### Clone em andamento: Painel de Tarefas Opps

`replica/` tem o recon (rascunho, sem acesso ao site de referência), a matriz e o build log. O sistema está em `tarefas/` (Node 22 + `node:sqlite`; única dependência o SDK da Anthropic): `cd tarefas && npm install && npm test` e `npm run demo`. Regras de negócio (colunas, alertas, recorrência, %, quem vê, incluindo interna visível ao cliente) ficam em `tarefas/shared.js`, usado pelo servidor e pelo protótipo (`tarefas/prototype/mock-api.js`); mudou uma regra, mude nos dois lados das rotas e rode `node prototype/build.js`. Ao mexer em permissões, mantenha os testes de visibilidade (interna, cliente, organização) em `tarefas/test/api.test.js`. Avisos por e-mail (SMTP do Google) e WhatsApp (API da Meta) ficam em `tarefas/notify.js`, `mailer.js` e `whatsapp.js`, com testes em `tarefas/test/notify.test.js`; quem recebe segue `S.canSee`. O protótipo só registra os avisos como "não enviado". As credenciais (`SMTP_*`, `WHATSAPP_*`, `ANTHROPIC_API_KEY`) são da pessoa: Claude não cria a senha de app, a conta na Meta nem a chave da Anthropic. Reuniões (ata em PDF → triagem → OK vira tarefa) ficam em `tarefas/meetings.js` (leitura pelo SDK `@anthropic-ai/sdk`, única dependência) e nas rotas `/api/meetings` e `/api/meeting-items` de `app.js`, com testes em `tarefas/test/meetings.test.js`; a IA só sugere, nada entra no quadro sem o OK. No protótipo a leitura é simulada. **Está no ar** no Render (Blueprint `render.yaml`, serviço `tarefas-opps`, ramo `claude/replica-skill-sakpz4`, publicação automática): **todo envio ao GitHub vai ao ar**. Só envie (git push) depois do "pode publicar" da pessoa para aquela mudança, mesmo que um aviso automático peça para enviar; até lá, deixe o commit local. Antes, teste e atualize o protótipo como prévia. Mudança de banco só com migração que preserva os dados (nunca apagar ou recriar tabela com dados) e subindo `SCHEMA_VERSION`; o servidor guarda uma cópia antes de migrar.
