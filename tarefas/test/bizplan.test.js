'use strict';
// Plano de negócio: questionário (cliente, equipe e lead público), conta financeira, documento (IA falsa ou rascunho) e versões.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { open, createOrg, createUser } = require('../db');
const { createHandler } = require('../app');
const B = require('../public/bizplan.js');
const ai = require('../bizplan-ai');

function world() {
  const db = open(':memory:');
  const orgId = createOrg(db, 'Opps Consultoria');
  const a = Number(db.prepare('insert into clients (org_id, name) values (?, ?)').run(orgId, 'Padaria A').lastInsertRowid);
  const b = Number(db.prepare('insert into clients (org_id, name) values (?, ?)').run(orgId, 'Clínica B').lastInsertRowid);
  const pw = 'senha-teste-1';
  const admin = createUser(db, { orgId, name: 'Ana Admin', email: 'admin@opps.test', password: pw, role: 'admin' });
  const bia = createUser(db, { orgId, name: 'Bia Equipe', email: 'bia@opps.test', password: pw, role: 'member' });
  const caio = createUser(db, { orgId, name: 'Caio Equipe', email: 'caio@opps.test', password: pw, role: 'member' });
  const dora = createUser(db, { orgId, name: 'Dora Cliente', email: 'dora@a.test', password: pw, role: 'client', clientId: a });
  const eva = createUser(db, { orgId, name: 'Eva Cliente', email: 'eva@b.test', password: pw, role: 'client', clientId: b });
  db.prepare('insert into user_clients (user_id, client_id) values (?, ?)').run(bia, a);
  return { db, a, b, admin, bia, caio, dora, eva, pw };
}
async function serve(w, planWriter) {
  const server = http.createServer(createHandler(w.db, { planWriter }));
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = cookie => async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const login = async email => {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: w.pw }) });
    return call(r.headers.get('set-cookie').split(';')[0]);
  };
  return { server, login, anon: call(null) };
}
const ANSWERS = { b_what: 'Pães artesanais e café', f_revenue: 50000, f_fixed: 15000, f_variable: 40, f_tax: 6, f_prolabore: 8000, f_growth: 2,
  f_invest: 60000, f_own: 20000, r_goals: ['Abrir uma filial', 'Faturar R$ 80 mil por mês'] };

test('conta financeira: ponto de equilíbrio, retorno, cenários; faltando dado, diz o que falta', () => {
  const f = B.finance(ANSWERS);
  assert.equal(f.ok, true);
  assert.equal(Math.round(f.contribPct), 54);
  assert.equal(Math.round(f.breakEven), Math.round(23000 / 0.54), 'fixos + pró-labore divididos pela margem de contribuição');
  assert.equal(f.capitalGap, 40000);
  assert.equal(f.months.length, 12);
  assert.ok(f.payback > 0 && f.payback <= 60);
  assert.ok(f.scenarios[0].result < f.scenarios[1].result && f.scenarios[1].result < f.scenarios[2].result);
  const viaTicket = B.finance({ p_ticket: 100, p_sales: 300, f_fixed: 1000, f_variable: 10, f_tax: 5 });
  assert.equal(viaTicket.inputs.revenueBase, 30000, 'sem faturamento, usa ticket × vendas');
  assert.ok(viaTicket.assumed.length, 'sem crescimento informado, assume 0% e avisa');
  const missing = B.finance({ f_revenue: 1000 });
  assert.equal(missing.ok, false);
  assert.equal(missing.missing.length, 3);
  assert.equal(B.validCnpj('11.222.333/0001-81'), true);
  assert.equal(B.validCnpj('11.222.333/0001-80'), false);
  assert.throws(() => B.clean('f_tax', 150), /número inválido/);
  assert.throws(() => B.clean('k_price', 'Grátis'), /opção inválida/);
  assert.deepEqual(B.clean('r_goals', 'a\n\n b '), ['a', 'b']);
});

test('cliente responde pelo login; equipe vê na sessão do cliente; quem não acompanha não vê', async () => {
  const w = world();
  const { server, login } = await serve(w, null);
  try {
    const bia = await login('bia@opps.test'), caio = await login('caio@opps.test'), dora = await login('dora@a.test'), eva = await login('eva@b.test'), admin = await login('admin@opps.test');
    assert.equal((await dora('POST', '/api/bizplans', { client_id: w.a })).status, 403, 'cliente não cria plano');
    const p = (await bia('POST', '/api/bizplans', { client_id: w.a })).body;
    assert.equal(p.title, 'Plano de negócio · Padaria A');
    assert.equal(p.answers.b_name, 'Padaria A');
    assert.ok((await dora('GET', '/api/inbox')).body.items.some(n => n.kind === 'bizplan' && n.link === `#/plano/${p.id}`), 'cliente é avisado');
    assert.equal((await eva('GET', `/api/bizplans/${p.id}`)).status, 404, 'outro cliente não vê');
    assert.equal((await caio('GET', `/api/bizplans/${p.id}`)).status, 404, 'equipe que não acompanha o cliente não vê');
    assert.equal((await dora('PATCH', `/api/bizplans/${p.id}`, { answers: { f_tax: 'muito' } })).status, 400);
    assert.equal((await dora('PATCH', `/api/bizplans/${p.id}`, { answers: { nada: 1 } })).status, 400);
    let r = await dora('PATCH', `/api/bizplans/${p.id}`, { answers: ANSWERS, unknown: ['m_size'] });
    assert.equal(r.status, 200);
    assert.equal(r.body.finance, undefined, 'o cliente não recebe a conta pronta antes do documento');
    assert.deepEqual(r.body.unknown, ['m_size']);
    r = await dora('PATCH', `/api/bizplans/${p.id}`, { answers: { m_size: 'Uns 500 cafés na cidade' } });
    assert.deepEqual(r.body.unknown, [], 'responder tira do "não sei"');
    assert.equal((await dora('PATCH', `/api/bizplans/${p.id}`, { shared: true })).status, 403);
    r = await bia('PATCH', `/api/bizplans/${p.id}`, { answers: { k_price: 'Mais caro' } });
    assert.equal(r.body.answers.k_price, 'Mais caro', 'a equipe responde junto, na sessão do cliente');
    assert.equal(r.body.finance.ok, true);
    await dora('PATCH', `/api/bizplans/${p.id}`, { submit: true });
    assert.ok((await admin('GET', '/api/inbox')).body.items.some(n => n.kind === 'bizplan' && /Dora Cliente concluiu/.test(n.title)));
    assert.ok((await bia('GET', '/api/inbox')).body.items.some(n => n.kind === 'bizplan'), 'equipe que acompanha é avisada');
    assert.equal((await bia('GET', '/api/bizplans')).body.length, 1);
    assert.equal((await caio('GET', '/api/bizplans')).body.length, 0);
    assert.equal((await eva('GET', '/api/bizplans')).body.length, 0);
  } finally { server.close(); }
});

test('documento: rascunho sem IA, versões, mostrar ao cliente', async () => {
  const w = world();
  const { server, login } = await serve(w, null);
  try {
    const bia = await login('bia@opps.test'), dora = await login('dora@a.test');
    const p = (await bia('POST', '/api/bizplans', { client_id: w.a })).body;
    await bia('PATCH', `/api/bizplans/${p.id}`, { answers: ANSWERS, unknown: ['m_size'] });
    assert.equal((await bia('PATCH', `/api/bizplans/${p.id}`, { shared: true })).status, 409, 'sem documento não mostra');
    let r = await bia('POST', `/api/bizplans/${p.id}/generate`, {});
    assert.equal(r.status, 200, 'sem IA o rascunho sai na hora');
    assert.equal(r.body.doc_status, 'ready');
    assert.equal(r.body.doc_source, 'draft');
    assert.equal(r.body.doc.length, B.DOC.length);
    const fin = r.body.doc.find(s => s.key === 'financeiro');
    assert.match(fin.content, /Ponto de equilíbrio: R\$\s?42\.593/);
    assert.match(r.body.doc.find(s => s.key === 'pendencias').content, /Quantos clientes em potencial/);
    assert.equal((await dora('GET', `/api/bizplans/${p.id}`)).body.doc, null, 'cliente só vê quando a equipe mostrar');
    const edited = r.body.doc.map(s => (s.key === 'sumario' ? { ...s, content: 'Resumo ajustado na reunião.' } : s));
    r = await bia('PUT', `/api/bizplans/${p.id}/doc`, { sections: edited, note: 'Ajustes da reunião' });
    assert.equal(r.body.doc[0].content, 'Resumo ajustado na reunião.');
    assert.equal((await bia('PUT', `/api/bizplans/${p.id}/doc`, { sections: [{ key: 'x', title: '', content: '' }] })).status, 400);
    const versions = (await bia('GET', `/api/bizplans/${p.id}/versions`)).body;
    assert.equal(versions.length, 2);
    assert.equal(versions[0].note, 'Ajustes da reunião');
    r = await bia('POST', `/api/bizplans/${p.id}/versions/${versions[1].id}/restore`);
    assert.notEqual(r.body.doc[0].content, 'Resumo ajustado na reunião.', 'voltou ao rascunho');
    assert.equal((await bia('GET', `/api/bizplans/${p.id}/versions`)).body.length, 3, 'restaurar também vira versão');
    assert.equal((await bia('POST', `/api/bizplans/${p.id}/rewrite`, { key: 'sumario', instruction: 'mais curto' })).status, 409, 'sem chave, sem IA');
    await bia('PATCH', `/api/bizplans/${p.id}`, { shared: true });
    const seen = (await dora('GET', `/api/bizplans/${p.id}`)).body;
    assert.equal(seen.doc.length, B.DOC.length, 'agora o cliente vê');
    assert.equal(seen.lead, null);
    assert.ok((await dora('GET', '/api/inbox')).body.items.some(n => n.title === 'Seu plano de negócio está disponível'));
    assert.equal((await dora('GET', `/api/bizplans/${p.id}/versions`)).status, 403);
  } finally { server.close(); }
});

test('documento pela IA: texto da IA + tabelas calculadas pelo sistema; reescrever uma seção', async () => {
  const w = world();
  let seen = null;
  const planWriter = {
    generate: async args => { seen = args; return ai.assemble([{ key: 'sumario', content: 'Texto da IA.' }, { key: 'financeiro', content: 'Análise da IA.' }], { ...args, fin: B.finance(args.answers) }); },
    rewrite: async ({ section, instruction }) => `${section.content} (${instruction})`,
  };
  const { server, login } = await serve(w, planWriter);
  try {
    const bia = await login('bia@opps.test');
    const p = (await bia('POST', '/api/bizplans', { client_id: w.a })).body;
    await bia('PATCH', `/api/bizplans/${p.id}`, { answers: ANSWERS });
    let r = await bia('POST', `/api/bizplans/${p.id}/generate`, {});
    assert.equal(r.status, 202);
    assert.equal(r.body.doc_status, 'generating');
    for (let i = 0; i < 100 && r.body.doc_status === 'generating'; i++) { await new Promise(x => setTimeout(x, 10)); r = await bia('GET', `/api/bizplans/${p.id}`); }
    assert.equal(r.body.doc_status, 'ready');
    assert.equal(r.body.doc_source, 'ai');
    assert.equal(seen.meta.company, 'Padaria A');
    assert.equal(r.body.doc[0].content, 'Texto da IA.');
    const fin = r.body.doc.find(s => s.key === 'financeiro').content;
    assert.match(fin, /^Análise da IA\./);
    assert.match(fin, /### Projeção dos 12 primeiros meses/, 'as tabelas vêm da conta do sistema');
    assert.ok(r.body.doc.find(s => s.key === 'mercado').content.length > 0, 'seção que a IA não mandou fica do rascunho');
    const rw = await bia('POST', `/api/bizplans/${p.id}/rewrite`, { key: 'sumario', instruction: 'mais curto' });
    assert.equal(rw.body.content, 'Texto da IA. (mais curto)');
    assert.equal((await bia('GET', `/api/bizplans/${p.id}`)).body.doc[0].content, 'Texto da IA.', 'reescrever só sugere; salvar é com a pessoa');
    const ctx = ai.contextText({ answers: ANSWERS, unknown: ['m_size'], meta: { company: 'Padaria A' }, fin: B.finance(ANSWERS) });
    assert.match(ctx, /não sabe: ver na reunião/);
    assert.match(ctx, /Ponto de equilíbrio/);
  } finally { server.close(); }
});

test('lead pelo link público: cadastro, questionário, aviso, e virar cliente', async () => {
  const w = world();
  const { server, login, anon } = await serve(w, null);
  try {
    const lead = { name: 'Fábio', company: 'Mercado Bom', cnpj: '11.222.333/0001-81', email: 'fabio@mercado.test', phone: '(19) 99999-0000', revenue_band: 'ate-1m', consent: true };
    assert.equal((await anon('GET', '/api/public/diagnostico/info')).body.org, 'Opps Consultoria');
    assert.equal((await anon('POST', '/api/public/diagnostico', { ...lead, cnpj: '11.222.333/0001-80' })).status, 400, 'CNPJ inválido');
    assert.equal((await anon('POST', '/api/public/diagnostico', { ...lead, consent: false })).status, 400, 'sem aceite');
    assert.equal((await anon('POST', '/api/public/diagnostico', { ...lead, revenue_band: 'x' })).status, 400);
    assert.equal((await anon('POST', '/api/public/diagnostico', { ...lead, phone: '123' })).status, 400);
    const r = await anon('POST', '/api/public/diagnostico', lead);
    assert.equal(r.status, 201);
    const token = r.body.token;
    assert.equal(r.body.answers.b_name, 'Mercado Bom');
    assert.equal((await anon('GET', '/api/public/diagnostico?token=errado-errado-errado-errado')).status, 404);
    let pr = await anon('PATCH', '/api/public/diagnostico', { token, answers: { b_what: 'Mercadinho de bairro', f_revenue: 80000 }, unknown: ['f_tax'] });
    assert.equal(pr.status, 200);
    assert.equal(pr.body.answers.f_revenue, 80000);
    assert.equal(pr.body.doc, undefined, 'o lead não vê documento nem conta');
    assert.equal(pr.body.finance, undefined);
    pr = await anon('PATCH', '/api/public/diagnostico', { token, submit: true });
    assert.ok(pr.body.submitted_at);
    const admin = await login('admin@opps.test'), bia = await login('bia@opps.test'), dora = await login('dora@a.test');
    const inbox = (await admin('GET', '/api/inbox')).body.items;
    assert.ok(inbox.some(n => n.kind === 'lead' && n.title === 'Novo lead: Mercado Bom'));
    assert.ok(inbox.some(n => n.kind === 'bizplan' && /Fábio \(Mercado Bom\) concluiu/.test(n.title)));
    const leads = (await bia('GET', '/api/leads')).body;
    assert.equal(leads.length, 1);
    assert.equal(leads[0].cnpj, '11.222.333/0001-81');
    assert.equal(leads[0].revenue_band_label, 'De R$ 360 mil a R$ 1 milhão por ano');
    assert.ok(leads[0].progress > 0);
    assert.equal((await dora('GET', '/api/leads')).status, 403);
    const plan = (await bia('GET', `/api/bizplans/${leads[0].plan_id}`)).body;
    assert.equal(plan.lead.email, 'fabio@mercado.test', 'a equipe vê os dados do lead');
    assert.equal((await bia('PATCH', `/api/leads/${leads[0].id}`, { status: 'contacted', notes: 'Ligar sexta' })).body.status, 'contacted');
    assert.equal((await bia('POST', `/api/leads/${leads[0].id}/convert`, {})).status, 403, 'só o administrador transforma em cliente');
    const conv = await admin('POST', `/api/leads/${leads[0].id}/convert`, {});
    assert.equal(conv.status, 200);
    const after = (await admin('GET', `/api/bizplans/${leads[0].plan_id}`)).body;
    assert.equal(after.client_id, conv.body.client_id, 'o plano vai junto para o novo cliente');
    assert.equal(after.client_name, 'Mercado Bom');
    for (let i = 0; i < 5; i++) await anon('POST', '/api/public/diagnostico', { ...lead, email: `x${i}@m.test` });
    assert.equal((await anon('POST', '/api/public/diagnostico', { ...lead, email: 'y@m.test' })).status, 429, 'limite de cadastros por endereço');
  } finally { server.close(); }
});

test('diagnóstico automático: alertas, atenção, oportunidades e pontos fortes a partir das respostas', () => {
  const ins = B.insights({ ...ANSWERS, c_concentration: 70, p_repeat: 'Com frequência', p_model: ['Venda avulsa'], s_channels: ['Indicação'],
    k_price: 'Mais caro', r_goals: ['Faturar R$ 80 mil por mês'] }, []);
  const titles = ins.map(i => i.title);
  assert.ok(titles.includes('Dependência de poucos clientes'), 'concentração acima de 50% é alerta');
  assert.equal(ins.find(i => i.title === 'Dependência de poucos clientes').level, 'alerta');
  assert.ok(titles.includes('Espaço para receita recorrente'));
  assert.ok(titles.includes('Um só canal de vendas'));
  assert.ok(titles.includes('Preço acima da concorrência sem diferencial claro'), 'mais caro e sem diferencial respondido');
  assert.ok(titles.includes(`Precisa captar ${B.brl(40000)}`));
  const goal = ins.find(i => i.title === 'Meta de faturamento acima da projeção');
  assert.ok(goal, 'meta de R$ 80 mil contra a projeção');
  assert.match(goal.action, /crescer cerca de/);
  assert.deepEqual([...new Set(ins.map(i => i.level))], ['alerta', 'atencao', 'oportunidade', 'forte'].filter(l => ins.some(i => i.level === l)), 'alertas primeiro');
  const below = B.insights({ f_revenue: 20000, f_fixed: 15000, f_variable: 40, f_tax: 6 }, []);
  assert.equal(below[0].title, 'Faturamento abaixo do ponto de equilíbrio');
  assert.equal(B.insights({}, []).find(i => i.area === 'Finanças').title, 'Faltam dados para a conta financeira');
  const doc = B.draft(ANSWERS, []);
  assert.match(doc.find(s => s.key === 'diagnostico').content, /O que fazer:/, 'o diagnóstico entra no plano');
});

test('escrever com o Claude: o texto colado vira o plano, com as partes do sistema', async () => {
  const prompt = B.manualPrompt({ answers: ANSWERS, unknown: [], meta: { company: 'Padaria A' } });
  assert.match(prompt, /# Sumário executivo\n# O negócio/);
  assert.match(prompt, /Diagnóstico automático do sistema/);
  assert.doesNotMatch(prompt, /# Diagnóstico: alertas/, 'o diagnóstico não é pedido ao Claude');
  const pasted = 'Aqui está o plano:\n\n# 1. Sumário executivo\nA **Padaria A** vai crescer.\n\n## Plano financeiro\nA margem é boa.\n# Outra coisa\nignorar\n```';
  const parsed = B.parsePasted(pasted);
  assert.deepEqual(Object.keys(parsed), ['sumario', 'financeiro']);
  const sections = B.assemble(parsed, { answers: ANSWERS, unknown: [] });
  assert.equal(sections.length, B.DOC.length);
  assert.equal(sections[0].content, 'A **Padaria A** vai crescer.');
  assert.match(sections.find(s => s.key === 'financeiro').content, /^A margem é boa\.[\s\S]*### Projeção dos 12 primeiros meses/);
  assert.match(sections.find(s => s.key === 'diagnostico').content, /O que fazer:/);
  const w = world();
  const { server, login } = await serve(w, null);
  try {
    const bia = await login('bia@opps.test');
    const p = (await bia('POST', '/api/bizplans', { client_id: w.a })).body;
    const r = await bia('PUT', `/api/bizplans/${p.id}/doc`, { sections, note: 'Escrito no Claude', source: 'ai-paste' });
    assert.equal(r.body.doc_source, 'ai-paste');
    assert.equal(r.body.doc[0].content, 'A **Padaria A** vai crescer.');
  } finally { server.close(); }
});
