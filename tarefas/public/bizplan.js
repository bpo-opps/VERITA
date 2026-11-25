'use strict';
// Plano de negócio: as perguntas do questionário, a conta financeira e o rascunho sem IA.
// Usado pelo servidor (require) e pelo navegador (self.BizPlan), igual em todo lugar.
// Estrutura: roteiro clássico (SEBRAE: sumário, mercado, marketing, operação, finanças, cenários)
// com o que um plano atual pede a mais: proposta de valor, modelo de receita e números da unidade,
// canais digitais, tecnologia, ESG, metas (OKRs), riscos e plano de ação de 90 dias.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BizPlan = api;
}(typeof self !== 'undefined' ? self : this, function () {
  const REVENUE_BANDS = [
    ['ate-81k', 'Até R$ 81 mil por ano'],
    ['ate-360k', 'De R$ 81 mil a R$ 360 mil por ano'],
    ['ate-1m', 'De R$ 360 mil a R$ 1 milhão por ano'],
    ['ate-4m8', 'De R$ 1 milhão a R$ 4,8 milhões por ano'],
    ['acima-4m8', 'Acima de R$ 4,8 milhões por ano'],
    ['nao-fatura', 'Ainda não fatura'],
  ];

  const SECTIONS = [
    ['negocio', 'Seu negócio'], ['clientes', 'Clientes e proposta de valor'], ['mercado', 'Mercado'],
    ['concorrencia', 'Concorrência'], ['receita', 'Produtos e receita'], ['vendas', 'Marketing e vendas'],
    ['operacao', 'Operação e tecnologia'], ['pessoas', 'Pessoas e gestão'], ['financas', 'Finanças'], ['metas', 'Metas e riscos'],
  ];

  // Faixas de valor ("faixa:min-max"; sem max = "acima de"). A conta usa o meio da faixa; "Sei o valor exato" grava o número.
  const k = n => (n >= 1e6 ? `${(n / 1e6).toLocaleString('pt-BR')} milhão` : n >= 1e3 ? `${(n / 1e3).toLocaleString('pt-BR')} mil` : String(n));
  // money(0, 5000, 15000) => Nada, Até 5 mil, 5 a 15 mil, Acima de 15 mil.
  const moneyRanges = steps => {
    const out = [];
    let start = 0;
    steps.forEach((s, i) => {
      if (i === 0 && s === 0) { out.push(['Nada / zero', 0, 0]); return; }
      out.push([start ? `De R$ ${k(start)} a R$ ${k(s)}` : `Até R$ ${k(s)}`, start, s]);
      start = s;
    });
    out.push([`Acima de R$ ${k(start)}`, start, null]);
    return out;
  };
  const countRanges = (steps, unit) => {
    const out = [];
    let start = 0;
    steps.forEach(s => { out.push([start ? `${k(start)} a ${k(s)} ${unit}` : `Até ${k(s)} ${unit}`, start, s]); start = s; });
    out.push([`Mais de ${k(start)} ${unit}`, start, null]);
    return out;
  };

  // type: text | long | list (uma por linha) | money | percent | int | choice | multi
  // help: a explicação curta embaixo da pergunta. what: "O que é isso?", com exemplo. icons: emoji de cada opção.
  // other: aceita "Outro: ..." escrito. ranges: faixas para tocar. short: entra no diagnóstico curto dos leads.
  const QUESTIONS = [
    { id: 'b_name', s: 'negocio', type: 'text', label: 'Qual é o nome do seu negócio?', placeholder: 'Ex.: Padaria Pão Quente' },
    { id: 'b_segment', s: 'negocio', type: 'choice', short: true, label: 'Em qual área o seu negócio atua?', help: 'Escolha a mais próxima.',
      options: ['Comércio', 'Serviços', 'Indústria', 'Tecnologia', 'Saúde', 'Alimentação', 'Educação', 'Agronegócio', 'Construção', 'Outro'],
      icons: { 'Comércio': '🛍️', 'Serviços': '🧰', 'Indústria': '🏭', 'Tecnologia': '💻', 'Saúde': '🩺', 'Alimentação': '🍽️', 'Educação': '🎓', 'Agronegócio': '🌾', 'Construção': '🏗️', 'Outro': '✨' } },
    { id: 'b_stage', s: 'negocio', type: 'choice', short: true, label: 'Como está o negócio hoje?',
      options: ['Ainda é uma ideia', 'Começando (até 1 ano)', 'Crescendo', 'Estável', 'Passando por dificuldades'],
      icons: { 'Ainda é uma ideia': '💡', 'Começando (até 1 ano)': '🌱', 'Crescendo': '📈', 'Estável': '⚖️', 'Passando por dificuldades': '🌧️' } },
    { id: 'b_since', s: 'negocio', type: 'choice', label: 'Há quanto tempo o negócio existe?',
      options: ['Ainda não abriu', 'Menos de 1 ano', '1 a 3 anos', '3 a 10 anos', 'Mais de 10 anos'],
      icons: { 'Ainda não abriu': '🚀', 'Menos de 1 ano': '🐣', '1 a 3 anos': '🌿', '3 a 10 anos': '🌳', 'Mais de 10 anos': '🏛️' } },
    { id: 'b_location', s: 'negocio', type: 'text', label: 'Em que cidade fica, e até onde atende?', placeholder: 'Ex.: Campinas/SP, atende a região toda e online' },
    { id: 'b_what', s: 'negocio', type: 'long', short: true, label: 'Me conta: o que o seu negócio faz?', help: 'Do jeito que você explicaria para um amigo, em uma ou duas frases.',
      placeholder: 'Ex.: Vendemos pães artesanais e cafés especiais no bairro e fazemos encomendas para festas.' },
    { id: 'b_problem', s: 'negocio', type: 'long', label: 'Que problema do cliente vocês resolvem?', help: 'Pense no que o cliente sofreria se vocês não existissem.',
      placeholder: 'Ex.: Quem quer pão fresco e saudável perto de casa, sem conservantes.' },
    { id: 'b_purpose', s: 'negocio', type: 'long', label: 'Onde você quer que o negócio esteja daqui a 5 anos?', help: 'Pode sonhar alto: mais lojas, outra cidade, vender o negócio, trabalhar menos…',
      placeholder: 'Ex.: Ter 3 lojas e ser a padaria artesanal mais conhecida da cidade.' },
    { id: 'b_values', s: 'negocio', type: 'multi', other: true, label: 'O que não pode faltar no jeito de vocês trabalharem?', help: 'Escolha até 3. São os valores do negócio.',
      options: ['Qualidade', 'Atendimento próximo', 'Preço justo', 'Inovação', 'Rapidez', 'Transparência', 'Respeito à equipe', 'Sustentabilidade'],
      icons: { 'Qualidade': '⭐', 'Atendimento próximo': '🤝', 'Preço justo': '🏷️', 'Inovação': '💡', 'Rapidez': '⚡', 'Transparência': '🔍', 'Respeito à equipe': '👥', 'Sustentabilidade': '🌱' } },

    { id: 'c_type', s: 'clientes', type: 'multi', short: true, label: 'Para quem vocês vendem?', help: 'Pode marcar mais de um.',
      options: ['Pessoas (consumidor final)', 'Empresas', 'Governo'], icons: { 'Pessoas (consumidor final)': '🙋', 'Empresas': '🏢', 'Governo': '🏛️' } },
    { id: 'c_ideal', s: 'clientes', type: 'long', label: 'Quem é o seu cliente ideal?', help: 'Aquele que você gostaria de ter mais. Diga quem é, onde está e o que ele valoriza.',
      placeholder: 'Ex.: Famílias do bairro, de 25 a 55 anos, que valorizam comida de verdade e pagam um pouco mais por isso.' },
    { id: 'c_pains', s: 'clientes', type: 'multi', other: true, label: 'O que mais incomoda o seu cliente antes de comprar de vocês?', help: 'As dores que fazem ele procurar uma solução. Pode marcar várias.',
      options: ['Preço alto', 'Falta de tempo', 'Atendimento ruim', 'Baixa qualidade', 'Demora na entrega', 'Difícil de encontrar', 'Falta de confiança', 'Falta de opções'],
      icons: { 'Preço alto': '💸', 'Falta de tempo': '⏰', 'Atendimento ruim': '😕', 'Baixa qualidade': '👎', 'Demora na entrega': '🐢', 'Difícil de encontrar': '🔎', 'Falta de confiança': '🤨', 'Falta de opções': '📦' } },
    { id: 'c_why', s: 'clientes', type: 'multi', other: true, label: 'Por que o cliente escolhe vocês e não o concorrente?', help: 'Esse é o seu diferencial, na visão do cliente. Marque até 3; se não souber, pense no que os clientes mais elogiam.',
      options: ['Qualidade', 'Preço', 'Atendimento', 'Rapidez', 'Localização', 'Variedade', 'Confiança na marca', 'Tecnologia ou inovação', 'Personalização'],
      icons: { 'Qualidade': '⭐', 'Preço': '🏷️', 'Atendimento': '🤝', 'Rapidez': '⚡', 'Localização': '📍', 'Variedade': '🧺', 'Confiança na marca': '🛡️', 'Tecnologia ou inovação': '💡', 'Personalização': '🎯' } },
    { id: 'c_count', s: 'clientes', type: 'int', label: 'Quantos clientes compram de vocês hoje?', help: 'Clientes ativos: que compraram nos últimos meses.', ranges: countRanges([20, 100, 500, 2000], 'clientes') },
    { id: 'c_concentration', s: 'clientes', type: 'percent', label: 'Quanto do faturamento vem dos 3 maiores clientes?', help: 'Some o que os 3 clientes que mais compram representam no total.',
      what: 'Mostra se o negócio depende de poucos clientes. Ex.: se você fatura R$ 100 mil e os 3 maiores compram R$ 60 mil, são 60%. Acima de 50% é arriscado: se um sair, o impacto é grande.',
      ranges: [['Menos de 20%', 0, 20], ['De 20% a 50%', 20, 50], ['Mais de 50%', 50, 80]] },

    { id: 'm_region', s: 'mercado', type: 'choice', label: 'Até onde vocês vendem?',
      options: ['Bairro ou cidade', 'Região', 'Estado', 'Brasil todo', 'Outros países', 'Só online'],
      icons: { 'Bairro ou cidade': '🏘️', 'Região': '🗺️', 'Estado': '📍', 'Brasil todo': '🇧🇷', 'Outros países': '🌎', 'Só online': '🌐' } },
    { id: 'm_size', s: 'mercado', type: 'int', label: 'Quantos clientes em potencial existem na sua área?', help: 'Um chute bem pensado já ajuda.',
      what: 'É o tamanho do seu mercado: quantas pessoas ou empresas poderiam comprar de você. Ex.: um bairro grande tem uns 20 mil moradores; uma cidade média tem cerca de 2 mil clínicas.',
      ranges: [['Até 1 mil', 0, 1000], ['De 1 mil a 10 mil', 1000, 10000], ['De 10 mil a 100 mil', 10000, 100000], ['Mais de 100 mil', 100000, null]] },
    { id: 'm_trends', s: 'mercado', type: 'multi', other: true, label: 'O que está mudando no seu setor?', help: 'Marque o que mais afeta vocês.',
      options: ['Clientes comprando mais pela internet', 'Mais procura por saúde e bem-estar', 'Custos subindo', 'Mais concorrência', 'Novas tecnologias', 'Mudanças em leis ou impostos', 'Clientes mais exigentes', 'Falta de mão de obra'],
      icons: { 'Clientes comprando mais pela internet': '📱', 'Mais procura por saúde e bem-estar': '🥗', 'Custos subindo': '📈', 'Mais concorrência': '🥊', 'Novas tecnologias': '🤖', 'Mudanças em leis ou impostos': '⚖️', 'Clientes mais exigentes': '🧐', 'Falta de mão de obra': '🧑‍🔧' } },

    { id: 'k_list', s: 'concorrencia', type: 'list', label: 'Quem são os seus principais concorrentes?', help: 'Um por linha. Vale incluir quem resolve o mesmo problema de outro jeito (ex.: supermercado, aplicativo).',
      placeholder: 'Padaria Central\nSupermercado do bairro\nAplicativos de entrega' },
    { id: 'k_better', s: 'concorrencia', type: 'multi', other: true, label: 'No que os concorrentes são melhores que vocês?', help: 'Seja sincero: isso ajuda a achar o que melhorar. Pode marcar vários.',
      options: ['Qualidade', 'Preço', 'Atendimento', 'Rapidez', 'Localização', 'Variedade', 'Confiança na marca', 'Tecnologia ou inovação', 'Personalização'],
      icons: { 'Qualidade': '⭐', 'Preço': '🏷️', 'Atendimento': '🤝', 'Rapidez': '⚡', 'Localização': '📍', 'Variedade': '🧺', 'Confiança na marca': '🛡️', 'Tecnologia ou inovação': '💡', 'Personalização': '🎯' } },
    { id: 'k_worse', s: 'concorrencia', type: 'multi', other: true, label: 'E no que vocês são melhores que eles?', help: 'Pode marcar vários.',
      options: ['Qualidade', 'Preço', 'Atendimento', 'Rapidez', 'Localização', 'Variedade', 'Confiança na marca', 'Tecnologia ou inovação', 'Personalização'],
      icons: { 'Qualidade': '⭐', 'Preço': '🏷️', 'Atendimento': '🤝', 'Rapidez': '⚡', 'Localização': '📍', 'Variedade': '🧺', 'Confiança na marca': '🛡️', 'Tecnologia ou inovação': '💡', 'Personalização': '🎯' } },
    { id: 'k_price', s: 'concorrencia', type: 'choice', short: true, label: 'Comparado aos concorrentes, o seu preço é…', options: ['Mais barato', 'Parecido', 'Mais caro'],
      icons: { 'Mais barato': '⬇️', 'Parecido': '↔️', 'Mais caro': '⬆️' } },

    { id: 'p_list', s: 'receita', type: 'list', label: 'Quais são os seus principais produtos ou serviços?', help: 'Um por linha, do que mais vende para o que menos vende.', placeholder: 'Pães artesanais\nCafés especiais\nEncomendas para festas' },
    { id: 'p_model', s: 'receita', type: 'multi', short: true, label: 'Como o dinheiro entra no negócio?', help: 'Pode marcar mais de um.',
      options: ['Venda avulsa', 'Assinatura ou mensalidade', 'Contrato ou projeto', 'Comissão', 'Licença ou royalties', 'Outro'],
      icons: { 'Venda avulsa': '🧾', 'Assinatura ou mensalidade': '🔁', 'Contrato ou projeto': '📑', 'Comissão': '🤝', 'Licença ou royalties': '©️', 'Outro': '✨' } },
    { id: 'p_ticket', s: 'receita', type: 'money', label: 'Quanto o cliente gasta, em média, em cada compra?', help: 'É o seu "ticket médio".',
      what: 'Ticket médio é o valor médio de cada venda. Ex.: se você vendeu R$ 30 mil em 1.000 vendas no mês, o ticket médio é R$ 30.',
      ranges: moneyRanges([50, 150, 500, 2000, 10000]) },
    { id: 'p_sales', s: 'receita', type: 'int', label: 'Quantas vendas (ou atendimentos) vocês fazem por mês?', help: 'Uma média.',
      ranges: countRanges([30, 100, 300, 1000, 3000], 'vendas') },
    { id: 'p_repeat', s: 'receita', type: 'choice', short: true, label: 'O cliente costuma voltar a comprar?',
      options: ['Quase nunca', 'Às vezes', 'Com frequência', 'Paga todo mês'], icons: { 'Quase nunca': '🚶', 'Às vezes': '🙂', 'Com frequência': '😍', 'Paga todo mês': '🔁' } },

    { id: 's_channels', s: 'vendas', type: 'multi', short: true, label: 'Como os clientes chegam até vocês?', help: 'Marque todos os caminhos que trazem clientes.',
      options: ['Indicação', 'Instagram', 'Google', 'Site', 'WhatsApp', 'Vendedor ou representante', 'Loja física', 'Marketplace', 'Eventos e feiras', 'LinkedIn', 'Outro'],
      icons: { 'Indicação': '🗣️', 'Instagram': '📸', 'Google': '🔍', 'Site': '🌐', 'WhatsApp': '💬', 'Vendedor ou representante': '🧑‍💼', 'Loja física': '🏪', 'Marketplace': '🛒', 'Eventos e feiras': '🎪', 'LinkedIn': '💼', 'Outro': '✨' } },
    { id: 's_process', s: 'vendas', type: 'multi', other: true, label: 'Como acontece uma venda?', help: 'Marque os passos que costumam acontecer, do primeiro contato até o pagamento.',
      options: ['Contato pelo WhatsApp', 'Cliente vem até a loja', 'Visita ao cliente', 'Pelo site ou loja virtual', 'Envio de orçamento ou proposta', 'Negociação de preço ou prazo', 'Pagamento na hora', 'Pagamento a prazo (boleto, parcelado)', 'Entrega ou instalação'],
      icons: { 'Contato pelo WhatsApp': '💬', 'Cliente vem até a loja': '🏪', 'Visita ao cliente': '🚗', 'Pelo site ou loja virtual': '🌐', 'Envio de orçamento ou proposta': '📄', 'Negociação de preço ou prazo': '🤝', 'Pagamento na hora': '💳', 'Pagamento a prazo (boleto, parcelado)': '🧾', 'Entrega ou instalação': '🚚' } },
    { id: 's_spend', s: 'vendas', type: 'money', label: 'Quanto vocês gastam por mês para atrair clientes?', help: 'Anúncios, agência, influenciadores, brindes, comissões fixas.',
      ranges: moneyRanges([0, 1000, 3000, 6000, 10000]) },
    { id: 's_retention', s: 'vendas', type: 'multi', other: true, label: 'O que vocês fazem para o cliente voltar ou indicar?', help: 'Marque o que já fazem.',
      options: ['Cartão ou programa de fidelidade', 'Pós-venda pelo WhatsApp', 'Promoções para quem já é cliente', 'Brinde ou cortesia', 'Programa de indicação', 'Mensagem em datas especiais', 'Nada ainda'],
      icons: { 'Cartão ou programa de fidelidade': '💳', 'Pós-venda pelo WhatsApp': '💬', 'Promoções para quem já é cliente': '🏷️', 'Brinde ou cortesia': '🎁', 'Programa de indicação': '🗣️', 'Mensagem em datas especiais': '🎂', 'Nada ainda': '🫥' } },
    { id: 'o_steps', s: 'operacao', type: 'list', label: 'Quais as etapas para entregar o que vocês vendem?', help: 'Uma por linha. Do pedido até o cliente receber.', placeholder: 'Comprar os insumos\nProduzir\nEmbalar\nEntregar' },
    { id: 'o_suppliers', s: 'operacao', type: 'list', label: 'Quem são os fornecedores e parceiros mais importantes?', help: 'Um por linha. Sem eles o negócio para.', placeholder: 'Moinho Bom Trigo\nTransportadora X' },
    { id: 'o_tools', s: 'operacao', type: 'multi', other: true, label: 'Que ferramentas vocês usam para controlar o negócio?', help: 'Marque todas.',
      options: ['Planilha/Excel', 'Caderno', 'Sistema de gestão (ERP)', 'Sistema de vendas (PDV)', 'CRM', 'Emissor de notas', 'Nada ainda'],
      icons: { 'Planilha/Excel': '📊', 'Caderno': '📒', 'Sistema de gestão (ERP)': '🗂️', 'Sistema de vendas (PDV)': '🧾', 'CRM': '📇', 'Emissor de notas': '🧮', 'Nada ainda': '🫥' },
      what: 'ERP é um sistema que junta vendas, estoque, financeiro e notas fiscais. CRM é o controle dos clientes e das negociações. PDV é o sistema do caixa.' },
    { id: 'o_bottleneck', s: 'operacao', type: 'multi', other: true, label: 'O que mais atrapalha o dia a dia hoje?', help: 'O gargalo: aquilo que, se resolvido, faria tudo andar melhor. Marque até 3.',
      options: ['Falta de gente', 'Tarefas manuais demais', 'Controle de estoque', 'Fornecedores atrasam', 'Falta de dinheiro em caixa', 'Poucas vendas', 'Retrabalho e erros', 'Tudo depende do dono', 'Comunicação da equipe'],
      icons: { 'Falta de gente': '🧑‍🤝‍🧑', 'Tarefas manuais demais': '✍️', 'Controle de estoque': '📦', 'Fornecedores atrasam': '🚚', 'Falta de dinheiro em caixa': '💰', 'Poucas vendas': '📉', 'Retrabalho e erros': '🔁', 'Tudo depende do dono': '🙋', 'Comunicação da equipe': '📢' } },
    { id: 'g_partners', s: 'pessoas', type: 'list', label: 'Quem são os sócios e o que cada um faz?', help: 'Um por linha.', placeholder: 'Ana: vendas e finanças\nBruno: produção' },
    { id: 'g_team', s: 'pessoas', type: 'int', label: 'Quantas pessoas trabalham no negócio, contando os sócios?', ranges: [['Só eu', 1, 1], ['2 a 5 pessoas', 2, 5], ['6 a 10 pessoas', 6, 10], ['11 a 30 pessoas', 11, 30], ['Mais de 30 pessoas', 30, null]] },
    { id: 'g_hire', s: 'pessoas', type: 'multi', other: true, label: 'Vocês precisam contratar alguém nos próximos 12 meses?', help: 'Marque as áreas.',
      options: ['Vendas', 'Atendimento', 'Produção ou operação', 'Administrativo e financeiro', 'Marketing', 'Ninguém por enquanto'],
      icons: { 'Vendas': '🧑‍💼', 'Atendimento': '🎧', 'Produção ou operação': '🛠️', 'Administrativo e financeiro': '🧮', 'Marketing': '📣', 'Ninguém por enquanto': '✋' } },
    { id: 'g_management', s: 'pessoas', type: 'choice', label: 'Como vocês acompanham os resultados?',
      options: ['Não acompanhamos', 'Olho o caixa de vez em quando', 'Tenho números, mas sem rotina', 'Reunião mensal com indicadores'],
      icons: { 'Não acompanhamos': '🙈', 'Olho o caixa de vez em quando': '👀', 'Tenho números, mas sem rotina': '📋', 'Reunião mensal com indicadores': '📊' } },

    { id: 'f_revenue', s: 'financas', type: 'money', short: true, label: 'Quanto o negócio vende por mês, em média?', help: 'É o faturamento: tudo o que entra das vendas, antes de pagar as contas.',
      what: 'Faturamento é a soma de todas as vendas do mês. Ex.: 1.000 vendas de R$ 50 = R$ 50 mil de faturamento. Se varia muito, pense na média dos últimos 6 meses.',
      ranges: moneyRanges([10000, 30000, 60000, 100000, 200000, 400000]) },
    { id: 'f_fixed', s: 'financas', type: 'money', short: true, label: 'Quanto são as contas fixas do mês?', help: 'O que você paga todo mês, vendendo ou não. Sem contar a retirada dos sócios.',
      what: 'Custos fixos são as contas que chegam todo mês: aluguel, salários e encargos, contador, internet, energia, sistemas. Ex.: aluguel R$ 3 mil + salários R$ 10 mil + outros R$ 2 mil = R$ 15 mil.',
      ranges: moneyRanges([5000, 15000, 30000, 60000, 100000]) },
    { id: 'f_variable', s: 'financas', type: 'percent', short: true, label: 'De cada R$ 100 vendidos, quanto vai para o custo do que você vende?', help: 'Mercadoria ou matéria-prima, comissões, frete, taxas de cartão e de aplicativo.',
      what: 'São os custos variáveis: só existem quando você vende. Ex.: um pão vendido por R$ 10 que gasta R$ 4 de ingredientes e R$ 0,50 de taxa de cartão tem 45% de custo variável.',
      ranges: [['Até R$ 20 (até 20%)', 0, 20], ['De R$ 20 a R$ 35', 20, 35], ['De R$ 35 a R$ 50', 35, 50], ['De R$ 50 a R$ 65', 50, 65], ['Mais de R$ 65', 65, 80]] },
    { id: 'f_tax', s: 'financas', type: 'percent', short: true, label: 'Quanto de imposto sai de cada venda?', help: 'Se não souber, o contador sabe. No Simples Nacional costuma ficar entre 4% e 15%.',
      what: 'É o percentual de impostos sobre o faturamento. Ex.: com 6% de imposto, de cada R$ 100 vendidos, R$ 6 vão para o governo. MEI paga um valor fixo por mês, quase zero em percentual.',
      ranges: [['MEI / quase nada', 0, 2], ['Até 6%', 2, 6], ['De 6% a 10%', 6, 10], ['De 10% a 15%', 10, 15], ['Mais de 15%', 15, 20]] },
    { id: 'f_prolabore', s: 'financas', type: 'money', label: 'Quanto os sócios tiram por mês, somando todos?', help: 'É o pró-labore: o "salário" dos donos.',
      what: 'Pró-labore é a retirada mensal dos sócios pelo trabalho no negócio. Ex.: dois sócios tirando R$ 4 mil cada = R$ 8 mil.',
      ranges: moneyRanges([0, 3000, 6000, 10000, 20000]) },
    { id: 'f_debt', s: 'financas', type: 'money', label: 'Quanto vocês pagam por mês de empréstimos e financiamentos?', help: 'Só as parcelas.',
      ranges: moneyRanges([0, 2000, 5000, 10000, 20000]) },
    { id: 'f_growth', s: 'financas', type: 'percent', short: true, label: 'Quanto vocês querem crescer por mês?', help: 'Uma meta realista. 2% ao mês dá cerca de 27% no ano.',
      what: 'Crescer 2% ao mês parece pouco, mas soma: em 12 meses o faturamento fica cerca de 27% maior. 5% ao mês dá quase 80% no ano.',
      ranges: [['Manter como está', 0, 0], ['Cerca de 1% ao mês', 0.5, 1.5], ['Cerca de 2% ao mês', 1.5, 2.5], ['Cerca de 3% ao mês', 2.5, 3.5], ['5% ou mais ao mês', 4.5, 6]] },
    { id: 'f_invest', s: 'financas', type: 'money', label: 'Quanto vocês precisam investir para crescer?', help: 'Reforma, equipamentos, estoque, marketing de lançamento, capital de giro.',
      what: 'É o dinheiro para o próximo passo do negócio, que volta com o tempo. Capital de giro é o dinheiro para manter o negócio rodando enquanto as vendas não entram.',
      ranges: moneyRanges([0, 20000, 50000, 100000, 250000, 500000]) },
    { id: 'f_own', s: 'financas', type: 'money', label: 'E quanto disso vocês já têm guardado?', help: 'Dinheiro dos sócios ou da empresa, sem empréstimo.',
      ranges: moneyRanges([0, 10000, 30000, 60000, 100000, 250000]) },

    { id: 'r_goals', s: 'metas', type: 'list', label: 'Quais são as 3 metas mais importantes para os próximos 12 meses?', help: 'Uma por linha. Quanto mais concreta, melhor.',
      placeholder: 'Faturar R$ 80 mil por mês\nAbrir um quiosque no shopping\nLançar uma assinatura semanal' },
    { id: 'r_risks', s: 'metas', type: 'multi', other: true, short: true, label: 'O que poderia atrapalhar esses planos?', help: 'Marque os riscos que você enxerga.',
      options: ['Perder um cliente grande', 'Alta dos custos', 'Saída de alguém-chave da equipe', 'Novo concorrente', 'Falta de dinheiro (caixa)', 'Mudança em leis ou impostos', 'Problemas com fornecedor', 'Crise na economia'],
      icons: { 'Perder um cliente grande': '🏃', 'Alta dos custos': '📈', 'Saída de alguém-chave da equipe': '🚪', 'Novo concorrente': '🥊', 'Falta de dinheiro (caixa)': '💰', 'Mudança em leis ou impostos': '⚖️', 'Problemas com fornecedor': '🚚', 'Crise na economia': '🌪️' } },
    { id: 'r_esg', s: 'metas', type: 'multi', other: true, label: 'Vocês já fazem alguma dessas coisas?', help: 'São práticas de ESG: cuidado com o ambiente, as pessoas e a boa gestão.',
      what: 'ESG vem do inglês: ambiental, social e governança. Para um negócio pequeno, começa com coisas simples, como reciclar, tratar bem a equipe e manter as contas organizadas.',
      options: ['Reciclagem ou menos desperdício', 'Embalagens sustentáveis', 'Compras de fornecedores locais', 'Benefícios e treinamento para a equipe', 'Ações na comunidade', 'Contas da empresa separadas das pessoais', 'Nada ainda'],
      icons: { 'Reciclagem ou menos desperdício': '♻️', 'Embalagens sustentáveis': '📦', 'Compras de fornecedores locais': '🏘️', 'Benefícios e treinamento para a equipe': '🎓', 'Ações na comunidade': '🤲', 'Contas da empresa separadas das pessoais': '🗂️', 'Nada ainda': '🫥' } },
    { id: 'r_help', s: 'metas', type: 'multi', short: true, label: 'Em que você mais gostaria de ajuda?', help: 'Marque até 3.',
      options: ['Finanças', 'Vendas', 'Marketing', 'Processos', 'Pessoas', 'Tecnologia', 'Conseguir investimento', 'Gestão e estratégia'],
      icons: { 'Finanças': '💰', 'Vendas': '🤝', 'Marketing': '📣', 'Processos': '⚙️', 'Pessoas': '👥', 'Tecnologia': '💻', 'Conseguir investimento': '🏦', 'Gestão e estratégia': '🧭' } },
  ];
  const SHORT = QUESTIONS.filter(q => q.short).map(q => q.id);
  const BY_ID = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));
  // Valor numérico de uma resposta: o número exato, ou o meio da faixa ("acima de" = 25% acima do início).
  const rangeOf = (q, v) => (q && q.ranges && typeof v === 'string' ? q.ranges.find(r => rangeId(r) === v) : null);
  const rangeId = r => `faixa:${r[1]}-${r[2] ?? ''}`;
  function numOf(id, v) {
    if (isEmpty(v)) return null;
    if (typeof v === 'number') return v;
    const r = rangeOf(BY_ID[id], v);
    if (!r) return Number.isFinite(Number(v)) ? Number(v) : null;
    return r[2] === null ? r[1] * 1.25 : (r[1] + r[2]) / 2;
  }
  const isRange = (id, v) => !!rangeOf(BY_ID[id], v);


  // As seções do documento, na ordem.
  const DOC = [
    ['sumario', 'Sumário executivo'], ['diagnostico', 'Diagnóstico: alertas e oportunidades'], ['negocio', 'O negócio'], ['proposta', 'Clientes e proposta de valor'], ['mercado', 'Análise de mercado'],
    ['concorrencia', 'Concorrência e posicionamento'], ['receita', 'Produtos, preços e modelo de receita'], ['marketing', 'Marketing e vendas'],
    ['operacao', 'Operação e tecnologia'], ['pessoas', 'Pessoas, gestão e governança'], ['financeiro', 'Plano financeiro'], ['cenarios', 'Cenários'],
    ['swot', 'Análise SWOT'], ['riscos', 'Riscos e como reduzir'], ['esg', 'Sustentabilidade e impacto (ESG)'], ['metas', 'Metas e OKRs para 12 meses'],
    ['acao', 'Plano de ação (90 dias)'], ['pendencias', 'Pontos a definir com a consultoria'],
  ];
  const DOC_TITLE = Object.fromEntries(DOC);

  const isEmpty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  // Valida e limpa uma resposta. Devolve o valor limpo (ou null para apagar) ou lança Error.
  function clean(id, v) {
    const q = BY_ID[id];
    if (!q) throw new Error(`Pergunta desconhecida: ${id}`);
    if (isEmpty(v)) return null;
    const num = (min, max) => {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${q.label}: número inválido`);
      return Math.round(n * 100) / 100;
    };
    switch (q.type) {
      case 'text': if (typeof v !== 'string') throw new Error(`${q.label}: texto inválido`); return v.trim().slice(0, 300) || null;
      case 'long': if (typeof v !== 'string') throw new Error(`${q.label}: texto inválido`); return v.trim().slice(0, 5000) || null;
      case 'list': {
        const arr = (Array.isArray(v) ? v : String(v).split('\n')).map(x => String(x).trim()).filter(Boolean).slice(0, 30).map(x => x.slice(0, 300));
        return arr.length ? arr : null;
      }
      case 'money': return rangeOf(q, v) ? v : num(0, 1e12);
      case 'percent': return rangeOf(q, v) ? v : num(0, 100);
      case 'int': return rangeOf(q, v) ? v : Math.round(num(q.min ?? 0, q.max ?? 1e9));
      case 'choice': if (!q.options.includes(v)) throw new Error(`${q.label}: opção inválida`); return v;
      case 'multi': {
        // Com "other", aceita também um item escrito: "Outro: ...".
        const ok = x => q.options.includes(x) || (q.other && typeof x === 'string' && /^Outro: .{1,120}$/.test(x.trim()));
        if (!Array.isArray(v) || !v.every(ok)) throw new Error(`${q.label}: opção inválida`);
        return v.length ? [...new Set(v.map(x => x.trim()))] : null;
      }
      default: return null;
    }
  }

  // Quanto do questionário foi respondido (contando "não sei" como respondido).
  // ids: só estas perguntas (o diagnóstico curto dos leads); sem ids, o questionário inteiro.
  function progress(answers = {}, unknown = [], ids = null) {
    const all = ids ? QUESTIONS.filter(q => ids.includes(q.id)) : QUESTIONS;
    const ok = q => !isEmpty(answers[q.id]) || unknown.includes(q.id);
    const done = all.filter(ok).length;
    const bySection = SECTIONS.map(([key, title]) => {
      const qs = all.filter(q => q.s === key);
      return { key, title, total: qs.length, done: qs.filter(ok).length };
    }).filter(x => x.total);
    return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0, bySection };
  }

  // ---------- conta financeira (o número nunca vem da IA) ----------
  const brl = n => (n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
  const pct = n => (n === null || n === undefined || !Number.isFinite(n) ? '–' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

  function finance(a = {}) {
    const val = id => numOf(id, a[id]);
    const revenueBase = val('f_revenue') ?? (val('p_ticket') !== null && val('p_sales') !== null ? val('p_ticket') * val('p_sales') : null);
    const missing = [];
    if (revenueBase === null) missing.push('faturamento por mês (ou ticket médio e vendas por mês)');
    if (val('f_fixed') === null) missing.push('custos fixos');
    if (val('f_variable') === null) missing.push('custos variáveis (%)');
    if (val('f_tax') === null) missing.push('impostos (%)');
    if (missing.length) return { ok: false, missing };
    const assumed = [];
    if (['f_revenue', 'f_fixed', 'f_variable', 'f_tax', 'f_prolabore', 'f_debt', 'f_growth', 'f_invest', 'f_own', 'p_ticket', 'p_sales'].some(id => isRange(id, a[id]))) {
      assumed.push('valores informados por faixa: a conta usa o meio de cada faixa (números aproximados)');
    }
    const g = (val('f_growth') ?? (assumed.push('crescimento de 0% ao mês (não informado)'), 0)) / 100;
    const varPct = val('f_variable') / 100, taxPct = val('f_tax') / 100;
    const fixed = val('f_fixed'), pro = val('f_prolabore') ?? 0, debt = val('f_debt') ?? 0;
    const fixedAll = fixed + pro + debt;
    const invest = val('f_invest') ?? 0, own = val('f_own') ?? 0;
    const contribPct = 1 - varPct - taxPct;
    const month = (rev, i) => {
      const variable = rev * varPct, tax = rev * taxPct, contrib = rev - variable - tax;
      return { m: i, revenue: rev, variable, tax, contrib, fixed: fixedAll, result: contrib - fixedAll };
    };
    const run = (base, growth, months) => [...Array(months)].map((_, i) => month(base * Math.pow(1 + growth, i), i + 1));
    const m60 = run(revenueBase, g, 60);
    const months = m60.slice(0, 12);
    const years = [0, 1, 2].map(y => {
      const ms = m60.slice(y * 12, y * 12 + 12);
      const sum = k => ms.reduce((s, x) => s + x[k], 0);
      return { year: y + 1, revenue: sum('revenue'), variable: sum('variable'), tax: sum('tax'), contrib: sum('contrib'), fixed: sum('fixed'), result: sum('result') };
    });
    let cum = -invest, payback = null;
    m60.forEach(x => { cum += x.result; x.cumulative = cum; if (payback === null && invest > 0 && cum >= 0) payback = x.m; });
    const breakEven = contribPct > 0 ? fixedAll / contribPct : null;
    const scenario = (label, revFactor, growthFactor) => {
      const ms = run(revenueBase * revFactor, g * growthFactor, 12);
      return { label, revenue: ms.reduce((s, x) => s + x.revenue, 0), result: ms.reduce((s, x) => s + x.result, 0), lastMonth: ms[11].revenue };
    };
    return {
      ok: true, assumed,
      inputs: { revenueBase, growth: g * 100, varPct: varPct * 100, taxPct: taxPct * 100, fixed, prolabore: pro, debt, invest, own },
      contribPct: contribPct * 100, breakEven,
      breakEvenGap: breakEven === null ? null : revenueBase - breakEven,
      monthResult: months[0].result, netMarginPct: revenueBase ? (months[0].result / revenueBase) * 100 : null,
      capitalGap: Math.max(0, invest - own), payback, months, years,
      scenarios: [scenario('Pessimista', 0.8, 0.5), scenario('Realista', 1, 1), scenario('Otimista', 1.2, 1.5)],
    };
  }

  // Tabelas do financeiro e dos cenários em texto (o mesmo formato do documento).
  function financeTables(f) {
    if (!f.ok) return `**Faltam dados para calcular:** ${f.missing.join('; ')}. [A definir na reunião]`;
    const i = f.inputs;
    const lines = [
      '### Premissas',
      `- Faturamento de partida: ${brl(i.revenueBase)} por mês, crescendo ${pct(i.growth)} ao mês`,
      `- Custos variáveis: ${pct(i.varPct)} das vendas; impostos: ${pct(i.taxPct)}`,
      `- Custos fixos: ${brl(i.fixed)} + pró-labore ${brl(i.prolabore)} + parcelas de dívidas ${brl(i.debt)} por mês`,
      i.invest ? `- Investimento: ${brl(i.invest)}, com ${brl(i.own)} de recursos próprios` : null,
      ...f.assumed.map(x => `- Premissa assumida: ${x}`),
      '', '### Indicadores',
      `- Margem de contribuição: ${pct(f.contribPct)}`,
      `- Ponto de equilíbrio: ${f.breakEven === null ? 'não há (custos variáveis e impostos passam de 100%)' : `${brl(f.breakEven)} por mês`}`,
      f.breakEvenGap !== null ? `- Hoje o faturamento está ${f.breakEvenGap >= 0 ? `${brl(f.breakEvenGap)} acima` : `${brl(-f.breakEvenGap)} abaixo`} do ponto de equilíbrio` : null,
      `- Resultado do primeiro mês: ${brl(f.monthResult)} (margem líquida ${pct(f.netMarginPct)})`,
      i.invest ? `- Necessidade de capital de terceiros: ${brl(f.capitalGap)}` : null,
      i.invest ? `- Retorno do investimento: ${f.payback ? `em ${f.payback} meses` : 'não acontece em 5 anos com estas premissas'}` : null,
      '', '### Projeção dos 12 primeiros meses',
      '| Mês | Faturamento | Variáveis + impostos | Custos fixos | Resultado | Acumulado |',
      '|---|---|---|---|---|---|',
      ...f.months.map(x => `| ${x.m} | ${brl(x.revenue)} | ${brl(x.variable + x.tax)} | ${brl(x.fixed)} | ${brl(x.result)} | ${brl(x.cumulative)} |`),
      '', '### Projeção de 3 anos',
      '| Ano | Faturamento | Margem de contribuição | Custos fixos | Resultado |',
      '|---|---|---|---|---|',
      ...f.years.map(y => `| ${y.year} | ${brl(y.revenue)} | ${brl(y.contrib)} | ${brl(y.fixed)} | ${brl(y.result)} |`),
    ];
    return lines.filter(x => x !== null).join('\n');
  }
  function scenarioTable(f) {
    if (!f.ok) return '[A definir na reunião: faltam os dados financeiros]';
    return ['| Cenário | Premissa | Faturamento em 12 meses | Resultado em 12 meses | Faturamento no mês 12 |', '|---|---|---|---|---|',
      ...f.scenarios.map((s, i) => `| ${s.label} | ${['vendas 20% menores e metade do crescimento', 'as premissas informadas', 'vendas 20% maiores e 50% mais crescimento'][i]} | ${brl(s.revenue)} | ${brl(s.result)} | ${brl(s.lastMonth)} |`)].join('\n');
  }

  // Resposta em texto (para a IA e para o rascunho).
  function answerText(q, v) {
    if (isEmpty(v)) return '';
    const r = rangeOf(q, v);
    if (r) return r[0];
    if (q.type === 'money') return brl(Number(v));
    if (q.type === 'percent') return pct(Number(v));
    if (Array.isArray(v)) return v.map(x => String(x).replace(/^Outro: /, '')).join('; ');
    return String(v);
  }

  // ---------- rascunho sem IA: as respostas organizadas nas seções ----------
  function draft(answers = {}, unknown = [], meta = {}) {
    const f = finance(answers);
    const A = id => answers[id];
    const T = id => answerText(BY_ID[id], A(id));
    const pend = id => `[A definir na reunião: ${BY_ID[id].label.replace(/[?.:\s]+$/, '').toLowerCase()}]`;
    const para = id => (isEmpty(A(id)) ? pend(id) : T(id));
    const bullets = id => (isEmpty(A(id)) ? pend(id) : (Array.isArray(A(id)) ? A(id).map(x => `- ${x}`).join('\n') : T(id)));
    const item = (label, id) => `- **${label}:** ${isEmpty(A(id)) ? pend(id) : T(id)}`;
    const name = A('b_name') || meta.company || 'O negócio';
    const sec = {
      sumario: [`**${name}** ${A('b_what') ? `— ${A('b_what')}` : ''}`.trim(), '',
        item('Setor', 'b_segment'), item('Momento', 'b_stage'), item('Onde atua', 'b_location'), item('Problema que resolve', 'b_problem'),
        item('Diferencial', 'c_why'),
        f.ok ? `- **Números:** faturamento de ${brl(f.inputs.revenueBase)} por mês, margem de contribuição de ${pct(f.contribPct)} e ponto de equilíbrio em ${brl(f.breakEven)} por mês.` : '- **Números:** [A definir na reunião: dados financeiros]',
        isEmpty(A('r_goals')) ? '' : `- **Metas:** ${T('r_goals')}`].filter(x => x !== '').join('\n'),
      negocio: [item('Nome', 'b_name'), item('Setor', 'b_segment'), item('Momento', 'b_stage'), item('Tempo de negócio', 'b_since'), item('Localização e atendimento', 'b_location'),
        '', '### O que faz', para('b_what'), '', '### Propósito e visão', para('b_purpose'), '', '### Valores', bullets('b_values')].join('\n'),
      proposta: [item('Vende para', 'c_type'), item('Clientes ativos', 'c_count'), item('Peso dos 3 maiores clientes no faturamento', 'c_concentration'),
        '', '### Cliente ideal', para('c_ideal'), '', '### Dores e desejos', bullets('c_pains'), '', '### Por que compram de nós', para('c_why')].join('\n'),
      mercado: [item('Área de atuação', 'm_region'), '', '### Tamanho do mercado', para('m_size'), '', '### Tendências', bullets('m_trends')].join('\n'),
      concorrencia: ['### Principais concorrentes', bullets('k_list'), '', '### Onde eles são melhores', para('k_better'), '', '### Onde somos melhores', para('k_worse'), '', item('Preço em relação a eles', 'k_price')].join('\n'),
      receita: ['### Produtos e serviços', bullets('p_list'), '', item('Como ganha dinheiro', 'p_model'), item('Ticket médio', 'p_ticket'), item('Vendas por mês', 'p_sales'), item('Recompra', 'p_repeat'),
        !isEmpty(A('s_spend')) && !isEmpty(A('p_sales')) && numOf('p_sales', A('p_sales')) > 0 ? `- **Custo de marketing e vendas por venda (aproximado):** ${brl(numOf('s_spend', A('s_spend')) / numOf('p_sales', A('p_sales')))}` : null].filter(x => x !== null).join('\n'),
      marketing: [item('Canais', 's_channels'), item('Investimento mensal em marketing e vendas', 's_spend'), '', '### Processo de venda', para('s_process'), '', '### Retenção e indicação', para('s_retention')].join('\n'),
      operacao: ['### Etapas da entrega', bullets('o_steps'), '', '### Fornecedores e parceiros', bullets('o_suppliers'), '', '### Sistemas e ferramentas', bullets('o_tools'), '', '### O que trava a operação', para('o_bottleneck')].join('\n'),
      pessoas: ['### Sócios', bullets('g_partners'), '', item('Pessoas no negócio', 'g_team'), '', '### Contratações previstas', bullets('g_hire'), '', '### Gestão e decisões', para('g_management')].join('\n'),
      financeiro: financeTables(f),
      cenarios: scenarioTable(f),
      swot: ['| Forças | Fraquezas |', '|---|---|', `| ${isEmpty(A('k_worse')) ? '[A definir]' : T('k_worse')} | ${isEmpty(A('k_better')) ? '[A definir]' : T('k_better')} |`,
        '', '| Oportunidades | Ameaças |', '|---|---|', `| ${isEmpty(A('m_trends')) ? '[A definir]' : T('m_trends')} | ${isEmpty(A('r_risks')) ? '[A definir]' : T('r_risks')} |`].join('\n'),
      riscos: [bullets('r_risks'), !isEmpty(A('c_concentration')) && numOf('c_concentration', A('c_concentration')) > 50 ? '- Dependência de poucos clientes: os 3 maiores somam mais da metade do faturamento.' : null].filter(x => x !== null).join('\n'),
      esg: para('r_esg'),
      metas: [bullets('r_goals'), '', 'Para cada meta: definir o indicador, o valor de hoje, o valor desejado e o responsável. [A definir na reunião]'].join('\n'),
      acao: ['| O quê | Quem | Até quando |', '|---|---|---|', ...(Array.isArray(A('r_goals')) ? A('r_goals') : ['[A definir na reunião]']).map(g => `| ${g} | [A definir] | [A definir] |`),
        ...(Array.isArray(A('r_help')) ? [`| Plano de apoio da consultoria em: ${A('r_help').join(', ')} | Opps Consultoria | [A definir] |`] : [])].join('\n'),
      diagnostico: insightsText(insights(answers, unknown)),
      pendencias: pendencias(answers, unknown, f),
    };
    const list = insights(answers, unknown);
    return DOC.map(([key, title]) => ({ key, title, content: withPoints(key, sec[key] || '', list) }));
  }
  function pendencias(answers, unknown, f) {
    const list = QUESTIONS.filter(q => unknown.includes(q.id) || isEmpty(answers[q.id])).map(q => `- ${q.label}${unknown.includes(q.id) ? ' (respondido "não sei")' : ''}`);
    if (f && f.ok) f.assumed.forEach(x => list.push(`- Confirmar a premissa: ${x}`));
    return list.length ? list.join('\n') : 'Nenhuma: todas as perguntas foram respondidas.';
  }

  // Lê o formato do documento (### subtítulo, - lista, **negrito**, tabelas com |) em blocos,
  // usados na tela, na impressão e no Word.
  function inline(text) {
    const out = [];
    String(text).split(/(\*\*[^*]+\*\*)/).forEach(part => {
      if (!part) return;
      const m = /^\*\*([^*]+)\*\*$/.exec(part);
      out.push(m ? { t: m[1], b: true } : { t: part, b: false });
    });
    return out;
  }
  function parseMd(text) {
    const blocks = [];
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      if (!line.trim()) continue;
      const h = /^#{1,6}\s+(.*)$/.exec(line.trim());
      if (h) { blocks.push({ type: 'h', text: h[1] }); continue; }
      if (/^\s*[-*•]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*•]\s+/, '').trim()); i++; }
        i--; blocks.push({ type: 'ul', items }); continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '').trim()); i++; }
        i--; blocks.push({ type: 'ol', items }); continue;
      }
      if (/^\s*\|/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          const cells = lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
          if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells);
          i++;
        }
        i--; if (rows.length) blocks.push({ type: 'table', rows }); continue;
      }
      const para = [line.trim()];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#{1,6}\s|\s*[-*•]\s|\s*\d+[.)]\s|\s*\|)/.test(lines[i + 1])) { para.push(lines[i + 1].trim()); i++; }
      blocks.push({ type: 'p', text: para.join(' ') });
    }
    return blocks;
  }

  // ---------- diagnóstico automático (sem IA): regras sobre as respostas e a conta ----------
  // Cada item: { level: 'alerta' | 'atencao' | 'oportunidade' | 'forte', area, title, text, action }.
  const LEVELS = { alerta: 'Alerta', atencao: 'Atenção', oportunidade: 'Oportunidade', forte: 'Ponto forte' };
  // "Faturar R$ 80 mil por mês" -> 80000 (meta de faturamento mensal escrita nas metas).
  function revenueGoal(goals) {
    for (const g of Array.isArray(goals) ? goals : []) {
      if (!/fatur|receita|vend/i.test(g)) continue;
      const m = /R?\$?\s*([\d.,]+)\s*(mil|k|milh(?:ão|ões|ao|oes)|mi)?\b/i.exec(g);
      if (!m) continue;
      let n = Number(m[1].replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) continue;
      const unit = (m[2] || '').toLowerCase();
      if (unit === 'mil' || unit === 'k') n *= 1e3; else if (unit.startsWith('mi')) n *= 1e6;
      const yearly = /ano|anual/i.test(g) && !/m[eê]s/i.test(g);
      return { text: g, monthly: yearly ? n / 12 : n };
    }
    return null;
  }
  // sec: seção do plano onde o ponto aparece. explain e ask: orientação para a reunião (Roteiro, só da consultoria).
  function insights(a = {}, unknown = []) {
    const out = [];
    const add = (level, area, title, text, action, o = {}) => out.push({ level, area, title, text, action, sec: o.sec || 'sumario', explain: o.explain || '', ask: o.ask || '' });
    const has = id => !isEmpty(a[id]);
    const f = finance(a);
    const PE = 'Ponto de equilíbrio é quanto o negócio precisa vender por mês só para pagar todas as contas, sem sobrar nem faltar.';
    if (f.ok) {
      const rev = f.inputs.revenueBase;
      const safety = f.breakEven === null ? null : (rev - f.breakEven) / rev;
      if (f.breakEven === null) add('alerta', 'Finanças', 'Custos variáveis e impostos passam de 100% da venda', 'Cada venda dá prejuízo antes mesmo dos custos fixos.', 'Rever preços e custos variáveis com urgência.',
        { sec: 'financeiro', explain: 'Mostre com uma venda de R$ 100: quanto vai para mercadoria, comissões, taxas e impostos. Hoje sai mais do que entra.', ask: 'Quando foi a última vez que os preços foram reajustados? Os custos de compra subiram?' });
      else if (safety < 0) add('alerta', 'Finanças', 'Faturamento abaixo do ponto de equilíbrio', `O negócio precisa de ${brl(f.breakEven)} por mês para empatar e fatura ${brl(rev)}: faltam ${brl(f.breakEven - rev)} por mês.`, 'Prioridade: aumentar vendas ou margem e cortar custos fixos antes de investir.',
        { sec: 'financeiro', explain: `${PE} Hoje as vendas não chegam lá: todo mês falta dinheiro, que sai do caixa ou de empréstimo.`, ask: 'De onde vem o dinheiro que cobre essa diferença todo mês? Quais custos fixos dá para cortar já?' });
      else if (safety < 0.1) add('atencao', 'Finanças', 'Pouca folga sobre o ponto de equilíbrio', `O faturamento está só ${pct(safety * 100)} acima do ponto de equilíbrio (${brl(f.breakEven)}): uma queda dessas nas vendas leva ao prejuízo.`, 'Aumentar a folga antes de assumir novos custos fixos (receita recorrente, preço, negociação de insumos).',
        { sec: 'financeiro', explain: `${PE} O negócio vende só um pouco acima disso: um mês fraco já fecha no vermelho.`, ask: 'Em que meses as vendas caem? Já fechou algum mês no prejuízo?' });
      else if (safety >= 0.25) add('forte', 'Finanças', 'Boa folga sobre o ponto de equilíbrio', `O faturamento está ${pct(safety * 100)} acima do ponto de equilíbrio.`, 'Usar essa folga para investir em crescimento com segurança.',
        { sec: 'financeiro', explain: `${PE} O negócio vende bem acima disso: há espaço para investir sem correr risco.`, ask: 'Onde vocês gostariam de investir essa folga?' });
      if (f.breakEven !== null && f.contribPct < 30) add('atencao', 'Finanças', 'Margem de contribuição baixa', `Sobram só ${pct(f.contribPct)} de cada venda para pagar os custos fixos.`, 'Revisar preços, mix de produtos e custos variáveis (compras, comissões, taxas).',
        { sec: 'financeiro', explain: `Margem de contribuição é o que sobra de cada R$ 100 vendidos depois de pagar a mercadoria, as comissões e os impostos. Aqui sobram R$ ${Math.round(f.contribPct)}.`, ask: 'Quais produtos dão mais margem? Dá para vender mais deles?' });
      if (f.netMarginPct !== null && f.netMarginPct < 0 && f.breakEven !== null && safety >= 0) add('atencao', 'Finanças', 'Resultado negativo', `O primeiro mês fecha em ${brl(f.monthResult)}.`, 'Rever custos fixos e pró-labore.',
        { sec: 'financeiro', explain: 'Somando tudo, o mês fecha no vermelho.', ask: 'Quais custos fixos são essenciais e quais dá para rever?' });
      if (f.inputs.debt > 0 && f.inputs.debt / rev > 0.1) add('atencao', 'Finanças', 'Dívidas pesam no caixa', `As parcelas (${brl(f.inputs.debt)} por mês) são ${pct((f.inputs.debt / rev) * 100)} do faturamento.`, 'Avaliar renegociação de prazo ou troca por uma linha mais barata.',
        { sec: 'financeiro', explain: `De cada R$ 100 que entram, R$ ${Math.round((f.inputs.debt / rev) * 100)} vão para parcelas de dívidas.`, ask: 'Quais são as taxas e os prazos de cada dívida? Alguma pode ser renegociada?' });
      if (f.inputs.invest > 0) {
        if (f.capitalGap > 0) add('atencao', 'Finanças', `Precisa captar ${brl(f.capitalGap)}`, `O investimento é de ${brl(f.inputs.invest)} e há ${brl(f.inputs.own)} de recursos próprios.`, 'Buscar crédito com carência (as parcelas começam depois que o investimento gera caixa) ou fazer o investimento em etapas.',
          { sec: 'financeiro', explain: 'Carência é o período em que o empréstimo ainda não cobra parcela: dá tempo de o investimento começar a dar retorno.', ask: 'Já consultaram o banco? Dá para fazer o investimento em etapas?' });
        if (!f.payback) add('alerta', 'Finanças', 'O investimento não se paga em 5 anos', 'Com as premissas informadas, o resultado acumulado não cobre o investimento.', 'Rever o tamanho do investimento ou as premissas de venda antes de seguir.',
          { sec: 'financeiro', explain: 'Com o lucro previsto, o dinheiro investido não volta nem em 5 anos.', ask: 'Esse investimento é mesmo necessário agora? Existe uma versão menor?' });
        else if (f.payback > 36) add('atencao', 'Finanças', 'Retorno do investimento demorado', `O investimento se paga em ${f.payback} meses.`, 'Avaliar um investimento menor ou em etapas.',
          { sec: 'financeiro', explain: `O dinheiro investido só volta em ${f.payback} meses.`, ask: 'Que parte do investimento traz retorno mais rápido?' });
        else if (f.payback <= 18) add('forte', 'Finanças', 'Retorno rápido do investimento', `O investimento se paga em ${f.payback} meses.`, 'Confirmar as premissas de venda: é o que sustenta esse prazo.',
          { sec: 'financeiro', explain: `O dinheiro investido volta em ${f.payback} meses, se as vendas vierem como o previsto.`, ask: 'O quanto vocês confiam na previsão de vendas? O que pode atrasar?' });
      }
      const pess = f.scenarios[0];
      if (pess.result < 0 && f.scenarios[1].result > 0) add('atencao', 'Finanças', 'Plano sensível a queda nas vendas', `No cenário pessimista o ano fecha em ${brl(pess.result)}.`, 'Ter um plano B: o que cortar ou adiar se as vendas vierem abaixo do esperado.',
        { sec: 'cenarios', explain: 'Se as vendas vierem 20% menores e crescerem metade do previsto, o ano fecha no prejuízo.', ask: 'Se isso acontecer, o que vocês cortariam ou adiariam primeiro?' });
      const g = f.inputs.growth / 100;
      if (g > 0.05) add('atencao', 'Finanças', 'Meta de crescimento agressiva', `Crescer ${pct(g * 100)} ao mês dá cerca de ${pct((Math.pow(1 + g, 12) - 1) * 100)} no ano.`, 'Mostrar de onde vem esse crescimento (canais, equipe, investimento).',
        { sec: 'financeiro', explain: 'Um pouco de crescimento todo mês vira muito no ano: confira se a equipe e a estrutura dão conta.', ask: 'De onde vêm os novos clientes para esse crescimento?' });
      const goal = revenueGoal(a.r_goals);
      if (goal) {
        const m12 = f.months[11].revenue;
        const need = Math.pow(goal.monthly / rev, 1 / 11) - 1;
        if (m12 + 1 < goal.monthly) add('atencao', 'Metas', 'Meta de faturamento acima da projeção', `"${goal.text}": com crescimento de ${pct(g * 100)} ao mês o faturamento chega a ${brl(m12)} no mês 12.`, `Para chegar lá em 12 meses é preciso crescer cerca de ${pct(need * 100)} ao mês, ou rever o prazo da meta.`,
          { sec: 'metas', explain: `No ritmo de crescimento informado, a meta não chega em 12 meses: falta crescer cerca de ${pct(need * 100)} ao mês.`, ask: 'O que precisaria acontecer para crescer nesse ritmo? Ou vamos ajustar o prazo da meta?' });
        else add('forte', 'Metas', 'Meta de faturamento coerente com a projeção', `"${goal.text}": a projeção chega a ${brl(m12)} no mês 12.`, 'Acompanhar mês a mês se o crescimento está no ritmo.',
          { sec: 'metas', explain: 'A meta bate com o ritmo de crescimento informado.', ask: 'Como vamos acompanhar isso todo mês?' });
      }
    } else add('atencao', 'Finanças', 'Faltam dados para a conta financeira', `Sem ${f.missing.join(', ')} não dá para calcular ponto de equilíbrio, resultado e retorno.`, 'Levantar esses números com o contador antes da reunião.',
      { sec: 'financeiro', explain: 'Sem esses números o plano fica sem a parte financeira, que é a que mais pesa nas decisões.', ask: 'Quem tem esses números? O contador pode mandar o último demonstrativo?' });
    if (!has('f_growth') && f.ok) add('atencao', 'Finanças', 'Sem meta de crescimento', 'A projeção considerou 0% de crescimento.', 'Definir uma meta realista de crescimento mensal.',
      { sec: 'financeiro', explain: 'Sem uma meta de crescimento, a projeção repete o mês de hoje por 3 anos.', ask: 'Quanto vocês acham possível crescer por mês?' });

    const nv = id => numOf(id, a[id]);
    const conc = nv('c_concentration');
    if (has('c_concentration') && conc > 50) add('alerta', 'Clientes', 'Dependência de poucos clientes', `Os 3 maiores clientes somam ${pct(conc)} do faturamento.`, 'Diversificar a carteira e ter contratos com prazo e aviso de saída.',
      { sec: 'proposta', explain: 'Se um desses clientes sair, o negócio perde uma parte grande da receita de uma vez.', ask: 'Esses clientes têm contrato? Qual o risco de algum sair?' });
    else if (has('c_concentration') && conc >= 30) add('atencao', 'Clientes', 'Concentração de clientes', `Os 3 maiores clientes somam ${pct(conc)} do faturamento.`, 'Acompanhar a satisfação desses clientes de perto e buscar novos.',
      { sec: 'proposta', explain: 'Poucos clientes respondem por boa parte da receita.', ask: 'Como está o relacionamento com esses clientes?' });
    if (a.p_repeat === 'Quase nunca') add('atencao', 'Receita', 'Pouca recompra', 'O cliente quase não compra de novo: todo mês é preciso conquistar clientes novos.', 'Criar motivos para voltar (pós-venda, novos produtos, programa de indicação).',
      { sec: 'receita', explain: 'Conquistar um cliente novo custa mais do que vender de novo para quem já comprou.', ask: 'Por que o cliente não volta? Existe algo para oferecer depois da primeira compra?' });
    if (['Com frequência', 'Paga todo mês'].includes(a.p_repeat) && !(a.p_model || []).includes('Assinatura ou mensalidade')) add('oportunidade', 'Receita', 'Espaço para receita recorrente', 'O cliente já volta com frequência, mas não há assinatura ou mensalidade.', 'Testar um plano de assinatura com os clientes mais fiéis.',
      { sec: 'receita', explain: 'Receita recorrente é a que entra todo mês, combinada antes: dá previsibilidade e ajuda a planejar compras e equipe.', ask: 'Seus clientes mais fiéis topariam um plano mensal? O que entraria nele?' });
    if (['Com frequência', 'Paga todo mês'].includes(a.p_repeat)) add('forte', 'Clientes', 'Clientes fiéis', 'O cliente compra de novo com frequência.', 'Usar essa base para indicações e lançamentos.',
      { sec: 'proposta', explain: 'Cliente que volta é sinal de que o produto entrega o que promete.', ask: 'O que esses clientes mais elogiam?' });
    const channels = a.s_channels || [];
    const digital = ['Instagram', 'Google', 'Site', 'WhatsApp', 'Marketplace', 'LinkedIn'];
    if (has('s_channels') && channels.length === 1) add('atencao', 'Vendas', 'Um só canal de vendas', `Os clientes chegam só por ${channels[0]}.`, 'Abrir um segundo canal para não depender de um só.',
      { sec: 'marketing', explain: 'Se esse canal parar de funcionar, as vendas param junto.', ask: 'Que outro canal faria sentido para o seu cliente?' });
    if (has('s_channels') && !channels.some(c => digital.includes(c))) add('oportunidade', 'Vendas', 'Pouca presença digital', 'Nenhum canal digital entre os que trazem clientes.', 'Começar por WhatsApp e Instagram, que custam pouco.',
      { sec: 'marketing', explain: 'O cliente procura no celular antes de comprar.', ask: 'Quem poderia cuidar do WhatsApp e do Instagram?' });
    if ((a.s_retention || []).includes('Nada ainda') && ['Às vezes', 'Quase nunca'].includes(a.p_repeat)) add('oportunidade', 'Vendas', 'Nada para o cliente voltar', 'Não há ação para o cliente comprar de novo, e ele volta pouco.', 'Começar por algo simples: pós-venda pelo WhatsApp e um cartão fidelidade.',
      { sec: 'marketing', explain: 'Vender de novo para quem já comprou custa bem menos do que conquistar um cliente novo.', ask: 'O que faria o seu cliente voltar mais vezes?' });
    if ((a.o_bottleneck || []).includes('Tudo depende do dono')) add('atencao', 'Gestão', 'Tudo depende do dono', 'O negócio para quando o dono não está.', 'Escrever os processos principais e passar decisões do dia a dia para a equipe.',
      { sec: 'operacao', explain: 'Se tudo passa pelo dono, ele vira o gargalo e o negócio não cresce além do tempo dele.', ask: 'O que só você sabe fazer hoje? O que dá para ensinar a alguém?' });
    if (channels.includes('Indicação')) add('forte', 'Vendas', 'Indicação funciona', 'Clientes chegam por indicação.', 'Transformar em programa: um benefício para quem indica e para o indicado.',
      { sec: 'marketing', explain: 'Indicação é o canal mais barato e o que mais converte.', ask: 'Vocês pedem indicação? Dariam um benefício para quem indica?' });
    if (f.ok && has('s_spend') && nv('s_spend') / f.inputs.revenueBase > 0.15) add('atencao', 'Vendas', 'Gasto alto com marketing e vendas', `${pct((nv('s_spend') / f.inputs.revenueBase) * 100)} do faturamento vai para marketing e vendas.`, 'Medir quantos clientes cada canal traz e cortar o que não traz.',
      { sec: 'marketing', explain: 'Uma parte grande da receita vai para atrair clientes.', ask: 'Vocês sabem quantos clientes cada canal traz?' });
    if (has('s_spend') && has('p_sales') && has('p_ticket') && nv('p_sales') > 0 && nv('s_spend') / nv('p_sales') > 0.3 * nv('p_ticket')) add('atencao', 'Vendas', 'Custo para vender alto em relação ao ticket', `Cada venda custa cerca de ${brl(nv('s_spend') / nv('p_sales'))} em marketing e vendas, para um ticket de ${brl(nv('p_ticket'))}.`, 'Aumentar o ticket (combos, kits) ou focar nos canais mais baratos.',
      { sec: 'marketing', explain: 'Cada venda custa caro para conquistar, comparado ao valor que ela traz.', ask: 'Dá para vender mais coisas na mesma compra (combos, kits)?' });
    if (a.k_price === 'Mais caro') add(has('c_why') ? 'forte' : 'atencao', 'Concorrência', has('c_why') ? 'Preço acima da concorrência com diferencial claro' : 'Preço acima da concorrência sem diferencial claro',
      has('c_why') ? `O cliente paga mais por: ${[].concat(a.c_why).map(x => String(x).replace(/^Outro: /, '')).join(', ')}` : 'Não ficou claro por que o cliente paga mais.', has('c_why') ? 'Mostrar esse diferencial em toda a comunicação; nunca entrar em guerra de preço.' : 'Definir e comunicar o diferencial, ou rever o preço.',
      { sec: 'concorrencia', explain: has('c_why') ? 'Cobrar mais é saudável quando o cliente enxerga o porquê.' : 'Quem cobra mais precisa deixar claro o que entrega a mais.', ask: has('c_why') ? 'Esse diferencial aparece no Instagram, na loja e no atendimento?' : 'Por que o cliente escolhe vocês, mesmo pagando mais?' });
    if (a.k_price === 'Mais barato' && f.ok && f.contribPct < 40) add('atencao', 'Concorrência', 'Preço baixo com margem apertada', 'Competir por preço com margem de contribuição baixa deixa pouco espaço para crescer.', 'Rever preço e buscar diferenciais que não dependam de preço.',
      { sec: 'concorrencia', explain: 'Ser o mais barato funciona quando o custo também é o mais baixo; senão, sobra pouco.', ask: 'Os clientes compram só pelo preço? O que mais eles valorizam?' });
    if (!has('m_trends')) add('atencao', 'Mercado', 'Sem leitura das mudanças do setor', 'Não foram citadas tendências que afetam o negócio.', 'Levantar 3 mudanças do setor (clientes, tecnologia, leis) e como responder a cada uma.',
      { sec: 'mercado', explain: 'Olhar o que está mudando ajuda a se antecipar à concorrência.', ask: 'O que mudou no seu setor nos últimos 2 anos?' });
    if (!has('o_tools') || (a.o_tools || []).includes('Nada ainda')) add('oportunidade', 'Operação', 'Ferramentas de gestão', 'Não foram citados sistemas de gestão.', 'Um controle simples de vendas, estoque e caixa já ajuda nas decisões.',
      { sec: 'operacao', explain: 'Sem registro, as decisões ficam no "achismo".', ask: 'Como vocês controlam hoje vendas, estoque e caixa?' });
    else if ((a.o_tools || []).every(t => /planilha|excel|caderno/i.test(t))) add('oportunidade', 'Operação', 'Gestão em planilhas', 'A gestão roda em planilhas.', 'Avaliar um sistema de gestão (ERP) do porte do negócio.',
      { sec: 'operacao', explain: 'Planilha funciona no começo, mas depende de quem preenche e erra fácil.', ask: 'Quanto tempo por semana vai para preencher planilhas?' });
    if (a.g_management === 'Reunião mensal com indicadores') add('forte', 'Gestão', 'Gestão com rotina', 'Os resultados são acompanhados todo mês, com indicadores.', 'Manter e incluir no acompanhamento as metas deste plano.',
      { sec: 'pessoas', explain: 'Olhar os números todo mês evita surpresas.', ask: 'Quais indicadores vocês olham hoje?' });
    else if (!has('g_management') || a.g_management !== 'Tenho números, mas sem rotina') add('atencao', 'Gestão', 'Gestão sem rotina definida', has('g_management') ? `Hoje: "${a.g_management}".` : 'Não ficou claro como são acompanhados os resultados.', 'Reunião mensal de resultados com 3 a 5 indicadores.',
      { sec: 'pessoas', explain: 'Um encontro mensal curto, olhando sempre os mesmos números, evita surpresas.', ask: 'Quem decide o quê hoje? Vocês olham os números todo mês?' });
    const hires = (a.g_hire || []).filter(x => x !== 'Ninguém por enquanto');
    if (hires.length && f.ok && f.monthResult < 0.05 * f.inputs.revenueBase) add('atencao', 'Pessoas', 'Contratações com resultado apertado', `Há contratação prevista (${hires.join(', ')}) e o resultado mensal está em ${brl(f.monthResult)}.`, 'Contratar junto com o aumento de vendas, não antes.',
      { sec: 'pessoas', explain: 'Cada contratação aumenta o custo fixo e sobe o ponto de equilíbrio.', ask: 'Qual contratação é mais urgente? Ela traz venda ou só alivia o trabalho?' });
    if (!has('r_goals')) add('atencao', 'Metas', 'Sem metas definidas', 'Não foram definidas metas para os próximos 12 meses.', 'Definir 3 metas mensuráveis, com responsável e prazo.',
      { sec: 'metas', explain: 'Sem metas não dá para saber se o ano foi bom.', ask: 'Onde vocês querem estar daqui a 12 meses?' });
    if (has('r_risks')) add('forte', 'Riscos', 'Riscos mapeados', `${a.r_risks.length === 1 ? 'Foi citado 1 risco' : `Foram citados ${a.r_risks.length} riscos`}.`, 'Para cada um, definir o que fazer para reduzir e quem acompanha.',
      { sec: 'riscos', explain: 'Saber o que pode dar errado é o primeiro passo para se proteger.', ask: 'Qual desses riscos tira mais o sono de vocês?' });
    if (!has('r_esg') || (a.r_esg || []).includes('Nada ainda')) add('oportunidade', 'ESG', 'Práticas de ESG', 'Não foram citadas práticas sociais, ambientais ou de gestão.', 'Começar com ações simples e visíveis para o cliente (resíduos, equipe, contas organizadas).',
      { sec: 'esg', explain: 'ESG é cuidar do ambiente, das pessoas e da gestão; para um negócio pequeno começa com coisas simples.', ask: 'Vocês já fazem algo nessa linha, mesmo sem chamar de ESG?' });
    if (unknown.length >= 8) add('atencao', 'Geral', 'Muitas respostas "não sei"', `${unknown.length} perguntas ficaram como "não sei".`, 'Separar um tempo da reunião para levantar esses dados juntos.',
      { sec: 'pendencias', explain: 'Normal no começo: vamos preencher juntos.', ask: '' });
    const order = { alerta: 0, atencao: 1, oportunidade: 2, forte: 3 };
    return out.sort((x, y) => order[x.level] - order[y.level]);
  }
  function insightsText(list) {
    if (!list.length) return 'Sem pontos automáticos: faltam respostas para o diagnóstico.';
    const icon = { alerta: '🔴', atencao: '🟡', oportunidade: '🔵', forte: '🟢' };
    return Object.keys(LEVELS).filter(l => list.some(i => i.level === l)).map(l =>
      [`### ${icon[l]} ${l === 'forte' ? 'Pontos fortes' : l === 'atencao' ? 'Pontos de atenção' : l === 'alerta' ? 'Alertas' : 'Oportunidades'}`,
        ...list.filter(i => i.level === l).map(i => `- **${i.title}** (${i.area}): ${i.text} **O que fazer:** ${i.action}`)].join('\n')).join('\n\n');
  }

  // Os pontos do diagnóstico também aparecem dentro de cada seção do plano; o sumário traz os principais.
  const LEVEL_ICON = { alerta: '🔴', atencao: '🟡', oportunidade: '🔵', forte: '🟢' };
  function withPoints(key, content, list) {
    if (key === 'diagnostico' || key === 'pendencias') return content;
    let pts;
    if (key === 'sumario') {
      const order = ['alerta', 'atencao', 'oportunidade'];
      pts = order.flatMap(l => list.filter(i => i.level === l)).slice(0, 4);
      if (!pts.length) return content;
      return `${content}\n\n### Principais pontos do diagnóstico\n${pts.map(i => `- ${LEVEL_ICON[i.level]} **${i.title}**: ${i.action}`).join('\n')}`.trim();
    }
    pts = list.filter(i => i.sec === key);
    if (!pts.length) return content;
    return `${content}\n\n### Pontos de atenção e oportunidades\n${pts.map(i => `- ${LEVEL_ICON[i.level]} **${i.title}**: ${i.text} **O que fazer:** ${i.action}`).join('\n')}`.trim();
  }

  // ---------- texto para a IA (pela API ou copiado para o claude.ai) ----------
  const AI_FORMAT = 'Formato do texto de cada seção: subtítulos com "### ", listas com "- ", destaque com **negrito** e tabelas com "| a | b |" e a linha "|---|---|" embaixo do cabeçalho. Nada de HTML. Não repita o título da seção.';
  const AI_SYSTEM = `Você é consultor de negócios de uma consultoria brasileira e escreve planos de negócio para pequenas e médias empresas.
Escreva em português do Brasil, claro e direto, para o dono do negócio: frases curtas, sem jargão sem explicação, sem frases de efeito.
Use só o que está nas respostas do questionário, nos números calculados e no diagnóstico automático. Não invente fatos, nomes, clientes, concorrentes, pesquisas nem números.
Números: use apenas os que aparecem nas respostas ou no bloco "Números calculados pelo sistema", copiados como estão. Não faça contas novas.
Quando faltar uma informação importante, escreva "[A definir na reunião: o que falta]" no lugar, em vez de supor.
Pode e deve analisar: tirar conclusões, apontar riscos e oportunidades, recomendar próximos passos, sempre ligando ao que foi respondido. Use o diagnóstico automático como ponto de partida das análises.
Seções:
- sumario: o plano em uma página (negócio, proposta de valor, mercado, números principais, metas, o que precisa).
- negocio, proposta, mercado, concorrencia, receita, marketing, operacao, pessoas: análise de cada tema. Em "proposta", inclua dores, ganhos e o diferencial do ponto de vista do cliente. Em "receita", explique o modelo de receita e, quando houver dados, o custo de vendas por venda e a recompra.
- financeiro: comente os números calculados (margem, ponto de equilíbrio, resultado, necessidade de capital, retorno). As tabelas serão anexadas pelo sistema logo abaixo do seu texto: não as repita.
- cenarios: o que muda em cada cenário e o que fazer em cada um. A tabela será anexada pelo sistema: não a repita.
- swot: forças, fraquezas, oportunidades e ameaças em duas tabelas 2x1 ou em quatro listas.
- riscos: os principais riscos e como reduzir cada um.
- esg: práticas atuais e sugestões simples e possíveis para o porte do negócio.
- metas: 3 objetivos com 2 ou 3 resultados-chave mensuráveis cada (formato OKR), a partir das metas respondidas.
- acao: tabela "O quê | Quem | Até quando" com as ações dos próximos 90 dias; quem e quando ficam "[A definir]" se não houver dado.
Cada seção com 120 a 350 palavras (o sumário pode ter até 450).
${AI_FORMAT}`;
  // Seções escritas pela IA (diagnóstico e pendências são do sistema).
  const AI_KEYS = DOC.map(([k]) => k).filter(k => k !== 'pendencias' && k !== 'diagnostico');
  function contextText({ answers = {}, unknown = [], meta = {} }) {
    const fin = finance(answers);
    const lines = [`Empresa: ${meta.company || answers.b_name || '-'}${meta.revenue_band ? ` (faixa de faturamento informada: ${meta.revenue_band})` : ''}`, '', 'Respostas do questionário:'];
    for (const [key, title] of SECTIONS) {
      lines.push('', `## ${title}`);
      for (const q of QUESTIONS.filter(x => x.s === key)) {
        const v = unknown.includes(q.id) ? '(não sabe: ver na reunião)' : (answerText(q, answers[q.id]) || '(sem resposta)');
        lines.push(`- ${q.label} ${v}`);
      }
    }
    lines.push('', 'Números calculados pelo sistema:', financeTables(fin), '', 'Cenários:', scenarioTable(fin), '', 'Diagnóstico automático do sistema:', insightsText(insights(answers, unknown)));
    return lines.join('\n');
  }
  // Para colar no claude.ai: instruções + dados + o formato de resposta que o sistema sabe ler de volta.
  function manualPrompt(args) {
    const titles = DOC.filter(([k]) => AI_KEYS.includes(k)).map(([, t]) => `# ${t}`).join('\n');
    return `${AI_SYSTEM}\n\nResponda só com o plano, em texto (não use artefato nem bloco de código), com cada seção começando por uma linha com o título exatamente assim, nesta ordem:\n${titles}\n\nDentro das seções, use "### " para subtítulos (nunca "# " ou "## ").\n\n---\n\n${contextText(args)}\n\nEscreva todas as seções do plano de negócio.`;
  }
  // Lê o texto colado do claude.ai: separa as seções pelos títulos "# Título".
  const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function parsePasted(text) {
    const byTitle = Object.fromEntries(DOC.filter(([k]) => AI_KEYS.includes(k)).map(([k, t]) => [norm(t), k]));
    const found = {};
    let cur = null;
    for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
      const m = /^\s*#{1,2}\s+(?:\d+[.)]\s*)?(.+?)\s*#*\s*$/.exec(raw);
      const key = m && byTitle[norm(m[1].replace(/\*\*/g, ''))];
      if (key) { cur = key; found[cur] = []; continue; }
      if (cur) found[cur].push(raw);
    }
    return Object.fromEntries(Object.entries(found).map(([k, ls]) => [k, ls.join('\n').replace(/^```\w*\s*$/gm, '').trim()]).filter(([, v]) => v));
  }
  // Junta o texto da IA com o que é do sistema: tabelas do financeiro e cenários, diagnóstico e pendências.
  // Seção que a IA não mandou fica com o rascunho.
  function assemble(aiByKey, { answers = {}, unknown = [], meta = {} }) {
    const fin = finance(answers);
    const base = Object.fromEntries(draft(answers, unknown, meta).map(s => [s.key, s.content]));
    const ai = Object.fromEntries(Object.entries(aiByKey || {}).filter(([k, v]) => AI_KEYS.includes(k) && v).map(([k, v]) => [k, String(v).trim().slice(0, 20000)]));
    const list = insights(answers, unknown);
    return DOC.map(([key, title]) => {
      if (!ai[key] || key === 'pendencias' || key === 'diagnostico') return { key, title, content: base[key] || '' };
      let content = ai[key];
      if (key === 'financeiro') content = `${content}\n\n${financeTables(fin)}`;
      if (key === 'cenarios') content = `${content}\n\n${scenarioTable(fin)}`;
      return { key, title, content: withPoints(key, content.trim(), list) };
    });
  }

  // CNPJ: 14 dígitos com os dígitos verificadores certos.
  function validCnpj(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
    const calc = n => { let s = 0, w = n - 7; for (let i = 0; i < n; i++) { s += Number(d[i]) * w--; if (w < 2) w = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  const fmtCnpj = v => String(v || '').replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

  return { REVENUE_BANDS, SECTIONS, QUESTIONS, BY_ID, DOC, DOC_TITLE, clean, progress, finance, financeTables, scenarioTable, answerText, draft, pendencias, validCnpj, fmtCnpj, brl, pct, isEmpty, parseMd, inline, SHORT, numOf, rangeId, rangeOf, isRange, LEVELS, insights, insightsText, AI_SYSTEM, AI_KEYS, contextText, manualPrompt, parsePasted, assemble };
}));
