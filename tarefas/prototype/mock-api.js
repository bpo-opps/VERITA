'use strict';
/* global Shared */
// API do protótipo: a mesma interface do servidor (app.js), rodando dentro do navegador.
// As regras (colunas, alertas, recorrência, %, quem vê) vêm de shared.js, igual ao servidor.
// Os dados são fictícios e ficam só neste navegador (localStorage, quando disponível).
(function () {
  const S = window.Shared;
  const KEY = 'tarefas-prototipo-v4';
  const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const d = n => S.addDays(S.today(), n);

  function svgLogo(text, color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/>` +
      `<text x="32" y="41" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">${text}</text></svg>`;
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }

  function seed() {
    const OPPS_SYMBOL = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="24" y="6" width="16" height="36" rx="4" fill="#FB4F14"/><rect x="24" y="46" width="16" height="12" rx="4" fill="#FB4F14"/></svg>');
    const db = { seq: 100, org: { id: 1, name: 'Opps Consultoria', accent: '#FB4F14', logo: OPPS_SYMBOL },
      clients: [], users: [], tasks: [], assignees: [], checklist: [], comments: [], adjustments: [], templates: [], notifications: [], meetings: [], meeting_items: [] };
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
        id: tid, kind: t.kind, client_id: t.client ?? null, client_visible: t.visible ? 1 : 0, status: t.status || 'todo', title: t.title, description: '',
        start_date: t.start ?? null, due_date: t.due ?? null, completed_on: t.done ?? null, cancelled_on: t.cancelled ?? null,
        cancel_reason: t.reason ?? null, progress: t.progress || 0,
        priority: t.priority || 'normal', alerts: t.alerts || [1], recurrence: t.recurrence || 'none', recurrence_every: null,
        next_task_id: null, position: tid, created_by: t.by || 1, created_at: now(), updated_at: now(), archived_at: t.archived ? now() : null,
      });
      who.forEach(u => db.assignees.push({ task_id: tid, user_id: u }));
      checklist.forEach(([text, done], i) => db.checklist.push({ id: 1000 + db.checklist.length, task_id: tid, text, done: done ? 1 : 0, position: i }));
      return tid;
    };
    task({ kind: 'external', client: 1, title: 'Levantar processos do financeiro', due: d(5), alerts: [1, 3] }, [2]);
    task({ kind: 'external', client: 1, status: 'doing', title: 'Mapear fluxo de contas a pagar', start: d(-4), due: d(2), progress: 40 }, [2, 1]);
    task({ kind: 'external', client: 2, status: 'doing', title: 'Fechamento contábil de setembro', start: d(-6), due: d(1), alerts: [0, 1, 3], recurrence: 'monthly', priority: 'high' }, [3],
      [['Conciliar bancos', true], ['Conferir notas fiscais', true], ['Lançar provisões', false], ['Enviar relatório ao cliente', false]]);
    const rev = task({ kind: 'external', client: 1, status: 'review', title: 'Relatório de diagnóstico', start: d(-10), due: d(3), progress: 90 }, [1]);
    db.comments.push({ id: 1, task_id: rev, user_id: 1, body: 'Versão 1 pronta para sua revisão.', visible_to_client: 1, created_at: now() });
    task({ kind: 'external', client: 2, status: 'doing', title: 'Conciliação bancária de agosto', start: d(-12), due: d(-2), progress: 70 }, [2]);
    task({ kind: 'external', client: 2, status: 'done', title: 'Reunião de kickoff', start: d(-16), due: d(-14), done: d(-15) }, [1]);
    task({ kind: 'external', client: 1, status: 'done', title: 'Cadastro de fornecedores', start: d(-12), due: d(-9), done: d(-6) }, [2]);
    task({ kind: 'external', client: 2, status: 'cancelled', title: 'Treinamento do sistema de ponto', due: d(4), cancelled: d(-1), reason: 'Cliente decidiu trocar de sistema de ponto antes do treinamento.' }, [3]);
    task({ kind: 'internal', title: 'Planejamento comercial do trimestre', due: d(10), alerts: [7], recurrence: 'quarterly' }, []);
    task({ kind: 'internal', client: 1, visible: true, status: 'doing', title: 'Preparar proposta de renovação da Padaria', start: d(-1), due: d(6), progress: 30, by: 2 }, [2]);
    task({ kind: 'internal', client: 1, status: 'doing', title: 'Revisar margem do contrato da Padaria', due: d(0), progress: 20, alerts: [0], by: 2 }, [2]);
    task({ kind: 'internal', title: 'Atualizar modelo de relatório mensal', due: d(15), by: 3 }, [3]);
    task({ kind: 'external', client: 2, status: 'done', title: 'Levantamento inicial (antigo)', due: d(-40), done: d(-41), archived: true }, [1]);
    db.templates.push({ id: 1, name: 'Fechamento mensal', title: 'Fechamento do mês', description: '',
      checklist: ['Conciliar bancos', 'Conferir notas fiscais', 'Lançar provisões', 'Enviar relatório ao cliente'] });
    return db;
  }

  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db) db = seed();
  db.notifications = db.notifications || [];
  db.meetings = db.meetings || [];
  db.meeting_items = db.meeting_items || [];
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
  const clientVisible = (kind, cid, flag) => (kind === 'internal' && cid && flag ? 1 : 0);
  const checklistItems = v => {
    if (v === undefined) return null;
    if (!Array.isArray(v)) fail(400, 'Checklist inválido');
    return v.map(x => str(x, 'item do checklist', { max: 300, required: false })).filter(Boolean).slice(0, 100);
  };

  // Avisos: o protótipo registra quem receberia, como o servidor faria, mas nada sai daqui.
  const NOT_SENT = 'Protótipo: nada é enviado. No sistema instalado, sai por e-mail (Google) e WhatsApp.';
  function notice(u, t, kind, subject, body) {
    const ch = [];
    if (u.notify_email !== 0) ch.push('email');
    if (u.notify_whatsapp && u.phone && u.whatsapp_consent_at) ch.push('whatsapp');
    for (const channel of ch) db.notifications.push({ id: nextId(), user_id: u.id, task_id: t ? t.id : null, channel, kind, subject, body,
      status: 'not_sent', error: NOT_SENT, created_at: now(), sent_at: null });
  }
  function noticeCreated(tid, actorId) {
    const t = db.tasks.find(x => x.id === tid);
    const ids = new Set(assigneeIds(tid));
    if (S.clientSees(t)) db.users.filter(u => u.role === 'client' && u.client_id === t.client_id && u.active).forEach(u => ids.add(u.id));
    ids.delete(actorId);
    for (const u of db.users.filter(x => ids.has(x.id) && x.active && S.canSee(x, t, assigneeIds(tid)))) {
      notice(u, t, 'created', `Nova tarefa: ${t.title}`, `Olá, ${u.name}.\n\nUma tarefa foi criada para você: ${t.title}` +
        (t.due_date ? `\nPrazo: ${t.due_date.split('-').reverse().join('/')}` : '') + '\n\nAbra o Painel de Tarefas Opps para ver os detalhes.');
    }
  }

  function completeTask(t, completedOn, userId) {
    if (completedOn > S.today()) fail(400, 'A data de término não pode ser no futuro');
    if (t.start_date && completedOn < t.start_date) fail(400, 'A data de término não pode ser antes do início');
    Object.assign(t, { status: 'done', completed_on: completedOn, cancelled_on: null, cancel_reason: null, progress: 100 }); touch(t);
    if (t.recurrence === 'none' || t.next_task_id) return null;
    const nid = nextId();
    db.tasks.push({ ...t, id: nid, status: 'todo', completed_on: null, progress: 0, next_task_id: null, archived_at: null,
      start_date: null, due_date: S.nextDate(t.due_date || completedOn, t.recurrence, t.recurrence_every),
      position: Math.max(0, ...db.tasks.map(x => x.position)) + 1, created_by: t.created_by ?? userId, created_at: now(), updated_at: now() });
    setAssignees(nid, assigneeIds(t.id));
    db.checklist.filter(i => i.task_id === t.id).forEach(i => db.checklist.push({ ...i, id: nextId(), task_id: nid, done: 0 }));
    t.next_task_id = nid;
    noticeCreated(nid, null);
    return nid;
  }

  function decorate(user, t) {
    const cl = db.checklist.filter(i => i.task_id === t.id);
    const adj = db.adjustments.filter(a => a.task_id === t.id);
    const out = {
      id: t.id, kind: t.kind, client_id: t.client_id, client_name: t.client_id ? clientOf(t.client_id).name : null, client_visible: S.clientSees(t), status: t.status,
      column: S.column(t), title: t.title, start_date: t.start_date, due_date: t.due_date, completed_on: t.completed_on,
      cancelled_on: t.cancelled_on, cancel_reason: t.cancel_reason,
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
    if (q.due === 'overdue') ts = ts.filter(t => t.due_date && t.due_date < today && !['done', 'cancelled'].includes(t.status));
    if (q.due === 'today') ts = ts.filter(t => t.due_date === today);
    if (q.due === 'week') ts = ts.filter(t => t.due_date && t.due_date >= today && t.due_date <= S.addDays(today, 7));
    if (q.due === 'month') ts = ts.filter(t => t.due_date && t.due_date.slice(0, 7) === today.slice(0, 7));
    if (q.due === 'none') ts = ts.filter(t => !t.due_date);
    if (q.q) ts = ts.filter(t => t.title.toLowerCase().includes(String(q.q).toLowerCase()));
    if (q.recurring === '1') ts = ts.filter(t => t.recurrence !== 'none');
    if (q.recurring === '0') ts = ts.filter(t => t.recurrence === 'none');
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
  route('GET', '/api/me/notify', ({ user }) => ({ email: user.email, phone: user.phone || null, notify_email: user.notify_email !== 0,
    notify_whatsapp: !!user.notify_whatsapp, whatsapp_consent: !!user.whatsapp_consent_at, channels: { email: false, whatsapp: false } }));
  route('PATCH', '/api/me/notify', ({ user, body }) => {
    let phone = user.phone || null;
    if ('phone' in body) {
      const raw = body.phone ? String(body.phone).replace(/\D/g, '') : '';
      phone = !raw ? null : /^\d{10,11}$/.test(raw) ? '55' + raw : /^\d{12,15}$/.test(raw) ? raw : undefined;
      if (phone === undefined) fail(400, 'Celular inválido: use DDD e número, por exemplo (11) 98765-4321');
    }
    let consentAt = user.whatsapp_consent_at || null;
    if ('consent' in body) consentAt = body.consent ? (consentAt || now()) : null;
    let wa = 'notify_whatsapp' in body ? (body.notify_whatsapp ? 1 : 0) : (user.notify_whatsapp || 0);
    if ('notify_whatsapp' in body && wa && !phone) fail(400, 'Para receber no WhatsApp, informe o celular');
    if ('notify_whatsapp' in body && wa && !consentAt) fail(400, 'Para receber no WhatsApp, marque a autorização');
    if (!phone || !consentAt) wa = 0;
    Object.assign(user, { phone, whatsapp_consent_at: consentAt, notify_whatsapp: wa,
      notify_email: 'notify_email' in body ? (body.notify_email ? 1 : 0) : (user.notify_email === 0 ? 0 : 1) });
    return { ok: true };
  });
  route('GET', '/api/notify/status', ({ user }) => { requireAdmin(user); return { email: { configured: false }, whatsapp: { configured: false }, app_url: null, schedule: null }; });
  route('GET', '/api/notifications', ({ user }) => {
    requireAdmin(user);
    return db.notifications.slice(-200).reverse().map(n => {
      const u = db.users.find(x => x.id === n.user_id) || {}, t = db.tasks.find(x => x.id === n.task_id);
      return { ...n, user_name: u.name, user_role: u.role, task_title: t ? t.title : null };
    });
  });
  route('POST', '/api/notifications/run', ({ user }) => { requireAdmin(user); return { sent: 0 }; });
  route('POST', '/api/notifications/test', ({ user }) => {
    requireAdmin(user);
    notice({ ...user, notify_email: 1, notify_whatsapp: 0 }, null, 'test', 'Teste de aviso do Painel de Tarefas Opps', `Olá, ${user.name}.\n\nSe este e-mail chegou, o envio está funcionando.`);
    return { status: 'not_sent', error: NOT_SENT };
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
    const open = (cid, kind) => db.tasks.filter(t => t.client_id === cid && t.kind === kind && !['done', 'cancelled'].includes(t.status) && !t.archived_at).length;
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
  function createTask(user, body) {
    requireStaff(user);
    if (body.kind === undefined) fail(400, 'Escolha se a tarefa é interna ou externa');
    const kind = oneOf(body.kind, 'tipo', ['internal', 'external']);
    const client_id = kindAndClient(kind, body.client_id ? Number(body.client_id) : null);
    let title = str(body.title, 'título', { max: 200, required: !body.template_id });
    let description = str(body.description, 'descrição', { max: 10000, required: false });
    let checklist = checklistItems(body.checklist);
    if (body.template_id) {
      const tpl = db.templates.find(t => t.id === Number(body.template_id)); if (!tpl) fail(400, 'Modelo inválido');
      title = title || tpl.title; description = description || tpl.description; checklist = checklist ?? tpl.checklist;
    }
    checklist = checklist || [];
    const due = date(body.due_date, 'Prazo');
    const { rec, every } = recurrence(body);
    const assignees = checkAssignees(body.assignee_ids || []);
    const id = nextId();
    db.tasks.push({ id, kind, client_id, client_visible: clientVisible(kind, client_id, body.client_visible), status: 'todo', title, description,
      start_date: null, due_date: due, completed_on: null, cancelled_on: null, cancel_reason: null, progress: 0,
      priority: oneOf(body.priority, 'prioridade', ['low', 'normal', 'high'], 'normal'), alerts: body.alerts === undefined ? [1] : alerts(body.alerts),
      recurrence: rec, recurrence_every: every, next_task_id: null, position: Math.max(0, ...db.tasks.map(t => t.position)) + 1,
      created_by: user.id, created_at: now(), updated_at: now(), archived_at: null });
    setAssignees(id, assignees);
    checklist.forEach((text, i) => db.checklist.push({ id: nextId(), task_id: id, text, done: 0, position: i }));
    noticeCreated(id, user.id);
    return id;
  }
  route('POST', '/api/tasks', ({ user, body }) => ({ id: createTask(user, body) }));
  route('GET', '/api/tasks/:id', ({ user, id }) => detail(user, id));
  const CLIENT_FIELDS = ['status', 'start_date', 'progress'];
  route('PATCH', '/api/tasks/:id', ({ user, body, id }) => {
    const t = loadTask(user, id);
    if (user.role === 'client') {
      if (!Object.keys(body).every(k => CLIENT_FIELDS.includes(k))) fail(403, 'Você pode alterar a situação, a data de início e o % de execução');
      if (t.status === 'done' || t.status === 'cancelled') fail(409, 'Esta tarefa já foi encerrada');
    }
    const copy = { ...t };
    try {
      if ('title' in body) t.title = str(body.title, 'título', { max: 200 });
      if ('description' in body) t.description = str(body.description, 'descrição', { max: 10000, required: false });
      if ('kind' in body || 'client_id' in body || 'client_visible' in body) {
        const kind = 'kind' in body ? oneOf(body.kind, 'tipo', ['internal', 'external']) : t.kind;
        const cid = kindAndClient(kind, 'client_id' in body ? (body.client_id ? Number(body.client_id) : null) : t.client_id);
        t.client_visible = clientVisible(kind, cid, 'client_visible' in body ? body.client_visible : t.client_visible);
        t.client_id = cid; t.kind = kind;
      }
      if ('start_date' in body) t.start_date = date(body.start_date, 'Início');
      if ('due_date' in body) t.due_date = date(body.due_date, 'Prazo');
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
      if ('status' in body) {
        if (body.status === 'done') fail(400, 'Para concluir, use Concluir e informe a data de término');
        if (body.status === 'cancelled') fail(400, 'Para cancelar, use Cancelar e informe o motivo');
        t.status = oneOf(body.status, 'situação', ['todo', 'doing', 'review']);
        Object.assign(t, { completed_on: null, cancelled_on: null, cancel_reason: null });
        if (t.status !== 'todo' && !('start_date' in body)) t.start_date = t.start_date || S.today();
      } else if (body.start_date && t.status === 'todo') t.status = 'doing';
    } catch (err) { Object.assign(t, copy); throw err; }
    touch(t);
    return detail(user, id);
  });
  route('POST', '/api/tasks/:id/complete', ({ user, body, id }) => {
    const t = loadTask(user, id);
    if (user.role === 'client' && (t.status === 'done' || t.status === 'cancelled')) fail(409, 'Esta tarefa já foi encerrada');
    const nid = completeTask(t, date(body.completed_on, 'Término') || S.today(), user.id);
    return { ...detail(user, id), created_next_id: nid };
  });
  route('POST', '/api/tasks/:id/cancel', ({ user, body, id }) => {
    requireStaff(user); const t = loadTask(user, id);
    const reason = str(body.reason, 'motivo do cancelamento', { max: 1000 });
    Object.assign(t, { status: 'cancelled', cancel_reason: reason, cancelled_on: S.today(), completed_on: null }); touch(t);
    return detail(user, id);
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
    if (user.role === 'client' && Object.keys(body).some(k => k !== 'done')) fail(403, 'Você pode marcar os itens, não editar o texto');
    const i = checklistItem(user, id);
    const task = db.tasks.find(x => x.id === i.task_id);
    if (user.role === 'client' && (task.status === 'done' || task.status === 'cancelled')) fail(409, 'Esta tarefa já foi encerrada');
    if ('done' in body) i.done = body.done ? 1 : 0;
    const start = body.done ? S.startByChecklist(task, S.today()) : null;
    if (start) { Object.assign(task, start); touch(task); }
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
      visible_to_client: user.role === 'client' ? 1 : (S.clientSees(t) && body.visible_to_client ? 1 : 0), created_at: now() });
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
  // Reuniões. No protótipo a leitura da ata é simulada: as sugestões são de exemplo, montadas com
  // quem estava presente. O PDF fica só na memória desta aba (não cabe no armazenamento do navegador).
  const pdfs = new Map();
  const loadMeeting = (user, mid) => { requireStaff(user); const m = db.meetings.find(x => x.id === mid); if (!m) fail(404, 'Reunião não encontrada'); return m; };
  const loadItem = (user, iid) => { const it = db.meeting_items.find(x => x.id === iid); if (!it) fail(404, 'Tarefa sugerida não encontrada'); loadMeeting(user, it.meeting_id); return it; };
  const meetingDetail = (user, mid) => ({ ...loadMeeting(user, mid), ai: true,
    items: db.meeting_items.filter(i => i.meeting_id === mid).sort((a, b) => a.position - b.position || a.id - b.id) });
  function simulateReading(mid) {
    setTimeout(() => {
      const m = db.meetings.find(x => x.id === mid); if (!m) return;
      const people = m.attendee_ids.map(uid => db.users.find(u => u.id === uid)).filter(Boolean);
      const staff = people.filter(u => u.role !== 'client'), cli = people.find(u => u.role === 'client');
      const s1 = staff[0], s2 = staff[1] || staff[0];
      const first = u => (u ? u.name.split(' ')[0] : 'A equipe');
      const c = db.clients.find(x => x.id === m.client_id);
      const plus = n => S.addDays(m.meeting_date, n);
      const sug = [
        { title: 'Enviar o resumo da reunião com os próximos passos', kind: c ? 'external' : 'internal', who: s1, due: plus(1), priority: 'normal',
          quote: `${first(s1)} fica de mandar o resumo amanhã.` },
        c && { title: `Revisar a conciliação bancária da ${c.name}`, kind: 'external', who: s2, due: plus(7), priority: 'high',
          checklist: ['Conferir os extratos', 'Apontar as divergências', 'Enviar o relatório'], quote: `${first(s2)} revisa a conciliação até a próxima semana.` },
        c && { title: 'Receber os extratos bancários do mês', kind: 'external', who: s1, due: plus(3), priority: 'normal', cr: cli ? cli.name : 'Financeiro do cliente',
          quote: `${cli ? first(cli) : 'O cliente'} manda os extratos até ${S.addDays(m.meeting_date, 3).split('-').reverse().slice(0, 2).join('/')}.` },
        { title: 'Agendar a próxima reunião de acompanhamento', kind: 'internal', who: s1, due: null, priority: 'low', quote: 'Marcar a próxima conversa em um mês.' },
      ].filter(Boolean);
      sug.forEach((t, i) => db.meeting_items.push({ id: nextId(), meeting_id: mid, title: t.title, description: 'Combinado na reunião.', kind: t.kind,
        client_id: m.client_id, client_visible: false, assignee_ids: t.who ? [t.who.id] : [], client_responsible: t.cr || '', due_date: t.due,
        priority: t.priority, checklist: t.checklist || [], quote: t.quote, status: 'pending', task_id: null, decided_at: null, position: i + 1 }));
      Object.assign(m, { status: 'ready', error: null,
        summary: 'Protótipo: leitura simulada, com sugestões de exemplo montadas a partir de quem estava presente. No sistema instalado, a IA lê o PDF da ata e sugere as tarefas que estão nele.' });
      persist();
    }, 1800);
  }
  route('GET', '/api/meetings', ({ user }) => {
    requireStaff(user);
    return db.meetings.slice().sort((a, b) => b.meeting_date.localeCompare(a.meeting_date) || b.id - a.id).map(m => {
      const its = db.meeting_items.filter(i => i.meeting_id === m.id), n = st => its.filter(i => i.status === st).length;
      return { ...m, client_name: (db.clients.find(c => c.id === m.client_id) || {}).name || null, pending: n('pending'), approved: n('approved'), discarded: n('discarded') };
    });
  });
  route('POST', '/api/meetings', ({ user, body }) => {
    requireStaff(user);
    const title = str(body.title, 'título', { max: 200 });
    const meeting_date = date(body.meeting_date, 'Data da reunião'); if (!meeting_date) fail(400, 'Informe a data da reunião');
    const client_id = body.client_id ? Number(body.client_id) : null; if (client_id) checkClient(client_id);
    const attendee_ids = [...new Set((body.attendee_ids || []).map(Number))];
    attendee_ids.forEach(uid => { if (!db.users.some(u => u.id === uid)) fail(400, 'Participante inválido'); });
    const other_attendees = str(body.other_attendees, 'outros participantes', { max: 1000, required: false });
    if (!attendee_ids.length && !other_attendees) fail(400, 'Marque quem estava presente');
    if (typeof body.pdf !== 'string' || !body.pdf.startsWith('data:application/pdf;base64,')) fail(400, 'Anexe o PDF da reunião');
    if (atob(body.pdf.slice(28, 40)).slice(0, 5) !== '%PDF-') fail(400, 'O arquivo não é um PDF');
    const id = nextId();
    pdfs.set(id, { name: body.pdf_name || 'ata.pdf', data: body.pdf.slice(28) });
    db.meetings.push({ id, title, meeting_date, client_id, attendee_ids, other_attendees, pdf_name: body.pdf_name || 'ata.pdf', summary: null,
      status: 'processing', error: null, created_by: user.id, created_at: now() });
    simulateReading(id);
    return { id };
  });
  route('GET', '/api/meetings/:id', ({ user, id }) => meetingDetail(user, id));
  route('GET', '/api/meetings/:id/pdf', ({ user, id }) => {
    loadMeeting(user, id);
    if (!pdfs.has(id)) fail(404, 'No protótipo, o PDF fica guardado só até recarregar a página.');
    return pdfs.get(id);
  });
  route('POST', '/api/meetings/:id/process', ({ user, id }) => {
    const m = loadMeeting(user, id);
    if (m.status === 'processing') fail(409, 'A ata já está sendo lida');
    db.meeting_items = db.meeting_items.filter(i => !(i.meeting_id === id && i.status === 'pending'));
    m.status = 'processing'; simulateReading(id);
    return meetingDetail(user, id);
  });
  route('DELETE', '/api/meetings/:id', ({ user, id }) => {
    const m = loadMeeting(user, id);
    if (user.role !== 'admin' && m.created_by !== user.id) fail(403, 'Só quem lançou a reunião ou um administrador pode apagar');
    db.meetings = db.meetings.filter(x => x.id !== id); db.meeting_items = db.meeting_items.filter(i => i.meeting_id !== id); pdfs.delete(id);
    return { ok: true };
  });
  route('POST', '/api/meetings/:id/items', ({ user, id, body }) => {
    const m = loadMeeting(user, id);
    const it = { id: nextId(), meeting_id: id, title: str(body.title, 'título', { max: 200 }), description: '', kind: m.client_id ? 'external' : 'internal',
      client_id: m.client_id, client_visible: false, assignee_ids: [], client_responsible: '', due_date: null, priority: 'normal', checklist: [], quote: '',
      status: 'pending', task_id: null, decided_at: null, position: Math.max(0, ...db.meeting_items.filter(i => i.meeting_id === id).map(i => i.position)) + 1 };
    db.meeting_items.push(it); return it;
  });
  route('PATCH', '/api/meeting-items/:id', ({ user, id, body }) => {
    const it = loadItem(user, id);
    if (it.status === 'approved') fail(409, 'Esta tarefa já foi lançada; edite no quadro de tarefas');
    const kind = oneOf(body.kind, 'tipo', ['internal', 'external'], it.kind);
    const client_id = 'client_id' in body ? (body.client_id ? Number(body.client_id) : null) : it.client_id;
    if (client_id) checkClient(client_id);
    if ('title' in body) it.title = str(body.title, 'título', { max: 200 });
    if ('description' in body) it.description = str(body.description, 'descrição', { max: 10000, required: false });
    if ('assignee_ids' in body) it.assignee_ids = checkAssignees(body.assignee_ids);
    if ('client_responsible' in body) it.client_responsible = str(body.client_responsible, 'responsável no cliente', { max: 120, required: false });
    if ('due_date' in body) it.due_date = date(body.due_date, 'Prazo');
    if ('priority' in body) it.priority = oneOf(body.priority, 'prioridade', ['low', 'normal', 'high']);
    if ('checklist' in body) it.checklist = checklistItems(body.checklist);
    Object.assign(it, { kind, client_id, client_visible: !!clientVisible(kind, client_id, 'client_visible' in body ? body.client_visible : it.client_visible) });
    return it;
  });
  route('POST', '/api/meeting-items/:id/approve', ({ user, id }) => {
    const it = loadItem(user, id);
    if (it.status === 'approved') fail(409, 'Esta tarefa já foi lançada');
    const m = loadMeeting(user, it.meeting_id);
    const description = [it.description, it.client_responsible ? `Responsável no cliente: ${it.client_responsible}` : '',
      `Da reunião "${m.title}" de ${m.meeting_date.split('-').reverse().join('/')}.`].filter(Boolean).join('\n\n');
    const task_id = createTask(user, { kind: it.kind, client_id: it.client_id, client_visible: it.client_visible, title: it.title, description,
      due_date: it.due_date, priority: it.priority, assignee_ids: it.assignee_ids, checklist: it.checklist });
    Object.assign(it, { status: 'approved', task_id, decided_at: now() });
    return { task_id };
  });
  route('POST', '/api/meeting-items/:id/discard', ({ user, id }) => {
    const it = loadItem(user, id);
    if (it.status === 'approved') fail(409, 'Esta tarefa já foi lançada; cancele no quadro de tarefas');
    Object.assign(it, { status: 'discarded', decided_at: now() }); return { ok: true };
  });
  route('POST', '/api/meeting-items/:id/restore', ({ user, id }) => {
    const it = loadItem(user, id);
    if (it.status !== 'discarded') fail(409, 'Só dá para voltar uma tarefa descartada');
    Object.assign(it, { status: 'pending', decided_at: null }); return { ok: true };
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
    const row = (key, name) => rows.get(key) || rows.set(key, { id: key, name, tasks: 0, internal: 0, client: 0, on_time: 0, late: 0, cancelled: 0 }).get(key);
    db.clients.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(c => row(c.id, c.name));
    for (const t of list(user, {}).concat(list(user, { archived: '1' }))) {
      const r = row(t.client_id || 'org', t.client_id ? t.client_name : `${db.org.name} (interna)`);
      r.tasks++; r.internal += t.adjustments_internal; r.client += t.adjustments_client;
      if (t.column === 'done_on_time') r.on_time++;
      if (t.column === 'cancelled') r.cancelled++;
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
    // Cliente: se houver mais de um acesso de cliente (por exemplo, um criado em Pessoas), pergunta qual.
    bar.querySelector('[data-as=client]').addEventListener('click', async () => {
      const cs = db.users.filter(u => u.role === 'client' && u.active);
      const pick = cs.length > 1 ? await window.askChoice('Entrar como qual cliente?',
        cs.map(u => [u.id, u.name, (db.clients.find(c => c.id === u.client_id) || {}).name])) : cs[0]?.id;
      if (!pick) return;
      document.querySelectorAll('.overlay').forEach(o => o.remove());
      setSession(pick); location.hash = ''; window.boot();
    });
    bar.querySelector('[data-reset]').addEventListener('click', async () => {
      if (!(await window.askConfirm('Apagar tudo o que foi feito neste protótipo e voltar aos dados iniciais?', { ok: 'Restaurar dados', danger: true }))) return;
      try { localStorage.removeItem(KEY); } catch { /* idem */ }
      db = seed(); persist(); location.hash = ''; window.boot();
    });
  });
})();
