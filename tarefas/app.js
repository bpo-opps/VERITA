'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { tx, createUser } = require('./db');
const auth = require('./auth');

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const MAX_BODY = 256 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

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
function date(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(400, 'Data inválida (use AAAA-MM-DD)');
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

// ---------- permissões ----------
const isStaff = u => u.role === 'admin' || u.role === 'member';
function requireStaff(u) { if (!isStaff(u)) fail(403, 'Sem permissão'); }
function requireAdmin(u) { if (u.role !== 'admin') fail(403, 'Só administradores'); }

// Toda leitura de tarefa passa por aqui: mesma organização e, para cliente, só as do próprio cliente.
function loadTask(db, user, taskId) {
  const t = db.prepare(
    `select t.*, s.kind as stage_kind, c.name as client_name
       from tasks t join stages s on s.id = t.stage_id join clients c on c.id = t.client_id
      where t.id = ? and t.org_id = ?`
  ).get(taskId, user.org_id);
  if (!t || (user.role === 'client' && t.client_id !== user.client_id)) fail(404, 'Tarefa não encontrada');
  return t;
}
function stageByKind(db, orgId, kind) {
  return db.prepare('select id from stages where org_id = ? and kind = ?').get(orgId, kind).id;
}
function checkClient(db, user, clientId) {
  const c = db.prepare('select id from clients where id = ? and org_id = ?').get(clientId, user.org_id);
  if (!c) fail(400, 'Cliente inválido');
}
function checkAssignees(db, user, ids) {
  if (!Array.isArray(ids)) fail(400, 'Campo inválido: responsáveis');
  const clean = [...new Set(ids.map(x => id(x, 'responsáveis')))];
  for (const uid of clean) {
    const u = db.prepare("select id from users where id = ? and org_id = ? and role != 'client' and active = 1").get(uid, user.org_id);
    if (!u) fail(400, 'Responsável inválido');
  }
  return clean;
}
function setAssignees(db, taskId, ids) {
  db.prepare('delete from task_assignees where task_id = ?').run(taskId);
  const ins = db.prepare('insert into task_assignees (task_id, user_id) values (?, ?)');
  for (const uid of ids) ins.run(taskId, uid);
}
function touch(db, taskId) {
  db.prepare("update tasks set updated_at = datetime('now') where id = ?").run(taskId);
}
function moveTo(db, task, kind) {
  const stageId = stageByKind(db, task.org_id, kind);
  db.prepare(
    `update tasks set stage_id = ?, updated_at = datetime('now'),
       completed_at = case when ? = 'done' then datetime('now') else null end where id = ?`
  ).run(stageId, kind, task.id);
}

// ---------- leitura ----------
function taskSummaries(db, user, q) {
  const where = ['t.org_id = ?'];
  const args = [user.org_id];
  if (user.role === 'client') { where.push('t.client_id = ?'); args.push(user.client_id); }
  else if (q.client_id) { where.push('t.client_id = ?'); args.push(id(q.client_id, 'cliente')); }
  if (q.mine === '1') { where.push('exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id = ?)'); args.push(user.id); }
  if (q.assignee) { where.push('exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id = ?)'); args.push(id(q.assignee, 'responsável')); }
  if (q.due === 'overdue') where.push("t.due_date < date('now') and s.kind != 'done'");
  if (q.due === 'week') where.push("t.due_date between date('now') and date('now', '+7 day')");
  if (q.q) { where.push('t.title like ?'); args.push(`%${String(q.q).slice(0, 100)}%`); }
  const rows = db.prepare(
    `select t.id, t.client_id, c.name as client_name, t.stage_id, s.kind as stage_kind, t.title, t.due_date,
            t.priority, t.position, t.updated_at, t.completed_at,
            (select count(*) from checklist_items i where i.task_id = t.id) as checklist_total,
            (select count(*) from checklist_items i where i.task_id = t.id and i.done = 1) as checklist_done,
            (select count(*) from adjustments a where a.task_id = t.id and a.origin = 'client') as adjustments_client,
            (select count(*) from adjustments a where a.task_id = t.id and a.origin = 'internal') as adjustments_internal,
            (select count(*) from adjustments a where a.task_id = t.id and a.resolved_at is null) as adjustments_open
       from tasks t join stages s on s.id = t.stage_id join clients c on c.id = t.client_id
      where ${where.join(' and ')}
      order by t.position, t.id`
  ).all(...args);
  const assignees = db.prepare(
    'select a.user_id as id, u.name from task_assignees a join users u on u.id = a.user_id where a.task_id = ? order by u.name'
  );
  for (const r of rows) {
    r.assignees = assignees.all(r.id);
    if (user.role === 'client') { delete r.adjustments_internal; }
  }
  return rows;
}

function taskDetail(db, user, taskId) {
  const t = loadTask(db, user, taskId);
  const client = user.role === 'client';
  t.assignees = db.prepare(
    'select u.id, u.name from task_assignees a join users u on u.id = a.user_id where a.task_id = ? order by u.name'
  ).all(t.id);
  t.checklist = db.prepare('select id, text, done from checklist_items where task_id = ? order by position, id').all(t.id);
  t.comments = db.prepare(
    `select c.id, c.body, c.visible_to_client, c.created_at, u.name as author, u.role as author_role
       from comments c left join users u on u.id = c.user_id
      where c.task_id = ? ${client ? 'and c.visible_to_client = 1' : ''} order by c.id`
  ).all(t.id);
  t.adjustments = db.prepare(
    `select a.id, a.origin, a.body, a.created_at, a.resolved_at, u.name as author
       from adjustments a left join users u on u.id = a.user_id
      where a.task_id = ? ${client ? "and a.origin = 'client'" : ''} order by a.id`
  ).all(t.id);
  delete t.org_id;
  return t;
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
  return { status: 200, body: { ok: true }, cookie: `sid=${s.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${s.maxAge}` };
}, { public: true });

route('POST', '/api/logout', ({ db, token }) => {
  db.prepare('delete from sessions where token = ?').run(token);
  return { status: 200, body: { ok: true }, cookie: 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' };
});

route('GET', '/api/me', ({ db, user }) => ({
  user,
  org: db.prepare('select id, name, accent from orgs where id = ?').get(user.org_id),
  stages: db.prepare('select id, name, kind from stages where org_id = ? order by position').all(user.org_id),
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
  const name = str(body.name, 'nome', { max: 80 });
  const accent = str(body.accent, 'cor', { max: 7 });
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) fail(400, 'Cor inválida (use #RRGGBB)');
  db.prepare('update orgs set name = ?, accent = ? where id = ?').run(name, accent, user.org_id);
  return { ok: true };
});

route('GET', '/api/clients', ({ db, user }) => {
  if (user.role === 'client') return db.prepare('select id, name from clients where id = ?').all(user.client_id);
  return db.prepare(
    `select c.id, c.name,
       (select count(*) from tasks t join stages s on s.id = t.stage_id where t.client_id = c.id and s.kind != 'done') as open_tasks
       from clients c where c.org_id = ? order by c.name`
  ).all(user.org_id);
});

route('POST', '/api/clients', ({ db, user, body }) => {
  requireAdmin(user);
  const name = str(body.name, 'nome', { max: 120 });
  const r = db.prepare('insert into clients (org_id, name) values (?, ?)').run(user.org_id, name);
  return { status: 201, body: { id: Number(r.lastInsertRowid) } };
});

route('PATCH', '/api/clients/:id', ({ db, user, body, params }) => {
  requireAdmin(user);
  checkClient(db, user, params.id);
  db.prepare('update clients set name = ? where id = ?').run(str(body.name, 'nome', { max: 120 }), params.id);
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
  const newId = createUser(db, { orgId: user.org_id, name, email, password, role, clientId });
  return { status: 201, body: { id: newId } };
});

route('PATCH', '/api/users/:id', ({ db, user, body, params }) => {
  requireAdmin(user);
  const target = db.prepare('select id from users where id = ? and org_id = ?').get(params.id, user.org_id);
  if (!target) fail(404, 'Usuário não encontrado');
  if (params.id === user.id) fail(400, 'Você não pode desativar a própria conta');
  const active = body.active ? 1 : 0;
  db.prepare('update users set active = ? where id = ?').run(active, params.id);
  if (!active) db.prepare('delete from sessions where user_id = ?').run(params.id);
  return { ok: true };
});

route('GET', '/api/tasks', ({ db, user, query }) => taskSummaries(db, user, query));

route('POST', '/api/tasks', ({ db, user, body }) => {
  requireStaff(user);
  const clientId = id(body.client_id, 'cliente');
  checkClient(db, user, clientId);
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
  const due = date(body.due_date);
  const priority = oneOf(body.priority, 'prioridade', ['low', 'normal', 'high'], 'normal');
  const assignees = checkAssignees(db, user, body.assignee_ids || []);
  const newId = tx(db, () => {
    const pos = db.prepare('select coalesce(max(position), 0) + 1 as p from tasks where org_id = ?').get(user.org_id).p;
    const r = db.prepare(
      `insert into tasks (org_id, client_id, stage_id, title, description, due_date, priority, position, created_by)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(user.org_id, clientId, stageByKind(db, user.org_id, 'todo'), title, description, due, priority, pos, user.id);
    const taskId = Number(r.lastInsertRowid);
    setAssignees(db, taskId, assignees);
    const ins = db.prepare('insert into checklist_items (task_id, text, position) values (?, ?, ?)');
    checklist.forEach((text, i) => ins.run(taskId, String(text).slice(0, 300), i));
    return taskId;
  });
  return { status: 201, body: { id: newId } };
});

route('GET', '/api/tasks/:id', ({ db, user, params }) => taskDetail(db, user, params.id));

route('PATCH', '/api/tasks/:id', ({ db, user, body, params }) => {
  requireStaff(user);
  const t = loadTask(db, user, params.id);
  tx(db, () => {
    const set = (col, val) => db.prepare(`update tasks set ${col} = ? where id = ?`).run(val, t.id);
    if ('title' in body) set('title', str(body.title, 'título', { max: 200 }));
    if ('description' in body) set('description', str(body.description, 'descrição', { max: 10000, required: false }));
    if ('due_date' in body) set('due_date', date(body.due_date));
    if ('priority' in body) set('priority', oneOf(body.priority, 'prioridade', ['low', 'normal', 'high']));
    if ('position' in body) {
      const p = Number(body.position);
      if (!Number.isFinite(p)) fail(400, 'Campo inválido: posição');
      set('position', p);
    }
    if ('client_id' in body) { const c = id(body.client_id, 'cliente'); checkClient(db, user, c); set('client_id', c); }
    if ('assignee_ids' in body) setAssignees(db, t.id, checkAssignees(db, user, body.assignee_ids));
    if ('stage_id' in body) {
      const s = db.prepare('select kind from stages where id = ? and org_id = ?').get(id(body.stage_id, 'etapa'), user.org_id);
      if (!s) fail(400, 'Etapa inválida');
      moveTo(db, t, s.kind);
    }
    touch(db, t.id);
  });
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
  return { status: 201, body: taskDetail(db, user, t.id) };
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
  const visible = user.role === 'client' ? 1 : (body.visible_to_client ? 1 : 0);
  db.prepare('insert into comments (task_id, user_id, body, visible_to_client) values (?, ?, ?, ?)').run(t.id, user.id, text, visible);
  touch(db, t.id);
  return { status: 201, body: taskDetail(db, user, t.id) };
});

// Ajuste: interno quando vem da equipe, do cliente quando vem do cliente. Os dois levam a tarefa para "Em ajuste".
route('POST', '/api/tasks/:id/adjustments', ({ db, user, body, params }) => {
  const t = loadTask(db, user, params.id);
  const text = str(body.body, 'o que ajustar', { max: 5000 });
  const origin = user.role === 'client' ? 'client' : 'internal';
  if (origin === 'client' && t.stage_kind !== 'client') fail(409, 'Só é possível pedir ajuste quando a tarefa está com você para revisão');
  tx(db, () => {
    db.prepare('insert into adjustments (task_id, origin, body, user_id) values (?, ?, ?, ?)').run(t.id, origin, text, user.id);
    moveTo(db, t, 'adjust');
  });
  return { status: 201, body: taskDetail(db, user, t.id) };
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
  if (t.stage_kind !== 'client') fail(409, 'Esta tarefa não está aguardando sua aprovação');
  tx(db, () => {
    moveTo(db, t, 'done');
    db.prepare("insert into comments (task_id, user_id, body, visible_to_client) values (?, ?, 'Entrega aprovada.', 1)").run(t.id, user.id);
  });
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
  return { status: 201, body: { id: Number(r.lastInsertRowid) } };
});

route('DELETE', '/api/templates/:id', ({ db, user, params }) => {
  requireStaff(user);
  db.prepare('delete from templates where id = ? and org_id = ?').run(params.id, user.org_id);
  return { ok: true };
});

route('GET', '/api/report/adjustments', ({ db, user }) => {
  requireStaff(user);
  return db.prepare(
    `select c.id, c.name,
       count(distinct t.id) as tasks,
       sum(case when a.origin = 'internal' then 1 else 0 end) as internal,
       sum(case when a.origin = 'client' then 1 else 0 end) as client
       from clients c
       left join tasks t on t.client_id = c.id
       left join adjustments a on a.task_id = t.id
      where c.org_id = ? group by c.id order by client desc, internal desc, c.name`
  ).all(user.org_id);
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
      if (out && out.status) {
        const cookie = out.cookie && process.env.COOKIE_SECURE === '1' ? out.cookie + '; Secure' : out.cookie;
        send(res, out.status, out.body, cookie ? { 'Set-Cookie': cookie } : {});
      }
      else send(res, 200, out);
    } catch (err) {
      if (err instanceof HttpError) send(res, err.status, { error: err.message });
      else { console.error(err); send(res, 500, { error: 'Erro interno' }); }
    }
  };
}

module.exports = { createHandler };
