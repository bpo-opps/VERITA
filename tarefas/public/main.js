'use strict';

// ---------- utilidades ----------
const state = { me: null, org: null, stages: [], clients: [], users: [], templates: [], filters: { client_id: '', assignee: '', q: '' } };

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { state.me = null; renderLogin(); throw new Error('Faça login'); }
  if (!res.ok) throw new Error(data.error || 'Algo deu errado');
  return data;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
const guard = fn => async (...args) => { try { await fn(...args); } catch (e) { toast(e.message); } };

const today = () => new Date().toISOString().slice(0, 10);
function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}
function fmtDateTime(s) {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
const PRIORITY = { low: 'Baixa', normal: 'Normal', high: 'Alta' };
const ROLE = { admin: 'Administrador', member: 'Equipe', client: 'Cliente' };
const isStaff = () => state.me && state.me.role !== 'client';
const isAdmin = () => state.me && state.me.role === 'admin';

// Cor da marca: escolhe texto branco ou preto sobre ela pelo contraste.
function applyAccent(hex) {
  const lum = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--on-accent', (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#000000' : '#ffffff');
}

// ---------- shell ----------
const app = () => document.getElementById('app');

function renderLogin(message) {
  document.title = 'Entrar';
  const err = h('p', { class: 'error', role: 'alert' }, message || '');
  const form = h('form', { class: 'login', onsubmit: async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('POST', '/api/login', { email: fd.get('email'), password: fd.get('password') });
      await boot();
    } catch (ex) { err.textContent = ex.message; }
  } },
    h('h1', {}, 'Entrar'),
    h('p', { class: 'muted' }, 'Acesse com o email e a senha que você recebeu.'),
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), h('input', { id: 'email', name: 'email', type: 'email', autocomplete: 'username', required: true })),
    h('div', { class: 'field' }, h('label', { for: 'password' }, 'Senha'), h('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
    err,
    h('button', { class: 'btn primary', type: 'submit' }, 'Entrar'));
  app().replaceChildren(form);
  form.querySelector('input').focus();
}

const NAV_STAFF = [
  ['#/quadro', 'Quadro'], ['#/minhas', 'Minhas tarefas'], ['#/clientes', 'Clientes'],
  ['#/modelos', 'Modelos'], ['#/relatorio', 'Ajustes por cliente'], ['#/equipe', 'Pessoas'], ['#/config', 'Configurações'],
];
const NAV_CLIENT = [['#/portal', 'Minhas entregas'], ['#/config', 'Minha conta']];

function shell(content) {
  const nav = isStaff() ? NAV_STAFF : NAV_CLIENT;
  const current = location.hash.split('?')[0] || nav[0][0];
  app().replaceChildren(
    h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), state.org.name),
      h('nav', { class: 'main', 'aria-label': 'Principal' },
        nav.map(([href, label]) => h('a', { href, 'aria-current': current === href ? 'page' : null }, label))),
      h('div', { class: 'who' }, `${state.me.name} · ${ROLE[state.me.role]}`,
        h('button', { class: 'btn small', onclick: guard(async () => { await api('POST', '/api/logout'); state.me = null; renderLogin(); }) }, 'Sair'))),
    h('main', {}, content));
}

async function loadCommon() {
  const me = await api('GET', '/api/me');
  state.me = me.user; state.org = me.org; state.stages = me.stages;
  applyAccent(me.org.accent);
  state.clients = await api('GET', '/api/clients');
  if (isStaff()) {
    [state.users, state.templates] = await Promise.all([api('GET', '/api/users'), api('GET', '/api/templates')]);
  }
}

async function boot() {
  try { await loadCommon(); } catch { renderLogin(); return; }
  route();
}

const ROUTES = {
  '#/quadro': viewBoard, '#/minhas': viewMine, '#/clientes': viewClients, '#/modelos': viewTemplates,
  '#/relatorio': viewReport, '#/equipe': viewTeam, '#/config': viewSettings, '#/portal': viewPortal,
};

function route() {
  if (!state.me) return;
  const key = location.hash.split('?')[0];
  const fallback = isStaff() ? '#/quadro' : '#/portal';
  const staffOnly = !['#/portal', '#/config'].includes(key);
  const view = ROUTES[key];
  if (!view || (isStaff() && key === '#/portal') || (!isStaff() && staffOnly)) { location.hash = fallback; return; }
  guard(view)();
}
window.addEventListener('hashchange', route);

// ---------- quadro ----------
function taskCard(t, { draggable = false } = {}) {
  const late = t.due_date && t.due_date < today() && t.stage_kind !== 'done';
  const card = h('button', { class: 'task', type: 'button', draggable: draggable ? 'true' : null, 'data-id': t.id,
    onclick: () => openTask(t.id) },
    h('div', { class: 'title' }, t.title),
    h('div', { class: 'meta' },
      state.filters.client_id ? null : h('span', {}, t.client_name),
      t.due_date ? h('span', { class: 'tag' + (late ? ' late' : '') }, (late ? 'Atrasada · ' : '') + fmtDate(t.due_date)) : null,
      t.priority === 'high' ? h('span', { class: 'tag high' }, 'Alta') : null,
      t.adjustments_open ? h('span', { class: 'tag adj', title: 'Ajustes em aberto' }, `${t.adjustments_open} ajuste${t.adjustments_open > 1 ? 's' : ''}`) : null,
      t.checklist_total ? h('span', {}, `☑ ${t.checklist_done}/${t.checklist_total}`) : null,
      h('span', { class: 'avatars' }, t.assignees.map(a => h('span', { class: 'avatar', title: a.name }, initials(a.name))))));
  return card;
}

function filterToolbar(extra) {
  const f = state.filters;
  const rerender = () => route();
  return h('div', { class: 'toolbar' },
    h('label', { class: 'sr-only', for: 'f-client' }, 'Cliente'),
    h('select', { id: 'f-client', onchange: e => { f.client_id = e.target.value; rerender(); } },
      h('option', { value: '' }, 'Todos os clientes'),
      state.clients.map(c => h('option', { value: c.id, selected: String(c.id) === f.client_id }, c.name))),
    h('label', { class: 'sr-only', for: 'f-who' }, 'Responsável'),
    h('select', { id: 'f-who', onchange: e => { f.assignee = e.target.value; rerender(); } },
      h('option', { value: '' }, 'Todos os responsáveis'),
      state.users.filter(u => u.role !== 'client' && u.active).map(u => h('option', { value: u.id, selected: String(u.id) === f.assignee }, u.name))),
    h('label', { class: 'sr-only', for: 'f-q' }, 'Buscar'),
    h('input', { id: 'f-q', type: 'search', placeholder: 'Buscar tarefa', value: f.q,
      onchange: e => { f.q = e.target.value; rerender(); } }),
    h('span', { class: 'grow', style: 'flex:1' }),
    extra);
}

async function viewBoard() {
  document.title = 'Quadro';
  const f = state.filters;
  const qs = new URLSearchParams(Object.entries({ client_id: f.client_id, assignee: f.assignee, q: f.q }).filter(([, v]) => v));
  const tasks = await api('GET', '/api/tasks?' + qs);
  const board = h('div', { class: 'board' });
  for (const s of state.stages) {
    const list = tasks.filter(t => t.stage_id === s.id);
    const col = h('section', { class: 'col', 'aria-label': s.name, 'data-stage': s.id },
      h('div', { class: 'col-head' }, h('span', {}, s.name), h('span', { class: 'count' }, list.length)),
      list.length ? list.map(t => taskCard(t, { draggable: true })) : h('p', { class: 'empty' }, 'Nada aqui'));
    wireDrop(col, s, tasks);
    board.append(col);
  }
  board.addEventListener('dragstart', e => {
    const card = e.target.closest('.task');
    if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  board.addEventListener('dragend', e => e.target.closest('.task')?.classList.remove('dragging'));
  shell([
    filterToolbar(h('button', { class: 'btn primary', onclick: () => newTaskModal() }, '+ Nova tarefa')),
    state.clients.length ? board : h('div', { class: 'card-box empty' }, 'Cadastre um cliente em ', h('a', { href: '#/clientes' }, 'Clientes'), ' para criar a primeira tarefa.'),
  ]);
}

function wireDrop(col, stage, tasks) {
  col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
  col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
  col.addEventListener('drop', guard(async e => {
    e.preventDefault();
    col.classList.remove('over');
    const taskId = Number(e.dataTransfer.getData('text/plain'));
    const inCol = tasks.filter(t => t.stage_id === stage.id && t.id !== taskId);
    const target = e.target.closest('.task');
    let position;
    if (target && Number(target.dataset.id) !== taskId) {
      const i = inCol.findIndex(t => t.id === Number(target.dataset.id));
      const prev = inCol[i - 1];
      position = prev ? (prev.position + inCol[i].position) / 2 : inCol[i].position - 1;
    } else {
      position = inCol.length ? inCol[inCol.length - 1].position + 1 : 1;
    }
    await api('PATCH', `/api/tasks/${taskId}`, { stage_id: stage.id, position });
    route();
  }));
}

async function viewMine() {
  document.title = 'Minhas tarefas';
  const tasks = (await api('GET', '/api/tasks?mine=1')).filter(t => t.stage_kind !== 'done');
  tasks.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  const groups = [
    ['Atrasadas', tasks.filter(t => t.due_date && t.due_date < today())],
    ['Hoje', tasks.filter(t => t.due_date === today())],
    ['Próximas', tasks.filter(t => t.due_date && t.due_date > today())],
    ['Sem prazo', tasks.filter(t => !t.due_date)],
  ];
  shell([
    h('div', { class: 'toolbar' }, h('h1', {}, 'Minhas tarefas'), h('span', { style: 'flex:1' }),
      h('button', { class: 'btn primary', onclick: () => newTaskModal() }, '+ Nova tarefa')),
    tasks.length ? groups.filter(([, l]) => l.length).map(([name, list]) =>
      h('div', { class: 'card-box' }, h('h2', {}, `${name} (${list.length})`),
        h('div', { style: 'display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))' },
          list.map(t => { const c = taskCard(t); c.querySelector('.meta').prepend(h('span', { class: 'tag' }, stageName(t.stage_id))); return c; }))))
      : h('div', { class: 'card-box empty' }, 'Nenhuma tarefa aberta com você. Bom sinal.'),
  ]);
}
const stageName = id => (state.stages.find(s => s.id === id) || {}).name || '';

// ---------- nova tarefa ----------
function modal(content, { onclose } = {}) {
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); onclose && onclose(); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const overlay = h('div', { class: 'overlay center', onclick: e => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content(close)));
  document.addEventListener('keydown', esc);
  document.body.append(overlay);
  overlay.querySelector('input, select, textarea, button')?.focus();
  return close;
}

function assigneeChecks(selected = []) {
  return h('div', { class: 'checks', role: 'group', 'aria-label': 'Responsáveis' },
    state.users.filter(u => u.role !== 'client' && u.active).map(u =>
      h('label', {}, h('input', { type: 'checkbox', name: 'assignee', value: u.id, checked: selected.includes(u.id) }), u.name)));
}

function newTaskModal() {
  if (!state.clients.length) { location.hash = '#/clientes'; toast('Cadastre um cliente primeiro'); return; }
  modal(close => {
    const err = h('p', { class: 'error', role: 'alert' });
    return h('form', { onsubmit: async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const { id } = await api('POST', '/api/tasks', {
          client_id: Number(fd.get('client_id')),
          template_id: fd.get('template_id') ? Number(fd.get('template_id')) : undefined,
          title: fd.get('title'), description: fd.get('description'),
          due_date: fd.get('due_date') || null, priority: fd.get('priority'),
          assignee_ids: fd.getAll('assignee').map(Number),
        });
        close(); toast('Tarefa criada'); route(); openTask(id);
      } catch (ex) { err.textContent = ex.message; }
    } },
      h('h2', {}, 'Nova tarefa'),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'n-client' }, 'Cliente'),
          h('select', { id: 'n-client', name: 'client_id', required: true },
            state.clients.map(c => h('option', { value: c.id, selected: String(c.id) === state.filters.client_id }, c.name)))),
        h('div', { class: 'field' }, h('label', { for: 'n-tpl' }, 'Modelo (opcional)'),
          h('select', { id: 'n-tpl', name: 'template_id' }, h('option', { value: '' }, 'Nenhum'),
            state.templates.map(t => h('option', { value: t.id }, t.name))))),
      h('div', { class: 'field' }, h('label', { for: 'n-title' }, 'Título'),
        h('input', { id: 'n-title', name: 'title', maxlength: 200, placeholder: 'Se vazio, usa o título do modelo' })),
      h('div', { class: 'field' }, h('label', { for: 'n-desc' }, 'Descrição'), h('textarea', { id: 'n-desc', name: 'description' })),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'n-due' }, 'Prazo'), h('input', { id: 'n-due', name: 'due_date', type: 'date' })),
        h('div', { class: 'field' }, h('label', { for: 'n-pri' }, 'Prioridade'),
          h('select', { id: 'n-pri', name: 'priority' }, Object.entries(PRIORITY).map(([v, l]) => h('option', { value: v, selected: v === 'normal' }, l))))),
      h('div', { class: 'field' }, h('label', {}, 'Responsáveis'), assigneeChecks()),
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Criar tarefa'),
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar')));
  });
}

// Confirmações dentro da página (algumas telas onde o app roda não mostram confirm() nem prompt()).
function ask(message, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise(resolve => {
    modal(close => h('div', {},
      h('p', { class: 'confirm-text' }, message),
      h('div', { class: 'row' },
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onclick: () => { resolve(true); close(); } }, ok),
        h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancelar'))),
    { onclose: () => resolve(false) });
  });
}
function askText(label, value = '') {
  return new Promise(resolve => {
    modal(close => {
      const input = h('input', { id: 'ask-text', value, maxlength: 120, required: true });
      return h('form', { onsubmit: e => { e.preventDefault(); resolve(input.value.trim() || null); close(); } },
        h('div', { class: 'field' }, h('label', { for: 'ask-text' }, label), input),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'submit' }, 'Salvar'),
          h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancelar')));
    }, { onclose: () => resolve(null) });
  });
}
window.askConfirm = ask;

// ---------- detalhe da tarefa ----------
let drawerClose = null;
async function openTask(id) {
  const t = await api('GET', `/api/tasks/${id}`).catch(e => { toast(e.message); return null; });
  if (!t) return;
  if (drawerClose) drawerClose(false);
  let dirty = false;
  const overlay = h('div', { class: 'overlay', onclick: e => { if (e.target === overlay) close(); } });
  const esc = e => { if (e.key === 'Escape') close(); };
  function close(refresh = true) {
    overlay.remove(); document.removeEventListener('keydown', esc); drawerClose = null;
    if (refresh && dirty) route();
  }
  drawerClose = close;
  document.addEventListener('keydown', esc);
  const drawer = h('div', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': t.title });
  overlay.append(drawer);
  document.body.append(overlay);

  const save = guard(async patch => { const nt = await api('PATCH', `/api/tasks/${t.id}`, patch); dirty = true; Object.assign(t, nt); paint(); });
  const act = guard(async (method, path, body) => { const nt = await api(method, path, body); dirty = true; Object.assign(t, nt); paint(); });

  function paint() {
    const staff = isStaff();
    const openAdj = t.adjustments.filter(a => !a.resolved_at);
    drawer.replaceChildren(...[
      h('div', { class: 'drawer-head' },
        staff ? h('input', { 'aria-label': 'Título', value: t.title, maxlength: 200, onchange: e => save({ title: e.target.value }) })
          : h('h1', { style: 'flex:1' }, t.title),
        h('button', { class: 'btn ghost', 'aria-label': 'Fechar', onclick: () => close() }, '✕')),
      h('p', { class: 'muted' }, `${t.client_name} · ${stageName(t.stage_id)}` + (t.completed_at ? ` · concluída em ${fmtDateTime(t.completed_at)}` : '')),

      !staff && t.stage_kind === 'client' ? clientDecision() : null,

      staff ? h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'd-stage' }, 'Etapa'),
          h('select', { id: 'd-stage', onchange: e => save({ stage_id: Number(e.target.value) }) },
            state.stages.map(s => h('option', { value: s.id, selected: s.id === t.stage_id }, s.name)))),
        h('div', { class: 'field' }, h('label', { for: 'd-due' }, 'Prazo'),
          h('input', { id: 'd-due', type: 'date', value: t.due_date || '', onchange: e => save({ due_date: e.target.value || null }) })),
        h('div', { class: 'field' }, h('label', { for: 'd-pri' }, 'Prioridade'),
          h('select', { id: 'd-pri', onchange: e => save({ priority: e.target.value }) },
            Object.entries(PRIORITY).map(([v, l]) => h('option', { value: v, selected: v === t.priority }, l)))),
        h('div', { class: 'field' }, h('label', { for: 'd-client' }, 'Cliente'),
          h('select', { id: 'd-client', onchange: e => save({ client_id: Number(e.target.value) }) },
            state.clients.map(c => h('option', { value: c.id, selected: c.id === t.client_id }, c.name)))))
        : h('p', {}, t.due_date ? `Prazo: ${fmtDate(t.due_date)}` : 'Sem prazo definido'),

      staff ? h('div', { class: 'field' }, h('label', {}, 'Responsáveis'),
        (() => { const g = assigneeChecks(t.assignees.map(a => a.id));
          g.addEventListener('change', () => save({ assignee_ids: [...g.querySelectorAll('input:checked')].map(i => Number(i.value)) }));
          return g; })())
        : (t.assignees.length ? h('p', { class: 'muted' }, 'Responsáveis: ' + t.assignees.map(a => a.name).join(', ')) : null),

      staff ? h('div', { class: 'field' }, h('label', { for: 'd-desc' }, 'Descrição'),
        h('textarea', { id: 'd-desc', rows: 4, onchange: e => save({ description: e.target.value }) }, t.description))
        : (t.description ? h('p', { style: 'white-space:pre-wrap' }, t.description) : null),

      checklistSection(staff),
      adjustmentsSection(staff, openAdj),
      commentsSection(staff),

      isAdmin() ? h('div', { class: 'section' }, h('button', { class: 'btn danger', onclick: guard(async () => {
        if (!(await ask('Apagar esta tarefa? Isso não pode ser desfeito.', { ok: 'Apagar tarefa', danger: true }))) return;
        await api('DELETE', `/api/tasks/${t.id}`); dirty = true; close(); toast('Tarefa apagada');
      }) }, 'Apagar tarefa')) : null,
    ].filter(Boolean));
  }

  function clientDecision() {
    const ta = h('textarea', { id: 'c-adj', placeholder: 'O que precisa mudar?' });
    return h('div', { class: 'card-box', style: 'border-color:var(--accent)' },
      h('h2', {}, 'Esta entrega está esperando você'),
      h('p', { class: 'muted' }, 'Aprove, ou diga o que ajustar e a equipe recebe na hora.'),
      h('div', { class: 'row', style: 'margin-bottom:12px' },
        h('button', { class: 'btn primary', onclick: () => act('POST', `/api/tasks/${t.id}/approve`) }, 'Aprovar entrega')),
      h('label', { for: 'c-adj' }, 'Pedir ajuste'), ta,
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn', onclick: () => { if (!ta.value.trim()) { ta.focus(); return; } act('POST', `/api/tasks/${t.id}/adjustments`, { body: ta.value }); } }, 'Enviar pedido de ajuste')));
  }

  function checklistSection(staff) {
    if (!staff && !t.checklist.length) return null;
    const done = t.checklist.filter(i => i.done).length;
    const input = h('input', { 'aria-label': 'Novo item', placeholder: 'Adicionar item', maxlength: 300 });
    return h('div', { class: 'section' },
      h('h2', {}, `Checklist ${t.checklist.length ? `(${done}/${t.checklist.length})` : ''}`),
      t.checklist.length ? h('div', { class: 'bar', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.round(done / t.checklist.length * 100)}%` })) : null,
      t.checklist.map(i => h('div', { class: 'check' },
        h('input', { type: 'checkbox', id: `ck-${i.id}`, checked: !!i.done, disabled: !staff, onchange: e => act('PATCH', `/api/checklist/${i.id}`, { done: e.target.checked }) }),
        h('label', { for: `ck-${i.id}`, class: i.done ? 'done' : '', style: 'font-weight:400;margin:0;flex:1' }, i.text),
        staff ? h('button', { class: 'btn ghost small', 'aria-label': `Remover ${i.text}`, onclick: () => act('DELETE', `/api/checklist/${i.id}`) }, '✕') : null)),
      staff ? h('form', { class: 'row', style: 'margin-top:8px', onsubmit: e => { e.preventDefault(); if (input.value.trim()) act('POST', `/api/tasks/${t.id}/checklist`, { text: input.value }); } },
        h('div', { class: 'grow' }, input), h('button', { class: 'btn', type: 'submit' }, 'Adicionar')) : null);
  }

  function adjustmentsSection(staff, openAdj) {
    if (!staff && !t.adjustments.length) return null;
    const internal = t.adjustments.filter(a => a.origin === 'internal').length;
    const client = t.adjustments.filter(a => a.origin === 'client').length;
    const ta = h('textarea', { 'aria-label': 'Descreva o ajuste interno', placeholder: 'O que a revisão interna pediu?' });
    return h('div', { class: 'section' },
      h('h2', {}, 'Ajustes'),
      staff ? h('p', { class: 'meta' }, h('span', { class: 'tag' }, `${internal} interno${internal === 1 ? '' : 's'}`),
        h('span', { class: 'tag adj' }, `${client} do cliente`), openAdj.length ? h('span', { class: 'tag late' }, `${openAdj.length} em aberto`) : h('span', { class: 'tag ok' }, 'nenhum em aberto')) : null,
      t.adjustments.length ? t.adjustments.map(a => h('div', { class: 'adj-item' + (a.resolved_at ? '' : ' open') },
        h('div', { class: 'meta' }, h('strong', {}, a.origin === 'client' ? 'Pedido do cliente' : 'Interno'), `· ${a.author || ''} · ${fmtDateTime(a.created_at)}`,
          a.resolved_at ? h('span', { class: 'tag ok' }, 'resolvido') : null),
        h('div', { class: 'comment' }, h('div', { class: 'body' }, a.body)),
        staff && !a.resolved_at ? h('button', { class: 'btn small', onclick: () => act('POST', `/api/adjustments/${a.id}/resolve`) }, 'Marcar como resolvido') : null))
        : h('p', { class: 'muted' }, 'Nenhum ajuste até agora.'),
      staff ? h('details', {}, h('summary', {}, 'Registrar ajuste interno'),
        h('div', { style: 'margin-top:8px' }, ta,
          h('button', { class: 'btn', style: 'margin-top:8px', onclick: () => { if (!ta.value.trim()) { ta.focus(); return; } act('POST', `/api/tasks/${t.id}/adjustments`, { body: ta.value }); } }, 'Registrar e mover para "Em ajuste"'))) : null);
  }

  function commentsSection(staff) {
    const ta = h('textarea', { id: 'cm-body', placeholder: staff ? 'Escreva um comentário' : 'Escreva para a equipe' });
    const vis = h('input', { type: 'checkbox', id: 'cm-vis' });
    return h('div', { class: 'section' },
      h('h2', {}, 'Comentários'),
      t.comments.length ? t.comments.map(c => h('div', { class: 'comment' },
        h('div', { class: 'meta' }, h('span', { class: 'by' }, c.author || 'Usuário removido'), fmtDateTime(c.created_at),
          staff ? h('span', { class: 'tag' + (c.visible_to_client ? ' ok' : '') }, c.visible_to_client ? 'cliente vê' : 'só equipe') : null),
        h('div', { class: 'body' }, c.body))) : h('p', { class: 'muted' }, 'Sem comentários.'),
      h('form', { style: 'margin-top:8px', onsubmit: e => {
        e.preventDefault(); if (!ta.value.trim()) return;
        act('POST', `/api/tasks/${t.id}/comments`, { body: ta.value, visible_to_client: vis.checked });
      } },
        h('label', { for: 'cm-body', class: 'sr-only' }, 'Comentário'), ta,
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { class: 'btn', type: 'submit' }, 'Comentar'),
          staff ? h('label', { for: 'cm-vis', class: 'check', style: 'font-weight:400;margin:0' }, vis, 'Visível para o cliente') : null)));
  }

  paint();
  drawer.querySelector('input, button')?.focus();
}

// ---------- portal do cliente ----------
async function viewPortal() {
  document.title = 'Minhas entregas';
  const tasks = await api('GET', '/api/tasks');
  const waiting = tasks.filter(t => t.stage_kind === 'client');
  const doing = tasks.filter(t => !['client', 'done'].includes(t.stage_kind));
  const done = tasks.filter(t => t.stage_kind === 'done').sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
  const item = (t, cls = '') => h('div', { class: 'portal-task ' + cls },
    h('div', { class: 'row' }, h('strong', { class: 'grow' }, t.title),
      h('button', { class: cls ? 'btn primary' : 'btn', onclick: () => openTask(t.id) }, cls ? 'Revisar' : 'Ver')),
    h('div', { class: 'meta', style: 'margin-top:6px' }, h('span', { class: 'tag' }, stageLabelForClient(t)),
      t.due_date ? h('span', {}, `Prazo ${fmtDate(t.due_date)}`) : null,
      t.completed_at ? h('span', {}, `Concluída ${fmtDateTime(t.completed_at)}`) : null));
  shell([
    h('h1', { style: 'margin-bottom:16px' }, 'Minhas entregas'),
    h('section', { class: 'portal-section' }, h('h2', {}, `Esperando sua aprovação (${waiting.length})`),
      waiting.length ? waiting.map(t => item(t, 'waiting')) : h('p', { class: 'muted' }, 'Nada esperando você agora.')),
    h('section', { class: 'portal-section' }, h('h2', {}, `Em andamento (${doing.length})`),
      doing.length ? doing.map(t => item(t)) : h('p', { class: 'muted' }, 'Nenhuma tarefa em andamento.')),
    h('section', { class: 'portal-section' }, h('h2', {}, `Concluídas (${done.length})`),
      done.length ? done.slice(0, 20).map(t => item(t)) : h('p', { class: 'muted' }, 'Ainda nenhuma.')),
  ]);
}
function stageLabelForClient(t) {
  return { todo: 'Na fila', doing: 'Em andamento', review: 'Em andamento', adjust: 'Em ajuste', client: 'Com você', done: 'Concluída' }[t.stage_kind];
}

// ---------- clientes ----------
async function viewClients() {
  document.title = 'Clientes';
  state.clients = await api('GET', '/api/clients');
  const err = h('p', { class: 'error', role: 'alert' });
  shell([
    h('h1', { style: 'margin-bottom:16px' }, 'Clientes'),
    isAdmin() ? h('form', { class: 'card-box row', onsubmit: guard(async e => {
      e.preventDefault();
      const input = e.target.elements.name;
      await api('POST', '/api/clients', { name: input.value }); toast('Cliente cadastrado'); route();
    }) }, h('div', { class: 'grow' }, h('label', { for: 'cl-name', class: 'sr-only' }, 'Nome do cliente'),
      h('input', { id: 'cl-name', name: 'name', placeholder: 'Nome do novo cliente', required: true, maxlength: 120 })),
      h('button', { class: 'btn primary', type: 'submit' }, 'Cadastrar'), err) : null,
    h('div', { class: 'card-box table-wrap' }, state.clients.length ? h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Cliente'), h('th', {}, 'Tarefas abertas'), h('th', {}, ''))),
      h('tbody', {}, state.clients.map(c => h('tr', {},
        h('td', {}, c.name), h('td', {}, c.open_tasks),
        h('td', { style: 'text-align:right' },
          h('button', { class: 'btn small', onclick: () => { state.filters.client_id = String(c.id); location.hash = '#/quadro'; } }, 'Ver quadro'), ' ',
          isAdmin() ? h('button', { class: 'btn small', onclick: guard(async () => {
            const name = await askText('Novo nome do cliente', c.name);
            if (name && name.trim()) { await api('PATCH', `/api/clients/${c.id}`, { name }); route(); }
          }) }, 'Renomear') : null)))))
      : h('p', { class: 'empty' }, 'Nenhum cliente ainda.')),
  ]);
}

// ---------- pessoas ----------
async function viewTeam() {
  document.title = 'Pessoas';
  state.users = await api('GET', '/api/users');
  const err = h('p', { class: 'error', role: 'alert' });
  const roleSel = h('select', { id: 'u-role', name: 'role', onchange: () => { clientField.hidden = roleSel.value !== 'client'; } },
    Object.entries(ROLE).map(([v, l]) => h('option', { value: v, selected: v === 'member' }, l)));
  const clientField = h('div', { class: 'field', hidden: true }, h('label', { for: 'u-client' }, 'Cliente'),
    h('select', { id: 'u-client', name: 'client_id' }, state.clients.map(c => h('option', { value: c.id }, c.name))));
  const form = isAdmin() ? h('form', { class: 'card-box', onsubmit: async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('POST', '/api/users', { name: fd.get('name'), email: fd.get('email'), password: fd.get('password'), role: fd.get('role'),
        client_id: fd.get('role') === 'client' ? Number(fd.get('client_id')) : undefined });
      toast('Acesso criado. Envie o email e a senha para a pessoa.'); route();
    } catch (ex) { err.textContent = ex.message; }
  } },
    h('h2', {}, 'Dar acesso a alguém'),
    h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('label', { for: 'u-name' }, 'Nome'), h('input', { id: 'u-name', name: 'name', required: true, maxlength: 120 })),
      h('div', { class: 'field' }, h('label', { for: 'u-email' }, 'Email'), h('input', { id: 'u-email', name: 'email', type: 'email', required: true })),
      h('div', { class: 'field' }, h('label', { for: 'u-pass' }, 'Senha inicial (mín. 8)'), h('input', { id: 'u-pass', name: 'password', type: 'text', minlength: 8, required: true, autocomplete: 'new-password' })),
      h('div', { class: 'field' }, h('label', { for: 'u-role' }, 'Papel'), roleSel)),
    clientField,
    h('p', { class: 'muted' }, 'Equipe vê todos os clientes. Cliente vê só as próprias tarefas e só os comentários marcados como visíveis.'),
    err, h('button', { class: 'btn primary', type: 'submit' }, 'Criar acesso')) : null;
  shell([
    h('h1', { style: 'margin-bottom:16px' }, 'Pessoas'),
    form,
    h('div', { class: 'card-box table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Nome'), h('th', {}, 'Email'), h('th', {}, 'Papel'), h('th', {}, 'Situação'), h('th', {}, ''))),
      h('tbody', {}, state.users.map(u => h('tr', {},
        h('td', {}, u.name), h('td', {}, u.email), h('td', {}, ROLE[u.role] + (u.client_name ? ` · ${u.client_name}` : '')),
        h('td', {}, u.active ? 'Ativo' : 'Desativado'),
        h('td', { style: 'text-align:right' }, isAdmin() && u.id !== state.me.id ? h('button', { class: 'btn small', onclick: guard(async () => {
          await api('PATCH', `/api/users/${u.id}`, { active: !u.active }); route();
        }) }, u.active ? 'Desativar' : 'Reativar') : null)))))),
  ]);
}

// ---------- modelos ----------
async function viewTemplates() {
  document.title = 'Modelos';
  state.templates = await api('GET', '/api/templates');
  const err = h('p', { class: 'error', role: 'alert' });
  shell([
    h('h1', { style: 'margin-bottom:16px' }, 'Modelos de tarefa'),
    h('form', { class: 'card-box', onsubmit: async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('POST', '/api/templates', { name: fd.get('name'), title: fd.get('title'), description: fd.get('description'),
          checklist: String(fd.get('checklist')).split('\n').map(s => s.trim()).filter(Boolean) });
        toast('Modelo salvo'); route();
      } catch (ex) { err.textContent = ex.message; }
    } },
      h('h2', {}, 'Novo modelo'),
      h('p', { class: 'muted' }, 'Para o trabalho que se repete: fechamento do mês, diagnóstico, onboarding de cliente.'),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 't-name' }, 'Nome do modelo'), h('input', { id: 't-name', name: 'name', required: true, maxlength: 120 })),
        h('div', { class: 'field' }, h('label', { for: 't-title' }, 'Título da tarefa'), h('input', { id: 't-title', name: 'title', required: true, maxlength: 200 }))),
      h('div', { class: 'field' }, h('label', { for: 't-desc' }, 'Descrição'), h('textarea', { id: 't-desc', name: 'description' })),
      h('div', { class: 'field' }, h('label', { for: 't-check' }, 'Checklist (um item por linha)'), h('textarea', { id: 't-check', name: 'checklist', rows: 5 })),
      err, h('button', { class: 'btn primary', type: 'submit' }, 'Salvar modelo')),
    state.templates.length ? state.templates.map(t => h('div', { class: 'card-box' },
      h('div', { class: 'row' }, h('h2', { class: 'grow', style: 'margin:0' }, t.name),
        h('button', { class: 'btn small danger', onclick: guard(async () => { if (await ask(`Apagar o modelo "${t.name}"?`, { ok: 'Apagar modelo', danger: true })) { await api('DELETE', `/api/templates/${t.id}`); route(); } }) }, 'Apagar')),
      h('p', { class: 'muted' }, `Cria: "${t.title}"` + (t.checklist.length ? ` com ${t.checklist.length} itens` : '')),
      t.checklist.length ? h('ul', {}, t.checklist.map(i => h('li', {}, i))) : null))
      : h('div', { class: 'card-box empty' }, 'Nenhum modelo ainda.'),
  ]);
}

// ---------- relatório ----------
async function viewReport() {
  document.title = 'Ajustes por cliente';
  const rows = await api('GET', '/api/report/adjustments');
  shell([
    h('h1', {}, 'Ajustes por cliente'),
    h('p', { class: 'muted' }, 'Quantas vezes o trabalho voltou. Ajuste do cliente custa mais caro que o interno: mostra o que passou pela revisão.'),
    h('div', { class: 'card-box table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Cliente'), h('th', {}, 'Tarefas'), h('th', {}, 'Ajustes internos'), h('th', {}, 'Ajustes do cliente'), h('th', {}, 'Por tarefa'))),
      h('tbody', {}, rows.map(r => h('tr', {},
        h('td', {}, r.name), h('td', {}, r.tasks), h('td', {}, r.internal || 0), h('td', {}, r.client || 0),
        h('td', {}, r.tasks ? (((r.internal || 0) + (r.client || 0)) / r.tasks).toFixed(1).replace('.', ',') : '–')))))),
  ]);
}

// ---------- configurações ----------
async function viewSettings() {
  document.title = 'Configurações';
  const msg = h('p', { role: 'status' });
  const pwErr = h('p', { class: 'error', role: 'alert' });
  shell([
    h('h1', { style: 'margin-bottom:16px' }, isStaff() ? 'Configurações' : 'Minha conta'),
    isAdmin() ? h('form', { class: 'card-box', onsubmit: async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('PATCH', '/api/org', { name: fd.get('name'), accent: fd.get('accent') });
        await loadCommon(); toast('Salvo'); route();
      } catch (ex) { msg.textContent = ex.message; }
    } },
      h('h2', {}, 'Sua marca'),
      h('p', { class: 'muted' }, 'O nome e a cor aparecem para a equipe e para os clientes.'),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'o-name' }, 'Nome'), h('input', { id: 'o-name', name: 'name', value: state.org.name, required: true, maxlength: 80 })),
        h('div', { class: 'field' }, h('label', { for: 'o-accent' }, 'Cor principal'), h('input', { id: 'o-accent', name: 'accent', type: 'color', value: state.org.accent }))),
      msg, h('button', { class: 'btn primary', type: 'submit' }, 'Salvar')) : null,
    h('form', { class: 'card-box', onsubmit: async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await api('POST', '/api/me/password', { current: fd.get('current'), password: fd.get('password') });
        e.target.reset(); pwErr.textContent = ''; toast('Senha alterada');
      } catch (ex) { pwErr.textContent = ex.message; }
    } },
      h('h2', {}, 'Trocar senha'),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'p-cur' }, 'Senha atual'), h('input', { id: 'p-cur', name: 'current', type: 'password', required: true, autocomplete: 'current-password' })),
        h('div', { class: 'field' }, h('label', { for: 'p-new' }, 'Nova senha (mín. 8)'), h('input', { id: 'p-new', name: 'password', type: 'password', minlength: 8, required: true, autocomplete: 'new-password' }))),
      pwErr, h('button', { class: 'btn', type: 'submit' }, 'Trocar senha')),
  ]);
}

boot();
