'use strict';
// Link de agenda (iCalendar, RFC 5545) de cada pessoa: os compromissos dela e os prazos das tarefas
// que ela vê. O Google Agenda, o Outlook e o iPhone assinam o link e atualizam sozinhos (só leitura).
const crypto = require('node:crypto');

const TZID = 'America/Sao_Paulo'; // sem horário de verão desde 2019
const VTIMEZONE = ['BEGIN:VTIMEZONE', `TZID:${TZID}`, 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
  'TZOFFSETFROM:-0300', 'TZOFFSETTO:-0300', 'TZNAME:-03', 'END:STANDARD', 'END:VTIMEZONE'];
const STATUS_LABEL = { todo: 'A fazer', doing: 'Em andamento', review: 'Em aprovação' };

const newToken = () => crypto.randomBytes(24).toString('base64url');

// Texto: barra, ponto e vírgula, vírgula e quebra de linha são escapados.
const text = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const day = d => d.replace(/-/g, '');
const dateTime = (d, t) => `${day(d)}T${t.replace(':', '')}00`;
const stamp = now => now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const nextDay = d => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
// Sem fim: uma hora depois do início (até 23:59).
const plusHour = t => { const h = Number(t.slice(0, 2)) + 1; return h > 23 ? '23:59' : `${String(h).padStart(2, '0')}${t.slice(2)}`; };

// Linhas com mais de 75 bytes continuam na linha seguinte, começando com espaço (sem cortar caractere no meio).
function fold(line) {
  const out = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function feed({ name, events = [], tasks = [], appUrl = '', now = new Date() }) {
  const link = path => (appUrl ? `${appUrl}/#/${path}` : '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Opps Consultoria//Painel de Tarefas//PT-BR', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${text(`Tarefas Opps · ${name}`)}`, `X-WR-TIMEZONE:${TZID}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', ...VTIMEZONE];
  const dtstamp = `DTSTAMP:${stamp(now)}`;
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:compromisso-${e.id}@tarefas-opps`, dtstamp);
    if (e.start_time) {
      lines.push(`DTSTART;TZID=${TZID}:${dateTime(e.date, e.start_time)}`, `DTEND;TZID=${TZID}:${dateTime(e.date, e.end_time || plusHour(e.start_time))}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${day(e.date)}`, `DTEND;VALUE=DATE:${day(nextDay(e.date))}`);
    }
    const desc = [e.client_name && `Cliente: ${e.client_name}`, e.participants?.length && `Participantes: ${e.participants.map(p => p.name).join(', ')}`,
      e.notes, link('compromissos')].filter(Boolean).join('\n');
    lines.push(`SUMMARY:${text(e.title)}`);
    if (e.location) lines.push(`LOCATION:${text(e.location)}`);
    if (desc) lines.push(`DESCRIPTION:${text(desc)}`);
    lines.push('END:VEVENT');
  }
  for (const t of tasks) {
    const desc = [t.client_name ? `Cliente: ${t.client_name}` : 'Interna', `Situação: ${STATUS_LABEL[t.status] || t.status}`,
      t.assignees?.length && `Responsáveis: ${t.assignees.join(', ')}`, link(`tarefa/${t.id}`)].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT', `UID:tarefa-${t.id}@tarefas-opps`, dtstamp,
      `DTSTART;VALUE=DATE:${day(t.due_date)}`, `DTEND;VALUE=DATE:${day(nextDay(t.due_date))}`,
      `SUMMARY:${text(`Prazo: ${t.title}${t.client_name ? ` (${t.client_name})` : ''}`)}`,
      `DESCRIPTION:${text(desc)}`, 'TRANSP:TRANSPARENT');
    if (link(`tarefa/${t.id}`)) lines.push(`URL:${link(`tarefa/${t.id}`)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { feed, newToken, fold };
