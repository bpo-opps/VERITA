'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { open, createOrg, createUser } = require('../db');
const { createHandler } = require('../app');
const S = require('../shared');

let server, base, ids;
const day = n => S.addDays(S.today(), n);

function setup() {
  const db = open(':memory:');
  const orgId = createOrg(db, 'Consultoria Teste');
  const other = createOrg(db, 'Outra Org');
  const client = (org, name) => Number(db.prepare('insert into clients (org_id, name) values (?, ?)').run(org, name).lastInsertRowid);
  const a = client(orgId, 'Cliente A');
  const b = client(orgId, 'Cliente B');
  const otherClient = client(other, 'Cliente X');
  const pw = 'senha-teste-1';
  const admin = createUser(db, { orgId, name: 'Admin', email: 'admin@t.local', password: pw, role: 'admin' });
  const member = createUser(db, { orgId, name: 'Membro', email: 'membro@t.local', password: pw, role: 'member' });
  const member2 = createUser(db, { orgId, name: 'Membro Dois', email: 'membro2@t.local', password: pw, role: 'member' });
  createUser(db, { orgId, name: 'Cli A', email: 'a@t.local', password: pw, role: 'client', clientId: a });
  createUser(db, { orgId, name: 'Cli B', email: 'b@t.local', password: pw, role: 'client', clientId: b });
  createUser(db, { orgId: other, name: 'Admin X', email: 'x@t.local', password: pw, role: 'admin' });
  return { db, a, b, otherClient, admin, member, member2, pw };
}

async function login(email) {
  const r = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: ids.pw }),
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
}

test.before(async () => {
  ids = setup();
  server = http.createServer(createHandler(ids.db));
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('regras compartilhadas: meses, colunas, alertas, %', () => {
  assert.equal(S.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(S.addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(S.nextDate('2026-03-15', 'quarterly'), '2026-06-15');
  assert.equal(S.nextDate('2026-03-15', 'four_monthly'), '2026-07-15');
  assert.equal(S.nextDate('2026-12-10', 'yearly'), '2027-12-10');
  assert.equal(S.nextDate('2026-03-15', 'custom', 10), '2026-03-25');
  const now = '2026-10-18';
  assert.equal(S.column({ status: 'doing', due_date: '2026-10-17' }, now), 'overdue');
  assert.equal(S.column({ status: 'doing', due_date: '2026-10-18' }, now), 'doing');
  assert.equal(S.column({ status: 'done', due_date: '2026-10-17', completed_on: '2026-10-17' }, now), 'done_on_time');
  assert.equal(S.column({ status: 'done', due_date: '2026-10-17', completed_on: '2026-10-18' }, now), 'done_late');
  assert.equal(S.column({ status: 'done', due_date: null, completed_on: '2026-10-18' }, now), 'done_on_time');
  assert.equal(S.alert({ status: 'todo', due_date: '2026-10-21', alerts: [3] }, now).days, 3);
  assert.equal(S.alert({ status: 'todo', due_date: '2026-10-22', alerts: [3] }, now), null);
  assert.equal(S.alert({ status: 'todo', due_date: '2026-10-16', alerts: [] }, now).kind, 'overdue');
  assert.equal(S.progress({ status: 'doing', progress: 10 }, 4, 1), 25);
  assert.equal(S.progress({ status: 'doing', progress: 10 }, 0, 0), 10);
});

test('sem login a API recusa; senha errada é recusada', async () => {
  assert.equal((await fetch(base + '/api/tasks')).status, 401);
  const r = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@t.local', password: 'errada' }),
  });
  assert.equal(r.status, 401);
});

test('externa precisa de cliente; interna pode ser da própria consultoria', async () => {
  const admin = await login('admin@t.local');
  assert.equal((await admin('POST', '/api/tasks', { kind: 'external', title: 'x' })).status, 400);
  assert.equal((await admin('POST', '/api/tasks', { title: 'x' })).status, 400, 'tipo é obrigatório');
  const own = await admin('POST', '/api/tasks', { kind: 'internal', title: 'Planejamento interno' });
  assert.equal(own.status, 201);
  const d = await admin('GET', `/api/tasks/${own.body.id}`);
  assert.equal(d.body.client_id, null);
  assert.equal((await admin('GET', '/api/tasks?client_id=org')).body.some(t => t.id === own.body.id), true);
});

test('interna: cliente nunca vê; equipe só se criou ou é responsável; admin vê', async () => {
  const admin = await login('admin@t.local');
  const member = await login('membro@t.local');
  const member2 = await login('membro2@t.local');
  const cliA = await login('a@t.local');
  const t = (await admin('POST', '/api/tasks', { kind: 'internal', client_id: ids.a, title: 'Proposta interna do A', assignee_ids: [ids.member] })).body.id;
  assert.equal((await member('GET', `/api/tasks/${t}`)).status, 200, 'responsável vê');
  assert.equal((await member2('GET', `/api/tasks/${t}`)).status, 404, 'outro da equipe não vê');
  assert.equal((await member2('GET', '/api/tasks')).body.some(x => x.id === t), false);
  assert.equal((await cliA('GET', `/api/tasks/${t}`)).status, 404, 'cliente relacionado não vê');
  assert.equal((await cliA('GET', '/api/tasks')).body.some(x => x.id === t), false);
  const own = (await member2('POST', '/api/tasks', { kind: 'internal', title: 'Minha interna' })).body.id;
  assert.equal((await member2('GET', `/api/tasks/${own}`)).status, 200, 'quem criou vê');
  assert.equal((await member('GET', `/api/tasks/${own}`)).status, 404);
  assert.equal((await admin('GET', `/api/tasks/${own}`)).status, 200, 'admin vê');
  // Virar externa torna visível para o cliente.
  await admin('PATCH', `/api/tasks/${t}`, { kind: 'external' });
  assert.equal((await cliA('GET', `/api/tasks/${t}`)).status, 200);
});

test('comentário em tarefa interna nunca fica visível ao cliente', async () => {
  const admin = await login('admin@t.local');
  const t = (await admin('POST', '/api/tasks', { kind: 'internal', client_id: ids.a, title: 'Interna com comentário' })).body.id;
  await admin('POST', `/api/tasks/${t}/comments`, { body: 'segredo', visible_to_client: true });
  await admin('PATCH', `/api/tasks/${t}`, { kind: 'external' });
  const cliA = await login('a@t.local');
  assert.equal((await cliA('GET', `/api/tasks/${t}`)).body.comments.length, 0);
});

test('colunas: atrasada automática, concluída no prazo e fora do prazo', async () => {
  const admin = await login('admin@t.local');
  const mk = async due => (await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'c', start_date: day(-10), due_date: due })).body.id;
  const late = await mk(day(-1));
  let d = await admin('GET', `/api/tasks/${late}`);
  assert.equal(d.body.column, 'overdue');
  await admin('PATCH', `/api/tasks/${late}`, { status: 'doing' });
  assert.equal((await admin('GET', `/api/tasks/${late}`)).body.column, 'overdue', 'continua atrasada');
  d = await admin('POST', `/api/tasks/${late}/complete`, { completed_on: day(0) });
  assert.equal(d.body.column, 'done_late');
  const ok = await mk(day(2));
  d = await admin('POST', `/api/tasks/${ok}/complete`, { completed_on: day(-1) });
  assert.equal(d.body.column, 'done_on_time');
  assert.equal(d.body.progress, 100);
  assert.equal((await admin('POST', `/api/tasks/${ok}/complete`, { completed_on: day(1) })).status, 400, 'término no futuro');
  // Reabrir limpa o término.
  d = await admin('PATCH', `/api/tasks/${ok}`, { status: 'review' });
  assert.equal(d.body.completed_on, null);
  assert.equal(d.body.column, 'review');
  assert.equal((await admin('PATCH', `/api/tasks/${ok}`, { status: 'done' })).status, 400, 'concluir só pelo botão, com data');
  assert.equal((await admin('PATCH', `/api/tasks/${ok}`, { start_date: day(5), due_date: day(1) })).status, 400, 'início depois do prazo');
});

test('% de execução: manual sem checklist, automático com checklist', async () => {
  const admin = await login('admin@t.local');
  const t = (await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: '%' })).body.id;
  let d = await admin('PATCH', `/api/tasks/${t}`, { status: 'doing', progress: 35 });
  assert.equal(d.body.progress, 35);
  assert.equal((await admin('PATCH', `/api/tasks/${t}`, { progress: 120 })).status, 400);
  await admin('POST', `/api/tasks/${t}/checklist`, { text: 'um' });
  d = await admin('POST', `/api/tasks/${t}/checklist`, { text: 'dois' });
  assert.equal(d.body.progress, 0);
  assert.equal(d.body.progress_from_checklist, true);
  d = await admin('PATCH', `/api/checklist/${d.body.checklist[0].id}`, { done: true });
  assert.equal(d.body.progress, 50);
  assert.equal((await admin('PATCH', `/api/tasks/${t}`, { progress: 80 })).status, 409);
});

test('recorrência: concluir cria a próxima com datas avançadas e checklist zerado', async () => {
  const admin = await login('admin@t.local');
  const t = (await admin('POST', '/api/tasks', {
    kind: 'external', client_id: ids.a, title: 'Fechamento', start_date: '2026-01-25', due_date: '2026-01-31',
    recurrence: 'monthly', alerts: [0, 3], assignee_ids: [ids.member],
  })).body.id;
  const ck = await admin('POST', `/api/tasks/${t}/checklist`, { text: 'Conciliar' });
  await admin('PATCH', `/api/checklist/${ck.body.checklist[0].id}`, { done: true });
  const done = await admin('POST', `/api/tasks/${t}/complete`, { completed_on: '2026-01-30' });
  const next = (await admin('GET', `/api/tasks/${done.body.created_next_id}`)).body;
  assert.equal(next.start_date, '2026-02-25');
  assert.equal(next.due_date, '2026-02-28');
  assert.equal(next.status, 'todo');
  assert.deepEqual(next.alerts, [0, 3]);
  assert.deepEqual(next.assignees.map(a => a.id), [ids.member]);
  assert.deepEqual(next.checklist.map(i => [i.text, i.done]), [['Conciliar', 0]]);
  // Reabrir e concluir de novo não duplica a próxima.
  await admin('PATCH', `/api/tasks/${t}`, { status: 'doing' });
  const again = await admin('POST', `/api/tasks/${t}/complete`, { completed_on: '2026-01-31' });
  assert.equal(again.body.created_next_id, null);
  assert.equal((await admin('POST', '/api/tasks', { kind: 'internal', title: 'x', recurrence: 'custom' })).status, 400, 'livre exige N dias');
  const custom = await admin('POST', '/api/tasks', { kind: 'internal', title: 'x', due_date: '2026-03-01', recurrence: 'custom', recurrence_every: 10 });
  const n = await admin('POST', `/api/tasks/${custom.body.id}/complete`, { completed_on: '2026-03-01' });
  assert.equal((await admin('GET', `/api/tasks/${n.body.created_next_id}`)).body.due_date, '2026-03-11');
});

test('alertas: só os escolhidos, mais as atrasadas', async () => {
  const admin = await login('admin@t.local');
  assert.equal((await admin('POST', '/api/tasks', { kind: 'internal', title: 'x', alerts: [2] })).status, 400, 'só 0, 1, 3 ou 7');
  const soon = (await admin('POST', '/api/tasks', { kind: 'internal', title: 'Vence em 3', due_date: day(3), alerts: [3] })).body.id;
  const quiet = (await admin('POST', '/api/tasks', { kind: 'internal', title: 'Sem aviso ainda', due_date: day(3), alerts: [1] })).body.id;
  const list = (await admin('GET', '/api/alerts')).body;
  assert.equal(list.find(t => t.id === soon).alert.days, 3);
  assert.equal(list.some(t => t.id === quiet), false);
  assert.ok(list.some(t => t.alert.kind === 'overdue'));
});

test('arquivar tira das listas; dá para ver e desarquivar', async () => {
  const admin = await login('admin@t.local');
  const cliA = await login('a@t.local');
  const t = (await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'Arquivar' })).body.id;
  await admin('POST', `/api/tasks/${t}/archive`, { archived: true });
  assert.equal((await admin('GET', '/api/tasks')).body.some(x => x.id === t), false);
  assert.equal((await admin('GET', '/api/tasks?archived=1')).body.some(x => x.id === t), true);
  assert.equal((await cliA('GET', `/api/tasks/${t}`)).status, 404, 'cliente não vê arquivada');
  await admin('POST', `/api/tasks/${t}/archive`, { archived: false });
  assert.equal((await admin('GET', '/api/tasks')).body.some(x => x.id === t), true);
});

test('fluxo do cliente: revisão, pedido de ajuste e aprovação', async () => {
  const admin = await login('admin@t.local');
  const cliA = await login('a@t.local');
  const t = (await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'Diagnóstico', due_date: day(5) })).body.id;
  await admin('POST', `/api/tasks/${t}/comments`, { body: 'nota interna', visible_to_client: false });
  await admin('POST', `/api/tasks/${t}/comments`, { body: 'enviado para você', visible_to_client: true });
  assert.equal((await cliA('POST', `/api/tasks/${t}/approve`)).status, 409, 'ainda não está em revisão');
  await admin('PATCH', `/api/tasks/${t}`, { status: 'review' });
  const seen = await cliA('GET', `/api/tasks/${t}`);
  assert.deepEqual(seen.body.comments.map(c => c.body), ['enviado para você']);
  const adj = await cliA('POST', `/api/tasks/${t}/adjustments`, { body: 'trocar o período' });
  assert.equal(adj.body.status, 'doing');
  await admin('PATCH', `/api/tasks/${t}`, { status: 'review' });
  const ok = await cliA('POST', `/api/tasks/${t}/approve`);
  assert.equal(ok.body.column, 'done_on_time');
  const report = (await admin('GET', '/api/report/adjustments')).body.find(r => r.id === ids.a);
  assert.ok(report.client >= 1 && report.on_time >= 1);
});

test('cliente B não vê nem mexe nas tarefas do cliente A', async () => {
  const admin = await login('admin@t.local');
  const cliB = await login('b@t.local');
  const { body } = await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'Só do A' });
  assert.equal((await cliB('GET', `/api/tasks/${body.id}`)).status, 404);
  assert.equal((await cliB('POST', `/api/tasks/${body.id}/comments`, { body: 'oi' })).status, 404);
  assert.ok((await cliB('GET', '/api/tasks?client_id=' + ids.a)).body.every(t => t.client_id === ids.b));
  assert.equal((await cliB('GET', '/api/users')).status, 403);
  assert.equal((await cliB('POST', '/api/tasks', { kind: 'external', client_id: ids.b, title: 'x' })).status, 403);
  assert.equal((await cliB('PATCH', `/api/tasks/${body.id}`, { title: 'x' })).status, 403);
});

test('outra organização não enxerga nada desta', async () => {
  const admin = await login('admin@t.local');
  const x = await login('x@t.local');
  const { body } = await admin('POST', '/api/tasks', { kind: 'internal', title: 'Interna' });
  assert.equal((await x('GET', `/api/tasks/${body.id}`)).status, 404);
  assert.equal((await x('GET', '/api/tasks')).body.length, 0);
  assert.equal((await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.otherClient, title: 'x' })).status, 400);
});

test('membro não administra equipe nem apaga tarefa', async () => {
  const member = await login('membro@t.local');
  const admin = await login('admin@t.local');
  const { body } = await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'Apagar?' });
  assert.equal((await member('DELETE', `/api/tasks/${body.id}`)).status, 403);
  assert.equal((await member('POST', '/api/users', { name: 'n', email: 'n@t.local', password: '12345678', role: 'admin' })).status, 403);
  assert.equal((await admin('DELETE', `/api/tasks/${body.id}`)).status, 200);
});

test('logo: aceita imagem, recusa outra coisa', async () => {
  const admin = await login('admin@t.local');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal((await admin('PATCH', `/api/clients/${ids.a}`, { logo: png })).status, 200);
  assert.equal((await admin('PATCH', `/api/clients/${ids.a}`, { logo: 'data:text/html;base64,PHNjcmlwdD4=' })).status, 400);
  assert.equal((await admin('PATCH', '/api/org', { logo: 'javascript:alert(1)' })).status, 400);
  assert.equal((await admin('GET', '/api/clients')).body.find(c => c.id === ids.a).logo, png);
});

test('modelo cria tarefa com checklist', async () => {
  const admin = await login('admin@t.local');
  const tpl = await admin('POST', '/api/templates', { name: 'Fechamento', title: 'Fechamento do mês', checklist: ['Bancos', 'Notas'] });
  const t = await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, template_id: tpl.body.id });
  const d = await admin('GET', `/api/tasks/${t.body.id}`);
  assert.equal(d.body.title, 'Fechamento do mês');
  assert.deepEqual(d.body.checklist.map(i => i.text), ['Bancos', 'Notas']);
});

test('validação e origem', async () => {
  const admin = await login('admin@t.local');
  assert.equal((await admin('POST', '/api/tasks', { kind: 'internal', title: 'x', due_date: '01/11/2026' })).status, 400);
  assert.equal((await admin('POST', '/api/tasks', { kind: 'internal', title: 'x', assignee_ids: [9999] })).status, 400);
  const r = await fetch(base + '/api/tasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://site-malicioso.example' }, body: '{}',
  });
  assert.equal(r.status, 403);
});

test('usuário desativado perde a sessão', async () => {
  const admin = await login('admin@t.local');
  const users = await admin('GET', '/api/users');
  const b = users.body.find(u => u.email === 'b@t.local');
  const cliB = await login('b@t.local');
  await admin('PATCH', `/api/users/${b.id}`, { active: false });
  assert.equal((await cliB('GET', '/api/tasks')).status, 401);
});
