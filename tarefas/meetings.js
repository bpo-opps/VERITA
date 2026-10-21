'use strict';
// Leitura das atas de reunião (PDF do Google Meet) pela IA da Anthropic (Claude).
// A IA só sugere: cada tarefa encontrada fica em triagem até alguém da equipe dar o OK.
// O PDF vai para a API da Anthropic para ser lido; nada é lançado sem aprovação.
const S = require('./shared');
const MODEL = 'claude-opus-5-5';

const ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'kind', 'client_id', 'responsible_ids', 'client_responsible', 'due_date', 'priority', 'checklist', 'quote'],
  properties: {
    title: { type: 'string', description: 'Título curto, começando por verbo no infinitivo (ex.: "Enviar proposta revisada")' },
    description: { type: 'string', description: 'Contexto da reunião que a pessoa precisa para executar, em 1 a 3 frases' },
    kind: { type: 'string', enum: ['external', 'internal'], description: 'external: trabalho para um cliente, que ele acompanha. internal: trabalho interno da consultoria' },
    client_id: { type: 'integer', description: 'id da empresa cliente da lista, ou 0 se não houver' },
    responsible_ids: { type: 'array', items: { type: 'integer' }, description: 'ids dos participantes (da equipe ou do cliente) que ficaram responsáveis; vazio se ninguém foi definido' },
    client_responsible: { type: 'string', description: 'Nome de quem do cliente (ou de fora) ficou responsável, se for o caso; senão vazio' },
    due_date: { type: 'string', description: 'Prazo no formato AAAA-MM-DD, só se foi combinado; senão vazio' },
    priority: { type: 'string', enum: ['low', 'normal', 'high'] },
    checklist: { type: 'array', items: { type: 'string' }, description: 'Passos citados na reunião, se houver; senão vazio' },
    quote: { type: 'string', description: 'Trecho curto da ata de onde a tarefa saiu, copiado como está' },
  },
};
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'tasks'],
  properties: {
    summary: { type: 'string', description: 'Resumo da reunião em até 3 frases' },
    tasks: { type: 'array', items: ITEM },
  },
};

const SYSTEM = `Você ajuda uma consultoria a transformar atas de reunião em tarefas.
Leia a ata em PDF e liste só as ações combinadas: algo que alguém ficou de fazer depois da reunião.
Não transforme em tarefa assuntos só discutidos, decisões já tomadas sem ação, nem o que já foi feito.
Junte ações repetidas em uma só. Escreva em português do Brasil.
Responsáveis: use apenas ids das listas de participantes (equipe ou cliente). Se quem ficou responsável não está nas listas (alguém de fora), deixe responsible_ids sem essa pessoa e escreva o nome em client_responsible.
Prazos: converta datas relativas ("sexta", "semana que vem", "até o dia 10") usando a data da reunião. Sem prazo combinado, deixe vazio. Não invente prazo.
Empresa: use o id da lista de empresas; na dúvida, a empresa da reunião.`;

function config(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  return { apiKey: env.ANTHROPIC_API_KEY, model: env.MEETINGS_MODEL || MODEL };
}

function contextText({ meeting, attendees, others, clients }) {
  return JSON.stringify({
    reuniao: { titulo: meeting.title, data: meeting.meeting_date, empresa_id: meeting.client_id || 0 },
    participantes_equipe: attendees.filter(u => u.role !== 'client').map(u => ({ id: u.id, nome: u.name })),
    participantes_cliente: attendees.filter(u => u.role === 'client').map(u => ({ id: u.id, nome: u.name, empresa_id: u.client_id })),
    outros_participantes: others || '',
    empresas: clients.map(c => ({ id: c.id, nome: c.name })),
  }, null, 2);
}

// Chama a IA e devolve { summary, tasks } no formato do SCHEMA.
async function extract(cfg, { pdf, meeting, attendees, others, clients }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: cfg.apiKey, ...(cfg.fetch ? { fetch: cfg.fetch } : {}) });
  const stream = client.beta.messages.stream({
    model: cfg.model,
    max_tokens: 32000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(pdf).toString('base64') } },
        { type: 'text', text: `Dados da reunião (participantes confirmados por quem lançou a ata):\n${contextText({ meeting, attendees, others, clients })}\n\nListe as tarefas desta ata.` },
      ],
    }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('A IA não aceitou ler esta ata. Lance as tarefas à mão.');
  if (msg.stop_reason === 'max_tokens') throw new Error('A ata é longa demais para ler de uma vez. Divida o PDF e tente de novo.');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let out;
  try { out = JSON.parse(text); } catch { throw new Error('A IA devolveu uma resposta que não deu para ler. Tente de novo.'); }
  return { summary: String(out.summary || ''), tasks: Array.isArray(out.tasks) ? out.tasks : [] };
}

// Confere o que a IA sugeriu contra os dados do sistema: só responsáveis da equipe que estavam
// presentes, só empresas que existem, só datas válidas.
function sanitize(t, { meeting, attendees, clients }) {
  const staffIds = new Set(attendees.filter(u => u.role !== 'client').map(u => u.id));
  const clientIds = new Set(clients.map(c => c.id));
  let clientId = clientIds.has(Number(t.client_id)) ? Number(t.client_id) : (meeting.client_id || null);
  let kind = t.kind === 'internal' ? 'internal' : 'external';
  if (kind === 'external' && !clientId) kind = 'internal';
  const due = /^\d{4}-\d{2}-\d{2}$/.test(t.due_date || '') && !Number.isNaN(Date.parse(t.due_date)) ? t.due_date : null;
  const s = (v, max) => String(v || '').trim().slice(0, max);
  return {
    title: s(t.title, 200) || 'Tarefa sem título',
    description: s(t.description, 4000),
    kind, client_id: clientId,
    // Da equipe presente; do cliente presente só se a tarefa for da empresa dele e ele a vê.
    assignee_ids: [...new Set((t.responsible_ids || []).map(Number))].filter(x => staffIds.has(x) ||
      attendees.some(u => u.id === x && S.clientAssignable(u, { kind, client_id: clientId, client_visible: 0 }))),
    client_responsible: s(t.client_responsible, 120),
    due_date: due,
    priority: ['low', 'normal', 'high'].includes(t.priority) ? t.priority : 'normal',
    checklist: (Array.isArray(t.checklist) ? t.checklist : []).map(x => s(x, 300)).filter(Boolean).slice(0, 30),
    quote: s(t.quote, 1000),
  };
}

module.exports = { config, extract, sanitize, SCHEMA, MODEL };
