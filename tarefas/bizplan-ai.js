'use strict';
// Plano de negócio escrito pela IA da Anthropic (Claude), a partir das respostas do questionário.
// A IA escreve o texto; os números do plano financeiro e dos cenários são calculados pelo sistema
// (public/bizplan.js) e só chegam à IA prontos, para ela comentar sem inventar.
// As respostas vão para a API da Anthropic para serem lidas.
const B = require('./public/bizplan.js');
const MODEL = 'claude-opus-5-5';

// Seções que a IA escreve (a de pendências é montada pelo sistema).
const AI_KEYS = B.DOC.map(([k]) => k).filter(k => k !== 'pendencias');
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sections'],
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'content'],
        properties: {
          key: { type: 'string', enum: AI_KEYS },
          content: { type: 'string', description: 'Texto da seção no formato pedido (sem o título da seção)' },
        },
      },
    },
  },
};
const REWRITE = {
  type: 'object', additionalProperties: false, required: ['content'],
  properties: { content: { type: 'string', description: 'A seção reescrita, no mesmo formato, sem o título' } },
};

const FORMAT = `Formato do texto de cada seção: subtítulos com "### ", listas com "- ", destaque com **negrito** e tabelas com "| a | b |" e a linha "|---|---|" embaixo do cabeçalho. Nada de HTML. Não repita o título da seção.`;
const SYSTEM = `Você é consultor de negócios de uma consultoria brasileira e escreve planos de negócio para pequenas e médias empresas.
Escreva em português do Brasil, claro e direto, para o dono do negócio: frases curtas, sem jargão sem explicação, sem frases de efeito.
Use só o que está nas respostas do questionário e nos números calculados. Não invente fatos, nomes, clientes, concorrentes, pesquisas nem números.
Números: use apenas os que aparecem nas respostas ou no bloco "Números calculados pelo sistema", copiados como estão. Não faça contas novas.
Quando faltar uma informação importante, escreva "[A definir na reunião: o que falta]" no lugar, em vez de supor.
Pode e deve analisar: tirar conclusões, apontar riscos e oportunidades, recomendar próximos passos, sempre ligando ao que foi respondido.
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
${FORMAT}`;

function config(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  return { apiKey: env.ANTHROPIC_API_KEY, model: env.BIZPLAN_MODEL || MODEL };
}

// Respostas e números em texto, para a IA.
function contextText({ answers, unknown, meta, fin }) {
  const lines = [`Empresa: ${meta.company || answers.b_name || '-'}${meta.revenue_band ? ` (faixa de faturamento informada: ${meta.revenue_band})` : ''}`, '', 'Respostas do questionário:'];
  for (const [key, title] of B.SECTIONS) {
    lines.push('', `## ${title}`);
    for (const q of B.QUESTIONS.filter(x => x.s === key)) {
      const v = unknown.includes(q.id) ? '(não sabe: ver na reunião)' : (B.answerText(q, answers[q.id]) || '(sem resposta)');
      lines.push(`- ${q.label} ${v}`);
    }
  }
  lines.push('', 'Números calculados pelo sistema:', B.financeTables(fin), '', 'Cenários:', B.scenarioTable(fin));
  return lines.join('\n');
}

async function call(cfg, { system, user, schema, maxTokens }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: cfg.apiKey, ...(cfg.fetch ? { fetch: cfg.fetch } : {}) });
  const stream = client.beta.messages.stream({
    model: cfg.model,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: user }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('A IA não aceitou escrever este plano. Use o rascunho sem IA.');
  if (msg.stop_reason === 'max_tokens') throw new Error('O plano ficou longo demais para escrever de uma vez. Tente de novo.');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try { return JSON.parse(text); } catch { throw new Error('A IA devolveu uma resposta que não deu para ler. Tente de novo.'); }
}

// Escreve o plano inteiro. Devolve as seções na ordem do documento, já com as tabelas calculadas.
async function generate(cfg, { answers, unknown = [], meta = {} }) {
  const fin = B.finance(answers);
  const out = await call(cfg, { system: SYSTEM, user: `${contextText({ answers, unknown, meta, fin })}\n\nEscreva todas as seções do plano de negócio.`, schema: SCHEMA, maxTokens: 64000 });
  return assemble(Array.isArray(out.sections) ? out.sections : [], { answers, unknown, fin });
}
// Junta o texto da IA com as tabelas calculadas e as pendências; seção que faltar fica do rascunho.
function assemble(aiSections, { answers, unknown, fin }) {
  const byKey = Object.fromEntries(aiSections.filter(s => AI_KEYS.includes(s.key)).map(s => [s.key, String(s.content || '').trim().slice(0, 20000)]));
  const base = Object.fromEntries(B.draft(answers, unknown).map(s => [s.key, s.content]));
  return B.DOC.map(([key, title]) => {
    let content = byKey[key] || base[key] || '';
    if (key === 'financeiro') content = `${byKey[key] || ''}\n\n${B.financeTables(fin)}`.trim();
    if (key === 'cenarios') content = `${byKey[key] || ''}\n\n${B.scenarioTable(fin)}`.trim();
    if (key === 'pendencias') content = base.pendencias;
    return { key, title, content };
  });
}

// Reescreve uma seção conforme o pedido de quem está editando (na reunião).
async function rewrite(cfg, { answers, unknown = [], meta = {}, section, instruction }) {
  const fin = B.finance(answers);
  const out = await call(cfg, {
    system: `${SYSTEM}\n\nAgora você vai reescrever uma única seção, seguindo o pedido. Mantenha os fatos e os números que já estão nela; não acrescente números que não estejam nas respostas.`,
    user: `${contextText({ answers, unknown, meta, fin })}\n\nSeção "${section.title}" como está hoje:\n${section.content}\n\nPedido: ${instruction}`,
    schema: REWRITE, maxTokens: 16000,
  });
  return String(out.content || '').trim().slice(0, 20000);
}

module.exports = { config, generate, rewrite, assemble, contextText, SCHEMA, MODEL, AI_KEYS };
