'use strict';
// Plano de negócio escrito pela IA da Anthropic (Claude), a partir das respostas do questionário.
// A IA escreve o texto; os números do plano financeiro e dos cenários são calculados pelo sistema
// (public/bizplan.js) e só chegam à IA prontos, para ela comentar sem inventar.
// As respostas vão para a API da Anthropic para serem lidas.
const B = require('./public/bizplan.js');
const MODEL = 'claude-opus-5-5';

// Seções que a IA escreve (diagnóstico e pendências são do sistema).
const AI_KEYS = B.AI_KEYS;
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
// As instruções e o texto com respostas, números e diagnóstico ficam em public/bizplan.js:
// são os mesmos para a API e para o botão "Escrever com o Claude" (copiar e colar no claude.ai).
const SYSTEM = B.AI_SYSTEM;

function config(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  return { apiKey: env.ANTHROPIC_API_KEY, model: env.BIZPLAN_MODEL || MODEL };
}
const contextText = args => B.contextText(args);

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

// Escreve o plano inteiro. Devolve as seções na ordem do documento, já com as partes calculadas pelo sistema.
async function generate(cfg, { answers, unknown = [], meta = {} }) {
  const out = await call(cfg, { system: SYSTEM, user: `${contextText({ answers, unknown, meta })}\n\nEscreva todas as seções do plano de negócio.`, schema: SCHEMA, maxTokens: 64000 });
  const byKey = Object.fromEntries((Array.isArray(out.sections) ? out.sections : []).map(x => [x.key, x.content]));
  return B.assemble(byKey, { answers, unknown, meta });
}
// Mantido para os testes: o mesmo que B.assemble, recebendo a lista de seções da IA.
const assemble = (aiSections, args) => B.assemble(Object.fromEntries(aiSections.map(x => [x.key, x.content])), args);

// Reescreve uma seção conforme o pedido de quem está editando (na reunião).
async function rewrite(cfg, { answers, unknown = [], meta = {}, section, instruction }) {
  const out = await call(cfg, {
    system: `${SYSTEM}\n\nAgora você vai reescrever uma única seção, seguindo o pedido. Mantenha os fatos e os números que já estão nela; não acrescente números que não estejam nas respostas.`,
    user: `${contextText({ answers, unknown, meta })}\n\nSeção "${section.title}" como está hoje:\n${section.content}\n\nPedido: ${instruction}`,
    schema: REWRITE, maxTokens: 16000,
  });
  return String(out.content || '').trim().slice(0, 20000);
}

module.exports = { config, generate, rewrite, assemble, contextText, SCHEMA, MODEL, AI_KEYS };
