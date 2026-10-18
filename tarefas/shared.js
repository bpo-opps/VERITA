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
  function column(t, now = today()) {
    if (t.status === 'cancelled') return 'cancelled';
    if (t.status === 'done') {
      return !t.due_date || (t.completed_on && t.completed_on <= t.due_date) ? 'done_on_time' : 'done_late';
    }
    if (t.due_date && t.due_date < now) return 'overdue';
    return t.status;
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
  // Quem vê a tarefa. Externa: a equipe toda. Interna: só quem criou e os responsáveis
  // (vale também para administradores). Cliente: as da empresa dele que clientSees permite.
  function canSee(user, t, assigneeIds) {
    if (user.role === 'client') return t.client_id === user.client_id && clientSees(t);
    if (t.kind === 'external') return true;
    return t.created_by === user.id || assigneeIds.includes(user.id);
  }

  function validAlerts(list) {
    if (!Array.isArray(list) || !list.every(n => ALERT_DAYS.includes(Number(n)))) return null;
    return [...new Set(list.map(Number))].sort((a, b) => a - b);
  }

  return { STATUSES, STATUS_LABEL, COLUMNS, ALERTS, ALERT_DAYS, RECURRENCE, today, addDays, addMonths, daysBetween, nextDate, column, alert, alertText, progress, startByChecklist, clientSees, canSee, validAlerts };
});
