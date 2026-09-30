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
