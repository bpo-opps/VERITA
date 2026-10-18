'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { open, createOrg, createUser } = require('../db');
const { createHandler } = require('../app');

let server, base, ids;

function setup() {
  const db = open(':memory:');
  const orgId = createOrg(db, 'Consultoria Teste');
  const other = createOrg(db, 'Outra Org');
  const client = name => Number(db.prepare('insert into clients (org_id, name) values (?, ?)').run(orgId, name).lastInsertRowid);
  const a = client('Cliente A');
  const b = client('Cliente B');
  const otherClient = Number(db.prepare('insert into clients (org_id, name) values (?, ?)').run(other, 'Cliente X').lastInsertRowid);
  const pw = 'senha-teste-1';
  createUser(db, { orgId, name: 'Admin', email: 'admin@t.local', password: pw, role: 'admin' });
  const member = createUser(db, { orgId, name: 'Membro', email: 'membro@t.local', password: pw, role: 'member' });
  createUser(db, { orgId, name: 'Cli A', email: 'a@t.local', password: pw, role: 'client', clientId: a });
  createUser(db, { orgId, name: 'Cli B', email: 'b@t.local', password: pw, role: 'client', clientId: b });
  createUser(db, { orgId: other, name: 'Admin X', email: 'x@t.local', password: pw, role: 'admin' });
  return { db, a, b, otherClient, member, pw };
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

test('sem login a API recusa', async () => {
  const r = await fetch(base + '/api/tasks');
  assert.equal(r.status, 401);
});

test('senha errada é recusada', async () => {
  const r = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@t.local', password: 'errada' }),
  });
  assert.equal(r.status, 401);
});

test('fluxo completo: criar, revisar, ajuste do cliente, aprovação', async () => {
  const admin = await login('admin@t.local');
  const cliA = await login('a@t.local');
  const me = await admin('GET', '/api/me');
  const stage = kind => me.body.stages.find(s => s.kind === kind).id;

  const created = await admin('POST', '/api/tasks', {
    client_id: ids.a, title: 'Diagnóstico financeiro', due_date: '2026-11-01', assignee_ids: [ids.member],
  });
  assert.equal(created.status, 201);
  const tid = created.body.id;

  await admin('POST', `/api/tasks/${tid}/comments`, { body: 'nota interna', visible_to_client: false });
  await admin('POST', `/api/tasks/${tid}/comments`, { body: 'enviado para você', visible_to_client: true });
  const internal = await admin('POST', `/api/tasks/${tid}/adjustments`, { body: 'faltou a tabela' });
  assert.equal(internal.body.stage_kind, 'adjust');

  // Cliente ainda não pode pedir ajuste nem aprovar: a tarefa não está com ele.
  assert.equal((await cliA('POST', `/api/tasks/${tid}/approve`)).status, 409);
  assert.equal((await cliA('POST', `/api/tasks/${tid}/adjustments`, { body: 'x' })).status, 409);

  await admin('PATCH', `/api/tasks/${tid}`, { stage_id: stage('client') });
  const seen = await cliA('GET', `/api/tasks/${tid}`);
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.comments.map(c => c.body), ['enviado para você']);
  assert.equal(seen.body.adjustments.length, 0, 'ajuste interno não aparece para o cliente');

  const adj = await cliA('POST', `/api/tasks/${tid}/adjustments`, { body: 'trocar o período' });
  assert.equal(adj.status, 201);
  assert.equal(adj.body.stage_kind, 'adjust');

  await admin('PATCH', `/api/tasks/${tid}`, { stage_id: stage('client') });
  const ok = await cliA('POST', `/api/tasks/${tid}/approve`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.stage_kind, 'done');
  assert.ok(ok.body.completed_at);

  const report = await admin('GET', '/api/report/adjustments');
  const rowA = report.body.find(r => r.id === ids.a);
  assert.equal(rowA.internal, 1);
  assert.equal(rowA.client, 1);
});

test('cliente B não vê nem mexe nas tarefas do cliente A', async () => {
  const admin = await login('admin@t.local');
  const cliB = await login('b@t.local');
  const { body } = await admin('POST', '/api/tasks', { client_id: ids.a, title: 'Só do A' });
  assert.equal((await cliB('GET', `/api/tasks/${body.id}`)).status, 404);
  assert.equal((await cliB('POST', `/api/tasks/${body.id}/comments`, { body: 'oi' })).status, 404);
  const list = await cliB('GET', '/api/tasks?client_id=' + ids.a);
  assert.ok(list.body.every(t => t.client_id === ids.b));
  assert.equal((await cliB('GET', '/api/users')).status, 403);
  assert.equal((await cliB('POST', '/api/tasks', { client_id: ids.b, title: 'x' })).status, 403);
  assert.equal((await cliB('PATCH', `/api/tasks/${body.id}`, { title: 'x' })).status, 403);
});

test('outra organização não enxerga nada desta', async () => {
  const admin = await login('admin@t.local');
  const x = await login('x@t.local');
  const { body } = await admin('POST', '/api/tasks', { client_id: ids.a, title: 'Interna' });
  assert.equal((await x('GET', `/api/tasks/${body.id}`)).status, 404);
  assert.equal((await x('GET', '/api/tasks')).body.length, 0);
  assert.equal((await admin('POST', '/api/tasks', { client_id: ids.otherClient, title: 'x' })).status, 400);
});

test('membro não administra equipe nem apaga tarefa', async () => {
  const member = await login('membro@t.local');
  const admin = await login('admin@t.local');
  const { body } = await admin('POST', '/api/tasks', { client_id: ids.a, title: 'Apagar?' });
  assert.equal((await member('DELETE', `/api/tasks/${body.id}`)).status, 403);
  assert.equal((await member('POST', '/api/users', { name: 'n', email: 'n@t.local', password: '12345678', role: 'admin' })).status, 403);
  assert.equal((await admin('DELETE', `/api/tasks/${body.id}`)).status, 200);
});

test('modelo cria tarefa com checklist', async () => {
  const admin = await login('admin@t.local');
  const tpl = await admin('POST', '/api/templates', { name: 'Fechamento', title: 'Fechamento do mês', checklist: ['Bancos', 'Notas'] });
  const t = await admin('POST', '/api/tasks', { client_id: ids.a, template_id: tpl.body.id });
  assert.equal(t.status, 201);
  const d = await admin('GET', `/api/tasks/${t.body.id}`);
  assert.equal(d.body.title, 'Fechamento do mês');
  assert.deepEqual(d.body.checklist.map(i => i.text), ['Bancos', 'Notas']);
  const item = d.body.checklist[0].id;
  const after = await admin('PATCH', `/api/checklist/${item}`, { done: true });
  assert.equal(after.body.checklist[0].done, 1);
});

test('validação: data, campos e origem', async () => {
  const admin = await login('admin@t.local');
  assert.equal((await admin('POST', '/api/tasks', { client_id: ids.a, title: 'x', due_date: '01/11/2026' })).status, 400);
  assert.equal((await admin('POST', '/api/tasks', { client_id: ids.a })).status, 400);
  assert.equal((await admin('POST', '/api/tasks', { client_id: ids.a, title: 'x', assignee_ids: [9999] })).status, 400);
  const r = await fetch(base + '/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://site-malicioso.example' },
    body: '{}',
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
