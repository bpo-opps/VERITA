'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { tx, createUser } = require('./db');
const auth = require('./auth');
const S = require('./shared');

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const MAX_BODY = 512 * 1024;
const MAX_LOGO = 300 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
// Resposta com código ou cookie diferente do padrão (200, sem cookie).
const REPLY = Symbol('reply');
const reply = (code, body, cookie) => ({ [REPLY]: true, code, body, cookie });

// ---------- validação ----------
function str(v, field, { max = 500, required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) fail(400, `Campo obrigatório: ${field}`);
    return '';
  }
  if (typeof v !== 'string') fail(400, `Campo inválido: ${field}`);
  const s = v.trim();
  if (required && !s) fail(400, `Campo obrigatório: ${field}`);
  if (s.length > max) fail(400, `Campo muito longo: ${field} (máx. ${max})`);
  return s;
}
function date(v, field = 'data') {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) fail(400, `${field}: data inválida (use AAAA-MM-DD)`);
  return v;
}
function oneOf(v, field, options, fallback) {
  if (v === undefined) return fallback;
  if (!options.includes(v)) fail(400, `Campo inválido: ${field}`);
  return v;
}
function id(v, field) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) fail(400, `Campo inválido: ${field}`);
  return n;
}
function logo(v) {
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) fail(400, 'Logo inválido: envie uma imagem PNG, JPG ou WebP');
  if (v.length > MAX_LOGO) fail(400, 'Logo grande demais');
  return v;
}
function alerts(v) {
  const a = S.validAlerts(v);
  if (!a) fail(400, 'Alertas inválidos');
  return a;
}
function recurrence(body, current = {}) {
  const rec = oneOf(body.recurrence, 'repetição', Object.keys(S.RECURRENCE), current.recurrence || 'none');
  let every = null;
  if (rec === 'custom') {
    every = Number(body.recurrence_every ?? current.recurrence_every);
    if (!Number.isInteger(every) || every < 1 || every > 3650) fail(400, 'Repetição livre: informe a cada quantos dias (1 a 3650)');
  }
  return { rec, every };
}
function checkDates(start, due) {
  if (start && due && start > due) fail(400, 'A data de início não pode ser depois do prazo');
}

// ---------- permissões ----------
const isStaff = u => u.role === 'admin' || u.role === 'member';
function requireStaff(u) { if (!isStaff(u)) fail(403, 'Sem permissão'); }
function requireAdmin(u) { if (u.role !== 'admin') fail(403, 'Só administradores'); }

const assigneeIds = (db, taskId) => db.prepare('select user_id from task_assignees where task_id = ?').all(taskId).map(r => r.user_id);

// Toda leitura de tarefa passa por aqui: mesma organização e a regra de quem vê (shared.canSee).
function loadTask(db, user, taskId) {
  const t = db.prepare('select * from tasks where id = ? and org_id = ?').get(taskId, user.org_id);
  if (!t || !S.canSee(user, t, assigneeIds(db, t.id))) fail(404, 'Tarefa não encontrada');
  if (user.role === 'client' && t.archived_at) fail(404, 'Tarefa não encontrada');
  return t;
}
// Filtro SQL equivalente a shared.canSee, para listas.
function visibility(user) {
  if (user.role === 'client') return { sql: "t.kind = 'external' and t.client_id = ? and t.archived_at is null", args: [user.client_id] };
  if (user.role === 'admin') return { sql: '1 = 1', args: [] };
  return {
    sql: "(t.kind = 'external' or t.created_by = ? or exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id = ?))",
    args: [user.id, user.id],
  };
}
function checkClient(db, user, clientId) {
  if (!db.prepare('select 1 from clients where id = ? and org_id = ?').get(clientId, user.org_id)) fail(400, 'Cliente inválido');
}
function checkAssignees(db, user, ids) {
  if (!Array.isArray(ids)) fail(400, 'Campo inválido: responsáveis');
  const clean = [...new Set(ids.map(x => id(x, 'responsáveis')))];
  for (const uid of clean) {
    const u = db.prepare("select 1 from users where id = ? and org_id = ? and role != 'client' and active = 1").get(uid, user.org_id);
    if (!u) fail(400, 'Responsável inválido');
  }
  return clean;
}
function setAssignees(db, taskId, ids) {
  db.prepare('delete from task_assignees where task_id = ?').run(taskId);
  const ins = db.prepare('insert into task_assignees (task_id, user_id) values (?, ?)');
  for (const uid of ids) ins.run(taskId, uid);
}
const touch = (db, taskId) => db.prepare("update tasks set updated_at = datetime('now') where id = ?").run(taskId);

// Externa precisa de cliente. Interna pode ter um cliente relacionado ou nenhum (a própria consultoria).
function kindAndClient(db, user, kind, clientId) {
  if (kind === 'external' && !clientId) fail(400, 'Tarefa externa precisa de um cliente');
  if (clientId) checkClient(db, user, clientId);
  return clientId || null;
}

// Concluir: grava o término e, se a tarefa repete, cria a próxima com as datas avançadas.
function completeTask(db, t, completedOn, userId) {
  if (completedOn > S.today()) fail(400, 'A data de término não pode ser no futuro');
  if (t.start_date && completedOn < t.start_date) fail(400, 'A data de término não pode ser antes do início');
  return tx(db, () => {
    db.prepare("update tasks set status = 'done', completed_on = ?, progress = 100, updated_at = datetime('now') where id = ?").run(completedOn, t.id);
    if (t.recurrence === 'none' || t.next_task_id) return null;
    const next = d => S.nextDate(d, t.recurrence, t.recurrence_every);
    const nextStart = t.start_date ? next(t.start_date) : null;
    const nextDue = t.due_date ? next(t.due_date) : (t.start_date ? null : next(completedOn));
    const r = db.prepare(
      `insert into tasks (org_id, kind, client_id, title, description, start_date, due_date, priority, alerts, recurrence,
                          recurrence_every, position, created_by)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (select coalesce(max(position), 0) + 1 from tasks where org_id = ?), ?)`
    ).run(t.org_id, t.kind, t.client_id, t.title, t.description, nextStart, nextDue, t.priority, t.alerts, t.recurrence,
      t.recurrence_every, t.org_id, userId);
    const nextId = Number(r.lastInsertRowid);
    setAssignees(db, nextId, assigneeIds(db, t.id));
    db.prepare('insert into checklist_items (task_id, text, position) select ?, text, position from checklist_items where task_id = ?').run(nextId, t.id);
    db.prepare('update tasks set next_task_id = ? where id = ?').run(nextId, t.id);
    return nextId;
  });
}

// ---------- leitura ----------
function decorate(db, user, t, now) {
  const cl = db.prepare('select count(*) as total, coalesce(sum(done), 0) as done from checklist_items where task_id = ?').get(t.id);
  const adj = db.prepare(
    `select sum(origin = 'client') as client, sum(origin = 'internal') as internal, sum(resolved_at is null) as open
       from adjustments where task_id = ?`
  ).get(t.id);
  t.alerts = JSON.parse(t.alerts);
  const out = {
    id: t.id, kind: t.kind, client_id: t.client_id, client_name: t.client_name || null, status: t.status,
    column: S.column(t, now), title: t.title, start_date: t.start_date, due_date: t.due_date, completed_on: t.completed_on,
    progress: S.progress(t, cl.total, cl.done), progress_from_checklist: cl.total > 0, priority: t.priority,
    alerts: t.alerts, alert: S.alert(t, now), recurrence: t.recurrence, recurrence_every: t.recurrence_every,
    position: t.position, archived_at: t.archived_at, created_by: t.created_by, updated_at: t.updated_at,
    checklist_total: cl.total, checklist_done: cl.done,
    adjustments_client: adj.client || 0, adjustments_internal: adj.internal || 0, adjustments_open: adj.open || 0,
    assignees: db.prepare('select u.id, u.name from task_assignees a join users u on u.id = a.user_id where a.task_id = ? order by u.name').all(t.id),
  };
  if (user.role === 'client') { delete out.adjustments_internal; delete out.created_by; }
  return out;
}

function taskList(db, user, q) {
  const v = visibility(user);
  const where = ['t.org_id = ?', v.sql];
  const args = [user.org_id, ...v.args];
  const now = S.today();
  if (user.role !== 'client') {
    if (q.archived === '1') where.push('t.archived_at is not null'); else where.push('t.archived_at is null');
    if (q.kind) { where.push('t.kind = ?'); args.push(oneOf(q.kind, 'tipo', ['internal', 'external'])); }
    if (q.client_id === 'org') where.push('t.client_id is null');
    else if (q.client_id) { where.push('t.client_id = ?'); args.push(id(q.client_id, 'cliente')); }
  }
  const mine = q.mine === '1' ? user.id : (q.assignee ? id(q.assignee, 'responsável') : null);
  if (mine) { where.push('exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id = ?)'); args.push(mine); }
  if (q.due === 'overdue') { where.push("t.due_date < ? and t.status != 'done'"); args.push(now); }
  if (q.due === 'today') { where.push('t.due_date = ?'); args.push(now); }
  if (q.due === 'week') { where.push('t.due_date between ? and ?'); args.push(now, S.addDays(now, 7)); }
  if (q.due === 'month') { where.push('substr(t.due_date, 1, 7) = ?'); args.push(now.slice(0, 7)); }
  if (q.due === 'none') where.push('t.due_date is null');
  if (q.q) { where.push('t.title like ?'); args.push(`%${String(q.q).slice(0, 100)}%`); }
  return db.prepare(
    `select t.*, c.name as client_name from tasks t left join clients c on c.id = t.client_id
      where ${where.join(' and ')} order by t.position, t.id`
  ).all(...args).map(t => decorate(db, user, t, now));
}

function taskDetail(db, user, taskId) {
  const t = loadTask(db, user, taskId);
  t.client_name = t.client_id ? db.prepare('select name from clients where id = ?').get(t.client_id).name : null;
  const out = decorate(db, user, { ...t }, S.today());
  const client = user.role === 'client';
  out.description = t.description;
  out.next_task_id = t.next_task_id;
  out.checklist = db.prepare('select id, text, done from checklist_items where task_id = ? order by position, id').all(t.id);
  out.comments = db.prepare(
    `select c.id, c.body, c.visible_to_client, c.created_at, u.name as author, u.role as author_role
       from comments c left join users u on u.id = c.user_id
      where c.task_id = ? ${client ? 'and c.visible_to_client = 1' : ''} order by c.id`
  ).all(t.id);
  out.adjustments = db.prepare(
    `select a.id, a.origin, a.body, a.created_at, a.resolved_at, u.name as author
       from adjustments a left join users u on u.id = a.user_id
      where a.task_id = ? ${client ? "and a.origin = 'client'" : ''} order by a.id`
  ).all(t.id);
  return out;
}

// ---------- rotas ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '$');
  routes.push({ method, re, keys, handler, public: !!opts.public });
};

route('POST', '/api/login', ({ db, body, ip }) => {
  if (!auth.loginAllowed(ip)) fail(429, 'Muitas tentativas. Espere alguns minutos.');
  const email = str(body.email, 'email', { max: 200 });
  const password = str(body.password, 'senha', { max: 200 });
  const u = db.prepare('select id, pass_hash, active from users where email = ?').get(email);
  if (!u || !u.active || !auth.checkPassword(password, u.pass_hash)) {
    auth.recordFailedLogin(ip);
    fail(401, 'Email ou senha incorretos');
  }
  const s = auth.createSession(db, u.id);
  return reply(200, { ok: true }, `sid=${s.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${s.maxAge}`);
}, { public: true });

route('POST', '/api/logout', ({ db, token }) => {
  db.prepare('delete from sessions where token = ?').run(token);
  return reply(200, { ok: true }, 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
});

route('GET', '/api/me', ({ db, user }) => ({
  user,
  org: db.prepare('select id, name, accent, logo from orgs where id = ?').get(user.org_id),
  today: S.today(),
}));

route('POST', '/api/me/password', ({ db, user, body }) => {
  const current = str(body.current, 'senha atual', { max: 200 });
  const next = str(body.password, 'nova senha', { max: 200 });
  if (next.length < 8) fail(400, 'A nova senha precisa ter pelo menos 8 caracteres');
  const row = db.prepare('select pass_hash from users where id = ?').get(user.id);
  if (!auth.checkPassword(current, row.pass_hash)) fail(400, 'Senha atual incorreta');
  db.prepare('update users set pass_hash = ? where id = ?').run(auth.hashPassword(next), user.id);
  return { ok: true };
});

route('PATCH', '/api/org', ({ db, user, body }) => {
  requireAdmin(user);
  if ('name' in body) db.prepare('update orgs set name = ? where id = ?').run(str(body.name, 'nome', { max: 80 }), user.org_id);
  if ('accent' in body) {
    const accent = str(body.accent, 'cor', { max: 7 });
    if (!/^#[0-9a-fA-F]{6}$/.test(accent)) fail(400, 'Cor inválida (use #RRGGBB)');
    db.prepare('update orgs set accent = ? where id = ?').run(accent, user.org_id);
  }
  if ('logo' in body) db.prepare('update orgs set logo = ? where id = ?').run(logo(body.logo), user.org_id);
  return { ok: true };
});

route('GET', '/api/clients', ({ db, user }) => {
  if (user.role === 'client') return db.prepare('select id, name, logo from clients where id = ?').all(user.client_id);
  return db.prepare(
    `select c.id, c.name, c.logo,
       (select count(*) from tasks t where t.client_id = c.id and t.status != 'done' and t.archived_at is null and t.kind = 'external') as open_external,
       (select count(*) from tasks t where t.client_id = c.id and t.status != 'done' and t.archived_at is null and t.kind = 'internal') as open_internal
       from clients c where c.org_id = ? order by c.name`
  ).all(user.org_id);
});

route('POST', '/api/clients', ({ db, user, body }) => {
  requireAdmin(user);
  const r = db.prepare('insert into clients (org_id, name, logo) values (?, ?, ?)')
    .run(user.org_id, str(body.name, 'nome', { max: 120 }), body.logo ? logo(body.logo) : null);
  return reply(201, { id: Number(r.lastInsertRowid) });
});

route('PATCH', '/api/clients/:id', ({ db, user, body, params }) => {
  requireAdmin(user);
  checkClient(db, user, params.id);
  if ('name' in body) db.prepare('update clients set name = ? where id = ?').run(str(body.name, 'nome', { max: 120 }), params.id);
  if ('logo' in body) db.prepare('update clients set logo = ? where id = ?').run(logo(body.logo), params.id);
  return { ok: true };
});

route('GET', '/api/users', ({ db, user }) => {
  requireStaff(user);
  return db.prepare(
    `select u.id, u.name, u.email, u.role, u.client_id, c.name as client_name, u.active
       from users u left join clients c on c.id = u.client_id where u.org_id = ? order by u.role, u.name`
  ).all(user.org_id);
});

route('POST', '/api/users', ({ db, user, body }) => {
  requireAdmin(user);
  const name = str(body.name, 'nome', { max: 120 });
  const email = str(body.email, 'email', { max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Email inválido');
  const password = str(body.password, 'senha', { max: 200 });
  if (password.length < 8) fail(400, 'A senha precisa ter pelo menos 8 caracteres');
  const role = oneOf(body.role, 'papel', ['admin', 'member', 'client']);
  let clientId = null;
  if (role === 'client') { clientId = id(body.client_id, 'cliente'); checkClient(db, user, clientId); }
  if (db.prepare('select 1 from users where email = ?').get(email)) fail(409, 'Já existe um usuário com esse email');
  return reply(201, { id: createUser(db, { orgId: user.org_id, name, email, password, role, clientId }) });
});

route('PATCH', '/api/users/:id', ({ db, user, body, params }) => {
  requireAdmin(user);
  if (!db.prepare('select 1 from users where id = ? and org_id = ?').get(params.id, user.org_id)) fail(404, 'Usuário não encontrado');
  if (params.id === user.id) fail(400, 'Você não pode desativar a própria conta');
  const active = body.active ? 1 : 0;
  db.prepare('update users set active = ? where id = ?').run(active, params.id);
  if (!active) db.prepare('delete from sessions where user_id = ?').run(params.id);
  return { ok: true };
});

route('GET', '/api/tasks', ({ db, user, query }) => taskList(db, user, query));

route('GET', '/api/alerts', ({ db, user }) =>
  taskList(db, user, {}).filter(t => t.alert).sort((a, b) => a.alert.days - b.alert.days));

route('POST', '/api/tasks', ({ db, user, body }) => {
  requireStaff(user);
  if (body.kind === undefined) fail(400, 'Escolha se a tarefa é interna ou externa');
  const kind = oneOf(body.kind, 'tipo', ['internal', 'external']);
  const clientId = kindAndClient(db, user, kind, body.client_id ? id(body.client_id, 'cliente') : null);
  let title = str(body.title, 'título', { max: 200, required: !body.template_id });
  let description = str(body.description, 'descrição', { max: 10000, required: false });
  let checklist = [];
  if (body.template_id) {
    const tpl = db.prepare('select * from templates where id = ? and org_id = ?').get(id(body.template_id, 'modelo'), user.org_id);
    if (!tpl) fail(400, 'Modelo inválido');
    title = title || tpl.title;
    description = description || tpl.description;
    checklist = JSON.parse(tpl.checklist);
  }
  const start = date(body.start_date, 'Início');
  const due = date(body.due_date, 'Prazo');
  checkDates(start, due);
  const priority = oneOf(body.priority, 'prioridade', ['low', 'normal', 'high'], 'normal');
  const al = body.alerts === undefined ? [1] : alerts(body.alerts);
  const { rec, every } = recurrence(body);
  const assignees = checkAssignees(db, user, body.assignee_ids || []);
  const newId = tx(db, () => {
    const r = db.prepare(
      `insert into tasks (org_id, kind, client_id, title, description, start_date, due_date, priority, alerts, recurrence,
                          recurrence_every, position, created_by)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (select coalesce(max(position), 0) + 1 from tasks where org_id = ?), ?)`
    ).run(user.org_id, kind, clientId, title, description, start, due, priority, JSON.stringify(al), rec, every, user.org_id, user.id);
    const taskId = Number(r.lastInsertRowid);
    setAssignees(db, taskId, assignees);
    const ins = db.prepare('insert into checklist_items (task_id, text, position) values (?, ?, ?)');
    checklist.forEach((text, i) => ins.run(taskId, String(text).slice(0, 300), i));
    return taskId;
  });
  return reply(201, { id: newId });
});

route('GET', '/api/tasks/:id', ({ db, user, params }) => taskDetail(db, user, params.id));

route('PATCH', '/api/tasks/:id', ({ db, user, body, params }) => {
  requireStaff(user);
  const t = loadTask(db, user, params.id);
  tx(db, () => {
    const set = (col, val) => db.prepare(`update tasks set ${col} = ? where id = ?`).run(val, t.id);
    if ('title' in body) set('title', str(body.title, 'título', { max: 200 }));
    if ('description' in body) set('description', str(body.description, 'descrição', { max: 10000, required: false }));
    if ('kind' in body || 'client_id' in body) {
      const kind = 'kind' in body ? oneOf(body.kind, 'tipo', ['internal', 'external']) : t.kind;
      const clientId = 'client_id' in body ? (body.client_id ? id(body.client_id, 'cliente') : null) : t.client_id;
      set('kind', kind);
      set('client_id', kindAndClient(db, user, kind, clientId));
    }
    if ('start_date' in body || 'due_date' in body) {
      const start = 'start_date' in body ? date(body.start_date, 'Início') : t.start_date;
      const due = 'due_date' in body ? date(body.due_date, 'Prazo') : t.due_date;
      checkDates(start, due);
      set('start_date', start);
      set('due_date', due);
    }
    if ('priority' in body) set('priority', oneOf(body.priority, 'prioridade', ['low', 'normal', 'high']));
    if ('alerts' in body) set('alerts', JSON.stringify(alerts(body.alerts)));
    if ('recurrence' in body || 'recurrence_every' in body) {
      const { rec, every } = recurrence(body, t);
      set('recurrence', rec);
      set('recurrence_every', every);
    }
    if ('progress' in body) {
      const n = Number(body.progress);
      if (!Number.isInteger(n) || n < 0 || n > 100) fail(400, '% de execução deve ser de 0 a 100');
      if (db.prepare('select 1 from checklist_items where task_id = ?').get(t.id)) fail(409, 'Esta tarefa tem checklist: o % segue os itens marcados');
      set('progress', n);
    }
    if ('position' in body) {
      const p = Number(body.position);
      if (!Number.isFinite(p)) fail(400, 'Campo inválido: posição');
      set('position', p);
    }
    if ('assignee_ids' in body) setAssignees(db, t.id, checkAssignees(db, user, body.assignee_ids));
    if ('status' in body) {
      const status = oneOf(body.status, 'situação', ['todo', 'doing', 'review']);
      db.prepare('update tasks set status = ?, completed_on = null where id = ?').run(status, t.id);
    }
    touch(db, t.id);
  });
  return taskDetail(db, user, t.id);
});

route('POST', '/api/tasks/:id/complete', ({ db, user, body, params }) => {
  requireStaff(user);
  const t = loadTask(db, user, params.id);
  const nextId = completeTask(db, t, date(body.completed_on, 'Término') || S.today(), user.id);
  return { ...taskDetail(db, user, t.id), created_next_id: nextId };
});

route('POST', '/api/tasks/:id/archive', ({ db, user, body, params }) => {
  requireStaff(user);
  const t = loadTask(db, user, params.id);
  db.prepare("update tasks set archived_at = case when ? then datetime('now') else null end where id = ?").run(body.archived === false ? 0 : 1, t.id);
  return taskDetail(db, user, t.id);
});

route('DELETE', '/api/tasks/:id', ({ db, user, params }) => {
  requireAdmin(user);
  const t = loadTask(db, user, params.id);
  db.prepare('delete from tasks where id = ?').run(t.id);
  return { ok: true };
});

route('POST', '/api/tasks/:id/checklist', ({ db, user, body, params }) => {
  requireStaff(user);
  const t = loadTask(db, user, params.id);
  const text = str(body.text, 'item', { max: 300 });
  const pos = db.prepare('select coalesce(max(position), 0) + 1 as p from checklist_items where task_id = ?').get(t.id).p;
  db.prepare('insert into checklist_items (task_id, text, position) values (?, ?, ?)').run(t.id, text, pos);
  touch(db, t.id);
  return reply(201, taskDetail(db, user, t.id));
});

function loadChecklistItem(db, user, itemId) {
  const item = db.prepare('select id, task_id from checklist_items where id = ?').get(itemId);
  if (!item) fail(404, 'Item não encontrado');
  return { item, task: loadTask(db, user, item.task_id) };
}

route('PATCH', '/api/checklist/:id', ({ db, user, body, params }) => {
  requireStaff(user);
  const { item, task } = loadChecklistItem(db, user, params.id);
  if ('done' in body) db.prepare('update checklist_items set done = ? where id = ?').run(body.done ? 1 : 0, item.id);
  if ('text' in body) db.prepare('update checklist_items set text = ? where id = ?').run(str(body.text, 'item', { max: 300 }), item.id);
  touch(db, task.id);
  return taskDetail(db, user, task.id);
});

route('DELETE', '/api/checklist/:id', ({ db, user, params }) => {
  requireStaff(user);
  const { item, task } = loadChecklistItem(db, user, params.id);
  db.prepare('delete from checklist_items where id = ?').run(item.id);
  return taskDetail(db, user, task.id);
});

route('POST', '/api/tasks/:id/comments', ({ db, user, body, params }) => {
  const t = loadTask(db, user, params.id);
  const text = str(body.body, 'comentário', { max: 5000 });
  const visible = user.role === 'client' ? 1 : (t.kind === 'external' && body.visible_to_client ? 1 : 0);
  db.prepare('insert into comments (task_id, user_id, body, visible_to_client) values (?, ?, ?, ?)').run(t.id, user.id, text, visible);
  touch(db, t.id);
  return reply(201, taskDetail(db, user, t.id));
});

// Ajuste: interno quando vem da equipe, do cliente quando vem do cliente (só com a tarefa em revisão).
// Os dois devolvem a tarefa para "Em andamento".
route('POST', '/api/tasks/:id/adjustments', ({ db, user, body, params }) => {
  const t = loadTask(db, user, params.id);
  const text = str(body.body, 'o que ajustar', { max: 5000 });
  const origin = user.role === 'client' ? 'client' : 'internal';
  if (origin === 'client' && t.status !== 'review') fail(409, 'Só é possível pedir ajuste quando a tarefa está em revisão');
  if (t.status === 'done') fail(409, 'Reabra a tarefa antes de registrar um ajuste');
  tx(db, () => {
    db.prepare('insert into adjustments (task_id, origin, body, user_id) values (?, ?, ?, ?)').run(t.id, origin, text, user.id);
    db.prepare("update tasks set status = 'doing', updated_at = datetime('now') where id = ?").run(t.id);
  });
  return reply(201, taskDetail(db, user, t.id));
});

route('POST', '/api/adjustments/:id/resolve', ({ db, user, params }) => {
  requireStaff(user);
  const a = db.prepare('select id, task_id from adjustments where id = ?').get(params.id);
  if (!a) fail(404, 'Ajuste não encontrado');
  const t = loadTask(db, user, a.task_id);
  db.prepare("update adjustments set resolved_at = datetime('now') where id = ? and resolved_at is null").run(a.id);
  touch(db, t.id);
  return taskDetail(db, user, t.id);
});

route('POST', '/api/tasks/:id/approve', ({ db, user, params }) => {
  if (user.role !== 'client') fail(403, 'Só o cliente aprova a entrega');
  const t = loadTask(db, user, params.id);
  if (t.status !== 'review') fail(409, 'Esta tarefa não está esperando sua revisão');
  completeTask(db, t, S.today(), null);
  db.prepare("insert into comments (task_id, user_id, body, visible_to_client) values (?, ?, 'Entrega aprovada.', 1)").run(t.id, user.id);
  return taskDetail(db, user, t.id);
});

route('GET', '/api/templates', ({ db, user }) => {
  requireStaff(user);
  return db.prepare('select id, name, title, description, checklist from templates where org_id = ? order by name').all(user.org_id)
    .map(t => ({ ...t, checklist: JSON.parse(t.checklist) }));
});

route('POST', '/api/templates', ({ db, user, body }) => {
  requireStaff(user);
  const name = str(body.name, 'nome', { max: 120 });
  const title = str(body.title, 'título', { max: 200 });
  const description = str(body.description, 'descrição', { max: 10000, required: false });
  const items = Array.isArray(body.checklist) ? body.checklist.map(x => str(x, 'item', { max: 300 })).filter(Boolean).slice(0, 100) : [];
  const r = db.prepare('insert into templates (org_id, name, title, description, checklist) values (?, ?, ?, ?, ?)')
    .run(user.org_id, name, title, description, JSON.stringify(items));
  return reply(201, { id: Number(r.lastInsertRowid) });
});

route('DELETE', '/api/templates/:id', ({ db, user, params }) => {
  requireStaff(user);
  db.prepare('delete from templates where id = ? and org_id = ?').run(params.id, user.org_id);
  return { ok: true };
});

// Por cliente: tarefas, ajustes e entregas no prazo ou fora dele. Só o que a pessoa pode ver.
route('GET', '/api/report/adjustments', ({ db, user }) => {
  requireStaff(user);
  const tasks = taskList(db, user, {}).concat(taskList(db, user, { archived: '1' }));
  const org = db.prepare('select name from orgs where id = ?').get(user.org_id).name;
  const rows = new Map();
  const row = (key, name) => rows.get(key) || rows.set(key, { id: key, name, tasks: 0, internal: 0, client: 0, on_time: 0, late: 0 }).get(key);
  for (const c of db.prepare('select id, name from clients where org_id = ? order by name').all(user.org_id)) row(c.id, c.name);
  for (const t of tasks) {
    const r = row(t.client_id || 'org', t.client_id ? t.client_name : `${org} (interna)`);
    r.tasks++;
    r.internal += t.adjustments_internal;
    r.client += t.adjustments_client;
    if (t.column === 'done_on_time') r.on_time++;
    if (t.column === 'done_late') r.late++;
  }
  return [...rows.values()].sort((a, b) => b.client - a.client || b.internal - a.internal || a.name.localeCompare(b.name));
});

// ---------- HTTP ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Requisição grande demais')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function cookieToken(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

function send(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/shared.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(path.join(__dirname, 'shared.js')).pipe(res);
    return;
  }
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(400).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
    'X-Frame-Options': 'DENY',
  });
  fs.createReadStream(file).pipe(res);
}

function createHandler(db) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
      serveStatic(req, res);
      return;
    }
    try {
      const r = routes.find(x => x.method === req.method && x.re.test(url.pathname));
      if (!r) fail(404, 'Rota não encontrada');
      const params = {};
      const m = r.re.exec(url.pathname);
      r.keys.forEach((k, i) => { params[k] = Number(m[i + 1]); });

      let body = {};
      if (req.method !== 'GET') {
        // Contra CSRF: só aceita JSON e, se o navegador mandar Origin, ele tem de ser este mesmo servidor.
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) fail(403, 'Origem não permitida');
        const raw = await readBody(req);
        if (raw) {
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Envie JSON');
          try { body = JSON.parse(raw); } catch { fail(400, 'JSON inválido'); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'JSON inválido');
        }
      }

      const token = cookieToken(req);
      const user = auth.userFromToken(db, token);
      if (!r.public && !user) fail(401, 'Faça login');

      const out = r.handler({ db, user, body, params, query: Object.fromEntries(url.searchParams), token, ip: req.socket.remoteAddress });
      if (out && out[REPLY]) {
        const cookie = out.cookie && process.env.COOKIE_SECURE === '1' ? out.cookie + '; Secure' : out.cookie;
        send(res, out.code, out.body, cookie ? { 'Set-Cookie': cookie } : {});
      } else send(res, 200, out);
    } catch (err) {
      if (err instanceof HttpError) send(res, err.status, { error: err.message });
      else { console.error(err); send(res, 500, { error: 'Erro interno' }); }
    }
  };
}

module.exports = { createHandler };
