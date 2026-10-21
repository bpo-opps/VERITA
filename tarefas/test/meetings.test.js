'use strict';
// Reuniões: ata em PDF -> leitura (aqui uma IA falsa) -> triagem -> OK vira tarefa.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { open, createOrg, createUser } = require('../db');
const { createHandler } = require('../app');
const meetings = require('../meetings');

const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n% ata de teste\n').toString('base64');

function world() {
  const db = open(':memory:');
  const orgId = createOrg(db, 'Opps Consultoria');
  const a = Number(db.prepare('insert into clients (org_id, name) values (?, ?)').run(orgId, 'Cliente A').lastInsertRowid);
  const pw = 'senha-teste-1';
  const admin = createUser(db, { orgId, name: 'Ana Admin', email: 'admin@opps.test', password: pw, role: 'admin' });
  const bia = createUser(db, { orgId, name: 'Bia Equipe', email: 'bia@opps.test', password: pw, role: 'member' });
  const caio = createUser(db, { orgId, name: 'Caio Equipe', email: 'caio@opps.test', password: pw, role: 'member' });
  const dora = createUser(db, { orgId, name: 'Dora Cliente', email: 'dora@clientea.test', password: pw, role: 'client', clientId: a });
  db.prepare('insert into user_clients (user_id, client_id) values (?, ?), (?, ?)').run(bia, a, caio, a);
  return { db, a, admin, bia, caio, dora, pw };
}

async function serve(w, extractor) {
  const server = http.createServer(createHandler(w.db, { extractor }));
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async email => {
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: w.pw }) });
    const cookie = r.headers.get('set-cookie').split(';')[0];
    return async (method, p, body) => {
      const res = await fetch(base + p, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json() };
    };
  };
  return { server, login };
}

async function settled(as, id) {
  for (let i = 0; i < 100; i++) {
    const m = (await as('GET', `/api/meetings/${id}`)).body;
    if (m.status !== 'processing') return m;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('a leitura não terminou');
}

test('ata lida pela IA vira sugestões; o OK cria a tarefa e o cliente passa a ver', async () => {
  const w = world();
  let seen;
  const extractor = async args => {
    seen = args;
    return {
      summary: 'Reunião de fechamento.',
      tasks: [
        { title: 'Enviar relatório', description: 'Relatório do mês', kind: 'external', client_id: w.a, responsible_ids: [w.bia, w.dora, 999],
          client_responsible: '', due_date: '2026-10-23', priority: 'high', checklist: ['Conferir números', ''], quote: 'Bia envia o relatório até sexta' },
        { title: 'Mandar extratos', description: '', kind: 'external', client_id: 0, responsible_ids: [], client_responsible: 'Dora',
          due_date: 'sexta', priority: 'urgente', checklist: [], quote: 'Dora manda os extratos' },
      ],
    };
  };
  const { server, login } = await serve(w, extractor);
  try {
    const bia = await login('bia@opps.test');
    const r = await bia('POST', '/api/meetings', { title: 'Fechamento', meeting_date: '2026-10-19', client_id: w.a,
      attendee_ids: [w.bia, w.dora], other_attendees: 'Contador externo', pdf: PDF, pdf_name: 'ata.pdf' });
    assert.equal(r.status, 201);
    const m = await settled(bia, r.body.id);
    assert.equal(m.status, 'ready');
    assert.equal(m.summary, 'Reunião de fechamento.');
    assert.equal(seen.attendees.length, 2, 'a IA recebe só quem estava presente');
    assert.equal(Buffer.from(seen.pdf).subarray(0, 5).toString(), '%PDF-');
    const [i1, i2] = m.items;
    assert.deepEqual(i1.assignee_ids, [w.bia, w.dora], 'responsáveis só entre os presentes (equipe e cliente da empresa)');
    assert.deepEqual(i1.checklist, ['Conferir números']);
    assert.equal(i1.due_date, '2026-10-23');
    assert.equal(i2.client_id, w.a, 'empresa inválida cai na empresa da reunião');
    assert.equal(i2.due_date, null, 'prazo que não é data vira vazio');
    assert.equal(i2.priority, 'normal');
    assert.equal(i2.client_responsible, 'Dora');

    // Nada vai para o quadro antes do OK.
    assert.equal((await bia('GET', '/api/tasks')).body.length, 0);
    const dora = await login('dora@clientea.test');
    assert.equal((await dora('GET', '/api/meetings')).status, 403, 'cliente não vê a triagem');

    const ed = await bia('PATCH', `/api/meeting-items/${i2.id}`, { title: 'Receber extratos da Dora', assignee_ids: [w.caio] });
    assert.equal(ed.body.title, 'Receber extratos da Dora');
    assert.equal((await bia('PATCH', `/api/meeting-items/${i2.id}`, { assignee_ids: [w.caio, w.dora] })).status, 200, 'pessoa do cliente pode ser responsável');
    assert.equal((await bia('PATCH', `/api/meeting-items/${i2.id}`, { kind: 'internal', assignee_ids: [w.dora] })).status, 400, 'em interna, não');

    const ok = await bia('POST', `/api/meeting-items/${i1.id}/approve`);
    assert.equal(ok.status, 200);
    const task = (await bia('GET', `/api/tasks/${ok.body.task_id}`)).body;
    assert.equal(task.title, 'Enviar relatório');
    assert.match(task.description, /Da reunião "Fechamento" de 19\/10\/2026/);
    assert.equal((await bia('POST', `/api/meeting-items/${i1.id}/approve`)).status, 409, 'não lança duas vezes');
    assert.ok((await dora('GET', '/api/tasks')).body.some(t => t.id === ok.body.task_id), 'cliente vê a tarefa externa lançada');

    await bia('POST', `/api/meeting-items/${i2.id}/discard`);
    const list = (await bia('GET', '/api/meetings')).body;
    assert.deepEqual([list[0].pending, list[0].approved, list[0].discarded], [0, 1, 1]);
    await bia('POST', `/api/meeting-items/${i2.id}/restore`);

    // Ler de novo troca só as sugestões pendentes; o que já foi lançado fica.
    await bia('POST', `/api/meetings/${r.body.id}/process`);
    const again = await settled(bia, r.body.id);
    assert.equal(again.items.filter(i => i.status === 'approved').length, 1);
    assert.equal(again.items.filter(i => i.status === 'pending').length, 2);

    assert.equal((await bia('GET', `/api/meetings/${r.body.id}/pdf`)).body.name, 'ata.pdf');
    const caio = await login('caio@opps.test');
    assert.equal((await caio('DELETE', `/api/meetings/${r.body.id}`)).status, 403, 'só quem lançou ou o administrador apaga');
    assert.equal((await bia('DELETE', `/api/meetings/${r.body.id}`)).status, 200);
    assert.equal((await bia('GET', `/api/tasks/${ok.body.task_id}`)).status, 200, 'a tarefa lançada continua');
  } finally { server.close(); }
});

test('sem IA ou com falha: a reunião fica com o motivo e dá para lançar à mão', async () => {
  const w = world();
  const { server, login } = await serve(w, null);
  try {
    const admin = await login('admin@opps.test');
    assert.equal((await admin('POST', '/api/meetings', { title: 'X', meeting_date: '2026-10-19', attendee_ids: [w.bia], pdf: 'data:application/pdf;base64,' + Buffer.from('oi').toString('base64') })).status, 400, 'não é PDF');
    assert.equal((await admin('POST', '/api/meetings', { title: 'X', meeting_date: '2026-10-19', attendee_ids: [], pdf: PDF })).status, 400, 'sem participantes');
    const r = await admin('POST', '/api/meetings', { title: 'Sem IA', meeting_date: '2026-10-19', attendee_ids: [w.bia], pdf: PDF });
    const m = await settled(admin, r.body.id);
    assert.equal(m.status, 'error');
    assert.match(m.error, /ANTHROPIC_API_KEY/);
    const it = (await admin('POST', `/api/meetings/${r.body.id}/items`, { title: 'Tarefa à mão' })).body;
    assert.equal(it.kind, 'internal');
    assert.equal((await admin('POST', `/api/meeting-items/${it.id}/approve`)).status, 200);
  } finally { server.close(); }

  const w2 = world();
  const busy = Object.assign(new Error('rate limited'), { status: 429 });
  const s2 = await serve(w2, async () => { throw busy; });
  try {
    const admin = await s2.login('admin@opps.test');
    const r = await admin('POST', '/api/meetings', { title: 'Falha', meeting_date: '2026-10-19', attendee_ids: [w2.bia], pdf: PDF });
    const m = await settled(admin, r.body.id);
    assert.match(m.error, /ocupada/);
  } finally { s2.server.close(); }
});

test('reinício no meio da leitura deixa a reunião pronta para ler de novo', () => {
  const w = world();
  w.db.prepare("insert into meetings (org_id, title, meeting_date, status) values (1, 'R', '2026-10-19', 'processing')").run();
  createHandler(w.db, {});
  assert.equal(w.db.prepare('select status from meetings').get().status, 'error');
});

test('o esquema pedido à IA é aceito como saída estruturada', () => {
  const walk = s => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(walk);
    }
    if (s.type === 'array') walk(s.items);
  };
  walk(meetings.SCHEMA);
  assert.equal(meetings.config({}), null, 'sem chave, sem IA');
});

test('pedido à API da Anthropic: PDF, participantes, saída estruturada e fallback', async () => {
  let req;
  const answer = { summary: 'Resumo', tasks: [] };
  const sse = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(answer) } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } }],
    ['message_stop', { type: 'message_stop' }],
  ].map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
  const fetch = async (url, init) => {
    req = { url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) };
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const out = await meetings.extract({ apiKey: 'k', model: meetings.MODEL, fetch }, {
    pdf: Buffer.from('%PDF-1.4'), meeting: { title: 'R', meeting_date: '2026-10-19', client_id: 1 },
    attendees: [{ id: 2, name: 'Bia', role: 'member' }, { id: 5, name: 'Dora', role: 'client', client_id: 1 }], others: '', clients: [{ id: 1, name: 'A' }],
  });
  assert.deepEqual(out, answer);
  assert.match(req.url, /\/v1\/messages/);
  assert.match(req.headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  assert.equal(req.body.fallbacks, 'default');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.stream, true);
  const [doc, text] = req.body.messages[0].content;
  assert.equal(doc.source.media_type, 'application/pdf');
  assert.match(text.text, /"nome": "Bia"/);
});
