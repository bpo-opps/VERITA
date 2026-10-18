'use strict';
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');
const { today, addDays } = require('./shared');

const SCHEMA_VERSION = 5;

const SCHEMA = `
pragma foreign_keys = on;
create table if not exists orgs (
  id integer primary key,
  name text not null,
  accent text not null default '#FB4F14',
  logo text
);
create table if not exists clients (
  id integer primary key,
  org_id integer not null references orgs(id) on delete cascade,
  name text not null,
  logo text,
  created_at text not null default (datetime('now'))
);
create table if not exists users (
  id integer primary key,
  org_id integer not null references orgs(id) on delete cascade,
  name text not null,
  email text not null unique collate nocase,
  pass_hash text not null,
  role text not null check (role in ('admin','member','client')),
  client_id integer references clients(id) on delete cascade,
  active integer not null default 1,
  phone text,
  notify_email integer not null default 1,
  notify_whatsapp integer not null default 0,
  whatsapp_consent_at text,
  created_at text not null default (datetime('now')),
  check ((role = 'client') = (client_id is not null))
);
create table if not exists sessions (
  token text primary key,
  user_id integer not null references users(id) on delete cascade,
  expires_at integer not null
);
create table if not exists tasks (
  id integer primary key,
  org_id integer not null references orgs(id) on delete cascade,
  kind text not null check (kind in ('internal','external')),
  client_id integer references clients(id) on delete cascade,
  status text not null default 'todo' check (status in ('todo','doing','review','done','cancelled')),
  client_visible integer not null default 0,
  title text not null,
  description text not null default '',
  start_date text,
  due_date text,
  completed_on text,
  cancelled_on text,
  cancel_reason text,
  progress integer not null default 0 check (progress between 0 and 100),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  alerts text not null default '[1]',
  recurrence text not null default 'none',
  recurrence_every integer,
  next_task_id integer references tasks(id) on delete set null,
  position real not null default 0,
  created_by integer references users(id) on delete set null,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  archived_at text,
  check (kind = 'internal' or client_id is not null),
  check ((status = 'done') = (completed_on is not null)),
  check ((status = 'cancelled') = (cancel_reason is not null))
);
create index if not exists tasks_org on tasks (org_id, archived_at, status);
create index if not exists tasks_client on tasks (client_id);
create index if not exists tasks_due on tasks (org_id, due_date);
create table if not exists task_assignees (
  task_id integer not null references tasks(id) on delete cascade,
  user_id integer not null references users(id) on delete cascade,
  primary key (task_id, user_id)
);
create index if not exists assignees_user on task_assignees (user_id);
create table if not exists checklist_items (
  id integer primary key,
  task_id integer not null references tasks(id) on delete cascade,
  text text not null,
  done integer not null default 0,
  position integer not null default 0
);
create index if not exists checklist_task on checklist_items (task_id);
create table if not exists comments (
  id integer primary key,
  task_id integer not null references tasks(id) on delete cascade,
  user_id integer references users(id) on delete set null,
  body text not null,
  visible_to_client integer not null default 0,
  created_at text not null default (datetime('now'))
);
create index if not exists comments_task on comments (task_id);
create table if not exists adjustments (
  id integer primary key,
  task_id integer not null references tasks(id) on delete cascade,
  origin text not null check (origin in ('internal','client')),
  body text not null,
  user_id integer references users(id) on delete set null,
  created_at text not null default (datetime('now')),
  resolved_at text
);
create index if not exists adjustments_task on adjustments (task_id);
-- Avisos: cada linha é uma mensagem para uma pessoa num canal. dedupe_key impede repetir o mesmo aviso.
create table if not exists notifications (
  id integer primary key,
  org_id integer not null references orgs(id) on delete cascade,
  user_id integer not null references users(id) on delete cascade,
  task_id integer references tasks(id) on delete set null,
  channel text not null check (channel in ('email','whatsapp')),
  kind text not null check (kind in ('created','due','overdue','weekly','test')),
  dedupe_key text not null unique,
  subject text not null,
  body text not null,
  html text,
  wa_params text,
  status text not null default 'pending' check (status in ('pending','sent','failed','not_sent')),
  error text,
  attempts integer not null default 0,
  created_at text not null default (datetime('now')),
  sent_at text
);
create index if not exists notifications_status on notifications (status, created_at);
create index if not exists notifications_org on notifications (org_id, created_at);
-- Reuniões: a ata em PDF, quem estava presente e as tarefas que a IA encontrou, esperando o OK.
create table if not exists meetings (
  id integer primary key,
  org_id integer not null references orgs(id) on delete cascade,
  title text not null,
  meeting_date text not null,
  client_id integer references clients(id) on delete set null,
  attendee_ids text not null default '[]',
  other_attendees text not null default '',
  pdf blob,
  pdf_name text,
  summary text,
  status text not null default 'processing' check (status in ('processing','ready','error')),
  error text,
  created_by integer references users(id) on delete set null,
  created_at text not null default (datetime('now'))
);
create index if not exists meetings_org on meetings (org_id, meeting_date);
create table if not exists meeting_items (
  id integer primary key,
  meeting_id integer not null references meetings(id) on delete cascade,
  title text not null,
  description text not null default '',
  kind text not null check (kind in ('internal','external')),
  client_id integer references clients(id) on delete set null,
  client_visible integer not null default 0,
  assignee_ids text not null default '[]',
  client_responsible text not null default '',
  due_date text,
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  checklist text not null default '[]',
  quote text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','discarded')),
  task_id integer references tasks(id) on delete set null,
  decided_by integer references users(id) on delete set null,
  decided_at text,
  position integer not null default 0
);
create index if not exists meeting_items_meeting on meeting_items (meeting_id);
create table if not exists templates (
  id integer primary key,
  org_id integer not null references orgs(id) on delete cascade,
  name text not null,
  title text not null,
  description text not null default '',
  checklist text not null default '[]'
);
`;

function open(file) {
  const db = new DatabaseSync(file);
  const version = db.prepare('pragma user_version').get().user_version;
  const hasTables = db.prepare("select 1 from sqlite_master where type = 'table' and name = 'orgs'").get();
  if (hasTables && version < 3) {
    throw new Error(`O banco ${file} é de uma versão antiga do sistema. Como ele só tinha dados de teste, apague o arquivo e rode de novo.`);
  }
  // Versão 3 -> 4: preferências de aviso nas pessoas (a tabela de avisos vem do SCHEMA).
  if (hasTables && version === 3) {
    db.exec(`alter table users add column phone text;
      alter table users add column notify_email integer not null default 1;
      alter table users add column notify_whatsapp integer not null default 0;
      alter table users add column whatsapp_consent_at text;`);
  }
  db.exec(SCHEMA);
  db.exec(`pragma user_version = ${SCHEMA_VERSION}`);
  return db;
}

function tx(db, fn) {
  db.exec('begin');
  try {
    const out = fn();
    db.exec('commit');
    return out;
  } catch (err) {
    db.exec('rollback');
    throw err;
  }
}

function createOrg(db, name) {
  return Number(db.prepare('insert into orgs (name) values (?)').run(name).lastInsertRowid);
}

function createUser(db, { orgId, name, email, password, role, clientId = null }) {
  const r = db.prepare(
    'insert into users (org_id, name, email, pass_hash, role, client_id) values (?, ?, ?, ?, ?, ?)'
  ).run(orgId, name, email, hashPassword(password), role, clientId);
  return Number(r.lastInsertRowid);
}

// Símbolo da Opps (a variação "!" do manual de marca), para os espaços pequenos como os cards.
const OPPS_SYMBOL = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="24" y="6" width="16" height="36" rx="4" fill="#FB4F14"/>' +
  '<rect x="24" y="46" width="16" height="12" rx="4" fill="#FB4F14"/></svg>').toString('base64');

// Logo de exemplo: quadrado colorido com as iniciais, como imagem SVG embutida.
function sampleLogo(initials, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/>` +
    `<text x="32" y="41" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">${initials}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// Dados fictícios para ver o sistema funcionando. Nenhuma pessoa ou empresa real.
function seedDemo(db) {
  const d = n => addDays(today(), n);
  const orgId = createOrg(db, 'Opps Consultoria');
  db.prepare('update orgs set logo = ? where id = ?').run(OPPS_SYMBOL, orgId);
  const client = (name, logo) => Number(db.prepare('insert into clients (org_id, name, logo) values (?, ?, ?)').run(orgId, name, logo).lastInsertRowid);
  const padaria = client('Padaria Exemplo', sampleLogo('PE', '#b45309'));
  const clinica = client('Clínica Modelo', sampleLogo('CM', '#4338ca'));
  const pw = 'demo1234';
  const admin = createUser(db, { orgId, name: 'Admin Demo', email: 'admin@demo.local', password: pw, role: 'admin' });
  const ana = createUser(db, { orgId, name: 'Membro Demo', email: 'equipe@demo.local', password: pw, role: 'member' });
  const bia = createUser(db, { orgId, name: 'Analista Demo', email: 'analista@demo.local', password: pw, role: 'member' });
  createUser(db, { orgId, name: 'Cliente Padaria', email: 'cliente@demo.local', password: pw, role: 'client', clientId: padaria });

  let pos = 0;
  const task = (t, who = [], checklist = []) => {
    const id = Number(db.prepare(
      `insert into tasks (org_id, kind, client_id, client_visible, status, title, description, start_date, due_date, completed_on,
                          cancelled_on, cancel_reason, progress, priority, alerts, recurrence, position, created_by, archived_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(orgId, t.kind, t.client ?? null, t.visible ? 1 : 0, t.status || 'todo', t.title, t.description || '', t.start ?? null,
      t.due ?? null, t.done ?? null, t.cancelled ?? null, t.reason ?? null, t.progress || 0, t.priority || 'normal',
      JSON.stringify(t.alerts || [1]), t.recurrence || 'none', ++pos, t.by || admin, t.archived ? d(-1) : null).lastInsertRowid);
    for (const u of who) db.prepare('insert into task_assignees values (?, ?)').run(id, u);
    checklist.forEach(([text, done], i) => db.prepare('insert into checklist_items (task_id, text, done, position) values (?, ?, ?, ?)').run(id, text, done ? 1 : 0, i));
    return id;
  };

  task({ kind: 'external', client: padaria, title: 'Levantar processos do financeiro', due: d(5), alerts: [1, 3] }, [ana]);
  task({ kind: 'external', client: padaria, status: 'doing', title: 'Mapear fluxo de contas a pagar', start: d(-4), due: d(2), progress: 40, alerts: [1] }, [ana, admin]);
  task({ kind: 'external', client: clinica, status: 'doing', title: 'Fechamento contábil de setembro', start: d(-6), due: d(1), alerts: [0, 1, 3], recurrence: 'monthly', priority: 'high' }, [bia],
    [['Conciliar bancos', true], ['Conferir notas fiscais', true], ['Lançar provisões', false], ['Enviar relatório ao cliente', false]]);
  const rev = task({ kind: 'external', client: padaria, status: 'review', title: 'Relatório de diagnóstico', start: d(-10), due: d(3), progress: 90 }, [admin]);
  db.prepare("insert into comments (task_id, user_id, body, visible_to_client) values (?, ?, 'Versão 1 pronta para sua revisão.', 1)").run(rev, admin);
  task({ kind: 'external', client: clinica, status: 'doing', title: 'Conciliação bancária de agosto', start: d(-12), due: d(-2), progress: 70, alerts: [1] }, [ana]);
  task({ kind: 'external', client: clinica, status: 'done', title: 'Reunião de kickoff', start: d(-16), due: d(-14), done: d(-15) }, [admin]);
  task({ kind: 'external', client: padaria, status: 'done', title: 'Cadastro de fornecedores', start: d(-12), due: d(-9), done: d(-6) }, [ana]);
  task({ kind: 'external', client: clinica, status: 'cancelled', title: 'Treinamento do sistema de ponto', due: d(4), cancelled: d(-1), reason: 'Cliente decidiu trocar de sistema de ponto antes do treinamento.' }, [bia]);
  task({ kind: 'internal', title: 'Planejamento comercial do trimestre', due: d(10), alerts: [7], recurrence: 'quarterly' }, []);
  task({ kind: 'internal', client: padaria, visible: true, status: 'doing', title: 'Preparar proposta de renovação da Padaria', start: d(-1), due: d(6), progress: 30, by: ana }, [ana]);
  task({ kind: 'internal', client: padaria, status: 'doing', title: 'Revisar margem do contrato da Padaria', due: d(0), progress: 20, alerts: [0], by: ana }, [ana]);
  task({ kind: 'internal', title: 'Atualizar modelo de relatório mensal', due: d(15), by: bia }, [bia]);
  task({ kind: 'external', client: clinica, status: 'done', title: 'Levantamento inicial (antigo)', due: d(-40), done: d(-41), archived: true }, [admin]);

  db.prepare("insert into templates (org_id, name, title, checklist) values (?, 'Fechamento mensal', 'Fechamento do mês', ?)")
    .run(orgId, JSON.stringify(['Conciliar bancos', 'Conferir notas fiscais', 'Lançar provisões', 'Enviar relatório ao cliente']));
}

// Cópia do banco do dia (VACUUM INTO gera um arquivo consistente com o sistema rodando).
// Uma por dia, guarda as últimas `keep`. Devolve o caminho criado, ou null se a de hoje já existe.
function backup(db, dir, { keep = 14, day = new Date().toLocaleDateString('sv-SE') } = {}) {
  const fs = require('node:fs');
  const path = require('node:path');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `tarefas-${day}.db`);
  if (fs.existsSync(file)) return null;
  db.exec(`vacuum into '${file.replace(/'/g, "''")}'`);
  const old = fs.readdirSync(dir).filter(f => /^tarefas-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -keep);
  for (const f of old) fs.unlinkSync(path.join(dir, f));
  return file;
}

module.exports = { open, tx, backup, createOrg, createUser, seedDemo, sampleLogo, OPPS_SYMBOL };
