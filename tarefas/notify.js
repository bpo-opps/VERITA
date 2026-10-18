'use strict';
// Avisos por e-mail e WhatsApp: tarefa criada, prazo chegando (nos alertas escolhidos na tarefa),
// primeiro dia de atraso e resumo semanal (segunda às 8h). Cada aviso entra uma vez na tabela
// notifications (dedupe_key) e o despacho envia pelo canal configurado; sem canal configurado,
// o aviso fica registrado como "não enviado", com o motivo.
const S = require('./shared');
const mailer = require('./mailer');
const whatsapp = require('./whatsapp');

const SEND_FROM_HOUR = 8; // avisos de prazo e o resumo saem a partir das 8h (fuso do servidor)
const WEEKLY_DOW = 1; // segunda-feira
const MAX_ATTEMPTS = 3;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const br = d => (d ? d.split('-').reverse().join('/') : 'sem prazo');
const first = name => String(name).split(/\s+/)[0];

function createNotifier(db, { env = process.env, now = () => new Date(), senders = {}, log = console } = {}) {
  const appUrl = (env.APP_URL || '').replace(/\/$/, '');
  const emailCfg = mailer.config(env);
  const waCfg = whatsapp.config(env);
  const sendEmail = senders.email || (emailCfg ? mail => mailer.send(emailCfg, mail) : null);
  const sendWhatsApp = senders.whatsapp || (waCfg ? msg => whatsapp.send(waCfg, msg) : null);
  const taskLink = id => (appUrl ? `${appUrl}/#/tarefa/${id}` : null);

  const orgName = orgId => db.prepare('select name from orgs where id = ?').get(orgId).name;
  const assigneeIds = taskId => db.prepare('select user_id from task_assignees where task_id = ?').all(taskId).map(r => r.user_id);

  // Quem recebe avisos de uma tarefa: os responsáveis e, se o cliente vê a tarefa, as pessoas desse cliente.
  function recipients(t, { except } = {}) {
    const ids = new Set(assigneeIds(t.id));
    if (S.clientSees(t)) for (const u of db.prepare("select id from users where role = 'client' and client_id = ? and active = 1").all(t.client_id)) ids.add(u.id);
    if (except) ids.delete(except);
    return [...ids].map(id => db.prepare('select * from users where id = ? and active = 1').get(id)).filter(Boolean)
      // Confere de novo com a regra de visibilidade: ninguém recebe aviso de tarefa que não pode ver.
      .filter(u => S.canSee(u, t, assigneeIds(t.id)));
  }

  function layout({ title, intro, rows = [], button, footer }) {
    const btn = button ? `<p style="margin:24px 0 8px"><a href="${esc(button.href)}" style="background:#d2400f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">${esc(button.label)}</a></p>` : '';
    const table = rows.length ? `<table style="border-collapse:collapse;margin-top:12px;width:100%">${rows.map(([k, v]) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#5b6475;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#121826">${v}</td></tr>`).join('')}</table>` : '';
    return `<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#121826">
<div style="max-width:560px;margin:0 auto;padding:24px 16px">
<div style="height:4px;background:linear-gradient(90deg,#FBD200,#FF6A00 55%,#FB4F14);border-radius:4px 4px 0 0"></div>
<div style="background:#fff;border:1px solid #e4e8ef;border-top:0;border-radius:0 0 12px 12px;padding:24px">
<p style="margin:0 0 4px;color:#FB4F14;font-weight:700;font-size:13px;letter-spacing:.04em">PAINEL DE TAREFAS OPPS</p>
<h1 style="margin:0 0 12px;font-size:20px;line-height:26px">${esc(title)}</h1>
<p style="margin:0;line-height:22px">${intro}</p>${table}${btn}
</div>
<p style="color:#5b6475;font-size:12px;line-height:18px;margin:16px 4px 0">${footer || 'Você recebe este aviso porque é responsável ou acompanha esta tarefa. Para mudar como recebe, abra Minha conta no Painel de Tarefas.'}</p>
</div></body></html>`;
  }

  function taskRows(t) {
    return [
      ['Tarefa', `<strong>${esc(t.title)}</strong>`],
      ['Empresa', esc(t.client_id ? db.prepare('select name from clients where id = ?').get(t.client_id).name : orgName(t.org_id))],
      ['Prazo', esc(br(t.due_date))],
      ['Responsáveis', esc(db.prepare('select u.name from task_assignees a join users u on u.id = a.user_id where a.task_id = ? order by u.name').all(t.id).map(r => r.name).join(', ') || '–')],
    ];
  }
  const clientName = t => (t.client_id ? db.prepare('select name from clients where id = ?').get(t.client_id).name : orgName(t.org_id));

  // Grava um aviso para cada canal que a pessoa aceita. A chave impede duplicar.
  function enqueue(user, { kind, key, taskId, subject, text, html, waParams }) {
    const channels = [];
    if (user.notify_email && user.email) channels.push('email');
    if (user.notify_whatsapp && user.phone && user.whatsapp_consent_at) channels.push('whatsapp');
    const ins = db.prepare(
      `insert or ignore into notifications (org_id, user_id, task_id, channel, kind, dedupe_key, subject, body, html, wa_params)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    let added = 0;
    for (const ch of channels) {
      added += Number(ins.run(user.org_id, user.id, taskId ?? null, ch, kind, `${key}:${ch}`, subject, text, ch === 'email' ? html : null,
        ch === 'whatsapp' ? JSON.stringify(waParams) : null).changes);
    }
    return added;
  }

  function taskCreated(taskId, actorId) {
    const t = db.prepare('select * from tasks where id = ?').get(taskId);
    if (!t || t.archived_at) return 0;
    let n = 0;
    for (const u of recipients(t, { except: actorId })) {
      const intro = `Olá, ${esc(first(u.name))}. ${u.role === 'client' ? 'Uma nova tarefa foi aberta para a sua empresa.' : 'Uma nova tarefa foi criada e você é responsável por ela.'}`;
      n += enqueue(u, {
        kind: 'created', key: `created:${t.id}:${u.id}`, taskId: t.id,
        subject: `Nova tarefa: ${t.title}`,
        text: `Olá, ${first(u.name)}. Nova tarefa: ${t.title}\nEmpresa: ${clientName(t)}\nPrazo: ${br(t.due_date)}${taskLink(t.id) ? `\nAbrir: ${taskLink(t.id)}` : ''}`,
        html: layout({ title: 'Nova tarefa', intro, rows: taskRows(t), button: taskLink(t.id) && { href: taskLink(t.id), label: 'Abrir a tarefa' } }),
        waParams: [first(u.name), t.title, clientName(t), br(t.due_date)],
      });
    }
    return n;
  }

  // Prazo chegando (no dia em que bate um dos alertas da tarefa) e o primeiro dia de atraso.
  function dueNotices(today) {
    let n = 0;
    const open = db.prepare("select * from tasks where status not in ('done','cancelled') and archived_at is null and due_date is not null").all();
    for (const t of open) {
      const left = S.daysBetween(today, t.due_date);
      const alerts = JSON.parse(t.alerts);
      let kind = null;
      if (left === -1) kind = 'overdue';
      else if (left >= 0 && alerts.includes(left)) kind = 'due';
      if (!kind) continue;
      const when = kind === 'overdue' ? 'venceu ontem' : left === 0 ? 'vence hoje' : left === 1 ? 'vence amanhã' : `vence em ${left} dias`;
      for (const u of recipients(t)) {
        n += enqueue(u, {
          kind, key: `${kind}:${t.id}:${t.due_date}:${left}:${u.id}`, taskId: t.id,
          subject: kind === 'overdue' ? `Atrasada: ${t.title}` : `Prazo chegando: ${t.title} ${when}`,
          text: `Olá, ${first(u.name)}. A tarefa "${t.title}" ${when} (prazo ${br(t.due_date)}).${taskLink(t.id) ? `\nAbrir: ${taskLink(t.id)}` : ''}`,
          html: layout({ title: kind === 'overdue' ? 'Tarefa atrasada' : 'Prazo chegando',
            intro: `Olá, ${esc(first(u.name))}. A tarefa abaixo <strong>${esc(when)}</strong>.`, rows: taskRows(t),
            button: taskLink(t.id) && { href: taskLink(t.id), label: 'Abrir a tarefa' } }),
          waParams: [first(u.name), t.title, when, br(t.due_date)],
        });
      }
    }
    return n;
  }

  // Resumo semanal: para cada pessoa, o que está atrasado, o que vence nos próximos 7 dias e o que está em andamento.
  function weeklyDigest(today) {
    let n = 0;
    const users = db.prepare('select * from users where active = 1').all();
    const open = db.prepare("select * from tasks where status not in ('done','cancelled') and archived_at is null").all();
    for (const u of users) {
      const mine = open.filter(t => t.org_id === u.org_id && S.canSee(u, t, assigneeIds(t.id))
        && (u.role === 'client' || assigneeIds(t.id).includes(u.id)));
      if (!mine.length) continue;
      const late = mine.filter(t => t.due_date && t.due_date < today);
      const week = mine.filter(t => t.due_date && t.due_date >= today && t.due_date <= S.addDays(today, 6));
      const doing = mine.filter(t => t.status === 'doing' && !late.includes(t) && !week.includes(t));
      const sort = l => l.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
      const block = (title, list) => (list.length ? `<h2 style="font-size:15px;margin:20px 0 6px">${esc(title)} (${list.length})</h2><ul style="margin:0;padding-left:18px;line-height:22px">${sort(list).map(t =>
        `<li>${taskLink(t.id) ? `<a href="${esc(taskLink(t.id))}" style="color:#d2400f">${esc(t.title)}</a>` : esc(t.title)} <span style="color:#5b6475">· ${esc(clientName(t))} · prazo ${esc(br(t.due_date))}</span></li>`).join('')}</ul>` : '');
      const textBlock = (title, list) => (list.length ? `\n${title}:\n${sort(list).map(t => `- ${t.title} (${clientName(t)}, prazo ${br(t.due_date)})`).join('\n')}` : '');
      n += enqueue(u, {
        kind: 'weekly', key: `weekly:${today}:${u.id}`,
        subject: `Resumo da semana: ${late.length} atrasada${late.length === 1 ? '' : 's'}, ${week.length} vencendo`,
        text: `Olá, ${first(u.name)}. Seu resumo da semana.${textBlock('Atrasadas', late)}${textBlock('Vencem nos próximos 7 dias', week)}${textBlock('Em andamento', doing)}${appUrl ? `\nAbrir o painel: ${appUrl}` : ''}`,
        html: layout({ title: 'Resumo da semana', intro: `Olá, ${esc(first(u.name))}. ${u.role === 'client' ? 'Estas são as tarefas abertas da sua empresa.' : 'Estas são as suas tarefas abertas.'}`
          + block('Atrasadas', late) + block('Vencem nos próximos 7 dias', week) + block('Em andamento', doing),
          button: appUrl && { href: appUrl, label: 'Abrir o Painel de Tarefas' },
          footer: 'Resumo enviado toda segunda às 8h. Para mudar como recebe, abra Minha conta no Painel de Tarefas.' }),
        waParams: [first(u.name), String(late.length), String(week.length), String(doing.length)],
      });
    }
    return n;
  }

  async function dispatch() {
    const pending = db.prepare("select n.*, u.email, u.phone from notifications n join users u on u.id = n.user_id where n.status = 'pending' order by n.id limit 100").all();
    let sent = 0;
    for (const m of pending) {
      const sender = m.channel === 'email' ? sendEmail : sendWhatsApp;
      if (!sender) {
        db.prepare("update notifications set status = 'not_sent', error = ? where id = ?")
          .run(m.channel === 'email' ? 'E-mail não configurado no servidor (SMTP_*)' : 'WhatsApp não configurado no servidor (WHATSAPP_*)', m.id);
        continue;
      }
      try {
        if (m.channel === 'email') await sender({ to: m.email, subject: m.subject, text: m.body, html: m.html });
        else await sender({ to: m.phone, kind: m.kind === 'test' ? 'created' : m.kind, params: JSON.parse(m.wa_params || '[]') });
        db.prepare("update notifications set status = 'sent', sent_at = datetime('now'), error = null, attempts = attempts + 1 where id = ?").run(m.id);
        sent++;
      } catch (err) {
        const attempts = m.attempts + 1;
        db.prepare('update notifications set attempts = ?, error = ?, status = ? where id = ?')
          .run(attempts, String(err.message).slice(0, 500), attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', m.id);
        log.error?.(`Aviso ${m.id} (${m.channel}) falhou: ${err.message}`);
      }
    }
    return sent;
  }

  // Roda a cada poucos minutos: gera os avisos de prazo e o resumo (a partir das 8h) e despacha.
  async function tick() {
    const d = now();
    const today = S.today(d);
    if (d.getHours() >= SEND_FROM_HOUR) {
      dueNotices(today);
      if (d.getDay() === WEEKLY_DOW) weeklyDigest(today);
    }
    return dispatch();
  }

  async function testEmail(user) {
    if (!user.email) throw new Error('Sua conta não tem e-mail');
    const key = `test:${user.id}:${Date.now()}`;
    db.prepare(`insert into notifications (org_id, user_id, channel, kind, dedupe_key, subject, body, html)
      values (?, ?, 'email', 'test', ?, ?, ?, ?)`).run(user.org_id, user.id, key, 'Teste do Painel de Tarefas Opps',
      `Olá, ${first(user.name)}. Se você recebeu este e-mail, os avisos do Painel de Tarefas estão funcionando.`,
      layout({ title: 'Teste de envio', intro: `Olá, ${esc(first(user.name))}. Se você recebeu este e-mail, os avisos do Painel de Tarefas estão funcionando.`,
        footer: 'E-mail de teste enviado pela tela Avisos.' }));
    await dispatch();
    return db.prepare('select status, error from notifications where dedupe_key = ?').get(key);
  }

  function status() {
    return {
      email: emailCfg ? { configured: true, from: emailCfg.from, host: emailCfg.host } : { configured: !!senders.email },
      whatsapp: waCfg ? { configured: true } : { configured: !!senders.whatsapp },
      app_url: appUrl || null,
      schedule: { weekly: 'segunda-feira às 08:00', due_from_hour: SEND_FROM_HOUR },
    };
  }

  let timer = null;
  function start(intervalMs = 5 * 60 * 1000) {
    const run = () => tick().catch(err => log.error?.('Avisos:', err));
    run();
    timer = setInterval(run, intervalMs);
    timer.unref?.();
  }
  const stop = () => clearInterval(timer);

  // Enfileira e despacha sem segurar a resposta da requisição.
  function onTaskCreated(taskId, actorId) {
    try { if (taskCreated(taskId, actorId)) dispatch().catch(err => log.error?.('Avisos:', err)); } catch (err) { log.error?.('Avisos:', err); }
  }

  return { taskCreated, dueNotices, weeklyDigest, dispatch, tick, testEmail, status, start, stop, onTaskCreated };
}

module.exports = { createNotifier };
