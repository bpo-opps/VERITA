'use strict';
// API do protótipo: a mesma interface do servidor (app.js), rodando dentro do navegador.
// Os dados são fictícios e ficam só neste navegador (localStorage, quando disponível).
(function () {
  const KEY = 'tarefas-prototipo-v1';
  const STAGES = [['A fazer', 'todo'], ['Em andamento', 'doing'], ['Revisão interna', 'review'], ['Com o cliente', 'client'], ['Em ajuste', 'adjust'], ['Concluída', 'done']];
  const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const day = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const today = () => day(0);

  function seed() {
    const db = { seq: 100, org: { id: 1, name: 'Minha Consultoria', accent: '#0f766e' }, stages: [], clients: [], users: [], tasks: [], assignees: [], checklist: [], comments: [], adjustments: [], templates: [] };
    STAGES.forEach(([name, kind], i) => db.stages.push({ id: i + 1, name, kind, position: i }));
    db.clients.push({ id: 1, name: 'Padaria Exemplo', created_at: now() }, { id: 2, name: 'Clínica Modelo', created_at: now() });
    db.users.push(
      { id: 1, name: 'Admin Demo', email: 'admin@demo.local', role: 'admin', client_id: null, active: 1 },
      { id: 2, name: 'Membro Demo', email: 'equipe@demo.local', role: 'member', client_id: null, active: 1 },
      { id: 3, name: 'Cliente Padaria', email: 'cliente@demo.local', role: 'client', client_id: 1, active: 1 });
    const st = kind => db.stages.find(s => s.kind === kind).id;
    const task = (id, client, kind, title, due, who) => {
      db.tasks.push({ id, client_id: client, stage_id: st(kind), title, description: '', due_date: due, priority: 'normal', position: id, created_by: 1, created_at: now(), updated_at: now(), completed_at: kind === 'done' ? now() : null });
      who.forEach(u => db.assignees.push({ task_id: id, user_id: u }));
    };
    task(1, 1, 'todo', 'Levantar processos do financeiro', day(3), [2]);
    task(2, 1, 'doing', 'Mapear fluxo de contas a pagar', day(1), [2, 1]);
    task(3, 1, 'client', 'Relatório de diagnóstico', day(-1), [1]);
    task(4, 2, 'review', 'Conciliação bancária de setembro', day(2), [2]);
    task(5, 2, 'done', 'Reunião de kickoff', day(-7), [1]);
    db.comments.push({ id: 1, task_id: 3, user_id: 1, body: 'Versão 1 enviada para sua revisão.', visible_to_client: 1, created_at: now() });
    db.templates.push({ id: 1, name: 'Fechamento mensal', title: 'Fechamento do mês', description: '', checklist: ['Conciliar bancos', 'Conferir notas fiscais', 'Enviar relatório ao cliente'] });
    return db;
  }

  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db) db = seed();
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* sem armazenamento: fica só na memória */ } };
  let sessionUser = null;
  try { sessionUser = Number(sessionStorage.getItem(KEY + '-user')) || null; } catch { /* idem */ }
  const setSession = id => { sessionUser = id; try { id ? sessionStorage.setItem(KEY + '-user', id) : sessionStorage.removeItem(KEY + '-user'); } catch { /* idem */ } };
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
  const date = v => { if (!v) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(400, 'Data inválida (use AAAA-MM-DD)'); return v; };
  const oneOf = (v, f, opts, fb) => { if (v === undefined) return fb; if (!opts.includes(v)) fail(400, `Campo inválido: ${f}`); return v; };
  const isStaff = u => u.role !== 'client';
  const requireStaff = u => { if (!isStaff(u)) fail(403, 'Sem permissão'); };
  const requireAdmin = u => { if (u.role !== 'admin') fail(403, 'Só administradores'); };

  const stage = id => db.stages.find(s => s.id === id);
  const stageByKind = k => db.stages.find(s => s.kind === k).id;
  const clientOf = id => db.clients.find(c => c.id === id);
  const userName = id => (db.users.find(u => u.id === id) || {}).name;
  function loadTask(user, id) {
    const t = db.tasks.find(x => x.id === id);
    if (!t || (user.role === 'client' && t.client_id !== user.client_id)) fail(404, 'Tarefa não encontrada');
    return t;
  }
  function checkClient(id) { if (!clientOf(id)) fail(400, 'Cliente inválido'); }
  function checkAssignees(ids) {
    if (!Array.isArray(ids)) fail(400, 'Campo inválido: responsáveis');
    const clean = [...new Set(ids.map(Number))];
    for (const id of clean) { const u = db.users.find(x => x.id === id); if (!u || u.role === 'client' || !u.active) fail(400, 'Responsável inválido'); }
    return clean;
  }
  const setAssignees = (taskId, ids) => { db.assignees = db.assignees.filter(a => a.task_id !== taskId).concat(ids.map(user_id => ({ task_id: taskId, user_id }))); };
  const assigneesOf = taskId => db.assignees.filter(a => a.task_id === taskId).map(a => ({ id: a.user_id, name: userName(a.user_id) })).sort((a, b) => a.name.localeCompare(b.name));
  const touch = t => { t.updated_at = now(); };
  function moveTo(t, kind) { t.stage_id = stageByKind(kind); t.completed_at = kind === 'done' ? now() : null; touch(t); }

  function summary(user, t) {
    const adj = db.adjustments.filter(a => a.task_id === t.id);
    const cl = db.checklist.filter(i => i.task_id === t.id);
    const r = {
      id: t.id, client_id: t.client_id, client_name: clientOf(t.client_id).name, stage_id: t.stage_id, stage_kind: stage(t.stage_id).kind,
      title: t.title, due_date: t.due_date, priority: t.priority, position: t.position, updated_at: t.updated_at, completed_at: t.completed_at,
      checklist_total: cl.length, checklist_done: cl.filter(i => i.done).length,
      adjustments_client: adj.filter(a => a.origin === 'client').length, adjustments_internal: adj.filter(a => a.origin === 'internal').length,
      adjustments_open: adj.filter(a => !a.resolved_at).length, assignees: assigneesOf(t.id),
    };
    if (user.role === 'client') delete r.adjustments_internal;
    return r;
  }
  function detail(user, id) {
    const t = loadTask(user, id);
    const client = user.role === 'client';
    return {
      ...t, stage_kind: stage(t.stage_id).kind, client_name: clientOf(t.client_id).name, assignees: assigneesOf(t.id),
      checklist: db.checklist.filter(i => i.task_id === t.id).sort((a, b) => a.position - b.position || a.id - b.id).map(({ id, text, done }) => ({ id, text, done })),
      comments: db.comments.filter(c => c.task_id === t.id && (!client || c.visible_to_client)).map(c => {
        const u = db.users.find(x => x.id === c.user_id) || {};
        return { id: c.id, body: c.body, visible_to_client: c.visible_to_client, created_at: c.created_at, author: u.name, author_role: u.role };
      }),
      adjustments: db.adjustments.filter(a => a.task_id === t.id && (!client || a.origin === 'client'))
        .map(a => ({ id: a.id, origin: a.origin, body: a.body, created_at: a.created_at, resolved_at: a.resolved_at, author: userName(a.user_id) })),
    };
  }

  const routes = [];
  const route = (method, pattern, handler, pub = false) => {
    const re = new RegExp('^' + pattern.replace(/:id/g, '(\\d+)') + '$');
    routes.push({ method, re, handler, pub });
  };

  route('POST', '/api/login', ({ body }) => {
    const email = str(body.email, 'email', { max: 200 }).toLowerCase();
    str(body.password, 'senha', { max: 200 });
    const u = db.users.find(x => x.email === email && x.active);
    // No protótipo, qualquer conta ativa aceita a senha demo1234 (ou a senha definida ao criar o acesso).
    if (!u || body.password !== (u.password || 'demo1234')) fail(401, 'Email ou senha incorretos');
    setSession(u.id);
    return { ok: true };
  }, true);
  route('POST', '/api/logout', () => { setSession(null); return { ok: true }; });
  route('GET', '/api/me', ({ user }) => ({
    user: { id: user.id, org_id: 1, name: user.name, email: user.email, role: user.role, client_id: user.client_id },
    org: db.org, stages: db.stages.map(({ id, name, kind }) => ({ id, name, kind })),
  }));
  route('POST', '/api/me/password', ({ user, body }) => {
    const cur = str(body.current, 'senha atual'), next = str(body.password, 'nova senha');
    if (next.length < 8) fail(400, 'A nova senha precisa ter pelo menos 8 caracteres');
    if (cur !== (user.password || 'demo1234')) fail(400, 'Senha atual incorreta');
    user.password = next; return { ok: true };
  });
  route('PATCH', '/api/org', ({ user, body }) => {
    requireAdmin(user);
    const name = str(body.name, 'nome', { max: 80 }), accent = str(body.accent, 'cor', { max: 7 });
    if (!/^#[0-9a-fA-F]{6}$/.test(accent)) fail(400, 'Cor inválida (use #RRGGBB)');
    Object.assign(db.org, { name, accent }); return { ok: true };
  });
  route('GET', '/api/clients', ({ user }) => {
    if (user.role === 'client') return db.clients.filter(c => c.id === user.client_id).map(({ id, name }) => ({ id, name }));
    return db.clients.map(c => ({ id: c.id, name: c.name, open_tasks: db.tasks.filter(t => t.client_id === c.id && stage(t.stage_id).kind !== 'done').length }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
  route('POST', '/api/clients', ({ user, body }) => {
    requireAdmin(user);
    const id = nextId(); db.clients.push({ id, name: str(body.name, 'nome', { max: 120 }), created_at: now() }); return { id };
  });
  route('PATCH', '/api/clients/:id', ({ user, body, id }) => { requireAdmin(user); checkClient(id); clientOf(id).name = str(body.name, 'nome', { max: 120 }); return { ok: true }; });
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
  route('GET', '/api/tasks', ({ user, query }) => {
    let list = db.tasks.slice();
    if (user.role === 'client') list = list.filter(t => t.client_id === user.client_id);
    else if (query.client_id) list = list.filter(t => t.client_id === Number(query.client_id));
    const has = uid => t => db.assignees.some(a => a.task_id === t.id && a.user_id === uid);
    if (query.mine === '1') list = list.filter(has(user.id));
    if (query.assignee) list = list.filter(has(Number(query.assignee)));
    if (query.q) list = list.filter(t => t.title.toLowerCase().includes(String(query.q).toLowerCase()));
    return list.sort((a, b) => a.position - b.position || a.id - b.id).map(t => summary(user, t));
  });
  route('POST', '/api/tasks', ({ user, body }) => {
    requireStaff(user);
    const client_id = Number(body.client_id); checkClient(client_id);
    let title = str(body.title, 'título', { max: 200, required: !body.template_id });
    let description = str(body.description, 'descrição', { max: 10000, required: false });
    let checklist = [];
    if (body.template_id) {
      const tpl = db.templates.find(t => t.id === Number(body.template_id)); if (!tpl) fail(400, 'Modelo inválido');
      title = title || tpl.title; description = description || tpl.description; checklist = tpl.checklist;
    }
    const assignees = checkAssignees(body.assignee_ids || []);
    const id = nextId();
    db.tasks.push({ id, client_id, stage_id: stageByKind('todo'), title, description, due_date: date(body.due_date),
      priority: oneOf(body.priority, 'prioridade', ['low', 'normal', 'high'], 'normal'),
      position: Math.max(0, ...db.tasks.map(t => t.position)) + 1, created_by: user.id, created_at: now(), updated_at: now(), completed_at: null });
    setAssignees(id, assignees);
    checklist.forEach((text, i) => db.checklist.push({ id: nextId(), task_id: id, text, done: 0, position: i }));
    return { id };
  });
  route('GET', '/api/tasks/:id', ({ user, id }) => detail(user, id));
  route('PATCH', '/api/tasks/:id', ({ user, body, id }) => {
    requireStaff(user);
    const t = loadTask(user, id);
    if ('title' in body) t.title = str(body.title, 'título', { max: 200 });
    if ('description' in body) t.description = str(body.description, 'descrição', { max: 10000, required: false });
    if ('due_date' in body) t.due_date = date(body.due_date);
    if ('priority' in body) t.priority = oneOf(body.priority, 'prioridade', ['low', 'normal', 'high']);
    if ('position' in body) t.position = Number(body.position);
    if ('client_id' in body) { checkClient(Number(body.client_id)); t.client_id = Number(body.client_id); }
    if ('assignee_ids' in body) setAssignees(t.id, checkAssignees(body.assignee_ids));
    if ('stage_id' in body) { const s = stage(Number(body.stage_id)); if (!s) fail(400, 'Etapa inválida'); moveTo(t, s.kind); }
    touch(t);
    return detail(user, id);
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
  const checklistItem = (user, id) => { const i = db.checklist.find(x => x.id === id); if (!i) fail(404, 'Item não encontrado'); loadTask(user, i.task_id); return i; };
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
      visible_to_client: user.role === 'client' ? 1 : (body.visible_to_client ? 1 : 0), created_at: now() });
    touch(t); return detail(user, id);
  });
  route('POST', '/api/tasks/:id/adjustments', ({ user, body, id }) => {
    const t = loadTask(user, id);
    const text = str(body.body, 'o que ajustar', { max: 5000 });
    const origin = user.role === 'client' ? 'client' : 'internal';
    if (origin === 'client' && stage(t.stage_id).kind !== 'client') fail(409, 'Só é possível pedir ajuste quando a tarefa está com você para revisão');
    db.adjustments.push({ id: nextId(), task_id: t.id, origin, body: text, user_id: user.id, created_at: now(), resolved_at: null });
    moveTo(t, 'adjust'); return detail(user, id);
  });
  route('POST', '/api/adjustments/:id/resolve', ({ user, id }) => {
    requireStaff(user);
    const a = db.adjustments.find(x => x.id === id); if (!a) fail(404, 'Ajuste não encontrado');
    loadTask(user, a.task_id); a.resolved_at = a.resolved_at || now(); return detail(user, a.task_id);
  });
  route('POST', '/api/tasks/:id/approve', ({ user, id }) => {
    if (user.role !== 'client') fail(403, 'Só o cliente aprova a entrega');
    const t = loadTask(user, id);
    if (stage(t.stage_id).kind !== 'client') fail(409, 'Esta tarefa não está aguardando sua aprovação');
    moveTo(t, 'done');
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
    return db.clients.map(c => {
      const ids = db.tasks.filter(t => t.client_id === c.id).map(t => t.id);
      const adj = db.adjustments.filter(a => ids.includes(a.task_id));
      return { id: c.id, name: c.name, tasks: ids.length, internal: adj.filter(a => a.origin === 'internal').length, client: adj.filter(a => a.origin === 'client').length };
    }).sort((a, b) => b.client - a.client || b.internal - a.internal || a.name.localeCompare(b.name));
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
      return reply(method === 'POST' && out && out.id && !out.title ? 201 : 200, out);
    } catch (err) {
      return reply(err.status || 500, { error: err.status ? err.message : 'Erro interno' });
    }
  };

  // Barra do protótipo: entrar como cada papel e restaurar os dados.
  window.addEventListener('DOMContentLoaded', () => {
    const bar = document.getElementById('demo-bar');
    const as = async email => {
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
