'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { tx, createUser } = require('./db');
const auth = require('./auth');
const S = require('./shared');
const whatsapp = require('./whatsapp');

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const MAX_BODY = 512 * 1024;
const MAX_LOGO = 300 * 1024;
const MAX_PDF = 15 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
// Resposta com código ou cookie diferente do padrão (200, sem cookie).
const REPLY = Symbol('reply');
// Motor de avisos (notify.js); o servidor passa em createHandler. Sem ele, nada é enviado.
let notifier = null;
// Leitura das atas pela IA: async ({ pdf, meeting, attendees, others, clients }) => { summary, tasks }. null = desligada.
let extractor = null;
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
  if (user.role === 'client') {
    return { sql: "t.client_id = ? and (t.kind = 'external' or t.client_visible = 1) and t.archived_at is null", args: [user.client_id] };
  }
  const own = 't.created_by = ? or exists (select 1 from task_assignees a where a.task_id = t.id and a.user_id = ?)';
  if (user.role === 'admin') return { sql: `(${own} or t.kind = 'external' or t.team_visible = 1)`, args: [user.id, user.id] };
  return {
    sql: `(${own} or (t.team_visible = 1 and ((t.kind = 'internal' and t.client_id is null)
      or exists (select 1 from user_clients uc where uc.user_id = ? and uc.client_id = t.client_id))))`,
    args: [user.id, user.id, user.id],
  };
}
function checkClient(db, user, clientId) {
  if (!db.prepare('select 1 from clients where id = ? and org_id = ?').get(clientId, user.org_id)) fail(400, 'Cliente inválido');
}
// Responsáveis: pessoas da equipe e, quando a tarefa aparece para o cliente, pessoas daquele cliente.
// Responsáveis: sem empresa, qualquer pessoa da equipe. Com empresa: os administradores, quem da equipe
// acompanha aquele cliente e, quando a tarefa aparece para o cliente, as pessoas dele.
// Quem já era responsável pode continuar (`keep`), mesmo que a regra tenha mudado depois.
function checkAssignees(db, user, ids, task, keep = []) {
  if (!Array.isArray(ids)) fail(400, 'Campo inválido: responsáveis');
  const clean = [...new Set(ids.map(x => id(x, 'responsáveis')))];
  for (const uid of clean) {
    const u = db.prepare('select id, role, client_id from users where id = ? and org_id = ? and active = 1').get(uid, user.org_id);
    if (!u) fail(400, 'Responsável inválido');
    if (keep.includes(uid)) continue;
    if (u.role === 'client' && !(task && S.clientAssignable(u, task))) fail(400, 'A pessoa do cliente só pode ser responsável por tarefa da empresa dela que ela vê');
    if (u.role === 'member' && task?.client_id && !clientIdsOf(db, u.id).includes(Number(task.client_id))) {
      fail(400, 'Essa pessoa da equipe não acompanha este cliente (Clientes → Equipe)');
    }
  }
  return clean;
}
// Ao mudar tipo, empresa ou visibilidade, tira de responsável quem do cliente deixou de poder ser.
function dropInvalidClientAssignees(db, taskId) {
  const t = db.prepare('select * from tasks where id = ?').get(taskId);
  for (const u of db.prepare("select u.id, u.role, u.client_id from task_assignees a join users u on u.id = a.user_id where a.task_id = ? and u.role = 'client'").all(taskId)) {
    if (!S.clientAssignable(u, t)) db.prepare('delete from task_assignees where task_id = ? and user_id = ?').run(taskId, u.id);
  }
}
const nameOf = (db, userId) => (userId ? (db.prepare('select name from users where id = ?').get(userId) || {}).name || null : null);
const clientIdsOf = (db, userId) => db.prepare('select client_id from user_clients where user_id = ?').all(userId).map(r => r.client_id);
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
// "Visível para o cliente" só existe em interna ligada a um cliente.
const clientVisible = (kind, clientId, flag) => (kind === 'internal' && clientId && flag ? 1 : 0);
// "A equipe vê": se não vier, externa sim e interna não.
const teamVisible = (kind, flag) => (flag === undefined || flag === null ? (kind === 'external' ? 1 : 0) : (flag ? 1 : 0));
function checklistItems(v) {
  if (v === undefined) return null;
  if (!Array.isArray(v)) fail(400, 'Checklist inválido');
  return v.map(x => str(x, 'item do checklist', { max: 300, required: false })).filter(Boolean).slice(0, 100);
}

// Concluir: grava o término e, se a tarefa repete, cria a próxima com as datas avançadas.
function completeTask(db, t, completedOn, userId) {
  if (completedOn > S.today()) fail(400, 'A data de término não pode ser no futuro');
  if (t.start_date && completedOn < t.start_date) fail(400, 'A data de término não pode ser antes do início');
  return tx(db, () => {
    db.prepare(
      `update tasks set status = 'done', completed_on = ?, cancelled_on = null, cancel_reason = null, progress = 100, stage_id = null,
         completed_by = ?, cancelled_by = null, updated_at = datetime('now') where id = ?`
    ).run(completedOn, userId, t.id);
    if (t.recurrence === 'none' || t.next_task_id) return null;
    // O início fica vazio: ele é preenchido quando alguém começar a próxima.
    const nextDue = S.nextDate(t.due_date || completedOn, t.recurrence, t.recurrence_every);
    const r = db.prepare(
      `insert into tasks (org_id, kind, client_id, client_visible, title, description, due_date, priority, alerts, recurrence,
                          recurrence_every, position, created_by, team_visible)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (select coalesce(max(position), 0) + 1 from tasks where org_id = ?), ?, ?)`
    ).run(t.org_id, t.kind, t.client_id, t.client_visible, t.title, t.description, nextDue, t.priority, t.alerts, t.recurrence,
      t.recurrence_every, t.org_id, t.created_by ?? userId, t.team_visible ?? 0);
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
    id: t.id, kind: t.kind, client_id: t.client_id, client_name: t.client_name || null, client_visible: S.clientSees(t), status: t.status,
    column: S.column(t, now), stage_id: t.stage_id || null, team_visible: !!t.team_visible, title: t.title,
    started_by_name: nameOf(db, t.started_by), completed_by_name: nameOf(db, t.completed_by), cancelled_by_name: nameOf(db, t.cancelled_by),
    created_at: t.created_at, created_by_name: nameOf(db, t.created_by), start_date: t.start_date, due_date: t.due_date, completed_on: t.completed_on,
    cancelled_on: t.cancelled_on, cancel_reason: t.cancel_reason,
    progress: S.progress(t, cl.total, cl.done), progress_from_checklist: cl.total > 0, priority: t.priority,
    alerts: t.alerts, alert: S.alert(t, now), recurrence: t.recurrence, recurrence_every: t.recurrence_every,
    position: t.position, archived_at: t.archived_at, created_by: t.created_by, updated_at: t.updated_at,
    checklist_total: cl.total, checklist_done: cl.done,
    adjustments_client: adj.client || 0, adjustments_internal: adj.internal || 0, adjustments_open: adj.open || 0,
    assignees: db.prepare('select u.id, u.name, u.role from task_assignees a join users u on u.id = a.user_id where a.task_id = ? order by u.name').all(t.id),
    attachments_count: db.prepare(`select count(*) as n from attachments where task_id = ?${user.role === 'client' ? ' and visible_to_client = 1' : ''}`).get(t.id).n,
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
  if (q.due === 'overdue') { where.push("t.due_date < ? and t.status not in ('done', 'cancelled')"); args.push(now); }
  if (q.due === 'today') { where.push('t.due_date = ?'); args.push(now); }
  if (q.due === 'week') { where.push('t.due_date between ? and ?'); args.push(now, S.addDays(now, 7)); }
  if (q.due === 'month') { where.push('substr(t.due_date, 1, 7) = ?'); args.push(now.slice(0, 7)); }
  if (q.due === 'none') where.push('t.due_date is null');
  if (q.q) { where.push('t.title like ?'); args.push(`%${String(q.q).slice(0, 100)}%`); }
  if (q.recurring === '1') where.push("t.recurrence != 'none'");
  if (q.recurring === '0') where.push("t.recurrence = 'none'");
  return db.prepare(
    `select t.*, c.name as client_name from tasks t left join clients c on c.id = t.client_id
      where ${where.join(' and ')}
      order by t.due_date is null, t.due_date, case t.priority when 'high' then 0 when 'normal' then 1 else 2 end, t.id`
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
  out.attachments = db.prepare(
    `select a.id, a.name, a.mime, a.size, a.visible_to_client, a.created_at, a.user_id, u.name as author
       from attachments a left join users u on u.id = a.user_id
      where a.task_id = ? ${client ? 'and a.visible_to_client = 1' : ''} order by a.id`
  ).all(t.id).map(a => ({ ...a, visible_to_client: !!a.visible_to_client }));
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
  routes.push({ method, re, keys, handler, public: !!opts.public, maxBody: opts.maxBody || MAX_BODY });
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

// Preferências de aviso de cada pessoa. WhatsApp exige número e autorização (LGPD).
route('GET', '/api/me/notify', ({ db, user }) => {
  const u = db.prepare('select email, phone, notify_email, notify_whatsapp, whatsapp_consent_at from users where id = ?').get(user.id);
  return { email: u.email, phone: u.phone, notify_email: !!u.notify_email, notify_whatsapp: !!u.notify_whatsapp, whatsapp_consent: !!u.whatsapp_consent_at,
    channels: notifier ? { email: notifier.status().email.configured, whatsapp: notifier.status().whatsapp.configured } : { email: false, whatsapp: false } };
});

route('PATCH', '/api/me/notify', ({ db, user, body }) => {
  const cur = db.prepare('select phone, notify_email, notify_whatsapp, whatsapp_consent_at from users where id = ?').get(user.id);
  let phone = cur.phone;
  if ('phone' in body) {
    phone = whatsapp.normalizePhone(body.phone);
    if (phone === undefined) fail(400, 'Celular inválido: use DDD e número, por exemplo (11) 98765-4321');
  }
  let consentAt = cur.whatsapp_consent_at;
  if ('consent' in body) consentAt = body.consent ? (consentAt || new Date().toISOString()) : null;
  const email = 'notify_email' in body ? (body.notify_email ? 1 : 0) : cur.notify_email;
  let wa = 'notify_whatsapp' in body ? (body.notify_whatsapp ? 1 : 0) : cur.notify_whatsapp;
  // Pedir WhatsApp exige celular e autorização; tirar um dos dois desliga o WhatsApp.
  if ('notify_whatsapp' in body && wa && !phone) fail(400, 'Para receber no WhatsApp, informe o celular');
  if ('notify_whatsapp' in body && wa && !consentAt) fail(400, 'Para receber no WhatsApp, marque a autorização');
  if (!phone || !consentAt) wa = 0;
  db.prepare('update users set phone = ?, whatsapp_consent_at = ?, notify_email = ?, notify_whatsapp = ? where id = ?').run(phone, consentAt, email, wa, user.id);
  return { ok: true };
});

route('GET', '/api/notify/status', ({ user }) => {
  requireAdmin(user);
  return notifier ? notifier.status() : { email: { configured: false }, whatsapp: { configured: false }, app_url: null, schedule: null };
});

route('GET', '/api/notifications', ({ db, user }) => {
  requireAdmin(user);
  return db.prepare(
    `select n.id, n.channel, n.kind, n.subject, n.body, n.status, n.error, n.created_at, n.sent_at, n.task_id,
            u.name as user_name, u.role as user_role, t.title as task_title
       from notifications n join users u on u.id = n.user_id left join tasks t on t.id = n.task_id
      where n.org_id = ? order by n.id desc limit 200`
  ).all(user.org_id);
});

route('POST', '/api/notifications/run', async ({ user }) => {
  requireAdmin(user);
  if (!notifier) fail(503, 'Avisos desligados neste servidor');
  return { sent: await notifier.tick() };
});

route('POST', '/api/notifications/test', async ({ db, user }) => {
  requireAdmin(user);
  if (!notifier) fail(503, 'Avisos desligados neste servidor');
  return notifier.testEmail(db.prepare('select * from users where id = ?').get(user.id));
});

// ---------- reuniões: ata em PDF -> triagem -> tarefas ----------
const ITEM_FIELDS = 'id, meeting_id, title, description, kind, client_id, client_visible, assignee_ids, client_responsible, due_date, priority, checklist, quote, status, task_id, decided_at';
const itemOut = it => ({ ...it, client_visible: !!it.client_visible, assignee_ids: JSON.parse(it.assignee_ids), checklist: JSON.parse(it.checklist) });
function loadMeeting(db, user, meetingId) {
  requireStaff(user);
  const m = db.prepare('select id, org_id, title, meeting_date, client_id, attendee_ids, other_attendees, pdf_name, summary, status, error, created_by, created_at from meetings where id = ? and org_id = ?').get(meetingId, user.org_id);
  if (!m) fail(404, 'Reunião não encontrada');
  return { ...m, attendee_ids: JSON.parse(m.attendee_ids) };
}
function loadItem(db, user, itemId) {
  const it = db.prepare(`select ${ITEM_FIELDS} from meeting_items where id = ?`).get(itemId);
  if (!it) fail(404, 'Tarefa sugerida não encontrada');
  loadMeeting(db, user, it.meeting_id);
  return it;
}
function meetingDetail(db, user, meetingId) {
  const m = loadMeeting(db, user, meetingId);
  const items = db.prepare(`select ${ITEM_FIELDS} from meeting_items where meeting_id = ? order by position, id`).all(meetingId).map(itemOut);
  return { ...m, items, ai: !!extractor };
}
function aiError(e) {
  if (e.status === 401 || e.status === 403) return 'A chave da IA (ANTHROPIC_API_KEY) foi recusada. Confira a chave no servidor.';
  if (e.status === 429) return 'A IA está ocupada agora. Clique em "Ler de novo" daqui a pouco.';
  if (e.status === 413 || e.status === 400) return 'A IA não conseguiu abrir este PDF. Confira se é a ata exportada do Google (PDF com texto) e tente de novo.';
  if (e.status >= 500 || e.name === 'APIConnectionError') return 'A IA não respondeu. Clique em "Ler de novo" daqui a pouco.';
  return e.message || 'Falha ao ler a ata';
}
async function processMeeting(db, meetingId) {
  const m = db.prepare('select * from meetings where id = ?').get(meetingId);
  if (!m) return;
  const setStatus = (status, error = null) => db.prepare('update meetings set status = ?, error = ? where id = ?').run(status, error, meetingId);
  if (!extractor) { setStatus('error', 'A leitura por IA não está ligada neste servidor (falta ANTHROPIC_API_KEY). Lance as tarefas à mão aqui embaixo.'); return; }
  const ids = JSON.parse(m.attendee_ids);
  const attendees = ids.map(uid => db.prepare('select id, name, role, client_id from users where id = ? and org_id = ?').get(uid, m.org_id)).filter(Boolean);
  const clients = db.prepare('select id, name from clients where org_id = ? order by name').all(m.org_id);
  const meeting = { title: m.title, meeting_date: m.meeting_date, client_id: m.client_id };
  try {
    const out = await extractor({ pdf: m.pdf, meeting, attendees, others: m.other_attendees, clients });
    const items = out.tasks.map(t => require('./meetings').sanitize(t, { meeting, attendees, clients }));
    // Da equipe, só fica responsável quem pode ser: em tarefa de cliente, quem acompanha o cliente (ou administrador).
    for (const it of items) {
      it.assignee_ids = it.assignee_ids.filter(uid => {
        const u = attendees.find(x => x.id === uid);
        return !u || u.role !== 'member' || !it.client_id || clientIdsOf(db, uid).includes(it.client_id);
      });
    }
    tx(db, () => {
      db.prepare("delete from meeting_items where meeting_id = ? and status = 'pending'").run(meetingId);
      const base = db.prepare('select coalesce(max(position), 0) as p from meeting_items where meeting_id = ?').get(meetingId).p;
      const ins = db.prepare(`insert into meeting_items (meeting_id, title, description, kind, client_id, assignee_ids, client_responsible, due_date, priority, checklist, quote, position)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      items.forEach((t, i) => ins.run(meetingId, t.title, t.description, t.kind, t.client_id, JSON.stringify(t.assignee_ids), t.client_responsible,
        t.due_date, t.priority, JSON.stringify(t.checklist), t.quote, base + i + 1));
      db.prepare("update meetings set status = 'ready', error = null, summary = ? where id = ?").run(out.summary.slice(0, 2000), meetingId);
    });
  } catch (e) {
    console.error(`Leitura da ata ${meetingId}:`, e.message);
    setStatus('error', aiError(e));
  }
}
function attendeeList(db, user, v) {
  if (!Array.isArray(v)) fail(400, 'Marque quem estava presente');
  const ids = [...new Set(v.map(x => id(x, 'participantes')))];
  for (const uid of ids) if (!db.prepare('select 1 from users where id = ? and org_id = ?').get(uid, user.org_id)) fail(400, 'Participante inválido');
  return ids;
}
function pdfBuffer(v) {
  if (typeof v !== 'string' || !v) fail(400, 'Anexe o PDF da reunião');
  const b64 = v.replace(/^data:application\/pdf;base64,/, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) fail(400, 'PDF inválido');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_PDF) fail(400, 'PDF grande demais (máximo 15 MB)');
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') fail(400, 'O arquivo não é um PDF');
  return buf;
}

route('GET', '/api/meetings', ({ db, user }) => {
  requireStaff(user);
  return db.prepare(
    `select m.id, m.title, m.meeting_date, m.client_id, c.name as client_name, m.status, m.error, m.attendee_ids,
            (select count(*) from meeting_items i where i.meeting_id = m.id and i.status = 'pending') as pending,
            (select count(*) from meeting_items i where i.meeting_id = m.id and i.status = 'approved') as approved,
            (select count(*) from meeting_items i where i.meeting_id = m.id and i.status = 'discarded') as discarded
       from meetings m left join clients c on c.id = m.client_id
      where m.org_id = ? order by m.meeting_date desc, m.id desc`
  ).all(user.org_id).map(m => ({ ...m, attendee_ids: JSON.parse(m.attendee_ids) }));
});

route('POST', '/api/meetings', ({ db, user, body }) => {
  requireStaff(user);
  const title = str(body.title, 'título', { max: 200 });
  const meetingDate = date(body.meeting_date, 'Data da reunião');
  if (!meetingDate) fail(400, 'Informe a data da reunião');
  const clientId = body.client_id ? id(body.client_id, 'cliente') : null;
  if (clientId) checkClient(db, user, clientId);
  const attendees = attendeeList(db, user, body.attendee_ids || []);
  const others = str(body.other_attendees, 'outros participantes', { max: 1000, required: false });
  if (!attendees.length && !others) fail(400, 'Marque quem estava presente');
  const pdf = pdfBuffer(body.pdf);
  const name = str(body.pdf_name, 'nome do arquivo', { max: 200, required: false }) || 'ata.pdf';
  const r = db.prepare(`insert into meetings (org_id, title, meeting_date, client_id, attendee_ids, other_attendees, pdf, pdf_name, created_by)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.org_id, title, meetingDate, clientId, JSON.stringify(attendees), others, pdf, name, user.id);
  const meetingId = Number(r.lastInsertRowid);
  // A leitura leva de segundos a um ou dois minutos: roda por trás e a tela acompanha pelo status.
  processMeeting(db, meetingId).catch(e => console.error(e));
  return reply(201, { id: meetingId });
}, { maxBody: Math.ceil(MAX_PDF * 1.4) + 64 * 1024 });

route('GET', '/api/meetings/:id', ({ db, user, params }) => meetingDetail(db, user, params.id));

route('GET', '/api/meetings/:id/pdf', ({ db, user, params }) => {
  loadMeeting(db, user, params.id);
  const m = db.prepare('select pdf, pdf_name from meetings where id = ?').get(params.id);
  if (!m.pdf) fail(404, 'PDF não encontrado');
  return { name: m.pdf_name, data: Buffer.from(m.pdf).toString('base64') };
});

route('POST', '/api/meetings/:id/process', ({ db, user, params }) => {
  const m = loadMeeting(db, user, params.id);
  if (m.status === 'processing') fail(409, 'A ata já está sendo lida');
  db.prepare("update meetings set status = 'processing', error = null where id = ?").run(params.id);
  processMeeting(db, params.id).catch(e => console.error(e));
  return meetingDetail(db, user, params.id);
});

route('PATCH', '/api/meetings/:id', ({ db, user, params, body }) => {
  const m = loadMeeting(db, user, params.id);
  const title = 'title' in body ? str(body.title, 'título', { max: 200 }) : m.title;
  const meetingDate = 'meeting_date' in body ? date(body.meeting_date, 'Data da reunião') || m.meeting_date : m.meeting_date;
  const attendees = 'attendee_ids' in body ? attendeeList(db, user, body.attendee_ids) : m.attendee_ids;
  const others = 'other_attendees' in body ? str(body.other_attendees, 'outros participantes', { max: 1000, required: false }) : m.other_attendees;
  db.prepare('update meetings set title = ?, meeting_date = ?, attendee_ids = ?, other_attendees = ? where id = ?')
    .run(title, meetingDate, JSON.stringify(attendees), others, params.id);
  return meetingDetail(db, user, params.id);
});

route('DELETE', '/api/meetings/:id', ({ db, user, params }) => {
  const m = loadMeeting(db, user, params.id);
  if (user.role !== 'admin' && m.created_by !== user.id) fail(403, 'Só quem lançou a reunião ou um administrador pode apagar');
  // As tarefas já lançadas continuam; some só a reunião, o PDF e as sugestões.
  db.prepare('delete from meetings where id = ?').run(params.id);
  return { ok: true };
});

// Tarefa sugerida à mão, quando a IA deixou passar alguma.
route('POST', '/api/meetings/:id/items', ({ db, user, params, body }) => {
  const m = loadMeeting(db, user, params.id);
  const title = str(body.title, 'título', { max: 200 });
  const pos = db.prepare('select coalesce(max(position), 0) + 1 as p from meeting_items where meeting_id = ?').get(params.id).p;
  const kind = m.client_id ? 'external' : 'internal';
  const r = db.prepare('insert into meeting_items (meeting_id, title, kind, client_id, position) values (?, ?, ?, ?, ?)').run(params.id, title, kind, m.client_id, pos);
  return itemOut(db.prepare(`select ${ITEM_FIELDS} from meeting_items where id = ?`).get(Number(r.lastInsertRowid)));
});

route('PATCH', '/api/meeting-items/:id', ({ db, user, params, body }) => {
  const it = loadItem(db, user, params.id);
  if (it.status === 'approved') fail(409, 'Esta tarefa já foi lançada; edite no quadro de tarefas');
  const kind = oneOf(body.kind, 'tipo', ['internal', 'external'], it.kind);
  const clientId = 'client_id' in body ? (body.client_id ? id(body.client_id, 'cliente') : null) : it.client_id;
  if (clientId) checkClient(db, user, clientId);
  const v = {
    title: 'title' in body ? str(body.title, 'título', { max: 200 }) : it.title,
    description: 'description' in body ? str(body.description, 'descrição', { max: 10000, required: false }) : it.description,
    kind, client_id: clientId,
    client_visible: 'client_visible' in body ? clientVisible(kind, clientId, body.client_visible) : clientVisible(kind, clientId, it.client_visible),
    assignee_ids: 'assignee_ids' in body ? JSON.stringify(checkAssignees(db, user, body.assignee_ids, { kind, client_id: clientId, client_visible: 'client_visible' in body ? body.client_visible : it.client_visible })) : it.assignee_ids,
    client_responsible: 'client_responsible' in body ? str(body.client_responsible, 'responsável no cliente', { max: 120, required: false }) : it.client_responsible,
    due_date: 'due_date' in body ? date(body.due_date, 'Prazo') : it.due_date,
    priority: oneOf(body.priority, 'prioridade', ['low', 'normal', 'high'], it.priority),
    checklist: 'checklist' in body ? JSON.stringify(checklistItems(body.checklist)) : it.checklist,
  };
  db.prepare(`update meeting_items set title = ?, description = ?, kind = ?, client_id = ?, client_visible = ?, assignee_ids = ?,
    client_responsible = ?, due_date = ?, priority = ?, checklist = ? where id = ?`)
    .run(v.title, v.description, v.kind, v.client_id, v.client_visible, v.assignee_ids, v.client_responsible, v.due_date, v.priority, v.checklist, params.id);
  return itemOut(db.prepare(`select ${ITEM_FIELDS} from meeting_items where id = ?`).get(params.id));
});

// O OK: vira tarefa de verdade, com os avisos de tarefa criada.
route('POST', '/api/meeting-items/:id/approve', ({ db, user, params }) => {
  const it = itemOut(loadItem(db, user, params.id));
  if (it.status === 'approved') fail(409, 'Esta tarefa já foi lançada');
  const m = loadMeeting(db, user, it.meeting_id);
  const br = d => d.split('-').reverse().join('/');
  const description = [it.description, it.client_responsible ? `Responsável no cliente: ${it.client_responsible}` : '',
    `Da reunião "${m.title}" de ${br(m.meeting_date)}.`].filter(Boolean).join('\n\n');
  const taskId = createTask(db, user, {
    kind: it.kind, client_id: it.client_id, client_visible: it.client_visible, title: it.title, description,
    due_date: it.due_date, priority: it.priority, assignee_ids: it.assignee_ids, checklist: it.checklist,
  });
  db.prepare("update meeting_items set status = 'approved', task_id = ?, decided_by = ?, decided_at = datetime('now') where id = ?").run(taskId, user.id, params.id);
  return { task_id: taskId };
});

route('POST', '/api/meeting-items/:id/discard', ({ db, user, params }) => {
  const it = loadItem(db, user, params.id);
  if (it.status === 'approved') fail(409, 'Esta tarefa já foi lançada; cancele no quadro de tarefas');
  db.prepare("update meeting_items set status = 'discarded', decided_by = ?, decided_at = datetime('now') where id = ?").run(user.id, params.id);
  return { ok: true };
});

route('POST', '/api/meeting-items/:id/restore', ({ db, user, params }) => {
  const it = loadItem(db, user, params.id);
  if (it.status !== 'discarded') fail(409, 'Só dá para voltar uma tarefa descartada');
  db.prepare("update meeting_items set status = 'pending', decided_by = null, decided_at = null where id = ?").run(params.id);
  return { ok: true };
});

function boardOf(db, orgId) {
  const org = db.prepare('select board from orgs where id = ?').get(orgId);
  const stages = db.prepare('select id, name from board_stages where org_id = ? order by id').all(orgId);
  return { stages, order: org.board ? JSON.parse(org.board) : [] };
}

route('GET', '/api/me', ({ db, user }) => ({
  user,
  org: { ...db.prepare('select id, name, accent, logo from orgs where id = ?').get(user.org_id), board: boardOf(db, user.org_id) },
  today: S.today(),
}));

// ---------- quadro: colunas criadas e ordem (administrador) ----------
route('POST', '/api/board/stages', ({ db, user, body }) => {
  requireAdmin(user);
  const name = str(body.name, 'nome da coluna', { max: 40 });
  if (db.prepare('select count(*) as n from board_stages where org_id = ?').get(user.org_id).n >= 10) fail(400, 'No máximo 10 colunas criadas');
  const r = db.prepare('insert into board_stages (org_id, name) values (?, ?)').run(user.org_id, name);
  // A coluna nova entra antes das concluídas.
  const b = boardOf(db, user.org_id);
  const order = S.boardColumns(b.stages, b.order).map(c => c.key).filter(k => k !== 'todo' && k !== 'doing' && k !== `stage-${r.lastInsertRowid}`);
  order.splice(Math.max(0, order.indexOf('done_on_time')), 0, `stage-${r.lastInsertRowid}`);
  db.prepare('update orgs set board = ? where id = ?').run(JSON.stringify(order), user.org_id);
  return boardOf(db, user.org_id);
});
route('PATCH', '/api/board/stages/:id', ({ db, user, body, params }) => {
  requireAdmin(user);
  if (!db.prepare('select 1 from board_stages where id = ? and org_id = ?').get(params.id, user.org_id)) fail(404, 'Coluna não encontrada');
  db.prepare('update board_stages set name = ? where id = ?').run(str(body.name, 'nome da coluna', { max: 40 }), params.id);
  return boardOf(db, user.org_id);
});
// Apagar uma coluna devolve as tarefas dela para Em andamento.
route('DELETE', '/api/board/stages/:id', ({ db, user, params }) => {
  requireAdmin(user);
  if (!db.prepare('select 1 from board_stages where id = ? and org_id = ?').get(params.id, user.org_id)) fail(404, 'Coluna não encontrada');
  tx(db, () => {
    db.prepare('update tasks set stage_id = null where stage_id = ?').run(params.id);
    db.prepare('delete from board_stages where id = ?').run(params.id);
  });
  return boardOf(db, user.org_id);
});
route('PUT', '/api/board/order', ({ db, user, body }) => {
  requireAdmin(user);
  const valid = new Set(S.boardColumns(boardOf(db, user.org_id).stages).map(c => c.key));
  if (!Array.isArray(body.order) || !body.order.every(k => valid.has(k))) fail(400, 'Ordem inválida');
  db.prepare('update orgs set board = ? where id = ?').run(JSON.stringify(body.order.filter(k => k !== 'todo' && k !== 'doing')), user.org_id);
  return boardOf(db, user.org_id);
});

// ---------- compromissos (agenda) ----------
// Quem vê: quem criou, os participantes e o administrador. Cliente só vê aquele de que participa.
function eventOut(db, e) {
  const people = db.prepare('select u.id, u.name, u.role from event_users eu join users u on u.id = eu.user_id where eu.event_id = ? order by u.name').all(e.id);
  return { ...e, participants: people, client_name: e.client_id ? (db.prepare('select name from clients where id = ?').get(e.client_id) || {}).name : null,
    created_by_name: nameOf(db, e.created_by) };
}
function canSeeEvent(db, user, e) {
  if (user.role === 'admin' || e.created_by === user.id) return true;
  return !!db.prepare('select 1 from event_users where event_id = ? and user_id = ?').get(e.id, user.id);
}
function loadEvent(db, user, eventId) {
  const e = db.prepare('select * from events where id = ? and org_id = ?').get(eventId, user.org_id);
  if (!e || !canSeeEvent(db, user, e)) fail(404, 'Compromisso não encontrado');
  return e;
}
const time = (v, field) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail(400, `${field}: hora inválida (use HH:MM)`);
  return v;
};
function eventFields(db, user, body, cur = {}) {
  const v = {
    title: 'title' in body ? str(body.title, 'título', { max: 200 }) : cur.title,
    date: 'date' in body ? date(body.date, 'Data') : cur.date,
    start_time: 'start_time' in body ? time(body.start_time, 'Início') : cur.start_time ?? null,
    end_time: 'end_time' in body ? time(body.end_time, 'Fim') : cur.end_time ?? null,
    location: 'location' in body ? str(body.location, 'local ou link', { max: 500, required: false }) : cur.location ?? '',
    notes: 'notes' in body ? str(body.notes, 'observações', { max: 5000, required: false }) : cur.notes ?? '',
    client_id: 'client_id' in body ? (body.client_id ? id(body.client_id, 'cliente') : null) : cur.client_id ?? null,
  };
  if (!v.title) fail(400, 'Informe o título');
  if (!v.date) fail(400, 'Informe a data');
  if (v.client_id) checkClient(db, user, v.client_id);
  if (v.start_time && v.end_time && v.end_time < v.start_time) fail(400, 'O fim é antes do início');
  return v;
}
function eventPeople(db, user, ids) {
  if (!Array.isArray(ids)) fail(400, 'Campo inválido: participantes');
  const clean = [...new Set(ids.map(x => id(x, 'participantes')))];
  for (const uid of clean) if (!db.prepare('select 1 from users where id = ? and org_id = ? and active = 1').get(uid, user.org_id)) fail(400, 'Participante inválido');
  return clean;
}
const setEventPeople = (db, eventId, ids) => {
  db.prepare('delete from event_users where event_id = ?').run(eventId);
  const ins = db.prepare('insert into event_users (event_id, user_id) values (?, ?)');
  for (const uid of ids) ins.run(eventId, uid);
};

route('GET', '/api/events', ({ db, user, query }) => {
  const from = date(query.from, 'De') || S.addDays(S.today(), -31);
  const to = date(query.to, 'Até') || S.addDays(S.today(), 62);
  const own = user.role === 'admin' ? '1 = 1' : '(e.created_by = ? or exists (select 1 from event_users eu where eu.event_id = e.id and eu.user_id = ?))';
  return db.prepare(`select e.* from events e where e.org_id = ? and e.date between ? and ? and ${own} order by e.date, coalesce(e.start_time, ''), e.id`)
    .all(user.org_id, from, to, ...(user.role === 'admin' ? [] : [user.id, user.id])).map(e => eventOut(db, e));
});
route('POST', '/api/events', ({ db, user, body }) => {
  requireStaff(user);
  const v = eventFields(db, user, body);
  const people = eventPeople(db, user, body.user_ids || []);
  const newId = tx(db, () => {
    const r = db.prepare('insert into events (org_id, title, date, start_time, end_time, location, notes, client_id, created_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user.org_id, v.title, v.date, v.start_time, v.end_time, v.location, v.notes, v.client_id, user.id);
    const eid = Number(r.lastInsertRowid);
    setEventPeople(db, eid, people);
    return eid;
  });
  return reply(201, eventOut(db, db.prepare('select * from events where id = ?').get(newId)));
});
route('PATCH', '/api/events/:id', ({ db, user, body, params }) => {
  const e = loadEvent(db, user, params.id);
  if (user.role !== 'admin' && e.created_by !== user.id) fail(403, 'Só quem marcou ou um administrador pode alterar');
  const v = eventFields(db, user, body, e);
  tx(db, () => {
    db.prepare('update events set title = ?, date = ?, start_time = ?, end_time = ?, location = ?, notes = ?, client_id = ? where id = ?')
      .run(v.title, v.date, v.start_time, v.end_time, v.location, v.notes, v.client_id, e.id);
    if ('user_ids' in body) setEventPeople(db, e.id, eventPeople(db, user, body.user_ids));
  });
  return eventOut(db, db.prepare('select * from events where id = ?').get(e.id));
});
route('DELETE', '/api/events/:id', ({ db, user, params }) => {
  const e = loadEvent(db, user, params.id);
  if (user.role !== 'admin' && e.created_by !== user.id) fail(403, 'Só quem marcou ou um administrador pode apagar');
  db.prepare('delete from events where id = ?').run(e.id);
  return { ok: true };
});

// ---------- anexos ----------
const MAX_ATTACHMENT = 10 * 1024 * 1024;
function loadAttachment(db, user, attId) {
  const a = db.prepare('select id, task_id, user_id, name, mime, size, visible_to_client from attachments where id = ?').get(attId);
  if (!a) fail(404, 'Anexo não encontrado');
  loadTask(db, user, a.task_id);
  if (user.role === 'client' && !a.visible_to_client) fail(404, 'Anexo não encontrado');
  return a;
}
route('POST', '/api/tasks/:id/attachments', ({ db, user, body, params }) => {
  const t = loadTask(db, user, params.id);
  const name = str(body.name, 'nome do arquivo', { max: 200 }).replace(/[\\/\r\n]/g, '_');
  const m = /^data:([\w.+-]+\/[\w.+-]+)?(;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data || ''));
  if (!m) fail(400, 'Arquivo inválido');
  const data = Buffer.from(m[3], 'base64');
  if (!data.length) fail(400, 'Arquivo vazio');
  if (data.length > MAX_ATTACHMENT) fail(400, 'Arquivo grande demais (máximo 10 MB)');
  // Cliente sempre anexa visível; a equipe escolhe (padrão: o cliente vê se vê a tarefa).
  const visible = user.role === 'client' ? 1 : (body.visible_to_client === false ? 0 : 1);
  db.prepare('insert into attachments (task_id, user_id, name, mime, size, data, visible_to_client) values (?, ?, ?, ?, ?, ?, ?)')
    .run(t.id, user.id, name, m[1] || 'application/octet-stream', data.length, data, visible);
  touch(db, t.id);
  return taskDetail(db, user, t.id);
}, { maxBody: Math.ceil(MAX_ATTACHMENT * 1.4) + 64 * 1024 });
route('GET', '/api/attachments/:id', ({ db, user, params }) => {
  const a = loadAttachment(db, user, params.id);
  return { name: a.name, mime: a.mime, data: Buffer.from(db.prepare('select data from attachments where id = ?').get(a.id).data).toString('base64') };
});
route('DELETE', '/api/attachments/:id', ({ db, user, params }) => {
  const a = loadAttachment(db, user, params.id);
  if (a.user_id !== user.id && user.role !== 'admin') fail(403, 'Só quem anexou ou um administrador pode apagar');
  db.prepare('delete from attachments where id = ?').run(a.id);
  return taskDetail(db, user, a.task_id);
});

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
    `select c.id, c.name, c.logo, (select json_group_array(uc.user_id) from user_clients uc where uc.client_id = c.id) as team,
       (select count(*) from tasks t where t.client_id = c.id and t.status not in ('done', 'cancelled') and t.archived_at is null and t.kind = 'external') as open_external,
       (select count(*) from tasks t where t.client_id = c.id and t.status not in ('done', 'cancelled') and t.archived_at is null and t.kind = 'internal') as open_internal
       from clients c where c.org_id = ? order by c.name`
  ).all(user.org_id).map(c => ({ ...c, team: JSON.parse(c.team) }));
});

// Quem da equipe acompanha o cliente (vê as tarefas externas dele).
route('PUT', '/api/clients/:id/team', ({ db, user, body, params }) => {
  requireAdmin(user);
  checkClient(db, user, params.id);
  if (!Array.isArray(body.user_ids)) fail(400, 'Campo inválido: equipe');
  const ids = [...new Set(body.user_ids.map(x => id(x, 'equipe')))];
  for (const uid of ids) if (!db.prepare("select 1 from users where id = ? and org_id = ? and role = 'member'").get(uid, user.org_id)) fail(400, 'Só pessoas da equipe (não administradores nem clientes)');
  tx(db, () => {
    db.prepare('delete from user_clients where client_id = ?').run(params.id);
    const ins = db.prepare('insert into user_clients (user_id, client_id) values (?, ?)');
    for (const uid of ids) ins.run(uid, params.id);
  });
  return { ok: true };
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
    `select u.id, u.name, u.email, u.role, u.client_id, c.name as client_name, u.active,
            (select json_group_array(uc.client_id) from user_clients uc where uc.user_id = u.id) as client_ids
       from users u left join clients c on c.id = u.client_id where u.org_id = ? order by u.role, u.name`
  ).all(user.org_id).map(u => ({ ...u, client_ids: JSON.parse(u.client_ids) }));
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

// Senha esquecida: o administrador define uma senha temporária e a pessoa troca em Configurações.
route('POST', '/api/users/:id/password', ({ db, user, body, params }) => {
  requireAdmin(user);
  if (!db.prepare('select 1 from users where id = ? and org_id = ?').get(params.id, user.org_id)) fail(404, 'Usuário não encontrado');
  if (params.id === user.id) fail(400, 'Para a sua própria senha, use Configurações');
  const password = str(body.password, 'senha', { max: 200 });
  if (password.length < 8) fail(400, 'A senha precisa ter pelo menos 8 caracteres');
  db.prepare('update users set pass_hash = ? where id = ?').run(auth.hashPassword(password), params.id);
  db.prepare('delete from sessions where user_id = ?').run(params.id);
  return { ok: true };
});

route('GET', '/api/health', ({ db }) => { db.prepare('select 1').get(); return { ok: true }; }, { public: true });

route('GET', '/api/tasks', ({ db, user, query }) => taskList(db, user, query));

route('GET', '/api/alerts', ({ db, user }) =>
  taskList(db, user, {}).filter(t => t.alert).sort((a, b) => a.alert.days - b.alert.days));

// Cria a tarefa (usado pelo formulário e pela triagem das reuniões).
function createTask(db, user, body) {
  requireStaff(user);
  if (body.kind === undefined) fail(400, 'Escolha se a tarefa é interna ou externa');
  const kind = oneOf(body.kind, 'tipo', ['internal', 'external']);
  const clientId = kindAndClient(db, user, kind, body.client_id ? id(body.client_id, 'cliente') : null);
  let title = str(body.title, 'título', { max: 200, required: !body.template_id });
  let description = str(body.description, 'descrição', { max: 10000, required: false });
  let checklist = checklistItems(body.checklist);
  if (body.template_id) {
    const tpl = db.prepare('select * from templates where id = ? and org_id = ?').get(id(body.template_id, 'modelo'), user.org_id);
    if (!tpl) fail(400, 'Modelo inválido');
    title = title || tpl.title;
    description = description || tpl.description;
    checklist = checklist ?? JSON.parse(tpl.checklist);
  }
  checklist = checklist || [];
  const due = date(body.due_date, 'Prazo');
  const priority = oneOf(body.priority, 'prioridade', ['low', 'normal', 'high'], 'normal');
  const al = body.alerts === undefined ? [1] : alerts(body.alerts);
  const { rec, every } = recurrence(body);
  const assignees = checkAssignees(db, user, body.assignee_ids || [], { kind, client_id: clientId, client_visible: clientVisible(kind, clientId, body.client_visible) }, body.keep_assignee_ids || []);
  const newId = tx(db, () => {
    const r = db.prepare(
      `insert into tasks (org_id, kind, client_id, client_visible, title, description, due_date, priority, alerts, recurrence,
                          recurrence_every, position, created_by, team_visible)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (select coalesce(max(position), 0) + 1 from tasks where org_id = ?), ?, ?)`
    ).run(user.org_id, kind, clientId, clientVisible(kind, clientId, body.client_visible), title, description, due, priority,
      JSON.stringify(al), rec, every, user.org_id, user.id, teamVisible(kind, body.team_visible));
    const taskId = Number(r.lastInsertRowid);
    setAssignees(db, taskId, assignees);
    const ins = db.prepare('insert into checklist_items (task_id, text, position) values (?, ?, ?)');
    checklist.forEach((text, i) => ins.run(taskId, String(text).slice(0, 300), i));
    return taskId;
  });
  notifier?.onTaskCreated(newId, user.id);
  return newId;
}

route('POST', '/api/tasks', ({ db, user, body }) => reply(201, { id: createTask(db, user, body) }));

route('GET', '/api/tasks/:id', ({ db, user, params }) => taskDetail(db, user, params.id));

// O cliente atualiza só o andamento: situação (sem concluir nem cancelar), início e % de execução.
const CLIENT_FIELDS = ['status', 'start_date', 'progress'];

route('PATCH', '/api/tasks/:id', ({ db, user, body, params }) => {
  const t = loadTask(db, user, params.id);
  if (user.role === 'client') {
    if (!Object.keys(body).every(k => CLIENT_FIELDS.includes(k))) fail(403, 'Você pode alterar a situação, a data de início e o % de execução');
    if (t.status === 'done' || t.status === 'cancelled') fail(409, 'Esta tarefa já foi encerrada');
  }
  tx(db, () => {
    const set = (col, val) => db.prepare(`update tasks set ${col} = ? where id = ?`).run(val, t.id);
    if ('title' in body) set('title', str(body.title, 'título', { max: 200 }));
    if ('description' in body) set('description', str(body.description, 'descrição', { max: 10000, required: false }));
    if ('kind' in body || 'client_id' in body || 'client_visible' in body) {
      const kind = 'kind' in body ? oneOf(body.kind, 'tipo', ['internal', 'external']) : t.kind;
      const clientId = kindAndClient(db, user, kind, 'client_id' in body ? (body.client_id ? id(body.client_id, 'cliente') : null) : t.client_id);
      db.prepare('update tasks set kind = ?, client_id = ?, client_visible = ? where id = ?')
        .run(kind, clientId, clientVisible(kind, clientId, 'client_visible' in body ? body.client_visible : t.client_visible), t.id);
      if (!('assignee_ids' in body)) dropInvalidClientAssignees(db, t.id);
    }
    if ('team_visible' in body) set('team_visible', body.team_visible ? 1 : 0);
    if ('start_date' in body) set('start_date', date(body.start_date, 'Início'));
    if ('due_date' in body) set('due_date', date(body.due_date, 'Prazo'));
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
    if ('assignee_ids' in body) setAssignees(db, t.id, checkAssignees(db, user, body.assignee_ids, db.prepare('select * from tasks where id = ?').get(t.id), assigneeIds(db, t.id)));
    // Concluir e cancelar têm rotas próprias (pedem data e motivo). Voltar a uma situação aberta reabre.
    // Ao entrar em andamento pela primeira vez, o início é preenchido com hoje.
    if ('status' in body) {
      if (body.status === 'done') fail(400, 'Para concluir, use Concluir e informe a data de término');
      if (body.status === 'cancelled') fail(400, 'Para cancelar, use Cancelar e informe o motivo');
      // Colunas criadas pela organização chegam como "stage-<id>": a tarefa fica Em andamento naquela coluna.
      const m = /^stage-(\d+)$/.exec(String(body.status));
      const stageId = m ? Number(m[1]) : null;
      if (stageId && !db.prepare('select 1 from board_stages where id = ? and org_id = ?').get(stageId, user.org_id)) fail(400, 'Coluna inválida');
      const status = stageId ? 'doing' : oneOf(body.status, 'situação', ['todo', 'doing', 'review']);
      db.prepare('update tasks set status = ?, stage_id = ?, completed_on = null, cancelled_on = null, cancel_reason = null, completed_by = null, cancelled_by = null where id = ?').run(status, stageId, t.id);
      if (status !== 'todo' && !('start_date' in body)) db.prepare('update tasks set start_date = coalesce(start_date, ?) where id = ?').run(S.today(), t.id);
    } else if (body.start_date) {
      // Informar o início de uma tarefa a fazer já a coloca em andamento.
      db.prepare("update tasks set status = 'doing' where id = ? and status = 'todo'").run(t.id);
    }
    // Quem iniciou: quem preencheu o início (direto, ao mudar a situação ou ao marcar o checklist).
    const startNow = db.prepare('select start_date from tasks where id = ?').get(t.id).start_date;
    if (!t.start_date && startNow) set('started_by', user.id);
    if (!startNow) set('started_by', null);
    touch(db, t.id);
  });
  return taskDetail(db, user, t.id);
});

// Equipe e cliente concluem informando a data de término. O cliente não reconclui uma tarefa encerrada.
route('POST', '/api/tasks/:id/complete', ({ db, user, body, params }) => {
  const t = loadTask(db, user, params.id);
  if (user.role === 'client' && (t.status === 'done' || t.status === 'cancelled')) fail(409, 'Esta tarefa já foi encerrada');
  const nextId = completeTask(db, t, date(body.completed_on, 'Término') || S.today(), user.id);
  if (nextId) notifier?.onTaskCreated(nextId, user.id);
  return { ...taskDetail(db, user, t.id), created_next_id: nextId };
});

route('POST', '/api/tasks/:id/cancel', ({ db, user, body, params }) => {
  requireStaff(user);
  const t = loadTask(db, user, params.id);
  const reason = str(body.reason, 'motivo do cancelamento', { max: 1000 });
  db.prepare(
    `update tasks set status = 'cancelled', cancel_reason = ?, cancelled_on = ?, completed_on = null, cancelled_by = ?, completed_by = null,
       updated_at = datetime('now') where id = ?`
  ).run(reason, S.today(), user.id, t.id);
  return taskDetail(db, user, t.id);
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
  // O cliente marca o que já fez; editar o texto é só da equipe.
  if (user.role === 'client' && Object.keys(body).some(k => k !== 'done')) fail(403, 'Você pode marcar os itens, não editar o texto');
  const { item, task } = loadChecklistItem(db, user, params.id);
  if (user.role === 'client' && (task.status === 'done' || task.status === 'cancelled')) fail(409, 'Esta tarefa já foi encerrada');
  if ('done' in body) db.prepare('update checklist_items set done = ? where id = ?').run(body.done ? 1 : 0, item.id);
  const start = body.done ? S.startByChecklist(task, S.today()) : null;
  if (start) db.prepare('update tasks set status = ?, start_date = ?, started_by = coalesce(started_by, ?) where id = ?').run(start.status, start.start_date, task.start_date ? task.started_by : user.id, task.id);
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
  const visible = user.role === 'client' ? 1 : (S.clientSees(t) && body.visible_to_client ? 1 : 0);
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
  const nextId = completeTask(db, t, S.today(), user.id);
  if (nextId) notifier?.onTaskCreated(nextId, null);
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
  const row = (key, name) => rows.get(key) || rows.set(key, { id: key, name, tasks: 0, internal: 0, client: 0, on_time: 0, late: 0, cancelled: 0 }).get(key);
  for (const c of db.prepare('select id, name from clients where org_id = ? order by name').all(user.org_id)) row(c.id, c.name);
  for (const t of tasks) {
    const r = row(t.client_id || 'org', t.client_id ? t.client_name : `${org} (interna)`);
    r.tasks++;
    r.internal += t.adjustments_internal;
    r.client += t.adjustments_client;
    if (t.column === 'done_on_time') r.on_time++;
    if (t.column === 'cancelled') r.cancelled++;
    if (t.column === 'done_late') r.late++;
  }
  return [...rows.values()].sort((a, b) => b.client - a.client || b.internal - a.internal || a.name.localeCompare(b.name));
});

// ---------- HTTP ----------
function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject(new HttpError(413, 'Requisição grande demais')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Atrás do proxy da hospedagem (TRUST_PROXY=1), o endereço de quem acessa vem no X-Forwarded-For;
// sem isso, todo mundo teria o endereço do proxy e o limite de tentativas de login valeria para todos juntos.
// Usa o último endereço da lista: é o que o proxy viu, e não dá para ser forjado por quem acessa.
function clientIp(req) {
  const xff = process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-for'];
  return xff ? String(xff).split(',').pop().trim() : req.socket.remoteAddress;
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
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:",
    'X-Frame-Options': 'DENY',
  });
  fs.createReadStream(file).pipe(res);
}

function createHandler(db, opts = {}) {
  notifier = opts.notifier || null;
  extractor = opts.extractor || null;
  // Leitura interrompida por um reinício do servidor: deixa a reunião pronta para ler de novo.
  db.prepare("update meetings set status = 'error', error = 'A leitura foi interrompida. Clique em \"Ler de novo\".' where status = 'processing'").run();
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
        const raw = await readBody(req, r.maxBody);
        if (raw) {
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Envie JSON');
          try { body = JSON.parse(raw); } catch { fail(400, 'JSON inválido'); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'JSON inválido');
        }
      }

      const token = cookieToken(req);
      const user = auth.userFromToken(db, token);
      if (user && user.role === 'member') user.client_ids = clientIdsOf(db, user.id);
      if (!r.public && !user) fail(401, 'Faça login');

      const out = await r.handler({ db, user, body, params, query: Object.fromEntries(url.searchParams), token, ip: clientIp(req) });
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
