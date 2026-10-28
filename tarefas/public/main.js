'use strict';
/* global Shared */
const S = window.Shared;

// ---------- utilidades ----------
const state = {
  me: null, org: null, clients: [], users: [], templates: [], alertCount: 0, inboxUnread: 0, chatUnread: 0,
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
const PRIORITY = { high: 'Alta', normal: 'Média', low: 'Baixa' };
const isStaff = () => state.me && state.me.role !== 'client';
const isAdmin = () => state.me && state.me.role === 'admin';
const orgShort = () => state.org.name.split(/\s+/)[0];
const roleLabel = r => ({ admin: 'Administrador', member: `Equipe ${orgShort()}`, client: 'Cliente' }[r]);
// Colunas do quadro na ordem da organização (com as colunas criadas por ela).
const boardColumns = () => S.boardColumns(state.org?.board?.stages || [], state.org?.board?.order || []);
const colName = key => (boardColumns().find(c => c.key === key) || { name: 'Em andamento' }).name;
const statusName = t => (t.status === 'doing' && t.stage_id ? colName(`stage-${t.stage_id}`) : S.STATUS_LABEL[t.status]);
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
  chat: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7.5h6M9 11h4"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>',
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
    ? [['#/painel', 'Dashboard', 'home'], ['#/tarefas', 'Tarefas', 'board'], ['#/diario', 'Diário de bordo', 'book'], ['#/chats', 'Chats', 'chat'], ['#/recorrentes', 'Recorrentes', 'repeat'], ['#/compromissos', 'Compromissos', 'calendar'], ['#/reunioes', 'Reuniões', 'meet'], ['#/alertas', 'Alertas', 'alert'],
      ['#/clientes', 'Clientes', 'building'], ['#/modelos', 'Modelos', 'copy'], ['#/relatorio', 'Relatórios', 'chart'], ['#/equipe', 'Pessoas', 'users'],
      ...(isAdmin() ? [['#/avisos', 'Avisos', 'mail']] : []),
      ['#/config', 'Configurações', 'settings']]
    : [['#/painel', 'Dashboard', 'home'], ['#/tarefas', 'Minhas entregas', 'board'], ['#/chats', 'Chats', 'chat'], ['#/recorrentes', 'Recorrentes', 'repeat'], ['#/compromissos', 'Compromissos', 'calendar'], ['#/alertas', 'Alertas', 'alert'],
      ['#/config', 'Minha conta', 'settings']];
  const current = (location.hash.split('?')[0] || nav[0][0]).replace(/^#\/chats\/\d+$/, '#/chats');
  const page = nav.find(n => n[0] === current) || (current === '#/notificacoes' ? ['#/notificacoes', 'Notificações'] : nav[0]);
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
          href === '#/alertas' && state.alertCount ? h('span', { class: 'badge', 'aria-label': `${state.alertCount} alertas` }, state.alertCount) : null,
          href === '#/chats' && state.chatUnread ? h('span', { class: 'badge', 'aria-label': `${state.chatUnread} conversas com mensagens novas` }, state.chatUnread) : null))),
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
        bellButton(),
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
async function refreshAlerts() {
  const [alerts, inbox] = await Promise.all([api('GET', '/api/alerts'), api('GET', '/api/inbox/count').catch(() => null)]);
  state.alertCount = alerts.length;
  if (inbox) { state.inboxUnread = inbox.unread; state.chatUnread = inbox.chats ?? state.chatUnread; }
}

// Sino de notificações na barra de cima. O número se atualiza sozinho a cada 30 segundos.
function bellButton() {
  const n = state.inboxUnread;
  return h('a', { class: 'icon-btn bell-btn', href: '#/notificacoes', title: 'Notificações', 'aria-label': n ? `Notificações: ${n} novas` : 'Notificações' },
    icon('bell'), n ? h('span', { class: 'bell-badge' }, n > 99 ? '99+' : n) : null);
}
let inboxTimer = null;
function startInboxPolling() {
  clearInterval(inboxTimer);
  inboxTimer = setInterval(async () => {
    if (!state.me || document.hidden) return;
    try {
      const r = await api('GET', '/api/inbox/count');
      const changed = r.unread !== state.inboxUnread || (r.chats ?? state.chatUnread) !== state.chatUnread;
      state.inboxUnread = r.unread; state.chatUnread = r.chats ?? state.chatUnread;
      if (changed) {
        document.querySelector('.bell-btn')?.replaceWith(bellButton());
        const chatLink = document.querySelector('.nav-link[href="#/chats"]');
        if (chatLink) { chatLink.querySelector('.badge')?.remove(); if (state.chatUnread) chatLink.append(h('span', { class: 'badge' }, state.chatUnread)); }
        if (location.hash === '#/notificacoes' && !document.querySelector('.modal')) route();
      }
    } catch { /* sem conexão: tenta de novo na próxima */ }
  }, 30000);
}

async function boot() {
  try { await loadCommon(); } catch { renderLogin(); return; }
  startInboxPolling();
  route();
}

const ROUTES = {
  '#/avisos': viewNotifications, '#/reunioes': viewMeetings, '#/compromissos': viewEvents, '#/painel': viewDashboard, '#/tarefas': viewTasks, '#/recorrentes': viewRecurring, '#/alertas': viewAlerts, '#/clientes': viewClients, '#/modelos': viewTemplates,
  '#/relatorio': viewReport, '#/equipe': viewTeam, '#/config': viewSettings, '#/notificacoes': viewInbox, '#/chats': () => viewChats(null), '#/diario': viewDiary,
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
  const chat = /^#\/chats\/(\d+)$/.exec(key);
  if (chat) { try { await refreshAlerts(); } catch { /* segue */ } await guard(() => viewChats(Number(chat[1])))(); return; }
  const fallback = '#/painel';
  const clientPages = ['#/painel', '#/tarefas', '#/recorrentes', '#/compromissos', '#/alertas', '#/config', '#/chats', '#/notificacoes'];
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
// Quem mexeu: preenchido sozinho quando alguém informa o início, conclui ou cancela.
function whoDid(t) {
  const parts = [t.created_by_name && t.created_by !== state.me.id ? `Criada por ${t.created_by_name}` : null,
    t.started_by_name && t.start_date ? `Iniciada por ${t.started_by_name}` : null,
    t.status === 'done' && t.completed_by_name ? `Concluída por ${t.completed_by_name}` : null,
    t.status === 'cancelled' && t.cancelled_by_name ? `Cancelada por ${t.cancelled_by_name}` : null].filter(Boolean);
  return parts.length ? h('p', { class: 'who-did' }, parts.join(' · ')) : null;
}
const internalTag = t => (t.kind === 'internal' ? h('span', { class: 'tag internal' }, t.client_visible ? 'Interna · cliente vê' : 'Interna') : null);
function taskCard(t, { draggable = false, showStatus = false } = {}) {
  return h('button', { class: `task col-${t.column}`, type: 'button', draggable: draggable ? 'true' : null, 'data-id': t.id, onclick: () => openTask(t.id) },
    h('div', { class: 'task-head' }, taskLogo(t),
      h('div', { class: 'task-who' }, h('span', { class: 'client' }, where(t)),
        internalTag(t))),
    h('div', { class: 'title' }, t.title),
    t.status === 'cancelled' ? h('p', { class: 'cancel-reason' }, 'Motivo: ' + t.cancel_reason) : null,
    whoDid(t),
    (t.status === 'doing' || (t.progress > 0 && !['done', 'cancelled'].includes(t.status))) ? progressBar(t.progress) : null,
    h('div', { class: 'meta' },
      showStatus || t.column === 'overdue' ? h('span', { class: 'tag' }, statusName(t)) : null,
      dateTags(t),
      t.alert ? h('span', { class: 'tag ' + (t.alert.kind === 'overdue' ? 'late' : 'warn') }, '⏰ ' + S.alertText(t.alert)) : null,
      t.priority === 'high' ? h('span', { class: 'tag high' }, 'Alta') : null,
      t.recurrence !== 'none' ? h('span', { class: 'tag', title: 'Recorrente' }, '↻ ' + S.RECURRENCE[t.recurrence].replace(/ \(.*/, '')) : null,
      t.adjustments_open ? h('span', { class: 'tag adj' }, `${t.adjustments_open} ajuste${t.adjustments_open > 1 ? 's' : ''}`) : null,
      t.diary_done ? h('span', { class: 'tag diary', title: 'Marcada como feita no diário de bordo: falta concluir aqui' }, '✔ Feita no diário') : null,
      t.checklist_total ? h('span', {}, `☑ ${t.checklist_done}/${t.checklist_total}`) : null,
      t.attachments_count ? h('span', { title: `${t.attachments_count} anexo${t.attachments_count > 1 ? 's' : ''}` }, `📎 ${t.attachments_count}`) : null,
      t.archived_at ? h('span', { class: 'tag' }, 'Arquivada') : null,
      h('span', { class: 'avatars' }, t.assignees.map(a => h('span', { class: 'avatar' + (a.role === 'client' ? ' client' : ''), title: a.role === 'client' ? `${a.name} (cliente)` : a.name }, initials(a.name))))));
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
    isStaff() ? null : select('f-who', 'Responsável', v.assignee, [['', 'Todas da empresa'], ['me', 'Só as que sou responsável']], x => set('assignee', x)),
    select('f-due', 'Prazo', v.due, [['', 'Qualquer prazo'], ['overdue', 'Atrasadas'], ['today', 'Vencem hoje'], ['week', 'Próximos 7 dias'], ['month', 'Este mês'], ['none', 'Sem prazo']], x => set('due', x)),
    select('f-rec', 'Repetição', v.rec, [['', 'Recorrentes e únicas'], ['1', 'Só recorrentes'], ['0', 'Só únicas']], x => set('rec', x)),
    v.layout === 'list' ? select('f-group', 'Agrupar por', v.group, [['column', 'Agrupar por situação'], ...(isStaff() ? [['client', 'Agrupar por empresa'], ['assignee', 'Agrupar por responsável']] : []), ['due', 'Agrupar por prazo'], ...(isStaff() ? [['kind', 'Agrupar por tipo']] : [])], x => set('group', x)) : null,
    isStaff() ? h('label', { class: 'check inline', for: 'f-arch' }, h('input', { type: 'checkbox', id: 'f-arch', checked: v.archived, onchange: e => { v.archived = e.target.checked; route(); } }), 'Ver arquivadas') : null);
  return h('div', { class: 'toolbar' },
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Visualização' },
      layouts.map(([k, l, ic]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(v.layout === k), onclick: () => set('layout', k) }, icon(ic), l))),
    h('div', { class: 'search' }, icon('search'), h('label', { class: 'sr-only', for: 'f-q' }, 'Buscar'),
      h('input', { id: 'f-q', type: 'search', placeholder: 'Buscar tarefa', value: v.q, onchange: e => { v.q = e.target.value; route(); } })),
    v.layout === 'kanban' && isAdmin() ? h('button', { class: 'btn', type: 'button', onclick: boardDialog }, 'Colunas') : null,
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
  if (!isStaff()) Object.assign(state.view, { kind: '', client: '', assignee: state.view.assignee === 'me' ? 'me' : '', archived: false });
  let tasks = await api('GET', '/api/tasks?' + taskQuery());
  const v = state.view;
  // Filtros que vêm do Dashboard: situação (coluna) e período de conclusão/cancelamento.
  const closedOn = t => t.completed_on || t.cancelled_on || '';
  if (v.col) tasks = tasks.filter(t => (v.col === 'done' ? t.status === 'done' : t.column === v.col));
  if (v.since) tasks = tasks.filter(t => closedOn(t) >= v.since);
  if (v.until) tasks = tasks.filter(t => closedOn(t) <= v.until);
  const dashFilter = v.col || v.since ? h('div', { class: 'card-box dash-filter-note' },
    h('span', { class: 'grow' }, 'Mostrando: ', h('strong', {}, v.col === 'done' ? 'Concluídas' : v.col ? colName(v.col) : 'Tarefas'),
      v.since ? ` de ${fmtDate(v.since)}` : '', v.until ? ` a ${fmtDate(v.until)}` : (v.since ? ' até hoje' : '')),
    h('button', { class: 'btn small', type: 'button', onclick: () => { Object.assign(v, { col: '', since: '', until: '' }); saveView(); route(); } }, 'Ver todas')) : null;
  const body = v.layout === 'list' ? listView(tasks) : v.layout === 'calendar' ? calendarView(tasks) : kanbanView(tasks);
  const waiting = isStaff() ? [] : tasks.filter(t => t.status === 'review');
  shell([
    waiting.length ? h('div', { class: 'card-box waiting-box' }, h('strong', {}, `${waiting.length} entrega${waiting.length > 1 ? 's' : ''} esperando sua revisão: `),
      waiting.map((t, i) => [i ? ', ' : '', h('button', { class: 'link', type: 'button', onclick: () => openTask(t.id) }, t.title)])) : null,
    v.archived ? null : kpis(tasks),
    dashFilter,
    tasksToolbar(), v.archived ? h('p', { class: 'muted' }, 'Mostrando só as tarefas arquivadas.') : null, body]);
}

function kanbanView(tasks) {
  const board = h('div', { class: 'board' });
  // Os cards já chegam na ordem: prazo mais próximo, depois prioridade alta, média e baixa.
  for (const c of boardColumns()) {
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

// Organizar colunas (administrador): A fazer e Em andamento ficam no começo; as outras mudam de lugar.
function boardDialog() {
  modal(close => {
    const box = h('div', {});
    const err = h('p', { class: 'error', role: 'alert' });
    const save = async (method, path, body) => {
      try { state.org.board = await api(method, path, body); err.textContent = ''; paint(); }
      catch (ex) { err.textContent = ex.message; }
    };
    const paint = () => {
      const cols = boardColumns();
      const movable = cols.slice(2).map(c => c.key);
      const move = (i, d) => { const o = movable.slice(); [o[i], o[i + d]] = [o[i + d], o[i]]; save('PUT', '/api/board/order', { order: o }); };
      box.replaceChildren(h('ol', { class: 'board-cols' },
        cols.slice(0, 2).map(c => h('li', { class: 'fixed' }, h('span', { class: 'grow' }, c.name), h('span', { class: 'muted small' }, 'fixa'))),
        cols.slice(2).map((c, i) => h('li', {},
          h('span', { class: 'grow' }, c.name, c.custom ? h('span', { class: 'muted small' }, ' (criada)') : null,
            c.key === 'overdue' ? h('span', { class: 'muted small' }, ' (automática)') : null),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Subir ${c.name}`, disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Descer ${c.name}`, disabled: i === movable.length - 1, onclick: () => move(i, 1) }, '↓'),
          c.custom ? [
            h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Renomear ${c.name}`, onclick: async () => {
              const name = await askText('Novo nome da coluna', c.name); if (name) save('PATCH', `/api/board/stages/${c.stage_id}`, { name });
            } }, 'Renomear'),
            h('button', { class: 'btn small ghost danger', type: 'button', 'aria-label': `Apagar ${c.name}`, onclick: async () => {
              if (await ask(`Apagar a coluna "${c.name}"? As tarefas dela voltam para Em andamento.`, { ok: 'Apagar coluna', danger: true })) save('DELETE', `/api/board/stages/${c.stage_id}`);
            } }, 'Apagar')] : null))));
    };
    paint();
    const input = h('input', { id: 'b-new', maxlength: 40, placeholder: 'Ex.: Aguardando cliente' });
    return h('div', {},
      h('h2', {}, 'Colunas do quadro'),
      h('p', { class: 'muted small' }, 'Vale para todos. A fazer e Em andamento ficam sempre no começo. Uma coluna criada funciona como uma etapa de trabalho: a tarefa nela está em andamento.'),
      box,
      h('form', { class: 'row', style: 'margin-top:12px', onsubmit: e => { e.preventDefault(); if (input.value.trim()) { save('POST', '/api/board/stages', { name: input.value.trim() }); input.value = ''; } } },
        h('label', { class: 'sr-only', for: 'b-new' }, 'Nova coluna'), h('div', { class: 'grow' }, input),
        h('button', { class: 'btn', type: 'submit' }, icon('plus'), 'Criar coluna')),
      err,
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', type: 'button', onclick: () => { close(); route(); } }, 'Pronto')));
  }, { onclose: () => route() });
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
    const nt = await api('PATCH', `/api/tasks/${taskId}`, { status: key });
    if (nt.column === 'overdue') toast(`Mudou para ${colName(key)}, mas continua em Atrasada porque o prazo já passou.`);
    route();
  }));
}

function groupKey(t, group) {
  const now = today();
  if (group === 'column') return [boardColumns().findIndex(c => c.key === t.column), colName(t.column)];
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
  return h('div', { class: 'hbars' }, rows.map(r => h(r.go ? 'button' : 'div', { class: 'hbar' + (r.go ? ' clickable' : ''), type: r.go ? 'button' : null, tabindex: '0', onclick: r.go || null, 'data-tip': r.tip || `${r.label}: ${fmtNum(r.value)}${unit}` },
    h('span', { class: 'hbar-label' }, r.icon || null, h('span', {}, r.label)),
    h('span', { class: 'hbar-track' }, h('span', { class: 'hbar-fill' + (colorOf ? ` col-${colorOf(r)}` : ''), style: `width:${(r.value / max) * 100}%` })),
    h('span', { class: 'hbar-value' }, fmtNum(r.value) + unit))));
}
// Colunas por semana: uma série, valor no topo de cada coluna.
function columns(rows) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return h('div', { class: 'cols-chart' }, rows.map(r => h(r.go ? 'button' : 'div', { class: 'colc' + (r.go ? ' clickable' : ''), type: r.go ? 'button' : null, tabindex: '0', onclick: r.go || null, 'data-tip': r.tip },
    h('span', { class: 'colc-value' }, r.value || ''),
    h('span', { class: 'colc-bar', style: `height:${Math.max(r.value ? 4 : 0, (r.value / max) * 100)}%` }),
    h('span', { class: 'colc-label' }, r.label))));
}
const greet = () => { const hr = new Date().getHours(); return hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite'; };
function weekStart(iso) { const d = new Date(iso + 'T12:00'); const dow = (d.getDay() + 6) % 7; return S.addDays(iso, -dow); }

// Do Dashboard para Tarefas, já com o filtro do número clicado (os outros filtros são limpos).
function goTasks(filters, layout = 'kanban') {
  Object.assign(state.view, { kind: '', client: dash.client || '', assignee: '', due: '', rec: '', q: '', archived: false, col: '', since: '', until: '' }, filters, { layout });
  saveView(); location.hash = '#/tarefas';
}

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

  const chip = (ic, label, value, sub, cls, go) => h('button', { type: 'button', class: 'hchip clickable ' + (cls || ''), onclick: go, title: `Ver ${label.toLowerCase()} em Tarefas` }, h('span', { class: 'hchip-icon' }, icon(ic)),
    h('div', {}, h('div', { class: 'hchip-label' }, label), h('div', { class: 'hchip-value' }, value), h('div', { class: 'hchip-sub' }, sub)));
  const stat = (label, value, sub, cls, go) => h(go ? 'button' : 'div', { type: go ? 'button' : null, class: 'stat ' + (cls || '') + (go ? ' clickable' : ''), onclick: go || null },
    h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label), sub ? h('div', { class: 'stat-sub' }, sub) : null);

  // Concluídas por semana, últimas 8 semanas.
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const start = S.addDays(weekStart(now), -7 * i);
    const end = S.addDays(start, 6);
    const n = all.filter(t => t.status === 'done' && t.completed_on >= start && t.completed_on <= end).length;
    weeks.push({ label: fmtShort(start), value: n, tip: `Semana de ${fmtDate(start)}: ${n} concluída${n === 1 ? '' : 's'}`,
      go: () => goTasks({ col: 'done', since: start, until: end }, 'list') });
  }
  const closedCol = k => ['done_on_time', 'done_late', 'cancelled'].includes(k);
  const byStatus = boardColumns().map(c => ({ key: c.key, label: c.name, value: all.filter(t => t.column === c.key && (!closedCol(c.key) || (t.completed_on || t.cancelled_on) >= since)).length,
    go: () => goTasks({ col: c.key, since: closedCol(c.key) ? since : '' }, 'list') }));

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
      const r = m.get(key) || { key, label: where(t), value: 0, late: 0, logo: taskLogo(t, 'xs') };
      r.value++; if (t.column === 'overdue') r.late++;
      m.set(key, r);
    }
    return [...m.values()].sort((a, b) => b.value - a.value).slice(0, 8)
      .map(r => ({ ...r, icon: r.logo, tip: `${r.label}: ${r.value} em aberto, ${r.late} atrasada${r.late === 1 ? '' : 's'}`,
        go: () => goTasks({ client: String(r.key) }) }));
  })() : [];

  const content = h('div', { class: 'dash' },
    h('div', { class: 'hello' },
      h('div', {}, h('p', { class: 'hello-date' }, (d => d[0].toUpperCase() + d.slice(1))(new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))),
        h('h2', { class: 'hello-title' }, `${greet()}, ${state.me.name.split(' ')[0]}!`)),
      h('div', { class: 'hello-chips' },
        chip('check', 'Executadas', weekDone, 'esta semana', 'good', () => goTasks({ col: 'done', since: weekStart(now) }, 'list')),
        chip('alert', 'Atrasadas', overdue.length, 'pedem atenção', overdue.length ? 'bad' : '', () => goTasks({ due: 'overdue' })),
        chip('clock', 'Hoje', dueToday, 'vencendo', dueToday ? 'warn' : '', () => goTasks({ due: 'today' })),
        chip('calendar', 'Próximas', next7, '7 dias', '', () => goTasks({ due: 'week' })))),
    filterRow,
    h('div', { class: 'dash-grid' },
      panel('Indicador de produtividade', `Concluídas nos últimos ${dash.period} dias`, h('div', { class: 'stats' },
        stat('Concluídas', fmtNum(done.length), null, '', () => goTasks({ col: 'done', since }, 'list')),
        stat('Concluídas no prazo', pctText(onTime, done.length), done.length ? `${onTime} de ${done.length}` : null, done.length ? (onTime / done.length >= 0.8 ? 'good' : 'bad') : '',
          () => goTasks({ col: 'done_on_time', since }, 'list')),
        stat('Tempo médio de execução', avgDays === null ? '–' : `${fmtNum(avgDays)} d`, withStart.length ? 'do início ao término' : 'sem datas de início'),
        stat('Canceladas', fmtNum(cancelled), null, '', () => goTasks({ col: 'cancelled', since }, 'list')))),
      panel('Tarefas por situação', 'Abertas agora; concluídas e canceladas no período',
        hbars(byStatus, { colorOf: r => r.key })),
      panel('Concluídas por semana', 'Últimas 8 semanas', columns(weeks)),
      isStaff() ? panel('Carga do time', 'Em aberto e atrasadas por responsável',
        people.length ? h('div', { class: 'load' }, people.map(p => h('button', { type: 'button', class: 'load-row clickable', onclick: () => goTasks({ assignee: String(p.u.id) }),
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
// Alertas. Para a equipe: filtros de empresa e responsável e, com um deles escolhido, a mensagem pronta
// para o WhatsApp (todas ou uma tarefa) e uma imagem das tarefas para anexar na conversa.
const alertsFilter = { client: '', who: '' };
async function viewAlerts() {
  document.title = 'Alertas';
  const all = await api('GET', '/api/alerts');
  const row = (t, tools) => h('div', { class: 'alert-row-wrap' },
    h('button', { class: 'alert-row', type: 'button', onclick: () => openTask(t.id) },
      taskLogo(t),
      h('span', { class: 'grow' }, h('strong', {}, t.title), h('span', { class: 'muted small' }, ` · ${where(t)} · prazo ${fmtDate(t.due_date)}`,
        t.assignees.length ? ` · ${t.assignees.map(a => a.name).join(', ')}` : '')),
      h('span', { class: 'tag ' + (t.alert.kind === 'overdue' ? 'late' : 'warn') }, S.alertText(t.alert))),
    tools ? h('div', { class: 'row-tools' },
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => copyText(waMessage([t])) }, 'Copiar texto'),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => imageDialog([t]) }, 'Imagem')) : null);
  if (!isStaff()) {
    const overdue = all.filter(t => t.alert.kind === 'overdue'), soon = all.filter(t => t.alert.kind === 'soon');
    return shell([
      h('p', { class: 'muted' }, 'Suas entregas atrasadas ou com prazo chegando.'),
      h('div', { class: 'card-box' }, h('h2', {}, `Atrasadas (${overdue.length})`), overdue.length ? overdue.map(t => row(t)) : h('p', { class: 'muted' }, 'Nenhuma.')),
      h('div', { class: 'card-box' }, h('h2', {}, `Prazo chegando (${soon.length})`), soon.length ? soon.map(t => row(t)) : h('p', { class: 'muted' }, 'Nenhuma.'))]);
  }
  const f = alertsFilter;
  const clients = [...new Map(all.filter(t => t.client_id).map(t => [t.client_id, t.client_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const people = [...new Map(all.flatMap(t => t.assignees).map(a => [a.id, a])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const list = all.filter(t => (!f.client || (f.client === 'org' ? !t.client_id : t.client_id === Number(f.client)))
    && (!f.who || t.assignees.some(a => a.id === Number(f.who))));
  const overdue = list.filter(t => t.alert.kind === 'overdue'), soon = list.filter(t => t.alert.kind === 'soon');
  const set = (k, v) => { f[k] = v; route(); };
  const filtered = !!(f.client || f.who);
  const whoName = f.who ? (people.find(p => p.id === Number(f.who)) || {}).name : null;
  const clientName = f.client && f.client !== 'org' ? (clients.find(c => String(c[0]) === f.client) || [])[1] : null;
  const preview = h('textarea', { class: 'wa-text', rows: 8, readonly: true, 'aria-label': 'Mensagem para o WhatsApp' }, waMessage(list, { to: whoName, client: clientName }));
  shell([
    h('p', { class: 'muted' }, 'Tarefas atrasadas e as que entraram na janela de aviso escolhida em cada tarefa (no dia, 1 dia, 3 dias ou 1 semana antes).'),
    h('div', { class: 'toolbar' }, h('div', { class: 'filters open' },
      select('a-client', 'Empresa', f.client, [['', 'Todas as empresas'], ['org', `${state.org.name} (interna)`], ...clients], x => set('client', x)),
      select('a-who', 'Responsável', f.who, [['', 'Todos os responsáveis'], ...people.map(p => [p.id, p.name + (p.role === 'client' ? ' (cliente)' : '')])], x => set('who', x)))),
    filtered && list.length ? h('div', { class: 'card-box wa-box' },
      h('h2', {}, 'Mensagem para o WhatsApp'),
      h('p', { class: 'muted small' }, `Para ${whoName || clientName || 'quem você escolher'}: copie o texto e cole na conversa, ou gere uma imagem para anexar. Cada tarefa também tem o seu botão.`),
      preview,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => copyText(preview.value) }, `Copiar mensagem (${list.length})`),
        h('a', { class: 'btn', href: `https://wa.me/?text=${encodeURIComponent(preview.value)}`, target: '_blank', rel: 'noopener' }, 'Abrir no WhatsApp'),
        h('button', { class: 'btn', type: 'button', onclick: () => imageDialog(list, { to: whoName, client: clientName }) }, `Gerar imagem (${list.length})`)))
      : !filtered ? h('p', { class: 'muted small' }, 'Escolha uma empresa ou um responsável para montar a mensagem pronta para o WhatsApp.') : null,
    h('div', { class: 'card-box' }, h('h2', {}, `Atrasadas (${overdue.length})`), overdue.length ? overdue.map(t => row(t, true)) : h('p', { class: 'muted' }, 'Nenhuma.')),
    h('div', { class: 'card-box' }, h('h2', {}, `Prazo chegando (${soon.length})`), soon.length ? soon.map(t => row(t, true)) : h('p', { class: 'muted' }, 'Nenhuma.')),
  ]);
}

// Texto pronto para o WhatsApp (negrito com *asteriscos*).
function waMessage(tasks, { to, client } = {}) {
  const first = to ? to.split(' ')[0] : null;
  const line = t => `• *${t.title}*${t.client_name ? ` (${t.client_name})` : ''}: prazo ${fmtDate(t.due_date)}, ${S.alertText(t.alert).toLowerCase()}` +
    (t.progress && !['done', 'cancelled'].includes(t.status) ? `, ${t.progress}% feito` : '');
  const hello = `Olá${first ? `, ${first}` : ''}!`;
  const sign = `\n\n${state.me.name.split(' ')[0]} · ${state.org.name}`;
  if (tasks.length === 1) return `${hello} Passando para lembrar da tarefa ${line(tasks[0]).slice(2)}.${sign}`;
  const late = tasks.filter(t => t.alert.kind === 'overdue'), soon = tasks.filter(t => t.alert.kind === 'soon');
  return `${hello} Segue a situação das tarefas${client ? ` da ${client}` : ''}:` +
    (late.length ? `\n\n🔴 *Atrasadas*\n${late.map(line).join('\n')}` : '') +
    (soon.length ? `\n\n🟡 *Prazo chegando*\n${soon.map(line).join('\n')}` : '') +
    `\n\nQualquer dúvida, é só falar.${sign}`;
}

async function copyText(text, done = 'Mensagem copiada. Agora é só colar no WhatsApp.') {
  try { await navigator.clipboard.writeText(text); toast(done); return; } catch { /* sem acesso à área de transferência */ }
  const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
  document.body.append(ta); ta.select();
  const ok = document.execCommand && document.execCommand('copy'); ta.remove();
  if (ok) { toast(done); return; }
  modal(close => h('div', {}, h('h2', {}, 'Copie o texto'), h('p', { class: 'muted small' }, 'Este aparelho não deixou copiar sozinho: selecione o texto e copie.'),
    h('textarea', { class: 'wa-text', rows: 10 }, text), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar'))));
}

// Imagem das tarefas (PNG) para anexar no WhatsApp.
function alertsImage(tasks, { to, client } = {}) {
  const W = 1080, pad = 56, scale = 1;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = (w, size) => `${w} ${size}px "Plus Jakarta Sans", Arial, sans-serif`;
  const wrap = (text, size, w, max) => {
    ctx.font = font(700, size);
    const words = text.split(' '); const lines = []; let cur = '';
    for (const word of words) { const t = cur ? `${cur} ${word}` : word; if (ctx.measureText(t).width > max && cur) { lines.push(cur); cur = word; } else cur = t; }
    if (cur) lines.push(cur);
    return lines;
  };
  const rows = tasks.map(t => ({ t, lines: wrap(t.title, 34, 700, W - pad * 2 - 40) }));
  const H = 230 + rows.reduce((n, r) => n + 40 + r.lines.length * 44 + 60, 0) + 90;
  c.width = W * scale; c.height = H * scale; ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#FBD200'); g.addColorStop(0.55, '#FF6A00'); g.addColorStop(1, '#FB4F14');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 14);
  ctx.fillStyle = '#121826'; ctx.font = font(800, 44); ctx.fillText(tasks.length === 1 ? 'Lembrete de tarefa' : 'Tarefas com prazo', pad, 100);
  ctx.fillStyle = '#5b6475'; ctx.font = font(500, 28);
  ctx.fillText([to ? `Para ${to}` : client ? client : null, `${state.org.name} · ${fmtDate(today())}`].filter(Boolean).join(' · '), pad, 148);
  let y = 210;
  for (const { t, lines } of rows) {
    const late = t.alert.kind === 'overdue';
    const h0 = 40 + lines.length * 44 + 60;
    ctx.fillStyle = late ? '#fef3f2' : '#fffaeb'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(pad, y, W - pad * 2, h0 - 16, 18); else ctx.rect(pad, y, W - pad * 2, h0 - 16); ctx.fill();
    ctx.fillStyle = late ? '#b42318' : '#b54708'; ctx.beginPath(); ctx.arc(pad + 30, y + 46, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#121826'; ctx.font = font(700, 34);
    lines.forEach((l, i) => ctx.fillText(l, pad + 56, y + 58 + i * 44));
    ctx.fillStyle = late ? '#b42318' : '#b54708'; ctx.font = font(600, 26);
    ctx.fillText([t.client_name || `${state.org.name}`, `Prazo ${fmtDate(t.due_date)}`, S.alertText(t.alert)].join(' · '), pad + 56, y + 58 + lines.length * 44 + 4);
    y += h0;
  }
  ctx.fillStyle = '#8a93a3'; ctx.font = font(500, 24); ctx.fillText('Painel de Tarefas Opps', pad, H - 40);
  return c;
}
function imageDialog(tasks, opts) {
  const canvas = alertsImage(tasks, opts);
  const url = canvas.toDataURL('image/png');
  const name = `tarefas-${today()}.png`;
  // O arquivo sai direto do desenho (sem buscar o endereço data:, que a segurança do sistema bloqueia).
  const pngBlob = () => new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Não deu para gerar a imagem'))), 'image/png'));
  modal(close => h('div', {},
    h('h2', {}, 'Imagem para o WhatsApp'),
    h('img', { src: url, alt: 'Imagem das tarefas', class: 'wa-img' }),
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => Exports.download(await pngBlob(), name)) }, 'Baixar imagem'),
      navigator.canShare ? h('button', { class: 'btn', type: 'button', onclick: guard(async () => {
        const file = new File([await pngBlob()], name, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file] }); else toast('Este aparelho não compartilha imagens daqui: use Baixar imagem.');
      }) }, 'Compartilhar') : null,
      h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar'))));
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
// Responsáveis: a equipe e, se a tarefa aparece para o cliente, as pessoas daquele cliente.
// Com empresa: os administradores, quem da equipe acompanha o cliente (Clientes → Equipe) e as pessoas do cliente
// quando ele vê a tarefa. Sem empresa: toda a equipe. Quem já está marcado continua aparecendo.
function assigneeChecks(selected = [], task = null, { strict = false } = {}) {
  const cid = task?.client_id ? Number(task.client_id) : null;
  const kept = id => !strict && selected.includes(id);
  const staff = staffUsers().filter(u => !cid || u.role === 'admin' || (u.client_ids || []).includes(cid) || kept(u.id));
  const clients = task ? state.users.filter(u => u.active && (S.clientAssignable(u, task) || (u.role === 'client' && kept(u.id)))) : [];
  const box = (u, suffix) => h('label', {}, h('input', { type: 'checkbox', name: 'assignee', value: u.id, checked: selected.includes(u.id) }), u.name, suffix);
  const noTeam = cid && !staffUsers().some(u => u.role === 'member' && (u.client_ids || []).includes(cid));
  return h('div', {},
    h('div', { class: 'checks', role: 'group', 'aria-label': 'Responsáveis' },
      staff.map(u => box(u, u.role === 'admin' ? h('span', { class: 'muted small' }, ' (adm.)') : null)),
      clients.map(u => box(u, h('span', { class: 'muted small' }, ' (cliente)')))),
    noTeam ? h('p', { class: 'muted small' }, 'Ninguém da equipe acompanha este cliente ainda. Para incluir alguém, marque em Clientes → Equipe.') : null);
}
function alertChecks(selected = []) {
  return h('div', { class: 'checks', role: 'group', 'aria-label': 'Alertas' },
    S.ALERTS.map(a => h('label', {}, h('input', { type: 'checkbox', name: 'alert', value: a.days, checked: selected.includes(a.days) }), a.label)));
}
// Tipo e empresa juntos: externa exige cliente; interna aceita a própria consultoria ou um cliente relacionado.
// Interna ligada a um cliente pode ficar visível para ele; sem cliente, só quem criou e os responsáveis veem.
// Tipo, empresa e quem vê. Interna vem primeiro. "A equipe vê" (team_visible): na externa, a equipe que
// acompanha o cliente (desmarcado: só os responsáveis e o administrador); na interna sem cliente, toda a equipe.
function kindClientFields(prefix, kind, clientId, visible, onchange, { team, showTeam = true } = {}) {
  const clientSel = h('select', { id: `${prefix}-client`, name: 'client_id' });
  const hint = h('p', { class: 'muted small' });
  const vis = h('input', { type: 'checkbox', id: `${prefix}-vis`, checked: !!visible });
  const visRow = h('label', { class: 'check inline', for: `${prefix}-vis` }, vis, 'Visível para o cliente');
  const teamBox = h('input', { type: 'checkbox', id: `${prefix}-team`, checked: team ?? kind === 'external' });
  const teamText = h('span', {});
  const teamRow = h('label', { class: 'check inline', for: `${prefix}-team`, hidden: !showTeam }, teamBox, teamText);
  const value = () => ({ kind, client_id: clientSel.value ? Number(clientSel.value) : null, client_visible: kind === 'internal' && !!clientSel.value && vis.checked,
    ...(showTeam ? { team_visible: teamBox.checked } : {}) });
  const refresh = () => {
    const withClient = !!clientSel.value;
    const internalWithClient = kind === 'internal' && withClient;
    visRow.hidden = !internalWithClient;
    teamText.textContent = withClient ? 'A equipe que acompanha o cliente vê' : 'Toda a equipe vê';
    const seen = kind === 'external' || (internalWithClient && vis.checked);
    const c = state.clients.find(x => x.id === Number(clientSel.value));
    const noAccess = seen && c && state.users && !state.users.some(u => u.role === 'client' && u.client_id === c.id && u.active);
    const team = !showTeam ? '' : teamBox.checked
      ? (withClient ? ' Da equipe: os responsáveis, o administrador e quem acompanha o cliente.' : ' Toda a equipe vê.')
      : (kind === 'external' ? ' Da equipe: só os responsáveis e o administrador.' : ' Da equipe: só quem criou e os responsáveis.');
    hint.textContent = (kind === 'external' ? 'Externa: o cliente vê no portal dele.'
      : internalWithClient && vis.checked ? 'Interna visível: o cliente vê.' : 'Interna: o cliente não vê.') + team +
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
    [['internal', 'Interna (nossa)'], ['external', 'Externa (de cliente)']].map(([v, l]) =>
      h('label', { class: 'seg-btn' }, h('input', { type: 'radio', name: `${prefix}-kind`, value: v, checked: v === kind, class: 'sr-only',
        onchange: () => { kind = v; clientId = clientSel.value; teamBox.checked = v === 'external'; fill(v); changed(); } }), l)));
  clientSel.addEventListener('change', changed);
  vis.addEventListener('change', changed);
  teamBox.addEventListener('change', changed);
  fill(kind);
  return {
    el: h('div', {},
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Tipo'), radios),
      h('div', { class: 'field' }, h('label', { for: `${prefix}-client` }, 'Empresa'), clientSel, h('div', { class: 'vis-rows' }, visRow, teamRow), hint)),
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
    const who = h('div', {});
    const paintWho = v => {
      const keep = [...who.querySelectorAll('input:checked')].map(i => Number(i.value));
      who.replaceChildren(assigneeChecks(keep.length || who.dataset.init ? keep : [state.me.id], v, { strict: true })); who.dataset.init = '1';
    };
    const kc = kindClientFields('n', 'internal', state.view.client && state.view.client !== 'org' ? Number(state.view.client) : null, false, paintWho);
    paintWho(kc.value());
    const rec = recurrenceFields('n', recurring ? 'monthly' : 'none', '', { required: recurring });
    const ck = checklistBuilder();
    // Anexos escolhidos antes de criar: sobem logo depois que a tarefa é criada.
    const files = [];
    const fileList = h('ul', { class: 'attach-list' });
    const hideFiles = h('input', { type: 'checkbox', id: 'n-at-hide' });
    const paintFiles = () => fileList.replaceChildren(...files.map((f, i) => h('li', {}, h('span', { class: 'grow' }, '📎 ', f.name),
      h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Tirar ${f.name}`, onclick: () => { files.splice(i, 1); paintFiles(); } }, '✕'))));
    const filePick = h('input', { type: 'file', id: 'n-files', multiple: true, class: 'sr-only', onchange: e => {
      for (const f of e.target.files) { if (f.size > 10 * 1024 * 1024) toast(`${f.name}: grande demais (máximo 10 MB)`); else files.push(f); }
      e.target.value = ''; paintFiles();
    } });
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
        for (const f of files) {
          try { await api('POST', `/api/tasks/${id}/attachments`, { name: f.name, data: await readFileData(f), visible_to_client: !hideFiles.checked }); }
          catch (ex) { toast(`Anexo ${f.name}: ${ex.message}`, 6000); }
        }
        close(); toastCreated(kc.value()); route();
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
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Responsáveis'), who),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Anexos (opcional)'), fileList,
        h('div', { class: 'row' }, h('label', { class: 'btn file-btn', for: 'n-files' }, filePick, '📎 Escolher arquivos'),
          h('label', { class: 'check inline', for: 'n-at-hide' }, hideFiles, 'Só a equipe vê')),
        h('p', { class: 'muted small' }, 'Até 10 MB por arquivo.')),
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
  // A situação de uma tarefa numa coluna criada é a chave da coluna ("stage-<id>").
  const savedStatus = () => (t.status === 'doing' && t.stage_id ? `stage-${t.stage_id}` : t.status);
  const saved = k => (k === 'assignee_ids' ? t.assignees.map(a => a.id).sort((a, b) => a - b) : k === 'status' ? savedStatus() : t[k]);
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
    const status = String(val('status')).startsWith('stage-') ? 'doing' : val('status');
    body.replaceChildren(...[
      h('div', { class: 'drawer-head' }, taskLogo(t, 'md'),
        staff ? h('input', { id: 'd-title', 'aria-label': 'Nome da tarefa', class: 'title-input', value: val('title'), maxlength: 200, oninput: e => set('title', e.target.value) })
          : h('h1', { class: 'grow' }, t.title)),
      h('p', { class: 'meta' }, h('span', { class: `pill col-${t.column}` }, colName(t.column)), internalTag(t),
        t.alert ? h('span', { class: 'tag ' + (t.alert.kind === 'overdue' ? 'late' : 'warn') }, '⏰ ' + S.alertText(t.alert)) : null,
        t.recurrence !== 'none' ? h('span', { class: 'tag' }, '↻ ' + S.RECURRENCE[t.recurrence]) : null,
        t.archived_at ? h('span', { class: 'tag' }, 'Arquivada') : null),

      t.created_by_name ? h('p', { class: 'created-by' }, icon('users'), h('span', {}, 'Criada por ', h('strong', {}, t.created_by === state.me.id ? 'você' : t.created_by_name),
        ` em ${fmtDate(t.created_at.slice(0, 10))}`)) : null,
      h('p', { class: 'who-did detail' }, [
        t.start_date && t.started_by_name ? `Iniciada por ${t.started_by_name} em ${fmtDate(t.start_date)}` : null,
        t.status === 'done' && t.completed_by_name ? `Concluída por ${t.completed_by_name} em ${fmtDate(t.completed_on)}` : null,
        t.status === 'cancelled' && t.cancelled_by_name ? `Cancelada por ${t.cancelled_by_name} em ${fmtDate(t.cancelled_on)}` : null,
      ].filter(Boolean).join(' · ') || null),
      !staff && t.status === 'review' ? clientDecision() : null,
      t.diary_done ? h('div', { class: 'card-box diary-done-box' },
        h('p', {}, h('strong', {}, '✔ Feita no diário de bordo.'), ' Falta concluir aqui no quadro.'),
        h('button', { class: 'btn primary small', type: 'button', onclick: withSaved(() => completeDialog(t, afterDialog)) }, 'Concluir tarefa')) : null,
      statusRow(status),

      // Principais, na ordem pedida.
      h('div', { class: 'card-box main-fields' },
        staff ? kindClientFields('d', val('kind'), val('client_id'), val('client_visible'), v => {
          set('kind', v.kind); set('client_id', v.client_id); set('team_visible', v.team_visible); set('client_visible', v.client_visible, true);
        }).el : field('Empresa', h('p', { class: 'with-logo' }, taskLogo(t), where(t))),
        field('Data de início (quando começou)', canEditProgress()
          ? h('input', { id: 'd-start', type: 'date', value: val('start_date') || '', onchange: e => set('start_date', e.target.value || null, true) })
          : h('p', {}, fmtDate(t.start_date) || '–'), 'd-start',
          startedByCheck && !t.start_date ? h('p', { class: 'muted small' }, 'Preenchida com hoje porque um item do checklist foi marcado. Se começou antes, ajuste a data.')
            : t.status === 'todo' && canEditProgress() ? h('p', { class: 'muted small' }, 'Ao informar o início ou marcar um item do checklist, a tarefa vai para Em andamento.') : null),
        checklistField(),
        progressField(status),
        h('div', { class: 'grid2' },
          field('Prazo', staff ? h('input', { id: 'd-due', type: 'date', value: val('due_date') || '', onchange: e => set('due_date', e.target.value || null) })
            : h('p', {}, fmtDate(t.due_date) || 'Sem prazo'), 'd-due'),
          field('Prioridade', staff ? h('select', { id: 'd-pri', onchange: e => set('priority', e.target.value) },
            Object.entries(PRIORITY).map(([v, l]) => h('option', { value: v, selected: v === val('priority') }, l)))
            : h('p', {}, PRIORITY[t.priority]), 'd-pri')),
        field('Responsáveis', staff ? (() => {
          const g = assigneeChecks(val('assignee_ids') || t.assignees.map(a => a.id), { kind: val('kind'), client_id: val('client_id'), client_visible: val('client_visible') });
          g.addEventListener('change', () => set('assignee_ids', [...g.querySelectorAll('input:checked')].map(i => Number(i.value))));
          return g;
        })() : h('p', {}, t.assignees.map(a => a.name + (a.role === 'client' ? ' (cliente)' : '')).join(', ') || '–'))),

      // O restante.
      h('div', { class: 'section' },
        field('Descrição', staff ? h('textarea', { id: 'd-desc', rows: 4, oninput: e => set('description', e.target.value) }, val('description'))
          : h('p', { class: 'pre' }, t.description || '–'), 'd-desc'),
        staff ? alertsField() : (t.alerts.length ? field('Alertas do prazo', h('p', {}, S.ALERTS.filter(a => t.alerts.includes(a.days)).map(a => a.label).join(', '))) : null),
        staff ? recurrenceField() : (t.recurrence !== 'none' ? field('Repetição', h('p', {}, S.RECURRENCE[t.recurrence] + (t.recurrence === 'custom' ? ` (a cada ${t.recurrence_every} dias)` : ''))) : null)),
      attachmentsSection(),
      adjustmentsSection(),
      commentsSection(),
      staff ? h('div', { class: 'section row' },
        !terminal ? h('button', { class: 'btn', type: 'button', onclick: guard(async () => {
          await api('POST', '/api/diary', { date: today(), task_id: t.id }); toast('Levada para o diário de bordo de hoje.');
        }) }, icon('book'), 'Levar ao diário de hoje') : null,
        h('button', { class: 'btn', onclick: () => act('POST', `/api/tasks/${t.id}/archive`, { archived: !t.archived_at }) }, t.archived_at ? 'Desarquivar' : 'Arquivar'),
        isAdmin() ? h('button', { class: 'btn danger', onclick: guard(async () => {
          if (!(await ask('Apagar esta tarefa? Isso não pode ser desfeito. Para só tirar da frente, use Arquivar.', { ok: 'Apagar tarefa', danger: true }))) return;
          await api('DELETE', `/api/tasks/${t.id}`); changedOnServer = true; draft = {}; ck = { done: new Map(), added: [], removed: new Set() };
          close(); toast('Tarefa apagada');
        }) }, 'Apagar') : null) : null,
    ].flat().filter(Boolean));
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
          ['todo', 'doing', ...(state.org.board?.stages || []).map(st => `stage-${st.id}`), 'review'].map(x =>
            h('option', { value: x, selected: x === ('status' in draft ? draft.status : savedStatus()) }, x.startsWith('stage-') ? colName(x) : S.STATUS_LABEL[x])))),
      h('button', { class: 'btn primary', type: 'button', onclick: withSaved(() => completeDialog(t, afterDialog)) }, 'Concluir…'),
      staff ? h('button', { class: 'btn', type: 'button', onclick: withSaved(() => cancelDialog(t, afterDialog)) }, 'Cancelar…') : null,
      t.column === 'overdue' ? h('p', { class: 'small danger full' }, 'Está em Atrasada porque o prazo passou. Ajuste o prazo ou conclua para tirar daqui.') : null);
  }

  // Marcar um item numa tarefa A fazer: início hoje (se vazio) e Em andamento; o % já vem do checklist.
  // Desmarcar tudo de novo desfaz o que a marcação tinha mudado.
  let startedByCheck = false;
  function checkStarts() {
    const anyDone = checklistNow().some(i => i.done);
    const st = S.startByChecklist({ status: val('status'), start_date: val('start_date') }, today());
    if (anyDone && st && canEditProgress()) {
      startedByCheck = true;
      if (!val('start_date')) set('start_date', st.start_date); else set('status', 'doing');
    } else if (!anyDone && startedByCheck && t.status === 'todo') {
      startedByCheck = false;
      delete draft.status; if (!t.start_date) delete draft.start_date;
    }
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
          onchange: e => { const orig = t.checklist.find(x => x.id === i.id); if (!!orig.done === e.target.checked) ck.done.delete(i.id); else ck.done.set(i.id, e.target.checked); checkStarts(); paint(); } }),
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

  // Anexos: enviados na hora (não esperam o Salvar). A equipe pode deixar um anexo só para a equipe.
  function attachmentsSection() {
    const list = t.attachments || [];
    const hide = h('input', { type: 'checkbox', id: 'at-hide' });
    const busy = h('span', { class: 'muted small', role: 'status' });
    const file = h('input', { type: 'file', id: 'at-file', class: 'sr-only', onchange: guard(async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) { toast('Arquivo grande demais (máximo 10 MB)'); return; }
      busy.textContent = `Enviando ${f.name}…`;
      try {
        const data = await readFileData(f);
        t = await api('POST', `/api/tasks/${t.id}/attachments`, { name: f.name, data, visible_to_client: !hide.checked });
        changedOnServer = true; paint(); toast('Anexo enviado');
      } finally { busy.textContent = ''; }
    }) });
    const download = guard(async a => {
      const f = await api('GET', `/api/attachments/${a.id}`);
      const bytes = Uint8Array.from(atob(f.data), c => c.charCodeAt(0));
      await Exports.download(new Blob([bytes], { type: f.mime }), f.name);
    });
    const size = n => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
    return h('div', { class: 'section' },
      h('h2', {}, `Anexos${list.length ? ` (${list.length})` : ''}`),
      list.length ? h('ul', { class: 'attach-list' }, list.map(a => h('li', {},
        h('button', { class: 'link grow', type: 'button', onclick: () => download(a), title: 'Baixar' }, '📎 ', a.name),
        h('span', { class: 'muted small' }, `${size(a.size)} · ${a.author || ''} · ${fmtDateTime(a.created_at)}`),
        staff && t.client_visible ? h('span', { class: 'tag' + (a.visible_to_client ? ' ok' : '') }, a.visible_to_client ? 'cliente vê' : 'só equipe') : null,
        a.user_id === state.me.id || isAdmin() ? h('button', { class: 'btn ghost small', type: 'button', 'aria-label': `Apagar ${a.name}`, onclick: guard(async () => {
          if (!(await ask(`Apagar o anexo "${a.name}"?`, { ok: 'Apagar', danger: true }))) return;
          t = await api('DELETE', `/api/attachments/${a.id}`); changedOnServer = true; paint();
        }) }, '✕') : null)))
        : h('p', { class: 'muted' }, 'Nenhum anexo.'),
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('label', { class: 'btn file-btn', for: 'at-file' }, file, '📎 Anexar arquivo'),
        staff && t.client_visible ? h('label', { for: 'at-hide', class: 'check inline' }, hide, 'Só a equipe vê') : null,
        busy),
      h('p', { class: 'muted small' }, 'Até 10 MB por arquivo: PDF, planilha, imagem, documento.'));
  }

  // Chat da equipe (quem criou, responsáveis da equipe e administradores) e, quando o cliente vê a tarefa, a conversa com ele.
  function commentsSection() {
    const bubble = c => h('div', { class: 'msg' + (c.user_id === state.me.id ? ' mine' : '') },
      h('div', { class: 'msg-meta' }, h('strong', {}, c.user_id === state.me.id ? 'Você' : c.author || 'Cliente'), ' · ', fmtDateTime(c.created_at)),
      h('div', { class: 'msg-body' }, c.body));
    const composer = (idp, placeholder, visible, label) => {
      const ta = h('textarea', { id: idp, rows: 2, placeholder, onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } } });
      const send = () => { if (ta.value.trim()) act('POST', `/api/tasks/${t.id}/comments`, { body: ta.value, visible_to_client: visible }); };
      return h('div', { class: 'composer' }, h('label', { for: idp, class: 'sr-only' }, label), ta,
        h('button', { class: 'btn primary icon-only', type: 'button', 'aria-label': 'Enviar', title: 'Enviar', onclick: send }, icon('send')));
    };
    if (!staff) {
      return h('div', { class: 'section' }, h('h2', {}, 'Conversa com a equipe'),
        h('div', { class: 'msgs' }, t.comments.length ? t.comments.map(bubble) : h('p', { class: 'muted' }, 'Nenhuma mensagem ainda.')),
        composer('cm-body', 'Escreva para a equipe', true, 'Mensagem'));
    }
    const people = (t.chat_people || []).map(p => p.name.split(' ')[0]).join(', ');
    return [
      h('div', { class: 'section' }, h('h2', {}, icon('chat'), ' Chat da equipe'),
        h('p', { class: 'muted small' }, `Só quem criou, os responsáveis da equipe e o administrador: ${people || '–'}. O cliente não vê.`),
        t.can_chat ? [
          h('div', { class: 'msgs' }, t.chat.length ? t.chat.map(bubble) : h('p', { class: 'muted' }, 'Nenhuma mensagem ainda. Comece a conversa.')),
          composer('cm-chat', 'Escreva para a equipe da tarefa (Enter envia)', false, 'Mensagem para a equipe da tarefa'),
        ] : h('p', { class: 'muted' }, 'Você vê esta tarefa, mas não está no chat dela.')),
      t.client_visible ? h('div', { class: 'section' }, h('h2', {}, 'Conversa com o cliente'),
        h('p', { class: 'muted small' }, 'O cliente vê e responde aqui.'),
        h('div', { class: 'msgs' }, t.comments.length ? t.comments.map(bubble) : h('p', { class: 'muted' }, 'Nenhuma mensagem com o cliente.')),
        composer('cm-client', 'Escreva para o cliente (Enter envia)', true, 'Mensagem para o cliente')) : null,
    ];
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
      h('thead', {}, h('tr', {}, h('th', {}, 'Cliente'), isAdmin() ? h('th', {}, 'Equipe que acompanha') : null, h('th', { class: 'num' }, 'Externas abertas'), h('th', { class: 'num' }, 'Internas abertas'), h('th', {}, ''))),
      h('tbody', {}, state.clients.map(c => h('tr', {},
        h('td', {}, h('span', { class: 'with-logo' }, logoEl(c.name, c.logo, 'md'), c.name)),
        isAdmin() ? h('td', { 'data-label': 'Equipe' }, (c.team || []).map(uid => (state.users.find(u => u.id === uid) || {}).name).filter(Boolean).join(', ') || h('span', { class: 'muted small' }, 'Só o administrador e os responsáveis')) : null,
        h('td', { class: 'num' }, c.open_external), h('td', { class: 'num' }, c.open_internal),
        h('td', { class: 'actions' },
          h('button', { class: 'btn small', onclick: () => { Object.assign(state.view, { client: String(c.id), kind: '' }); saveView(); location.hash = '#/tarefas'; } }, 'Ver tarefas'),
          isAdmin() ? [
            h('button', { class: 'btn small', onclick: () => clientTeamDialog(c) }, 'Equipe'),
            logoPicker(c.logo ? 'Trocar logo' : 'Pôr logo', async src => { await api('PATCH', `/api/clients/${c.id}`, { logo: src }); toast('Logo salvo'); route(); }),
            c.logo ? h('button', { class: 'btn small', onclick: guard(async () => { await api('PATCH', `/api/clients/${c.id}`, { logo: null }); route(); }) }, 'Tirar logo') : null,
            h('button', { class: 'btn small', onclick: guard(async () => {
              const name = await askText('Novo nome do cliente', c.name);
              if (name) { await api('PATCH', `/api/clients/${c.id}`, { name }); route(); }
            }) }, 'Renomear')] : null)))))
      : h('p', { class: 'empty' }, 'Nenhum cliente ainda.')),
  ]);
}

// Quem da equipe acompanha o cliente: vê todas as tarefas externas dele, mesmo sem ser responsável.
function clientTeamDialog(c) {
  const members = state.users.filter(u => u.role === 'member' && u.active);
  modal(close => {
    const err = h('p', { class: 'error', role: 'alert' });
    return h('form', { onsubmit: guard(async e => {
      e.preventDefault();
      try {
        await api('PUT', `/api/clients/${c.id}/team`, { user_ids: [...e.target.querySelectorAll('input:checked')].map(i => Number(i.value)) });
        state.users = await api('GET', '/api/users'); close(); toast('Equipe do cliente salva'); route();
      } catch (ex) { err.textContent = ex.message; }
    }) },
      h('h2', {}, `Equipe de ${c.name}`),
      h('p', { class: 'muted small' }, 'Quem estiver marcado vê todas as tarefas externas deste cliente. Os outros da equipe só veem as tarefas em que são responsáveis. Administradores veem todas.'),
      members.length ? h('div', { class: 'checks', role: 'group', 'aria-label': 'Equipe' },
        members.map(u => h('label', {}, h('input', { type: 'checkbox', value: u.id, checked: (c.team || []).includes(u.id) }), u.name)))
        : h('p', { class: 'muted' }, 'Ninguém da equipe cadastrado ainda (Pessoas → Equipe Opps).'),
      err,
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', type: 'submit' }, 'Salvar'),
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar')));
  });
}

// ---------- notificações ----------
function ago(s) {
  const min = Math.round((Date.now() - new Date(s.replace(' ', 'T') + 'Z')) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  return fmtDateTime(s);
}
const goTo = link => { if (location.hash === link) route(); else location.hash = link; };
async function viewInbox() {
  const r = await api('GET', '/api/inbox');
  state.inboxUnread = r.unread;
  const KIND = { chat: ['chat', 'Chat'], task_chat: ['chat', 'Chat da tarefa'], task_comment: ['chat', 'Conversa na tarefa'], task: ['board', 'Tarefa'] };
  const open = guard(async n => { if (!n.read_at) await api('POST', `/api/inbox/${n.id}/read`); goTo(n.link || '#/painel'); });
  shell([
    r.unread ? h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', onclick: guard(async () => { await api('POST', '/api/inbox/read-all'); route(); }) },
      icon('check'), 'Marcar todas como lidas')) : null,
    h('div', { class: 'card-box inbox' }, r.items.length ? r.items.map(n => h('button', { type: 'button', class: 'inbox-item' + (n.read_at ? '' : ' unread'), onclick: () => open(n) },
      h('span', { class: 'inbox-ic', 'aria-hidden': 'true' }, icon((KIND[n.kind] || ['bell'])[0])),
      h('span', { class: 'grow' },
        h('span', { class: 'inbox-kind' }, (KIND[n.kind] || [, 'Aviso'])[1]),
        h('strong', {}, n.title, n.count > 1 ? h('span', { class: 'inbox-count' }, ` · ${n.count} novas`) : null),
        n.body ? h('span', { class: 'inbox-body' }, n.body) : null),
      h('span', { class: 'muted small when' }, ago(n.created_at)))) : h('p', { class: 'empty' }, 'Nenhuma notificação por enquanto. Mensagens nos chats, conversas nas tarefas e tarefas criadas para você aparecem aqui.')),
  ], { title: 'Notificações', sub: 'Chats, conversas nas tarefas e tarefas criadas para você' });
}

// ---------- chats ----------
let chatTimer = null;
const firstName = n => String(n || '').split(' ')[0];
const roleTag = u => (u.role === 'client' ? (u.client_name || 'Cliente') : u.role === 'admin' ? 'Administrador' : state.org.name);
async function viewChats(convId) {
  clearInterval(chatTimer);
  const [list, data] = await Promise.all([api('GET', '/api/conversations'), convId ? api('GET', `/api/conversations/${convId}/messages`) : null]);
  try { await refreshAlerts(); } catch { /* segue */ }
  const listEl = h('div', { class: 'chat-list card-box' },
    h('div', { class: 'chat-list-head' }, h('button', { class: 'btn primary', type: 'button', onclick: guard(newChatDialog) }, icon('plus'), 'Nova conversa')),
    list.length ? list.map(c => h('a', { class: 'chat-row' + (c.id === convId ? ' active' : '') + (c.unread ? ' unread' : ''), href: `#/chats/${c.id}` },
      h('span', { class: 'avatar' + (c.is_group ? ' group' : '') }, c.is_group ? icon('users') : initials(c.title)),
      h('span', { class: 'grow chat-row-text' }, h('strong', {}, c.title),
        h('span', { class: 'muted small' }, c.last ? `${c.last.author === state.me.name ? 'Você' : firstName(c.last.author)}: ${c.last.body}` : (c.is_group ? `${c.members.length} pessoas` : 'Sem mensagens'))),
      c.unread ? h('span', { class: 'badge' }, c.unread) : null))
      : h('p', { class: 'empty' }, 'Nenhuma conversa ainda. Comece uma em "Nova conversa".'));
  let pane;
  if (data) {
    const c = data.conversation;
    const seen = new Set();
    let lastId = 0;
    const msgs = h('div', { class: 'msgs chat-msgs', 'aria-live': 'polite' });
    const add = m => {
      if (seen.has(m.id)) return;
      seen.add(m.id); lastId = Math.max(lastId, m.id);
      msgs.querySelector('.empty')?.remove();
      msgs.append(h('div', { class: 'msg' + (m.user_id === state.me.id ? ' mine' : '') },
        c.is_group && m.user_id !== state.me.id ? h('div', { class: 'msg-meta' }, h('strong', {}, m.author || '–')) : null,
        h('div', { class: 'msg-body' }, m.body), h('div', { class: 'msg-time' }, fmtDateTime(m.created_at))));
    };
    if (!data.messages.length) msgs.append(h('p', { class: 'empty muted' }, 'Nenhuma mensagem ainda. Diga olá!'));
    data.messages.forEach(add);
    const ta = h('textarea', { id: 'chat-text', rows: 1, placeholder: 'Escreva uma mensagem (Enter envia)',
      onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } } });
    const send = guard(async () => {
      const body = ta.value.trim();
      if (!body) return;
      ta.value = '';
      add(await api('POST', `/api/conversations/${c.id}/messages`, { body }));
      msgs.scrollTop = msgs.scrollHeight;
    });
    pane = h('section', { class: 'chat-pane card-box', 'aria-label': `Conversa: ${c.title}` },
      h('header', { class: 'chat-head' },
        h('a', { class: 'btn small chat-back', href: '#/chats' }, '‹ Conversas'),
        h('span', { class: 'avatar' + (c.is_group ? ' group' : '') }, c.is_group ? icon('users') : initials(c.title)),
        h('div', { class: 'grow' }, h('strong', {}, c.title),
          h('div', { class: 'muted small' }, c.is_group ? c.members.map(m => m.id === state.me.id ? 'você' : firstName(m.name)).join(', ')
            : roleTag(c.members.find(m => m.id !== state.me.id) || {}))),
        c.is_group ? h('button', { class: 'btn small', type: 'button', onclick: () => groupDialog(c) }, 'Grupo') : null),
      msgs,
      h('div', { class: 'composer' }, h('label', { for: 'chat-text', class: 'sr-only' }, 'Mensagem'), ta,
        h('button', { class: 'btn primary icon-only', type: 'button', 'aria-label': 'Enviar', title: 'Enviar', onclick: send }, icon('send'))));
    // Mensagens novas chegam sozinhas enquanto a conversa está aberta.
    chatTimer = setInterval(async () => {
      if (location.hash !== `#/chats/${c.id}`) { clearInterval(chatTimer); return; }
      if (document.hidden) return;
      try {
        const r = await api('GET', `/api/conversations/${c.id}/messages?after=${lastId}`);
        const near = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
        r.messages.forEach(add);
        if (r.messages.length && near) msgs.scrollTop = msgs.scrollHeight;
      } catch { /* tenta de novo */ }
    }, 4000);
    requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
  } else {
    pane = h('section', { class: 'chat-pane card-box chat-empty' }, icon('chat'), h('p', {}, 'Escolha uma conversa ou comece uma nova.'),
      h('p', { class: 'muted small' }, 'Você conversa com quem tem empresa em comum: a equipe entre si, a equipe com os clientes que acompanha e as pessoas do mesmo cliente. O administrador fala com todos.'));
  }
  shell([h('div', { class: 'chat-wrap' + (data ? ' has-conv' : '') }, listEl, pane)],
    { title: 'Chats', sub: 'Conversas 1 a 1 ou em grupo, fora das tarefas' });
  if (data) document.getElementById('chat-text')?.focus({ preventScroll: true });
}

// Escolher pessoas: só aparece quem tem empresa em comum com você.
function peoplePicker(contacts, { selected = [], exclude = [] } = {}) {
  const search = h('input', { type: 'search', placeholder: 'Procurar pessoa', 'aria-label': 'Procurar pessoa',
    oninput: () => { const q = search.value.toLowerCase(); box.querySelectorAll('label').forEach(l => { l.hidden = !l.textContent.toLowerCase().includes(q); }); } });
  const box = h('div', { class: 'checks people-checks', role: 'group', 'aria-label': 'Pessoas' },
    contacts.filter(u => !exclude.includes(u.id)).map(u => h('label', {}, h('input', { type: 'checkbox', value: u.id, checked: selected.includes(u.id) }),
      h('span', {}, u.name, h('span', { class: 'muted small' }, ` · ${roleTag(u)}`)))));
  return { el: h('div', {}, search, box), ids: () => [...box.querySelectorAll('input:checked')].map(i => Number(i.value)), box };
}
async function newChatDialog() {
  const contacts = await api('GET', '/api/chat/contacts');
  modal(close => {
    const err = h('p', { class: 'error', role: 'alert' });
    const picker = peoplePicker(contacts);
    const name = h('input', { id: 'nc-name', maxlength: 80, placeholder: 'Ex.: Fechamento Padaria' });
    const nameField = h('div', { class: 'field', hidden: true }, h('label', { for: 'nc-name' }, 'Nome do grupo (opcional)'), name);
    picker.box.addEventListener('change', () => { nameField.hidden = picker.ids().length < 2; });
    return h('form', { onsubmit: guard(async e => {
      e.preventDefault();
      const ids = picker.ids();
      if (!ids.length) { err.textContent = 'Escolha pelo menos uma pessoa.'; return; }
      try {
        const c = await api('POST', '/api/conversations', { user_ids: ids, title: name.value });
        close(); location.hash = `#/chats/${c.id}`;
      } catch (ex) { err.textContent = ex.message; }
    }) },
      h('h2', {}, 'Nova conversa'),
      h('p', { class: 'muted small' }, 'Uma pessoa: conversa particular. Duas ou mais: grupo. Só aparece quem tem empresa em comum com você.'),
      contacts.length ? picker.el : h('p', { class: 'muted' }, 'Ninguém com empresa em comum com você ainda.'),
      nameField, err,
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', type: 'submit' }, 'Começar conversa'),
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar')));
  });
}
async function groupDialog(c) {
  const canEdit = isAdmin() || c.created_by === state.me.id;
  const contacts = canEdit ? await api('GET', '/api/chat/contacts') : [];
  modal(close => {
    const err = h('p', { class: 'error', role: 'alert' });
    const name = h('input', { id: 'g-name', maxlength: 80, value: c.title });
    const picker = peoplePicker(contacts, { exclude: c.members.map(m => m.id) });
    return h('div', {},
      h('h2', {}, c.title),
      h('h3', {}, 'Participantes'),
      h('ul', { class: 'plain' }, c.members.map(m => h('li', {}, m.id === state.me.id ? `${m.name} (você)` : m.name, h('span', { class: 'muted small' }, ` · ${roleTag(m)}`)))),
      canEdit ? h('form', { onsubmit: guard(async e => {
        e.preventDefault();
        try {
          await api('PATCH', `/api/conversations/${c.id}`, { title: name.value, add_user_ids: picker.ids() });
          close(); toast('Grupo atualizado'); route();
        } catch (ex) { err.textContent = ex.message; }
      }) },
        h('div', { class: 'field' }, h('label', { for: 'g-name' }, 'Nome do grupo'), name),
        h('h3', {}, 'Adicionar pessoas'), picker.el, err,
        h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', type: 'submit' }, 'Salvar'))) : null,
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'btn danger', type: 'button', onclick: guard(async () => {
          if (!(await ask(`Sair do grupo "${c.title}"? Você deixa de ver as mensagens.`, { ok: 'Sair do grupo', danger: true }))) return;
          await api('POST', `/api/conversations/${c.id}/leave`); close(); location.hash = '#/chats';
        }) }, 'Sair do grupo'),
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar')));
  });
}

// ---------- diário de bordo ----------
// O rumo do dia: o que fazer, início e fim, e a Tríade do Tempo (importante, urgente, circunstancial). Concluir é um clique.
const diaryView = { date: '', user_id: null, cat: 'important' };
const TRIAD_KEYS = Object.keys(S.TRIAD);
const nowTime = () => new Date().toTimeString().slice(0, 5);
const hm = m => (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`);
async function viewDiary() {
  const v = diaryView;
  const date = v.date || today();
  const mine = !v.user_id || v.user_id === state.me.id;
  const q = mine ? '' : `&user_id=${v.user_id}`;
  const [d, week] = await Promise.all([api('GET', `/api/diary?date=${date}${q}`), api('GET', `/api/diary?from=${S.addDays(date, -6)}&to=${date}${q}`)]);
  const shift = n => { v.date = S.addDays(date, n); route(); };
  const catChip = (e, editable) => h(editable ? 'button' : 'span', { type: editable ? 'button' : null, class: `triad triad-${e.category}`,
    title: editable ? 'Trocar a classificação' : S.TRIAD[e.category].hint,
    onclick: editable ? guard(async () => { await api('PATCH', `/api/diary/${e.id}`, { category: TRIAD_KEYS[(TRIAD_KEYS.indexOf(e.category) + 1) % 3] }); route(); }) : null },
    S.TRIAD[e.category].label);
  // Concluir: com início e término (Iniciar e Encerrar já preenchem; pela caixinha, pergunta).
  const finish = async (e, patch) => {
    await api('PATCH', `/api/diary/${e.id}`, { ...patch, done: true });
    if (e.task && !['done', 'cancelled'].includes(e.task.status)) {
      if (await ask(`Feito! A tarefa "${e.task.title}" ainda está aberta no quadro. Concluir lá também?`, { ok: 'Concluir a tarefa' })) {
        completeDialog(await api('GET', `/api/tasks/${e.task.id}`), () => route());
        return;
      }
    }
    route();
  };
  const toggle = guard(async (e, done) => {
    if (!done) { await api('PATCH', `/api/diary/${e.id}`, { done: false }); route(); return; }
    if (e.start_time && e.end_time) { await finish(e, {}); return; }
    const times = await askTimes(e);
    if (!times) { route(); return; }
    await finish(e, times);
  });
  const ids = d.entries.map(e => e.id);
  const reorder = guard(async list => { await api('PUT', '/api/diary/order', { ids: list }); route(); });
  const move = (e, dir) => { const l = [...ids]; const i = l.indexOf(e.id); const j = i + dir; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; reorder(l); };
  let dragId = null;
  const row = (e, i) => h('li', { class: 'diary-item' + (e.done ? ' done' : ''), draggable: mine ? 'true' : null, 'data-id': e.id,
    ondragstart: mine ? ev => { dragId = e.id; ev.dataTransfer.effectAllowed = 'move'; ev.currentTarget.classList.add('dragging'); } : null,
    ondragend: mine ? ev => ev.currentTarget.classList.remove('dragging') : null,
    ondragover: mine ? ev => { if (dragId && dragId !== e.id) { ev.preventDefault(); ev.currentTarget.classList.add('drop-here'); } } : null,
    ondragleave: mine ? ev => ev.currentTarget.classList.remove('drop-here') : null,
    ondrop: mine ? ev => {
      ev.preventDefault(); ev.currentTarget.classList.remove('drop-here');
      if (!dragId || dragId === e.id) return;
      const l = ids.filter(x => x !== dragId); l.splice(l.indexOf(e.id) + (ids.indexOf(dragId) < ids.indexOf(e.id) ? 1 : 0), 0, dragId); dragId = null; reorder(l);
    } : null },
    mine ? h('span', { class: 'drag-handle', title: 'Arraste para mudar de lugar', 'aria-hidden': 'true' }, '⋮⋮') : null,
    mine ? h('input', { type: 'checkbox', class: 'big-check', checked: e.done, 'aria-label': `Feito: ${e.title}`, onchange: ev => toggle(e, ev.target.checked) })
      : h('span', { class: 'big-check ro', 'aria-label': e.done ? 'Feito' : 'Não feito' }, e.done ? '✔' : ''),
    h('div', { class: 'grow diary-main' },
      h(mine ? 'button' : 'span', { type: mine ? 'button' : null, class: 'diary-title', onclick: mine ? () => diaryEdit(e) : null }, e.title),
      h('div', { class: 'diary-meta' },
        catChip(e, mine),
        e.start_time || e.end_time ? h('span', { class: 'tag' }, icon('clock'), ` ${e.start_time || '?'}–${e.end_time || '…'}`, S.minutesOf(e) ? ` · ${hm(S.minutesOf(e))}` : '',
          e.paused_minutes ? ` · ${hm(e.paused_minutes)} de pausa` : '') : null,
        e.paused_at && !e.done ? h('span', { class: 'tag paused' }, `⏸ Pausada desde ${e.paused_at}`) : null,
        mine && !e.start_time && !e.done ? h('button', { class: 'btn small start-btn', type: 'button', onclick: guard(async () => { await api('PATCH', `/api/diary/${e.id}`, { start_time: nowTime() }); route(); }) }, '▶ Iniciar') : null,
        mine && e.start_time && !e.end_time && !e.done && !e.paused_at ? h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
          const at = nowTime(); await api('PATCH', `/api/diary/${e.id}`, { pause_at: at < e.start_time ? e.start_time : at }); route();
        }) }, '⏸ Pausar') : null,
        mine && e.paused_at && !e.done ? h('button', { class: 'btn small start-btn', type: 'button', onclick: guard(async () => {
          const at = nowTime(); await api('PATCH', `/api/diary/${e.id}`, { resume_at: at < e.paused_at ? e.paused_at : at }); route();
        }) }, '▶ Retomar') : null,
        mine && e.start_time && !e.end_time && !e.done ? h('button', { class: 'btn small primary', type: 'button', onclick: guard(async () => {
          const end = nowTime();
          await finish(e, { end_time: end < e.start_time ? e.start_time : end });
        }) }, '■ Encerrar') : null,
        e.task ? h('button', { class: 'tag task-link', type: 'button', onclick: () => openTask(e.task.id), title: 'Abrir a tarefa' }, icon('board'), ' Tarefa', ['done', 'cancelled'].includes(e.task.status) ? ' (concluída)' : '') : null,
        mine && !e.task_id && !e.done ? h('button', { class: 'btn small', type: 'button', onclick: () => diaryToTask(e) }, '→ Virar tarefa') : null,
        mine ? h('button', { class: 'btn small', type: 'button', title: 'Copiar para o dia seguinte', onclick: guard(async () => {
          const c = await api('POST', `/api/diary/${e.id}/clone`, {}); toast(`Clonada para ${fmtDate(c.date)}.`);
        }) }, '⧉ Clonar') : null)),
    mine ? h('div', { class: 'diary-side' },
      h('button', { class: 'icon-btn small', type: 'button', 'aria-label': `Subir ${e.title}`, title: 'Subir', disabled: i === 0, onclick: () => move(e, -1) }, '↑'),
      h('button', { class: 'icon-btn small', type: 'button', 'aria-label': `Descer ${e.title}`, title: 'Descer', disabled: i === ids.length - 1, onclick: () => move(e, 1) }, '↓'),
      h('button', { class: 'icon-btn small', type: 'button', 'aria-label': `Apagar ${e.title}`, title: 'Apagar', onclick: guard(async () => {
        if (await ask(`Apagar "${e.title}" do diário?`, { ok: 'Apagar', danger: true })) { await api('DELETE', `/api/diary/${e.id}`); route(); }
      }) }, '×')) : null);

  // Anotar rápido: o que, início, fim e a Tríade.
  const addForm = () => {
    const title = h('input', { id: 'dy-title', name: 'title', placeholder: 'O que você vai fazer?', maxlength: 200, required: true, autocomplete: 'off' });
    const seg = h('div', { class: 'seg triad-seg', role: 'radiogroup', 'aria-label': 'Tríade do Tempo' },
      TRIAD_KEYS.map(k => h('button', { type: 'button', role: 'radio', class: `seg-btn triad-${k}`, 'aria-checked': String(v.cat === k), title: S.TRIAD[k].hint,
        onclick: ev => { v.cat = k; seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b === ev.currentTarget))); } }, S.TRIAD[k].label)));
    return h('form', { class: 'card-box diary-add', onsubmit: guard(async ev => {
      ev.preventDefault();
      const f = ev.target.elements;
      await api('POST', '/api/diary', { date, title: f.title.value, category: v.cat });
      await route();
      document.getElementById('dy-title')?.focus();
    }) },
      h('label', { for: 'dy-title', class: 'sr-only' }, 'O que você vai fazer'), title,
      h('div', { class: 'row' },
        seg,
        h('button', { class: 'btn primary', type: 'submit' }, icon('plus'), 'Anotar')));
  };

  const sum = S.diarySummary(d.entries);
  const triadBars = s => h('div', { class: 'triad-bars' }, TRIAD_KEYS.map(k => h('div', { class: 'triad-bar-row' },
    h('span', { class: `triad triad-${k}` }, S.TRIAD[k].label),
    h('div', { class: 'triad-bar' }, h('span', { class: `fill triad-${k}`, style: `width:${s.by[k].share}%` }), h('i', { class: 'ideal', style: `left:${S.TRIAD[k].ideal}%`, title: `Referência: ${S.TRIAD[k].ideal}%` })),
    h('strong', { class: 'num' }, `${s.by[k].share}%`),
    h('span', { class: 'muted small' }, s.basis === 'minutes' ? hm(s.by[k].minutes) : `${s.by[k].count} item${s.by[k].count === 1 ? '' : 's'}`))));
  const verdict = s => {
    if (!s.total) return null;
    const imp = s.by.important.share, urg = s.by.urgent.share, circ = s.by.circumstantial.share;
    if (imp >= 60) return 'Dia no rumo: a maior parte foi no importante.';
    if (urg >= 40) return 'Dia de apagar incêndio: muito urgente. Vale planejar antes para o importante não virar urgente.';
    if (circ >= 30) return 'Muito tempo no circunstancial (interrupções e pedidos de última hora). Dá para cortar ou delegar?';
    return 'Dia equilibrado. A referência da Tríade é ficar perto de 70% no importante.';
  };
  const report = h('div', { class: 'card-box diary-report' },
    h('h2', {}, date === today() ? 'Como está o dia' : 'Como foi o dia'),
    sum.total ? [
      h('div', { class: 'stats-row' },
        h('div', { class: 'stat' }, h('strong', {}, `${sum.done}/${sum.total}`), h('span', {}, 'feitas')),
        h('div', { class: 'stat' }, h('strong', {}, `${sum.pct}%`), h('span', {}, 'concluído')),
        h('div', { class: 'stat' }, h('strong', {}, sum.minutes ? hm(sum.minutes) : '–'), h('span', {}, 'tempo anotado'))),
      triadBars(sum),
      h('p', { class: 'muted small' }, sum.basis === 'minutes' ? 'Divisão pelo tempo anotado (início e fim). A marca em cada barra é a referência da Tríade do Tempo: 70% importante, 20% urgente, 10% circunstancial.'
        : 'Sem horários anotados: a divisão é pela quantidade de itens. A marca em cada barra é a referência da Tríade: 70% importante, 20% urgente, 10% circunstancial.'),
      h('p', { class: 'verdict' }, verdict(sum)),
    ] : h('p', { class: 'muted' }, 'Nada anotado neste dia.'));
  const days = [...Array(7)].map((_, i) => S.addDays(date, i - 6));
  const weekSum = S.diarySummary(week.entries);
  const weekTable = h('div', { class: 'card-box table-wrap' }, h('h2', {}, 'Últimos 7 dias'),
    h('table', { class: 'week-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Dia'), h('th', { class: 'num' }, 'Feitas'), h('th', { class: 'num' }, 'Tempo'),
      TRIAD_KEYS.map(k => h('th', { class: 'num', title: S.TRIAD[k].label }, S.TRIAD[k].label.slice(0, 4) + '.')))),
      h('tbody', {}, days.map(day => {
        const s = S.diarySummary(week.entries.filter(e => e.date === day));
        return h('tr', { class: 'row-link' + (day === date ? ' current' : ''), onclick: () => { v.date = day; route(); } },
          h('td', {}, new Date(day + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') + ' ' + fmtShort(day)),
          h('td', { class: 'num' }, s.total ? `${s.done}/${s.total}` : '–'), h('td', { class: 'num' }, s.minutes ? hm(s.minutes) : '–'),
          TRIAD_KEYS.map(k => h('td', { class: 'num' }, s.total ? `${s.by[k].share}%` : '–')));
      }),
      h('tr', { class: 'total' }, h('td', {}, h('strong', {}, 'Semana')), h('td', { class: 'num' }, weekSum.total ? `${weekSum.done}/${weekSum.total}` : '–'),
        h('td', { class: 'num' }, weekSum.minutes ? hm(weekSum.minutes) : '–'), TRIAD_KEYS.map(k => h('td', { class: 'num' }, weekSum.total ? `${weekSum.by[k].share}%` : '–'))))));

  const staffPeople = isAdmin() ? state.users.filter(u => u.role !== 'client' && u.active) : [];
  shell([
    h('div', { class: 'toolbar' },
      h('div', { class: 'cal-nav diary-nav' },
        h('button', { class: 'btn small', type: 'button', onclick: () => shift(-1), 'aria-label': 'Dia anterior' }, '‹'),
        h('input', { type: 'date', value: date, 'aria-label': 'Dia', onchange: e => { if (e.target.value) { v.date = e.target.value; route(); } } }),
        h('button', { class: 'btn small', type: 'button', onclick: () => shift(1), 'aria-label': 'Próximo dia' }, '›'),
        date !== today() ? h('button', { class: 'btn small', type: 'button', onclick: () => { v.date = ''; route(); } }, 'Hoje') : null),
      staffPeople.length ? h('select', { 'aria-label': 'Diário de quem', onchange: e => { v.user_id = Number(e.target.value) || null; route(); } },
        staffPeople.map(u => h('option', { value: u.id, selected: (v.user_id || state.me.id) === u.id }, u.id === state.me.id ? `${u.name} (você)` : u.name))) : null),
    mine ? addForm() : h('p', { class: 'muted' }, 'Você está vendo o diário de outra pessoa (só leitura).'),
    h('div', { class: 'diary-grid' },
      h('div', {},
        h('div', { class: 'card-box' }, h('h2', {}, date === today() ? 'Hoje' : new Date(date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })),
          d.entries.length ? h('ul', { class: 'diary-list' }, d.entries.map(row))
            : h('p', { class: 'empty' }, mine ? 'Nada anotado. Escreva acima o que vai fazer hoje, ou traga uma tarefa do quadro.' : 'Nada anotado neste dia.')),
        mine && d.tasks.length ? h('div', { class: 'card-box' }, h('h2', {}, 'Tarefas do quadro para hoje'),
          h('p', { class: 'muted small' }, 'Abertas em que você é responsável, vencendo até este dia ou em andamento. Leve para o diário só com o título.'),
          h('ul', { class: 'diary-tasks' }, d.tasks.map(t => h('li', {},
            h('button', { class: 'grow link-btn', type: 'button', onclick: () => openTask(t.id) }, t.title,
              h('span', { class: 'muted small' }, [t.client_name, t.due_date ? `prazo ${fmtShort(t.due_date)}` : null].filter(Boolean).map(x => ` · ${x}`).join(''))),
            t.due_date && t.due_date < date ? h('span', { class: 'tag late' }, 'Atrasada') : null,
            h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
              await api('POST', '/api/diary', { date, task_id: t.id, category: t.priority === 'high' || (t.due_date && t.due_date <= date) ? 'urgent' : 'important' }); route();
            }) }, '+ Diário'))))) : null),
      h('div', {}, report, weekTable)),
  ], { title: 'Diário de bordo', sub: 'O rumo do dia: o que fazer, quando e se é importante, urgente ou circunstancial' });
}
// Ao concluir pela caixinha: pede a hora de início e de término.
function askTimes(e) {
  return new Promise(resolve => {
    modal(close => {
      const err = h('p', { class: 'error', role: 'alert' });
      const start = h('input', { id: 'at-start', type: 'time', value: e.start_time || '', required: true });
      const end = h('input', { id: 'at-end', type: 'time', value: e.end_time || nowTime(), required: true });
      return h('form', { onsubmit: ev => {
        ev.preventDefault();
        if (end.value < start.value) { err.textContent = 'O término é antes do início.'; return; }
        resolve({ start_time: start.value, end_time: end.value }); close();
      } },
        h('h2', {}, 'Concluir'),
        h('p', {}, e.title),
        h('div', { class: 'grid2' },
          h('div', { class: 'field' }, h('label', { for: 'at-start' }, 'Início'), start),
          h('div', { class: 'field' }, h('label', { for: 'at-end' }, 'Término'), end)),
        h('p', { class: 'muted small' }, 'Dica: use ▶ Iniciar quando começar e ■ Encerrar quando terminar, e os horários entram sozinhos.'),
        err,
        h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Concluir'), h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancelar')));
    }, { onclose: () => resolve(null) });
  });
}
function diaryEdit(e) {
  modal(close => {
    const err = h('p', { class: 'error', role: 'alert' });
    return h('form', { onsubmit: guard(async ev => {
      ev.preventDefault();
      const f = ev.target.elements;
      try {
        await api('PATCH', `/api/diary/${e.id}`, { title: f.title.value, date: f.date.value, start_time: f.start.value || null, end_time: f.end.value || null, category: f.category.value,
          paused_minutes: Number(f.paused.value) || 0 });
        close(); route();
      } catch (ex) { err.textContent = ex.message; }
    }) },
      h('h2', {}, 'Editar item do diário'),
      h('div', { class: 'field' }, h('label', { for: 'de-title' }, 'O que fazer'), h('input', { id: 'de-title', name: 'title', value: e.title, maxlength: 200, required: true })),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'de-start' }, 'Início'), h('input', { id: 'de-start', name: 'start', type: 'time', value: e.start_time || '' })),
        h('div', { class: 'field' }, h('label', { for: 'de-end' }, 'Fim'), h('input', { id: 'de-end', name: 'end', type: 'time', value: e.end_time || '' }))),
      h('div', { class: 'field' }, h('label', { for: 'de-paused' }, 'Pausas (minutos)'), h('input', { id: 'de-paused', name: 'paused', type: 'number', min: 0, max: 1440, step: 1, value: e.paused_minutes || 0 }),
        h('p', { class: 'muted small' }, 'Descontado do tempo entre o início e o fim.')),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'de-cat' }, 'Tríade do Tempo'), h('select', { id: 'de-cat', name: 'category' },
          TRIAD_KEYS.map(k => h('option', { value: k, selected: e.category === k }, `${S.TRIAD[k].label}: ${S.TRIAD[k].hint}`)))),
        h('div', { class: 'field' }, h('label', { for: 'de-date' }, 'Dia'), h('input', { id: 'de-date', name: 'date', type: 'date', value: e.date, required: true }))),
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Salvar'), h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar')));
  });
}
// Do diário para o quadro: escolhe interna ou de cliente e o prazo; você fica de responsável.
function diaryToTask(e) {
  modal(close => {
    const err = h('p', { class: 'error', role: 'alert' });
    const clientSel = h('select', { id: 'dt-client', name: 'client' }, h('option', { value: '' }, `Nenhuma (${state.org.name})`),
      state.clients.map(c => h('option', { value: c.id }, c.name)));
    return h('form', { onsubmit: guard(async ev => {
      ev.preventDefault();
      const f = ev.target.elements;
      try {
        const out = await api('POST', `/api/diary/${e.id}/task`, { kind: f.kind.value, client_id: f.client.value ? Number(f.client.value) : null, due_date: f.due.value || null });
        close(); toast('Virou tarefa no quadro. Você é o responsável.'); route();
        return out;
      } catch (ex) { err.textContent = ex.message; }
    }) },
      h('h2', {}, 'Virar tarefa'),
      h('p', {}, e.title),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'dt-kind' }, 'Tipo'), h('select', { id: 'dt-kind', name: 'kind' },
          h('option', { value: 'internal' }, 'Interna (nossa)'), h('option', { value: 'external' }, 'Externa (de cliente)'))),
        h('div', { class: 'field' }, h('label', { for: 'dt-client' }, 'Empresa'), clientSel)),
      h('div', { class: 'field' }, h('label', { for: 'dt-due' }, 'Prazo'), h('input', { id: 'dt-due', name: 'due', type: 'date', value: e.date })),
      h('p', { class: 'muted small' }, 'Você fica como responsável. Para mudar o resto (descrição, checklist, outras pessoas), abra a tarefa depois.'),
      err,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Criar tarefa'), h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar')));
  });
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
      h('li', {}, h('strong', {}, 'Administrador: '), 'vê todas as externas e as internas que criou ou em que é responsável; gerencia pessoas, clientes e marca.'),
      h('li', {}, h('strong', {}, `${roleLabel('member')}: `), 'cria tarefas; vê as que criou, as em que é responsável e as externas dos clientes que acompanha (Clientes → Equipe).'),
      h('li', {}, h('strong', {}, 'Cliente: '), 'vê as externas da empresa dele e as internas marcadas como visíveis; pode ser responsável, aprova entregas e pede ajustes.')),
    err, h('button', { class: 'btn primary', type: 'submit' }, 'Criar acesso')) : null;
  shell([
    form,
    h('div', { class: 'card-box table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Nome'), h('th', {}, 'Email'), h('th', {}, 'Visão'), h('th', {}, 'Situação'), h('th', {}, ''))),
      h('tbody', {}, state.users.map(u => h('tr', {},
        h('td', {}, u.name), h('td', {}, u.email), h('td', {}, roleLabel(u.role) + (u.client_name ? ` · ${u.client_name}` : ''),
          u.role === 'member' && u.client_ids?.length ? h('div', { class: 'muted small' }, 'Acompanha: ' + u.client_ids.map(id => (state.clients.find(c => c.id === id) || {}).name).filter(Boolean).join(', ')) : null),
        h('td', {}, u.active ? 'Ativo' : 'Desativado'),
        h('td', { class: 'actions' }, isAdmin() && u.id !== state.me.id ? [
          u.active ? h('button', { class: 'btn small', onclick: guard(async () => {
            const pw = await askText(`Nova senha temporária para ${u.name} (mínimo 8 caracteres). Passe para a pessoa e peça que troque em Configurações.`);
            if (!pw) return;
            await api('POST', `/api/users/${u.id}/password`, { password: pw }); toast(`Senha de ${u.name} redefinida`, 5000);
          }) }, 'Nova senha') : null,
          h('button', { class: 'btn small', onclick: guard(async () => {
            await api('PATCH', `/api/users/${u.id}`, { active: !u.active }); route();
          }) }, u.active ? 'Desativar' : 'Reativar')] : null)))))),
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
      h('p', { class: 'muted' }, 'Para o trabalho que se repete: fechamento do mês, diagnóstico, onboarding de cliente.' +
        (isAdmin() ? ' Você vê os modelos de todos; cada pessoa vê só os que ela criou.' : ' Os seus modelos são só seus (o administrador também vê).')),
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
      isAdmin() ? h('p', { class: 'muted small' }, `Criado por ${t.created_by === state.me.id ? 'você' : t.created_by_name || 'administrador (antes do registro de quem criou)'}`) : null,
      t.checklist.length ? h('ul', {}, t.checklist.map(i => h('li', {}, i))) : null))
      : h('div', { class: 'card-box empty' }, 'Nenhum modelo ainda.'),
  ]);
}

// ---------- compromissos (agenda) ----------
// Reuniões e compromissos marcados aqui. Depois: ligar com Google Agenda e Outlook.
const evView = { layout: 'list', month: '', past: false };
async function viewEvents() {
  const v = evView;
  const month = v.month || today().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const from = v.layout === 'month' ? `${month}-01` : v.past ? S.addDays(today(), -90) : today();
  const to = v.layout === 'month' ? S.addDays(S.addMonths(`${month}-01`, 1), -1) : v.past ? S.addDays(today(), -1) : S.addDays(today(), 90);
  const events = await api('GET', `/api/events?from=${from}&to=${to}`);
  const when = e => [e.start_time, e.end_time].filter(Boolean).join('–');
  const byDay = new Map();
  for (const e of events) (byDay.get(e.date) || byDay.set(e.date, []).get(e.date)).push(e);
  const dayTitle = d => (s => s[0].toUpperCase() + s.slice(1))(new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }));
  const item = e => h('button', { type: 'button', class: 'ev-item', onclick: () => eventDialog(e) },
    h('span', { class: 'ev-time' }, when(e) || 'Dia todo'),
    h('span', { class: 'grow' }, h('strong', {}, e.title),
      h('span', { class: 'muted small' }, [e.client_name, e.location, e.participants.map(p => p.name.split(' ')[0]).join(', ')].filter(Boolean).map(x => ` · ${x}`).join(''))));
  const chip = e => h('button', { type: 'button', class: 'chip ev-chip', onclick: () => eventDialog(e), title: `${when(e)} ${e.title}` },
    h('span', {}, `${e.start_time ? e.start_time + ' ' : ''}${e.title}`));
  const shift = n => { v.month = S.addMonths(`${month}-01`, n).slice(0, 7); route(); };
  let body;
  if (v.layout === 'month') {
    const startDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(h('div', { class: 'cal-cell out', 'aria-hidden': 'true' }));
    for (let d = 1; d <= days; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`;
      cells.push(h('div', { class: 'cal-cell' + (iso === today() ? ' today' : '') }, h('div', { class: 'cal-day' }, d), (byDay.get(iso) || []).map(chip),
        isStaff() ? h('button', { class: 'cal-add', type: 'button', 'aria-label': `Marcar em ${fmtDate(iso)}`, onclick: () => eventDialog(null, iso) }, '+') : null));
    }
    body = h('div', { class: 'card-box calendar' },
      h('div', { class: 'cal-nav' },
        h('button', { class: 'btn small', type: 'button', onclick: () => shift(-1), 'aria-label': 'Mês anterior' }, '‹'),
        h('h2', {}, `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} de ${y}`),
        h('button', { class: 'btn small', type: 'button', onclick: () => shift(1), 'aria-label': 'Próximo mês' }, '›'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { v.month = ''; route(); } }, 'Hoje')),
      h('div', { class: 'cal-grid' }, ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => h('div', { class: 'cal-dow' }, d)), cells),
      h('div', { class: 'agenda' }, byDay.size ? [...byDay.keys()].map(d => h('div', { class: 'agenda-day' + (d === today() ? ' today' : '') }, h('h3', {}, dayTitle(d)), byDay.get(d).map(item)))
        : h('p', { class: 'muted' }, 'Nenhum compromisso neste mês.')));
  } else {
    const days = [...byDay.keys()];
    if (v.past) days.reverse();
    body = h('div', { class: 'card-box' },
      days.length ? days.map(d => h('section', { class: 'ev-day' + (d === today() ? ' today' : '') }, h('h3', {}, d === today() ? `Hoje · ${dayTitle(d)}` : dayTitle(d)), byDay.get(d).map(item)))
        : h('p', { class: 'empty' }, v.past ? 'Nenhum compromisso nos últimos 90 dias.' : 'Nenhum compromisso marcado nos próximos 90 dias.'));
  }
  shell([
    h('div', { class: 'toolbar' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Visualização' },
        [['list', 'Lista', 'list'], ['month', 'Mês', 'calendar']].map(([k, l, ic]) => h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': String(v.layout === k),
          onclick: () => { v.layout = k; route(); } }, icon(ic), l))),
      v.layout === 'list' ? h('button', { class: 'btn', type: 'button', onclick: () => { v.past = !v.past; route(); } }, v.past ? 'Ver próximos' : 'Ver anteriores') : null,
      h('button', { class: 'btn', type: 'button', onclick: guard(calendarDialog) }, icon('calendar'), 'Ligar à minha agenda'),
      isStaff() ? h('button', { class: 'btn primary', type: 'button', onclick: () => eventDialog(null) }, icon('plus'), 'Novo compromisso') : null),
    body,
  ], { sub: isStaff() ? 'Reuniões e compromissos da equipe e com os clientes' : 'Reuniões e compromissos de que você participa' });
}

// Link de agenda da pessoa: Google Agenda, Outlook e iPhone assinam e atualizam sozinhos.
async function calendarDialog() {
  let { url } = await api('GET', '/api/me/calendar');
  modal(close => {
    const box = h('div', {});
    const paint = () => {
      box.replaceChildren();
      const webcal = url && url.replace(/^https?:/, 'webcal:');
      const step = (title, ...lines) => h('div', { class: 'cal-step' }, h('strong', {}, title), h('ol', {}, lines.map(l => h('li', {}, l))));
      box.append(
        h('h2', {}, 'Ligar à minha agenda'),
        h('p', {}, 'Seus compromissos e os prazos das tarefas que você vê aparecem no Google Agenda, no Outlook ou no iPhone, e se atualizam sozinhos.'),
        h('p', { class: 'muted small' }, 'É só para ver: para marcar ou mudar, use o sistema. Tarefa concluída sai da agenda.'),
        url ? h('div', {},
          h('div', { class: 'field' }, h('label', { for: 'cal-url' }, 'Seu link'),
            h('div', { class: 'row nowrap' }, h('input', { id: 'cal-url', value: url, readonly: true, onfocus: e => e.target.select() }),
              h('button', { class: 'btn primary', type: 'button', onclick: () => copyText(url, 'Link copiado. Agora cole na sua agenda.') }, 'Copiar'))),
          h('div', { class: 'row' },
            h('a', { class: 'btn', href: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`, target: '_blank', rel: 'noopener' }, 'Abrir no Google Agenda'),
            h('a', { class: 'btn', href: webcal }, 'Abrir no iPhone ou Outlook')),
          h('details', { class: 'cal-steps' }, h('summary', {}, 'Passo a passo'),
            step('Google Agenda (no computador)', 'Copie o link acima.', 'No Google Agenda, ao lado de "Outras agendas", clique em +.', 'Escolha "Do URL", cole o link e clique em "Adicionar agenda".',
              'No celular ela aparece sozinha depois (no app do Google Agenda, confira se a agenda está marcada).'),
            step('Outlook', 'Copie o link acima.', 'No Outlook na web: Calendário → Adicionar calendário → "Assinar da Web".', 'Cole o link, dê um nome e clique em Importar.'),
            step('iPhone', 'Copie o link acima.', 'Ajustes → Calendário → Contas → Adicionar Conta → Outra.', 'Toque em "Adicionar Calendário Assinado", cole o link e toque em Seguinte e Salvar.')),
          h('p', { class: 'muted small' }, 'O Google Agenda busca as novidades a cada algumas horas (às vezes até um dia); o iPhone e o Outlook, mais rápido.'),
          h('p', { class: 'muted small' }, 'Quem tiver este link vê a sua agenda: não compartilhe. Se ele vazar, gere um novo (o anterior para de funcionar e você precisa colar o novo na agenda).'),
          h('div', { class: 'row' },
            h('button', { class: 'btn', type: 'button', onclick: guard(async () => {
              if (!await ask('Gerar um link novo? O link atual para de funcionar e você vai precisar colar o novo na sua agenda.', { ok: 'Gerar novo link' })) return;
              url = (await api('POST', '/api/me/calendar')).url; paint(); toast('Link novo gerado.');
            }) }, 'Gerar novo link'),
            h('button', { class: 'btn danger', type: 'button', onclick: guard(async () => {
              if (!await ask('Desligar o link? A sua agenda para de receber os compromissos e prazos.', { ok: 'Desligar', danger: true })) return;
              await api('DELETE', '/api/me/calendar'); url = null; paint(); toast('Link desligado.');
            }) }, 'Desligar'),
            h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar')),
        ) : h('div', { class: 'row' },
          h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => { url = (await api('POST', '/api/me/calendar')).url; paint(); }) }, 'Criar meu link'),
          h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar')));
    };
    paint();
    return box;
  });
}

// Detalhe, criação e edição de um compromisso.
function eventDialog(e, day) {
  const mine = e && (isAdmin() || e.created_by === state.me.id);
  if (e && !mine) {
    return modal(close => h('div', {}, eventInfo(e), h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn', type: 'button', onclick: close }, 'Fechar'))));
  }
  modal(close => {
    const err = h('p', { class: 'error', role: 'alert' });
    const clientSel = h('select', { id: 'ev-client', name: 'client_id' }, h('option', { value: '' }, `Nenhuma (${state.org.name})`),
      state.clients.map(c => h('option', { value: c.id, selected: e?.client_id === c.id }, c.name)));
    const people = h('div', {});
    const paintPeople = () => {
      const keep = people.dataset.init ? [...people.querySelectorAll('input:checked')].map(i => Number(i.value)) : (e ? e.participants.map(p => p.id) : [state.me.id]);
      people.dataset.init = '1';
      const cid = Number(clientSel.value) || null;
      const staff = state.users.filter(u => u.role !== 'client' && u.active);
      const clientPeople = state.users.filter(u => u.role === 'client' && u.active && (u.client_id === cid || keep.includes(u.id)));
      const box = u => h('label', {}, h('input', { type: 'checkbox', value: u.id, checked: keep.includes(u.id) }), u.name, u.role === 'client' ? h('span', { class: 'muted small' }, ' (cliente)') : null);
      people.replaceChildren(h('div', { class: 'checks', role: 'group', 'aria-label': 'Participantes' }, staff.map(box), clientPeople.map(box)));
    };
    clientSel.addEventListener('change', paintPeople);
    paintPeople();
    const f = (label, id, input) => h('div', { class: 'field' }, h('label', { for: id }, label), input);
    return h('form', { onsubmit: async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = { title: fd.get('title'), date: fd.get('date'), start_time: fd.get('start_time') || null, end_time: fd.get('end_time') || null,
        location: fd.get('location'), notes: fd.get('notes'), client_id: clientSel.value ? Number(clientSel.value) : null,
        user_ids: [...people.querySelectorAll('input:checked')].map(i => Number(i.value)) };
      try {
        await api(e ? 'PATCH' : 'POST', e ? `/api/events/${e.id}` : '/api/events', body);
        close(); toast(e ? 'Compromisso salvo' : 'Compromisso marcado'); route();
      } catch (ex) { err.textContent = ex.message; }
    } },
      h('h2', {}, e ? 'Editar compromisso' : 'Novo compromisso'),
      f('O quê', 'ev-title', h('input', { id: 'ev-title', name: 'title', required: true, maxlength: 200, value: e?.title || '', placeholder: 'Ex.: Reunião de alinhamento' })),
      h('div', { class: 'grid3' },
        f('Data', 'ev-date', h('input', { id: 'ev-date', name: 'date', type: 'date', required: true, value: e?.date || day || today() })),
        f('Início', 'ev-start', h('input', { id: 'ev-start', name: 'start_time', type: 'time', value: e?.start_time || '' })),
        f('Fim', 'ev-end', h('input', { id: 'ev-end', name: 'end_time', type: 'time', value: e?.end_time || '' }))),
      f('Empresa', 'ev-client', clientSel),
      h('div', { class: 'field' }, h('span', { class: 'label' }, 'Participantes'), people),
      f('Local ou link (Meet, Teams, Zoom)', 'ev-loc', h('input', { id: 'ev-loc', name: 'location', maxlength: 500, value: e?.location || '', placeholder: 'https://meet.google.com/...' })),
      f('Observações', 'ev-notes', h('textarea', { id: 'ev-notes', name: 'notes', rows: 3 }, e?.notes || '')),
      err,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'submit' }, e ? 'Salvar' : 'Marcar'),
        h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancelar'),
        e ? h('button', { class: 'btn danger', type: 'button', style: 'margin-left:auto', onclick: guard(async () => {
          if (!(await ask(`Apagar o compromisso "${e.title}"?`, { ok: 'Apagar', danger: true }))) return;
          await api('DELETE', `/api/events/${e.id}`); close(); toast('Compromisso apagado'); route();
        }) }, 'Apagar') : null));
  });
}
function eventInfo(e) {
  const link = /^https?:\/\//.test(e.location || '');
  return h('div', {},
    h('h2', {}, e.title),
    h('p', {}, fmtDate(e.date), e.start_time ? ` · ${[e.start_time, e.end_time].filter(Boolean).join(' às ')}` : ' · dia todo'),
    e.client_name ? h('p', { class: 'muted' }, e.client_name) : null,
    e.location ? h('p', {}, link ? h('a', { href: e.location, target: '_blank', rel: 'noopener' }, 'Entrar na reunião') : e.location) : null,
    e.participants.length ? h('p', { class: 'muted small' }, 'Participantes: ', e.participants.map(p => p.name).join(', ')) : null,
    e.notes ? h('p', { class: 'pre' }, e.notes) : null,
    h('p', { class: 'muted small' }, `Marcado por ${e.created_by_name || '–'}`));
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
  // Ao escolher o PDF das anotações do Gemini, o navegador tira o texto e preenche a parte "Próximas etapas".
  const pdfNote = h('p', { class: 'muted small', role: 'status' });
  const file = h('input', { id: 'm-pdf', type: 'file', accept: 'application/pdf,.pdf', class: 'sr-only',
    onchange: async e => {
      const f = e.target.files[0];
      fileInfo.textContent = f ? f.name : 'Nenhum arquivo escolhido';
      pdfNote.textContent = '';
      if (!f) return;
      pdfNote.textContent = 'Lendo o PDF…';
      try {
        const got = await notesFromPdf(f);
        const box = document.getElementById('m-notes');
        if (got.section && (!box.value.trim() || box.dataset.fromPdf)) { box.value = got.section; box.dataset.fromPdf = '1'; }
        const dateBox = document.getElementById('m-date');
        if (got.date && dateBox.value === today()) dateBox.value = got.date;
        pdfNote.textContent = got.section
          ? `Encontrei a parte "Próximas etapas" (${got.items} ${got.items === 1 ? 'item' : 'itens'}) e coloquei nas anotações acima. Confira antes de enviar.`
          : 'Não encontrei a parte "Próximas etapas" neste PDF. Cole o texto das anotações acima.';
      } catch {
        pdfNote.textContent = 'Não deu para ler o texto deste PDF. Cole o texto das anotações acima; o PDF fica guardado mesmo assim.';
      }
    } });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Enviar para a triagem');
  const form = h('form', { class: 'card-box', onsubmit: async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const f = file.files[0];
    const notes = String(fd.get('notes') || '').trim();
    if (!f && !notes) { err.textContent = 'Cole o texto das anotações (ou anexe o PDF)'; return; }
    if (f && f.size > 15 * 1024 * 1024) { err.textContent = 'PDF grande demais (máximo 15 MB)'; return; }
    submit.disabled = true; submit.textContent = 'Enviando…';
    try {
      const { id } = await api('POST', '/api/meetings', { title: fd.get('title'), meeting_date: fd.get('meeting_date'),
        client_id: clientSel.value ? Number(clientSel.value) : null, attendee_ids: who.value(), other_attendees: fd.get('others'),
        notes_text: notes || undefined,
        ...(f ? { pdf: (await readFileData(f)).replace(/^data:[^,]*,/, 'data:application/pdf;base64,'), pdf_name: f.name } : {}) });
      location.hash = `#/reuniao/${id}`;
    } catch (ex) { err.textContent = ex.message; submit.disabled = false; submit.textContent = 'Enviar para a triagem'; }
  } },
    h('h2', {}, 'Nova reunião'),
    h('p', { class: 'muted' }, 'Cole as anotações do Gemini (Google Meet) e marque quem estava presente. O sistema lê a parte "Próximas etapas" e separa as tarefas; nada vai para o quadro antes do seu OK.'),
    h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('label', { for: 'm-title' }, 'Reunião'), h('input', { id: 'm-title', name: 'title', required: true, maxlength: 200, placeholder: 'Ex.: Alinhamento mensal' })),
      h('div', { class: 'field' }, h('label', { for: 'm-date' }, 'Data'), h('input', { id: 'm-date', name: 'meeting_date', type: 'date', required: true, value: today() }))),
    h('div', { class: 'field' }, h('label', { for: 'm-client' }, 'Empresa'), clientSel),
    h('h3', { class: 'sub-h' }, 'Quem estava presente'),
    who.el,
    h('div', { class: 'field' }, h('label', { for: 'm-others' }, 'Outros participantes (opcional)'), h('input', { id: 'm-others', name: 'others', maxlength: 1000, placeholder: 'Ex.: Paulo (contador do cliente)' })),
    h('div', { class: 'field' }, h('label', { for: 'm-notes' }, 'Anotações da reunião'),
      h('textarea', { id: 'm-notes', name: 'notes', rows: 8, placeholder: 'Próximas etapas\n[Nome da pessoa] O que ficou de fazer: detalhes até sexta-feira\n- Fulano vai enviar o relatório até 25/10' }),
      h('p', { class: 'muted small' }, 'No documento "Anotações do Gemini" que o Meet cria no Google Drive, copie tudo (ou só a parte "Próximas etapas") e cole aqui. Cada linha vira uma sugestão de tarefa, com o responsável pelo nome e o prazo quando estiver escrito ("até sexta", "até 25/10", "semana que vem").')),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'PDF das anotações (opcional: o sistema tira a parte "Próximas etapas" e guarda o arquivo)'),
      h('div', { class: 'row' }, h('label', { class: 'btn file-btn', for: 'm-pdf' }, file, 'Escolher PDF'), fileInfo), pdfNote),
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

// Lê o PDF no navegador (public/pdftext.js) até passar da parte "Próximas etapas" e devolve só ela,
// mais a data da reunião quando o PDF diz ("Reunião em 16 de out. de 2026").
async function notesFromPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = await PdfText.pdfText(bytes, { maxPages: 30, until: S.pastNextSteps });
  const section = S.nextStepsSection(text);
  const MES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
  const dm = /Reuni[aã]o\s+em\s+(\d{1,2})\s+de\s+([a-zç]{3})[a-zç]*\.?\s+de\s+(\d{4})/i.exec(text);
  const date = dm && MES[dm[2].toLowerCase()] ? `${dm[3]}-${String(MES[dm[2].toLowerCase()]).padStart(2, '0')}-${dm[1].padStart(2, '0')}` : null;
  const items = section ? S.parseNextSteps(section).length : 0;
  return { section, date, items };
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
    await Exports.download(new Blob([bytes], { type: 'application/pdf' }), f.name);
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
      m.status !== 'processing' && (m.ai || m.notes_text || m.pdf_name) ? h('button', { class: 'btn small', type: 'button', onclick: guard(async () => {
        if (pending.length && !(await ask('Ler a ata de novo? As tarefas que ainda estão para revisar serão trocadas pela nova leitura. As já lançadas ficam.', { ok: 'Ler de novo' }))) return;
        await api('POST', `/api/meetings/${meetingId}/process`); route();
      }) }, 'Ler de novo') : null,
      h('button', { class: 'btn small danger', type: 'button', onclick: guard(async () => {
        if (!(await ask('Apagar esta reunião, o PDF e as sugestões? As tarefas já lançadas continuam no quadro.', { ok: 'Apagar reunião', danger: true }))) return;
        await api('DELETE', `/api/meetings/${meetingId}`); toast('Reunião apagada'); location.hash = '#/reunioes';
      }) }, 'Apagar')));

  const status = m.status === 'processing'
    ? h('div', { class: 'card-box reading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Lendo as anotações. Leva alguns segundos (com IA, até um ou dois minutos); esta tela atualiza sozinha.')
    : m.status === 'error' ? h('div', { class: 'card-box error-box', role: 'alert' }, h('strong', {}, 'Não deu para ler a ata. '), m.error) : null;

  const notesBox = h('textarea', { id: 'mt-notes', rows: 8, 'aria-label': 'Anotações da reunião' }, m.notes_text || '');
  // Anexar (ou trocar) o PDF das anotações: o navegador tira a parte "Próximas etapas"; se não conseguir, o servidor tenta.
  const pdfStatus = h('span', { class: 'muted small', role: 'status' });
  const pdfPick = h('input', { type: 'file', id: 'mt-pdf', accept: 'application/pdf,.pdf', class: 'sr-only', onchange: guard(async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) { toast('PDF grande demais (máximo 15 MB)'); return; }
    if (pending.length && !(await ask('Ler o PDF? As tarefas que ainda estão para revisar serão trocadas pela nova leitura. As já lançadas ficam.', { ok: 'Ler o PDF' }))) return;
    pdfStatus.textContent = 'Lendo o PDF…';
    let section = null;
    try { section = (await notesFromPdf(f)).section; } catch { /* o servidor tenta de novo */ }
    await api('PATCH', `/api/meetings/${meetingId}`, { pdf: (await readFileData(f)).replace(/^data:[^,]*,/, 'data:application/pdf;base64,'), pdf_name: f.name, notes_text: section || '' });
    await api('POST', `/api/meetings/${meetingId}/process`); toast('PDF anexado'); route();
  }) });
  const notesSection = m.status !== 'processing' ? h('details', { class: 'card-box notes-box', open: !m.notes_text && m.status === 'error' },
    h('summary', {}, m.notes_text ? 'Anotações (corrigir e ler de novo)' : 'Colar as anotações ou anexar o PDF'),
    h('p', { class: 'muted small' }, 'As tarefas saem da parte "Próximas etapas". Corrigiu um nome ou um prazo no texto? Salve e o sistema lê de novo; as tarefas já lançadas ficam.'),
    notesBox,
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn primary', type: 'button', onclick: guard(async () => {
      if (pending.length && !(await ask('Ler de novo? As tarefas que ainda estão para revisar serão trocadas pela nova leitura. As já lançadas ficam.', { ok: 'Ler de novo' }))) return;
      await api('PATCH', `/api/meetings/${meetingId}`, { notes_text: notesBox.value });
      await api('POST', `/api/meetings/${meetingId}/process`); route();
    }) }, 'Salvar e ler de novo'),
      h('label', { class: 'btn file-btn', for: 'mt-pdf' }, pdfPick, m.pdf_name ? 'Trocar o PDF' : '📎 Anexar PDF das anotações'), pdfStatus)) : null;
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
    header, status, notesSection,
    m.status !== 'processing' ? h('section', { 'aria-labelledby': 'mi-h' },
      h('div', { class: 'row section-h' }, h('h2', { id: 'mi-h', class: 'grow' }, pending.length ? `Para revisar (${pending.length})` : 'Para revisar'), approveAll),
      pending.length ? h('p', { class: 'muted small' }, 'Confira cada tarefa: o que você muda fica salvo na hora. "OK, lançar" leva para o quadro e avisa os responsáveis.') : null,
      pending.map(meetingItemCard),
      !pending.length && m.status === 'ready' ? h('div', { class: 'card-box empty' }, approved.length ? 'Tudo revisado.' : 'Nenhuma tarefa encontrada. Confira as anotações acima ou adicione abaixo.') : null,
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
  const kc = kindClientFields(p, it.kind, it.client_id, it.client_visible, v => save(v), { showTeam: false });
  const field = (label, id, input) => h('div', { class: 'field' }, h('label', { for: id }, label), input);
  // Mesma regra da tarefa: com empresa, administradores, quem acompanha o cliente e as pessoas do cliente.
  const who = assigneeChecks(it.assignee_ids, { kind: it.kind, client_id: it.client_id, client_visible: it.client_visible });
  who.addEventListener('change', () => save({ assignee_ids: [...who.querySelectorAll('input:checked')].map(i => Number(i.value)) }));
  const card = h('article', { class: 'card-box item-card', 'aria-label': it.title },
    field('Tarefa', `${p}-title`, h('input', { id: `${p}-title`, value: it.title, maxlength: 200, required: true,
      onchange: e => e.target.value.trim() && save({ title: e.target.value.trim() }) })),
    it.quote ? h('blockquote', { class: 'quote' }, h('span', { class: 'muted small' }, 'Na ata: '), `“${it.quote}”`) : null,
    h('div', { class: 'item-grid' },
      h('div', {}, kc.el,
        field('Responsável no cliente (opcional)', `${p}-cr`, h('input', { id: `${p}-cr`, value: it.client_responsible, maxlength: 120, placeholder: 'Quem do cliente ficou de fazer',
          onchange: e => save({ client_responsible: e.target.value }) }))),
      h('div', {},
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Responsáveis'), who),
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
// Central de relatórios: escolhe o relatório, filtra e baixa em Excel ou PDF (public/exports.js).
// Tudo sai das tarefas que a pessoa pode ver (inclusive arquivadas).
const repState = { type: 'resumo', from: '', to: '', client: '', who: '', kind: '', col: '', horizon: 15 };
const REPORTS = [
  ['resumo', 'Resumo geral', 'Os números do período em uma tabela'],
  ['empresa', 'Por empresa', 'Abertas, atrasadas, no prazo e ajustes de cada cliente'],
  ['responsavel', 'Por responsável', 'Carga, atrasos, % no prazo e tempo de execução por pessoa'],
  ['prazos', 'Prazos', 'Atrasadas e as que vencem nos próximos dias'],
  ['concluidas', 'Concluídas', 'O que foi entregue no período, quem iniciou e quem concluiu'],
  ['canceladas', 'Canceladas', 'O que foi cancelado, por quem e o motivo'],
  ['evolucao', 'Evolução mensal', 'Criadas, concluídas e canceladas mês a mês'],
  ['ajustes', 'Ajustes', 'Retrabalho interno e pedidos do cliente por empresa'],
  ['recorrentes', 'Recorrentes', 'Tarefas que se repetem e o próximo prazo'],
  ['lista', 'Lista completa', 'Todas as tarefas com os filtros escolhidos'],
];
async function viewReport() {
  document.title = 'Relatórios';
  const r = repState;
  if (!r.from) { r.from = S.addDays(today(), -30); r.to = today(); }
  const [active, archived] = await Promise.all([api('GET', '/api/tasks'), api('GET', '/api/tasks?archived=1')]);
  const tasks = active.concat(archived).filter(t => (!r.client || (r.client === 'org' ? !t.client_id : t.client_id === Number(r.client)))
    && (!r.who || t.assignees.some(a => a.id === Number(r.who))) && (!r.kind || t.kind === r.kind)
    && (!r.col || (r.col === 'open' ? !['done', 'cancelled'].includes(t.status) : r.col === 'done' ? t.status === 'done' : t.column === r.col)));
  const rep = buildReport(r.type, tasks, r);
  const set = (k, v) => { r[k] = v; route(); };
  const filters = h('div', { class: 'filters open rep-filters' },
    h('label', { class: 'rep-date' }, 'De ', h('input', { type: 'date', id: 'r-from', value: r.from, onchange: e => set('from', e.target.value || r.from) })),
    h('label', { class: 'rep-date' }, 'Até ', h('input', { type: 'date', id: 'r-to', value: r.to, onchange: e => set('to', e.target.value || r.to) })),
    select('r-client', 'Empresa', r.client, [['', 'Todas as empresas'], ['org', `${state.org.name} (própria)`], ...state.clients.map(c => [c.id, c.name])], x => set('client', x)),
    select('r-who', 'Responsável', r.who, [['', 'Todos os responsáveis'], ...state.users.filter(u => u.active).map(u => [u.id, u.name + (u.role === 'client' ? ' (cliente)' : '')])], x => set('who', x)),
    select('r-kind', 'Tipo', r.kind, [['', 'Internas e externas'], ['external', 'Externas'], ['internal', 'Internas']], x => set('kind', x)),
    select('r-col', 'Situação', r.col, [['', 'Todas as situações'], ['open', 'Em aberto'], ['done', 'Concluídas'], ...boardColumns().map(c => [c.key, c.name])], x => set('col', x)),
    r.type === 'prazos' ? select('r-hz', 'Horizonte', r.horizon, [[7, 'Próximos 7 dias'], [15, 'Próximos 15 dias'], [30, 'Próximos 30 dias'], [60, 'Próximos 60 dias']], x => set('horizon', Number(x))) : null);
  const fileName = ext => `relatorio-${r.type}-${today()}.${ext}`;
  shell([
    h('div', { class: 'rep-picker', role: 'tablist', 'aria-label': 'Relatórios' }, REPORTS.map(([k, label, sub]) =>
      h('button', { type: 'button', role: 'tab', class: 'rep-card' + (r.type === k ? ' on' : ''), 'aria-selected': String(r.type === k), onclick: () => set('type', k) },
        h('strong', {}, label), h('span', { class: 'muted small' }, sub)))),
    h('div', { class: 'card-box' }, filters,
      h('div', { class: 'row rep-actions' },
        h('div', { class: 'grow' }, h('h2', { style: 'margin:0' }, rep.title), h('p', { class: 'muted small', style: 'margin:2px 0 0' }, rep.subtitle)),
        h('button', { class: 'btn', type: 'button', onclick: () => { Exports.download(Exports.xlsx(rep), fileName('xlsx')); toast('Planilha baixada'); } }, 'Baixar Excel'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { Exports.download(Exports.pdf(rep), fileName('pdf')); toast('PDF baixado'); } }, 'Baixar PDF'))),
    h('div', { class: 'card-box table-wrap' },
      rep.rows.length ? h('table', { class: 'rep-table' },
        h('thead', {}, h('tr', {}, rep.columns.map(c => h('th', { class: c.align === 'right' ? 'num' : null }, c.label)))),
        h('tbody', {}, rep.rows.map((row, i) => h('tr', { class: rep.ids?.[i] ? 'row-link' : null, onclick: rep.ids?.[i] ? () => openTask(rep.ids[i]) : null },
          row.map((v, j) => h('td', { class: rep.columns[j].align === 'right' ? 'num' : null, 'data-label': rep.columns[j].label }, v))))))
        : h('p', { class: 'empty' }, 'Nenhum dado com estes filtros.'),
      rep.footer ? h('p', { class: 'muted small', style: 'margin-top:10px' }, rep.footer) : null),
  ], { title: 'Relatórios', sub: 'Escolha o relatório, filtre e baixe em Excel ou PDF' });
}

// Monta o relatório no formato comum da tela, do Excel e do PDF.
function buildReport(type, tasks, f) {
  const inP = d => d && d >= f.from && d <= f.to;
  const open = t => !['done', 'cancelled'].includes(t.status);
  const doneIn = tasks.filter(t => t.status === 'done' && inP(t.completed_on));
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  const execDays = list => { const w = list.filter(t => t.start_date); return w.length ? Math.round(w.reduce((n, t) => n + Math.max(0, S.daysBetween(t.start_date, t.completed_on)), 0) / w.length * 10) / 10 : '–'; };
  const names = t => t.assignees.map(a => a.name).join(', ');
  const kindName = t => (t.kind === 'external' ? 'Externa' : 'Interna');
  const filtersText = [
    `Período ${fmtDate(f.from)} a ${fmtDate(f.to)}`,
    f.client ? (f.client === 'org' ? `${state.org.name} (própria)` : (state.clients.find(c => c.id === Number(f.client)) || {}).name) : null,
    f.who ? (state.users.find(u => u.id === Number(f.who)) || {}).name : null,
    f.kind ? (f.kind === 'external' ? 'Externas' : 'Internas') : null,
  ].filter(Boolean).join(' · ');
  const base = { subtitle: `${filtersText} · ${state.org.name}`, brand: `${state.org.name} · Painel de Tarefas · gerado em ${fmtDate(today())}` };
  const R = (cols, rows, extra = {}) => ({ ...base, columns: cols.map(c => (typeof c === 'string' ? { label: c } : c)), rows, ...extra });
  const n = label => ({ label, align: 'right' });
  const group = (keyOf, nameOf) => { const m = new Map(); for (const t of tasks) for (const k of [].concat(keyOf(t))) { if (!m.has(k)) m.set(k, { name: nameOf(t, k), list: [] }); m.get(k).list.push(t); } return [...m.values()].sort((a, b) => a.name.localeCompare(b.name)); };

  if (type === 'resumo') {
    const late = tasks.filter(t => t.column === 'overdue');
    const onTime = doneIn.filter(t => t.column === 'done_on_time').length;
    return R(['Indicador', n('Valor')], [
      ['Em aberto agora', tasks.filter(open).length],
      ['Atrasadas agora', late.length],
      ['Criadas no período', tasks.filter(t => inP((t.created_at || '').slice(0, 10))).length],
      ['Concluídas no período', doneIn.length],
      ['Concluídas no prazo', onTime],
      ['Concluídas fora do prazo', doneIn.length - onTime],
      ['% no prazo', pct(onTime, doneIn.length)],
      ['Canceladas no período', tasks.filter(t => t.status === 'cancelled' && inP(t.cancelled_on)).length],
      ['Tempo médio de execução (dias)', execDays(doneIn)],
      ['Ajustes pedidos pelo cliente (total)', tasks.reduce((x, t) => x + (t.adjustments_client || 0), 0)],
    ], { title: 'Resumo geral', sheet: 'Resumo' });
  }
  if (type === 'empresa') {
    const g = group(t => t.client_id || 'org', t => (t.client_id ? t.client_name : `${state.org.name} (própria)`));
    const rows = g.map(({ name, list }) => {
      const d = list.filter(t => t.status === 'done' && inP(t.completed_on)), ot = d.filter(t => t.column === 'done_on_time').length;
      return [name, list.filter(open).length, list.filter(t => t.column === 'overdue').length, d.length, ot, d.length - ot, pct(ot, d.length),
        list.filter(t => t.status === 'cancelled' && inP(t.cancelled_on)).length, list.reduce((x, t) => x + (t.adjustments_internal || 0), 0), list.reduce((x, t) => x + (t.adjustments_client || 0), 0)];
    });
    return R(['Empresa', n('Em aberto'), n('Atrasadas'), n('Concluídas'), n('No prazo'), n('Fora do prazo'), n('% no prazo'), n('Canceladas'), n('Ajustes internos'), n('Ajustes do cliente')], rows,
      { title: 'Relatório por empresa', sheet: 'Por empresa', footer: `${rows.length} empresa(s). Concluídas e canceladas no período; em aberto e atrasadas, agora.` });
  }
  if (type === 'responsavel') {
    const people = state.users.filter(u => u.active || tasks.some(t => t.assignees.some(a => a.id === u.id)));
    const rows = people.map(u => {
      const mine = tasks.filter(t => t.assignees.some(a => a.id === u.id));
      const d = mine.filter(t => t.status === 'done' && inP(t.completed_on)), ot = d.filter(t => t.column === 'done_on_time').length;
      return [u.name + (u.role === 'client' ? ' (cliente)' : ''), mine.filter(open).length, mine.filter(t => t.column === 'overdue').length, d.length, pct(ot, d.length),
        tasks.filter(t => t.started_by_name === u.name && inP(t.start_date)).length, tasks.filter(t => t.completed_by_name === u.name && inP(t.completed_on)).length, execDays(d)];
    }).filter(row => row.slice(1, 7).some(v => v && v !== '–'));
    return R(['Pessoa', n('Em aberto'), n('Atrasadas'), n('Concluídas'), n('% no prazo'), n('Iniciou'), n('Concluiu'), n('Dias médios')], rows,
      { title: 'Relatório por responsável', sheet: 'Por responsável', footer: '"Iniciou" e "Concluiu": quem preencheu o início e quem concluiu, no período.' });
  }
  if (type === 'prazos') {
    const limit = S.addDays(today(), f.horizon || 15);
    const list = tasks.filter(t => open(t) && t.due_date && t.due_date <= limit).sort((a, b) => a.due_date.localeCompare(b.due_date));
    return R(['Tarefa', 'Empresa', 'Responsáveis', 'Prazo', 'Situação', 'Alerta', n('%')],
      list.map(t => [t.title, where(t), names(t), fmtDate(t.due_date), colName(t.column), t.alert ? S.alertText(t.alert) : `Vence em ${S.daysBetween(today(), t.due_date)} dias`, `${t.progress}%`]),
      { title: `Prazos: atrasadas e próximos ${f.horizon || 15} dias`, sheet: 'Prazos', ids: list.map(t => t.id), footer: `${list.filter(t => t.column === 'overdue').length} atrasada(s) e ${list.filter(t => t.column !== 'overdue').length} vencendo.` });
  }
  if (type === 'concluidas') {
    const list = doneIn.slice().sort((a, b) => b.completed_on.localeCompare(a.completed_on));
    return R(['Tarefa', 'Empresa', 'Responsáveis', 'Início', 'Prazo', 'Término', 'No prazo?', 'Iniciada por', 'Concluída por', n('Dias')],
      list.map(t => [t.title, where(t), names(t), fmtDate(t.start_date), fmtDate(t.due_date), fmtDate(t.completed_on), t.column === 'done_on_time' ? 'Sim' : 'Não',
        t.started_by_name || '', t.completed_by_name || '', t.start_date ? S.daysBetween(t.start_date, t.completed_on) : '']),
      { title: 'Tarefas concluídas', sheet: 'Concluídas', ids: list.map(t => t.id), footer: `${list.length} concluída(s), ${pct(list.filter(t => t.column === 'done_on_time').length, list.length)} no prazo.` });
  }
  if (type === 'canceladas') {
    const list = tasks.filter(t => t.status === 'cancelled' && inP(t.cancelled_on)).sort((a, b) => b.cancelled_on.localeCompare(a.cancelled_on));
    return R(['Tarefa', 'Empresa', 'Cancelada em', 'Por', 'Motivo'], list.map(t => [t.title, where(t), fmtDate(t.cancelled_on), t.cancelled_by_name || '', t.cancel_reason || '']),
      { title: 'Tarefas canceladas', sheet: 'Canceladas', ids: list.map(t => t.id), footer: `${list.length} cancelada(s).` });
  }
  if (type === 'evolucao') {
    const months = [];
    for (let m = f.from.slice(0, 7); m <= f.to.slice(0, 7); m = S.addMonths(`${m}-01`, 1).slice(0, 7)) months.push(m);
    const label = m => new Date(`${m}-15T12:00`).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '');
    return R(['Mês', n('Criadas'), n('Concluídas'), n('No prazo'), n('% no prazo'), n('Canceladas')], months.map(m => {
      const d = tasks.filter(t => t.status === 'done' && (t.completed_on || '').startsWith(m)), ot = d.filter(t => t.column === 'done_on_time').length;
      return [label(m), tasks.filter(t => (t.created_at || '').startsWith(m)).length, d.length, ot, pct(ot, d.length), tasks.filter(t => t.status === 'cancelled' && (t.cancelled_on || '').startsWith(m)).length];
    }), { title: 'Evolução mês a mês', sheet: 'Evolução' });
  }
  if (type === 'ajustes') {
    const g = group(t => t.client_id || 'org', t => (t.client_id ? t.client_name : `${state.org.name} (própria)`));
    const rows = g.map(({ name, list }) => [name, list.length, list.reduce((x, t) => x + (t.adjustments_internal || 0), 0), list.reduce((x, t) => x + (t.adjustments_client || 0), 0),
      list.reduce((x, t) => x + (t.adjustments_open || 0), 0)]).sort((a, b) => b[3] - a[3] || b[2] - a[2]);
    return R(['Empresa', n('Tarefas'), n('Ajustes internos'), n('Ajustes do cliente'), n('Em aberto')], rows,
      { title: 'Ajustes por empresa', sheet: 'Ajustes', footer: 'Ajuste interno: a revisão da equipe pediu correção. Ajuste do cliente: o cliente pediu na revisão.' });
  }
  if (type === 'recorrentes') {
    const list = tasks.filter(t => t.recurrence !== 'none' && open(t)).sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9'));
    return R(['Tarefa', 'Empresa', 'Repetição', 'Próximo prazo', 'Responsáveis', 'Situação'],
      list.map(t => [t.title, where(t), S.RECURRENCE[t.recurrence] + (t.recurrence === 'custom' ? ` (${t.recurrence_every} dias)` : ''), fmtDate(t.due_date), names(t), colName(t.column)]),
      { title: 'Tarefas recorrentes', sheet: 'Recorrentes', ids: list.map(t => t.id), footer: `${list.length} recorrente(s) em aberto.` });
  }
  const list = tasks.slice().sort(S.boardSort);
  return R(['Tarefa', 'Tipo', 'Empresa', 'Situação', 'Prioridade', 'Responsáveis', 'Início', 'Prazo', 'Término', n('%'), 'Criada por'],
    list.map(t => [t.title, kindName(t), where(t), colName(t.column), PRIORITY[t.priority], names(t), fmtDate(t.start_date), fmtDate(t.due_date), fmtDate(t.completed_on || t.cancelled_on),
      `${t.progress}%`, t.created_by_name || '']),
    { title: 'Lista de tarefas', sheet: 'Tarefas', ids: list.map(t => t.id), footer: `${list.length} tarefa(s).` });
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
