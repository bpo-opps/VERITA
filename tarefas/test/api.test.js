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
  // O membro acompanha os dois clientes (pode ser responsável nas tarefas deles); o membro 2, nenhum.
  db.prepare('insert into user_clients (user_id, client_id) values (?, ?), (?, ?)').run(member, a, member, b);
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
  assert.equal(S.column({ status: 'cancelled', due_date: '2026-10-01' }, now), 'cancelled', 'cancelada não vira atrasada');
  assert.deepEqual(S.COLUMNS.map(c => c.key), ['todo', 'doing', 'review', 'overdue', 'done_on_time', 'done_late', 'cancelled']);
  assert.equal(S.alert({ status: 'cancelled', due_date: '2026-10-01', alerts: [1] }, now), null);
  const admin = { id: 1, role: 'admin' }, member = { id: 2, role: 'member' };
  const own = { kind: 'internal', created_by: 1, client_id: null };
  assert.equal(S.canSee(admin, own, []), true);
  assert.equal(S.canSee({ id: 9, role: 'admin' }, own, []), false, 'interna de um admin: outro admin não vê');
  assert.equal(S.canSee(member, own, [2]), true, 'responsável vê');
  assert.equal(S.canSee({ id: 5, role: 'client', client_id: 3 }, { kind: 'internal', client_id: 3, client_visible: 1 }, []), true);
  assert.equal(S.canSee({ id: 5, role: 'client', client_id: 3 }, { kind: 'internal', client_id: 3, client_visible: 0 }, []), false);
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

test('interna: só quem criou e os responsáveis; cliente só se marcada como visível', async () => {
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
  assert.equal((await admin('GET', `/api/tasks/${own}`)).status, 404, 'admin não vê interna alheia');
  const adminOnly = (await admin('POST', '/api/tasks', { kind: 'internal', title: 'Só do admin' })).body.id;
  assert.equal((await member('GET', `/api/tasks/${adminOnly}`)).status, 404, 'interna só do admin: só ele vê');
  await admin('PATCH', `/api/tasks/${adminOnly}`, { assignee_ids: [ids.member] });
  assert.equal((await member('GET', `/api/tasks/${adminOnly}`)).status, 200, 'virou responsável, passa a ver');
  // Interna ligada ao cliente, marcada como visível: o cliente vê.
  const shown = await admin('PATCH', `/api/tasks/${t}`, { client_visible: true });
  assert.equal(shown.body.client_visible, true);
  assert.equal((await cliA('GET', `/api/tasks/${t}`)).status, 200);
  assert.ok((await cliA('GET', '/api/tasks')).body.some(x => x.id === t));
  assert.equal((await member2('GET', `/api/tasks/${t}`)).status, 404, 'visível ao cliente não abre para o resto da equipe');
  // Sem cliente, a marca não vale.
  const noClient = await admin('PATCH', `/api/tasks/${t}`, { client_id: null });
  assert.equal(noClient.body.client_visible, false);
  // Virar externa torna visível para o cliente; da equipe, só para quem acompanha o cliente.
  await admin('PATCH', `/api/tasks/${t}`, { kind: 'external', client_id: ids.a });
  assert.equal((await cliA('GET', `/api/tasks/${t}`)).status, 200);
  assert.equal((await member2('GET', `/api/tasks/${t}`)).status, 404);
});

test('externa: administrador, responsáveis e a equipe que acompanha o cliente; cliente pode ser responsável', async () => {
  const admin = await login('admin@t.local');
  const member = await login('membro@t.local');
  const member2 = await login('membro2@t.local');
  const cliA = await login('a@t.local');
  const cliB = await login('b@t.local');
  const cliAId = ids.db.prepare("select id from users where email = 'a@t.local'").get().id;
  const cliBId = ids.db.prepare("select id from users where email = 'b@t.local'").get().id;
  const t = (await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'Externa do A', assignee_ids: [ids.member, cliAId] })).body.id;
  let d = (await admin('GET', `/api/tasks/${t}`)).body;
  assert.deepEqual(d.assignees.map(a => a.role).sort(), ['client', 'member'], 'pessoa do cliente como responsável');
  assert.equal((await member('GET', `/api/tasks/${t}`)).status, 200, 'responsável vê');
  assert.equal((await member2('GET', `/api/tasks/${t}`)).status, 404, 'quem não é responsável nem acompanha o cliente não vê');
  assert.equal((await member2('GET', '/api/tasks')).body.some(x => x.id === t), false);
  assert.equal((await cliA('GET', '/api/tasks?mine=1')).body.some(x => x.id === t), true, 'cliente vê as dele');
  // Administrador liga o membro 2 ao cliente A: ele passa a ver as externas do A.
  assert.equal((await member('PUT', `/api/clients/${ids.a}/team`, { user_ids: [ids.member2] })).status, 403);
  assert.equal((await admin('PUT', `/api/clients/${ids.a}/team`, { user_ids: [cliAId] })).status, 400, 'só equipe');
  assert.equal((await admin('PUT', `/api/clients/${ids.a}/team`, { user_ids: [ids.member, ids.member2] })).status, 200);
  assert.equal((await member2('GET', `/api/tasks/${t}`)).status, 200, 'acompanha o cliente, vê');
  assert.deepEqual((await admin('GET', '/api/clients')).body.find(c => c.id === ids.a).team.sort(), [ids.member, ids.member2].sort());
  assert.deepEqual((await admin('GET', '/api/users')).body.find(u => u.id === ids.member2).client_ids, [ids.a]);
  // Pessoa de outro cliente não pode ser responsável; virar interna sem visibilidade tira o cliente.
  assert.equal((await admin('PATCH', `/api/tasks/${t}`, { assignee_ids: [cliBId] })).status, 400);
  d = (await admin('PATCH', `/api/tasks/${t}`, { kind: 'internal' })).body;
  assert.deepEqual(d.assignees.map(a => a.id), [ids.member]);
  assert.equal((await cliB('GET', `/api/tasks/${t}`)).status, 404);
  await admin('PUT', `/api/clients/${ids.a}/team`, { user_ids: [ids.member] });
});

test('quadro: ordem por prazo e prioridade; colunas criadas e reordenadas', async () => {
  const admin = await login('admin@t.local');
  const member = await login('membro@t.local');
  const mk = b => admin('POST', '/api/tasks', { kind: 'internal', title: b.title, due_date: b.due, priority: b.p }).then(r => r.body.id);
  const a = await mk({ title: 'Q-sem prazo', p: 'high' }), b = await mk({ title: 'Q-baixa', due: day(3), p: 'low' });
  const c = await mk({ title: 'Q-alta', due: day(3), p: 'high' }), e = await mk({ title: 'Q-cedo', due: day(1), p: 'low' });
  const order = (await admin('GET', '/api/tasks?q=Q-')).body.map(x => x.id);
  assert.deepEqual(order, [e, c, b, a]);
  assert.equal((await member('POST', '/api/board/stages', { name: 'X' })).status, 403);
  let board = (await admin('POST', '/api/board/stages', { name: 'Aguardando cliente' })).body;
  const st = board.stages[0].id;
  assert.deepEqual(board.order.slice(-4), [`stage-${st}`, 'done_on_time', 'done_late', 'cancelled'], 'coluna nova entra antes das concluídas');
  let d = (await admin('PATCH', `/api/tasks/${b}`, { status: `stage-${st}` })).body;
  assert.deepEqual([d.status, d.column, d.stage_id], ['doing', `stage-${st}`, st]);
  board = (await admin('PUT', '/api/board/order', { order: [`stage-${st}`, 'review', 'overdue', 'done_on_time', 'done_late', 'cancelled'] })).body;
  assert.equal(board.order[0], `stage-${st}`);
  assert.equal((await admin('PUT', '/api/board/order', { order: ['nada'] })).status, 400);
  assert.equal((await admin('GET', '/api/me')).body.org.board.stages[0].name, 'Aguardando cliente');
  d = (await admin('PATCH', `/api/tasks/${b}`, { status: 'review' })).body;
  assert.equal(d.stage_id, null, 'sair da coluna criada limpa a coluna');
  await admin('PATCH', `/api/tasks/${b}`, { status: `stage-${st}` });
  await admin('DELETE', `/api/board/stages/${st}`);
  d = (await admin('GET', `/api/tasks/${b}`)).body;
  assert.deepEqual([d.column, d.stage_id], ['doing', null], 'apagar a coluna devolve para Em andamento');
});

test('anexos: equipe e cliente anexam; só equipe vê o que é só da equipe', async () => {
  const admin = await login('admin@t.local');
  const cliA = await login('a@t.local');
  const t = (await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'Com anexo' })).body.id;
  const file = 'data:text/plain;base64,' + Buffer.from('olá').toString('base64');
  let d = (await admin('POST', `/api/tasks/${t}/attachments`, { name: 'nota.txt', data: file })).body;
  d = (await admin('POST', `/api/tasks/${t}/attachments`, { name: 'interno.txt', data: file, visible_to_client: false })).body;
  assert.equal(d.attachments.length, 2);
  assert.equal(d.attachments_count, 2);
  const c = (await cliA('GET', `/api/tasks/${t}`)).body;
  assert.deepEqual(c.attachments.map(a => a.name), ['nota.txt']);
  const hidden = d.attachments.find(a => a.name === 'interno.txt').id;
  assert.equal((await cliA('GET', `/api/attachments/${hidden}`)).status, 404);
  const got = (await cliA('GET', `/api/attachments/${c.attachments[0].id}`)).body;
  assert.equal(Buffer.from(got.data, 'base64').toString(), 'olá');
  d = (await cliA('POST', `/api/tasks/${t}/attachments`, { name: 'do-cliente.txt', data: file, visible_to_client: false })).body;
  assert.equal(d.attachments.find(a => a.name === 'do-cliente.txt').visible_to_client, true, 'o que o cliente anexa ele vê');
  assert.equal((await cliA('DELETE', `/api/attachments/${c.attachments[0].id}`)).status, 403, 'só quem anexou ou o admin apaga');
  assert.equal((await admin('POST', `/api/tasks/${t}/attachments`, { name: 'x', data: 'nada' })).status, 400);
  assert.equal((await admin('DELETE', `/api/attachments/${hidden}`)).status, 200);
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
  assert.equal((await admin('PATCH', `/api/tasks/${ok}`, { status: 'cancelled' })).status, 400, 'cancelar só com motivo');
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
  const done = await admin('POST', `/api/tasks/${t}/complete`, { completed_on: S.today() });
  const next = (await admin('GET', `/api/tasks/${done.body.created_next_id}`)).body;
  assert.equal(next.start_date, null, 'início fica para quando começar');
  assert.equal(next.due_date, '2026-02-28');
  assert.equal(next.status, 'todo');
  assert.deepEqual(next.alerts, [0, 3]);
  assert.deepEqual(next.assignees.map(a => a.id), [ids.member]);
  assert.deepEqual(next.checklist.map(i => [i.text, i.done]), [['Conciliar', 0]]);
  // Reabrir e concluir de novo não duplica a próxima.
  await admin('PATCH', `/api/tasks/${t}`, { status: 'doing' });
  const again = await admin('POST', `/api/tasks/${t}/complete`, { completed_on: S.today() });
  assert.equal(again.status, 200);
  assert.equal(again.body.created_next_id, null);
  assert.equal((await admin('POST', '/api/tasks', { kind: 'internal', title: 'x', recurrence: 'custom' })).status, 400, 'livre exige N dias');
  const custom = await admin('POST', '/api/tasks', { kind: 'internal', title: 'x', due_date: '2026-03-01', recurrence: 'custom', recurrence_every: 10 });
  const n = await admin('POST', `/api/tasks/${custom.body.id}/complete`, { completed_on: '2026-03-01' });
  assert.equal((await admin('GET', `/api/tasks/${n.body.created_next_id}`)).body.due_date, '2026-03-11');
});

test('cancelar exige motivo; vai para Cancelada; reabrir limpa', async () => {
  const admin = await login('admin@t.local');
  const cliA = await login('a@t.local');
  const t = (await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'Cancelar', due_date: day(-3), recurrence: 'monthly' })).body.id;
  assert.equal((await admin('POST', `/api/tasks/${t}/cancel`, {})).status, 400);
  assert.equal((await admin('POST', `/api/tasks/${t}/cancel`, { reason: '   ' })).status, 400);
  const c = await admin('POST', `/api/tasks/${t}/cancel`, { reason: 'Cliente desistiu do projeto' });
  assert.equal(c.body.column, 'cancelled', 'mesmo com prazo vencido');
  assert.equal(c.body.cancel_reason, 'Cliente desistiu do projeto');
  assert.equal(c.body.cancelled_on, S.today());
  assert.equal(c.body.alert, null);
  assert.equal(c.body.next_task_id, null, 'cancelada não cria a próxima repetição');
  assert.equal((await cliA('GET', `/api/tasks/${t}`)).body.cancel_reason, 'Cliente desistiu do projeto');
  assert.equal((await admin('GET', '/api/alerts')).body.some(x => x.id === t), false);
  const r = await admin('PATCH', `/api/tasks/${t}`, { status: 'todo' });
  assert.equal(r.body.cancel_reason, null);
  assert.equal(r.body.column, 'overdue');
  assert.equal((await cliA('POST', `/api/tasks/${t}/cancel`, { reason: 'x' })).status, 403);
});

test('início: vazio ao criar, preenchido ao entrar em andamento, editável', async () => {
  const admin = await login('admin@t.local');
  const t = (await admin('POST', '/api/tasks', { kind: 'internal', title: 'Início', start_date: day(-9), due_date: day(2) })).body.id;
  assert.equal((await admin('GET', `/api/tasks/${t}`)).body.start_date, null, 'criar não define início');
  let d = await admin('PATCH', `/api/tasks/${t}`, { status: 'doing' });
  assert.equal(d.body.start_date, S.today());
  d = await admin('PATCH', `/api/tasks/${t}`, { start_date: day(5) });
  assert.equal(d.body.start_date, day(5), 'pode começar depois do prazo');
  d = await admin('PATCH', `/api/tasks/${t}`, { status: 'review' });
  assert.equal(d.body.start_date, day(5), 'não sobrescreve um início já informado');
});

test('marcar item do checklist numa tarefa a fazer: em andamento, início hoje e % pelo checklist', async () => {
  const admin = await login('admin@t.local');
  const cliA = await login('a@t.local');
  const t = (await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'Check inicia', checklist: ['um', 'dois', 'três', 'quatro'] })).body.id;
  let d = (await admin('GET', `/api/tasks/${t}`)).body;
  assert.deepEqual([d.status, d.start_date], ['todo', null]);
  d = (await cliA('PATCH', `/api/checklist/${d.checklist[0].id}`, { done: true })).body;
  assert.deepEqual([d.status, d.start_date, d.progress], ['doing', S.today(), 25], 'o cliente marcando também inicia');
  // Com início já informado, mantém a data; desmarcar não volta a situação.
  const t2 = (await admin('POST', '/api/tasks', { kind: 'internal', title: 'Com início', checklist: ['a', 'b'] })).body.id;
  await admin('PATCH', `/api/tasks/${t2}`, { start_date: day(-3) });
  await admin('PATCH', `/api/tasks/${t2}`, { status: 'todo' });
  d = (await admin('GET', `/api/tasks/${t2}`)).body;
  d = (await admin('PATCH', `/api/checklist/${d.checklist[1].id}`, { done: true })).body;
  assert.deepEqual([d.status, d.start_date, d.progress], ['doing', day(-3), 50]);
  d = (await admin('PATCH', `/api/checklist/${d.checklist[1].id}`, { done: false })).body;
  assert.equal(d.status, 'doing');
  // Em revisão não volta para em andamento.
  await admin('PATCH', `/api/tasks/${t2}`, { status: 'review' });
  d = (await admin('PATCH', `/api/checklist/${d.checklist[0].id}`, { done: true })).body;
  assert.equal(d.status, 'review');
});

test('cliente atualiza situação, início, % e checklist; o resto não', async () => {
  const admin = await login('admin@t.local');
  const cliA = await login('a@t.local');
  const cliB = await login('b@t.local');
  const t = (await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'Do cliente', due_date: day(9), checklist: ['Enviar extratos', 'Assinar contrato'] })).body.id;
  let d = await cliA('PATCH', `/api/tasks/${t}`, { start_date: day(-1) });
  assert.equal(d.status, 200);
  assert.equal(d.body.status, 'doing', 'informar início coloca em andamento');
  assert.equal(d.body.start_date, day(-1));
  d = await cliA('PATCH', `/api/checklist/${d.body.checklist[0].id}`, { done: true });
  assert.equal(d.body.progress, 50);
  assert.equal((await cliA('PATCH', `/api/checklist/${d.body.checklist[0].id}`, { text: 'outro' })).status, 403);
  assert.equal((await cliA('PATCH', `/api/tasks/${t}`, { status: 'review' })).body.status, 'review');
  assert.equal((await cliA('PATCH', `/api/tasks/${t}`, { title: 'x' })).status, 403);
  assert.equal((await cliA('PATCH', `/api/tasks/${t}`, { status: 'review', due_date: day(30) })).status, 403);
  assert.equal((await cliA('PATCH', `/api/tasks/${t}`, { status: 'done' })).status, 400);
  assert.equal((await cliA('POST', `/api/tasks/${t}/checklist`, { text: 'novo' })).status, 403);
  assert.equal((await cliB('PATCH', `/api/tasks/${t}`, { status: 'doing' })).status, 404, 'outro cliente não mexe');
  const sem = (await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'Sem checklist' })).body.id;
  assert.equal((await cliA('PATCH', `/api/tasks/${sem}`, { status: 'doing', progress: 30 })).body.progress, 30);
  const done = await cliA('POST', `/api/tasks/${sem}/complete`, { completed_on: S.today() });
  assert.equal(done.status, 200, 'cliente conclui com data');
  assert.equal(done.body.column, 'done_on_time');
  assert.equal((await cliA('POST', `/api/tasks/${sem}/complete`, { completed_on: S.today() })).status, 409, 'não reconclui');
  assert.equal((await cliB('POST', `/api/tasks/${t}/complete`, {})).status, 404, 'outro cliente não conclui');
  await cliA('PATCH', `/api/tasks/${t}`, { status: 'review' });
  await cliA('POST', `/api/tasks/${t}/approve`);
  assert.equal((await cliA('PATCH', `/api/tasks/${t}`, { status: 'doing' })).status, 409, 'encerrada não reabre pelo cliente');
});

test('início manda para em andamento só se estava a fazer; filtro de recorrentes', async () => {
  const admin = await login('admin@t.local');
  const t = (await admin('POST', '/api/tasks', { kind: 'internal', title: 'Rev', recurrence: 'weekly', due_date: day(3) })).body.id;
  await admin('PATCH', `/api/tasks/${t}`, { status: 'review' });
  assert.equal((await admin('PATCH', `/api/tasks/${t}`, { start_date: day(-2) })).body.status, 'review', 'não volta de revisão');
  const u = (await admin('POST', '/api/tasks', { kind: 'internal', title: 'Única' })).body.id;
  const rec = (await admin('GET', '/api/tasks?recurring=1')).body;
  assert.ok(rec.some(x => x.id === t) && !rec.some(x => x.id === u));
  const single = (await admin('GET', '/api/tasks?recurring=0')).body;
  assert.ok(single.some(x => x.id === u) && !single.some(x => x.id === t));
});

test('checklist já na criação; substitui o do modelo quando vem preenchido', async () => {
  const admin = await login('admin@t.local');
  const t = (await admin('POST', '/api/tasks', { kind: 'internal', title: 'Com checklist', checklist: ['Um', '  ', 'Dois'] })).body.id;
  assert.deepEqual((await admin('GET', `/api/tasks/${t}`)).body.checklist.map(i => i.text), ['Um', 'Dois']);
  const tpl = (await admin('POST', '/api/templates', { name: 'M', title: 'Do modelo', checklist: ['A', 'B'] })).body.id;
  const fromTpl = (await admin('POST', '/api/tasks', { kind: 'internal', template_id: tpl, checklist: ['A', 'B', 'C'] })).body.id;
  assert.deepEqual((await admin('GET', `/api/tasks/${fromTpl}`)).body.checklist.map(i => i.text), ['A', 'B', 'C']);
  assert.equal((await admin('POST', '/api/tasks', { kind: 'internal', title: 'x', checklist: 'A' })).status, 400);
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
  assert.equal((await cliB('PATCH', `/api/tasks/${body.id}`, { title: 'x' })).status, 404);
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

test('produção: backup diário, senha temporária pelo administrador e verificação de saúde', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { open: openDb, backup } = require('../db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  const src = openDb(path.join(dir, 'x.db'));
  src.prepare("insert into orgs (name) values ('Org')").run();
  for (let d = 1; d <= 16; d++) backup(src, path.join(dir, 'b'), { day: `2026-10-${String(d).padStart(2, '0')}` });
  assert.equal(backup(src, path.join(dir, 'b'), { day: '2026-10-16' }), null, 'uma por dia');
  const files = fs.readdirSync(path.join(dir, 'b')).sort();
  assert.equal(files.length, 14);
  assert.equal(files[0], 'tarefas-2026-10-03.db');
  assert.equal(openDb(path.join(dir, 'b', files[13])).prepare('select name from orgs').get().name, 'Org');

  const admin = await login('admin@t.local');
  const member = await login('membro@t.local');
  const cli = ids.db.prepare("select id from users where email = 'a@t.local'").get().id;
  assert.equal((await member('POST', `/api/users/${cli}/password`, { password: 'nova-senha-1' })).status, 403);
  assert.equal((await admin('POST', `/api/users/${cli}/password`, { password: 'curta' })).status, 400);
  assert.equal((await admin('POST', `/api/users/${cli}/password`, { password: 'nova-senha-1' })).status, 200);
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@t.local', password: 'nova-senha-1' }) });
  assert.equal(r.status, 200, 'entra com a senha temporária');
  assert.equal((await fetch(base + '/api/health')).status, 200);
});

test('atualização segura: cópia antes de mudar o banco e versão nunca rebaixada', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { open: openDb, backupBeforeUpgrade, SCHEMA_VERSION } = require('../db');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'up-'));
  const file = path.join(dir, 'x.db');
  assert.equal(backupBeforeUpgrade(file, path.join(dir, 'b')), null, 'sem banco, sem cópia');
  let db = openDb(file);
  db.prepare("insert into orgs (name) values ('Org')").run();
  assert.equal(backupBeforeUpgrade(file, path.join(dir, 'b')), null, 'mesma versão, sem cópia');
  db.exec(`pragma user_version = ${SCHEMA_VERSION - 1}`); db.close();
  const copy = backupBeforeUpgrade(file, path.join(dir, 'b'));
  assert.match(copy, /antes-da-atualizacao-/);
  assert.equal(openDb(copy).prepare('select name from orgs').get().name, 'Org');
  // Código mais antigo (rollback) abrindo um banco mais novo: mantém a versão do banco.
  db = openDb(file); db.exec(`pragma user_version = ${SCHEMA_VERSION + 3}`); db.close();
  db = openDb(file);
  assert.equal(db.prepare('pragma user_version').get().user_version, SCHEMA_VERSION + 3);
});

test('a equipe vê ou só os responsáveis; responsável da equipe precisa acompanhar o cliente; quem iniciou e concluiu', async () => {
  const admin = await login('admin@t.local');
  const member = await login('membro@t.local');
  const member2 = await login('membro2@t.local');
  // Externa marcada "só os responsáveis": quem acompanha o cliente não vê; o administrador vê.
  const ext = (await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'Só responsáveis', team_visible: false })).body.id;
  assert.equal((await member('GET', `/api/tasks/${ext}`)).status, 404, 'acompanha o cliente, mas a tarefa é só dos responsáveis');
  assert.equal((await admin('GET', `/api/tasks/${ext}`)).body.team_visible, false);
  await admin('PATCH', `/api/tasks/${ext}`, { team_visible: true });
  assert.equal((await member('GET', `/api/tasks/${ext}`)).status, 200, 'virou visível para a equipe do cliente');
  // Interna sem cliente com "a equipe vê": toda a equipe vê.
  const all = (await member2('POST', '/api/tasks', { kind: 'internal', title: 'Para todos', team_visible: true })).body.id;
  assert.equal((await member('GET', `/api/tasks/${all}`)).status, 200);
  assert.equal((await admin('GET', `/api/tasks/${all}`)).status, 200);
  // Interna ligada ao cliente com "a equipe vê": a equipe do cliente e o administrador; o membro 2 (não acompanha) não.
  const intA = (await admin('POST', '/api/tasks', { kind: 'internal', client_id: ids.a, title: 'Interna do A', team_visible: true })).body.id;
  assert.equal((await member('GET', `/api/tasks/${intA}`)).status, 200);
  assert.equal((await member2('GET', `/api/tasks/${intA}`)).status, 404);
  // Responsável: o membro 2 não acompanha o cliente A.
  const r = await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'x', assignee_ids: [ids.member2] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /não acompanha/);
  assert.equal((await admin('POST', '/api/tasks', { kind: 'internal', title: 'Sem cliente', assignee_ids: [ids.member2] })).status, 201, 'sem cliente, qualquer um da equipe');
  // Quem iniciou e quem concluiu (pessoas diferentes).
  const t = (await admin('POST', '/api/tasks', { kind: 'external', client_id: ids.a, title: 'Rastreio', assignee_ids: [ids.member] })).body.id;
  let d = (await member('PATCH', `/api/tasks/${t}`, { status: 'doing' })).body;
  assert.equal(d.started_by_name, 'Membro');
  d = (await admin('POST', `/api/tasks/${t}/complete`, { completed_on: S.today() })).body;
  assert.deepEqual([d.started_by_name, d.completed_by_name], ['Membro', 'Admin']);
  d = (await admin('PATCH', `/api/tasks/${t}`, { status: 'doing' })).body;
  assert.equal(d.completed_by_name, null, 'reabrir limpa quem concluiu');
  d = (await admin('PATCH', `/api/tasks/${t}`, { start_date: null, status: 'todo' })).body;
  assert.equal(d.started_by_name, null, 'sem início, sem quem iniciou');
  d = (await admin('POST', `/api/tasks/${t}/cancel`, { reason: 'teste' })).body;
  assert.equal(d.cancelled_by_name, 'Admin');
});

test('compromissos: quem marcou, participantes e administrador veem; cliente só o dele', async () => {
  const admin = await login('admin@t.local');
  const member = await login('membro@t.local');
  const member2 = await login('membro2@t.local');
  const cliAId = ids.db.prepare("select id from users where email = 'a@t.local'").get().id;
  await admin('POST', `/api/users/${cliAId}/password`, { password: ids.pw }); // um teste anterior trocou a senha
  const cliA = await login('a@t.local');
  assert.equal((await cliA('POST', '/api/events', { title: 'x', date: day(1) })).status, 403, 'cliente não marca');
  assert.equal((await member('POST', '/api/events', { title: 'x', date: day(1), start_time: '10:00', end_time: '09:00' })).status, 400);
  assert.equal((await member('POST', '/api/events', { title: 'x', date: day(1), start_time: '25:00' })).status, 400);
  const r = await member('POST', '/api/events', { title: 'Reunião mensal', date: day(2), start_time: '10:00', end_time: '11:00', client_id: ids.a,
    location: 'https://meet.google.com/abc-defg-hij', user_ids: [ids.member, cliAId] });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.participants.map(p => p.id).sort(), [ids.member, cliAId].sort());
  const eid = r.body.id;
  assert.ok((await cliA('GET', '/api/events')).body.some(e => e.id === eid), 'cliente participante vê');
  assert.ok((await admin('GET', '/api/events')).body.some(e => e.id === eid), 'administrador vê');
  assert.equal((await member2('GET', '/api/events')).body.some(e => e.id === eid), false, 'quem não participa não vê');
  assert.equal((await member2('PATCH', `/api/events/${eid}`, { title: 'y' })).status, 404);
  assert.equal((await cliA('PATCH', `/api/events/${eid}`, { title: 'y' })).status, 403);
  const ed = await member('PATCH', `/api/events/${eid}`, { title: 'Reunião mensal (remarcada)', date: day(3), user_ids: [ids.member, ids.member2] });
  assert.equal(ed.body.title, 'Reunião mensal (remarcada)');
  assert.ok((await member2('GET', '/api/events')).body.some(e => e.id === eid), 'virou participante, vê');
  assert.equal((await cliA('GET', '/api/events')).body.some(e => e.id === eid), false, 'saiu da lista, não vê');
  assert.equal((await member('GET', `/api/events?from=${day(10)}&to=${day(20)}`)).body.length, 0, 'filtro de datas');
  assert.equal((await member2('DELETE', `/api/events/${eid}`)).status, 403);
  assert.equal((await admin('DELETE', `/api/events/${eid}`)).status, 200);
});
