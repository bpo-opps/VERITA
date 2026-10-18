'use strict';
/* global Shared */
// API do protótipo: a mesma interface do servidor (app.js), rodando dentro do navegador.
// As regras (colunas, alertas, recorrência, %, quem vê) vêm de shared.js, igual ao servidor.
// Os dados são fictícios e ficam só neste navegador (localStorage, quando disponível).
(function () {
  const S = window.Shared;
  const KEY = 'tarefas-prototipo-v2';
  const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const d = n => S.addDays(S.today(), n);

  function svgLogo(text, color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/>` +
      `<text x="32" y="41" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">${text}</text></svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  function seed() {
    const db = { seq: 100, org: { id: 1, name: 'Opps Consultoria', accent: '#0f766e', logo: svgLogo('OP', '#0f766e') },
      clients: [], users: [], tasks: [], assignees: [], checklist: [], comments: [], adjustments: [], templates: [] };
    db.clients.push(
      { id: 1, name: 'Padaria Exemplo', logo: svgLogo('PE', '#b45309') },
      { id: 2, name: 'Clínica Modelo', logo: svgLogo('CM', '#4338ca') });
    db.users.push(
      { id: 1, name: 'Admin Demo', email: 'admin@demo.local', role: 'admin', client_id: null, active: 1 },
      { id: 2, name: 'Membro Demo', email: 'equipe@demo.local', role: 'member', client_id: null, active: 1 },
      { id: 3, name: 'Analista Demo', email: 'analista@demo.local', role: 'member', client_id: null, active: 1 },
      { id: 4, name: 'Cliente Padaria', email: 'cliente@demo.local', role: 'client', client_id: 1, active: 1 });
    let id = 0;
    const task = (t, who = [], checklist = []) => {
      const tid = ++id;
      db.tasks.push({
        id: tid, kind: t.kind, client_id: t.client ?? null, status: t.status || 'todo', title: t.title, description: '',
        start_date: t.start ?? null, due_date: t.due ?? null, completed_on: t.done ?? null, progress: t.progress || 0,
        priority: t.priority || 'normal', alerts: t.alerts || [1], recurrence: t.recurrence || 'none', recurrence_every: null,
        next_task_id: null, position: tid, created_by: t.by || 1, created_at: now(), updated_at: now(), archived_at: t.archived ? now() : null,
      });
      who.forEach(u => db.assignees.push({ task_id: tid, user_id: u }));
      checklist.forEach(([text, done], i) => db.checklist.push({ id: 1000 + db.checklist.length, task_id: tid, text, done: done ? 1 : 0, position: i }));
      return tid;
    };
    task({ kind: 'external', client: 1, title: 'Levantar processos do financeiro', start: d(0), due: d(5), alerts: [1, 3] }, [2]);
    task({ kind: 'external', client: 1, status: 'doing', title: 'Mapear fluxo de contas a pagar', start: d(-4), due: d(2), progress: 40 }, [2, 1]);
    task({ kind: 'external', client: 2, status: 'doing', title: 'Fechamento contábil de setembro', start: d(-6), due: d(1), alerts: [0, 1, 3], recurrence: 'monthly', priority: 'high' }, [3],
      [['Conciliar bancos', true], ['Conferir notas fiscais', true], ['Lançar provisões', false], ['Enviar relatório ao cliente', false]]);
    const rev = task({ kind: 'external', client: 1, status: 'review', title: 'Relatório de diagnóstico', start: d(-10), due: d(3), progress: 90 }, [1]);
    db.comments.push({ id: 1, task_id: rev, user_id: 1, body: 'Versão 1 pronta para sua revisão.', visible_to_client: 1, created_at: now() });
    task({ kind: 'external', client: 2, status: 'doing', title: 'Conciliação bancária de agosto', start: d(-12), due: d(-2), progress: 70 }, [2]);
    task({ kind: 'external', client: 2, status: 'done', title: 'Reunião de kickoff', start: d(-20), due: d(-14), done: d(-15) }, [1]);
    task({ kind: 'external', client: 1, status: 'done', title: 'Cadastro de fornecedores', start: d(-18), due: d(-9), done: d(-6) }, [2]);
    task({ kind: 'internal', title: 'Planejamento comercial do trimestre', start: d(-2), due: d(10), alerts: [7], recurrence: 'quarterly' }, [1]);
    task({ kind: 'internal', client: 1, status: 'doing', title: 'Revisar proposta de renovação da Padaria', due: d(0), progress: 20, alerts: [0], by: 2 }, [2]);
    task({ kind: 'internal', title: 'Atualizar modelo de relatório mensal', due: d(15), by: 3 }, [3]);
    task({ kind: 'external', client: 2, status: 'done', title: 'Levantamento inicial (antigo)', due: d(-40), done: d(-41), archived: true }, [1]);
    db.templates.push({ id: 1, name: 'Fechamento mensal', title: 'Fechamento do mês', description: '',
      checklist: ['Conciliar bancos', 'Conferir notas fiscais', 'Lançar provisões', 'Enviar relatório ao cliente'] });
    return db;
  }

  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db) db = seed();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* sem armazenamento: fica só na memória */ } };
  let sessionUser = null;
  try { sessionUser = Number(sessionStorage.getItem(KEY + '-user')) || null; } catch { /* idem */ }
  const setSession = uid => { sessionUser = uid; try { uid ? sessionStorage.setItem(KEY + '-user', uid) : sessionStorage.removeItem(KEY + '-user'); } catch { /* idem */ } };
  const nextId = () => ++db.seq;

  class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const fail = (s, m) => { throw new HttpError(s, m); };
  const str = (v, field, { max = 500, required = true } = {}) => {
    if (v === undefined || v === null || v === '') { if (required) fail(400, `Campo obrigatório: ${field}`); return ''; }
    if (typeof v !== 'string') fail(400, `Campo inválido: ${field}`);
    const s = v.trim();
    if (required && !s) fail(400, `Campo obrigatório: ${field}`);
    if (s.length > max) fail(400, `Campo muito longo: ${field} (máx. ${max})`);
    return s;
  };
  const date = (v, field = 'data') => { if (!v) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(400, `${field}: data inválida`); return v; };
  const oneOf = (v, f, opts, fb) => { if (v === undefined) return fb; if (!opts.includes(v)) fail(400, `Campo inválido: ${f}`); return v; };
  const logo = v => { if (v === null || v === '') return null; if (!/^data:image\/(png|jpeg|webp);base64,/.test(v)) fail(400, 'Logo inválido'); if (v.length > 300 * 1024) fail(400, 'Logo grande demais'); return v; };
  const isStaff = u => u.role !== 'client';
  const requireStaff = u => { if (!isStaff(u)) fail(403, 'Sem permissão'); };
  const requireAdmin = u => { if (u.role !== 'admin') fail(403, 'Só administradores'); };

  const clientOf = cid => db.clients.find(c => c.id === cid);
  const userName = uid => (db.users.find(u => u.id === uid) || {}).name;
  const assigneeIds = tid => db.assignees.filter(a => a.task_id === tid).map(a => a.user_id);
  function loadTask(user, tid) {
    const t = db.tasks.find(x => x.id === tid);
    if (!t || !S.canSee(user, t, assigneeIds(t.id)) || (user.role === 'client' && t.archived_at)) fail(404, 'Tarefa não encontrada');
    return t;
  }
  function checkClient(cid) { if (!clientOf(cid)) fail(400, 'Cliente inválido'); }
  function checkAssignees(ids) {
    if (!Array.isArray(ids)) fail(400, 'Campo inválido: responsáveis');
    const clean = [...new Set(ids.map(Number))];
    for (const uid of clean) { const u = db.users.find(x => x.id === uid); if (!u || u.role === 'client' || !u.active) fail(400, 'Responsável inválido'); }
    return clean;
  }
  const setAssignees = (tid, ids) => { db.assignees = db.assignees.filter(a => a.task_id !== tid).concat(ids.map(user_id => ({ task_id: tid, user_id }))); };
  const touch = t => { t.updated_at = now(); };
  function kindAndClient(kind, cid) {
    if (kind === 'external' && !cid) fail(400, 'Tarefa externa precisa de um cliente');
    if (cid) checkClient(cid);
    return cid || null;
  }
  function recurrence(body, cur = {}) {
    const rec = oneOf(body.recurrence, 'repetição', Object.keys(S.RECURRENCE), cur.recurrence || 'none');
    let every = null;
    if (rec === 'custom') {
      every = Number(body.recurrence_every ?? cur.recurrence_every);
      if (!Number.isInteger(every) || every < 1 || every > 3650) fail(400, 'Repetição livre: informe a cada quantos dias (1 a 3650)');
    }
    return { rec, every };
  }
  const alerts = v => { const a = S.validAlerts(v); if (!a) fail(400, 'Alertas inválidos'); return a; };
  const checkDates = (s, due) => { if (s && due && s > due) fail(400, 'A data de início não pode ser depois do prazo'); };

  function completeTask(t, completedOn, userId) {
    if (completedOn > S.today()) fail(400, 'A data de término não pode ser no futuro');
    if (t.start_date && completedOn < t.start_date) fail(400, 'A data de término não pode ser antes do início');
    Object.assign(t, { status: 'done', completed_on: completedOn, progress: 100 }); touch(t);
    if (t.recurrence === 'none' || t.next_task_id) return null;
    const next = x => S.nextDate(x, t.recurrence, t.recurrence_every);
    const nid = nextId();
    db.tasks.push({ ...t, id: nid, status: 'todo', completed_on: null, progress: 0, next_task_id: null, archived_at: null,
      start_date: t.start_date ? next(t.start_date) : null,
      due_date: t.due_date ? next(t.due_date) : (t.start_date ? null : next(completedOn)),
      position: Math.max(0, ...db.tasks.map(x => x.position)) + 1, created_by: userId, created_at: now(), updated_at: now() });
    setAssignees(nid, assigneeIds(t.id));
    db.checklist.filter(i => i.task_id === t.id).forEach(i => db.checklist.push({ ...i, id: nextId(), task_id: nid, done: 0 }));
    t.next_task_id = nid;
    return nid;
  }

  function decorate(user, t) {
    const cl = db.checklist.filter(i => i.task_id === t.id);
    const adj = db.adjustments.filter(a => a.task_id === t.id);
    const out = {
      id: t.id, kind: t.kind, client_id: t.client_id, client_name: t.client_id ? clientOf(t.client_id).name : null, status: t.status,
      column: S.column(t), title: t.title, start_date: t.start_date, due_date: t.due_date, completed_on: t.completed_on,
      progress: S.progress(t, cl.length, cl.filter(i => i.done).length), progress_from_checklist: cl.length > 0, priority: t.priority,
      alerts: t.alerts, alert: S.alert(t), recurrence: t.recurrence, recurrence_every: t.recurrence_every,
      position: t.position, archived_at: t.archived_at, created_by: t.created_by, updated_at: t.updated_at,
      checklist_total: cl.length, checklist_done: cl.filter(i => i.done).length,
      adjustments_client: adj.filter(a => a.origin === 'client').length, adjustments_internal: adj.filter(a => a.origin === 'internal').length,
      adjustments_open: adj.filter(a => !a.resolved_at).length,
      assignees: db.assignees.filter(a => a.task_id === t.id).map(a => ({ id: a.user_id, name: userName(a.user_id) })).sort((a, b) => a.name.localeCompare(b.name)),
    };
    if (user.role === 'client') { delete out.adjustments_internal; delete out.created_by; }
    return out;
  }
  function detail(user, tid) {
    const t = loadTask(user, tid);
    const client = user.role === 'client';
    return {
      ...decorate(user, t), description: t.description, next_task_id: t.next_task_id,
      checklist: db.checklist.filter(i => i.task_id === t.id).sort((a, b) => a.position - b.position || a.id - b.id).map(({ id, text, done }) => ({ id, text, done })),
      comments: db.comments.filter(c => c.task_id === t.id && (!client || c.visible_to_client)).map(c => {
        const u = db.users.find(x => x.id === c.user_id) || {};
        return { id: c.id, body: c.body, visible_to_client: c.visible_to_client, created_at: c.created_at, author: u.name, author_role: u.role };
      }),
      adjustments: db.adjustments.filter(a => a.task_id === t.id && (!client || a.origin === 'client'))
        .map(a => ({ id: a.id, origin: a.origin, body: a.body, created_at: a.created_at, resolved_at: a.resolved_at, author: userName(a.user_id) })),
    };
  }
  function list(user, q) {
    const today = S.today();
    let ts = db.tasks.filter(t => S.canSee(user, t, assigneeIds(t.id)));
    if (user.role === 'client') ts = ts.filter(t => !t.archived_at);
    else {
      ts = ts.filter(t => (q.archived === '1' ? t.archived_at : !t.archived_at));
      if (q.kind) ts = ts.filter(t => t.kind === q.kind);
      if (q.client_id === 'org') ts = ts.filter(t => !t.client_id);
      else if (q.client_id) ts = ts.filter(t => t.client_id === Number(q.client_id));
    }
    const who = q.mine === '1' ? user.id : (q.assignee ? Number(q.assignee) : null);
    if (who) ts = ts.filter(t => assigneeIds(t.id).includes(who));
    if (q.due === 'overdue') ts = ts.filter(t => t.due_date && t.due_date < today && t.status !== 'done');
    if (q.due === 'today') ts = ts.filter(t => t.due_date === today);
    if (q.due === 'week') ts = ts.filter(t => t.due_date && t.due_date >= today && t.due_date <= S.addDays(today, 7));
    if (q.due === 'month') ts = ts.filter(t => t.due_date && t.due_date.slice(0, 7) === today.slice(0, 7));
    if (q.due === 'none') ts = ts.filter(t => !t.due_date);
    if (q.q) ts = ts.filter(t => t.title.toLowerCase().includes(String(q.q).toLowerCase()));
    return ts.sort((a, b) => a.position - b.position || a.id - b.id).map(t => decorate(user, t));
  }

  const routes = [];
  const route = (method, pattern, handler, pub = false) => {
    routes.push({ method, re: new RegExp('^' + pattern.replace(/:id/g, '(\\d+)') + '$'), handler, pub });
  };

  route('POST', '/api/login', ({ body }) => {
    const email = str(body.email, 'email', { max: 200 }).toLowerCase();
    str(body.password, 'senha', { max: 200 });
    const u = db.users.find(x => x.email === email && x.active);
    // No protótipo, as contas de exemplo usam demo1234; as criadas aqui usam a senha definida ao criar.
    if (!u || body.password !== (u.password || 'demo1234')) fail(401, 'Email ou senha incorretos');
    setSession(u.id);
    return { ok: true };
  }, true);
  route('POST', '/api/logout', () => { setSession(null); return { ok: true }; });
  route('GET', '/api/me', ({ user }) => ({
    user: { id: user.id, org_id: 1, name: user.name, email: user.email, role: user.role, client_id: user.client_id },
    org: db.org, today: S.today(),
  }));
  route('POST', '/api/me/password', ({ user, body }) => {
    const cur = str(body.current, 'senha atual'), next = str(body.password, 'nova senha');
    if (next.length < 8) fail(400, 'A nova senha precisa ter pelo menos 8 caracteres');
    if (cur !== (user.password || 'demo1234')) fail(400, 'Senha atual incorreta');
    user.password = next; return { ok: true };
  });
  route('PATCH', '/api/org', ({ user, body }) => {
    requireAdmin(user);
    if ('name' in body) db.org.name = str(body.name, 'nome', { max: 80 });
    if ('accent' in body) { const a = str(body.accent, 'cor', { max: 7 }); if (!/^#[0-9a-fA-F]{6}$/.test(a)) fail(400, 'Cor inválida (use #RRGGBB)'); db.org.accent = a; }
    if ('logo' in body) db.org.logo = logo(body.logo);
    return { ok: true };
  });
  route('GET', '/api/clients', ({ user }) => {
    if (user.role === 'client') return db.clients.filter(c => c.id === user.client_id).map(({ id, name, logo: l }) => ({ id, name, logo: l }));
    const open = (cid, kind) => db.tasks.filter(t => t.client_id === cid && t.kind === kind && t.status !== 'done' && !t.archived_at).length;
    return db.clients.map(c => ({ id: c.id, name: c.name, logo: c.logo, open_external: open(c.id, 'external'), open_internal: open(c.id, 'internal') }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
  route('POST', '/api/clients', ({ user, body }) => {
    requireAdmin(user);
    const id = nextId(); db.clients.push({ id, name: str(body.name, 'nome', { max: 120 }), logo: body.logo ? logo(body.logo) : null }); return { id };
  });
  route('PATCH', '/api/clients/:id', ({ user, body, id }) => {
    requireAdmin(user); checkClient(id);
    if ('name' in body) clientOf(id).name = str(body.name, 'nome', { max: 120 });
    if ('logo' in body) clientOf(id).logo = logo(body.logo);
    return { ok: true };
  });
  route('GET', '/api/users', ({ user }) => {
    requireStaff(user);
    const order = { admin: 0, client: 1, member: 2 };
    return db.users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, client_id: u.client_id, client_name: u.client_id ? clientOf(u.client_id).name : null, active: u.active }))
      .sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
  });
  route('POST', '/api/users', ({ user, body }) => {
    requireAdmin(user);
    const name = str(body.name, 'nome', { max: 120 });
    const email = str(body.email, 'email', { max: 200 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Email inválido');
    const password = str(body.password, 'senha', { max: 200 });
    if (password.length < 8) fail(400, 'A senha precisa ter pelo menos 8 caracteres');
    const role = oneOf(body.role, 'papel', ['admin', 'member', 'client']);
    let client_id = null;
    if (role === 'client') { client_id = Number(body.client_id); checkClient(client_id); }
    if (db.users.some(u => u.email === email)) fail(409, 'Já existe um usuário com esse email');
    const id = nextId(); db.users.push({ id, name, email, role, client_id, active: 1, password }); return { id };
  });
  route('PATCH', '/api/users/:id', ({ user, body, id }) => {
    requireAdmin(user);
    const u = db.users.find(x => x.id === id); if (!u) fail(404, 'Usuário não encontrado');
    if (id === user.id) fail(400, 'Você não pode desativar a própria conta');
    u.active = body.active ? 1 : 0; return { ok: true };
  });
  route('GET', '/api/tasks', ({ user, query }) => list(user, query));
  route('GET', '/api/alerts', ({ user }) => list(user, {}).filter(t => t.alert).sort((a, b) => a.alert.days - b.alert.days));
  route('POST', '/api/tasks', ({ user, body }) => {
    requireStaff(user);
    if (body.kind === undefined) fail(400, 'Escolha se a tarefa é interna ou externa');
    const kind = oneOf(body.kind, 'tipo', ['internal', 'external']);
    const client_id = kindAndClient(kind, body.client_id ? Number(body.client_id) : null);
    let title = str(body.title, 'título', { max: 200, required: !body.template_id });
    let description = str(body.description, 'descrição', { max: 10000, required: false });
    let checklist = [];
    if (body.template_id) {
      const tpl = db.templates.find(t => t.id === Number(body.template_id)); if (!tpl) fail(400, 'Modelo inválido');
      title = title || tpl.title; description = description || tpl.description; checklist = tpl.checklist;
    }
    const start = date(body.start_date, 'Início'), due = date(body.due_date, 'Prazo');
    checkDates(start, due);
    const { rec, every } = recurrence(body);
    const assignees = checkAssignees(body.assignee_ids || []);
    const id = nextId();
    db.tasks.push({ id, kind, client_id, status: 'todo', title, description, start_date: start, due_date: due, completed_on: null, progress: 0,
      priority: oneOf(body.priority, 'prioridade', ['low', 'normal', 'high'], 'normal'), alerts: body.alerts === undefined ? [1] : alerts(body.alerts),
      recurrence: rec, recurrence_every: every, next_task_id: null, position: Math.max(0, ...db.tasks.map(t => t.position)) + 1,
      created_by: user.id, created_at: now(), updated_at: now(), archived_at: null });
    setAssignees(id, assignees);
    checklist.forEach((text, i) => db.checklist.push({ id: nextId(), task_id: id, text, done: 0, position: i }));
    return { id };
  });
  route('GET', '/api/tasks/:id', ({ user, id }) => detail(user, id));
  route('PATCH', '/api/tasks/:id', ({ user, body, id }) => {
    requireStaff(user);
    const t = loadTask(user, id);
    const copy = { ...t };
    try {
      if ('title' in body) t.title = str(body.title, 'título', { max: 200 });
      if ('description' in body) t.description = str(body.description, 'descrição', { max: 10000, required: false });
      if ('kind' in body || 'client_id' in body) {
        const kind = 'kind' in body ? oneOf(body.kind, 'tipo', ['internal', 'external']) : t.kind;
        const cid = 'client_id' in body ? (body.client_id ? Number(body.client_id) : null) : t.client_id;
        t.client_id = kindAndClient(kind, cid); t.kind = kind;
      }
      if ('start_date' in body || 'due_date' in body) {
        const s = 'start_date' in body ? date(body.start_date, 'Início') : t.start_date;
        const due = 'due_date' in body ? date(body.due_date, 'Prazo') : t.due_date;
        checkDates(s, due); t.start_date = s; t.due_date = due;
      }
      if ('priority' in body) t.priority = oneOf(body.priority, 'prioridade', ['low', 'normal', 'high']);
      if ('alerts' in body) t.alerts = alerts(body.alerts);
      if ('recurrence' in body || 'recurrence_every' in body) { const { rec, every } = recurrence(body, t); t.recurrence = rec; t.recurrence_every = every; }
      if ('progress' in body) {
        const n = Number(body.progress);
        if (!Number.isInteger(n) || n < 0 || n > 100) fail(400, '% de execução deve ser de 0 a 100');
        if (db.checklist.some(i => i.task_id === t.id)) fail(409, 'Esta tarefa tem checklist: o % segue os itens marcados');
        t.progress = n;
      }
      if ('position' in body) t.position = Number(body.position);
      if ('assignee_ids' in body) setAssignees(t.id, checkAssignees(body.assignee_ids));
      if ('status' in body) { t.status = oneOf(body.status, 'situação', ['todo', 'doing', 'review']); t.completed_on = null; }
    } catch (err) { Object.assign(t, copy); throw err; }
    touch(t);
    return detail(user, id);
  });
  route('POST', '/api/tasks/:id/complete', ({ user, body, id }) => {
    requireStaff(user);
    const t = loadTask(user, id);
    const nid = completeTask(t, date(body.completed_on, 'Término') || S.today(), user.id);
    return { ...detail(user, id), created_next_id: nid };
  });
  route('POST', '/api/tasks/:id/archive', ({ user, body, id }) => {
    requireStaff(user); const t = loadTask(user, id);
    t.archived_at = body.archived === false ? null : now(); return detail(user, id);
  });
  route('DELETE', '/api/tasks/:id', ({ user, id }) => {
    requireAdmin(user); loadTask(user, id);
    db.tasks = db.tasks.filter(t => t.id !== id);
    ['assignees', 'checklist', 'comments', 'adjustments'].forEach(k => { db[k] = db[k].filter(x => x.task_id !== id); });
    return { ok: true };
  });
  route('POST', '/api/tasks/:id/checklist', ({ user, body, id }) => {
    requireStaff(user); const t = loadTask(user, id);
    db.checklist.push({ id: nextId(), task_id: t.id, text: str(body.text, 'item', { max: 300 }), done: 0, position: db.checklist.filter(i => i.task_id === t.id).length });
    touch(t); return detail(user, id);
  });
  const checklistItem = (user, iid) => { const i = db.checklist.find(x => x.id === iid); if (!i) fail(404, 'Item não encontrado'); loadTask(user, i.task_id); return i; };
  route('PATCH', '/api/checklist/:id', ({ user, body, id }) => {
    requireStaff(user); const i = checklistItem(user, id);
    if ('done' in body) i.done = body.done ? 1 : 0;
    if ('text' in body) i.text = str(body.text, 'item', { max: 300 });
    return detail(user, i.task_id);
  });
  route('DELETE', '/api/checklist/:id', ({ user, id }) => {
    requireStaff(user); const i = checklistItem(user, id);
    db.checklist = db.checklist.filter(x => x.id !== id); return detail(user, i.task_id);
  });
  route('POST', '/api/tasks/:id/comments', ({ user, body, id }) => {
    const t = loadTask(user, id);
    db.comments.push({ id: nextId(), task_id: t.id, user_id: user.id, body: str(body.body, 'comentário', { max: 5000 }),
      visible_to_client: user.role === 'client' ? 1 : (t.kind === 'external' && body.visible_to_client ? 1 : 0), created_at: now() });
    touch(t); return detail(user, id);
  });
  route('POST', '/api/tasks/:id/adjustments', ({ user, body, id }) => {
    const t = loadTask(user, id);
    const text = str(body.body, 'o que ajustar', { max: 5000 });
    const origin = user.role === 'client' ? 'client' : 'internal';
    if (origin === 'client' && t.status !== 'review') fail(409, 'Só é possível pedir ajuste quando a tarefa está em revisão');
    if (t.status === 'done') fail(409, 'Reabra a tarefa antes de registrar um ajuste');
    db.adjustments.push({ id: nextId(), task_id: t.id, origin, body: text, user_id: user.id, created_at: now(), resolved_at: null });
    t.status = 'doing'; touch(t); return detail(user, id);
  });
  route('POST', '/api/adjustments/:id/resolve', ({ user, id }) => {
    requireStaff(user);
    const a = db.adjustments.find(x => x.id === id); if (!a) fail(404, 'Ajuste não encontrado');
    loadTask(user, a.task_id); a.resolved_at = a.resolved_at || now(); return detail(user, a.task_id);
  });
  route('POST', '/api/tasks/:id/approve', ({ user, id }) => {
    if (user.role !== 'client') fail(403, 'Só o cliente aprova a entrega');
    const t = loadTask(user, id);
    if (t.status !== 'review') fail(409, 'Esta tarefa não está esperando sua revisão');
    completeTask(t, S.today(), null);
    db.comments.push({ id: nextId(), task_id: t.id, user_id: user.id, body: 'Entrega aprovada.', visible_to_client: 1, created_at: now() });
    return detail(user, id);
  });
  route('GET', '/api/templates', ({ user }) => { requireStaff(user); return db.templates.slice().sort((a, b) => a.name.localeCompare(b.name)); });
  route('POST', '/api/templates', ({ user, body }) => {
    requireStaff(user);
    const id = nextId();
    db.templates.push({ id, name: str(body.name, 'nome', { max: 120 }), title: str(body.title, 'título', { max: 200 }),
      description: str(body.description, 'descrição', { max: 10000, required: false }),
      checklist: (Array.isArray(body.checklist) ? body.checklist : []).map(x => String(x).trim()).filter(Boolean).slice(0, 100) });
    return { id };
  });
  route('DELETE', '/api/templates/:id', ({ user, id }) => { requireStaff(user); db.templates = db.templates.filter(t => t.id !== id); return { ok: true }; });
  route('GET', '/api/report/adjustments', ({ user }) => {
    requireStaff(user);
    const rows = new Map();
    const row = (key, name) => rows.get(key) || rows.set(key, { id: key, name, tasks: 0, internal: 0, client: 0, on_time: 0, late: 0 }).get(key);
    db.clients.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(c => row(c.id, c.name));
    for (const t of list(user, {}).concat(list(user, { archived: '1' }))) {
      const r = row(t.client_id || 'org', t.client_id ? t.client_name : `${db.org.name} (interna)`);
      r.tasks++; r.internal += t.adjustments_internal; r.client += t.adjustments_client;
      if (t.column === 'done_on_time') r.on_time++;
      if (t.column === 'done_late') r.late++;
    }
    return [...rows.values()].sort((a, b) => b.client - a.client || b.internal - a.internal || a.name.localeCompare(b.name));
  });

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    try {
      const r = routes.find(x => x.method === method && x.re.test(url.pathname));
      if (!r) fail(404, 'Rota não encontrada');
      const m = r.re.exec(url.pathname);
      const user = db.users.find(u => u.id === sessionUser && u.active) || null;
      if (!r.pub && !user) fail(401, 'Faça login');
      const out = r.handler({ user, body: init.body ? JSON.parse(init.body) : {}, id: m[1] ? Number(m[1]) : null, query: Object.fromEntries(url.searchParams) });
      persist();
      return reply(200, out);
    } catch (err) {
      if (!err.status) console.error(err);
      return reply(err.status || 500, { error: err.status ? err.message : 'Erro interno' });
    }
  };

  // Barra do protótipo: entrar em cada visão e restaurar os dados.
  window.addEventListener('DOMContentLoaded', () => {
    const bar = document.getElementById('demo-bar');
    const as = async email => {
      document.querySelectorAll('.overlay').forEach(o => o.remove());
      await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'demo1234' }) });
      location.hash = '';
      window.boot();
    };
    bar.querySelector('[data-as=admin]').addEventListener('click', () => as('admin@demo.local'));
    bar.querySelector('[data-as=member]').addEventListener('click', () => as('equipe@demo.local'));
    bar.querySelector('[data-as=client]').addEventListener('click', () => as('cliente@demo.local'));
    bar.querySelector('[data-reset]').addEventListener('click', async () => {
      if (!(await window.askConfirm('Apagar tudo o que foi feito neste protótipo e voltar aos dados iniciais?', { ok: 'Restaurar dados', danger: true }))) return;
      try { localStorage.removeItem(KEY); } catch { /* idem */ }
      db = seed(); persist(); location.hash = ''; window.boot();
    });
  });
})();
