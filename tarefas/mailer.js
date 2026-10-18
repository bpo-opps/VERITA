'use strict';
// Envio de e-mail por SMTP, sem dependências. Feito para o Google Workspace:
// smtp.gmail.com na porta 465 (TLS direto) com senha de app, ou porta 587 com STARTTLS.
// "none" (texto puro) existe só para os testes, contra um servidor falso local.
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

function config(env = process.env) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;
  const port = Number(env.SMTP_PORT) || 465;
  return {
    host: env.SMTP_HOST, port, user: env.SMTP_USER, pass: env.SMTP_PASS,
    from: env.SMTP_FROM || env.SMTP_USER,
    secure: env.SMTP_SECURE || (port === 465 ? 'tls' : 'starttls'),
  };
}

// Lê respostas SMTP (inclusive multilinha "250-...") e devolve { code, text }.
function reader(socket) {
  let buf = '';
  const waiting = [];
  const lines = [];
  const flush = () => {
    while (waiting.length) {
      const idx = lines.findIndex(l => /^\d{3} /.test(l));
      if (idx < 0) return;
      const block = lines.splice(0, idx + 1);
      waiting.shift().resolve({ code: Number(block[idx].slice(0, 3)), text: block.join('\n') });
    }
  };
  const onData = d => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 2); }
    flush();
  };
  socket.on('data', onData);
  const onError = err => { while (waiting.length) waiting.shift().reject(err); };
  socket.on('error', onError);
  socket.on('close', () => onError(new Error('Conexão SMTP fechada')));
  return {
    next: () => new Promise((resolve, reject) => { waiting.push({ resolve, reject }); flush(); }),
    detach: () => { socket.off('data', onData); socket.off('error', onError); },
  };
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const wrap = s => s.replace(/.{1,76}/g, '$&\r\n');
// Cabeçalho com acentos (RFC 2047).
const encodeHeader = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
function encodeAddress(addr) {
  const m = /^(.*)<([^>]+)>\s*$/.exec(addr);
  return m ? `${encodeHeader(m[1].trim().replace(/^"|"$/g, ''))} <${m[2]}>` : addr;
}
const bareEmail = addr => (/<([^>]+)>/.exec(addr) || [null, addr])[1].trim();

function buildMessage({ from, to, subject, text, html }) {
  const boundary = 'b' + crypto.randomBytes(12).toString('hex');
  const domain = bareEmail(from).split('@')[1] || 'localhost';
  const headers = [
    `From: ${encodeAddress(from)}`,
    `To: ${encodeAddress(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type, body) => [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap(b64(body))].join('\r\n');
  return headers.join('\r\n') + '\r\n\r\n' + part('text/plain', text) + '\r\n' + part('text/html', html || text) + `\r\n--${boundary}--\r\n`;
}

async function send(cfg, mail, { timeoutMs = 20000 } = {}) {
  let socket = cfg.secure === 'tls'
    ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : net.connect({ host: cfg.host, port: cfg.port });
  socket.setTimeout(timeoutMs, () => socket.destroy(new Error('Tempo esgotado falando com o servidor de e-mail')));
  let r = reader(socket);
  const expect = async (codes, what) => {
    const res = await r.next();
    if (!codes.includes(res.code)) throw new Error(`${what}: ${res.text}`);
    return res;
  };
  const cmd = (line, codes, what) => { socket.write(line + '\r\n'); return expect(codes, what); };
  try {
    await expect([220], 'Conexão');
    await cmd(`EHLO ${require('node:os').hostname() || 'localhost'}`, [250], 'EHLO');
    if (cfg.secure === 'starttls') {
      await cmd('STARTTLS', [220], 'STARTTLS');
      r.detach();
      socket = tls.connect({ socket, servername: cfg.host });
      await new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject); });
      r = reader(socket);
      await cmd(`EHLO ${require('node:os').hostname() || 'localhost'}`, [250], 'EHLO');
    }
    await cmd('AUTH LOGIN', [334], 'Login');
    await cmd(b64(cfg.user), [334], 'Login (usuário)');
    await cmd(b64(cfg.pass), [235], 'Login (senha)');
    await cmd(`MAIL FROM:<${bareEmail(cfg.from)}>`, [250], 'Remetente');
    await cmd(`RCPT TO:<${bareEmail(mail.to)}>`, [250, 251], 'Destinatário');
    await cmd('DATA', [354], 'DATA');
    const body = buildMessage({ ...mail, from: cfg.from }).replace(/\r\n\./g, '\r\n..');
    await cmd(body + '\r\n.', [250], 'Envio');
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
  }
}

module.exports = { config, send, buildMessage };
