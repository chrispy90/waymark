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

// Simple in-memory limiter for auth endpoints: `max` attempts per 10 minutes per key (e.g. action + IP).
const attempts = new Map();
function rateLimited(key, max = 10) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 10 * 60e3);
  list.push(now);
  attempts.set(key, list);
  return list.length > max;
}

/* ---------- Password reset ---------- */

const RESET_MINUTES = 60;

/** Creates a single-use reset token for a user and returns the raw token (only its hash is stored). */
function createResetToken(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId); // one live link per user
  db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, Date.now() + RESET_MINUTES * 60e3);
  return token;
}

/** Sets a new password if the token is valid, and signs the user out everywhere. Returns the user id or null. */
function consumeResetToken(token, newPassword) {
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(String(token)));
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  const hash = hashPassword(newPassword);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ?').run(Date.now(), row.token_hash);
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hash, row.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return row.user_id;
}

const resetTokenValid = (token) => {
  const row = db.prepare('SELECT expires_at, used_at FROM password_resets WHERE token_hash = ?').get(sha256(String(token)));
  return !!row && !row.used_at && row.expires_at >= Date.now();
};

setInterval(() => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('DELETE FROM password_resets WHERE expires_at < ?').run(Date.now() - 864e5);
}, 3600e3).unref();

module.exports = { hashPassword, verifyPassword, createSession, sessionCookie, clearCookie, currentUser, destroySession, rateLimited, newId, createResetToken, consumeResetToken, resetTokenValid, RESET_MINUTES };
