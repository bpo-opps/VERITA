'use strict';
// Só para a prévia: exemplo do texto que a IA escreve para a "Padaria Exemplo" (os dados fictícios do protótipo).
// No sistema de verdade, este texto é escrito pela IA a partir das respostas de cada cliente (bizplan-ai.js);
// os números saem da conta do sistema, e as tabelas do financeiro e dos cenários são anexadas por ele.
window.AI_EXAMPLE = {
  sumario: `A **Padaria Exemplo** produz pães de fermentação natural, cafés especiais e encomendas para eventos em Campinas/SP, no bairro Cambuí, com entregas pela cidade. Desde 2018 conquistou cerca de 900 clientes ativos que pagam mais caro que a concorrência por sabor, frescor e um atendimento que conhece o cliente pelo nome.

### Onde o negócio está
- Faturamento de R$ 52.000 por mês, com margem de contribuição de 56% e ponto de equilíbrio em R$ 47.321 por mês: a operação já se paga, mas com pouca folga (resultado de R$ 2.620 no primeiro mês, margem líquida de 5%).
- O cliente volta com frequência, o que torna previsível a maior parte da receita.

### Para onde quer ir
As metas para 12 meses são faturar R$ 80 mil por mês, abrir um quiosque no shopping e lançar uma assinatura semanal de pães. O plano pede R$ 80.000 de investimento, dos quais R$ 30.000 são próprios: faltam **R$ 50.000** de capital de terceiros, com retorno estimado em 13 meses.

### A principal recomendação
Começar pela **assinatura semanal**: ela usa a fidelidade que já existe, aumenta a receita recorrente e reduz o risco antes de assumir o custo fixo do quiosque.`,

  negocio: `A padaria nasceu em 2018 e hoje está em fase de **crescimento**. O que ela vende vai além do pão: é a garantia de um alimento fresco, sem conservantes, perto de casa, para quem não quer abrir mão de qualidade por falta de tempo.

### Propósito e visão
O propósito declarado é ser a padaria artesanal de referência da cidade, com mais duas lojas em 5 anos. É uma visão clara e mensurável, que serve de régua para as decisões: cada investimento deve aproximar o negócio desse modelo replicável.

### Valores na prática
- **Qualidade dos ingredientes**: é a base do preço mais alto; qualquer economia aqui ameaça o diferencial.
- **Atendimento próximo**: difícil de copiar por supermercados e aplicativos.
- **Respeito à equipe**: importante para reter o padeiro-chefe, apontado como um dos riscos do negócio.

Para chegar a três lojas, o que hoje depende das pessoas (receitas, ponto de fermentação, relacionamento) precisa virar processo escrito. [A definir na reunião: quanto do saber da produção já está documentado]`,

  proposta: `### Quem é o cliente
São dois públicos: **famílias e profissionais de 25 a 55 anos do bairro**, que valorizam comida de verdade e aceitam pagar um pouco mais, e **cafés e restaurantes** que revendem os pães. São cerca de 900 clientes ativos.

### Dores e desejos
- Pão industrializado sem sabor.
- Pouco tempo para ir longe buscar algo melhor.
- Encomendas que atrasam (uma dor que a própria padaria precisa vigiar, já que vende para eventos).

### Proposta de valor
**Pão de fermentação natural feito na hora, perto de você, com atendimento que te conhece pelo nome.** O diferencial está no produto e na relação, não no preço. Por isso a comunicação deve mostrar o processo (fermentação lenta, ingredientes) e as pessoas, e não promoções.

### Oportunidade
Os clientes de empresas (cafés e restaurantes) costumam comprar em volume e com regularidade. Vale separar esse público, com preço e entrega próprios: é receita mais estável para financiar o crescimento. [A definir na reunião: quanto do faturamento vem de empresas]`,

  mercado: `A padaria atua no **bairro e na cidade**, com loja física no Cambuí e entregas por Campinas.

### Tendências a favor
- **Procura por alimentação saudável**: reforça o valor da fermentação natural e da ausência de conservantes.
- **Pedidos por aplicativo e WhatsApp**: amplia o alcance sem abrir outra loja, desde que a entrega mantenha o frescor.

### Tendência contra
- **Custo do trigo em alta**: pressiona a margem. Com custos variáveis de 38% das vendas, cada aumento de insumo que não é repassado reduz diretamente o resultado.

### Tamanho do mercado
O número de clientes em potencial na área de atuação não foi informado. [A definir na reunião: estimativa de clientes em potencial no Cambuí e nos bairros atendidos por entrega] Essa estimativa ajuda a decidir se o próximo passo é crescer no bairro (assinatura, empresas) ou levar a marca para outro público (quiosque no shopping).`,

  concorrencia: `### Quem disputa o mesmo cliente
- **Padaria Central**: concorrente direta.
- **Supermercados do bairro**: resolvem a compra junto com o resto das compras.
- **Panificadoras de aplicativo**: competem na conveniência.

### Onde eles ganham
Preço menor e mais pontos de venda. Não é uma briga que a padaria deva comprar: baixar preço destrói a margem que sustenta a qualidade.

### Onde a padaria ganha
Sabor, frescor e atendimento. Esses atributos justificam o preço **mais caro** e são difíceis de copiar por quem vende em escala.

### Posicionamento recomendado
Ser a escolha "premium acessível" do bairro: o pão que vale a pena pagar mais. Na prática, isso significa
- comunicar o processo artesanal em todos os canais;
- criar conveniência onde os concorrentes ganham (assinatura com entrega, pedidos pelo WhatsApp com horário marcado);
- nunca entrar em guerra de preço com supermercados.`,

  receita: `### O que vende
1. Pães de fermentação natural (carro-chefe).
2. Cafés especiais.
3. Encomendas para eventos.

### Como ganha dinheiro
Hoje a receita vem de **venda avulsa** e de **contratos ou projetos** (encomendas e clientes empresariais). O ticket médio é de R$ 38, com cerca de 1.400 vendas por mês, e o cliente compra de novo com frequência.

### O que os números dizem
Um ticket de R$ 38 com recompra frequente indica um cliente fiel, mas cada venda é pequena. Crescer só com mais vendas avulsas exige muito movimento na loja.

### Recomendação
A **assinatura semanal de pães**, que já está nas metas, é o passo natural: transforma a recompra que já acontece em receita previsível, ajuda a planejar a produção (menos sobra) e aumenta o valor de cada cliente ao longo do tempo. Vale testar com um grupo pequeno de clientes fiéis antes de abrir para todos. [A definir na reunião: preço e formato da assinatura]`,

  marketing: `### Como os clientes chegam
Indicação, Instagram, WhatsApp e a própria loja física. O investimento em marketing e vendas é de R$ 2.500 por mês.

### Leitura
Indicação e loja física mostram que o boca a boca funciona, e isso combina com um produto que conquista pelo sabor. O Instagram e o WhatsApp são os canais certos para transformar esse boca a boca em escala.

### Recomendações
- **Instagram**: mostrar a produção (fermentação, forno, equipe) e os clientes; é o que sustenta o preço mais alto.
- **WhatsApp**: lista de clientes para pedidos e reservas do dia, e canal principal da assinatura.
- **Indicação**: programa simples (um pão de cortesia para quem indica e para o indicado) para acelerar o que já funciona.
- **Empresas**: abordagem ativa a cafés e restaurantes do bairro, com amostras e condição de volume.

O processo de venda e as ações de retenção ainda não foram descritos. [A definir na reunião: como é a venda das encomendas para eventos e o que é feito para o cliente voltar]`,

  operacao: `A operação de uma padaria artesanal depende de horário rígido de produção e do saber de poucas pessoas. As etapas, os fornecedores e os sistemas usados não foram detalhados no questionário. [A definir na reunião: etapas da produção, fornecedores principais e sistemas]

### Pontos de atenção
- **Insumos**: com o trigo em alta, contratos com fornecedores e compra planejada viram ferramenta de margem.
- **Sobra de produção**: a assinatura e as encomendas antecipadas ajudam a produzir a quantidade certa.
- **Expansão**: o quiosque no shopping exige decidir se a produção continua centralizada na loja (com transporte diário) ou se haverá forno no quiosque. Isso muda o investimento e a equipe necessária.

### Recomendação
Antes do quiosque, documentar as receitas e o padrão de produção e implantar um controle simples de vendas e sobras por produto. É o que torna o modelo replicável, condição para a visão de três lojas.`,

  pessoas: `As informações sobre sócios, equipe e forma de gestão não foram preenchidas. [A definir na reunião: sócios e papéis, tamanho da equipe, contratações previstas e como são tomadas as decisões]

### O que o plano já indica
- A saída do **padeiro-chefe** é um dos riscos apontados. Isso mostra que o conhecimento central do produto está concentrado em uma pessoa.
- Abrir um quiosque e lançar uma assinatura vai exigir pelo menos alguém responsável pela nova frente.

### Recomendações
- Formar um segundo padeiro (sucessor) e registrar receitas e processos.
- Definir quem cuida de cada frente (produção, loja, assinatura, empresas) e uma reunião mensal curta de resultados com 3 ou 4 indicadores: faturamento, margem, sobras e número de assinantes.`,

  financeiro: `### Leitura dos números
A padaria fatura R$ 52.000 por mês e tem **margem de contribuição de 56%**: de cada R$ 100 vendidos, sobram R$ 56 para pagar os custos fixos, o pró-labore e as parcelas de dívidas, que somam R$ 26.500 por mês.

O **ponto de equilíbrio é de R$ 47.321 por mês**, e o faturamento atual está R$ 4.679 acima dele. É uma folga pequena: uma queda de cerca de 9% nas vendas já levaria o negócio ao prejuízo. O resultado do primeiro mês é de R$ 2.620 (margem líquida de 5%).

### Investimento
O plano precisa de R$ 80.000, com R$ 30.000 de recursos próprios. A **necessidade de capital de terceiros é de R$ 50.000**, e o retorno do investimento acontece em **13 meses** se o crescimento de 2% ao mês se confirmar.

### Recomendações
- Antes de captar, aumentar a folga sobre o ponto de equilíbrio: rever preços dos itens de maior saída e negociar insumos.
- Buscar uma linha de crédito com carência de pelo menos 6 meses, para que as parcelas comecem quando o quiosque já estiver vendendo.
- Acompanhar todo mês o faturamento em relação ao ponto de equilíbrio.`,

  cenarios: `Os três cenários mostram o quanto o plano depende do ritmo de vendas:

- **Pessimista** (vendas 20% menores e metade do crescimento): o resultado dos 12 meses fica negativo. Com custos fixos altos, uma queda de vendas pesa rápido. Neste cenário, adiar o quiosque e priorizar a assinatura, que não exige custo fixo novo.
- **Realista** (as premissas informadas): resultado de R$ 72.560 em 12 meses e retorno do investimento em 13 meses. É o cenário que sustenta a captação.
- **Otimista** (vendas 20% maiores e 50% mais crescimento): resultado de R$ 177.926 no ano, o que permitiria antecipar a segunda unidade.

### Recomendação
Fazer o investimento **em etapas**: primeiro a assinatura (pouco investimento), depois o quiosque, só quando o faturamento estiver estável acima do ponto de equilíbrio com folga.`,

  swot: `| Forças | Fraquezas |
|---|---|
| Sabor e frescor (fermentação natural); atendimento próximo; clientes fiéis que compram com frequência; marca reconhecida no bairro | Preço mais alto que a concorrência; folga pequena sobre o ponto de equilíbrio; conhecimento concentrado no padeiro-chefe |

| Oportunidades | Ameaças |
|---|---|
| Procura por alimentação saudável; pedidos por aplicativo e WhatsApp; assinatura semanal; vendas para cafés e restaurantes | Custo do trigo em alta; saída do padeiro-chefe; supermercados e aplicativos com preço menor |`,

  riscos: `| Risco | Como reduzir |
|---|---|
| **Alta do trigo** | Contrato ou compra antecipada com fornecedores; revisão de preços a cada trimestre; acompanhar a margem por produto |
| **Saída do padeiro-chefe** | Formar um sucessor; documentar receitas e processos; plano de reconhecimento e participação nos resultados |
| **Folga pequena sobre o ponto de equilíbrio** | Aumentar o faturamento recorrente (assinatura e empresas) antes de assumir novos custos fixos |
| **Quiosque não atingir as vendas esperadas** | Testar com loja temporária ou ponto de evento antes do contrato longo; negociar aluguel por percentual de vendas |

[A definir na reunião: outros riscos que a equipe enxerga]`,

  esg: `As práticas atuais não foram descritas. [A definir na reunião: o que já é feito com sobras, embalagens e equipe]

### Sugestões simples para o porte do negócio
- **Ambiental**: doação ou venda com desconto das sobras do dia; embalagens de papel; desconto para quem traz a própria sacola.
- **Social**: compra de ingredientes de produtores da região; treinamento e plano de carreira para a equipe de produção.
- **Governança**: separar as contas da empresa e dos sócios; reunião mensal de resultados com números.

Essas práticas também reforçam a proposta de valor: o cliente que paga mais por um pão artesanal valoriza saber de onde ele vem.`,

  metas: `### Objetivo 1: crescer com receita previsível
- Faturar R$ 80 mil por mês até o fim dos 12 meses.
- Ter a assinatura semanal de pães funcionando, com meta de assinantes a definir. [A definir na reunião: meta de assinantes]

### Objetivo 2: levar a marca para um novo ponto
- Abrir o quiosque no shopping.
- Quiosque acima do seu próprio ponto de equilíbrio a partir do terceiro mês. [A definir na reunião: ponto de equilíbrio do quiosque]

### Objetivo 3: tornar a operação replicável
- Receitas e processos de produção documentados.
- Sucessor do padeiro-chefe formado.
- Reunião mensal de resultados acontecendo todo mês.`,

  acao: `| O quê | Quem | Até quando |
|---|---|---|
| Desenhar a assinatura semanal (formato, preço, entrega) e testar com 30 clientes fiéis | [A definir] | 30 dias |
| Rever preços dos itens de maior saída e negociar o trigo com fornecedores | [A definir] | 30 dias |
| Implantar controle simples de vendas e sobras por produto | [A definir] | 45 dias |
| Documentar as receitas e começar a formar o sucessor do padeiro-chefe | [A definir] | 60 dias |
| Levantar custos do quiosque e opções de crédito com carência | [A definir] | 60 dias |
| Abrir a assinatura para todos os clientes | [A definir] | 90 dias |
| Reunião mensal de resultados com a consultoria | Opps Consultoria | Todo mês |`,
};
