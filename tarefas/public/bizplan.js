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

    const conc = Number(a.c_concentration);
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
    if (channels.includes('Indicação')) add('forte', 'Vendas', 'Indicação funciona', 'Clientes chegam por indicação.', 'Transformar em programa: um benefício para quem indica e para o indicado.',
      { sec: 'marketing', explain: 'Indicação é o canal mais barato e o que mais converte.', ask: 'Vocês pedem indicação? Dariam um benefício para quem indica?' });
    if (f.ok && has('s_spend') && Number(a.s_spend) / f.inputs.revenueBase > 0.15) add('atencao', 'Vendas', 'Gasto alto com marketing e vendas', `${pct((Number(a.s_spend) / f.inputs.revenueBase) * 100)} do faturamento vai para marketing e vendas.`, 'Medir quantos clientes cada canal traz e cortar o que não traz.',
      { sec: 'marketing', explain: 'Uma parte grande da receita vai para atrair clientes.', ask: 'Vocês sabem quantos clientes cada canal traz?' });
    if (has('s_spend') && has('p_sales') && has('p_ticket') && Number(a.p_sales) > 0 && Number(a.s_spend) / Number(a.p_sales) > 0.3 * Number(a.p_ticket)) add('atencao', 'Vendas', 'Custo para vender alto em relação ao ticket', `Cada venda custa cerca de ${brl(Number(a.s_spend) / Number(a.p_sales))} em marketing e vendas, para um ticket de ${brl(Number(a.p_ticket))}.`, 'Aumentar o ticket (combos, kits) ou focar nos canais mais baratos.',
      { sec: 'marketing', explain: 'Cada venda custa caro para conquistar, comparado ao valor que ela traz.', ask: 'Dá para vender mais coisas na mesma compra (combos, kits)?' });
    if (a.k_price === 'Mais caro') add(has('c_why') ? 'forte' : 'atencao', 'Concorrência', has('c_why') ? 'Preço acima da concorrência com diferencial claro' : 'Preço acima da concorrência sem diferencial claro',
      has('c_why') ? `O cliente paga mais por: ${a.c_why}` : 'Não ficou claro por que o cliente paga mais.', has('c_why') ? 'Mostrar esse diferencial em toda a comunicação; nunca entrar em guerra de preço.' : 'Definir e comunicar o diferencial, ou rever o preço.',
      { sec: 'concorrencia', explain: has('c_why') ? 'Cobrar mais é saudável quando o cliente enxerga o porquê.' : 'Quem cobra mais precisa deixar claro o que entrega a mais.', ask: has('c_why') ? 'Esse diferencial aparece no Instagram, na loja e no atendimento?' : 'Por que o cliente escolhe vocês, mesmo pagando mais?' });
    if (a.k_price === 'Mais barato' && f.ok && f.contribPct < 40) add('atencao', 'Concorrência', 'Preço baixo com margem apertada', 'Competir por preço com margem de contribuição baixa deixa pouco espaço para crescer.', 'Rever preço e buscar diferenciais que não dependam de preço.',
      { sec: 'concorrencia', explain: 'Ser o mais barato funciona quando o custo também é o mais baixo; senão, sobra pouco.', ask: 'Os clientes compram só pelo preço? O que mais eles valorizam?' });
    if (!has('m_trends')) add('atencao', 'Mercado', 'Sem leitura das mudanças do setor', 'Não foram citadas tendências que afetam o negócio.', 'Levantar 3 mudanças do setor (clientes, tecnologia, leis) e como responder a cada uma.',
      { sec: 'mercado', explain: 'Olhar o que está mudando ajuda a se antecipar à concorrência.', ask: 'O que mudou no seu setor nos últimos 2 anos?' });
    if (!has('o_tools')) add('oportunidade', 'Operação', 'Ferramentas de gestão', 'Não foram citados sistemas de gestão.', 'Um controle simples de vendas, estoque e caixa já ajuda nas decisões.',
      { sec: 'operacao', explain: 'Sem registro, as decisões ficam no "achismo".', ask: 'Como vocês controlam hoje vendas, estoque e caixa?' });
    else if ((a.o_tools || []).every(t => /planilha|excel|caderno/i.test(t))) add('oportunidade', 'Operação', 'Gestão em planilhas', 'A gestão roda em planilhas.', 'Avaliar um sistema de gestão (ERP) do porte do negócio.',
      { sec: 'operacao', explain: 'Planilha funciona no começo, mas depende de quem preenche e erra fácil.', ask: 'Quanto tempo por semana vai para preencher planilhas?' });
    if (!has('g_management')) add('atencao', 'Gestão', 'Gestão sem rotina definida', 'Não ficou claro como são acompanhados os resultados.', 'Reunião mensal de resultados com 3 a 5 indicadores.',
      { sec: 'pessoas', explain: 'Um encontro mensal curto, olhando sempre os mesmos números, evita surpresas.', ask: 'Quem decide o quê hoje? Vocês olham os números todo mês?' });
    if (has('g_hire') && f.ok && f.monthResult < 0.05 * f.inputs.revenueBase) add('atencao', 'Pessoas', 'Contratações com resultado apertado', `Há ${a.g_hire.length} contratação(ões) prevista(s) e o resultado mensal está em ${brl(f.monthResult)}.`, 'Contratar junto com o aumento de vendas, não antes.',
      { sec: 'pessoas', explain: 'Cada contratação aumenta o custo fixo e sobe o ponto de equilíbrio.', ask: 'Qual contratação é mais urgente? Ela traz venda ou só alivia o trabalho?' });
    if (!has('r_goals')) add('atencao', 'Metas', 'Sem metas definidas', 'Não foram definidas metas para os próximos 12 meses.', 'Definir 3 metas mensuráveis, com responsável e prazo.',
      { sec: 'metas', explain: 'Sem metas não dá para saber se o ano foi bom.', ask: 'Onde vocês querem estar daqui a 12 meses?' });
    if (has('r_risks')) add('forte', 'Riscos', 'Riscos mapeados', `${a.r_risks.length === 1 ? 'Foi citado 1 risco' : `Foram citados ${a.r_risks.length} riscos`}.`, 'Para cada um, definir o que fazer para reduzir e quem acompanha.',
      { sec: 'riscos', explain: 'Saber o que pode dar errado é o primeiro passo para se proteger.', ask: 'Qual desses riscos tira mais o sono de vocês?' });
    if (!has('r_esg')) add('oportunidade', 'ESG', 'Práticas de ESG', 'Não foram citadas práticas sociais, ambientais ou de gestão.', 'Começar com ações simples e visíveis para o cliente (resíduos, equipe, contas organizadas).',
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

  return { REVENUE_BANDS, SECTIONS, QUESTIONS, BY_ID, DOC, DOC_TITLE, clean, progress, finance, financeTables, scenarioTable, answerText, draft, pendencias, validCnpj, fmtCnpj, brl, pct, isEmpty, parseMd, inline, LEVELS, insights, insightsText, AI_SYSTEM, AI_KEYS, contextText, manualPrompt, parsePasted, assemble };
}));
