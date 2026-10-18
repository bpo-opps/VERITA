'use strict';
/* global Shared */
const S = window.Shared;

// ---------- utilidades ----------
const state = {
  me: null, org: null, clients: [], users: [], templates: [], alertCount: 0,
  view: { layout: 'kanban', kind: '', client: '', assignee: '', due: '', rec: '', q: '', group: 'column', archived: false, month: '' },
};
const VIEW_KEY = 'tarefas-visao';

// Tema: claro (padrão), escuro ou automático (segue o aparelho). Guardado neste aparelho.
const THEME_KEY = 'tarefas-tema';
let themePref = 'light';
try { themePref = localStorage.getItem(THEME_KEY) || 'light'; } catch { /* sem armazenamento: fica no claro */ }
const isDarkNow = () => themePref === 'dark' || (themePref === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
function applyTheme() {
  const root = document.documentElement;
  const want = themePref === 'auto' ? null : themePref;
  if (want && root.getAttribute('data-theme') !== want) root.setAttribute('data-theme', want);
  if (!want && root.hasAttribute('data-theme')) root.removeAttribute('data-theme');
}
function setTheme(pref) {
  themePref = pref;
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* idem */ }
  applyTheme();
}
applyTheme();
// Se a página onde o sistema roda trocar o tema por conta própria, a escolha da pessoa prevalece.
new MutationObserver(() => { if (themePref !== 'auto') applyTheme(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
// Filtros e visão ficam guardados por pessoa: quem entra depois no mesmo aparelho não herda o filtro de outro.
const VIEW_DEFAULT = { ...state.view };
const viewKey = () => `${VIEW_KEY}-${state.me?.id}`;
function loadView() {
  state.view = { ...VIEW_DEFAULT };
  try { Object.assign(state.view, JSON.parse(localStorage.getItem(viewKey())) || {}, { q: '', archived: false }); } catch { /* sem armazenamento */ }
}
const saveView = () => { try { localStorage.setItem(viewKey(), JSON.stringify(state.view)); } catch { /* idem */ } };

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
function toast(msg, ms = 3200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
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

// Cor da marca: vira --brand (logo, destaques, gráficos). Para botões e links deriva um tom que
// passa no contraste AA: no tema claro escurece até o texto branco ter 4.5:1; no escuro clareia até
// ter 4.5:1 sobre o fundo escuro. Assim qualquer cor escolhida em Configurações continua legível.
function applyAccent(hex) {
  const rgb = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
  const lum = c => c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const mix = (c, t, k) => c.map((v, i) => Math.round(v + (t[i] - v) * k));
  const toHex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  const base = rgb(hex), white = [255, 255, 255], black = [0, 0, 0], darkBg = [21, 27, 38];
  let light = base, dark = base, k = 0;
  while (ratio(light, white) < 4.5 && k < 1) { k += 0.04; light = mix(base, black, k); }
  k = 0;
  while (ratio(dark, darkBg) < 4.5 && k < 1) { k += 0.04; dark = mix(base, white, k); }
  const st = document.documentElement.style;
  st.setProperty('--brand', hex);
  st.setProperty('--accent-light', toHex(light));
  st.setProperty('--on-accent-light', '#ffffff');
  st.setProperty('--accent-dark', toHex(dark));
  st.setProperty('--on-accent-dark', ratio(dark, white) >= 4.5 ? '#ffffff' : '#111111');
}

const APP_NAME = 'Painel de Tarefas Opps';
// Logo da Opps (versão colorida e branca). No protótipo, o build injeta as imagens embutidas.
const LOGO = window.BRAND_LOGOS || { color: '/brand/opps-logo.png', white: '/brand/opps-logo-branco.png' };
const wordmark = () => [h('img', { class: 'wordmark light-only', src: LOGO.color, alt: 'Opps Consultoria' }),
  h('img', { class: 'wordmark dark-only', src: LOGO.white, alt: 'Opps Consultoria' })];

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

// Ícones de traço simples (desenho próprio), em SVG embutido.
const ICONS = {
  board: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  building: '<rect x="4" y="3" width="11" height="18" rx="1.5"/><path d="M15 9h4.5a.5.5 0 0 1 .5.5V21H15M8 7h3M8 11h3M8 15h3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  filter: '<path d="M4 5h16l-6 8v5l-4 2v-7z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  meet: '<rect x="3" y="6" width="12.5" height="12" rx="2"/><path d="M15.5 10.5l5-3v9l-5-3"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  home: '<rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/>',
  repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name];
  return svg;
}

function renderLogin(message) {
  document.title = `Entrar · ${APP_NAME}`;
  const err = h('p', { class: 'error', role: 'alert' }, message || '');
  const form = h('form', { class: 'login', onsubmit: async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('POST', '/api/login', { email: fd.get('email'), password: fd.get('password') });
      await boot();
    } catch (ex) { err.textContent = ex.message; }
  } },
    h('div', { class: 'login-brand' }, wordmark()),
    h('h1', {}, 'Painel de Tarefas'),
    h('p', { class: 'muted', style: 'margin:0 0 20px' }, 'Acesse com o email e a senha que você recebeu.'),
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), h('input', { id: 'email', name: 'email', type: 'email', autocomplete: 'username', required: true })),
    h('div', { class: 'field' }, h('label', { for: 'password' }, 'Senha'), h('input', { id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
    err,
    h('button', { class: 'btn primary', type: 'submit' }, 'Entrar'));
  app().replaceChildren(h('div', { class: 'login-wrap' }, form));
  form.querySelector('input').focus();
}

// Estrutura: menu lateral (gaveta no celular) + barra superior com o título e a ação da página.
function shell(content, { title, sub } = {}) {
  const nav = isStaff()
    ? [['#/painel', 'Dashboard', 'home'], ['#/tarefas', 'Tarefas', 'board'], ['#/recorrentes', 'Recorrentes', 'repeat'], ['#/reunioes', 'Reuniões', 'meet'], ['#/alertas', 'Alertas', 'bell'],
      ['#/clientes', 'Clientes', 'building'], ['#/modelos', 'Modelos', 'copy'], ['#/relatorio', 'Relatório', 'chart'], ['#/equipe', 'Pessoas', 'users'],
      ...(isAdmin() ? [['#/avisos', 'Avisos', 'mail']] : []),
      ['#/config', 'Configurações', 'settings']]
    : [['#/painel', 'Dashboard', 'home'], ['#/tarefas', 'Minhas entregas', 'board'], ['#/recorrentes', 'Recorrentes', 'repeat'], ['#/alertas', 'Alertas', 'bell'],
      ['#/config', 'Minha conta', 'settings']];
  const current = location.hash.split('?')[0] || nav[0][0];
  const page = nav.find(n => n[0] === current) || nav[0];
  document.title = `${title || page[1]} · ${APP_NAME}`;
  const shellEl = h('div', { class: 'app' });
  const toggleNav = open => shellEl.classList.toggle('nav-open', open);
  const recurringPage = current === '#/recorrentes';
  const newTask = isStaff() && ['#/tarefas', '#/painel', '#/recorrentes'].includes(current)
    ? h('button', { class: 'btn primary new-task', type: 'button', 'aria-label': recurringPage ? 'Nova tarefa recorrente' : 'Nova tarefa',
      onclick: () => newTaskModal({ recurring: recurringPage }) }, icon('plus'), h('span', { class: 'label-text' }, recurringPage ? 'Nova recorrente' : 'Nova tarefa'))
    : null;
  shellEl.append(
    h('aside', { class: 'sidebar', 'aria-label': 'Menu' },
      h('a', { class: 'brand', href: '#/painel', 'aria-label': `${APP_NAME}: ir para o Dashboard` }, wordmark(), h('span', { class: 'brand-sub' }, 'Painel de Tarefas')),
      h('div', { class: 'nav-label' }, 'Menu'),
      h('nav', { 'aria-label': 'Principal' },
        nav.map(([href, label, ic]) => h('a', { class: 'nav-link', href, 'aria-current': current === href ? 'page' : null, onclick: () => toggleNav(false) },
          icon(ic), h('span', {}, label),
          href === '#/alertas' && state.alertCount ? h('span', { class: 'badge', 'aria-label': `${state.alertCount} alertas` }, state.alertCount) : null))),
      h('div', { class: 'side-user' },
        h('span', { class: 'avatar' }, initials(state.me.name)),
        h('div', { style: 'min-width:0' }, h('div', { class: 'who-name' }, state.me.name), h('div', { class: 'who-role' }, roleLabel(state.me.role))),
        h('button', { class: 'icon-btn', type: 'button', title: 'Sair', 'aria-label': 'Sair', onclick: guard(async () => { await api('POST', '/api/logout'); state.me = null; renderLogin(); }) }, icon('logout')))),
    h('div', { class: 'scrim', onclick: () => toggleNav(false) }),
    h('div', { class: 'content' },
      h('header', { class: 'topbar' },
        h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Abrir menu', onclick: () => toggleNav(true) }, icon('menu')),
        h('div', { class: 'grow' }, h('h1', {}, title || page[1]), sub ? h('div', { class: 'page-sub' }, sub) : null),
        h('button', { class: 'icon-btn theme-btn', type: 'button', title: isDarkNow() ? 'Usar tema claro' : 'Usar tema escuro',
          'aria-label': isDarkNow() ? 'Usar tema claro' : 'Usar tema escuro',
          onclick: e => { setTheme(isDarkNow() ? 'light' : 'dark'); const btn = e.currentTarget; btn.replaceChildren(icon(isDarkNow() ? 'sun' : 'moon'));
            btn.title = btn.ariaLabel = isDarkNow() ? 'Usar tema claro' : 'Usar tema escuro'; } }, icon(isDarkNow() ? 'sun' : 'moon')),
        newTask),
      h('main', {}, content)));
  app().replaceChildren(shellEl);
}

async function loadCommon() {
  const me = await api('GET', '/api/me');
  if (state.me?.id !== me.user.id) { state.me = me.user; loadView(); }
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
  '#/avisos': viewNotifications, '#/reunioes': viewMeetings, '#/painel': viewDashboard, '#/tarefas': viewTasks, '#/recorrentes': viewRecurring, '#/alertas': viewAlerts, '#/clientes': viewClients, '#/modelos': viewTemplates,
  '#/relatorio': viewReport, '#/equipe': viewTeam, '#/config': viewSettings,
};

async function route() {
  if (!state.me) return;
  const key = location.hash.split('?')[0];
  // Link direto para uma tarefa (usado nos e-mails): abre o quadro e o card.
  const deep = /^#\/tarefa\/(\d+)$/.exec(key);
  if (deep) { history.replaceState(null, '', '#/tarefas'); await route(); openTask(Number(deep[1])); return; }
  if (key === '#/avisos' && !isAdmin()) { location.hash = '#/painel'; return; }
  const meeting = /^#\/reuniao\/(\d+)$/.exec(key);
  if (meeting) {
    if (!isStaff()) { location.hash = '#/painel'; return; }
    await guard(() => viewMeeting(Number(meeting[1])))();
    return;
  }
  const fallback = '#/painel';
  const clientPages = ['#/painel', '#/tarefas', '#/recorrentes', '#/alertas', '#/config'];
  const view = ROUTES[key];
  if (!view || (!isStaff() && !clientPages.includes(key))) { location.hash = fallback; return; }
  try { await refreshAlerts(); } catch { /* segue sem o contador */ }
  await guard(view)();
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

// Diz na hora se o cliente vai ver a tarefa nova, para ninguém achar que ela sumiu.
function toastCreated({ kind, client_id, client_visible }) {
  const c = state.clients.find(x => x.id === Number(client_id));
  if (!c) return toast('Tarefa criada');
  if (kind === 'internal' && !client_visible) return toast(`Tarefa criada. É interna: ${c.name} não vê. Para mostrar, marque "visível para o cliente".`, 6000);
  const users = state.users.filter(u => u.role === 'client' && u.client_id === c.id && u.active);
  if (!users.length) return toast(`Tarefa criada. ${c.name} ainda não tem acesso de cliente: cadastre a pessoa em Pessoas para ela ver.`, 7000);
  toast(`Tarefa criada. ${users.map(u => u.name).join(', ')} já ${users.length > 1 ? 'veem' : 'vê'} no portal.`, 5000);
}

// ---------- tarefas: filtros e visões ----------
function taskQuery() {
  const v = state.view;
  const q = { kind: v.kind, client_id: v.client, due: v.due, recurring: v.rec, q: v.q, archived: v.archived ? '1' : '' };
  if (v.assignee === 'me') q.mine = '1'; else q.assignee = v.assignee;
  return new URLSearchParams(Object.entries(q).filter(([, x]) => x));
}

function select(id, label, value, options, onchange) {
  return [h('label', { class: 'sr-only', for: id }, label),
    h('select', { id, onchange: e => onchange(e.target.value) },
      options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)))];
}

let filtersOpen = false;
function tasksToolbar() {
  const v = state.view;
  const set = (k, val) => { v[k] = val; saveView(); route(); };
  const layouts = [['kanban', 'Kanban', 'board'], ['list', 'Lista', 'list'], ['calendar', 'Calendário', 'calendar']];
  const staff = state.users.filter(u => u.role !== 'client' && u.active);
  const active = [v.kind, v.client, v.assignee, v.due, v.rec, v.archived].filter(Boolean).length;
  const filters = h('div', { class: 'filters' + (filtersOpen ? ' open' : ''), id: 'filters' },
    isStaff() ? [
      select('f-kind', 'Tipo', v.kind, [['', 'Internas e externas'], ['external', 'Externas'], ['internal', 'Internas']], x => set('kind', x)),
      select('f-client', 'Empresa', v.client, [['', 'Todas as empresas'], ['org', `${state.org.name} (própria)`], ...state.clients.map(c => [c.id, c.name])], x => set('client', x)),
      select('f-who', 'Responsável', v.assignee, [['', 'Todos os responsáveis'], ['me', 'Só as minhas'], ...staff.map(u => [u.id, u.name])], x => set('assignee', x)),
    ] : null,
    select('f-due', 'Prazo', v.due, [['', 'Qualquer prazo'], ['overdue', 'Atrasadas'], ['today', 'Vencem hoje'], ['week', 'Próximos 7 dias'], ['month', 'Este mês'], ['none', 'Sem prazo']], x => set('due', x)),
    select('f-rec', 'Repetição', v.rec, [['', 'Recorrentes e únicas'], ['1', 'Só recorrentes'], ['0', 'Só únicas']], x => set('rec', x)),
    v.layout === 'list' ? select('f-group', 'Agrupar por', v.group, [['column', 'Agrupar por situação'], ...(isStaff() ? [['client', 'Agrupar por empresa'], ['assignee', 'Agrupar por responsável']] : []), ['due', 'Agrupar por prazo'], ...(isStaff() ? [['kind', 'Agrupar por tipo']] : [])], x => set('group', x)) : null,
    isStaff() ? h('label', { class: 'check inline', for: 'f-arch' }, h('input', { type: 'checkbox', id: 'f-arch', checked: v.archived, onchange: e => { v.archived = e.target.checked; route(); } }), 'Ver arquivadas') : null);
  return h('div', { class: 'toolbar' },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Visualização' },
      layouts.map(([k, l, ic]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(v.layout === k), onclick: () => set('layout', k) }, icon(ic), l))),
    h('div', { class: 'search' }, icon('search'), h('label', { class: 'sr-only', for: 'f-q' }, 'Buscar'),
      h('input', { id: 'f-q', type: 'search', placeholder: 'Buscar tarefa', value: v.q, onchange: e => { v.q = e.target.value; route(); } })),
    h('button', { class: 'btn filters-toggle', type: 'button', 'aria-expanded': String(filtersOpen), 'aria-controls': 'filters',
      onclick: e => { filtersOpen = !filtersOpen; filters.classList.toggle('open', filtersOpen); e.currentTarget.setAttribute('aria-expanded', String(filtersOpen)); } },
      icon('filter'), active ? `Filtros (${active})` : 'Filtros'),
    filters);
}

// Indicadores do que está na tela (respeitam os filtros).
function kpis(tasks) {
  const open = tasks.filter(t => !['done', 'cancelled'].includes(t.status));
  const overdue = tasks.filter(t => t.column === 'overdue').length;
  const soon = open.filter(t => t.due_date && t.due_date >= today() && t.due_date <= S.addDays(today(), 7)).length;
  const onTime = tasks.filter(t => t.column === 'done_on_time').length, late = tasks.filter(t => t.column === 'done_late').length;
  const kpi = (label, value, cls = '') => h('div', { class: 'kpi ' + cls }, h('span', { class: 'kpi-label' }, label), h('span', { class: 'kpi-value' }, value));
  return h('div', { class: 'kpis' },
    kpi('Em aberto', open.length),
    kpi('Atrasadas', overdue, overdue ? 'alert' : ''),
    kpi('Vencem em 7 dias', soon),
    kpi('Concluídas no prazo', onTime + late ? `${Math.round((onTime / (onTime + late)) * 100)}%` : '–', onTime + late ? 'good' : ''));
}

async function viewTasks() {
  if (!isStaff()) Object.assign(state.view, { kind: '', client: '', assignee: '', archived: false });
  const tasks = await api('GET', '/api/tasks?' + taskQuery());
  const v = state.view;
  const body = v.layout === 'list' ? listView(tasks) : v.layout === 'calendar' ? calendarView(tasks) : kanbanView(tasks);
  const waiting = isStaff() ? [] : tasks.filter(t => t.status === 'review');
  shell([
    waiting.length ? h('div', { class: 'card-box waiting-box' }, h('strong', {}, `${waiting.length} entrega${waiting.length > 1 ? 's' : ''} esperando sua revisão: `),
      waiting.map((t, i) => [i ? ', ' : '', h('button', { class: 'link', type: 'button', onclick: () => openTask(t.id) }, t.title)])) : null,
    v.archived ? null : kpis(tasks),
    tasksToolbar(), v.archived ? h('p', { class: 'muted' }, 'Mostrando só as tarefas arquivadas.') : null, body]);
}

function kanbanView(tasks) {
  const board = h('div', { class: 'board' });
  for (const c of S.COLUMNS) {
    const list = tasks.filter(t => t.column === c.key);
    const col = h('section', { class: `col col-${c.key}`, 'aria-label': c.name, 'data-col': c.key },
      h('div', { class: 'col-head' }, h('span', {}, c.name), h('span', { class: 'count' }, list.length)),
      c.key === 'overdue' ? h('p', { class: 'col-note' }, 'Entra sozinha quando o prazo passa') : null,
      list.length ? list.map(t => taskCard(t, { draggable: !state.view.archived && (isStaff() || !['done', 'cancelled'].includes(t.status)) })) : h('p', { class: 'empty' }, 'Nada aqui'));
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
    if (!isStaff() && key === 'cancelled') { toast('Só a equipe cancela tarefas. Se for o caso, escreva nos comentários.'); return; }
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
    const nt = await api('PATCH', `/api/tasks/${taskId}`, isStaff() ? { status: key, position } : { status: key });
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
        h('td', { 'data-label': 'Empresa' }, h('span', { class: 'with-logo' }, taskLogo(t), where(t)), internalTag(t)),
        h('td', { 'data-label': 'Responsáveis' }, t.assignees.map(a => a.name).join(', ') || '–'),
        h('td', { class: 'num', 'data-label': 'Início' }, fmtDate(t.start_date) || '–'),
        h('td', { class: 'num', 'data-label': 'Prazo' }, fmtDate(t.due_date) || '–'),
        h('td', { 'data-label': 'Situação' }, h('span', { class: `pill col-${t.column}` }, colName(t.column))),
        h('td', { 'data-label': 'Execução' }, progressBar(t.progress)))))))));
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

// ---------- painel (dashboard) ----------
// Tudo calculado das tarefas que a pessoa pode ver, então cada visão tem o próprio painel.
const dash = { period: 30, client: '' };
let tipEl = null;
// Dica ao passar o mouse (ou tocar) em barras e linhas do painel: lê data-tip.
function wireTips(root) {
  if (!tipEl) { tipEl = h('div', { class: 'chart-tip', role: 'tooltip', hidden: true }); document.body.append(tipEl); }
  const show = (el, x, y) => {
    tipEl.textContent = el.dataset.tip; tipEl.hidden = false;
    const w = tipEl.offsetWidth, ht = tipEl.offsetHeight;
    tipEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px';
    tipEl.style.top = Math.max(8, y - ht - 12) + 'px';
  };
  root.addEventListener('pointermove', e => { const el = e.target.closest('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else tipEl.hidden = true; });
  root.addEventListener('pointerleave', () => { tipEl.hidden = true; });
  root.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); } });
  root.addEventListener('focusout', () => { tipEl.hidden = true; });
}
const fmtNum = n => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const pctText = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');

// Barras horizontais: rótulo, barra (uma cor, ou a cor da situação), valor na ponta.
function hbars(rows, { colorOf, unit = '' } = {}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  if (!rows.length) return h('p', { class: 'empty' }, 'Sem dados no período.');
  return h('div', { class: 'hbars' }, rows.map(r => h('div', { class: 'hbar', tabindex: '0', 'data-tip': r.tip || `${r.label}: ${fmtNum(r.value)}${unit}` },
    h('span', { class: 'hbar-label' }, r.icon || null, h('span', {}, r.label)),
    h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill' + (colorOf ? ` col-${colorOf(r)}` : ''), style: `width:${(r.value / max) * 100}%` })),
    h('span', { class: 'hbar-value' }, fmtNum(r.value) + unit))));
}
// Colunas por semana: uma série, valor no topo de cada coluna.
function columns(rows) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return h('div', { class: 'cols-chart' }, rows.map(r => h('div', { class: 'colc', tabindex: '0', 'data-tip': r.tip },
    h('span', { class: 'colc-value' }, r.value || ''),
    h('span', { class: 'colc-bar', style: `height:${Math.max(r.value ? 4 : 0, (r.value / max) * 100)}%` }),
    h('span', { class: 'colc-label' }, r.label))));
}
const greet = () => { const hr = new Date().getHours(); return hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite'; };
function weekStart(iso) { const d = new Date(iso + 'T12:00'); const dow = (d.getDay() + 6) % 7; return S.addDays(iso, -dow); }

async function viewDashboard() {
  const all = (await api('GET', '/api/tasks')).filter(t => !dash.client || String(t.client_id ?? 'org') === dash.client);
  const now = today();
  const since = S.addDays(now, -dash.period);
  const open = all.filter(t => !['done', 'cancelled'].includes(t.status));
  const done = all.filter(t => t.status === 'done' && t.completed_on >= since);
  const onTime = done.filter(t => t.column === 'done_on_time').length;
  const cancelled = all.filter(t => t.status === 'cancelled' && t.cancelled_on >= since).length;
  const withStart = done.filter(t => t.start_date);
  const avgDays = withStart.length ? withStart.reduce((n, t) => n + Math.max(0, S.daysBetween(t.start_date, t.completed_on)), 0) / withStart.length : null;
  const weekDone = all.filter(t => t.status === 'done' && t.completed_on >= weekStart(now)).length;
  const overdue = all.filter(t => t.column === 'overdue');
  const dueToday = open.filter(t => t.due_date === now).length;
  const next7 = open.filter(t => t.due_date > now && t.due_date <= S.addDays(now, 7)).length;

  const chip = (ic, label, value, sub, cls = '') => h('div', { class: 'hchip ' + cls }, h('span', { class: 'hchip-icon' }, icon(ic)),
    h('div', {}, h('div', { class: 'hchip-label' }, label), h('div', { class: 'hchip-value' }, value), h('div', { class: 'hchip-sub' }, sub)));
  const stat = (label, value, sub, cls = '') => h('div', { class: 'stat ' + cls }, h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label), sub ? h('div', { class: 'stat-sub' }, sub) : null);

  // Concluídas por semana, últimas 8 semanas.
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const start = S.addDays(weekStart(now), -7 * i);
    const end = S.addDays(start, 6);
    const n = all.filter(t => t.status === 'done' && t.completed_on >= start && t.completed_on <= end).length;
    weeks.push({ label: fmtShort(start), value: n, tip: `Semana de ${fmtDate(start)}: ${n} concluída${n === 1 ? '' : 's'}` });
  }
  const byStatus = S.COLUMNS.map(c => ({ key: c.key, label: c.name, value: all.filter(t => t.column === c.key && (!['done_on_time', 'done_late', 'cancelled'].includes(c.key) || (t.completed_on || t.cancelled_on) >= since)).length }));

  const filterRow = h('div', { class: 'dash-filters' },
    select('d-period', 'Período', dash.period, [[7, 'Últimos 7 dias'], [30, 'Últimos 30 dias'], [90, 'Últimos 90 dias'], [365, 'Últimos 12 meses']], x => { dash.period = Number(x); route(); }),
    isStaff() ? select('d-client', 'Empresa', dash.client, [['', 'Todas as empresas'], ['org', `${state.org.name} (própria)`], ...state.clients.map(c => [c.id, c.name])], x => { dash.client = x; route(); }) : null);

  const panel = (title, sub, body, extra) => h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('div', {}, h('h2', {}, title), sub ? h('p', { class: 'muted small' }, sub) : null), extra || null), body);

  const people = isStaff() ? state.users.filter(u => u.role !== 'client' && u.active).map(u => {
    const mine = all.filter(t => t.assignees.some(a => a.id === u.id));
    const mineDone = mine.filter(t => t.status === 'done' && t.completed_on >= since);
    return { u, open: mine.filter(t => !['done', 'cancelled'].includes(t.status)).length, late: mine.filter(t => t.column === 'overdue').length,
      done: mineDone.length, onTime: mineDone.filter(t => t.column === 'done_on_time').length };
  }).sort((a, b) => b.late - a.late || b.open - a.open) : [];
  const maxLoad = Math.max(1, ...people.map(p => p.open));

  const companies = isStaff() ? (() => {
    const m = new Map();
    for (const t of open) {
      const key = t.client_id || 'org';
      const r = m.get(key) || { label: where(t), value: 0, late: 0, logo: taskLogo(t, 'xs') };
      r.value++; if (t.column === 'overdue') r.late++;
      m.set(key, r);
    }
    return [...m.values()].sort((a, b) => b.value - a.value).slice(0, 8)
      .map(r => ({ ...r, icon: r.logo, tip: `${r.label}: ${r.value} em aberto, ${r.late} atrasada${r.late === 1 ? '' : 's'}` }));
  })() : [];

  const content = h('div', { class: 'dash' },
    h('div', { class: 'hello' },
      h('div', {}, h('p', { class: 'hello-date' }, (d => d[0].toUpperCase() + d.slice(1))(new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))),
        h('h2', { class: 'hello-title' }, `${greet()}, ${state.me.name.split(' ')[0]}!`)),
      h('div', { class: 'hello-chips' },
        chip('check', 'Executadas', weekDone, 'esta semana', 'good'),
        chip('alert', 'Atrasadas', overdue.length, 'pedem atenção', overdue.length ? 'bad' : ''),
        chip('clock', 'Hoje', dueToday, 'vencendo', dueToday ? 'warn' : ''),
        chip('calendar', 'Próximas', next7, '7 dias'))),
    filterRow,
    h('div', { class: 'dash-grid' },
      panel('Indicador de produtividade', `Concluídas nos últimos ${dash.period} dias`, h('div', { class: 'stats' },
        stat('Concluídas', fmtNum(done.length), null),
        stat('Concluídas no prazo', pctText(onTime, done.length), done.length ? `${onTime} de ${done.length}` : null, done.length ? (onTime / done.length >= 0.8 ? 'good' : 'bad') : ''),
        stat('Tempo médio de execução', avgDays === null ? '–' : `${fmtNum(avgDays)} d`, withStart.length ? 'do início ao término' : 'sem datas de início'),
        stat('Canceladas', fmtNum(cancelled), null))),
      panel('Tarefas por situação', 'Abertas agora; concluídas e canceladas no período',
        hbars(byStatus, { colorOf: r => r.key })),
      panel('Concluídas por semana', 'Últimas 8 semanas', columns(weeks)),
      isStaff() ? panel('Carga do time', 'Em aberto e atrasadas por responsável',
        people.length ? h('div', { class: 'load' }, people.map(p => h('div', { class: 'load-row', tabindex: '0',
          'data-tip': `${p.u.name}: ${p.open} em aberto, ${p.late} atrasada${p.late === 1 ? '' : 's'}, ${p.done} concluída${p.done === 1 ? '' : 's'} no período (${pctText(p.onTime, p.done)} no prazo)` },
          h('span', { class: 'avatar' }, initials(p.u.name)),
          h('span', { class: 'load-name' }, p.u.name),
          h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill', style: `width:${(p.open / maxLoad) * 100}%` })),
          h('span', { class: 'load-nums' }, h('span', { class: p.late ? 'danger' : 'muted' }, `${p.late} atras.`), h('span', {}, `${p.open} em and.`)))))
          : h('p', { class: 'empty' }, 'Ninguém na equipe ainda.')) : null,
      isStaff() ? panel('Em aberto por empresa', 'As 8 com mais tarefas abertas', hbars(companies)) : null,
      overdue.length ? panel('Atrasadas', 'Da mais antiga para a mais recente', h('div', {},
        overdue.sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 6).map(t => h('button', { class: 'alert-row', type: 'button', onclick: () => openTask(t.id) },
          taskLogo(t), h('span', { class: 'grow' }, h('strong', {}, t.title), h('span', { class: 'muted small' }, ` · ${where(t)}`)),
          h('span', { class: 'tag late' }, S.alertText(t.alert)))))) : null));
  shell(content, { title: 'Dashboard' });
  wireTips(document.querySelector('.dash'));
}

// ---------- recorrentes ----------
const recView = { history: false };
async function viewRecurring() {
  const tasks = await api('GET', '/api/tasks?recurring=1');
  const shown = recView.history ? tasks : tasks.filter(t => !['done', 'cancelled'].includes(t.status));
  const order = Object.keys(S.RECURRENCE);
  const groups = order.filter(k => k !== 'none').map(k => ({ k, items: shown.filter(t => t.recurrence === k) })).filter(g => g.items.length);
  const freq = t => S.RECURRENCE[t.recurrence].replace(/ \(.*/, '') + (t.recurrence === 'custom' ? ` (a cada ${t.recurrence_every} dias)` : '');
  shell([
    h('div', { class: 'toolbar' },
      h('p', { class: 'muted', style: 'margin:0;flex:1;min-width:220px' }, 'Lance aqui o que se repete. Cada linha é a repetição atual; ao concluir, a próxima é criada com o prazo avançado.'),
      h('label', { class: 'check inline', for: 'r-hist' }, h('input', { type: 'checkbox', id: 'r-hist', checked: recView.history, onchange: e => { recView.history = e.target.checked; route(); } }), 'Mostrar concluídas e canceladas')),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Recorrentes em aberto'), h('span', { class: 'kpi-value' }, tasks.filter(t => !['done', 'cancelled'].includes(t.status)).length)),
      h('div', { class: 'kpi ' + (tasks.some(t => t.column === 'overdue') ? 'alert' : '') }, h('span', { class: 'kpi-label' }, 'Atrasadas'), h('span', { class: 'kpi-value' }, tasks.filter(t => t.column === 'overdue').length)),
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Vencem em 7 dias'), h('span', { class: 'kpi-value' }, tasks.filter(t => !['done', 'cancelled'].includes(t.status) && t.due_date && t.due_date >= today() && t.due_date <= S.addDays(today(), 7)).length)),
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Frequências em uso'), h('span', { class: 'kpi-value' }, new Set(tasks.map(t => t.recurrence)).size))),
    groups.length ? groups.map(g => h('div', { class: 'card-box' },
      h('h2', {}, h('span', { class: 'with-logo' }, icon('repeat'), `${S.RECURRENCE[g.k].replace(/ \(.*/, '')} (${g.items.length})`)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'tasks' },
        h('thead', {}, h('tr', {}, ['Tarefa', 'Empresa', 'Frequência', 'Responsáveis', 'Próximo prazo', 'Situação', 'Execução'].map(x => h('th', {}, x)))),
        h('tbody', {}, g.items.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999')).map(t => h('tr', { class: 'row-link', onclick: () => openTask(t.id) },
          h('td', {}, h('button', { class: 'link', type: 'button', onclick: e => { e.stopPropagation(); openTask(t.id); } }, t.title),
            t.alert ? h('div', { class: 'small ' + (t.alert.kind === 'overdue' ? 'danger' : 'warn') }, '⏰ ' + S.alertText(t.alert)) : null),
          h('td', { 'data-label': 'Empresa' }, h('span', { class: 'with-logo' }, taskLogo(t), where(t)), internalTag(t)),
          h('td', { 'data-label': 'Frequência' }, freq(t)),
          h('td', { 'data-label': 'Responsáveis' }, t.assignees.map(a => a.name).join(', ') || '–'),
          h('td', { class: 'num', 'data-label': 'Próximo prazo' }, fmtDate(t.due_date) || '–'),
          h('td', { 'data-label': 'Situação' }, h('span', { class: `pill col-${t.column}` }, colName(t.column))),
          h('td', { 'data-label': 'Execução' }, progressBar(t.progress)))))))))
      : h('div', { class: 'card-box empty' }, isStaff() ? 'Nenhuma tarefa recorrente ainda. Use "Nova recorrente" para lançar a primeira.' : 'Nenhuma tarefa recorrente.'),
  ], { title: 'Recorrentes' });
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
function askChoice(message, options) {
  return new Promise(resolve => {
    modal(close => h('div', {},
      h('p', { class: 'confirm-text' }, message),
      h('div', { class: 'choice-list' }, options.map(([value, label, sub]) =>
        h('button', { class: 'btn', type: 'button', onclick: () => { resolve(value); close(); } }, h('strong', {}, label), sub ? h('span', { class: 'muted small' }, sub) : null))),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancelar'))),
    { onclose: () => resolve(null) });
  });
}
window.askConfirm = ask;
window.askChoice = askChoice;

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
    const seen = kind === 'external' || (internalWithClient && vis.checked);
    const c = state.clients.find(x => x.id === Number(clientSel.value));
    const noAccess = seen && c && state.users && !state.users.some(u => u.role === 'client' && u.client_id === c.id && u.active);
    hint.textContent = (kind === 'external'
      ? 'Externa: a equipe toda vê, e o cliente vê no portal dele.'
      : internalWithClient && vis.checked
        ? 'Interna visível: o cliente vê; da equipe, só quem criou e os responsáveis.'
        : 'Interna: só quem criou e os responsáveis veem. O cliente não vê.') +
      (noAccess ? ` Atenção: ${c.name} ainda não tem acesso de cliente; cadastre a pessoa em Pessoas.` : '');
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
function recurrenceFields(prefix, rec = 'none', every = '', { required = false } = {}) {
  const n = h('input', { id: `${prefix}-every`, type: 'number', min: 1, max: 3650, value: every || 30, style: 'width:90px' });
  const wrap = h('span', { class: 'row', hidden: rec !== 'custom' }, 'a cada', n, 'dias');
  const sel = h('select', { id: `${prefix}-rec`, onchange: () => { wrap.hidden = sel.value !== 'custom'; } },
    Object.entries(S.RECURRENCE).filter(([v]) => !required || v !== 'none').map(([v, l]) => h('option', { value: v, selected: v === rec }, l)));
  return {
    el: h('div', { class: 'field' }, h('label', { for: `${prefix}-rec` }, 'Repetição'), h('div', { class: 'row' }, h('div', { class: 'grow' }, sel), wrap)),
    sel, n, value: () => ({ recurrence: sel.value, recurrence_every: sel.value === 'custom' ? Number(n.value) : null }),
  };
}

function newTaskModal({ recurring = false } = {}) {
  modal(close => {
    const err = h('p', { class: 'error', role: 'alert' });
    const kc = kindClientFields('n', state.clients.length ? 'external' : 'internal', state.view.client && state.view.client !== 'org' ? Number(state.view.client) : null, false);
    const rec = recurrenceFields('n', recurring ? 'monthly' : 'none', '', { required: recurring });
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
        close(); toastCreated(kc.value()); await route(); openTask(id);
      } catch (ex) { err.textContent = ex.message; }
    } },
      h('h2', {}, recurring ? 'Nova tarefa recorrente' : 'Nova tarefa'),
      recurring ? h('p', { class: 'muted small', style: 'margin-top:-4px' }, 'Lance uma vez: ao concluir cada repetição, a próxima é criada com o prazo avançado.') : null,
      kc.el,
      recurring ? rec.el : null,
      h('div', { class: 'field' }, h('label', { for: 'n-tpl' }, 'Modelo (opcional)'), tplSel),
      h('div', { class: 'field' }, h('label', { for: 'n-title' }, 'Título'), h('input', { id: 'n-title', name: 'title', maxlength: 200, placeholder: 'Se vazio, usa o título do modelo' })),
      h('div', { class: 'field' }, h('label', { for: 'n-desc' }, 'Descrição'), h('textarea', { id: 'n-desc', name: 'description' })),
      ck.el,
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'n-due' }, 'Prazo'), h('input', { id: 'n-due', name: 'due_date', type: 'date' })),
        h('div', { class: 'field' }, h('label', { for: 'n-pri' }, 'Prioridade'),
          h('select', { id: 'n-pri', name: 'priority' }, Object.entries(PRIORITY).map(([v, l]) => h('option', { value: v, selected: v === 'normal' }, l))))),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Alertas do prazo'), alertChecks([1])),
      recurring ? null : rec.el,
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Responsáveis'), assigneeChecks([state.me.id])),
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Criar tarefa'),
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar')));
  });
}

// ---------- detalhe da tarefa ----------
// As alterações ficam num rascunho até clicar em Salvar. Sair com alterações pendentes pede confirmação.
// Comentários, ajustes, concluir, cancelar e arquivar são ações com botão próprio.
let drawerClose = null;
let drawerOverlay = null;
async function openTask(id) {
  let t = await api('GET', `/api/tasks/${id}`).catch(e => { toast(e.message); return null; });
  if (!t) return;
  if (drawerClose && document.body.contains(drawerOverlay) && !(await drawerClose(false))) return;
  const staff = isStaff();
  let changedOnServer = false;
  let draft = {};
  let ck = { done: new Map(), added: [], removed: new Set() };
  const dirty = () => Object.keys(draft).length > 0 || ck.done.size > 0 || ck.added.length > 0 || ck.removed.size > 0;
  const val = k => (k in draft ? draft[k] : t[k]);
  const saved = k => (k === 'assignee_ids' ? t.assignees.map(a => a.id).sort((a, b) => a - b) : t[k]);
  const set = (k, v, repaint = false) => {
    const cmp = Array.isArray(v) ? [...v].sort((a, b) => a - b) : v;
    if (JSON.stringify(cmp) === JSON.stringify(saved(k))) delete draft[k]; else draft[k] = v;
    // Informar o início de uma tarefa a fazer já a coloca em andamento.
    if (k === 'start_date' && v && t.status === 'todo' && !('status' in draft)) draft.status = 'doing';
    if (k === 'start_date' && !v && draft.status === 'doing' && t.status === 'todo') delete draft.status;
    // E o contrário: sair de "A fazer" sem início preenche o início com hoje (o servidor faz o mesmo ao salvar).
    if (k === 'status' && v !== 'todo' && !t.start_date && !draft.start_date) draft.start_date = today();
    if (k === 'status' && v === 'todo' && !t.start_date) delete draft.start_date;
    repaint ? paint() : markDirty();
  };
  const terminal = ['done', 'cancelled'].includes(t.status);
  const canEditProgress = () => staff || !terminal;

  const overlay = h('div', { class: 'overlay', onclick: e => { if (e.target === overlay) close(); } });
  drawerOverlay = overlay;
  const esc = e => { if (e.key === 'Escape' && !document.querySelector('.overlay.center')) close(); };
  async function close(refresh = true) {
    if (dirty() && !(await ask('Sair sem salvar? As alterações feitas neste card serão perdidas.', { ok: 'Sair sem salvar', danger: true }))) return false;
    overlay.remove(); document.removeEventListener('keydown', esc); drawerClose = null;
    if (refresh && changedOnServer) route();
    return true;
  }
  drawerClose = close;
  document.addEventListener('keydown', esc);
  const body = h('div', { class: 'drawer-body' });
  const saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => save() }, 'Salvar');
  const dirtyNote = h('span', { class: 'muted small', role: 'status' });
  const drawer = h('div', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': t.title, tabindex: '-1' },
    body,
    h('div', { class: 'drawer-foot' }, saveBtn, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Sair'), dirtyNote));
  overlay.append(drawer);
  document.body.append(overlay);

  function markDirty() {
    saveBtn.disabled = !dirty();
    dirtyNote.textContent = dirty() ? 'Alterações não salvas' : '';
  }

  async function save() {
    if (!dirty()) return true;
    saveBtn.disabled = true;
    try {
      if (Object.keys(draft).length) await api('PATCH', `/api/tasks/${t.id}`, draft);
      for (const [itemId, done] of ck.done) if (!ck.removed.has(itemId)) await api('PATCH', `/api/checklist/${itemId}`, { done });
      for (const itemId of ck.removed) await api('DELETE', `/api/checklist/${itemId}`);
      for (const text of ck.added) await api('POST', `/api/tasks/${t.id}/checklist`, { text });
      draft = {}; ck = { done: new Map(), added: [], removed: new Set() };
      changedOnServer = true;
      t = await api('GET', `/api/tasks/${t.id}`);
      paint(); toast('Salvo');
      return true;
    } catch (e) {
      // Recarrega o que já foi gravado; o rascunho continua para corrigir e salvar de novo.
      toast(e.message);
      try { t = await api('GET', `/api/tasks/${t.id}`); } catch { /* segue com o que tinha */ }
      paint();
      return false;
    }
  }
  // Ações que mudam a tarefa no servidor: salvam o rascunho antes.
  const act = guard(async (method, path, payload) => {
    if (dirty() && !(await save())) return;
    t = await api(method, path, payload); changedOnServer = true; paint();
  });
  const withSaved = fn => async () => { if (!dirty() || await save()) fn(); };
  const afterDialog = nt => { t = nt; changedOnServer = true; paint(); };

  // Checklist efetivo (o que está salvo, com as marcações e itens do rascunho).
  function checklistNow() {
    return t.checklist.filter(i => !ck.removed.has(i.id)).map(i => ({ ...i, done: ck.done.has(i.id) ? (ck.done.get(i.id) ? 1 : 0) : i.done }))
      .concat(ck.added.map((text, n) => ({ id: `new-${n}`, text, done: 0, isNew: true })));
  }
  function progressNow() {
    const list = checklistNow();
    if (val('status') === 'done') return 100;
    if (list.length) return Math.round((list.filter(i => i.done).length / list.length) * 100);
    return Number(val('progress')) || 0;
  }

  function field(label, control, forId, extra) {
    return h('div', { class: 'field' }, forId ? h('label', { for: forId }, label) : h('span', { class: 'label' }, label), control, extra);
  }

  function paint() {
    const scroll = drawer.scrollTop;
    const status = val('status');
    body.replaceChildren(...[
      h('div', { class: 'drawer-head' }, taskLogo(t, 'md'),
        staff ? h('input', { id: 'd-title', 'aria-label': 'Nome da tarefa', class: 'title-input', value: val('title'), maxlength: 200, oninput: e => set('title', e.target.value) })
          : h('h1', { class: 'grow' }, t.title)),
      h('p', { class: 'meta' }, h('span', { class: `pill col-${t.column}` }, colName(t.column)), internalTag(t),
        t.alert ? h('span', { class: 'tag ' + (t.alert.kind === 'overdue' ? 'late' : 'warn') }, '⏰ ' + S.alertText(t.alert)) : null,
        t.recurrence !== 'none' ? h('span', { class: 'tag' }, '↻ ' + S.RECURRENCE[t.recurrence]) : null,
        t.archived_at ? h('span', { class: 'tag' }, 'Arquivada') : null),

      !staff && t.status === 'review' ? clientDecision() : null,
      statusRow(status),

      // Principais, na ordem pedida.
      h('div', { class: 'card-box main-fields' },
        staff ? kindClientFields('d', val('kind'), val('client_id'), val('client_visible'), v => {
          set('kind', v.kind); set('client_id', v.client_id); set('client_visible', v.client_visible);
        }).el : field('Empresa', h('p', { class: 'with-logo' }, taskLogo(t), where(t))),
        field('Data de início (quando começou)', canEditProgress()
          ? h('input', { id: 'd-start', type: 'date', value: val('start_date') || '', onchange: e => set('start_date', e.target.value || null, true) })
          : h('p', {}, fmtDate(t.start_date) || '–'), 'd-start',
          t.status === 'todo' && canEditProgress() ? h('p', { class: 'muted small' }, 'Ao informar o início, a tarefa vai para Em andamento.') : null),
        checklistField(),
        progressField(status),
        h('div', { class: 'grid2' },
          field('Prazo', staff ? h('input', { id: 'd-due', type: 'date', value: val('due_date') || '', onchange: e => set('due_date', e.target.value || null) })
            : h('p', {}, fmtDate(t.due_date) || 'Sem prazo'), 'd-due'),
          field('Prioridade', staff ? h('select', { id: 'd-pri', onchange: e => set('priority', e.target.value) },
            Object.entries(PRIORITY).map(([v, l]) => h('option', { value: v, selected: v === val('priority') }, l)))
            : h('p', {}, PRIORITY[t.priority]), 'd-pri')),
        field('Responsáveis', staff ? (() => {
          const g = assigneeChecks(val('assignee_ids') || t.assignees.map(a => a.id));
          g.addEventListener('change', () => set('assignee_ids', [...g.querySelectorAll('input:checked')].map(i => Number(i.value))));
          return g;
        })() : h('p', {}, t.assignees.map(a => a.name).join(', ') || '–'))),

      // O restante.
      h('div', { class: 'section' },
        field('Descrição', staff ? h('textarea', { id: 'd-desc', rows: 4, oninput: e => set('description', e.target.value) }, val('description'))
          : h('p', { class: 'pre' }, t.description || '–'), 'd-desc'),
        staff ? alertsField() : (t.alerts.length ? field('Alertas do prazo', h('p', {}, S.ALERTS.filter(a => t.alerts.includes(a.days)).map(a => a.label).join(', '))) : null),
        staff ? recurrenceField() : (t.recurrence !== 'none' ? field('Repetição', h('p', {}, S.RECURRENCE[t.recurrence] + (t.recurrence === 'custom' ? ` (a cada ${t.recurrence_every} dias)` : ''))) : null)),
      adjustmentsSection(),
      commentsSection(),
      staff ? h('div', { class: 'section row' },
        h('button', { class: 'btn', onclick: () => act('POST', `/api/tasks/${t.id}/archive`, { archived: !t.archived_at }) }, t.archived_at ? 'Desarquivar' : 'Arquivar'),
        isAdmin() ? h('button', { class: 'btn danger', onclick: guard(async () => {
          if (!(await ask('Apagar esta tarefa? Isso não pode ser desfeito. Para só tirar da frente, use Arquivar.', { ok: 'Apagar tarefa', danger: true }))) return;
          await api('DELETE', `/api/tasks/${t.id}`); changedOnServer = true; draft = {}; ck = { done: new Map(), added: [], removed: new Set() };
          close(); toast('Tarefa apagada');
        }) }, 'Apagar') : null) : null,
    ].filter(Boolean));
    drawer.scrollTop = scroll;
    markDirty();
  }

  function statusRow(status) {
    if (t.status === 'cancelled') {
      return h('div', { class: 'card-box cancel-box' },
        h('p', {}, h('strong', {}, `Cancelada em ${fmtDate(t.cancelled_on)}`)),
        h('p', { class: 'pre' }, 'Motivo: ', t.cancel_reason),
        staff ? h('button', { class: 'btn small', onclick: () => act('PATCH', `/api/tasks/${t.id}`, { status: 'todo' }) }, 'Reabrir') : null);
    }
    if (t.status === 'done') {
      return h('div', { class: 'card-box done-box' },
        h('p', {}, h('strong', {}, `Concluída em ${fmtDate(t.completed_on)}`), t.due_date ? ` · prazo era ${fmtDate(t.due_date)}` : ''),
        t.next_task_id ? h('p', { class: 'muted small' }, 'A próxima repetição já foi criada.') : null,
        staff ? h('button', { class: 'btn small', onclick: () => act('PATCH', `/api/tasks/${t.id}`, { status: 'doing' }) }, 'Reabrir') : null);
    }
    return h('div', { class: 'status-row' },
      h('div', { class: 'grow' }, h('label', { for: 'd-status' }, 'Situação'),
        h('select', { id: 'd-status', onchange: e => set('status', e.target.value, true) },
          ['todo', 'doing', 'review'].map(x => h('option', { value: x, selected: x === status }, S.STATUS_LABEL[x])))),
      h('button', { class: 'btn primary', type: 'button', onclick: withSaved(() => completeDialog(t, afterDialog)) }, 'Concluir…'),
      staff ? h('button', { class: 'btn', type: 'button', onclick: withSaved(() => cancelDialog(t, afterDialog)) }, 'Cancelar…') : null,
      t.column === 'overdue' ? h('p', { class: 'small danger full' }, 'Está em Atrasada porque o prazo passou. Ajuste o prazo ou conclua para tirar daqui.') : null);
  }

  function checklistField() {
    const list = checklistNow();
    if (!staff && !list.length) return null;
    const done = list.filter(i => i.done).length;
    const input = h('input', { 'aria-label': 'Novo item do checklist', placeholder: 'Adicionar item', maxlength: 300 });
    const add = () => { const v = input.value.trim(); if (v) { ck.added.push(v); paint(); document.querySelector('.ck-add input')?.focus(); } };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return field(`Checklist ${list.length ? `(${done}/${list.length})` : ''}`, h('div', {},
      list.map(i => h('div', { class: 'check' },
        h('input', { type: 'checkbox', id: `ck-${i.id}`, checked: !!i.done, disabled: i.isNew || !canEditProgress(),
          onchange: e => { const orig = t.checklist.find(x => x.id === i.id); if (!!orig.done === e.target.checked) ck.done.delete(i.id); else ck.done.set(i.id, e.target.checked); paint(); } }),
        h('label', { for: `ck-${i.id}`, class: (i.done ? 'done ' : '') + 'ck-text' }, i.text, i.isNew ? h('span', { class: 'muted small' }, ' (novo, salve para marcar)') : null),
        staff ? h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Remover ${i.text}`, onclick: () => {
          if (i.isNew) ck.added.splice(Number(String(i.id).slice(4)), 1); else ck.removed.add(i.id);
          paint();
        } }, '✕') : null)),
      staff ? h('div', { class: 'row ck-add' }, h('div', { class: 'grow' }, input), h('button', { class: 'btn', type: 'button', onclick: add }, 'Adicionar')) : null));
  }

  function progressField(status) {
    const pct = progressNow();
    const fromChecklist = checklistNow().length > 0;
    const editable = canEditProgress() && !fromChecklist && status === 'doing';
    const num = h('input', { type: 'number', min: 0, max: 100, value: pct, 'aria-label': '% de execução', class: 'pct-input', disabled: !editable,
      onchange: e => { const n = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))); range.value = n; set('progress', n); } });
    const range = h('input', { id: 'd-pct', type: 'range', min: 0, max: 100, step: 5, value: pct, disabled: !editable,
      oninput: e => { num.value = e.target.value; set('progress', Number(e.target.value)); } });
    return field('% de execução', h('div', { class: 'row' }, h('div', { class: 'grow' }, range), num, '%'), 'd-pct',
      h('p', { class: 'muted small' }, fromChecklist ? 'Calculado pelo checklist: muda conforme os itens são marcados.'
        : status === 'doing' ? 'Informe quanto já foi feito.' : 'Disponível quando a tarefa está Em andamento.'));
  }

  function alertsField() {
    const al = alertChecks(val('alerts'));
    al.addEventListener('change', () => set('alerts', [...al.querySelectorAll('input:checked')].map(i => Number(i.value))));
    return field('Alertas do prazo', al);
  }
  function recurrenceField() {
    const rec = recurrenceFields('d', val('recurrence'), val('recurrence_every'));
    const upd = () => { const v = rec.value(); set('recurrence', v.recurrence); set('recurrence_every', v.recurrence_every); };
    rec.sel.addEventListener('change', upd);
    rec.n.addEventListener('change', upd);
    return rec.el;
  }

  function clientDecision() {
    const ta = h('textarea', { id: 'c-adj', placeholder: 'O que precisa mudar?' });
    return h('div', { class: 'card-box waiting-box' },
      h('h2', {}, 'Esta entrega está esperando sua revisão'),
      h('p', { class: 'muted' }, 'Aprove, ou diga o que ajustar e a equipe recebe na hora.'),
      h('div', { class: 'row', style: 'margin-bottom:12px' },
        h('button', { class: 'btn primary', onclick: () => act('POST', `/api/tasks/${t.id}/approve`) }, 'Aprovar entrega')),
      h('label', { for: 'c-adj' }, 'Pedir ajuste'), ta,
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { class: 'btn', onclick: () => { if (!ta.value.trim()) { ta.focus(); return; } act('POST', `/api/tasks/${t.id}/adjustments`, { body: ta.value }); } }, 'Enviar pedido de ajuste')));
  }

  function adjustmentsSection() {
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

  function commentsSection() {
    const ta = h('textarea', { id: 'cm-body', placeholder: staff ? 'Escreva um comentário' : 'Escreva para a equipe' });
    const vis = h('input', { type: 'checkbox', id: 'cm-vis' });
    return h('div', { class: 'section' },
      h('h2', {}, 'Comentários'),
      t.comments.length ? t.comments.map(c => h('div', { class: 'comment' },
        h('div', { class: 'meta' }, h('span', { class: 'by' }, c.author || 'Cliente'), fmtDateTime(c.created_at),
          staff && t.client_visible ? h('span', { class: 'tag' + (c.visible_to_client ? ' ok' : '') }, c.visible_to_client ? 'cliente vê' : 'só equipe') : null),
        h('div', { class: 'body' }, c.body))) : h('p', { class: 'muted' }, 'Sem comentários.'),
      h('div', { style: 'margin-top:8px' },
        h('label', { for: 'cm-body', class: 'sr-only' }, 'Comentário'), ta,
        h('div', { class: 'row', style: 'margin-top:8px' },
          h('button', { class: 'btn', type: 'button', onclick: () => { if (ta.value.trim()) act('POST', `/api/tasks/${t.id}/comments`, { body: ta.value, visible_to_client: vis.checked }); } }, 'Enviar comentário'),
          staff && t.client_visible ? h('label', { for: 'cm-vis', class: 'check inline' }, vis, 'Visível para o cliente') : null)));
  }

  paint();
  // Foco no card, não num campo: no celular não abre o teclado sozinho.
  drawer.focus({ preventScroll: true });
}

// ---------- clientes ----------
async function viewClients() {
  document.title = 'Clientes';
  state.clients = await api('GET', '/api/clients');
  let newLogo = null;
  const preview = h('span', {});
  shell([
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

// ---------- reuniões: ata em PDF, triagem e OK ----------
const readFileData = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Não deu para ler o arquivo'));
  reader.readAsDataURL(file);
});
const MEETING_STATUS = m => m.status === 'processing' ? ['Lendo a ata…', 'warn']
  : m.status === 'error' ? ['Precisa de atenção', 'late']
  : m.pending ? [`${m.pending} para revisar`, 'warn'] : ['Revisada', 'ok'];

function attendeePicker(prefix, clientId, selected = []) {
  const box = h('div', {});
  const paint = cid => {
    const keep = [...box.querySelectorAll('input:checked')].map(i => Number(i.value));
    const sel = new Set([...selected, ...keep]);
    const staff = staffUsers();
    const clients = state.users.filter(u => u.role === 'client' && u.active && (!cid || u.client_id === Number(cid)));
    const group = (label, users) => users.length ? h('div', { class: 'field' }, h('span', { class: 'label' }, label),
      h('div', { class: 'checks', role: 'group', 'aria-label': label },
        users.map(u => h('label', {}, h('input', { type: 'checkbox', name: `${prefix}-who`, value: u.id, checked: sel.has(u.id) }), u.name,
          !cid && u.client_name ? h('span', { class: 'muted small' }, ` (${u.client_name})`) : null)))) : null;
    box.replaceChildren(group('Equipe Opps', staff), group(cid ? 'Do cliente' : 'Clientes', clients) ||
      (cid ? h('p', { class: 'muted small' }, 'Esta empresa ainda não tem acesso de cliente cadastrado; quem esteve presente pode ir em "Outros participantes".') : null));
  };
  paint(clientId);
  return { el: box, repaint: paint, value: () => [...box.querySelectorAll('input:checked')].map(i => Number(i.value)) };
}

async function viewMeetings() {
  const list = await api('GET', '/api/meetings');
  const err = h('p', { class: 'error', role: 'alert' });
  const clientSel = h('select', { id: 'm-client', name: 'client_id' }, h('option', { value: '' }, `${state.org.name} (reunião interna)`),
    state.clients.map(c => h('option', { value: c.id }, c.name)));
  const who = attendeePicker('m', '');
  clientSel.addEventListener('change', () => who.repaint(clientSel.value));
  const fileInfo = h('span', { class: 'muted small' }, 'Nenhum arquivo escolhido');
  const file = h('input', { id: 'm-pdf', type: 'file', accept: 'application/pdf,.pdf', class: 'sr-only', required: true,
    onchange: e => { fileInfo.textContent = e.target.files[0] ? e.target.files[0].name : 'Nenhum arquivo escolhido'; } });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Enviar para a triagem');
  const form = h('form', { class: 'card-box', onsubmit: async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const f = file.files[0];
    if (!f) { err.textContent = 'Anexe o PDF da reunião'; return; }
    if (f.size > 15 * 1024 * 1024) { err.textContent = 'PDF grande demais (máximo 15 MB)'; return; }
    submit.disabled = true; submit.textContent = 'Enviando…';
    try {
      const { id } = await api('POST', '/api/meetings', { title: fd.get('title'), meeting_date: fd.get('meeting_date'),
        client_id: clientSel.value ? Number(clientSel.value) : null, attendee_ids: who.value(), other_attendees: fd.get('others'),
        pdf: (await readFileData(f)).replace(/^data:[^,]*,/, 'data:application/pdf;base64,'), pdf_name: f.name });
      location.hash = `#/reuniao/${id}`;
    } catch (ex) { err.textContent = ex.message; submit.disabled = false; submit.textContent = 'Enviar para a triagem'; }
  } },
    h('h2', {}, 'Nova reunião'),
    h('p', { class: 'muted' }, 'Anexe o PDF da ata do Google Meet e marque quem estava presente. A IA lê a ata e separa as tarefas; nada vai para o quadro antes do seu OK.'),
    h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('label', { for: 'm-title' }, 'Reunião'), h('input', { id: 'm-title', name: 'title', required: true, maxlength: 200, placeholder: 'Ex.: Alinhamento mensal' })),
      h('div', { class: 'field' }, h('label', { for: 'm-date' }, 'Data'), h('input', { id: 'm-date', name: 'meeting_date', type: 'date', required: true, value: today() }))),
    h('div', { class: 'field' }, h('label', { for: 'm-client' }, 'Empresa'), clientSel),
    h('h3', { class: 'sub-h' }, 'Quem estava presente'),
    who.el,
    h('div', { class: 'field' }, h('label', { for: 'm-others' }, 'Outros participantes (opcional)'), h('input', { id: 'm-others', name: 'others', maxlength: 1000, placeholder: 'Ex.: Paulo (contador do cliente)' })),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Ata da reunião (PDF)'),
      h('div', { class: 'row' }, h('label', { class: 'btn file-btn', for: 'm-pdf' }, file, 'Escolher PDF'), fileInfo)),
    err, submit);
  shell([
    form,
    h('div', { class: 'card-box table-wrap' }, h('h2', {}, 'Reuniões lançadas'),
      list.length ? h('table', { class: 'tasks' },
        h('thead', {}, h('tr', {}, ['Data', 'Reunião', 'Empresa', 'Situação', 'Lançadas'].map(x => h('th', {}, x)))),
        h('tbody', {}, list.map(m => {
          const [label, cls] = MEETING_STATUS(m);
          return h('tr', { class: 'row-link', onclick: () => { location.hash = `#/reuniao/${m.id}`; } },
            h('td', { class: 'num' }, fmtDate(m.meeting_date)),
            h('td', { 'data-label': 'Reunião' }, h('a', { href: `#/reuniao/${m.id}` }, m.title)),
            h('td', { 'data-label': 'Empresa' }, m.client_name || `${state.org.name} (interna)`),
            h('td', { 'data-label': 'Situação' }, h('span', { class: 'tag ' + cls }, label)),
            h('td', { 'data-label': 'Lançadas', class: 'num' }, `${m.approved}` + (m.discarded ? ` · ${m.discarded} descartada${m.discarded > 1 ? 's' : ''}` : '')));
        })))
        : h('p', { class: 'muted' }, 'Nenhuma reunião lançada ainda.')),
  ], { sub: 'Ata do Google Meet → tarefas, com o seu OK' });
}

let meetingPoll = null;
async function viewMeeting(meetingId) {
  clearTimeout(meetingPoll);
  const m = await api('GET', `/api/meetings/${meetingId}`);
  const here = location.hash;
  if (m.status === 'processing') meetingPoll = setTimeout(() => { if (location.hash === here) route(); }, 2500);
  const people = m.attendee_ids.map(uid => state.users.find(u => u.id === uid)).filter(Boolean);
  const client = state.clients.find(c => c.id === m.client_id);
  const pending = m.items.filter(i => i.status === 'pending');
  const approved = m.items.filter(i => i.status === 'approved');
  const discarded = m.items.filter(i => i.status === 'discarded');

  const openPdf = guard(async () => {
    const f = await api('GET', `/api/meetings/${meetingId}/pdf`);
    const bytes = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = h('a', { href: url, download: f.name, target: '_blank', rel: 'noopener' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });
  const header = h('div', { class: 'card-box meeting-head' },
    h('div', { class: 'row', style: 'align-items:flex-start' },
      h('div', { class: 'grow' },
        h('p', { class: 'muted small', style: 'margin:0' }, `${fmtDate(m.meeting_date)} · ${client ? client.name : `${state.org.name} (interna)`}`),
        h('h2', { style: 'margin:2px 0 8px' }, m.title)),
      h('a', { class: 'btn small', href: '#/reunioes' }, 'Voltar')),
    h('div', { class: 'people' }, h('span', { class: 'muted small' }, 'Presentes: '),
      people.map(u => h('span', { class: 'tag' }, u.name, u.role === 'client' ? ' (cliente)' : '')),
      m.other_attendees ? h('span', { class: 'tag' }, m.other_attendees) : null),
    m.summary ? h('p', { class: 'summary' }, m.summary) : null,
    h('div', { class: 'row' },
      m.pdf_name ? h('button', { class: 'btn small', type: 'button', onclick: openPdf }, `Abrir PDF (${m.pdf_name})`) : null,
      m.status !== 'processing' && m.ai !== false ? h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
        if (pending.length && !(await ask('Ler a ata de novo? As tarefas que ainda estão para revisar serão trocadas pela nova leitura. As já lançadas ficam.', { ok: 'Ler de novo' }))) return;
        await api('POST', `/api/meetings/${meetingId}/process`); route();
      }) }, 'Ler de novo') : null,
      h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => {
        if (!(await ask('Apagar esta reunião, o PDF e as sugestões? As tarefas já lançadas continuam no quadro.', { ok: 'Apagar reunião', danger: true }))) return;
        await api('DELETE', `/api/meetings/${meetingId}`); toast('Reunião apagada'); location.hash = '#/reunioes';
      }) }, 'Apagar')));

  const status = m.status === 'processing'
    ? h('div', { class: 'card-box reading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'A IA está lendo a ata. Isso leva de alguns segundos a um ou dois minutos; esta tela atualiza sozinha.')
    : m.status === 'error' ? h('div', { class: 'card-box error-box', role: 'alert' }, h('strong', {}, 'Não deu para ler a ata. '), m.error) : null;

  const addForm = h('form', { class: 'row add-item', onsubmit: guard(async e => {
    e.preventDefault();
    const input = e.target.elements['mi-new'];
    if (!input.value.trim()) return;
    await api('POST', `/api/meetings/${meetingId}/items`, { title: input.value.trim() }); route();
  }) },
    h('label', { class: 'sr-only', for: 'mi-new' }, 'Tarefa que faltou'),
    h('input', { id: 'mi-new', class: 'grow', maxlength: 200, placeholder: 'Faltou alguma? Escreva o título e adicione' }),
    h('button', { class: 'btn', type: 'submit' }, icon('plus'), 'Adicionar'));

  const approveAll = pending.length > 1 ? h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => {
    if (!(await ask(`Lançar as ${pending.length} tarefas no quadro, como estão?`, { ok: `Lançar ${pending.length} tarefas` }))) return;
    let ok = 0;
    for (const it of pending) {
      try { await api('POST', `/api/meeting-items/${it.id}/approve`); ok++; } catch (ex) { toast(`"${it.title}": ${ex.message}`, 6000); }
    }
    if (ok) toast(`${ok} tarefa${ok > 1 ? 's' : ''} lançada${ok > 1 ? 's' : ''}`);
    route();
  }) }, icon('check'), `Lançar todas (${pending.length})`) : null;

  shell([
    header, status,
    m.status !== 'processing' ? h('section', { 'aria-labelledby': 'mi-h' },
      h('div', { class: 'row section-h' }, h('h2', { id: 'mi-h', class: 'grow' }, pending.length ? `Para revisar (${pending.length})` : 'Para revisar'), approveAll),
      pending.length ? h('p', { class: 'muted small' }, 'Confira cada tarefa: o que você muda fica salvo na hora. "OK, lançar" leva para o quadro e avisa os responsáveis.') : null,
      pending.map(meetingItemCard),
      !pending.length && m.status === 'ready' ? h('div', { class: 'card-box empty' }, approved.length ? 'Tudo revisado.' : 'A IA não encontrou tarefas nesta ata. Se faltou alguma, adicione abaixo.') : null,
      h('div', { class: 'card-box' }, addForm)) : null,
    approved.length ? h('section', { class: 'card-box' }, h('h2', {}, `Lançadas (${approved.length})`),
      h('ul', { class: 'plain-list' }, approved.map(it => h('li', {}, h('span', { class: 'tag ok' }, 'Lançada'), ' ',
        it.task_id ? h('a', { href: `#/tarefa/${it.task_id}` }, it.title) : h('span', {}, it.title, h('span', { class: 'muted small' }, ' (tarefa apagada)')))))) : null,
    discarded.length ? h('details', { class: 'card-box' }, h('summary', {}, `Descartadas (${discarded.length})`),
      h('ul', { class: 'plain-list' }, discarded.map(it => h('li', {}, h('span', { class: 'grow' }, it.title),
        h('button', { class: 'btn small', type: 'button', onclick: guard(async () => { await api('POST', `/api/meeting-items/${it.id}/restore`); route(); }) }, 'Voltar para revisão'))))) : null,
  ], { title: 'Reunião', sub: m.title });
}

function meetingItemCard(it) {
  const p = `mi${it.id}`;
  const saved = h('span', { class: 'muted small', role: 'status' });
  let timer, last = Promise.resolve();
  // Salva cada mudança na hora, uma depois da outra; o OK espera a última terminar.
  const save = patch => (last = last.then(async () => {
    try {
      await api('PATCH', `/api/meeting-items/${it.id}`, patch);
      saved.textContent = 'Salvo'; clearTimeout(timer); timer = setTimeout(() => { saved.textContent = ''; }, 1500);
    } catch (ex) { toast(ex.message, 5000); }
  }));
  const kc = kindClientFields(p, it.kind, it.client_id, it.client_visible, v => save(v));
  const field = (label, id, input) => h('div', { class: 'field' }, h('label', { for: id }, label), input);
  const who = h('div', { class: 'checks', role: 'group', 'aria-label': 'Responsáveis' },
    staffUsers().map(u => h('label', {}, h('input', { type: 'checkbox', value: u.id, checked: it.assignee_ids.includes(u.id),
      onchange: () => save({ assignee_ids: [...who.querySelectorAll('input:checked')].map(i => Number(i.value)) }) }), u.name)));
  const card = h('article', { class: 'card-box item-card', 'aria-label': it.title },
    field('Tarefa', `${p}-title`, h('input', { id: `${p}-title`, value: it.title, maxlength: 200, required: true,
      onchange: e => e.target.value.trim() && save({ title: e.target.value.trim() }) })),
    it.quote ? h('blockquote', { class: 'quote' }, h('span', { class: 'muted small' }, 'Na ata: '), `“${it.quote}”`) : null,
    h('div', { class: 'item-grid' },
      h('div', {}, kc.el,
        field('Responsável no cliente (opcional)', `${p}-cr`, h('input', { id: `${p}-cr`, value: it.client_responsible, maxlength: 120, placeholder: 'Quem do cliente ficou de fazer',
          onchange: e => save({ client_responsible: e.target.value }) }))),
      h('div', {},
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Responsáveis (equipe)'), who),
        h('div', { class: 'grid2' },
          field('Prazo', `${p}-due`, h('input', { id: `${p}-due`, type: 'date', value: it.due_date || '', onchange: e => save({ due_date: e.target.value || null }) })),
          field('Prioridade', `${p}-pri`, h('select', { id: `${p}-pri`, onchange: e => save({ priority: e.target.value }) },
            Object.entries(PRIORITY).map(([v, l]) => h('option', { value: v, selected: v === it.priority }, l)))))),
      field('Descrição', `${p}-desc`, h('textarea', { id: `${p}-desc`, rows: 2, onchange: e => save({ description: e.target.value }) }, it.description)),
      field('Checklist (um item por linha)', `${p}-ck`, h('textarea', { id: `${p}-ck`, rows: Math.max(2, it.checklist.length),
        onchange: e => save({ checklist: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) }) }, it.checklist.join('\n')))),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => {
        // Garante que o que foi digitado por último (sem sair do campo) também vai.
        document.activeElement?.blur?.();
        await new Promise(r => setTimeout(r, 0));
        await last;
        const r = await api('POST', `/api/meeting-items/${it.id}/approve`);
        toast('Tarefa lançada no quadro', 4000); route();
        return r;
      }) }, icon('check'), 'OK, lançar'),
      h('button', { class: 'btn', type: 'button', onclick: guard(async () => { await api('POST', `/api/meeting-items/${it.id}/discard`); route(); }) }, 'Descartar'),
      saved));
  return card;
}

// ---------- relatório ----------
async function viewReport() {
  document.title = 'Relatório';
  const rows = await api('GET', '/api/report/adjustments');
  const pct = r => (r.on_time + r.late ? Math.round((r.on_time / (r.on_time + r.late)) * 100) + '%' : '–');
  shell([
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
  const themes = [['light', 'Claro', 'sun'], ['dark', 'Escuro', 'moon'], ['auto', 'Automático', 'settings']];
  const prefs = await api('GET', '/api/me/notify');
  const nErr = h('p', { class: 'error', role: 'alert' });
  const waBox = h('input', { type: 'checkbox', id: 'n-wa', checked: prefs.notify_whatsapp });
  const waFields = h('div', { hidden: !prefs.notify_whatsapp },
    h('div', { class: 'field', style: 'max-width:320px' }, h('label', { for: 'n-phone' }, 'Celular com DDD'),
      h('input', { id: 'n-phone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '(11) 98765-4321', value: prefs.phone ? formatPhone(prefs.phone) : '' })),
    h('label', { class: 'check', for: 'n-consent', style: 'font-weight:400;align-items:flex-start' },
      h('input', { type: 'checkbox', id: 'n-consent', checked: prefs.whatsapp_consent, style: 'margin-top:2px' }),
      'Autorizo a Opps Consultoria a me enviar avisos de tarefas por WhatsApp neste número. Posso desligar quando quiser.'));
  waBox.addEventListener('change', () => { waFields.hidden = !waBox.checked; });
  const notifyCard = h('form', { class: 'card-box', onsubmit: async e => {
    e.preventDefault();
    const f = e.target.elements;
    try {
      await api('PATCH', '/api/me/notify', { notify_email: f['n-email'].checked, notify_whatsapp: waBox.checked,
        phone: f['n-phone'].value || null, consent: f['n-consent'].checked });
      nErr.textContent = ''; toast('Preferências de aviso salvas');
    } catch (ex) { nErr.textContent = ex.message; }
  } },
    h('h2', {}, 'Avisos'),
    h('p', { class: 'muted' }, 'Você recebe quando uma tarefa sua é criada, quando o prazo chega (nos alertas escolhidos na tarefa) e um resumo toda segunda às 8h.'),
    h('label', { class: 'check', for: 'n-email', style: 'font-weight:500' }, h('input', { type: 'checkbox', id: 'n-email', checked: prefs.notify_email }), `Por e-mail (${prefs.email})`),
    h('label', { class: 'check', for: 'n-wa', style: 'font-weight:500' }, waBox, 'Por WhatsApp'),
    waFields,
    !prefs.channels.email || !prefs.channels.whatsapp ? h('p', { class: 'muted small' },
      [!prefs.channels.email ? 'O envio por e-mail ainda não foi ligado.' : null, !prefs.channels.whatsapp ? 'O envio por WhatsApp ainda não foi ligado.' : null].filter(Boolean).join(' '),
      ' Suas escolhas ficam guardadas e passam a valer quando for ligado.') : null,
    nErr, h('button', { class: 'btn primary', type: 'submit' }, 'Salvar avisos'));
  shell([
    notifyCard,
    h('div', { class: 'card-box' },
      h('h2', {}, 'Aparência'),
      h('p', { class: 'muted' }, 'Vale para este aparelho. Automático segue o tema do celular ou do computador.'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Tema' },
        themes.map(([v, l, ic]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(themePref === v),
          onclick: () => { setTheme(v); route(); } }, icon(ic), l)))),
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

// ---------- avisos (administrador) ----------
const formatPhone = d => (/^55(\d{2})(\d{4,5})(\d{4})$/.test(d) ? d.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3') : '+' + d);
const NOTICE_KIND = { created: 'Tarefa criada', due: 'Prazo chegando', overdue: 'Atrasou', weekly: 'Resumo semanal', test: 'Teste' };
const NOTICE_STATUS = { sent: ['Enviado', 'done_on_time'], pending: ['Na fila', 'doing'], failed: ['Falhou', 'overdue'], not_sent: ['Não enviado', 'cancelled'] };
async function viewNotifications() {
  const [st, list] = await Promise.all([api('GET', '/api/notify/status'), api('GET', '/api/notifications')]);
  const channel = (name, ok, okText, offText) => h('div', { class: 'kpi ' + (ok ? 'good' : '') },
    h('span', { class: 'kpi-label' }, name), h('span', { class: 'kpi-value', style: 'font-size:18px' }, ok ? 'Ligado' : 'Desligado'),
    h('span', { class: 'muted small' }, ok ? okText : offText));
  const show = n => modal(close => h('div', {},
    h('h2', {}, n.subject),
    h('p', { class: 'muted small' }, `${NOTICE_KIND[n.kind]} · para ${n.user_name} · ${n.channel === 'email' ? 'e-mail' : 'WhatsApp'} · ${fmtDateTime(n.created_at)}`),
    n.error ? h('p', { class: 'error' }, n.error) : null,
    h('pre', { class: 'notice-body' }, n.body),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar'))));
  shell([
    h('div', { class: 'kpis' },
      channel('E-mail (Google)', st.email.configured, st.email.from ? `Envia como ${st.email.from}` : 'Pronto para enviar', 'Falta configurar no servidor (veja o guia)'),
      channel('WhatsApp', st.whatsapp.configured, 'API oficial da Meta', 'Falta a conta na Meta e os modelos aprovados'),
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Resumo semanal'), h('span', { class: 'kpi-value', style: 'font-size:18px' }, 'Segunda, 8h'), h('span', { class: 'muted small' }, 'Para cada responsável e cliente com tarefas abertas')),
      h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Últimos avisos'), h('span', { class: 'kpi-value' }, list.length), h('span', { class: 'muted small' }, `${list.filter(n => n.status === 'sent').length} enviados`))),
    h('div', { class: 'card-box' },
      h('h2', {}, 'Quando os avisos saem'),
      h('ul', { class: 'roles' },
        h('li', {}, h('strong', {}, 'Tarefa criada: '), 'na hora, para os responsáveis (menos quem criou) e para o cliente, se ele vê a tarefa. Vale também para a próxima repetição de uma recorrente.'),
        h('li', {}, h('strong', {}, 'Prazo chegando: '), 'a partir das 8h, nos alertas escolhidos em cada tarefa (no dia, 1, 3 ou 7 dias antes), e no primeiro dia de atraso.'),
        h('li', {}, h('strong', {}, 'Resumo semanal: '), 'toda segunda às 8h, com o que está atrasado, o que vence na semana e o que está em andamento.')),
      h('p', { class: 'muted small' }, 'Cada pessoa escolhe e-mail e/ou WhatsApp em Minha conta. Ninguém recebe aviso de tarefa que não pode ver.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => {
          const r = await api('POST', '/api/notifications/test');
          toast(r.status === 'sent' ? `E-mail de teste enviado para ${state.me.email}` : `Não enviado: ${r.error}`); route();
        }) }, icon('mail'), 'Enviar e-mail de teste para mim'),
        h('button', { class: 'btn', type: 'button', onclick: guard(async () => { const r = await api('POST', '/api/notifications/run'); toast(`Verificado. ${r.sent} enviado${r.sent === 1 ? '' : 's'} agora.`); route(); }) }, 'Verificar prazos agora'))),
    h('div', { class: 'card-box table-wrap' }, h('h2', {}, 'Últimos avisos'),
      list.length ? h('table', { class: 'tasks' },
        h('thead', {}, h('tr', {}, ['Quando', 'Para', 'Canal', 'Tipo', 'Assunto', 'Situação'].map(x => h('th', {}, x)))),
        h('tbody', {}, list.map(n => h('tr', { class: 'row-link', onclick: () => show(n) },
          h('td', { class: 'num' }, h('button', { class: 'link', type: 'button', onclick: e => { e.stopPropagation(); show(n); } }, fmtDateTime(n.created_at))),
          h('td', { 'data-label': 'Para' }, h('span', {}, n.user_name, n.user_role === 'client' ? h('span', { class: 'muted small' }, ' (cliente)') : null)),
          h('td', { 'data-label': 'Canal' }, n.channel === 'email' ? 'E-mail' : 'WhatsApp'),
          h('td', { 'data-label': 'Tipo' }, NOTICE_KIND[n.kind]),
          h('td', { 'data-label': 'Assunto' }, n.subject),
          h('td', { 'data-label': 'Situação' }, h('span', { class: `pill col-${NOTICE_STATUS[n.status][1]}`, title: n.error || '' }, NOTICE_STATUS[n.status][0]))))))
        : h('p', { class: 'empty' }, 'Nenhum aviso ainda. Eles aparecem aqui quando uma tarefa é criada ou um prazo chega.')),
  ], { title: 'Avisos' });
}

boot();
