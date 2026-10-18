'use strict';
const crypto = require('node:crypto');

const SESSION_DAYS = 14;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function checkPassword(password, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('insert into sessions (token, user_id, expires_at) values (?, ?, ?)').run(token, userId, expires);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

function userFromToken(db, token) {
  if (!token) return null;
  const row = db.prepare(
    `select u.id, u.org_id, u.name, u.email, u.role, u.client_id
       from sessions s join users u on u.id = s.user_id
      where s.token = ? and s.expires_at > ? and u.active = 1`
  ).get(token, Date.now());
  return row || null;
}

// Limite simples de tentativas de login por IP: 10 a cada 15 minutos.
const attempts = new Map();
function loginAllowed(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter(t => now - t < 15 * 60e3);
  attempts.set(ip, list);
  return list.length < 10;
}
function recordFailedLogin(ip) {
  attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]);
}

module.exports = { hashPassword, checkPassword, createSession, userFromToken, loginAllowed, recordFailedLogin };
