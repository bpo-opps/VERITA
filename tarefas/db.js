'use strict';
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

const STAGES = [
  ['A fazer', 'todo'],
  ['Em andamento', 'doing'],
  ['Revisão interna', 'review'],
  ['Com o cliente', 'client'],
  ['Em ajuste', 'adjust'],
  ['Concluída', 'done'],
];

const SCHEMA = `
pragma foreign_keys = on;
create table if not exists orgs (
  id integer primary key,
  name text not null,
  accent text not null default '#0f766e'
);
create table if not exists clients (
  id integer primary key,
  org_id integer not null references orgs(id) on delete cascade,
  name text not null,
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
  created_at text not null default (datetime('now')),
  check ((role = 'client') = (client_id is not null))
);
create table if not exists sessions (
  token text primary key,
  user_id integer not null references users(id) on delete cascade,
  expires_at integer not null
);
create table if not exists stages (
  id integer primary key,
  org_id integer not null references orgs(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('todo','doing','review','client','adjust','done')),
  position integer not null
);
create table if not exists tasks (
  id integer primary key,
  org_id integer not null references orgs(id) on delete cascade,
  client_id integer not null references clients(id) on delete cascade,
  stage_id integer not null references stages(id),
  title text not null,
  description text not null default '',
  due_date text,
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  position real not null default 0,
  created_by integer references users(id) on delete set null,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  completed_at text
);
create index if not exists tasks_client on tasks (client_id, stage_id);
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
  db.exec(SCHEMA);
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
  return tx(db, () => {
    const org = db.prepare('insert into orgs (name) values (?)').run(name);
    const orgId = Number(org.lastInsertRowid);
    const ins = db.prepare('insert into stages (org_id, name, kind, position) values (?, ?, ?, ?)');
    STAGES.forEach(([n, kind], i) => ins.run(orgId, n, kind, i));
    return orgId;
  });
}

function createUser(db, { orgId, name, email, password, role, clientId = null }) {
  const r = db.prepare(
    'insert into users (org_id, name, email, pass_hash, role, client_id) values (?, ?, ?, ?, ?, ?)'
  ).run(orgId, name, email, hashPassword(password), role, clientId);
  return Number(r.lastInsertRowid);
}

// Dados fictícios para ver o sistema funcionando. Nenhuma pessoa real.
function seedDemo(db) {
  const orgId = createOrg(db, 'Minha Consultoria');
  const stage = kind => db.prepare('select id from stages where org_id = ? and kind = ?').get(orgId, kind).id;
  const client = name => Number(db.prepare('insert into clients (org_id, name) values (?, ?)').run(orgId, name).lastInsertRowid);
  const acme = client('Padaria Exemplo');
  const beta = client('Clínica Modelo');
  const admin = createUser(db, { orgId, name: 'Admin Demo', email: 'admin@demo.local', password: 'demo1234', role: 'admin' });
  const ana = createUser(db, { orgId, name: 'Membro Demo', email: 'equipe@demo.local', password: 'demo1234', role: 'member' });
  createUser(db, { orgId, name: 'Cliente Padaria', email: 'cliente@demo.local', password: 'demo1234', role: 'client', clientId: acme });
  const task = (clientId, kind, title, due, who) => {
    const id = Number(db.prepare(
      'insert into tasks (org_id, client_id, stage_id, title, due_date, created_by) values (?, ?, ?, ?, ?, ?)'
    ).run(orgId, clientId, stage(kind), title, due, admin).lastInsertRowid);
    for (const u of who) db.prepare('insert into task_assignees values (?, ?)').run(id, u);
    return id;
  };
  const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  task(acme, 'todo', 'Levantar processos do financeiro', day(3), [ana]);
  task(acme, 'doing', 'Mapear fluxo de contas a pagar', day(1), [ana, admin]);
  const t = task(acme, 'client', 'Relatório de diagnóstico', day(-1), [admin]);
  db.prepare("insert into comments (task_id, user_id, body, visible_to_client) values (?, ?, 'Versão 1 enviada para sua revisão.', 1)").run(t, admin);
  task(beta, 'review', 'Conciliação bancária de setembro', day(2), [ana]);
  task(beta, 'done', 'Reunião de kickoff', day(-7), [admin]);
  db.prepare("insert into templates (org_id, name, title, checklist) values (?, 'Fechamento mensal', 'Fechamento do mês', ?)")
    .run(orgId, JSON.stringify(['Conciliar bancos', 'Conferir notas fiscais', 'Enviar relatório ao cliente']));
}

module.exports = { open, tx, createOrg, createUser, seedDemo, STAGES };
