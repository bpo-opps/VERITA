'use strict';
process.env.TZ = 'America/Sao_Paulo';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { open, createOrg, createUser } = require('../db');
const { createNotifier } = require('../notify');
const { createHandler } = require('../app');
const mailer = require('../mailer');
const whatsapp = require('../whatsapp');

// 19/10/2026 é segunda-feira.
const MONDAY = '2026-10-19';
const at = (date, h, m = 0) => { const [y, mo, d] = date.split('-').map(Number); return new Date(y, mo - 1, d, h, m); };

function world() {
  const db = open(':memory:');
  const orgId = createOrg(db, 'Opps Consultoria');
  const client = name => Number(db.prepare('insert into clients (org_id, name) values (?, ?)').run(orgId, name).lastInsertRowid);
  const a = client('Cliente A'), b = client('Cliente B');
  const pw = 'senha-teste-1';
  const admin = createUser(db, { orgId, name: 'Ana Admin', email: 'admin@opps.test', password: pw, role: 'admin' });
  const bia = createUser(db, { orgId, name: 'Bia Equipe', email: 'bia@opps.test', password: pw, role: 'member' });
  const caio = createUser(db, { orgId, name: 'Caio Equipe', email: 'caio@opps.test', password: pw, role: 'member' });
  const cliA = createUser(db, { orgId, name: 'Dora Cliente', email: 'dora@clientea.test', password: pw, role: 'client', clientId: a });
  const cliB = createUser(db, { orgId, name: 'Edu Cliente', email: 'edu@clienteb.test', password: pw, role: 'client', clientId: b });
  const task = (t, who = []) => {
    const id = Number(db.prepare(
      `insert into tasks (org_id, kind, client_id, client_visible, status, cancel_reason, title, due_date, alerts, created_by, archived_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(orgId, t.kind || 'external', t.client ?? null, t.visible ? 1 : 0, t.status || 'todo', t.status === 'cancelled' ? 'teste' : null, t.title, t.due ?? null,
      JSON.stringify(t.alerts || [1]), t.by || admin, t.archived ? '2026-01-01' : null).lastInsertRowid);
    for (const u of who) db.prepare('insert into task_assignees values (?, ?)').run(id, u);
    return id;
  };
  return { db, orgId, a, b, admin, bia, caio, cliA, cliB, task, pw };
}

function notifierFor(w, clock, { failEmail = 0 } = {}) {
  const sent = { email: [], whatsapp: [] };
  let fails = failEmail;
  const n = createNotifier(w.db, {
    env: { APP_URL: 'https://tarefas.opps.test' }, now: () => clock.now, log: { error() {} },
    senders: {
      email: async m => { if (fails > 0) { fails--; throw new Error('SMTP fora do ar'); } sent.email.push(m); },
      whatsapp: async m => { sent.whatsapp.push(m); },
    },
  });
  return { n, sent };
}
const rows = (db, where = '1=1') => db.prepare(`select n.*, u.name from notifications n join users u on u.id = n.user_id where ${where} order by n.id`).all();

test('tarefa criada: responsáveis (menos quem criou) e o cliente que vê a tarefa', async () => {
  const w = world();
  const { n, sent } = notifierFor(w, { now: at(MONDAY, 10) });
  const ext = w.task({ title: 'Fechamento', client: w.a, due: '2026-10-30', by: w.bia }, [w.bia, w.caio]);
  n.taskCreated(ext, w.bia);
  assert.deepEqual(rows(w.db).map(r => r.name).sort(), ['Caio Equipe', 'Dora Cliente']);
  assert.equal(n.taskCreated(ext, w.bia), 0, 'não repete');
  const internal = w.task({ kind: 'internal', title: 'Margem do contrato', client: w.a, by: w.bia }, [w.caio]);
  n.taskCreated(internal, w.bia);
  assert.deepEqual(rows(w.db, `task_id = ${internal}`).map(r => r.name), ['Caio Equipe'], 'interna não visível: cliente não recebe');
  const shown = w.task({ kind: 'internal', visible: true, title: 'Proposta', client: w.a, by: w.bia }, [w.caio]);
  n.taskCreated(shown, w.bia);
  assert.deepEqual(rows(w.db, `task_id = ${shown}`).map(r => r.name).sort(), ['Caio Equipe', 'Dora Cliente'], 'interna visível: cliente recebe');
  await n.dispatch();
  assert.equal(sent.email.length, 5);
  const dora = sent.email.find(m => m.to === 'dora@clientea.test' && m.subject === 'Nova tarefa: Fechamento');
  assert.match(dora.html, /Abrir a tarefa/);
  assert.match(dora.html, new RegExp(`/#/tarefa/${ext}`));
  assert.ok(!sent.email.some(m => m.to === 'edu@clienteb.test'), 'cliente de outra empresa nunca recebe');
});

test('WhatsApp só com celular e autorização; e-mail pode ser desligado', async () => {
  const w = world();
  const { n, sent } = notifierFor(w, { now: at(MONDAY, 10) });
  w.db.prepare("update users set phone = '5511987654321', notify_whatsapp = 1, whatsapp_consent_at = '2026-10-01' where id = ?").run(w.caio);
  w.db.prepare("update users set notify_whatsapp = 1 where id = ?").run(w.cliA); // sem celular nem autorização
  w.db.prepare('update users set notify_email = 0 where id = ?').run(w.cliA);
  const t = w.task({ title: 'Folha', client: w.a, due: '2026-10-25' }, [w.caio]);
  n.taskCreated(t, w.admin);
  await n.dispatch();
  assert.deepEqual(sent.whatsapp.map(m => [m.to, m.kind, m.params[1]]), [['5511987654321', 'created', 'Folha']]);
  assert.deepEqual(sent.email.map(m => m.to), ['caio@opps.test']);
});

test('prazo: só nos alertas escolhidos, primeiro dia de atraso, nada de cancelada ou arquivada', () => {
  const w = world();
  const { n } = notifierFor(w, { now: at(MONDAY, 9) });
  const in3 = w.task({ title: 'Em 3', client: w.a, due: '2026-10-22', alerts: [3] }, [w.bia]);
  const in2 = w.task({ title: 'Em 2', client: w.a, due: '2026-10-21', alerts: [3] }, [w.bia]);
  const late = w.task({ title: 'Ontem', client: w.a, due: '2026-10-18', alerts: [] }, [w.bia]);
  const late2 = w.task({ title: 'Anteontem', client: w.a, due: '2026-10-17', alerts: [] }, [w.bia]);
  const cancel = w.task({ title: 'Cancelada', client: w.a, due: '2026-10-22', alerts: [3], status: 'cancelled' }, [w.bia]);
  const arch = w.task({ title: 'Arquivada', client: w.a, due: '2026-10-22', alerts: [3], archived: true }, [w.bia]);
  n.dueNotices(MONDAY);
  const got = rows(w.db).map(r => `${r.task_id}:${r.kind}:${r.name}`).sort();
  assert.deepEqual(got, [`${in3}:due:Bia Equipe`, `${in3}:due:Dora Cliente`, `${late}:overdue:Bia Equipe`, `${late}:overdue:Dora Cliente`].sort());
  assert.ok(![in2, late2, cancel, arch].some(id => got.some(g => g.startsWith(id + ':'))));
  assert.equal(n.dueNotices(MONDAY), 0, 'rodar de novo no mesmo dia não repete');
  assert.match(rows(w.db, `task_id = ${in3}`)[0].subject, /vence em 3 dias/);
});

test('resumo semanal: segunda a partir das 8h, uma vez, para quem tem tarefa aberta', async () => {
  const w = world();
  const clock = { now: at(MONDAY, 7, 59) };
  const { n, sent } = notifierFor(w, clock);
  w.task({ title: 'Atrasada A', client: w.a, due: '2026-10-10' }, [w.bia]);
  w.task({ title: 'Semana A', client: w.a, due: '2026-10-23' }, [w.bia]);
  w.task({ title: 'Andamento', client: w.a, status: 'doing', due: '2026-11-30' }, [w.caio]);
  w.task({ kind: 'internal', title: 'Interna do admin', due: '2026-10-20' }, []);
  await n.tick();
  assert.equal(rows(w.db, "kind = 'weekly'").length, 0, 'antes das 8h nada');
  clock.now = at(MONDAY, 8, 5);
  await n.tick();
  const weekly = rows(w.db, "kind = 'weekly'");
  assert.deepEqual(weekly.map(r => r.name).sort(), ['Bia Equipe', 'Caio Equipe', 'Dora Cliente'], 'admin sem tarefa atribuída e cliente B sem tarefas não recebem');
  const bia = sent.email.find(m => m.to === 'bia@opps.test' && /Resumo/.test(m.subject));
  assert.match(bia.text, /Atrasadas:\n- Atrasada A/);
  assert.match(bia.text, /Vencem nos próximos 7 dias:\n- Semana A/);
  assert.equal(bia.subject, 'Resumo da semana: 1 atrasada, 1 vencendo');
  clock.now = at(MONDAY, 15);
  await n.tick();
  assert.equal(rows(w.db, "kind = 'weekly'").length, 3, 'segunda à tarde não repete');
  clock.now = at('2026-10-20', 9);
  await n.tick();
  assert.equal(rows(w.db, "kind = 'weekly'").length, 3, 'terça não manda resumo');
});

test('despacho: tenta 3 vezes e marca falha; sem canal configurado fica "não enviado"', async () => {
  const w = world();
  const { n } = notifierFor(w, { now: at(MONDAY, 10) }, { failEmail: 5 });
  const t = w.task({ title: 'Falha', client: w.a }, [w.bia]);
  n.taskCreated(t, w.admin);
  await n.dispatch(); await n.dispatch();
  assert.deepEqual(rows(w.db, "user_id = " + w.bia).map(r => [r.status, r.attempts]), [['pending', 2]]);
  await n.dispatch();
  assert.deepEqual(rows(w.db, "user_id = " + w.bia).map(r => [r.status, r.attempts]), [['failed', 3]]);
  const off = createNotifier(w.db, { env: {}, now: () => at(MONDAY, 10), log: { error() {} } });
  const t2 = w.task({ title: 'Sem canal', client: w.a }, [w.caio]);
  off.taskCreated(t2, w.admin);
  await off.dispatch();
  const r = rows(w.db, `task_id = ${t2} and user_id = ${w.caio}`)[0];
  assert.equal(r.status, 'not_sent');
  assert.match(r.error, /E-mail não configurado/);
});

test('SMTP: conversa com o servidor e monta a mensagem com acentos', async () => {
  const got = { lines: [], data: '' };
  const server = net.createServer(sock => {
    let inData = false;
    let buf = '';
    sock.write('220 smtp.teste ESMTP\r\n');
    sock.on('data', d => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; sock.write('250 OK enviado\r\n'); } else got.data += line + '\n';
          continue;
        }
        got.lines.push(line);
        if (/^EHLO/.test(line)) sock.write('250-smtp.teste\r\n250 AUTH LOGIN PLAIN\r\n');
        else if (line === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (got.lines.length === 3) sock.write('334 UGFzc3dvcmQ6\r\n');
        else if (got.lines.length === 4) sock.write('235 Autenticado\r\n');
        else if (/^MAIL FROM/.test(line) || /^RCPT TO/.test(line)) sock.write('250 OK\r\n');
        else if (line === 'DATA') { inData = true; sock.write('354 Pode mandar\r\n'); }
        else if (line === 'QUIT') { sock.write('221 Tchau\r\n'); sock.end(); }
      }
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const cfg = mailer.config({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port), SMTP_USER: 'tarefas@opps.test', SMTP_PASS: 'senha-de-app', SMTP_SECURE: 'none', SMTP_FROM: 'Painel de Tarefas Opps <tarefas@opps.test>' });
  await mailer.send(cfg, { to: 'Dora <dora@clientea.test>', subject: 'Prazo chegando: Conciliação', text: 'Olá, Dora. A tarefa vence amanhã.', html: '<p>Olá</p>' });
  server.close();
  assert.equal(Buffer.from(got.lines[2], 'base64').toString(), 'tarefas@opps.test');
  assert.equal(Buffer.from(got.lines[3], 'base64').toString(), 'senha-de-app');
  assert.ok(got.lines.includes('MAIL FROM:<tarefas@opps.test>'));
  assert.ok(got.lines.includes('RCPT TO:<dora@clientea.test>'));
  assert.match(got.data, /Subject: =\?UTF-8\?B\?/);
  const subj = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(got.data)[1];
  assert.equal(Buffer.from(subj, 'base64').toString(), 'Prazo chegando: Conciliação');
  const textPart = got.data.split('Content-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: base64\n\n')[1].split('\n--')[0];
  assert.equal(Buffer.from(textPart.replace(/\n/g, ''), 'base64').toString(), 'Olá, Dora. A tarefa vence amanhã.');
});

test('WhatsApp: monta a chamada da API oficial com o modelo e os parâmetros', async () => {
  const cfg = whatsapp.config({ WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '123' });
  let call;
  await whatsapp.send(cfg, { to: '5511987654321', kind: 'due', params: ['Bia', 'Folha', 'vence amanhã', '20/10/2026'] },
    async (url, init) => { call = { url, init }; return { ok: true }; });
  assert.equal(call.url, 'https://graph.facebook.com/v21.0/123/messages');
  assert.equal(call.init.headers.Authorization, 'Bearer tok');
  const body = JSON.parse(call.init.body);
  assert.equal(body.template.name, 'tarefa_vencendo');
  assert.equal(body.template.language.code, 'pt_BR');
  assert.deepEqual(body.template.components[0].parameters.map(p => p.text), ['Bia', 'Folha', 'vence amanhã', '20/10/2026']);
  assert.equal(whatsapp.normalizePhone('(11) 98765-4321'), '5511987654321');
  assert.equal(whatsapp.normalizePhone('123'), undefined);
});

test('API: preferências, telas de avisos só para admin e aviso ao criar tarefa', async () => {
  const w = world();
  const { n, sent } = notifierFor(w, { now: at(MONDAY, 10) });
  const server = http.createServer(createHandler(w.db, { notifier: n }));
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
  try {
    const caio = await login('caio@opps.test');
    assert.equal((await caio('PATCH', '/api/me/notify', { notify_whatsapp: true })).status, 400, 'sem celular');
    assert.equal((await caio('PATCH', '/api/me/notify', { phone: '12' })).status, 400, 'celular inválido');
    assert.equal((await caio('PATCH', '/api/me/notify', { phone: '(11) 98765-4321', notify_whatsapp: true })).status, 400, 'sem autorização');
    assert.equal((await caio('PATCH', '/api/me/notify', { phone: '(11) 98765-4321', consent: true, notify_whatsapp: true })).status, 200);
    const me = (await caio('GET', '/api/me/notify')).body;
    assert.deepEqual([me.phone, me.notify_whatsapp, me.whatsapp_consent], ['5511987654321', true, true]);
    await caio('PATCH', '/api/me/notify', { consent: false });
    assert.equal((await caio('GET', '/api/me/notify')).body.notify_whatsapp, false, 'tirar a autorização desliga o WhatsApp');
    assert.equal((await caio('GET', '/api/notifications')).status, 403);
    assert.equal((await caio('POST', '/api/notifications/run')).status, 403);
    const admin = await login('admin@opps.test');
    const created = await admin('POST', '/api/tasks', { kind: 'external', client_id: w.a, title: 'Pelo site', assignee_ids: [w.caio] });
    await new Promise(r => setTimeout(r, 50));
    assert.ok(sent.email.some(m => m.to === 'caio@opps.test' && m.subject === 'Nova tarefa: Pelo site'));
    const list = (await admin('GET', '/api/notifications')).body;
    assert.ok(list.some(x => x.task_id === created.body.id && x.status === 'sent'));
    const test1 = await admin('POST', '/api/notifications/test');
    assert.equal(test1.body.status, 'sent');
    assert.equal((await admin('GET', '/api/notify/status')).body.email.configured, true);
  } finally { server.close(); }
});

test('banco da versão 3 ganha as colunas de aviso sem perder dados', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tarefas-')), 'v3.db');
  const db = open(file);
  const orgId = createOrg(db, 'Org');
  createUser(db, { orgId, name: 'Velho', email: 'velho@t.local', password: 'senha-teste-1', role: 'admin' });
  db.exec(`drop table notifications; alter table users drop column phone; alter table users drop column notify_email;
    alter table users drop column notify_whatsapp; alter table users drop column whatsapp_consent_at; pragma user_version = 3;`);
  db.close();
  const again = open(file);
  const u = again.prepare('select name, notify_email, notify_whatsapp, phone from users').get();
  assert.deepEqual({ ...u }, { name: 'Velho', notify_email: 1, notify_whatsapp: 0, phone: null });
  assert.equal(again.prepare('pragma user_version').get().user_version, require('../db').SCHEMA_VERSION);
  assert.ok(again.prepare("select 1 from sqlite_master where name = 'notifications'").get());
});
