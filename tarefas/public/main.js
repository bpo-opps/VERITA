'use strict';
/* global Shared */
const S = window.Shared;

// ---------- utilidades ----------
const state = {
  me: null, org: null, clients: [], users: [], templates: [], alertCount: 0,
  view: { layout: 'kanban', kind: '', client: '', assignee: '', due: '', q: '', group: 'column', archived: false, month: '' },
};
const VIEW_KEY = 'tarefas-visao';
try { Object.assign(state.view, JSON.parse(localStorage.getItem(VIEW_KEY)) || {}, { q: '', archived: false }); } catch { /* sem armazenamento */ }
const saveView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(state.view)); } catch { /* idem */ } };

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
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}
const guard = fn => async (...args) => { try { await fn(...args); } catch (e) { toast(e.message); } };

const today = () => S.today();
function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}
const fmtShort = d => (d ? fmtDate(d).slice(0, 5) : '');
function fmtDateTime(s) {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
const PRIORITY = { low: 'Baixa', normal: 'Normal', high: 'Alta' };
const isStaff = () => state.me && state.me.role !== 'client';
const isAdmin = () => state.me && state.me.role === 'admin';
const orgShort = () => state.org.name.split(/\s+/)[0];
const roleLabel = r => ({ admin: 'Administrador', member: `Equipe ${orgShort()}`, client: 'Cliente' }[r]);
const colName = key => S.COLUMNS.find(c => c.key === key).name;
const clientById = cid => state.clients.find(c => c.id === cid);
const where = t => (t.client_id ? t.client_name : state.org.name);

// Cor da marca: escolhe texto branco ou preto sobre ela pelo contraste.
function applyAccent(hex) {
  const lum = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const L = 0.2126 * lum(r) + 0.7152 * lum(g) + 0.0722 * lum(b);
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--on-accent', (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#000000' : '#ffffff');
}

// Logo da empresa no card: o do cliente, ou o da consultoria nas internas sem cliente.
function logoEl(name, src, size = 'sm') {
  return src
    ? h('img', { class: `logo ${size}`, src, alt: '', title: name })
    : h('span', { class: `logo ${size} fallback`, title: name, 'aria-hidden': 'true' }, initials(name || '?'));
}
const taskLogo = (t, size) => (t.client_id ? logoEl(t.client_name, (clientById(t.client_id) || {}).logo, size) : logoEl(state.org.name, state.org.logo, size));

// Redimensiona a imagem escolhida para 128px e devolve PNG em data URL.
function readLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) { reject(new Error('Escolha um arquivo de imagem')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não consegui ler a imagem'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Não consegui abrir a imagem'));
      img.onload = () => {
        const size = 128;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const scale = Math.min(size / img.width, size / img.height);
        const w = img.width * scale, hgt = img.height * scale;
        c.getContext('2d').drawImage(img, (size - w) / 2, (size - hgt) / 2, w, hgt);
        resolve(c.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function logoPicker(label, onPick) {
  const input = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', 'aria-label': label,
    onchange: guard(async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await onPick(await readLogo(f)); }) });
  return h('label', { class: 'btn small file-btn' }, input, label);
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

function shell(content) {
  const nav = isStaff()
    ? [['#/tarefas', 'Tarefas'], ['#/alertas', 'Alertas'], ['#/clientes', 'Clientes'], ['#/modelos', 'Modelos'],
      ['#/relatorio', 'Relatório'], ['#/equipe', 'Pessoas'], ['#/config', 'Configurações']]
    : [['#/portal', 'Minhas entregas'], ['#/alertas', 'Alertas'], ['#/config', 'Minha conta']];
  const current = location.hash.split('?')[0] || nav[0][0];
  app().replaceChildren(
    h('header', { class: 'top' },
      h('div', { class: 'brand' }, logoEl(state.org.name, state.org.logo), state.org.name),
      h('nav', { class: 'main', 'aria-label': 'Principal' },
        nav.map(([href, label]) => h('a', { href, 'aria-current': current === href ? 'page' : null }, label,
          href === '#/alertas' && state.alertCount ? h('span', { class: 'badge', 'aria-label': `${state.alertCount} alertas` }, state.alertCount) : null))),
      h('div', { class: 'who' }, `${state.me.name} · ${roleLabel(state.me.role)}`,
        h('button', { class: 'btn small', onclick: guard(async () => { await api('POST', '/api/logout'); state.me = null; renderLogin(); }) }, 'Sair'))),
    h('main', {}, content));
}

async function loadCommon() {
  const me = await api('GET', '/api/me');
  state.me = me.user; state.org = me.org;
  applyAccent(me.org.accent);
  state.clients = await api('GET', '/api/clients');
  if (isStaff()) [state.users, state.templates] = await Promise.all([api('GET', '/api/users'), api('GET', '/api/templates')]);
  await refreshAlerts();
}
async function refreshAlerts() { state.alertCount = (await api('GET', '/api/alerts')).length; }

async function boot() {
  try { await loadCommon(); } catch { renderLogin(); return; }
  route();
}

const ROUTES = {
  '#/tarefas': viewTasks, '#/alertas': viewAlerts, '#/clientes': viewClients, '#/modelos': viewTemplates,
  '#/relatorio': viewReport, '#/equipe': viewTeam, '#/config': viewSettings, '#/portal': viewPortal,
};

async function route() {
  if (!state.me) return;
  const key = location.hash.split('?')[0];
  const fallback = isStaff() ? '#/tarefas' : '#/portal';
  const clientPages = ['#/portal', '#/alertas', '#/config'];
  const view = ROUTES[key];
  if (!view || (isStaff() && key === '#/portal') || (!isStaff() && !clientPages.includes(key))) { location.hash = fallback; return; }
  try { await refreshAlerts(); } catch { /* segue sem o contador */ }
  guard(view)();
}
window.addEventListener('hashchange', route);

// ---------- pedaços dos cards ----------
function progressBar(p, label = true) {
  return h('div', { class: 'progress', title: `${p}% executado` },
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': p, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Execução' },
      h('span', { style: `width:${p}%` })),
    label ? h('span', { class: 'pct' }, `${p}%`) : null);
}
function dateRange(t) {
  if (t.status === 'cancelled') return `Cancelada ${fmtShort(t.cancelled_on)}`;
  if (t.status === 'done') return `Término ${fmtShort(t.completed_on)}` + (t.due_date ? ` · prazo ${fmtShort(t.due_date)}` : '');
  if (t.start_date && t.due_date) return `Iniciada ${fmtShort(t.start_date)} · prazo ${fmtShort(t.due_date)}`;
  if (t.due_date) return `Prazo ${fmtShort(t.due_date)}`;
  if (t.start_date) return `Iniciada ${fmtShort(t.start_date)}`;
  return null;
}
// No card, cada data numa etiqueta curta: início (quando começou), prazo, término ou cancelamento.
function dateTags(t) {
  if (t.status === 'cancelled') return h('span', { class: 'tag' }, `Cancelada ${fmtShort(t.cancelled_on)}`);
  if (t.status === 'done') return [h('span', { class: 'tag' }, `Término ${fmtShort(t.completed_on)}`), t.due_date ? h('span', { class: 'tag' }, `Prazo ${fmtShort(t.due_date)}`) : null];
  return [t.start_date ? h('span', { class: 'tag' }, `Início ${fmtShort(t.start_date)}`) : null,
    t.due_date ? h('span', { class: 'tag' + (t.column === 'overdue' ? ' late' : '') }, `Prazo ${fmtShort(t.due_date)}`) : null];
}
const internalTag = t => (t.kind === 'internal' ? h('span', { class: 'tag internal' }, t.client_visible ? 'Interna · cliente vê' : 'Interna') : null);
function taskCard(t, { draggable = false, showStatus = false } = {}) {
  return h('button', { class: `task col-${t.column}`, type: 'button', draggable: draggable ? 'true' : null, 'data-id': t.id, onclick: () => openTask(t.id) },
    h('div', { class: 'task-head' }, taskLogo(t),
      h('div', { class: 'task-who' }, h('span', { class: 'client' }, where(t)),
        internalTag(t))),
    h('div', { class: 'title' }, t.title),
    t.status === 'cancelled' ? h('p', { class: 'cancel-reason' }, 'Motivo: ' + t.cancel_reason) : null,
    (t.status === 'doing' || (t.progress > 0 && !['done', 'cancelled'].includes(t.status))) ? progressBar(t.progress) : null,
    h('div', { class: 'meta' },
      showStatus || t.column === 'overdue' ? h('span', { class: 'tag' }, S.STATUS_LABEL[t.status]) : null,
      dateTags(t),
      t.alert ? h('span', { class: 'tag ' + (t.alert.kind === 'overdue' ? 'late' : 'warn') }, '⏰ ' + S.alertText(t.alert)) : null,
      t.priority === 'high' ? h('span', { class: 'tag high' }, 'Alta') : null,
      t.recurrence !== 'none' ? h('span', { class: 'tag', title: 'Recorrente' }, '↻ ' + S.RECURRENCE[t.recurrence].replace(/ \(.*/, '')) : null,
      t.adjustments_open ? h('span', { class: 'tag adj' }, `${t.adjustments_open} ajuste${t.adjustments_open > 1 ? 's' : ''}`) : null,
      t.checklist_total ? h('span', {}, `☑ ${t.checklist_done}/${t.checklist_total}`) : null,
      t.archived_at ? h('span', { class: 'tag' }, 'Arquivada') : null,
      h('span', { class: 'avatars' }, t.assignees.map(a => h('span', { class: 'avatar', title: a.name }, initials(a.name))))));
}

// ---------- tarefas: filtros e visões ----------
function taskQuery() {
  const v = state.view;
  const q = { kind: v.kind, client_id: v.client, due: v.due, q: v.q, archived: v.archived ? '1' : '' };
  if (v.assignee === 'me') q.mine = '1'; else q.assignee = v.assignee;
  return new URLSearchParams(Object.entries(q).filter(([, x]) => x));
}

function select(id, label, value, options, onchange) {
  return [h('label', { class: 'sr-only', for: id }, label),
    h('select', { id, onchange: e => onchange(e.target.value) },
      options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)))];
}

function tasksToolbar() {
  const v = state.view;
  const set = (k, val) => { v[k] = val; saveView(); route(); };
  const layouts = [['kanban', 'Kanban'], ['list', 'Lista'], ['calendar', 'Calendário']];
  const staff = state.users.filter(u => u.role !== 'client' && u.active);
  return h('div', { class: 'toolbar' },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Visualização' },
      layouts.map(([k, l]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(v.layout === k), onclick: () => set('layout', k) }, l))),
    select('f-kind', 'Tipo', v.kind, [['', 'Internas e externas'], ['external', 'Externas'], ['internal', 'Internas']], x => set('kind', x)),
    select('f-client', 'Empresa', v.client, [['', 'Todas as empresas'], ['org', `${state.org.name} (própria)`], ...state.clients.map(c => [c.id, c.name])], x => set('client', x)),
    select('f-who', 'Responsável', v.assignee, [['', 'Todos os responsáveis'], ['me', 'Só as minhas'], ...staff.map(u => [u.id, u.name])], x => set('assignee', x)),
    select('f-due', 'Prazo', v.due, [['', 'Qualquer prazo'], ['overdue', 'Atrasadas'], ['today', 'Vencem hoje'], ['week', 'Próximos 7 dias'], ['month', 'Este mês'], ['none', 'Sem prazo']], x => set('due', x)),
    v.layout === 'list' ? select('f-group', 'Agrupar por', v.group, [['column', 'Agrupar por situação'], ['client', 'Agrupar por empresa'], ['assignee', 'Agrupar por responsável'], ['due', 'Agrupar por prazo'], ['kind', 'Agrupar por tipo']], x => set('group', x)) : null,
    h('label', { class: 'sr-only', for: 'f-q' }, 'Buscar'),
    h('input', { id: 'f-q', type: 'search', placeholder: 'Buscar tarefa', value: v.q, onchange: e => { v.q = e.target.value; route(); } }),
    h('label', { class: 'check inline', for: 'f-arch' }, h('input', { type: 'checkbox', id: 'f-arch', checked: v.archived, onchange: e => { v.archived = e.target.checked; route(); } }), 'Ver arquivadas'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn primary', onclick: () => newTaskModal() }, '+ Nova tarefa'));
}

async function viewTasks() {
  document.title = 'Tarefas';
  const tasks = await api('GET', '/api/tasks?' + taskQuery());
  const v = state.view;
  const body = v.layout === 'list' ? listView(tasks) : v.layout === 'calendar' ? calendarView(tasks) : kanbanView(tasks);
  shell([tasksToolbar(), v.archived ? h('p', { class: 'muted' }, 'Mostrando só as tarefas arquivadas.') : null, body]);
}

function kanbanView(tasks) {
  const board = h('div', { class: 'board' });
  for (const c of S.COLUMNS) {
    const list = tasks.filter(t => t.column === c.key);
    const col = h('section', { class: `col col-${c.key}`, 'aria-label': c.name, 'data-col': c.key },
      h('div', { class: 'col-head' }, h('span', {}, c.name), h('span', { class: 'count' }, list.length)),
      c.key === 'overdue' ? h('p', { class: 'col-note' }, 'Entra sozinha quando o prazo passa') : null,
      list.length ? list.map(t => taskCard(t, { draggable: !state.view.archived })) : h('p', { class: 'empty' }, 'Nada aqui'));
    wireDrop(col, c.key, tasks);
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
  return board;
}

function wireDrop(col, key, tasks) {
  col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('over'); });
  col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
  col.addEventListener('drop', guard(async e => {
    e.preventDefault();
    col.classList.remove('over');
    const taskId = Number(e.dataTransfer.getData('text/plain'));
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.column === key) return;
    if (key === 'overdue') { toast('A coluna Atrasada é automática: a tarefa entra nela quando o prazo passa.'); return; }
    if (key === 'done_on_time' || key === 'done_late') { completeDialog(task); return; }
    if (key === 'cancelled') { cancelDialog(task); return; }
    const inCol = tasks.filter(t => t.column === key && t.id !== taskId);
    const target = e.target.closest('.task');
    let position;
    if (target && Number(target.dataset.id) !== taskId) {
      const i = inCol.findIndex(t => t.id === Number(target.dataset.id));
      const prev = inCol[i - 1];
      position = prev ? (prev.position + inCol[i].position) / 2 : inCol[i].position - 1;
    } else position = inCol.length ? inCol[inCol.length - 1].position + 1 : 1;
    const nt = await api('PATCH', `/api/tasks/${taskId}`, { status: key, position });
    if (nt.column === 'overdue') toast(`Mudou para ${S.STATUS_LABEL[key]}, mas continua em Atrasada porque o prazo já passou.`);
    route();
  }));
}

function groupKey(t, group) {
  const now = today();
  if (group === 'column') return [S.COLUMNS.findIndex(c => c.key === t.column), colName(t.column)];
  if (group === 'client') return [t.client_id ? 1 : 0, where(t)];
  if (group === 'kind') return [t.kind === 'external' ? 0 : 1, t.kind === 'external' ? 'Externas' : 'Internas'];
  if (group === 'due') {
    if (t.status === 'cancelled') return [5, 'Canceladas'];
    if (t.status === 'done') return [4, 'Concluídas'];
    if (!t.due_date) return [6, 'Sem prazo'];
    if (t.due_date < now) return [0, 'Atrasadas'];
    if (t.due_date === now) return [1, 'Vencem hoje'];
    if (t.due_date <= S.addDays(now, 7)) return [2, 'Próximos 7 dias'];
    return [3, 'Mais adiante'];
  }
  return null;
}

function listView(tasks) {
  if (!tasks.length) return h('div', { class: 'card-box empty' }, 'Nenhuma tarefa com esses filtros.');
  const group = state.view.group;
  const groups = new Map();
  const add = (k, label, t) => { if (!groups.has(label)) groups.set(label, { k, label, items: [] }); groups.get(label).items.push(t); };
  for (const t of tasks) {
    if (group === 'assignee') {
      if (!t.assignees.length) add('~', 'Sem responsável', t);
      for (const a of t.assignees) add(a.name, a.name, t);
    } else { const [k, label] = groupKey(t, group); add(typeof k === 'number' ? String(k).padStart(3, '0') + label : k, label, t); }
  }
  const sorted = [...groups.values()].sort((a, b) => String(a.k).localeCompare(String(b.k)));
  return sorted.map(g => h('div', { class: 'card-box' },
    h('h2', {}, `${g.label} (${g.items.length})`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'tasks' },
      h('thead', {}, h('tr', {}, ['Tarefa', 'Empresa', 'Responsáveis', 'Início', 'Prazo', 'Situação', 'Execução'].map(x => h('th', {}, x)))),
      h('tbody', {}, g.items.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')).map(t => h('tr', { class: 'row-link', onclick: () => openTask(t.id) },
        h('td', {}, h('button', { class: 'link', type: 'button', onclick: e => { e.stopPropagation(); openTask(t.id); } }, t.title),
          t.alert ? h('div', { class: 'small ' + (t.alert.kind === 'overdue' ? 'danger' : 'warn') }, '⏰ ' + S.alertText(t.alert)) : null),
        h('td', {}, h('span', { class: 'with-logo' }, taskLogo(t), where(t)), internalTag(t)),
        h('td', {}, t.assignees.map(a => a.name).join(', ') || '–'),
        h('td', { class: 'num' }, fmtDate(t.start_date) || '–'),
        h('td', { class: 'num' }, fmtDate(t.due_date) || '–'),
        h('td', {}, h('span', { class: `pill col-${t.column}` }, colName(t.column))),
        h('td', {}, progressBar(t.progress)))))))));
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function calendarView(tasks) {
  const v = state.view;
  const month = v.month || today().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const startDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shift = n => { const d = S.addMonths(first, n).slice(0, 7); v.month = d; saveView(); route(); };
  const byDay = new Map();
  for (const t of tasks) if (t.due_date && t.due_date.startsWith(month)) (byDay.get(t.due_date) || byDay.set(t.due_date, []).get(t.due_date)).push(t);
  const noDue = tasks.filter(t => !t.due_date);
  const chip = t => h('button', { type: 'button', class: `chip col-${t.column}`, onclick: () => openTask(t.id), title: `${t.title} · ${where(t)} · ${colName(t.column)}` },
    taskLogo(t, 'xs'), h('span', {}, t.title));
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(h('div', { class: 'cal-cell out', 'aria-hidden': 'true' }));
  for (let d = 1; d <= days; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    const list = byDay.get(iso) || [];
    cells.push(h('div', { class: 'cal-cell' + (iso === today() ? ' today' : '') },
      h('div', { class: 'cal-day' }, d), list.map(chip)));
  }
  const agenda = [...byDay.keys()].sort().map(day => h('div', { class: 'agenda-day' + (day === today() ? ' today' : '') },
    h('h3', {}, new Date(day + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })),
    byDay.get(day).map(chip)));
  return h('div', { class: 'card-box calendar' },
    h('div', { class: 'cal-nav' },
      h('button', { class: 'btn small', type: 'button', onclick: () => shift(-1), 'aria-label': 'Mês anterior' }, '‹'),
      h('h2', {}, `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} de ${y}`),
      h('button', { class: 'btn small', type: 'button', onclick: () => shift(1), 'aria-label': 'Próximo mês' }, '›'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { v.month = ''; saveView(); route(); } }, 'Hoje'),
      h('span', { class: 'muted small' }, 'Tarefas no dia do prazo')),
    h('div', { class: 'cal-grid' },
      ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => h('div', { class: 'cal-dow' }, d)), cells),
    h('div', { class: 'agenda' }, agenda.length ? agenda : h('p', { class: 'muted' }, 'Nenhum prazo neste mês.')),
    noDue.length ? h('details', { class: 'no-due' }, h('summary', {}, `Sem prazo (${noDue.length})`), h('div', { class: 'chips' }, noDue.map(chip))) : null);
}

// ---------- alertas ----------
async function viewAlerts() {
  document.title = 'Alertas';
  const list = await api('GET', '/api/alerts');
  const overdue = list.filter(t => t.alert.kind === 'overdue');
  const soon = list.filter(t => t.alert.kind === 'soon');
  const row = t => h('button', { class: 'alert-row', type: 'button', onclick: () => openTask(t.id) },
    taskLogo(t),
    h('span', { class: 'grow' }, h('strong', {}, t.title), h('span', { class: 'muted small' }, ` · ${where(t)} · prazo ${fmtDate(t.due_date)}`)),
    h('span', { class: 'tag ' + (t.alert.kind === 'overdue' ? 'late' : 'warn') }, S.alertText(t.alert)));
  shell([
    h('h1', {}, 'Alertas'),
    h('p', { class: 'muted' }, isStaff()
      ? 'Tarefas atrasadas e as que entraram na janela de aviso escolhida em cada tarefa (no dia, 1 dia, 3 dias ou 1 semana antes).'
      : 'Suas entregas atrasadas ou com prazo chegando.'),
    h('div', { class: 'card-box' }, h('h2', {}, `Atrasadas (${overdue.length})`), overdue.length ? overdue.map(row) : h('p', { class: 'muted' }, 'Nenhuma.')),
    h('div', { class: 'card-box' }, h('h2', {}, `Prazo chegando (${soon.length})`), soon.length ? soon.map(row) : h('p', { class: 'muted' }, 'Nenhuma.')),
  ]);
}

// ---------- diálogos ----------
function modal(content, { onclose } = {}) {
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc, true); onclose && onclose(); };
  const esc = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); } };
  const overlay = h('div', { class: 'overlay center', onclick: e => { if (e.target === overlay) close(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content(close)));
  document.addEventListener('keydown', esc, true);
  document.body.append(overlay);
  overlay.querySelector('input, select, textarea, button')?.focus();
  return close;
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

// Concluir: pede a data de término e mostra em qual coluna a tarefa vai cair.
function completeDialog(t, after) {
  modal(close => {
    const err = h('p', { class: 'error', role: 'alert' });
    const result = h('p', { class: 'muted' });
    const input = h('input', { id: 'c-date', type: 'date', value: today(), max: today(), required: true });
    const preview = () => {
      const col = S.column({ status: 'done', due_date: t.due_date, completed_on: input.value }, today());
      result.replaceChildren('Vai para: ', h('span', { class: `pill col-${col}` }, colName(col)),
        t.due_date ? ` (prazo ${fmtDate(t.due_date)})` : ' (sem prazo definido)');
    };
    input.addEventListener('input', preview);
    preview();
    return h('form', { onsubmit: async e => {
      e.preventDefault();
      try {
        const nt = await api('POST', `/api/tasks/${t.id}/complete`, { completed_on: input.value });
        close();
        toast(nt.created_next_id ? `Concluída. A próxima (${S.RECURRENCE[t.recurrence].replace(/ \(.*/, '').toLowerCase()}) já foi criada.` : 'Tarefa concluída');
        after ? after(nt) : route();
      } catch (ex) { err.textContent = ex.message; }
    } },
      h('h2', {}, 'Concluir tarefa'),
      h('p', {}, t.title),
      h('div', { class: 'field' }, h('label', { for: 'c-date' }, 'Data de término'), input),
      result,
      t.recurrence !== 'none' ? h('p', { class: 'muted small' }, `Esta tarefa repete (${S.RECURRENCE[t.recurrence]}). Ao concluir, a próxima é criada com as datas avançadas.`) : null,
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Concluir'),
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar')));
  });
}

// Cancelar: o motivo é obrigatório e fica registrado na tarefa.
function cancelDialog(t, after) {
  modal(close => {
    const err = h('p', { class: 'error', role: 'alert' });
    const ta = h('textarea', { id: 'x-reason', required: true, maxlength: 1000, placeholder: 'Por que esta tarefa não vai mais ser feita?' });
    return h('form', { onsubmit: async e => {
      e.preventDefault();
      if (!ta.value.trim()) { err.textContent = 'Escreva o motivo do cancelamento.'; ta.focus(); return; }
      try {
        const nt = await api('POST', `/api/tasks/${t.id}/cancel`, { reason: ta.value });
        close(); toast('Tarefa cancelada');
        after ? after(nt) : route();
      } catch (ex) { err.textContent = ex.message; }
    } },
      h('h2', {}, 'Cancelar tarefa'),
      h('p', {}, t.title),
      h('div', { class: 'field' }, h('label', { for: 'x-reason' }, 'Motivo do cancelamento'), ta),
      t.client_visible ? h('p', { class: 'muted small' }, 'O cliente vê esta tarefa e vai ver o motivo.') : null,
      t.recurrence !== 'none' ? h('p', { class: 'muted small' }, 'Cancelar não cria a próxima repetição.') : null,
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn danger', type: 'submit' }, 'Cancelar tarefa'),
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Voltar')));
  });
}

// ---------- campos de tarefa (nova e detalhe) ----------
function staffUsers() { return state.users.filter(u => u.role !== 'client' && u.active); }
function assigneeChecks(selected = []) {
  return h('div', { class: 'checks', role: 'group', 'aria-label': 'Responsáveis' },
    staffUsers().map(u => h('label', {}, h('input', { type: 'checkbox', name: 'assignee', value: u.id, checked: selected.includes(u.id) }), u.name)));
}
function alertChecks(selected = []) {
  return h('div', { class: 'checks', role: 'group', 'aria-label': 'Alertas' },
    S.ALERTS.map(a => h('label', {}, h('input', { type: 'checkbox', name: 'alert', value: a.days, checked: selected.includes(a.days) }), a.label)));
}
// Tipo e empresa juntos: externa exige cliente; interna aceita a própria consultoria ou um cliente relacionado.
// Interna ligada a um cliente pode ficar visível para ele; sem cliente, só quem criou e os responsáveis veem.
function kindClientFields(prefix, kind, clientId, visible, onchange) {
  const clientSel = h('select', { id: `${prefix}-client`, name: 'client_id' });
  const hint = h('p', { class: 'muted small' });
  const vis = h('input', { type: 'checkbox', id: `${prefix}-vis`, checked: !!visible });
  const visRow = h('label', { class: 'check inline', for: `${prefix}-vis` }, vis, 'Visível para o cliente');
  const value = () => ({ kind, client_id: clientSel.value ? Number(clientSel.value) : null, client_visible: kind === 'internal' && !!clientSel.value && vis.checked });
  const refresh = () => {
    const internalWithClient = kind === 'internal' && !!clientSel.value;
    visRow.hidden = !internalWithClient;
    hint.textContent = kind === 'external'
      ? 'Externa: a equipe toda vê, e o cliente vê no portal dele.'
      : internalWithClient && vis.checked
        ? 'Interna visível: o cliente vê; da equipe, só quem criou e os responsáveis.'
        : 'Interna: só quem criou e os responsáveis veem. O cliente não vê.';
  };
  const fill = k => {
    const opts = k === 'external'
      ? state.clients.map(c => [c.id, c.name])
      : [['', `${state.org.name} (própria)`], ...state.clients.map(c => [c.id, `${c.name} (relacionado)`])];
    clientSel.replaceChildren(...opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(clientId ?? '') }, l)));
    refresh();
  };
  const changed = () => { refresh(); onchange && onchange(value()); };
  const radios = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Tipo' },
    [['external', 'Externa (de cliente)'], ['internal', 'Interna (nossa)']].map(([v, l]) =>
      h('label', { class: 'seg-btn' }, h('input', { type: 'radio', name: `${prefix}-kind`, value: v, checked: v === kind, class: 'sr-only',
        onchange: () => { kind = v; clientId = clientSel.value; fill(v); changed(); } }), l)));
  clientSel.addEventListener('change', changed);
  vis.addEventListener('change', changed);
  fill(kind);
  return {
    el: h('div', {},
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Tipo'), radios),
      h('div', { class: 'field' }, h('label', { for: `${prefix}-client` }, 'Empresa'), clientSel, visRow, hint)),
    value,
  };
}

// Checklist editável antes de a tarefa existir (nova tarefa).
function checklistBuilder(initial = []) {
  let items = [...initial];
  const list = h('ul', { class: 'cl-builder' });
  const input = h('input', { id: 'n-ck', placeholder: 'Escreva um item e tecle Enter', maxlength: 300 });
  const paint = () => list.replaceChildren(...items.map((text, i) => h('li', {}, h('span', { class: 'grow' }, text),
    h('button', { type: 'button', class: 'btn ghost small', 'aria-label': `Remover ${text}`, onclick: () => { items.splice(i, 1); paint(); } }, '✕'))));
  const add = () => { const v = input.value.trim(); if (v) { items.push(v); input.value = ''; paint(); } input.focus(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  paint();
  return {
    el: h('div', { class: 'field' }, h('label', { for: 'n-ck' }, 'Checklist (opcional)'), list,
      h('div', { class: 'row' }, h('div', { class: 'grow' }, input), h('button', { class: 'btn', type: 'button', onclick: add }, 'Adicionar'))),
    set: next => { items = [...next]; paint(); },
    value: () => { const pending = input.value.trim(); return pending ? [...items, pending] : items; },
  };
}
function recurrenceFields(prefix, rec = 'none', every = '') {
  const n = h('input', { id: `${prefix}-every`, type: 'number', min: 1, max: 3650, value: every || 30, style: 'width:90px' });
  const wrap = h('span', { class: 'row', hidden: rec !== 'custom' }, 'a cada', n, 'dias');
  const sel = h('select', { id: `${prefix}-rec`, onchange: () => { wrap.hidden = sel.value !== 'custom'; } },
    Object.entries(S.RECURRENCE).map(([v, l]) => h('option', { value: v, selected: v === rec }, l)));
  return {
    el: h('div', { class: 'field' }, h('label', { for: `${prefix}-rec` }, 'Repetição'), h('div', { class: 'row' }, h('div', { class: 'grow' }, sel), wrap)),
    sel, n, value: () => ({ recurrence: sel.value, recurrence_every: sel.value === 'custom' ? Number(n.value) : null }),
  };
}

function newTaskModal() {
  modal(close => {
    const err = h('p', { class: 'error', role: 'alert' });
    const kc = kindClientFields('n', state.clients.length ? 'external' : 'internal', state.view.client && state.view.client !== 'org' ? Number(state.view.client) : null, false);
    const rec = recurrenceFields('n');
    const ck = checklistBuilder();
    const tplSel = h('select', { id: 'n-tpl', name: 'template_id', onchange: e => {
      const tpl = state.templates.find(x => String(x.id) === e.target.value);
      ck.set(tpl ? tpl.checklist : []);
    } }, h('option', { value: '' }, 'Nenhum'), state.templates.map(t => h('option', { value: t.id }, t.name)));
    return h('form', { onsubmit: async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const { id } = await api('POST', '/api/tasks', {
          ...kc.value(), ...rec.value(), checklist: ck.value(),
          template_id: fd.get('template_id') ? Number(fd.get('template_id')) : undefined,
          title: fd.get('title'), description: fd.get('description'),
          due_date: fd.get('due_date') || null, priority: fd.get('priority'),
          alerts: fd.getAll('alert').map(Number), assignee_ids: fd.getAll('assignee').map(Number),
        });
        close(); toast('Tarefa criada'); await route(); openTask(id);
      } catch (ex) { err.textContent = ex.message; }
    } },
      h('h2', {}, 'Nova tarefa'),
      kc.el,
      h('div', { class: 'field' }, h('label', { for: 'n-tpl' }, 'Modelo (opcional)'), tplSel),
      h('div', { class: 'field' }, h('label', { for: 'n-title' }, 'Título'), h('input', { id: 'n-title', name: 'title', maxlength: 200, placeholder: 'Se vazio, usa o título do modelo' })),
      h('div', { class: 'field' }, h('label', { for: 'n-desc' }, 'Descrição'), h('textarea', { id: 'n-desc', name: 'description' })),
      ck.el,
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'n-due' }, 'Prazo'), h('input', { id: 'n-due', name: 'due_date', type: 'date' })),
        h('div', { class: 'field' }, h('label', { for: 'n-pri' }, 'Prioridade'),
          h('select', { id: 'n-pri', name: 'priority' }, Object.entries(PRIORITY).map(([v, l]) => h('option', { value: v, selected: v === 'normal' }, l))))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Alertas do prazo'), alertChecks([1])),
      rec.el,
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Responsáveis'), assigneeChecks([state.me.id])),
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Criar tarefa'),
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar')));
  });
}

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

  const apply = nt => { dirty = true; Object.assign(t, nt); paint(); };
  const save = guard(async patch => apply(await api('PATCH', `/api/tasks/${t.id}`, patch)));
  const act = guard(async (method, path, body) => apply(await api(method, path, body)));

  function paint() {
    const staff = isStaff();
    const scroll = drawer.scrollTop;
    drawer.replaceChildren(...[
      h('div', { class: 'drawer-head' }, taskLogo(t, 'md'),
        staff ? h('input', { 'aria-label': 'Título', value: t.title, maxlength: 200, onchange: e => save({ title: e.target.value }) })
          : h('h1', { style: 'flex:1' }, t.title),
        h('button', { class: 'btn ghost', 'aria-label': 'Fechar', onclick: () => close() }, '✕')),
      h('p', { class: 'meta' }, h('span', { class: `pill col-${t.column}` }, colName(t.column)),
        h('span', {}, where(t)), internalTag(t),
        t.alert ? h('span', { class: 'tag ' + (t.alert.kind === 'overdue' ? 'late' : 'warn') }, '⏰ ' + S.alertText(t.alert)) : null,
        t.archived_at ? h('span', { class: 'tag' }, 'Arquivada') : null),

      !staff && t.status === 'review' ? clientDecision() : null,
      statusSection(staff),
      staff ? kindClientFields('d', t.kind, t.client_id, t.client_visible, v => save(v)).el : null,
      datesSection(staff),
      staff ? h('div', { class: 'field' }, h('span', { class: 'label' }, 'Responsáveis'),
        (() => { const g = assigneeChecks(t.assignees.map(a => a.id));
          g.addEventListener('change', () => save({ assignee_ids: [...g.querySelectorAll('input:checked')].map(i => Number(i.value)) }));
          return g; })())
        : (t.assignees.length ? h('p', { class: 'muted' }, 'Responsáveis: ' + t.assignees.map(a => a.name).join(', ')) : null),
      staff ? h('div', { class: 'field' }, h('label', { for: 'd-desc' }, 'Descrição'),
        h('textarea', { id: 'd-desc', rows: 4, onchange: e => save({ description: e.target.value }) }, t.description))
        : (t.description ? h('p', { style: 'white-space:pre-wrap' }, t.description) : null),
      checklistSection(staff),
      adjustmentsSection(staff),
      commentsSection(staff),
      staff ? h('div', { class: 'section row' },
        h('button', { class: 'btn', onclick: () => act('POST', `/api/tasks/${t.id}/archive`, { archived: !t.archived_at }) }, t.archived_at ? 'Desarquivar' : 'Arquivar'),
        isAdmin() ? h('button', { class: 'btn danger', onclick: guard(async () => {
          if (!(await ask('Apagar esta tarefa? Isso não pode ser desfeito. Para só tirar da frente, use Arquivar.', { ok: 'Apagar tarefa', danger: true }))) return;
          await api('DELETE', `/api/tasks/${t.id}`); dirty = true; close(); toast('Tarefa apagada');
        }) }, 'Apagar') : null) : null,
    ].filter(Boolean));
    drawer.scrollTop = scroll;
  }

  function statusSection(staff) {
    const pct = t.progress;
    const showProgress = t.status === 'doing' || t.progress_from_checklist || pct > 0;
    if (t.status === 'cancelled') {
      return h('div', { class: 'card-box cancel-box' },
        h('p', {}, h('strong', {}, `Cancelada em ${fmtDate(t.cancelled_on)}`)),
        h('p', { class: 'reason' }, 'Motivo: ', t.cancel_reason),
        staff ? h('button', { class: 'btn small', onclick: () => save({ status: 'todo' }) }, 'Reabrir') : null);
    }
    if (t.status === 'done') {
      return h('div', { class: 'card-box done-box' },
        h('p', {}, h('strong', {}, `Concluída em ${fmtDate(t.completed_on)}`), t.due_date ? ` · prazo era ${fmtDate(t.due_date)}` : ''),
        t.next_task_id ? h('p', { class: 'muted small' }, 'A próxima repetição já foi criada.') : null,
        staff ? h('button', { class: 'btn small', onclick: () => save({ status: 'doing' }) }, 'Reabrir') : null);
    }
    const range = h('input', { id: 'd-pct', type: 'range', min: 0, max: 100, step: 5, value: pct, disabled: !staff || t.progress_from_checklist,
      oninput: e => { num.value = e.target.value; }, onchange: e => save({ progress: Number(e.target.value) }) });
    const num = h('input', { type: 'number', min: 0, max: 100, value: pct, 'aria-label': '% de execução', class: 'pct-input', disabled: !staff || t.progress_from_checklist,
      onchange: e => save({ progress: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) }) });
    return h('div', {},
      staff ? h('div', { class: 'row', style: 'margin-bottom:12px' },
        h('div', { class: 'grow' }, h('label', { for: 'd-status' }, 'Situação'),
          h('select', { id: 'd-status', onchange: e => save({ status: e.target.value }) },
            ['todo', 'doing', 'review'].map(s => h('option', { value: s, selected: s === t.status }, S.STATUS_LABEL[s])))),
        h('button', { class: 'btn primary', style: 'align-self:flex-end', onclick: () => completeDialog(t, nt => apply(nt)) }, 'Concluir…'),
        h('button', { class: 'btn', style: 'align-self:flex-end', onclick: () => cancelDialog(t, nt => apply(nt)) }, 'Cancelar…')) : null,
      t.column === 'overdue' && staff ? h('p', { class: 'small danger' }, 'Está em Atrasada porque o prazo passou. Ajuste o prazo ou conclua para tirar daqui.') : null,
      showProgress ? h('div', { class: 'field' },
        h('label', { for: 'd-pct' }, '% de execução'),
        staff ? h('div', { class: 'row' }, h('div', { class: 'grow' }, range), num, '%') : progressBar(pct),
        t.progress_from_checklist ? h('p', { class: 'muted small' }, 'Calculado pelo checklist: muda sozinho conforme os itens são marcados.') : null) : null);
  }

  function datesSection(staff) {
    if (!staff) {
      return h('p', {}, [t.start_date ? `Iniciada em ${fmtDate(t.start_date)}` : null, t.due_date ? `Prazo ${fmtDate(t.due_date)}` : 'Sem prazo definido']
        .filter(Boolean).join(' · '));
    }
    const rec = recurrenceFields('d', t.recurrence, t.recurrence_every);
    rec.sel.addEventListener('change', () => { if (rec.sel.value !== 'custom') save(rec.value()); });
    rec.n.addEventListener('change', () => save(rec.value()));
    const al = alertChecks(t.alerts);
    al.addEventListener('change', () => save({ alerts: [...al.querySelectorAll('input:checked')].map(i => Number(i.value)) }));
    return h('div', {},
      h('div', { class: 'grid3' },
        h('div', { class: 'field' }, h('label', { for: 'd-start', title: 'Preenchido sozinho quando a tarefa vai para Em andamento' }, 'Início (quando começou)'),
          h('input', { id: 'd-start', type: 'date', value: t.start_date || '', onchange: e => save({ start_date: e.target.value || null }) })),
        h('div', { class: 'field' }, h('label', { for: 'd-due' }, 'Prazo'),
          h('input', { id: 'd-due', type: 'date', value: t.due_date || '', onchange: e => save({ due_date: e.target.value || null }) })),
        h('div', { class: 'field' }, h('label', { for: 'd-pri' }, 'Prioridade'),
          h('select', { id: 'd-pri', onchange: e => save({ priority: e.target.value }) },
            Object.entries(PRIORITY).map(([v, l]) => h('option', { value: v, selected: v === t.priority }, l))))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Alertas do prazo'), al),
      rec.el);
  }

  function clientDecision() {
    const ta = h('textarea', { id: 'c-adj', placeholder: 'O que precisa mudar?' });
    return h('div', { class: 'card-box', style: 'border-color:var(--accent)' },
      h('h2', {}, 'Esta entrega está esperando sua revisão'),
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
      t.checklist.map(i => h('div', { class: 'check' },
        h('input', { type: 'checkbox', id: `ck-${i.id}`, checked: !!i.done, disabled: !staff, onchange: e => act('PATCH', `/api/checklist/${i.id}`, { done: e.target.checked }) }),
        h('label', { for: `ck-${i.id}`, class: i.done ? 'done' : '', style: 'font-weight:400;margin:0;flex:1' }, i.text),
        staff ? h('button', { class: 'btn ghost small', 'aria-label': `Remover ${i.text}`, onclick: () => act('DELETE', `/api/checklist/${i.id}`) }, '✕') : null)),
      staff ? h('form', { class: 'row', style: 'margin-top:8px', onsubmit: e => { e.preventDefault(); if (input.value.trim()) act('POST', `/api/tasks/${t.id}/checklist`, { text: input.value }); } },
        h('div', { class: 'grow' }, input), h('button', { class: 'btn', type: 'submit' }, 'Adicionar')) : null);
  }

  function adjustmentsSection(staff) {
    if (!staff && !t.adjustments.length) return null;
    const open = t.adjustments.filter(a => !a.resolved_at).length;
    const ta = h('textarea', { 'aria-label': 'Descreva o ajuste interno', placeholder: 'O que a revisão interna pediu?' });
    return h('div', { class: 'section' },
      h('h2', {}, 'Ajustes'),
      staff ? h('p', { class: 'meta' }, h('span', { class: 'tag' }, `${t.adjustments_internal} interno${t.adjustments_internal === 1 ? '' : 's'}`),
        t.client_visible ? h('span', { class: 'tag adj' }, `${t.adjustments_client} do cliente`) : null,
        open ? h('span', { class: 'tag late' }, `${open} em aberto`) : h('span', { class: 'tag ok' }, 'nenhum em aberto')) : null,
      t.adjustments.length ? t.adjustments.map(a => h('div', { class: 'adj-item' + (a.resolved_at ? '' : ' open') },
        h('div', { class: 'meta' }, h('strong', {}, a.origin === 'client' ? 'Pedido do cliente' : 'Interno'), `· ${a.author || ''} · ${fmtDateTime(a.created_at)}`,
          a.resolved_at ? h('span', { class: 'tag ok' }, 'resolvido') : null),
        h('div', { class: 'comment' }, h('div', { class: 'body' }, a.body)),
        staff && !a.resolved_at ? h('button', { class: 'btn small', onclick: () => act('POST', `/api/adjustments/${a.id}/resolve`) }, 'Marcar como resolvido') : null))
        : h('p', { class: 'muted' }, 'Nenhum ajuste até agora.'),
      staff && !['done', 'cancelled'].includes(t.status) ? h('details', {}, h('summary', {}, 'Registrar ajuste interno'),
        h('div', { style: 'margin-top:8px' }, ta,
          h('button', { class: 'btn', style: 'margin-top:8px', onclick: () => { if (!ta.value.trim()) { ta.focus(); return; } act('POST', `/api/tasks/${t.id}/adjustments`, { body: ta.value }); } }, 'Registrar e voltar para "Em andamento"'))) : null);
  }

  function commentsSection(staff) {
    const ta = h('textarea', { id: 'cm-body', placeholder: staff ? 'Escreva um comentário' : 'Escreva para a equipe' });
    const vis = h('input', { type: 'checkbox', id: 'cm-vis' });
    return h('div', { class: 'section' },
      h('h2', {}, 'Comentários'),
      t.comments.length ? t.comments.map(c => h('div', { class: 'comment' },
        h('div', { class: 'meta' }, h('span', { class: 'by' }, c.author || 'Cliente'), fmtDateTime(c.created_at),
          staff && t.client_visible ? h('span', { class: 'tag' + (c.visible_to_client ? ' ok' : '') }, c.visible_to_client ? 'cliente vê' : 'só equipe') : null),
        h('div', { class: 'body' }, c.body))) : h('p', { class: 'muted' }, 'Sem comentários.'),
      h('form', { style: 'margin-top:8px', onsubmit: e => {
        e.preventDefault(); if (!ta.value.trim()) return;
        act('POST', `/api/tasks/${t.id}/comments`, { body: ta.value, visible_to_client: vis.checked });
      } },
        h('label', { for: 'cm-body', class: 'sr-only' }, 'Comentário'), ta,
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { class: 'btn', type: 'submit' }, 'Comentar'),
          staff && t.client_visible ? h('label', { for: 'cm-vis', class: 'check inline' }, vis, 'Visível para o cliente') : null)));
  }

  paint();
  drawer.querySelector('input, button')?.focus();
}

// ---------- portal do cliente ----------
async function viewPortal() {
  document.title = 'Minhas entregas';
  const tasks = await api('GET', '/api/tasks');
  const by = key => tasks.filter(t => t.column === key);
  const done = tasks.filter(t => t.status === 'done').sort((a, b) => (b.completed_on || '').localeCompare(a.completed_on || ''));
  const item = (t, waiting) => h('div', { class: 'portal-task' + (waiting ? ' waiting' : '') },
    h('div', { class: 'row' }, h('strong', { class: 'grow' }, t.title),
      h('button', { class: waiting ? 'btn primary' : 'btn', onclick: () => openTask(t.id) }, waiting ? 'Revisar' : 'Ver')),
    t.status === 'cancelled' ? h('p', { class: 'cancel-reason' }, 'Motivo: ' + t.cancel_reason) : null,
    !['done', 'cancelled'].includes(t.status) && (t.status === 'doing' || t.progress > 0) ? progressBar(t.progress) : null,
    h('div', { class: 'meta', style: 'margin-top:6px' }, h('span', { class: `pill col-${t.column}` }, colName(t.column)),
      dateRange(t) ? h('span', {}, dateRange(t)) : null,
      t.alert ? h('span', { class: 'tag ' + (t.alert.kind === 'overdue' ? 'late' : 'warn') }, S.alertText(t.alert)) : null));
  const section = (title, list, waiting, empty) => h('section', { class: 'portal-section' }, h('h2', {}, `${title} (${list.length})`),
    list.length ? list.map(t => item(t, waiting)) : h('p', { class: 'muted' }, empty));
  const me = clientById(state.me.client_id);
  shell([
    h('div', { class: 'row', style: 'margin-bottom:16px' }, me ? logoEl(me.name, me.logo, 'md') : null, h('h1', {}, 'Minhas entregas')),
    section('Esperando sua revisão', by('review'), true, 'Nada esperando você agora.'),
    section('Atrasadas', by('overdue'), false, 'Nenhuma.'),
    section('Em andamento', by('doing'), false, 'Nenhuma tarefa em andamento.'),
    section('A fazer', by('todo'), false, 'Nada na fila.'),
    section('Concluídas', done.slice(0, 30), false, 'Ainda nenhuma.'),
    by('cancelled').length ? section('Canceladas', by('cancelled'), false, '') : null,
  ]);
}

// ---------- clientes ----------
async function viewClients() {
  document.title = 'Clientes';
  state.clients = await api('GET', '/api/clients');
  let newLogo = null;
  const preview = h('span', {});
  shell([
    h('h1', { style: 'margin-bottom:16px' }, 'Clientes'),
    isAdmin() ? h('form', { class: 'card-box row', onsubmit: guard(async e => {
      e.preventDefault();
      await api('POST', '/api/clients', { name: e.target.elements.name.value, logo: newLogo }); toast('Cliente cadastrado'); route();
    }) }, preview,
      h('div', { class: 'grow' }, h('label', { for: 'cl-name', class: 'sr-only' }, 'Nome do cliente'),
        h('input', { id: 'cl-name', name: 'name', placeholder: 'Nome do novo cliente', required: true, maxlength: 120 })),
      logoPicker('Escolher logo', async src => { newLogo = src; preview.replaceChildren(logoEl('novo', src)); }),
      h('button', { class: 'btn primary', type: 'submit' }, 'Cadastrar')) : null,
    h('div', { class: 'card-box table-wrap' }, state.clients.length ? h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Cliente'), h('th', { class: 'num' }, 'Externas abertas'), h('th', { class: 'num' }, 'Internas abertas'), h('th', {}, ''))),
      h('tbody', {}, state.clients.map(c => h('tr', {},
        h('td', {}, h('span', { class: 'with-logo' }, logoEl(c.name, c.logo, 'md'), c.name)),
        h('td', { class: 'num' }, c.open_external), h('td', { class: 'num' }, c.open_internal),
        h('td', { class: 'actions' },
          h('button', { class: 'btn small', onclick: () => { Object.assign(state.view, { client: String(c.id), kind: '' }); saveView(); location.hash = '#/tarefas'; } }, 'Ver tarefas'),
          isAdmin() ? [
            logoPicker(c.logo ? 'Trocar logo' : 'Pôr logo', async src => { await api('PATCH', `/api/clients/${c.id}`, { logo: src }); toast('Logo salvo'); route(); }),
            c.logo ? h('button', { class: 'btn small', onclick: guard(async () => { await api('PATCH', `/api/clients/${c.id}`, { logo: null }); route(); }) }, 'Tirar logo') : null,
            h('button', { class: 'btn small', onclick: guard(async () => {
              const name = await askText('Novo nome do cliente', c.name);
              if (name) { await api('PATCH', `/api/clients/${c.id}`, { name }); route(); }
            }) }, 'Renomear')] : null)))))
      : h('p', { class: 'empty' }, 'Nenhum cliente ainda.')),
  ]);
}

// ---------- pessoas ----------
async function viewTeam() {
  document.title = 'Pessoas';
  state.users = await api('GET', '/api/users');
  const err = h('p', { class: 'error', role: 'alert' });
  const roleSel = h('select', { id: 'u-role', name: 'role', onchange: () => { clientField.hidden = roleSel.value !== 'client'; } },
    ['member', 'admin', 'client'].map(v => h('option', { value: v }, roleLabel(v))));
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
      h('div', { class: 'field' }, h('label', { for: 'u-role' }, 'Visão'), roleSel)),
    clientField,
    h('ul', { class: 'muted small roles' },
      h('li', {}, h('strong', {}, 'Administrador: '), 'vê as externas e as internas que criou ou em que é responsável; gerencia pessoas, clientes e marca.'),
      h('li', {}, h('strong', {}, `${roleLabel('member')}: `), 'cria tarefas; vê as externas e as internas que criou ou em que é responsável.'),
      h('li', {}, h('strong', {}, 'Cliente: '), 'vê as externas da empresa dele e as internas marcadas como visíveis; aprova entregas e pede ajustes.')),
    err, h('button', { class: 'btn primary', type: 'submit' }, 'Criar acesso')) : null;
  shell([
    h('h1', { style: 'margin-bottom:16px' }, 'Pessoas'),
    form,
    h('div', { class: 'card-box table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Nome'), h('th', {}, 'Email'), h('th', {}, 'Visão'), h('th', {}, 'Situação'), h('th', {}, ''))),
      h('tbody', {}, state.users.map(u => h('tr', {},
        h('td', {}, u.name), h('td', {}, u.email), h('td', {}, roleLabel(u.role) + (u.client_name ? ` · ${u.client_name}` : '')),
        h('td', {}, u.active ? 'Ativo' : 'Desativado'),
        h('td', { class: 'actions' }, isAdmin() && u.id !== state.me.id ? h('button', { class: 'btn small', onclick: guard(async () => {
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
        h('button', { class: 'btn small danger', onclick: guard(async () => {
          if (await ask(`Apagar o modelo "${t.name}"?`, { ok: 'Apagar modelo', danger: true })) { await api('DELETE', `/api/templates/${t.id}`); route(); }
        }) }, 'Apagar')),
      h('p', { class: 'muted' }, `Cria: "${t.title}"` + (t.checklist.length ? ` com ${t.checklist.length} itens` : '')),
      t.checklist.length ? h('ul', {}, t.checklist.map(i => h('li', {}, i))) : null))
      : h('div', { class: 'card-box empty' }, 'Nenhum modelo ainda.'),
  ]);
}

// ---------- relatório ----------
async function viewReport() {
  document.title = 'Relatório';
  const rows = await api('GET', '/api/report/adjustments');
  const pct = r => (r.on_time + r.late ? Math.round((r.on_time / (r.on_time + r.late)) * 100) + '%' : '–');
  shell([
    h('h1', {}, 'Relatório por empresa'),
    h('p', { class: 'muted' }, 'Entregas no prazo e quantas vezes o trabalho voltou. Ajuste do cliente mostra o que passou pela revisão interna.'),
    h('div', { class: 'card-box table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Empresa', 'Tarefas', 'Concluídas no prazo', 'Fora do prazo', '% no prazo', 'Canceladas', 'Ajustes internos', 'Ajustes do cliente'].map((x, i) => h('th', { class: i ? 'num' : null }, x)))),
      h('tbody', {}, rows.map(r => h('tr', {},
        h('td', {}, r.name), h('td', { class: 'num' }, r.tasks), h('td', { class: 'num' }, r.on_time), h('td', { class: 'num' }, r.late),
        h('td', { class: 'num' }, pct(r)), h('td', { class: 'num' }, r.cancelled), h('td', { class: 'num' }, r.internal), h('td', { class: 'num' }, r.client)))))),
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
      h('p', { class: 'muted' }, 'O nome, o logo e a cor aparecem para a equipe e para os clientes. O logo também marca as tarefas internas.'),
      h('div', { class: 'row', style: 'margin-bottom:12px' }, logoEl(state.org.name, state.org.logo, 'lg'),
        logoPicker(state.org.logo ? 'Trocar logo' : 'Pôr logo', async src => { await api('PATCH', '/api/org', { logo: src }); await loadCommon(); toast('Logo salvo'); route(); }),
        state.org.logo ? h('button', { class: 'btn small', type: 'button', onclick: guard(async () => { await api('PATCH', '/api/org', { logo: null }); await loadCommon(); route(); }) }, 'Tirar logo') : null),
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
