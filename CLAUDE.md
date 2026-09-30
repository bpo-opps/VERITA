# VERITA

## Instagram: fluxo de conteúdo

O plugin `instagram-skills` (marketplace `sergebulaev/instagram-skills`) está habilitado em `.claude/settings.json`.

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
