'use strict';
// Regras de negócio usadas pelo servidor (require) e pelo navegador (window.Shared):
// colunas do quadro, alertas de prazo, recorrência, % de execução e quem vê cada tarefa.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Shared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STATUSES = ['todo', 'doing', 'review', 'done', 'cancelled'];
  const STATUS_LABEL = { todo: 'A fazer', doing: 'Em andamento', review: 'Em revisão', done: 'Concluída', cancelled: 'Cancelada' };

  const COLUMNS = [
    { key: 'todo', name: 'A fazer' },
    { key: 'doing', name: 'Em andamento' },
    { key: 'review', name: 'Em revisão' },
    { key: 'overdue', name: 'Atrasada' },
    { key: 'done_on_time', name: 'Concluída no prazo' },
    { key: 'done_late', name: 'Concluída fora do prazo' },
    { key: 'cancelled', name: 'Cancelada' },
  ];

  const ALERTS = [
    { days: 0, label: 'No dia do prazo' },
    { days: 1, label: '1 dia antes' },
    { days: 3, label: '3 dias antes' },
    { days: 7, label: '1 semana antes' },
  ];
  const ALERT_DAYS = ALERTS.map(a => a.days);

  const RECURRENCE = {
    none: 'Não repete', daily: 'Diária', weekly: 'Semanal', biweekly: 'Quinzenal', monthly: 'Mensal',
    bimonthly: 'Bimestral', quarterly: 'Trimestral', four_monthly: 'Quadrimestral', semiannual: 'Semestral',
    yearly: 'Anual', custom: 'Livre (a cada N dias)',
  };
  const STEP = {
    daily: { days: 1 }, weekly: { days: 7 }, biweekly: { days: 14 }, monthly: { months: 1 }, bimonthly: { months: 2 },
    quarterly: { months: 3 }, four_monthly: { months: 4 }, semiannual: { months: 6 }, yearly: { months: 12 },
  };

  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

  // Data de hoje no fuso de quem está usando (no servidor, o fuso do processo: defina TZ).
  function today(now = new Date()) {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
  function addDays(s, n) { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
  // Soma meses sem pular mês: 31/01 + 1 mês = 28/02 (ou 29/02).
  function addMonths(s, n) {
    const d = parse(s);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return iso(d);
  }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }

  function nextDate(s, recurrence, every) {
    if (!s) return null;
    if (recurrence === 'custom') return addDays(s, Math.max(1, Number(every) || 1));
    const step = STEP[recurrence];
    if (!step) return null;
    return step.days ? addDays(s, step.days) : addMonths(s, step.months);
  }

  // Coluna do quadro: concluída no prazo ou fora dele pela data de término; atrasada é automática.
  // Tarefa numa coluna criada pela organização: status "doing" com stage_id (chave "stage-<id>").
  function column(t, now = today()) {
    if (t.status === 'cancelled') return 'cancelled';
    if (t.status === 'done') {
      return !t.due_date || (t.completed_on && t.completed_on <= t.due_date) ? 'done_on_time' : 'done_late';
    }
    if (t.due_date && t.due_date < now) return 'overdue';
    if (t.status === 'doing' && t.stage_id) return `stage-${t.stage_id}`;
    return t.status;
  }

  // Colunas do quadro na ordem da organização. A fazer e Em andamento ficam sempre no começo;
  // as outras (inclusive as criadas) seguem `order`; o que não estiver na ordem entra no fim.
  const FIXED = ['todo', 'doing'];
  function boardColumns(stages = [], order = []) {
    const all = COLUMNS.map(c => ({ ...c, custom: false }))
      .concat(stages.map(st => ({ key: `stage-${st.id}`, name: st.name, custom: true, stage_id: st.id })));
    const movable = all.filter(c => !FIXED.includes(c.key));
    const rank = k => { const i = (order || []).indexOf(k); return i < 0 ? 1e6 + movable.findIndex(c => c.key === k) : i; };
    return all.filter(c => FIXED.includes(c.key)).concat(movable.sort((a, b) => rank(a.key) - rank(b.key)));
  }

  // Ordem dos cards: prazo mais próximo primeiro (sem prazo no fim), depois prioridade alta, média, baixa.
  const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
  function boardSort(a, b) {
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    }
    return (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) || a.id - b.id;
  }

  // Alerta ativo: atrasada, ou dentro da janela de algum aviso escolhido.
  function alert(t, now = today()) {
    if (t.status === 'done' || t.status === 'cancelled' || t.archived_at || !t.due_date) return null;
    const left = daysBetween(now, t.due_date);
    if (left < 0) return { kind: 'overdue', days: left };
    const offsets = Array.isArray(t.alerts) ? t.alerts : [];
    if (offsets.some(o => left <= o)) return { kind: 'soon', days: left };
    return null;
  }
  function alertText(a) {
    if (!a) return '';
    if (a.kind === 'overdue') return a.days === -1 ? 'Venceu ontem' : `Venceu há ${-a.days} dias`;
    if (a.days === 0) return 'Vence hoje';
    if (a.days === 1) return 'Vence amanhã';
    return `Vence em ${a.days} dias`;
  }

  // % de execução: com checklist, segue o checklist; sem checklist, o valor informado.
  function progress(t, checklistTotal, checklistDone) {
    if (t.status === 'done') return 100;
    if (checklistTotal > 0) return Math.round((checklistDone / checklistTotal) * 100);
    return Math.max(0, Math.min(100, Number(t.progress) || 0));
  }

  // Marcar um item do checklist numa tarefa A fazer é começar: vai para Em andamento e, sem início, começa hoje.
  // Devolve o que mudar na tarefa, ou null.
  function startByChecklist(t, day) {
    if (t.status !== 'todo') return null;
    return { status: 'doing', start_date: t.start_date || day };
  }

  // O cliente vê a tarefa? Externa sempre; interna só se estiver ligada a ele e marcada como visível.
  function clientSees(t) {
    return !!t.client_id && (t.kind === 'external' || !!t.client_visible);
  }
  // Quem vê a tarefa.
  // Quem criou e os responsáveis sempre veem. Além deles, depende de "a equipe vê" (team_visible):
  // - Externa: com a marca, o administrador e quem da equipe acompanha o cliente (user.client_ids);
  //   sem a marca ("só os responsáveis"), só o administrador.
  // - Interna: sem a marca, só quem criou e os responsáveis (vale também para administradores);
  //   com a marca, a equipe do cliente ligado (e o administrador) ou, sem cliente, a equipe toda.
  // Cliente: as da empresa dele que clientSees permite (responsável ou não).
  function canSee(user, t, assigneeIds) {
    if (user.role === 'client') return t.client_id === user.client_id && clientSees(t);
    if (t.created_by === user.id || assigneeIds.includes(user.id)) return true;
    const admin = user.role === 'admin';
    const follows = (user.client_ids || []).includes(t.client_id);
    if (t.kind === 'external') return admin || (!!t.team_visible && follows);
    if (!t.team_visible) return false;
    return t.client_id ? admin || follows : true;
  }
  // Pessoa do cliente pode ser responsável quando a tarefa é da empresa dela e ela vê a tarefa.
  function clientAssignable(u, t) {
    return u.role === 'client' && !!t.client_id && u.client_id === Number(t.client_id) && clientSees(t);
  }

  // ---------- leitura das "Próximas etapas" das anotações do Gemini (sem IA) ----------
  const fold = x => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const WEEKDAYS = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
  const SECTION = /^(#+\s*)?(pr[oó]ximas etapas|pr[oó]ximos passos|next steps|a[cç][oõ]es|encaminhamentos|itens de a[cç][aã]o|action items|tarefas)\s*:?\s*$/i;
  const HEADING = /^(#+\s*)?(resumo|summary|detalhes|details|notas|anota[cç][oõ]es|participantes|decis[oõ]es|t[oó]picos|assuntos|pauta)\b.{0,40}:?\s*$/i;
  const weekday = (from, dow) => { let d = addDays(from, 1); for (let i = 0; i < 7; i++, d = addDays(d, 1)) if (parse(d).getUTCDay() === dow) return d; return d; };
  // Prazo escrito na frase, a partir da data da reunião. null quando não há prazo.
  function dueFromText(text, base) {
    const t = fold(text);
    let m = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(t);
    if (m) {
      const day = Number(m[1]), mon = Number(m[2]);
      let year = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : Number(base.slice(0, 4));
      if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
      let iso = `${year}-${pad(mon)}-${pad(day)}`;
      if (!m[3] && iso < addDays(base, -30)) iso = `${year + 1}-${pad(mon)}-${pad(day)}`;
      return iso;
    }
    if ((m = /\b(?:ate|no|para)\s+o?\s*dia\s+(\d{1,2})\b/.exec(t))) {
      const day = Number(m[1]);
      let iso = `${base.slice(0, 8)}${pad(day)}`;
      if (iso < base) iso = addMonths(`${base.slice(0, 8)}01`, 1).slice(0, 8) + pad(day);
      return iso;
    }
    if (/\bhoje\b/.test(t)) return base;
    if (/\bamanha\b/.test(t)) return addDays(base, 1);
    if ((m = /\b(?:em|ate)\s+(\d{1,3})\s+dias?\b/.exec(t))) return addDays(base, Number(m[1]));
    if (/\b(proxima semana|semana que vem)\b/.test(t)) return addDays(base, 7);
    if (/\b(fim|final) do mes\b/.test(t)) return addDays(addMonths(`${base.slice(0, 8)}01`, 1), -1);
    if (/\b(esta|essa) semana\b/.test(t)) return weekday(addDays(base, -1), 5);
    if ((m = /\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.exec(t))) return weekday(base, WEEKDAYS[m[1]]);
    return null;
  }
  // Pessoas citadas pelo nome (completo, ou primeiro nome quando só uma pessoa tem esse primeiro nome).
  function findPeople(text, people) {
    const t = ` ${fold(text).replace(/[^a-z0-9]+/g, ' ')} `;
    const firsts = {};
    for (const p of people) { const f = fold(p.name).split(/\s+/)[0]; firsts[f] = (firsts[f] || 0) + 1; }
    return people.filter(p => {
      const full = fold(p.name).replace(/[^a-z0-9]+/g, ' ').trim();
      const first = full.split(' ')[0];
      return t.includes(` ${full} `) || (firsts[first] === 1 && first.length > 2 && t.includes(` ${first} `));
    });
  }
  // Devolve as tarefas encontradas: { title, description, assignee_ids, client_responsible, due_date, priority, quote }.
  function parseNextSteps(text, { people = [], date: base = today() } = {}) {
    const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim());
    let start = lines.findIndex(l => SECTION.test(l.replace(/[*_]/g, '')));
    let chunk;
    if (start >= 0) {
      chunk = [];
      for (const l of lines.slice(start + 1)) {
        const plain = l.replace(/[*_]/g, '');
        if (chunk.length && (SECTION.test(plain) || HEADING.test(plain))) break;
        chunk.push(l);
      }
    } else chunk = lines.filter(l => /^([-•*▪◦]|\[ ?\]|\d+[.)])\s+/.test(l));
    const items = [];
    for (let raw of chunk) {
      let l = raw.replace(/^([-•*▪◦]|\[[ xX]?\]|\d+[.)])\s*/, '').replace(/[*_]{1,2}/g, '').trim();
      if (l.length < 4) continue;
      let who = [], named = '';
      const br = /^\[([^\]]{2,80})\]\s*[:\-–]?\s*(.*)$/.exec(l);
      if (br) { named = br[1].trim(); l = br[2].trim(); who = findPeople(named, people); }
      else {
        const lead = /^([A-ZÀ-Ý][\wÀ-ÿ]+(?:\s+(?:e|de|da|do|dos|das|[A-ZÀ-Ý][\wÀ-ÿ]+))*?)\s+(vai|vão|irá|irão|deve|devem|fica de|ficou de|ficará|ficarão|precisa|precisam|se comprometeu a|vai\s+\w+)\s+(.*)$/.exec(l);
        if (lead) { named = lead[1]; who = findPeople(named, people); l = lead[3]; }
        else who = findPeople(l, people);
      }
      if (!l) continue;
      let title = l, description = '';
      const colon = /^([^:]{4,120}):\s+(.+)$/.exec(l);
      if (colon) { title = colon[1]; description = colon[2]; }
      title = title.replace(/[.;]+$/, '').trim();
      title = title.charAt(0).toUpperCase() + title.slice(1);
      items.push({
        title: title.slice(0, 200), description: description.slice(0, 2000),
        assignee_ids: [...new Set(who.map(p => p.id))],
        client_responsible: named && !who.length ? named.slice(0, 120) : '',
        due_date: dueFromText(raw, base),
        priority: /\b(urgente|prioridade alta|o quanto antes|asap|imediato)\b/.test(fold(raw)) ? 'high' : 'normal',
        quote: raw.slice(0, 1000),
      });
    }
    return items;
  }

  function validAlerts(list) {
    if (!Array.isArray(list) || !list.every(n => ALERT_DAYS.includes(Number(n)))) return null;
    return [...new Set(list.map(Number))].sort((a, b) => a - b);
  }

  return { STATUSES, STATUS_LABEL, COLUMNS, ALERTS, ALERT_DAYS, RECURRENCE, today, addDays, addMonths, daysBetween, nextDate, column, alert, alertText, progress, startByChecklist, clientSees, canSee, clientAssignable, boardColumns, boardSort, PRIORITY_RANK, parseNextSteps, dueFromText, validAlerts };
});
