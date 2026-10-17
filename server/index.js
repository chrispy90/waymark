// Waymark server: static files, JSON API, image uploads, published story pages.
// Zero dependencies: node:http + node:sqlite.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { db, UPLOAD_DIR, LAYER_DIR } = require('./db');
const auth = require('./auth');
const brand = require('./brand');
const { sendMail, mailConfigured } = require('./mail');

const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = +process.env.PORT || 5180;
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== '0';
// Base URL for emailed links. Never taken from the request's Host header, which an attacker controls.
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const MAX_STORY = 8 * 1024 * 1024;
const MAX_UPLOAD = 12 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
};

// Pages render untrusted story content, so lock scripts down to our own origin + the MapLibre CDN.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
  "font-src 'self' https://fonts.gstatic.com",
  'img-src * data: blob:',
  'media-src *',
  'connect-src *',
  'frame-src *',
  'worker-src blob:',
  'child-src blob:',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/* ---------------- helpers ---------------- */

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, `Too large (max ${Math.round(limit / 1048576)} MB)`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 64 * 1024) {
  if (!/^application\/json/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Expected JSON');
  try { return JSON.parse((await readBody(req, limit)).toString('utf8') || '{}'); } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'Invalid JSON');
  }
}

const requireUser = (req) => {
  const user = auth.currentUser(req);
  if (!user) throw new HttpError(401, 'Sign in required');
  return user;
};

function ownStory(user, id) {
  const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
  if (!row || row.owner_id !== user.id) throw new HttpError(404, 'Story not found');
  return row;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/;
const slugify = (s) => String(s || 'story').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 48).replace(/^-|-$/g, '') || 'story';
function uniqueSlug(base, storyId) {
  let slug = base;
  for (let n = 2; db.prepare('SELECT id FROM stories WHERE slug = ? AND id != ?').get(slug, storyId); n++) slug = `${base}-${n}`;
  return slug;
}

function validateStory(story) {
  if (!story || typeof story !== 'object' || Array.isArray(story)) throw new HttpError(400, 'Story must be an object');
  if (!Array.isArray(story.blocks)) throw new HttpError(400, 'Story needs a blocks array');
  if (story.layers != null && !Array.isArray(story.layers)) throw new HttpError(400, 'layers must be an array');
  return String(story.title || 'Untitled story').slice(0, 300);
}

function validateMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new HttpError(400, 'Map must be an object');
  if (!Array.isArray(map.layers)) throw new HttpError(400, 'Map needs a layers array');
  if (map.bookmarks != null && !Array.isArray(map.bookmarks)) throw new HttpError(400, 'bookmarks must be an array');
  return String(map.title || 'Untitled map').slice(0, 300);
}

function ownMap(user, id) {
  const row = db.prepare('SELECT * FROM maps WHERE id = ?').get(id);
  if (!row || row.owner_id !== user.id) throw new HttpError(404, 'Map not found');
  return row;
}

const mapSummary = (r) => ({
  id: r.id, title: r.title, version: r.version, updatedAt: r.updated_at, createdAt: r.created_at, shared: !!r.shared,
  ...(r.layers !== undefined ? { layers: r.layers ?? 0, bookmarks: r.bookmarks ?? 0, thumbnail: r.thumbnail || null } : {}),
});

// Saved maps a story uses: views reference them as "map": "<id>".
const mapIdsIn = (json) => [...new Set([...String(json).matchAll(/"map":"([\w-]{4,40})"/g)].map((m) => m[1]))];

// Hosted layers referenced by URL or hostedLayerId in a story or map JSON.
const layerIdsIn = (json) => [...new Set([
  ...[...String(json).matchAll(/\/api\/(?:public\/)?layers\/([\w-]{4,40})(?:\/geojson|\.geojson)/g)].map((m) => m[1]),
  ...[...String(json).matchAll(/"hostedLayerId":"([\w-]{4,40})"/g)].map((m) => m[1]),
])];

function ownLayer(user, id) {
  const row = db.prepare('SELECT * FROM layers WHERE id = ?').get(id);
  if (!row || row.owner_id !== user.id) throw new HttpError(404, 'Layer not found');
  return row;
}

const layerFile = (id) => path.join(LAYER_DIR, `${String(id).replace(/[^\w-]/g, '')}.geojson`);

function readLayerGeoJSON(id) {
  const file = layerFile(id);
  if (!fs.existsSync(file)) return { type: 'FeatureCollection', metadata: {}, features: [] };
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { type: 'FeatureCollection', metadata: {}, features: [] }; }
}

function normalizeFields(fields, features = []) {
  const out = [];
  const seen = new Set();
  if (Array.isArray(fields)) {
    for (const f of fields) {
      const name = String(typeof f === 'string' ? f : f?.name || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const type = ['string', 'number', 'boolean', 'date'].includes(f?.type) ? f.type : 'string';
      const entry = { name, type };
      if (f?.alias) entry.alias = String(f.alias).trim().slice(0, 120);
      if (f?.default !== undefined) entry.default = f.default;
      out.push(entry);
    }
  }
  for (const feat of features) {
    const props = feat?.properties;
    if (!props || typeof props !== 'object') continue;
    for (const [k, v] of Object.entries(props)) {
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const type = typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string';
      out.push({ name: k, type });
    }
  }
  return out;
}

function detectGeomType(features = [], fallback = 'Point') {
  for (const f of features) {
    const t = f?.geometry?.type;
    if (!t) continue;
    if (t.includes('Point')) return 'Point';
    if (t.includes('Line')) return 'LineString';
    if (t.includes('Polygon')) return 'Polygon';
  }
  return ['Point', 'LineString', 'Polygon'].includes(fallback) ? fallback : 'Point';
}

function normalizeLayerData(data, meta = {}) {
  const raw = data && typeof data === 'object' ? data : {};
  const features = Array.isArray(raw.features) ? raw.features : raw.type === 'Feature' ? [raw] : [];
  const cleanFeatures = features.filter((f) => f && typeof f === 'object').map((f, idx) => ({
    type: 'Feature',
    id: f.id ?? idx + 1,
    properties: f.properties && typeof f.properties === 'object' && !Array.isArray(f.properties) ? { ...f.properties } : {},
    geometry: f.geometry && typeof f.geometry === 'object' ? f.geometry : null,
  }));
  const existingMeta = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
  return {
    type: 'FeatureCollection',
    metadata: { ...existingMeta, ...meta },
    features: cleanFeatures,
  };
}

const layerSummary = (r) => ({
  id: r.id,
  title: r.title,
  summary: r.summary || '',
  attribution: r.attribution || '',
  geomType: r.geom_type || 'Point',
  featureCount: r.feature_count ?? 0,
  fields: typeof r.fields === 'string' ? JSON.parse(r.fields || '[]') : (r.fields || []),
  style: typeof r.style === 'string' ? JSON.parse(r.style || '{}') : (r.style || {}),
  popup: typeof r.popup === 'string' ? JSON.parse(r.popup || '{}') : (r.popup || {}),
  version: r.version,
  shared: !!r.shared,
  url: `/api/layers/${r.id}/geojson`,
  publicUrl: `/api/public/layers/${r.id}.geojson`,
  updatedAt: r.updated_at,
  createdAt: r.created_at,
});

const summary = (r) => ({
  id: r.id, title: r.title, version: r.version, updatedAt: r.updated_at, createdAt: r.created_at,
  slug: r.slug, publishedAt: r.published_at, url: r.slug && r.published ? `/s/${r.slug}` : null,
  hasUnpublishedChanges: !!r.published && r.published_at < r.updated_at,
  ...(r.cover !== undefined ? { cover: r.cover || null, blocks: r.blocks ?? 0 } : {}),
});

// Identify image types by their bytes, never by the client's claimed type.
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ['image/jpeg', '.jpg'];
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['image/png', '.png'];
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return ['image/gif', '.gif'];
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return ['image/webp', '.webp'];
  return null;
}

/* ---------------- API routes ---------------- */

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

const DUMMY_HASH = auth.hashPassword('timing-equalizer');

route('POST', '/api/auth/signup', async (req) => {
  if (!ALLOW_SIGNUP && db.prepare('SELECT 1 FROM users LIMIT 1').get()) throw new HttpError(403, 'Sign-ups are closed');
  if (auth.rateLimited(`signup:${req.socket.remoteAddress}`)) throw new HttpError(429, 'Too many attempts, try again later');
  const { email, password, name } = await readJson(req);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) throw new HttpError(400, 'Enter a valid email');
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with that email already exists');
  const id = auth.newId();
  db.prepare('INSERT INTO users (id, email, name, pass_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, email.trim(), String(name || '').slice(0, 100), auth.hashPassword(password), Date.now());
  const s = auth.createSession(id);
  return [201, { user: { id, email, name: name || '' } }, { 'Set-Cookie': auth.sessionCookie(s.token, s.expires) }];
});

route('POST', '/api/auth/login', async (req) => {
  if (auth.rateLimited(`login:${req.socket.remoteAddress}`)) throw new HttpError(429, 'Too many attempts, try again later');
  const { email, password } = await readJson(req);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || ''));
  const ok = auth.verifyPassword(String(password || ''), user ? user.pass_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Wrong email or password');
  const s = auth.createSession(user.id);
  return [200, { user: { id: user.id, email: user.email, name: user.name } }, { 'Set-Cookie': auth.sessionCookie(s.token, s.expires) }];
});

route('POST', '/api/auth/logout', async (req) => {
  auth.destroySession(req);
  return [200, { ok: true }, { 'Set-Cookie': auth.clearCookie() }];
});

route('GET', '/api/me', async (req) => {
  const firstRun = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
  return [200, { user: auth.currentUser(req), signupOpen: ALLOW_SIGNUP || firstRun, firstRun }];
});

// Always answers the same way, so it can't be used to discover which emails have accounts.
route('POST', '/api/auth/forgot', async (req) => {
  const { email } = await readJson(req);
  const ok = [200, { ok: true, message: 'If that email has an account, a reset link is on its way.' }];
  const addr = String(email || '').trim().toLowerCase();
  if (auth.rateLimited(`forgot:${req.socket.remoteAddress}`, 5) || auth.rateLimited(`forgot:${addr}`, 3)) return ok;
  const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(addr);
  if (!user) return ok;
  const link = `${APP_URL}/reset.html?token=${auth.createResetToken(user.id)}`;
  sendMail({
    to: user.email,
    subject: `Reset your ${brand.name} password`,
    text: `Hi${user.name ? ' ' + user.name : ''},\n\nSomeone asked to reset the password for your ${brand.name} account. To choose a new password, open this link within ${auth.RESET_MINUTES} minutes:\n\n${link}\n\nIf you didn't ask for this, ignore this email. Your password won't change.\n`,
  }).catch((err) => console.error(`Could not send reset email to ${user.email}: ${err.message}`));
  return ok;
});

route('GET', '/api/auth/reset/:token', async (req, p) => [200, { valid: auth.resetTokenValid(p.token) }]);

route('POST', '/api/auth/reset', async (req) => {
  if (auth.rateLimited(`reset:${req.socket.remoteAddress}`)) throw new HttpError(429, 'Too many attempts, try again later');
  const { token, password } = await readJson(req);
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  const userId = auth.consumeResetToken(token, password);
  if (!userId) throw new HttpError(400, 'This reset link is invalid or has expired. Request a new one.');
  const s = auth.createSession(userId);
  return [200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(s.token, s.expires) }];
});

route('POST', '/api/auth/password', async (req) => {
  const user = requireUser(req);
  const { current, password } = await readJson(req);
  const row = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(user.id);
  if (!auth.verifyPassword(String(current || ''), row.pass_hash)) throw new HttpError(400, 'Current password is wrong');
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(password), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id); // sign out other devices
  const s = auth.createSession(user.id);
  return [200, { ok: true }, { 'Set-Cookie': auth.sessionCookie(s.token, s.expires) }];
});

route('GET', '/api/stories', async (req) => {
  const user = requireUser(req);
  const rows = db.prepare(`SELECT id, title, version, slug, published IS NOT NULL AS published, published_at, created_at, updated_at, json_extract(draft, '$.cover.image') AS cover, json_array_length(draft, '$.blocks') AS blocks FROM stories WHERE owner_id = ? ORDER BY updated_at DESC`).all(user.id);
  return [200, { stories: rows.map(summary) }];
});

route('POST', '/api/stories', async (req) => {
  const user = requireUser(req);
  const { story } = await readJson(req, MAX_STORY);
  const title = validateStory(story);
  const id = auth.newId();
  const now = Date.now();
  db.prepare('INSERT INTO stories (id, owner_id, title, draft, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, user.id, title, JSON.stringify({ ...story, id }), now, now);
  return [201, summary(db.prepare('SELECT * FROM stories WHERE id = ?').get(id))];
});

route('GET', '/api/stories/:id', async (req, p) => {
  const row = ownStory(requireUser(req), p.id);
  return [200, { ...summary(row), story: JSON.parse(row.draft) }];
});

route('PUT', '/api/stories/:id', async (req, p) => {
  const user = requireUser(req);
  const row = ownStory(user, p.id);
  const { story, version } = await readJson(req, MAX_STORY);
  if (version !== row.version) throw new HttpError(409, 'This story was changed somewhere else', { version: row.version, updatedAt: row.updated_at });
  const title = validateStory(story);
  const now = Math.max(Date.now(), row.updated_at + 1);
  db.prepare('UPDATE stories SET title = ?, draft = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
    .run(title, JSON.stringify({ ...story, id: row.id }), now, row.id, version);
  return [200, summary(db.prepare('SELECT * FROM stories WHERE id = ?').get(row.id))];
});

route('DELETE', '/api/stories/:id', async (req, p) => {
  const row = ownStory(requireUser(req), p.id);
  db.prepare('DELETE FROM stories WHERE id = ?').run(row.id);
  return [200, { ok: true }];
});

route('POST', '/api/stories/:id/publish', async (req, p) => {
  const row = ownStory(requireUser(req), p.id);
  const body = await readJson(req);
  let slug = body.slug != null ? String(body.slug).toLowerCase().trim() : row.slug || uniqueSlug(slugify(row.title), row.id);
  if (!SLUG.test(slug)) throw new HttpError(400, 'Use 3–60 lowercase letters, numbers and dashes for the link');
  if (db.prepare('SELECT id FROM stories WHERE slug = ? AND id != ?').get(slug, row.id)) throw new HttpError(409, 'That link is already taken');
  const now = Math.max(Date.now(), row.updated_at);
  db.prepare('UPDATE stories SET published = draft, slug = ?, published_at = ? WHERE id = ?').run(slug, now, row.id);
  // Readers need to load the saved maps and hosted layers this story uses.
  const shareMap = db.prepare('UPDATE maps SET shared = 1 WHERE id = ? AND owner_id = ?');
  const shareLayer = db.prepare('UPDATE layers SET shared = 1 WHERE id = ? AND owner_id = ?');
  const mapIds = mapIdsIn(row.draft);
  mapIds.forEach((id) => shareMap.run(id, row.owner_id));
  const layerIds = new Set(layerIdsIn(row.draft));
  for (const mId of mapIds) {
    const mRow = db.prepare('SELECT data FROM maps WHERE id = ? AND owner_id = ?').get(mId, row.owner_id);
    if (mRow) layerIdsIn(mRow.data).forEach((lId) => layerIds.add(lId));
  }
  layerIds.forEach((id) => shareLayer.run(id, row.owner_id));
  return [200, summary(db.prepare('SELECT * FROM stories WHERE id = ?').get(row.id))];
});

route('POST', '/api/stories/:id/unpublish', async (req, p) => {
  const row = ownStory(requireUser(req), p.id);
  db.prepare('UPDATE stories SET published = NULL, published_at = NULL WHERE id = ?').run(row.id);
  return [200, summary(db.prepare('SELECT * FROM stories WHERE id = ?').get(row.id))];
});

route('GET', '/api/public/:slug', async (req, p) => {
  const row = db.prepare('SELECT published FROM stories WHERE slug = ? AND published IS NOT NULL').get(p.slug);
  if (!row) throw new HttpError(404, 'Story not found');
  return [200, JSON.parse(row.published), { 'Cache-Control': 'public, max-age=60' }];
});

/* ---------------- Saved maps ---------------- */

route('GET', '/api/maps', async (req) => {
  const user = requireUser(req);
  const rows = db.prepare(`SELECT id, title, version, shared, created_at, updated_at, json_array_length(data, '$.layers') AS layers,
    json_array_length(data, '$.bookmarks') AS bookmarks, json_extract(data, '$.thumbnail') AS thumbnail FROM maps WHERE owner_id = ? ORDER BY updated_at DESC`).all(user.id);
  return [200, { maps: rows.map(mapSummary) }];
});

route('POST', '/api/maps', async (req) => {
  const user = requireUser(req);
  const { map } = await readJson(req, MAX_STORY);
  const title = validateMap(map);
  const id = auth.newId();
  const now = Date.now();
  db.prepare('INSERT INTO maps (id, owner_id, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, user.id, title, JSON.stringify({ ...map, id }), now, now);
  return [201, mapSummary(db.prepare('SELECT * FROM maps WHERE id = ?').get(id))];
});

route('GET', '/api/maps/:id', async (req, p) => {
  const row = ownMap(requireUser(req), p.id);
  return [200, { ...mapSummary(row), map: JSON.parse(row.data) }];
});

route('PUT', '/api/maps/:id', async (req, p) => {
  const user = requireUser(req);
  const row = ownMap(user, p.id);
  const { map, version } = await readJson(req, MAX_STORY);
  if (version !== row.version) throw new HttpError(409, 'This map was changed somewhere else', { version: row.version, updatedAt: row.updated_at });
  const title = validateMap(map);
  const now = Math.max(Date.now(), row.updated_at + 1);
  const json = JSON.stringify({ ...map, id: row.id });
  db.prepare('UPDATE maps SET title = ?, data = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').run(title, json, now, row.id, version);
  if (row.shared) {
    const shareLayer = db.prepare('UPDATE layers SET shared = 1 WHERE id = ? AND owner_id = ?');
    layerIdsIn(json).forEach((lId) => shareLayer.run(lId, user.id));
  }
  return [200, mapSummary(db.prepare('SELECT * FROM maps WHERE id = ?').get(row.id))];
});

route('DELETE', '/api/maps/:id', async (req, p) => {
  const row = ownMap(requireUser(req), p.id);
  db.prepare('DELETE FROM maps WHERE id = ?').run(row.id);
  return [200, { ok: true }];
});

// Which of your stories use this map, so you know what an edit (or a delete) affects.
route('GET', '/api/maps/:id/usage', async (req, p) => {
  const user = requireUser(req);
  const row = ownMap(user, p.id);
  const stories = db.prepare('SELECT id, title, slug, published FROM stories WHERE owner_id = ? AND instr(draft, ?) > 0 ORDER BY updated_at DESC')
    .all(user.id, `"map":"${row.id}"`).map((s) => ({ id: s.id, title: s.title, url: s.slug && s.published ? `/s/${s.slug}` : null }));
  return [200, { stories }];
});

route('GET', '/api/public/maps/:id', async (req, p) => {
  const row = db.prepare('SELECT data FROM maps WHERE id = ? AND shared = 1').get(p.id);
  if (!row) throw new HttpError(404, 'Map not found');
  return [200, JSON.parse(row.data), { 'Cache-Control': 'public, max-age=15' }]; // short, so map edits reach readers quickly
});

/* ---------------- Hosted Feature Layers ---------------- */

route('GET', '/api/layers', async (req) => {
  const user = requireUser(req);
  const rows = db.prepare('SELECT * FROM layers WHERE owner_id = ? ORDER BY updated_at DESC').all(user.id);
  return [200, { layers: rows.map(layerSummary) }];
});

route('POST', '/api/layers', async (req) => {
  const user = requireUser(req);
  const body = await readJson(req, MAX_STORY);
  const raw = body.layer && typeof body.layer === 'object' ? body.layer : body;
  const title = String(raw.title || raw.name || 'Untitled layer').trim().slice(0, 300) || 'Untitled layer';
  const summaryText = String(raw.summary || '').trim().slice(0, 1000);
  const attribution = String(raw.attribution ?? raw.data?.metadata?.attribution ?? '').trim().slice(0, 500);
  const fc = normalizeLayerData(raw.data || { type: 'FeatureCollection', features: [] });
  const fields = normalizeFields(raw.fields || fc.metadata?.fields, fc.features);
  const geomType = detectGeomType(fc.features, raw.geomType || raw.geom_type || 'Point');
  const style = raw.style && typeof raw.style === 'object' ? raw.style : {};
  const popup = raw.popup && typeof raw.popup === 'object' ? raw.popup : {};
  const shared = raw.shared ? 1 : 0;
  const id = auth.newId();
  const now = Date.now();
  fc.metadata = { ...fc.metadata, id, title, summary: summaryText, attribution, geomType, fields, updatedAt: now };
  fs.writeFileSync(layerFile(id), JSON.stringify(fc));
  db.prepare(`INSERT INTO layers (id, owner_id, title, summary, attribution, geom_type, feature_count, fields, style, popup, version, shared, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .run(id, user.id, title, summaryText, attribution, geomType, fc.features.length, JSON.stringify(fields), JSON.stringify(style), JSON.stringify(popup), shared, now, now);
  const row = db.prepare('SELECT * FROM layers WHERE id = ?').get(id);
  return [201, { ...layerSummary(row), data: fc }];
});

route('GET', '/api/layers/:id', async (req, p) => {
  const row = ownLayer(requireUser(req), p.id);
  const data = readLayerGeoJSON(row.id);
  return [200, { ...layerSummary(row), data }];
});

route('PUT', '/api/layers/:id', async (req, p) => {
  const user = requireUser(req);
  const row = ownLayer(user, p.id);
  const body = await readJson(req, MAX_STORY);
  const raw = body.layer && typeof body.layer === 'object' ? body.layer : body;
  if (body.version != null && body.version !== row.version) {
    throw new HttpError(409, 'This layer was changed somewhere else', { version: row.version, updatedAt: row.updated_at });
  }
  const existingFc = readLayerGeoJSON(row.id);
  const fc = raw.data !== undefined ? normalizeLayerData(raw.data, existingFc.metadata) : existingFc;
  const title = raw.title !== undefined ? (String(raw.title || '').trim().slice(0, 300) || 'Untitled layer') : row.title;
  const summaryText = raw.summary !== undefined ? String(raw.summary || '').trim().slice(0, 1000) : row.summary;
  const attribution = raw.attribution !== undefined ? String(raw.attribution || '').trim().slice(0, 500) : row.attribution;
  const currentFields = JSON.parse(row.fields || '[]');
  if (Array.isArray(raw.fields)) {
    const nextNames = new Set(raw.fields.map((f) => String(typeof f === 'string' ? f : f?.name || '').trim()).filter(Boolean));
    const removed = currentFields.map((f) => f.name).filter((n) => n && !nextNames.has(n));
    if (removed.length) {
      for (const feat of fc.features) {
        if (feat?.properties) for (const k of removed) delete feat.properties[k];
      }
    }
  }
  const fields = normalizeFields(raw.fields !== undefined ? raw.fields : currentFields, fc.features);
  const geomType = detectGeomType(fc.features, raw.geomType || raw.geom_type || row.geom_type || 'Point');
  const style = raw.style !== undefined && typeof raw.style === 'object' ? raw.style : JSON.parse(row.style || '{}');
  const popup = raw.popup !== undefined && typeof raw.popup === 'object' ? raw.popup : JSON.parse(row.popup || '{}');
  const shared = raw.shared !== undefined ? (raw.shared ? 1 : 0) : row.shared;
  const now = Math.max(Date.now(), row.updated_at + 1);
  fc.metadata = { ...fc.metadata, id: row.id, title, summary: summaryText, attribution, geomType, fields, updatedAt: now };
  fs.writeFileSync(layerFile(row.id), JSON.stringify(fc));
  db.prepare(`UPDATE layers SET title = ?, summary = ?, attribution = ?, geom_type = ?, feature_count = ?, fields = ?, style = ?, popup = ?, shared = ?, version = version + 1, updated_at = ? WHERE id = ?`)
    .run(title, summaryText, attribution, geomType, fc.features.length, JSON.stringify(fields), JSON.stringify(style), JSON.stringify(popup), shared, now, row.id);
  const updated = db.prepare('SELECT * FROM layers WHERE id = ?').get(row.id);
  return [200, { ...layerSummary(updated), data: fc }];
});

route('DELETE', '/api/layers/:id', async (req, p) => {
  const row = ownLayer(requireUser(req), p.id);
  db.prepare('DELETE FROM layers WHERE id = ?').run(row.id);
  fs.rmSync(layerFile(row.id), { force: true });
  return [200, { ok: true }];
});

route('GET', '/api/layers/:id/usage', async (req, p) => {
  const user = requireUser(req);
  const row = ownLayer(user, p.id);
  const needle = `/api/layers/${row.id}`;
  const stories = db.prepare('SELECT id, title, slug, published FROM stories WHERE owner_id = ? AND (instr(draft, ?) > 0 OR instr(draft, ?) > 0) ORDER BY updated_at DESC')
    .all(user.id, needle, `"hostedLayerId":"${row.id}"`).map((s) => ({ id: s.id, title: s.title, url: s.slug && s.published ? `/s/${s.slug}` : null }));
  const maps = db.prepare('SELECT id, title FROM maps WHERE owner_id = ? AND (instr(data, ?) > 0 OR instr(data, ?) > 0) ORDER BY updated_at DESC')
    .all(user.id, needle, `"hostedLayerId":"${row.id}"`).map((m) => ({ id: m.id, title: m.title }));
  return [200, { stories, maps }];
});

route('GET', '/api/layers/:id/geojson', async (req, p) => {
  const id = String(p.id || '').replace(/\.geojson$/i, '');
  const row = db.prepare('SELECT * FROM layers WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Layer not found');
  const user = auth.currentUser(req);
  if (!row.shared && (!user || user.id !== row.owner_id)) throw new HttpError(404, 'Layer not found');
  const data = readLayerGeoJSON(row.id);
  return [200, data, { 'Content-Type': 'application/geo+json; charset=utf-8', 'Cache-Control': 'no-cache' }];
});

route('GET', '/api/public/layers/:id', async (req, p) => {
  const id = String(p.id || '').replace(/\.geojson$/i, '');
  const row = db.prepare('SELECT * FROM layers WHERE id = ? AND shared = 1').get(id);
  if (!row) throw new HttpError(404, 'Layer not found');
  const data = readLayerGeoJSON(row.id);
  return [200, data, { 'Content-Type': 'application/geo+json; charset=utf-8', 'Cache-Control': 'public, max-age=15' }];
});

route('POST', '/api/uploads', async (req) => {
  const user = requireUser(req);
  const buf = await readBody(req, MAX_UPLOAD);
  const kind = sniffImage(buf);
  if (!kind) throw new HttpError(415, 'Upload a JPEG, PNG, WebP or GIF image');
  const id = auth.newId(12);
  const file = id + kind[1];
  fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
  const name = decodeURIComponent(String(req.headers['x-filename'] || '')).slice(0, 200);
  db.prepare('INSERT INTO uploads (id, owner_id, file, mime, bytes, original_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, user.id, file, kind[0], buf.length, name, Date.now());
  return [201, { id, url: `/uploads/${file}`, bytes: buf.length, mime: kind[0], name }];
});

route('GET', '/api/uploads', async (req) => {
  const user = requireUser(req);
  const rows = db.prepare('SELECT id, file, mime, bytes, original_name, created_at FROM uploads WHERE owner_id = ? ORDER BY created_at DESC LIMIT 500').all(user.id);
  return [200, { uploads: rows.map((r) => ({ id: r.id, url: `/uploads/${r.file}`, bytes: r.bytes, mime: r.mime, name: r.original_name, createdAt: r.created_at })) }];
});

route('DELETE', '/api/uploads/:id', async (req, p) => {
  const user = requireUser(req);
  const row = db.prepare('SELECT * FROM uploads WHERE id = ? AND owner_id = ?').get(p.id, user.id);
  if (!row) throw new HttpError(404, 'Image not found');
  db.prepare('DELETE FROM uploads WHERE id = ?').run(row.id);
  fs.rmSync(path.join(UPLOAD_DIR, row.file), { force: true });
  return [200, { ok: true }];
});

async function handleApi(req, res, urlPath) {
  // CSRF: browsers can't send this custom header cross-site without a CORS preflight, which we never allow.
  if (req.method !== 'GET' && req.headers['x-waymark'] !== '1') throw new HttpError(403, 'Missing request header');
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(urlPath);
    if (!m) continue;
    const [status, body, headers] = await r.handler(req, m.groups || {});
    return send(res, status, body, headers);
  }
  throw new HttpError(404, 'Not found');
}

/* ---------------- pages & static ---------------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Published story page: viewer.html with the slug and share-preview (Open Graph) tags filled in server-side.
function renderPublished(req, res, slug) {
  const row = db.prepare('SELECT published FROM stories WHERE slug = ? AND published IS NOT NULL').get(slug);
  if (!row) return send(res, 404, 'Story not found', { 'Content-Security-Policy': CSP });
  const story = JSON.parse(row.published);
  const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  const image = story.cover?.image ? new URL(story.cover.image, origin).href : '';
  const meta = [
    `<title>${esc(story.title)}</title>`,
    `<meta name="sm-slug" content="${esc(slug)}">`,
    `<meta name="description" content="${esc(story.subtitle)}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="${esc(brand.name)}">`,
    `<meta property="og:title" content="${esc(story.title)}">`,
    `<meta property="og:description" content="${esc(story.subtitle)}">`,
    `<meta property="og:url" content="${esc(`${origin}/s/${slug}`)}">`,
    image ? `<meta property="og:image" content="${esc(image)}">` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
  ].join('\n  ');
  const html = fs.readFileSync(path.join(PUBLIC, 'viewer.html'), 'utf8').replace('<title>Story</title>', meta);
  send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'public, max-age=60' });
}

function serveFile(res, file, headers = {}) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // no-referrer: reset links carry a token in the URL, which must never leak to other sites.
    const html = type.startsWith('text/html') ? { 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer' } : {};
    send(res, 200, data, { 'Content-Type': type, ...html, ...headers });
  });
}

function serveStatic(req, res, urlPath) {
  if (urlPath.startsWith('/uploads/')) {
    const name = path.basename(urlPath);
    if (!/^[\w-]+\.(jpg|png|webp|gif)$/.test(name)) return send(res, 404, 'Not found');
    return serveFile(res, path.join(UPLOAD_DIR, name), { 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'" });
  }
  let file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  serveFile(res, file);
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (urlPath.startsWith('/api/')) return await handleApi(req, res, urlPath);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (urlPath === '/favicon.ico') return send(res, 204, '');
    if (urlPath === '/js/brand.js') return send(res, 200, `export const BRAND = ${JSON.stringify(brand)};\n`, { 'Content-Type': 'text/javascript; charset=utf-8' });
    const pub = /^\/s\/([a-z0-9-]+)\/?$/.exec(urlPath);
    if (pub) return renderPublished(req, res, pub[1]);
    return serveStatic(req, res, urlPath);
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    const status = err instanceof HttpError ? err.status : 500;
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error' : err.message, ...(err.extra || {}) });
  }
});

module.exports = { server, mailConfigured, APP_URL };
