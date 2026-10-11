// Password hashing (scrypt) and cookie sessions.
const crypto = require('crypto');
const { db } = require('./db');

const SESSION_DAYS = 30;
const COOKIE = 'sm_session';
const SECURE = process.env.COOKIE_SECURE === '1'; // set when served over HTTPS

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  return { token, expires };
}

function sessionCookie(token, expires) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${new Date(expires).toUTCString()}`];
  if (SECURE) attrs.push('Secure');
  return attrs.join('; ');
}
const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT${SECURE ? '; Secure' : ''}`;

function readToken(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

/** Returns the signed-in user for a request, or null. */
function currentUser(req) {
  const token = readToken(req);
  if (!token) return null;
  const row = db.prepare(`SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, email: row.email, name: row.name };
}

function destroySession(req) {
  const token = readToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

// Simple in-memory limiter for auth endpoints: 10 attempts per 10 minutes per IP.
const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60e3);
  list.push(now);
  attempts.set(ip, list);
  return list.length > 10;
}

setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600e3).unref();

module.exports = { hashPassword, verifyPassword, createSession, sessionCookie, clearCookie, currentUser, destroySession, rateLimited, newId };
