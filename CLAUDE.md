# VERITA

## Instagram: fluxo de conteúdo

O plugin `instagram-skills` (marketplace `sergebulaev/instagram-skills`) está habilitado em `.claude/settings.json`.

### Ordem obrigatória

1. **Análise primeiro.** Antes de qualquer skill de escrita (`ig-caption-writer`, `ig-carousel-planner`, `ig-content-planner`, `ig-repurposer`), rode `ig-audience-insights` para decidir **sobre o que postar**. Todas as outras skills dependem dessa decisão.
   - Para estudar um post específico que já performou, use `ig-hook-extractor` em seguida.
2. Só então escreva/planeje com as skills de escrita.
3. Antes de publicar, `ig-humanizer --mode audit`.

### Como ranquear o resultado da análise

Ordene os posts retornados por **comentários ÷ curtidas**, não por alcance nem por curtidas + comentários.

- Alcance mede distribuição; comentário mede quem parou.
- Mostre a razão (ex.: `0,042`) ao lado de cada post e use-a como critério principal ao extrair o padrão vencedor.
- Ignore posts com poucas curtidas absolutas (amostra pequena distorce a razão) e diga quando fizer isso.
