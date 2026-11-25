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

  // type: text | long | list (uma por linha) | money | percent | int | choice | multi
  const QUESTIONS = [
    { id: 'b_name', s: 'negocio', type: 'text', label: 'Qual é o nome do negócio?' },
    { id: 'b_segment', s: 'negocio', type: 'choice', label: 'Em qual setor ele está?', options: ['Comércio', 'Serviços', 'Indústria', 'Tecnologia', 'Saúde', 'Alimentação', 'Educação', 'Agronegócio', 'Construção', 'Outro'] },
    { id: 'b_stage', s: 'negocio', type: 'choice', label: 'Em que momento o negócio está?', options: ['Ainda é uma ideia', 'Começando (até 1 ano)', 'Crescendo', 'Estável', 'Passando por dificuldades'] },
    { id: 'b_since', s: 'negocio', type: 'int', label: 'Em que ano começou?', placeholder: 'Ex.: 2019', min: 1900, max: 2100 },
    { id: 'b_location', s: 'negocio', type: 'text', label: 'Onde fica e onde atende?', placeholder: 'Ex.: Campinas/SP, atende a região toda e online' },
    { id: 'b_what', s: 'negocio', type: 'long', label: 'O que o negócio faz, em poucas palavras?', help: 'Como você explicaria para alguém numa conversa rápida.' },
    { id: 'b_problem', s: 'negocio', type: 'long', label: 'Que problema do cliente o negócio resolve?' },
    { id: 'b_purpose', s: 'negocio', type: 'long', label: 'Por que o negócio existe e onde quer chegar em 5 anos?', help: 'Propósito, missão e visão: pode escrever do seu jeito.' },
    { id: 'b_values', s: 'negocio', type: 'list', label: 'Quais valores guiam o negócio?', help: 'Um por linha. Ex.: transparência, agilidade.' },

    { id: 'c_type', s: 'clientes', type: 'multi', label: 'Para quem vocês vendem?', options: ['Pessoas (consumidor final)', 'Empresas', 'Governo'] },
    { id: 'c_ideal', s: 'clientes', type: 'long', label: 'Descreva o cliente ideal.', help: 'Quem é, onde está, quanto pode pagar, o que valoriza.' },
    { id: 'c_pains', s: 'clientes', type: 'list', label: 'Quais as maiores dores ou desejos desse cliente?', help: 'Uma por linha.' },
    { id: 'c_why', s: 'clientes', type: 'long', label: 'Por que ele compra de vocês e não do concorrente?', help: 'O seu diferencial, na visão do cliente.' },
    { id: 'c_count', s: 'clientes', type: 'int', label: 'Quantos clientes ativos vocês têm hoje?', min: 0 },
    { id: 'c_concentration', s: 'clientes', type: 'percent', label: 'Quanto do faturamento vem dos 3 maiores clientes?', help: 'Em %. Mais de 50% é um risco de dependência.' },

    { id: 'm_region', s: 'mercado', type: 'choice', label: 'Até onde vai a área de atuação?', options: ['Bairro ou cidade', 'Região', 'Estado', 'Brasil todo', 'Outros países', 'Só online'] },
    { id: 'm_size', s: 'mercado', type: 'long', label: 'Quantos clientes em potencial existem na sua área?', help: 'Uma estimativa já ajuda. Ex.: 2 mil clínicas na região.' },
    { id: 'm_trends', s: 'mercado', type: 'list', label: 'Que mudanças estão acontecendo no seu setor?', help: 'Tendências, leis, tecnologia, comportamento do cliente. Uma por linha.' },

    { id: 'k_list', s: 'concorrencia', type: 'list', label: 'Quem são os principais concorrentes?', help: 'Um por linha. Vale incluir quem resolve o mesmo problema de outro jeito.' },
    { id: 'k_better', s: 'concorrencia', type: 'long', label: 'No que eles são melhores que vocês?' },
    { id: 'k_worse', s: 'concorrencia', type: 'long', label: 'No que vocês são melhores que eles?' },
    { id: 'k_price', s: 'concorrencia', type: 'choice', label: 'Seu preço, comparado ao deles, é:', options: ['Mais barato', 'Parecido', 'Mais caro'] },

    { id: 'p_list', s: 'receita', type: 'list', label: 'Quais os principais produtos ou serviços?', help: 'Um por linha, do que mais vende para o que menos vende.' },
    { id: 'p_model', s: 'receita', type: 'multi', label: 'Como o negócio ganha dinheiro?', options: ['Venda avulsa', 'Assinatura ou mensalidade', 'Contrato ou projeto', 'Comissão', 'Licença ou royalties', 'Outro'] },
    { id: 'p_ticket', s: 'receita', type: 'money', label: 'Qual o valor médio de cada venda (ticket médio)?' },
    { id: 'p_sales', s: 'receita', type: 'int', label: 'Quantas vendas (ou atendimentos) por mês, em média?', min: 0 },
    { id: 'p_repeat', s: 'receita', type: 'choice', label: 'O cliente costuma comprar de novo?', options: ['Quase nunca', 'Às vezes', 'Com frequência', 'Paga todo mês'] },

    { id: 's_channels', s: 'vendas', type: 'multi', label: 'Como os clientes chegam até vocês?', options: ['Indicação', 'Instagram', 'Google', 'Site', 'WhatsApp', 'Vendedor ou representante', 'Loja física', 'Marketplace', 'Eventos e feiras', 'LinkedIn', 'Outro'] },
    { id: 's_process', s: 'vendas', type: 'long', label: 'Como é a venda, do primeiro contato ao fechamento?' },
    { id: 's_spend', s: 'vendas', type: 'money', label: 'Quanto gastam por mês com marketing e vendas?', help: 'Anúncios, agência, comissões fixas, brindes.' },
    { id: 's_retention', s: 'vendas', type: 'long', label: 'O que fazem para o cliente voltar ou indicar?' },

    { id: 'o_steps', s: 'operacao', type: 'list', label: 'Quais as etapas principais para entregar o que vocês vendem?', help: 'Uma por linha.' },
    { id: 'o_suppliers', s: 'operacao', type: 'list', label: 'Quem são os fornecedores e parceiros mais importantes?', help: 'Um por linha.' },
    { id: 'o_tools', s: 'operacao', type: 'list', label: 'Que sistemas e ferramentas usam?', help: 'ERP, planilhas, CRM, emissor de notas... um por linha.' },
    { id: 'o_bottleneck', s: 'operacao', type: 'long', label: 'O que mais trava a operação hoje?' },

    { id: 'g_partners', s: 'pessoas', type: 'list', label: 'Quem são os sócios e o papel de cada um?', help: 'Um por linha. Ex.: Ana: comercial e finanças.' },
    { id: 'g_team', s: 'pessoas', type: 'int', label: 'Quantas pessoas trabalham no negócio (com os sócios)?', min: 0 },
    { id: 'g_hire', s: 'pessoas', type: 'list', label: 'Quem precisam contratar nos próximos 12 meses?', help: 'Um por linha. Pode deixar vazio.' },
    { id: 'g_management', s: 'pessoas', type: 'long', label: 'Como são tomadas as decisões e acompanhados os resultados?', help: 'Reuniões, indicadores, quem decide o quê.' },

    { id: 'f_revenue', s: 'financas', type: 'money', label: 'Qual o faturamento médio por mês hoje?', help: 'Se não souber, a gente calcula pelo ticket médio vezes as vendas do mês.' },
    { id: 'f_fixed', s: 'financas', type: 'money', label: 'Quanto são os custos fixos por mês?', help: 'Aluguel, salários e encargos, contador, sistemas, energia. Sem o pró-labore.' },
    { id: 'f_variable', s: 'financas', type: 'percent', label: 'Quanto dos custos varia com a venda, em % do faturamento?', help: 'Mercadoria ou matéria-prima, comissões, frete, taxas de cartão.' },
    { id: 'f_tax', s: 'financas', type: 'percent', label: 'Quanto de imposto sai sobre a venda, em %?', help: 'No Simples Nacional costuma ficar entre 4% e 16%. Seu contador sabe.' },
    { id: 'f_prolabore', s: 'financas', type: 'money', label: 'Quanto é o pró-labore dos sócios por mês, somando todos?' },
    { id: 'f_debt', s: 'financas', type: 'money', label: 'Quanto pagam por mês de empréstimos e financiamentos?', help: 'Só as parcelas. Zero se não tiver.' },
    { id: 'f_growth', s: 'financas', type: 'percent', label: 'Quanto esperam crescer por mês, em %?', help: 'Uma meta realista. Ex.: 2% ao mês dá cerca de 27% no ano.' },
    { id: 'f_invest', s: 'financas', type: 'money', label: 'Quanto de investimento o plano precisa?', help: 'Reforma, equipamentos, estoque, marketing de lançamento, capital de giro.' },
    { id: 'f_own', s: 'financas', type: 'money', label: 'Quanto disso vocês têm de recursos próprios?' },

    { id: 'r_goals', s: 'metas', type: 'list', label: 'Quais as 3 principais metas para os próximos 12 meses?', help: 'Uma por linha. Ex.: faturar R$ 80 mil por mês.' },
    { id: 'r_risks', s: 'metas', type: 'list', label: 'O que pode dar errado no caminho?', help: 'Uma por linha.' },
    { id: 'r_esg', s: 'metas', type: 'long', label: 'Que cuidados vocês têm com pessoas, meio ambiente e boa gestão?', help: 'ESG: pode ser algo simples, como reciclagem, benefícios à equipe ou contas organizadas.' },
    { id: 'r_help', s: 'metas', type: 'multi', label: 'Em que áreas mais precisam de ajuda?', options: ['Finanças', 'Vendas', 'Marketing', 'Processos', 'Pessoas', 'Tecnologia', 'Conseguir investimento', 'Gestão e estratégia'] },
  ];
  const BY_ID = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));

  // As seções do documento, na ordem.
  const DOC = [
    ['sumario', 'Sumário executivo'], ['negocio', 'O negócio'], ['proposta', 'Clientes e proposta de valor'], ['mercado', 'Análise de mercado'],
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
      case 'money': return num(0, 1e12);
      case 'percent': return num(0, 100);
      case 'int': return Math.round(num(q.min ?? 0, q.max ?? 1e9));
      case 'choice': if (!q.options.includes(v)) throw new Error(`${q.label}: opção inválida`); return v;
      case 'multi': {
        if (!Array.isArray(v) || !v.every(x => q.options.includes(x))) throw new Error(`${q.label}: opção inválida`);
        return v.length ? [...new Set(v)] : null;
      }
      default: return null;
    }
  }

  // Quanto do questionário foi respondido (contando "não sei" como respondido).
  function progress(answers = {}, unknown = []) {
    const done = QUESTIONS.filter(q => !isEmpty(answers[q.id]) || unknown.includes(q.id)).length;
    const bySection = SECTIONS.map(([key, title]) => {
      const qs = QUESTIONS.filter(q => q.s === key);
      return { key, title, total: qs.length, done: qs.filter(q => !isEmpty(answers[q.id]) || unknown.includes(q.id)).length };
    });
    return { done, total: QUESTIONS.length, pct: Math.round((done / QUESTIONS.length) * 100), bySection };
  }

  // ---------- conta financeira (o número nunca vem da IA) ----------
  const brl = n => (n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
  const pct = n => (n === null || n === undefined || !Number.isFinite(n) ? '–' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);

  function finance(a = {}) {
    const val = id => (isEmpty(a[id]) ? null : Number(a[id]));
    const revenueBase = val('f_revenue') ?? (val('p_ticket') !== null && val('p_sales') !== null ? val('p_ticket') * val('p_sales') : null);
    const missing = [];
    if (revenueBase === null) missing.push('faturamento por mês (ou ticket médio e vendas por mês)');
    if (val('f_fixed') === null) missing.push('custos fixos');
    if (val('f_variable') === null) missing.push('custos variáveis (%)');
    if (val('f_tax') === null) missing.push('impostos (%)');
    if (missing.length) return { ok: false, missing };
    const assumed = [];
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
    if (q.type === 'money') return brl(Number(v));
    if (q.type === 'percent') return pct(Number(v));
    if (Array.isArray(v)) return v.join('; ');
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
      negocio: [item('Nome', 'b_name'), item('Setor', 'b_segment'), item('Momento', 'b_stage'), item('Desde', 'b_since'), item('Localização e atendimento', 'b_location'),
        '', '### O que faz', para('b_what'), '', '### Propósito e visão', para('b_purpose'), '', '### Valores', bullets('b_values')].join('\n'),
      proposta: [item('Vende para', 'c_type'), item('Clientes ativos', 'c_count'), item('Peso dos 3 maiores clientes no faturamento', 'c_concentration'),
        '', '### Cliente ideal', para('c_ideal'), '', '### Dores e desejos', bullets('c_pains'), '', '### Por que compram de nós', para('c_why')].join('\n'),
      mercado: [item('Área de atuação', 'm_region'), '', '### Tamanho do mercado', para('m_size'), '', '### Tendências', bullets('m_trends')].join('\n'),
      concorrencia: ['### Principais concorrentes', bullets('k_list'), '', '### Onde eles são melhores', para('k_better'), '', '### Onde somos melhores', para('k_worse'), '', item('Preço em relação a eles', 'k_price')].join('\n'),
      receita: ['### Produtos e serviços', bullets('p_list'), '', item('Como ganha dinheiro', 'p_model'), item('Ticket médio', 'p_ticket'), item('Vendas por mês', 'p_sales'), item('Recompra', 'p_repeat'),
        !isEmpty(A('s_spend')) && !isEmpty(A('p_sales')) && Number(A('p_sales')) > 0 ? `- **Custo de marketing e vendas por venda (aproximado):** ${brl(Number(A('s_spend')) / Number(A('p_sales')))}` : null].filter(x => x !== null).join('\n'),
      marketing: [item('Canais', 's_channels'), item('Investimento mensal em marketing e vendas', 's_spend'), '', '### Processo de venda', para('s_process'), '', '### Retenção e indicação', para('s_retention')].join('\n'),
      operacao: ['### Etapas da entrega', bullets('o_steps'), '', '### Fornecedores e parceiros', bullets('o_suppliers'), '', '### Sistemas e ferramentas', bullets('o_tools'), '', '### O que trava a operação', para('o_bottleneck')].join('\n'),
      pessoas: ['### Sócios', bullets('g_partners'), '', item('Pessoas no negócio', 'g_team'), '', '### Contratações previstas', bullets('g_hire'), '', '### Gestão e decisões', para('g_management')].join('\n'),
      financeiro: financeTables(f),
      cenarios: scenarioTable(f),
      swot: ['| Forças | Fraquezas |', '|---|---|', `| ${isEmpty(A('k_worse')) ? '[A definir]' : T('k_worse')} | ${isEmpty(A('k_better')) ? '[A definir]' : T('k_better')} |`,
        '', '| Oportunidades | Ameaças |', '|---|---|', `| ${isEmpty(A('m_trends')) ? '[A definir]' : T('m_trends')} | ${isEmpty(A('r_risks')) ? '[A definir]' : T('r_risks')} |`].join('\n'),
      riscos: [bullets('r_risks'), !isEmpty(A('c_concentration')) && Number(A('c_concentration')) > 50 ? '- Dependência de poucos clientes: os 3 maiores somam mais da metade do faturamento.' : null].filter(x => x !== null).join('\n'),
      esg: para('r_esg'),
      metas: [bullets('r_goals'), '', 'Para cada meta: definir o indicador, o valor de hoje, o valor desejado e o responsável. [A definir na reunião]'].join('\n'),
      acao: ['| O quê | Quem | Até quando |', '|---|---|---|', ...(Array.isArray(A('r_goals')) ? A('r_goals') : ['[A definir na reunião]']).map(g => `| ${g} | [A definir] | [A definir] |`),
        ...(Array.isArray(A('r_help')) ? [`| Plano de apoio da consultoria em: ${A('r_help').join(', ')} | Opps Consultoria | [A definir] |`] : [])].join('\n'),
      pendencias: pendencias(answers, unknown, f),
    };
    return DOC.map(([key, title]) => ({ key, title, content: sec[key] || '' }));
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

  // CNPJ: 14 dígitos com os dígitos verificadores certos.
  function validCnpj(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
    const calc = n => { let s = 0, w = n - 7; for (let i = 0; i < n; i++) { s += Number(d[i]) * w--; if (w < 2) w = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  const fmtCnpj = v => String(v || '').replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

  return { REVENUE_BANDS, SECTIONS, QUESTIONS, BY_ID, DOC, DOC_TITLE, clean, progress, finance, financeTables, scenarioTable, answerText, draft, pendencias, validCnpj, fmtCnpj, brl, pct, isEmpty, parseMd, inline };
}));
