// Waymark server: static files, JSON API, image uploads, published story pages.
// Zero dependencies: node:http + node:sqlite.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { db, UPLOAD_DIR, LAYER_DIR } = require('./db');
const auth = require('./auth');
const access = require('./access');
const tiles = require('./tiles');
const { readGeoPackage, isSqlite } = require('./gpkg');
const { safeFetch } = require('./net');
const brand = require('./brand');
const { sendMail, mailConfigured } = require('./mail');

const PUBLIC = path.join(__dirname, '..', 'public');
const PORT = +process.env.PORT || 5180;
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== '0';
// Base URL for emailed links. Never taken from the request's Host header, which an attacker controls.
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const MAX_STORY = 8 * 1024 * 1024;
const MAX_UPLOAD = 12 * 1024 * 1024;
const MAX_LAYER = (+process.env.MAX_LAYER_MB || 256) * 1024 * 1024; // hosted layer uploads and edits
const TILE_THRESHOLD = +process.env.TILE_THRESHOLD || 20000; // layers with more features than this are drawn from vector tiles
const MIN_REFRESH = 5; // minutes

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.geojson': 'application/geo+json', '.svg': 'image/svg+xml',
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

const mapSummary = (r) => ({
  id: r.id, title: r.title, version: r.version, updatedAt: r.updated_at, createdAt: r.created_at, shared: !!r.shared, listed: !!r.listed, ...access.roleFields(r),
  ...(r.layers !== undefined ? { layers: r.layers ?? 0, bookmarks: r.bookmarks ?? 0, thumbnail: r.thumbnail || null } : {}),
});

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
  tiled: (r.feature_count ?? 0) > TILE_THRESHOLD,
  tileUrl: `/api/layers/${r.id}/tiles/{z}/{x}/{y}.mvt`,
  sampleUrl: `/api/layers/${r.id}/sample`,
  bbox: r.bbox ? JSON.parse(r.bbox) : null,
  sourceUrl: r.source_url || '',
  refreshMinutes: r.refresh_minutes || 0,
  refreshedAt: r.refreshed_at || null,
  refreshError: r.refresh_error || '',
  ...access.roleFields(r),
  updatedAt: r.updated_at,
  createdAt: r.created_at,
});

const summary = (r) => ({
  id: r.id, title: r.title, version: r.version, updatedAt: r.updated_at, createdAt: r.created_at,
  slug: r.slug, publishedAt: r.published_at, url: r.slug && r.published ? `/s/${r.slug}` : null,
  hasUnpublishedChanges: !!r.published && r.published_at < r.updated_at, listed: !!r.listed, ...access.roleFields(r),
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
  const me = auth.currentUser(req);
  const more = me ? db.prepare('SELECT handle, bio FROM users WHERE id = ?').get(me.id) : null;
  return [200, { user: me ? { ...me, handle: more.handle || null, bio: more.bio || '' } : null, signupOpen: ALLOW_SIGNUP || firstRun, firstRun }];
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
  const v = access.visible('story', user);
  const rows = db.prepare(`SELECT id, owner_id, title, version, slug, listed, published IS NOT NULL AS published, published_at, created_at, updated_at, json_extract(draft, '$.cover.image') AS cover, json_array_length(draft, '$.blocks') AS blocks FROM stories WHERE ${v.where} ORDER BY updated_at DESC`).all(...v.params);
  return [200, { stories: access.withRoles(user, 'story', rows).map(summary) }];
});

route('POST', '/api/stories', async (req) => {
  const user = requireUser(req);
  const { story } = await readJson(req, MAX_STORY);
  const title = validateStory(story);
  const id = auth.newId();
  const now = Date.now();
  db.prepare('INSERT INTO stories (id, owner_id, title, draft, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, user.id, title, JSON.stringify({ ...story, id }), now, now);
  return [201, summary({ ...db.prepare('SELECT * FROM stories WHERE id = ?').get(id), _role: 'owner' })];
});

route('GET', '/api/stories/:id', async (req, p) => {
  const row = access.getItem(requireUser(req), 'story', p.id);
  return [200, { ...summary(row), story: JSON.parse(row.draft) }];
});

route('PUT', '/api/stories/:id', async (req, p) => {
  const user = requireUser(req);
  const row = access.getItem(user, 'story', p.id, 'editor');
  const { story, version } = await readJson(req, MAX_STORY);
  if (version !== row.version) throw new HttpError(409, 'This story was changed somewhere else', { version: row.version, updatedAt: row.updated_at });
  const title = validateStory(story);
  const now = Math.max(Date.now(), row.updated_at + 1);
  db.prepare('UPDATE stories SET title = ?, draft = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
    .run(title, JSON.stringify({ ...story, id: row.id }), now, row.id, version);
  return [200, summary({ ...db.prepare('SELECT * FROM stories WHERE id = ?').get(row.id), _role: row._role, _owner: row._owner })];
});

route('DELETE', '/api/stories/:id', async (req, p) => {
  const row = access.getItem(requireUser(req), 'story', p.id, 'owner');
  db.prepare('DELETE FROM stories WHERE id = ?').run(row.id);
  db.prepare("DELETE FROM shares WHERE item_type = 'story' AND item_id = ?").run(row.id);
  return [200, { ok: true }];
});

route('POST', '/api/stories/:id/publish', async (req, p) => {
  const user = requireUser(req);
  const row = access.getItem(user, 'story', p.id, 'owner');
  const body = await readJson(req);
  let slug = body.slug != null ? String(body.slug).toLowerCase().trim() : row.slug || uniqueSlug(slugify(row.title), row.id);
  if (!SLUG.test(slug)) throw new HttpError(400, 'Use 3–60 lowercase letters, numbers and dashes for the link');
  if (db.prepare('SELECT id FROM stories WHERE slug = ? AND id != ?').get(slug, row.id)) throw new HttpError(409, 'That link is already taken');
  const now = Math.max(Date.now(), row.updated_at);
  db.prepare('UPDATE stories SET published = draft, slug = ?, published_at = ? WHERE id = ?').run(slug, now, row.id);
  access.sharePublic(row.draft, user); // readers need to load the saved maps and hosted layers this story uses
  return [200, summary({ ...db.prepare('SELECT * FROM stories WHERE id = ?').get(row.id), _role: 'owner' })];
});

route('POST', '/api/stories/:id/unpublish', async (req, p) => {
  const row = access.getItem(requireUser(req), 'story', p.id, 'owner');
  db.prepare('UPDATE stories SET published = NULL, published_at = NULL WHERE id = ?').run(row.id);
  return [200, summary({ ...db.prepare('SELECT * FROM stories WHERE id = ?').get(row.id), _role: 'owner' })];
});

route('GET', '/api/public/:slug', async (req, p) => {
  const row = db.prepare('SELECT published FROM stories WHERE slug = ? AND published IS NOT NULL').get(p.slug);
  if (!row) throw new HttpError(404, 'Story not found');
  return [200, JSON.parse(row.published), { 'Cache-Control': 'public, max-age=60' }];
});

/* ---------------- Saved maps ---------------- */

route('GET', '/api/maps', async (req) => {
  const user = requireUser(req);
  const v = access.visible('map', user);
  const rows = db.prepare(`SELECT id, owner_id, title, version, shared, listed, created_at, updated_at, json_array_length(data, '$.layers') AS layers,
    json_array_length(data, '$.bookmarks') AS bookmarks, json_extract(data, '$.thumbnail') AS thumbnail FROM maps WHERE ${v.where} ORDER BY updated_at DESC`).all(...v.params);
  return [200, { maps: access.withRoles(user, 'map', rows).map(mapSummary) }];
});

route('POST', '/api/maps', async (req) => {
  const user = requireUser(req);
  const { map } = await readJson(req, MAX_STORY);
  const title = validateMap(map);
  const id = auth.newId();
  const now = Date.now();
  db.prepare('INSERT INTO maps (id, owner_id, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, user.id, title, JSON.stringify({ ...map, id }), now, now);
  return [201, mapSummary({ ...db.prepare('SELECT * FROM maps WHERE id = ?').get(id), _role: 'owner' })];
});

// A map opens for people it's shared with, and for anyone who can open a story or dashboard that uses it.
route('GET', '/api/maps/:id', async (req, p) => {
  const user = requireUser(req);
  const row = db.prepare('SELECT * FROM maps WHERE id = ?').get(p.id);
  const role = access.roleFor(user, 'map', row) || (row && access.reachable(user, 'map', row.id) ? 'viewer' : null);
  if (!role) throw new HttpError(404, 'Map not found');
  return [200, { ...mapSummary({ ...row, _role: role }), map: JSON.parse(row.data) }];
});

route('PUT', '/api/maps/:id', async (req, p) => {
  const user = requireUser(req);
  const row = access.getItem(user, 'map', p.id, 'editor');
  const { map, version } = await readJson(req, MAX_STORY);
  if (version !== row.version) throw new HttpError(409, 'This map was changed somewhere else', { version: row.version, updatedAt: row.updated_at });
  const title = validateMap(map);
  const now = Math.max(Date.now(), row.updated_at + 1);
  const json = JSON.stringify({ ...map, id: row.id });
  db.prepare('UPDATE maps SET title = ?, data = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').run(title, json, now, row.id, version);
  if (row.shared) access.sharePublic(JSON.stringify({ map: row.id }) + json, user);
  return [200, mapSummary({ ...db.prepare('SELECT * FROM maps WHERE id = ?').get(row.id), _role: row._role, _owner: row._owner })];
});

route('DELETE', '/api/maps/:id', async (req, p) => {
  const row = access.getItem(requireUser(req), 'map', p.id, 'owner');
  db.prepare('DELETE FROM maps WHERE id = ?').run(row.id);
  db.prepare("DELETE FROM shares WHERE item_type = 'map' AND item_id = ?").run(row.id);
  return [200, { ok: true }];
});

// Which of your stories use this map, so you know what an edit (or a delete) affects.
route('GET', '/api/maps/:id/usage', async (req, p) => {
  const user = requireUser(req);
  const row = access.getItem(user, 'map', p.id);
  const sv = access.visible('story', user);
  const stories = db.prepare(`SELECT id, title, slug, published FROM stories WHERE ${sv.where} AND instr(draft, ?) > 0 ORDER BY updated_at DESC`)
    .all(...sv.params, `"map":"${row.id}"`).map((s) => ({ id: s.id, title: s.title, url: s.slug && s.published ? `/s/${s.slug}` : null }));
  return [200, { stories }];
});

route('GET', '/api/public/maps/:id', async (req, p) => {
  const row = db.prepare('SELECT data FROM maps WHERE id = ? AND shared = 1').get(p.id);
  if (!row) throw new HttpError(404, 'Map not found');
  return [200, JSON.parse(row.data), { 'Cache-Control': 'public, max-age=15' }]; // short, so map edits reach readers quickly
});

/* ---------------- Hosted Feature Layers ---------------- */

const KEEP_VERSIONS = 25;
const versionFile = (id, v) => path.join(LAYER_DIR, `${String(id).replace(/[^\w-]/g, '')}.v${Number(v)}.geojson`);

function bboxOf(features) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === 'number') { if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1]; if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1]; return; }
    for (const x of c) walk(x);
  };
  for (const f of features) if (f.geometry?.coordinates) walk(f.geometry.coordinates);
  return b[0] === Infinity ? null : b.map((n) => Math.round(n * 1e6) / 1e6);
}

function pruneVersions(id) {
  const old = db.prepare('SELECT version FROM layer_versions WHERE layer_id = ? ORDER BY version DESC LIMIT -1 OFFSET ?').all(id, KEEP_VERSIONS);
  for (const v of old) {
    fs.rmSync(versionFile(id, v.version), { force: true });
    db.prepare('DELETE FROM layer_versions WHERE layer_id = ? AND version = ?').run(id, v.version);
  }
}

function createLayer(user, { title, summaryText = '', attribution = '', fc, fields, geomType, style = {}, popup = {}, shared = 0, note = 'Created' }) {
  const id = auth.newId();
  const now = Date.now();
  const cleanFields = normalizeFields(fields || fc.metadata?.fields, fc.features);
  const gt = detectGeomType(fc.features, geomType || 'Point');
  fc.metadata = { ...fc.metadata, id, title, summary: summaryText, attribution, geomType: gt, fields: cleanFields, updatedAt: now };
  fs.writeFileSync(layerFile(id), JSON.stringify(fc));
  db.prepare(`INSERT INTO layers (id, owner_id, title, summary, attribution, geom_type, feature_count, fields, style, popup, version, shared, created_at, updated_at, updated_by, bbox)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
    .run(id, user.id, title, summaryText, attribution, gt, fc.features.length, JSON.stringify(cleanFields), JSON.stringify(style), JSON.stringify(popup), shared ? 1 : 0, now, now, user.id, JSON.stringify(bboxOf(fc.features)));
  db.prepare('INSERT INTO layer_versions (layer_id, version, saved_at, saved_by, note, feature_count) VALUES (?, 1, ?, ?, ?, ?)').run(id, now, user.id, note, fc.features.length);
  return db.prepare('SELECT * FROM layers WHERE id = ?').get(id);
}

/**
 * Saves a layer's new state. When the features changed, the state being replaced is kept in the layer's history
 * (the newest KEEP_VERSIONS are kept), so any edit, form submission or refresh can be undone.
 */
function commitLayer(row, fc, { title = row.title, summaryText = row.summary, attribution = row.attribution, fields, geomType, style, popup, shared = row.shared, by = null, note = '', dataChanged = true } = {}) {
  const now = Math.max(Date.now(), row.updated_at + 1);
  const cleanFields = normalizeFields(fields !== undefined ? fields : JSON.parse(row.fields || '[]'), fc.features);
  const gt = detectGeomType(fc.features, geomType || row.geom_type || 'Point');
  if (dataChanged && fs.existsSync(layerFile(row.id))) {
    fs.copyFileSync(layerFile(row.id), versionFile(row.id, row.version));
    db.prepare('INSERT OR IGNORE INTO layer_versions (layer_id, version, saved_at, saved_by, note, feature_count) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, row.version, row.updated_at, row.updated_by, '', row.feature_count);
  }
  fc.metadata = { ...fc.metadata, id: row.id, title, summary: summaryText, attribution, geomType: gt, fields: cleanFields, updatedAt: now };
  fs.writeFileSync(layerFile(row.id), JSON.stringify(fc));
  db.prepare(`UPDATE layers SET title = ?, summary = ?, attribution = ?, geom_type = ?, feature_count = ?, fields = ?, style = ?, popup = ?, shared = ?, version = version + 1, updated_at = ?, updated_by = ?, bbox = ? WHERE id = ?`)
    .run(title, summaryText, attribution, gt, fc.features.length, JSON.stringify(cleanFields), JSON.stringify(style ?? JSON.parse(row.style || '{}')), JSON.stringify(popup ?? JSON.parse(row.popup || '{}')), shared ? 1 : 0, now, by, JSON.stringify(bboxOf(fc.features)), row.id);
  if (dataChanged) {
    db.prepare('INSERT OR REPLACE INTO layer_versions (layer_id, version, saved_at, saved_by, note, feature_count) VALUES (?, ?, ?, ?, ?, ?)').run(row.id, row.version + 1, now, by, String(note).slice(0, 200), fc.features.length);
    pruneVersions(row.id);
    tiles.forget(row.id);
  }
  return db.prepare('SELECT * FROM layers WHERE id = ?').get(row.id);
}

function deleteLayerFiles(id) {
  fs.rmSync(layerFile(id), { force: true });
  const prefix = `${String(id).replace(/[^\w-]/g, '')}.v`;
  for (const f of fs.readdirSync(LAYER_DIR)) if (f.startsWith(prefix)) fs.rmSync(path.join(LAYER_DIR, f), { force: true });
  tiles.forget(id);
}

// Anyone may read a layer that is public; signed-in people need a share, or a story or map that uses it.
function readableLayer(req, id) {
  const row = db.prepare('SELECT * FROM layers WHERE id = ?').get(String(id || '').replace(/\.geojson$/i, ''));
  if (!row) throw new HttpError(404, 'Layer not found');
  if (row.shared) return row;
  const user = auth.currentUser(req);
  if (!user || !(access.roleFor(user, 'layer', row) || access.reachable(user, 'layer', row.id))) throw new HttpError(404, 'Layer not found');
  return row;
}
const layerBytes = (id) => (fs.existsSync(layerFile(id)) ? fs.readFileSync(layerFile(id)) : Buffer.from('{"type":"FeatureCollection","features":[]}'));

route('GET', '/api/layers', async (req) => {
  const user = requireUser(req);
  const v = access.visible('layer', user);
  const rows = db.prepare(`SELECT * FROM layers WHERE ${v.where} ORDER BY updated_at DESC`).all(...v.params);
  return [200, { layers: access.withRoles(user, 'layer', rows).map(layerSummary) }];
});

route('POST', '/api/layers', async (req) => {
  const user = requireUser(req);
  const body = await readJson(req, MAX_LAYER);
  const raw = body.layer && typeof body.layer === 'object' ? body.layer : body;
  const title = String(raw.title || raw.name || 'Untitled layer').trim().slice(0, 300) || 'Untitled layer';
  const fc = normalizeLayerData(raw.data || { type: 'FeatureCollection', features: [] });
  const row = createLayer(user, {
    title, fc,
    summaryText: String(raw.summary || '').trim().slice(0, 1000),
    attribution: String(raw.attribution ?? raw.data?.metadata?.attribution ?? '').trim().slice(0, 500),
    fields: raw.fields, geomType: raw.geomType || raw.geom_type,
    style: raw.style && typeof raw.style === 'object' ? raw.style : {},
    popup: raw.popup && typeof raw.popup === 'object' ? raw.popup : {},
    shared: raw.shared,
  });
  return [201, { ...layerSummary({ ...row, _role: 'owner' }), data: fc }];
});

// Big uploads: the raw file is the request body. Takes GeoJSON (or one feature per line) and GeoPackage.
// A GeoPackage with several feature tables becomes several layers.
route('POST', '/api/layers/import', async (req) => {
  const user = requireUser(req);
  const buf = await readBody(req, MAX_LAYER);
  const name = decodeURIComponent(String(req.headers['x-filename'] || 'Imported layer')).slice(0, 200);
  const base = name.replace(/\.(geojson|json|gpkg|ndjson|geojsonl)$/i, '') || 'Imported layer';
  const made = [];
  if (isSqlite(buf)) {
    const tmp = path.join(os.tmpdir(), `wm-${auth.newId()}.gpkg`);
    fs.writeFileSync(tmp, buf);
    let tables;
    try { tables = readGeoPackage(tmp); } catch (e) { throw new HttpError(400, e.message); } finally { fs.rmSync(tmp, { force: true }); }
    for (const t of tables) {
      made.push(createLayer(user, { title: String(tables.length > 1 ? `${base}: ${t.title}` : t.title || base).slice(0, 300), fc: normalizeLayerData({ features: t.features }), note: `Imported from ${name}` }));
    }
  } else {
    const text = buf.toString('utf8');
    let json;
    try { json = JSON.parse(text); } catch {
      try { json = { type: 'FeatureCollection', features: text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l)) }; } catch { throw new HttpError(400, 'That file isn\'t GeoJSON or a GeoPackage'); }
    }
    if (json?.type === 'Feature') json = { type: 'FeatureCollection', features: [json] };
    if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) throw new HttpError(400, 'That file isn\'t a GeoJSON feature collection');
    made.push(createLayer(user, { title: base, fc: normalizeLayerData(json), attribution: String(json.metadata?.attribution || '').slice(0, 500), note: `Imported from ${name}` }));
  }
  return [201, { layers: made.map((r) => layerSummary({ ...r, _role: 'owner' })) }];
});

route('GET', '/api/layers/:id', async (req, p) => {
  const row = access.getItem(requireUser(req), 'layer', p.id);
  const wantData = new URL(req.url, 'http://x').searchParams.get('data') !== '0';
  return [200, { ...layerSummary(row), ...(wantData ? { data: readLayerGeoJSON(row.id) } : {}) }];
});

route('PUT', '/api/layers/:id', async (req, p) => {
  const user = requireUser(req);
  const row = access.getItem(user, 'layer', p.id, 'editor');
  const body = await readJson(req, MAX_LAYER);
  const raw = body.layer && typeof body.layer === 'object' ? body.layer : body;
  if (body.version != null && body.version !== row.version) {
    throw new HttpError(409, 'This layer was changed somewhere else', { version: row.version, updatedAt: row.updated_at });
  }
  const existingFc = readLayerGeoJSON(row.id);
  const fc = raw.data !== undefined ? normalizeLayerData(raw.data, existingFc.metadata) : existingFc;
  const currentFields = JSON.parse(row.fields || '[]');
  let dataChanged = raw.data !== undefined;
  if (Array.isArray(raw.fields)) {
    const nextNames = new Set(raw.fields.map((f) => String(typeof f === 'string' ? f : f?.name || '').trim()).filter(Boolean));
    const removed = currentFields.map((f) => f.name).filter((n) => n && !nextNames.has(n));
    if (removed.length) {
      dataChanged = true;
      for (const feat of fc.features) {
        if (feat?.properties) for (const k of removed) delete feat.properties[k];
      }
    }
  }
  if (raw.sourceUrl !== undefined || raw.refreshMinutes !== undefined) {
    const url = raw.sourceUrl !== undefined ? String(raw.sourceUrl || '').trim().slice(0, 2000) : row.source_url;
    if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, 'The source needs to be an http or https address');
    const mins = raw.refreshMinutes !== undefined ? Math.max(0, Math.round(+raw.refreshMinutes || 0)) : row.refresh_minutes;
    db.prepare('UPDATE layers SET source_url = ?, refresh_minutes = ?, refresh_error = ? WHERE id = ?').run(url, url ? (mins && mins < MIN_REFRESH ? MIN_REFRESH : mins) : 0, '', row.id);
  }
  const updated = commitLayer(row, fc, {
    title: raw.title !== undefined ? (String(raw.title || '').trim().slice(0, 300) || 'Untitled layer') : row.title,
    summaryText: raw.summary !== undefined ? String(raw.summary || '').trim().slice(0, 1000) : row.summary,
    attribution: raw.attribution !== undefined ? String(raw.attribution || '').trim().slice(0, 500) : row.attribution,
    fields: raw.fields !== undefined ? raw.fields : currentFields,
    geomType: raw.geomType || raw.geom_type,
    style: raw.style !== undefined && typeof raw.style === 'object' ? raw.style : undefined,
    popup: raw.popup !== undefined && typeof raw.popup === 'object' ? raw.popup : undefined,
    shared: raw.shared !== undefined && row._role === 'owner' ? (raw.shared ? 1 : 0) : row.shared,
    by: user.id, note: String(body.note || raw.note || 'Edited'), dataChanged,
  });
  return [200, { ...layerSummary({ ...updated, _role: row._role, _owner: row._owner }), data: fc }];
});

route('DELETE', '/api/layers/:id', async (req, p) => {
  const row = access.getItem(requireUser(req), 'layer', p.id, 'owner');
  db.prepare('DELETE FROM layers WHERE id = ?').run(row.id);
  db.prepare("DELETE FROM shares WHERE item_type = 'layer' AND item_id = ?").run(row.id);
  deleteLayerFiles(row.id);
  return [200, { ok: true }];
});

route('GET', '/api/layers/:id/usage', async (req, p) => {
  const user = requireUser(req);
  const row = access.getItem(user, 'layer', p.id);
  const needle = `/api/layers/${row.id}`;
  const sv = access.visible('story', user);
  const mv = access.visible('map', user);
  const stories = db.prepare(`SELECT id, title, slug, published FROM stories WHERE ${sv.where} AND (instr(draft, ?) > 0 OR instr(draft, ?) > 0) ORDER BY updated_at DESC`)
    .all(...sv.params, needle, `"hostedLayerId":"${row.id}"`).map((s) => ({ id: s.id, title: s.title, url: s.slug && s.published ? `/s/${s.slug}` : null }));
  const maps = db.prepare(`SELECT id, title FROM maps WHERE ${mv.where} AND (instr(data, ?) > 0 OR instr(data, ?) > 0) ORDER BY updated_at DESC`)
    .all(...mv.params, needle, `"hostedLayerId":"${row.id}"`).map((m) => ({ id: m.id, title: m.title }));
  const forms = db.prepare('SELECT id, title, open, submissions FROM forms WHERE layer_id = ?').all(row.id).map((f) => ({ id: f.id, title: f.title, open: !!f.open, submissions: f.submissions }));
  return [200, { stories, maps, forms }];
});

/* ----- history ----- */

route('GET', '/api/layers/:id/history', async (req, p) => {
  const row = access.getItem(requireUser(req), 'layer', p.id);
  const rows = db.prepare(`SELECT v.version, v.saved_at, v.note, v.feature_count, u.name, u.email FROM layer_versions v LEFT JOIN users u ON u.id = v.saved_by
    WHERE v.layer_id = ? ORDER BY v.version DESC`).all(row.id);
  return [200, { current: row.version, versions: rows.filter((v) => v.version === row.version || fs.existsSync(versionFile(row.id, v.version)))
    .map((v) => ({ version: v.version, savedAt: v.saved_at, note: v.note, featureCount: v.feature_count, by: v.name || v.email || '', current: v.version === row.version })) }];
});

route('GET', '/api/layers/:id/history/:version', async (req, p) => {
  const row = access.getItem(requireUser(req), 'layer', p.id);
  const file = +p.version === row.version ? layerFile(row.id) : versionFile(row.id, p.version);
  if (!fs.existsSync(file)) throw new HttpError(404, 'That version is no longer kept');
  return [200, fs.readFileSync(file), { 'Content-Type': 'application/geo+json; charset=utf-8' }];
});

route('POST', '/api/layers/:id/restore/:version', async (req, p) => {
  const user = requireUser(req);
  const row = access.getItem(user, 'layer', p.id, 'editor');
  const file = versionFile(row.id, p.version);
  if (+p.version === row.version) throw new HttpError(400, 'That is the current version');
  if (!fs.existsSync(file)) throw new HttpError(404, 'That version is no longer kept');
  const fc = normalizeLayerData(JSON.parse(fs.readFileSync(file, 'utf8')));
  const updated = commitLayer(row, fc, { fields: fc.metadata?.fields, by: user.id, note: `Restored version ${+p.version}` });
  return [200, layerSummary({ ...updated, _role: row._role })];
});

/* ----- keeping a layer in sync with a URL ----- */

function parseCsvPoints(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; continue; }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim());
  const latI = head.findIndex((h) => /^(lat|latitude|y)$/i.test(h));
  const lngI = head.findIndex((h) => /^(lon|lng|long|longitude|x)$/i.test(h));
  if (latI < 0 || lngI < 0) throw new Error('The CSV needs latitude and longitude columns');
  const features = [];
  for (const r of rows) {
    const [lat, lng] = [Number(r[latI]), Number(r[lngI])];
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || r[latI] === '' || r[lngI] === '') continue;
    const props = {};
    head.forEach((h, i) => { if (h && r[i] !== undefined && r[i] !== '') props[h] = r[i].trim() !== '' && Number.isFinite(Number(r[i])) ? Number(r[i]) : r[i]; });
    features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lng, lat] } });
  }
  return { type: 'FeatureCollection', features };
}

// GeoJSON, a CSV with latitude/longitude columns, or a public ArcGIS feature layer.
async function fetchSource(url) {
  if (/\/(FeatureServer|MapServer)\/\d+\/?$/i.test(url)) {
    const features = [];
    for (let offset = 0; offset < 200000;) {
      const q = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', f: 'geojson', resultOffset: String(offset) });
      const res = await safeFetch(`${url.replace(/\/?$/, '/query')}?${q}`, { maxBytes: MAX_LAYER });
      const page = JSON.parse(res.body.toString('utf8'));
      if (page.error) throw new Error(page.error.message || 'The service returned an error');
      features.push(...(page.features || []));
      if (!(page.exceededTransferLimit || page.properties?.exceededTransferLimit) || !page.features?.length) break;
      offset += page.features.length;
    }
    return { type: 'FeatureCollection', features };
  }
  const res = await safeFetch(url, { maxBytes: MAX_LAYER });
  if (res.status >= 400) throw new Error(`The source answered with HTTP ${res.status}`);
  const text = res.body.toString('utf8');
  if (/csv/i.test(res.type) || /\.csv(\?|$)/i.test(url)) return parseCsvPoints(text);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('The source isn\'t GeoJSON or CSV'); }
  if (json?.type === 'Feature') return { type: 'FeatureCollection', features: [json] };
  if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) throw new Error('The source isn\'t a GeoJSON feature collection');
  return json;
}

async function refreshLayer(row, by = null) {
  const now = Date.now();
  try {
    const fc = normalizeLayerData(await fetchSource(row.source_url));
    if (!fc.features.length) throw new Error('The source returned no features');
    const fresh = db.prepare('SELECT * FROM layers WHERE id = ?').get(row.id);
    if (!fresh) return null;
    const same = JSON.stringify(fc.features) === JSON.stringify(readLayerGeoJSON(row.id).features);
    if (!same) commitLayer(fresh, fc, { by, note: 'Refreshed from its source' });
    db.prepare("UPDATE layers SET refreshed_at = ?, refresh_error = '' WHERE id = ?").run(now, row.id);
    return { changed: !same };
  } catch (e) {
    db.prepare('UPDATE layers SET refreshed_at = ?, refresh_error = ? WHERE id = ?').run(now, String(e.message || e).slice(0, 300), row.id);
    throw e;
  }
}

route('POST', '/api/layers/:id/refresh', async (req, p) => {
  const user = requireUser(req);
  const row = access.getItem(user, 'layer', p.id, 'editor');
  if (!row.source_url) throw new HttpError(400, 'This layer has no source address to refresh from');
  if (auth.rateLimited(`refresh:${user.id}`, 30)) throw new HttpError(429, 'Too many refreshes, try again later');
  let result;
  try { result = await refreshLayer(row, user.id); } catch (e) { throw new HttpError(502, `Could not refresh: ${e.message}`); }
  return [200, { ...layerSummary({ ...db.prepare('SELECT * FROM layers WHERE id = ?').get(row.id), _role: row._role }), changed: !!result?.changed }];
});

// Once a minute, refresh the layers that are due (a few at a time, so one slow source doesn't hold up the rest for long).
let refreshing = false;
async function refreshDue() {
  if (refreshing) return;
  refreshing = true;
  try {
    const due = db.prepare(`SELECT * FROM layers WHERE refresh_minutes > 0 AND source_url != '' AND (refreshed_at IS NULL OR refreshed_at + refresh_minutes * 60000 <= ?) ORDER BY refreshed_at LIMIT 5`).all(Date.now());
    for (const row of due) await refreshLayer(row).catch((e) => console.error(`Could not refresh layer "${row.title}": ${e.message}`));
  } finally { refreshing = false; }
}
setInterval(refreshDue, 60e3).unref();

/* ----- reading: GeoJSON, a sample of attributes, and vector tiles ----- */

route('GET', '/api/layers/:id/geojson', async (req, p) => {
  const row = readableLayer(req, p.id);
  return [200, layerBytes(row.id), { 'Content-Type': 'application/geo+json; charset=utf-8', 'Cache-Control': 'no-cache' }];
});

route('GET', '/api/public/layers/:id', async (req, p) => {
  const id = String(p.id || '').replace(/\.geojson$/i, '');
  const row = db.prepare('SELECT * FROM layers WHERE id = ? AND shared = 1').get(id);
  if (!row) throw new HttpError(404, 'Layer not found');
  return [200, layerBytes(row.id), { 'Content-Type': 'application/geo+json; charset=utf-8', 'Cache-Control': 'public, max-age=15', 'Access-Control-Allow-Origin': '*' }];
});

// Attributes of up to 5,000 evenly spaced features, so maps can work out colors and legends for a layer drawn from tiles.
route('GET', '/api/layers/:id/sample', async (req, p) => {
  const row = readableLayer(req, p.id);
  const all = readLayerGeoJSON(row.id).features;
  const step = Math.max(1, Math.ceil(all.length / 5000));
  const features = [];
  for (let i = 0; i < all.length; i += step) features.push({ type: 'Feature', geometry: null, properties: all[i].properties || {} });
  return [200, { type: 'FeatureCollection', count: all.length, bbox: row.bbox ? JSON.parse(row.bbox) : bboxOf(all), geomType: row.geom_type, fields: JSON.parse(row.fields || '[]'), attribution: row.attribution || '', features },
    { 'Cache-Control': 'no-cache' }];
});

route('GET', '/api/layers/:id/tiles/:z/:x/:y', async (req, p) => {
  const row = readableLayer(req, p.id);
  const [z, x, y] = [Number(p.z), Number(p.x), Number(String(p.y).replace(/\.(mvt|pbf)$/i, ''))];
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new HttpError(400, 'Bad tile address');
  const buf = tiles.tileFor(row.id, row.version, () => readLayerGeoJSON(row.id), z, x, y);
  const headers = { 'Cache-Control': row.shared ? 'public, max-age=30' : 'private, max-age=30' };
  if (!buf) return [204, '', headers];
  return [200, buf, { ...headers, 'Content-Type': 'application/vnd.mapbox-vector-tile', 'Content-Encoding': 'gzip' }];
});

/* ---------------- Forms: collect points into a hosted layer ---------------- */

const FIELD_TYPES = ['string', 'number', 'boolean', 'date'];
function cleanForm(data, layerFields) {
  const d = data && typeof data === 'object' ? data : {};
  const known = new Map(layerFields.map((f) => [f.name, f]));
  const fields = (Array.isArray(d.fields) ? d.fields : []).slice(0, 60).map((f) => {
    const name = String(f?.name || '').trim().slice(0, 80);
    if (!name || /^__/.test(name)) return null;
    const type = FIELD_TYPES.includes(f.type) ? f.type : known.get(name)?.type || 'string';
    return { name, type, label: String(f.label || name).slice(0, 160), required: !!f.required, long: !!f.long,
      ...(f.hint ? { hint: String(f.hint).slice(0, 300) } : {}),
      ...(Array.isArray(f.choices) && f.choices.length ? { choices: f.choices.slice(0, 60).map((c) => String(c).slice(0, 120)) } : {}) };
  }).filter(Boolean);
  return {
    description: String(d.description || '').slice(0, 2000),
    thanks: String(d.thanks || '').slice(0, 500),
    button: String(d.button || '').slice(0, 40),
    location: ['required', 'optional'].includes(d.location) ? d.location : 'required',
    photo: !!d.photo,
    center: Array.isArray(d.center) && d.center.length === 2 && d.center.every(Number.isFinite) ? d.center : null,
    zoom: Number.isFinite(+d.zoom) && d.zoom != null ? +d.zoom : null,
    fields,
  };
}
const formOut = (f) => ({ id: f.id, layerId: f.layer_id, title: f.title, open: !!f.open, submissions: f.submissions, url: `/f/${f.id}`, updatedAt: f.updated_at, ...JSON.parse(f.data || '{}') });
function ownForm(user, id) {
  const f = db.prepare('SELECT * FROM forms WHERE id = ?').get(id);
  if (!f) throw new HttpError(404, 'Form not found');
  access.getItem(user, 'layer', f.layer_id, 'editor'); // forms belong to their layer: whoever can edit the layer can manage them
  return f;
}

route('GET', '/api/layers/:id/forms', async (req, p) => {
  const row = access.getItem(requireUser(req), 'layer', p.id);
  return [200, { forms: db.prepare('SELECT * FROM forms WHERE layer_id = ? ORDER BY created_at').all(row.id).map(formOut) }];
});

route('POST', '/api/layers/:id/forms', async (req, p) => {
  const user = requireUser(req);
  const row = access.getItem(user, 'layer', p.id, 'editor');
  if (row.feature_count && row.geom_type !== 'Point') throw new HttpError(400, 'Forms add points, so they need a point layer');
  const body = await readJson(req, 256 * 1024);
  const id = auth.newId();
  const now = Date.now();
  db.prepare('INSERT INTO forms (id, owner_id, layer_id, title, data, open, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .run(id, user.id, row.id, String(body.title || row.title).trim().slice(0, 200) || 'Untitled form', JSON.stringify(cleanForm(body, JSON.parse(row.fields || '[]'))), now, now);
  return [201, formOut(db.prepare('SELECT * FROM forms WHERE id = ?').get(id))];
});

route('PUT', '/api/forms/:id', async (req, p) => {
  const user = requireUser(req);
  const f = ownForm(user, p.id);
  const body = await readJson(req, 256 * 1024);
  const layer = db.prepare('SELECT fields FROM layers WHERE id = ?').get(f.layer_id);
  db.prepare('UPDATE forms SET title = ?, data = ?, open = ?, updated_at = ? WHERE id = ?')
    .run(body.title !== undefined ? String(body.title).trim().slice(0, 200) || 'Untitled form' : f.title, JSON.stringify(cleanForm({ ...JSON.parse(f.data), ...body }, JSON.parse(layer.fields || '[]'))),
      body.open !== undefined ? (body.open ? 1 : 0) : f.open, Date.now(), f.id);
  return [200, formOut(db.prepare('SELECT * FROM forms WHERE id = ?').get(f.id))];
});

route('DELETE', '/api/forms/:id', async (req, p) => {
  const f = ownForm(requireUser(req), p.id);
  db.prepare('DELETE FROM forms WHERE id = ?').run(f.id);
  return [200, { ok: true }];
});

// What the public form page needs. Nothing about the layer's existing data is exposed.
route('GET', '/api/public/forms/:id', async (req, p) => {
  const f = db.prepare('SELECT * FROM forms WHERE id = ?').get(p.id);
  if (!f) throw new HttpError(404, 'Form not found');
  const { layerId, submissions, url, updatedAt, ...shown } = formOut(f);
  return [200, shown, { 'Cache-Control': 'no-cache' }];
});

route('POST', '/api/public/forms/:id/photo', async (req, p) => {
  const f = db.prepare('SELECT * FROM forms WHERE id = ? AND open = 1').get(p.id);
  if (!f || !JSON.parse(f.data).photo) throw new HttpError(404, 'Form not found');
  if (auth.rateLimited(`formphoto:${req.socket.remoteAddress}`, 20)) throw new HttpError(429, 'Too many uploads, try again later');
  const buf = await readBody(req, 8 * 1024 * 1024);
  const kind = sniffImage(buf);
  if (!kind) throw new HttpError(415, 'Upload a JPEG, PNG, WebP or GIF image');
  const id = auth.newId(12);
  fs.writeFileSync(path.join(UPLOAD_DIR, id + kind[1]), buf);
  db.prepare('INSERT INTO uploads (id, owner_id, file, mime, bytes, original_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, f.owner_id, id + kind[1], kind[0], buf.length, `Form: ${f.title}`.slice(0, 200), Date.now());
  return [201, { url: `/uploads/${id}${kind[1]}` }];
});

route('POST', '/api/public/forms/:id/submit', async (req, p) => {
  const f = db.prepare('SELECT * FROM forms WHERE id = ?').get(p.id);
  if (!f) throw new HttpError(404, 'Form not found');
  if (!f.open) throw new HttpError(403, 'This form is closed');
  if (auth.rateLimited(`form:${req.socket.remoteAddress}`, 30)) throw new HttpError(429, 'Too many submissions, try again later');
  const body = await readJson(req, 64 * 1024);
  const form = JSON.parse(f.data);
  const props = {};
  for (const fld of form.fields) {
    let v = body.values?.[fld.name];
    if (v == null || v === '') { if (fld.required) throw new HttpError(400, `"${fld.label}" is required`); continue; }
    if (fld.type === 'number') { v = Number(v); if (!Number.isFinite(v)) throw new HttpError(400, `"${fld.label}" needs a number`); } else if (fld.type === 'boolean') v = v === true || v === 'true' || v === 'yes';
    else v = String(v).slice(0, 4000);
    if (fld.choices && fld.type !== 'boolean' && !fld.choices.includes(String(v))) throw new HttpError(400, `Pick one of the choices for "${fld.label}"`);
    props[fld.name] = v;
  }
  let geometry = null;
  const ll = body.lngLat;
  if (Array.isArray(ll) && ll.length === 2 && ll.every(Number.isFinite) && Math.abs(ll[0]) <= 180 && Math.abs(ll[1]) <= 90) geometry = { type: 'Point', coordinates: [Math.round(ll[0] * 1e6) / 1e6, Math.round(ll[1] * 1e6) / 1e6] };
  if (!geometry && form.location === 'required') throw new HttpError(400, 'Mark the place on the map');
  if (form.photo && typeof body.photo === 'string' && /^\/uploads\/[\w-]+\.(jpg|png|webp|gif)$/.test(body.photo)) props.photo_url = body.photo;
  props.submitted_at = new Date().toISOString();
  const row = db.prepare('SELECT * FROM layers WHERE id = ?').get(f.layer_id);
  const fc = readLayerGeoJSON(row.id);
  const nextId = fc.features.reduce((m, x) => (Number.isFinite(+x.id) && +x.id > m ? +x.id : m), 0) + 1;
  fc.features.push({ type: 'Feature', id: nextId, properties: props, geometry });
  commitLayer(row, fc, { by: null, note: `Form: ${f.title}` });
  db.prepare('UPDATE forms SET submissions = submissions + 1 WHERE id = ?').run(f.id);
  return [201, { ok: true, thanks: form.thanks || '' }];
});

/* ---------------- Dashboards ---------------- */

function validateDashboard(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new HttpError(400, 'Dashboard must be an object');
  if (!Array.isArray(d.widgets)) throw new HttpError(400, 'Dashboard needs a widgets array');
  return String(d.title || 'Untitled dashboard').slice(0, 300);
}
const dashSummary = (r) => ({ id: r.id, title: r.title, version: r.version, shared: !!r.shared, listed: !!r.listed, updatedAt: r.updated_at, createdAt: r.created_at,
  ...(r.widgets !== undefined ? { widgets: r.widgets ?? 0 } : {}), ...access.roleFields(r) });

route('GET', '/api/dashboards', async (req) => {
  const user = requireUser(req);
  const v = access.visible('dashboard', user);
  const rows = db.prepare(`SELECT id, owner_id, title, version, shared, listed, created_at, updated_at, json_array_length(data, '$.widgets') AS widgets FROM dashboards WHERE ${v.where} ORDER BY updated_at DESC`).all(...v.params);
  return [200, { dashboards: access.withRoles(user, 'dashboard', rows).map(dashSummary) }];
});

route('POST', '/api/dashboards', async (req) => {
  const user = requireUser(req);
  const { dashboard } = await readJson(req, MAX_STORY);
  const title = validateDashboard(dashboard);
  const id = auth.newId();
  const now = Date.now();
  db.prepare('INSERT INTO dashboards (id, owner_id, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, user.id, title, JSON.stringify({ ...dashboard, id }), now, now);
  return [201, dashSummary({ ...db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id), _role: 'owner' })];
});

route('GET', '/api/dashboards/:id', async (req, p) => {
  const row = access.getItem(requireUser(req), 'dashboard', p.id);
  return [200, { ...dashSummary(row), dashboard: JSON.parse(row.data) }];
});

route('PUT', '/api/dashboards/:id', async (req, p) => {
  const user = requireUser(req);
  const row = access.getItem(user, 'dashboard', p.id, 'editor');
  const { dashboard, version } = await readJson(req, MAX_STORY);
  if (version !== row.version) throw new HttpError(409, 'This dashboard was changed somewhere else', { version: row.version, updatedAt: row.updated_at });
  const title = validateDashboard(dashboard);
  const json = JSON.stringify({ ...dashboard, id: row.id });
  db.prepare('UPDATE dashboards SET title = ?, data = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').run(title, json, Math.max(Date.now(), row.updated_at + 1), row.id, version);
  if (row.shared) access.sharePublic(json, user);
  return [200, dashSummary({ ...db.prepare('SELECT * FROM dashboards WHERE id = ?').get(row.id), _role: row._role })];
});

route('DELETE', '/api/dashboards/:id', async (req, p) => {
  const row = access.getItem(requireUser(req), 'dashboard', p.id, 'owner');
  db.prepare('DELETE FROM dashboards WHERE id = ?').run(row.id);
  db.prepare("DELETE FROM shares WHERE item_type = 'dashboard' AND item_id = ?").run(row.id);
  return [200, { ok: true }];
});

route('GET', '/api/public/dashboards/:id', async (req, p) => {
  const row = db.prepare('SELECT data FROM dashboards WHERE id = ? AND shared = 1').get(p.id);
  if (!row) throw new HttpError(404, 'Dashboard not found');
  return [200, JSON.parse(row.data), { 'Cache-Control': 'public, max-age=15' }];
});

/* ---------------- Scenarios (wargames) ---------------- */

function validateScenario(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new HttpError(400, 'Scenario must be an object');
  if (!Array.isArray(s.branches) || !s.branches.length) throw new HttpError(400, 'Scenario needs at least one branch');
  if (s.branches.some((b) => !b || !Array.isArray(b.turns) || !b.turns.length)) throw new HttpError(400, 'Every branch needs at least one turn');
  if (!Array.isArray(s.sides)) throw new HttpError(400, 'Scenario needs a sides array');
  return String(s.title || 'Untitled scenario').slice(0, 300);
}
const scenarioSummary = (r) => ({ id: r.id, title: r.title, version: r.version, shared: !!r.shared, listed: !!r.listed, updatedAt: r.updated_at, createdAt: r.created_at,
  ...(r.branches !== undefined ? { branches: r.branches ?? 0, turns: r.turns ?? 0, units: r.units ?? 0, template: !!r.template } : {}), ...access.roleFields(r) });

route('GET', '/api/scenarios', async (req) => {
  const user = requireUser(req);
  const v = access.visible('scenario', user);
  const rows = db.prepare(`SELECT id, owner_id, title, version, shared, listed, created_at, updated_at, json_array_length(data, '$.branches') AS branches,
    json_array_length(data, '$.branches[0].turns') AS turns, json_array_length(data, '$.branches[0].turns[0].units') AS units, json_extract(data, '$.template') AS template FROM scenarios WHERE ${v.where} ORDER BY updated_at DESC`).all(...v.params);
  return [200, { scenarios: access.withRoles(user, 'scenario', rows).map(scenarioSummary) }];
});

route('POST', '/api/scenarios', async (req) => {
  const user = requireUser(req);
  const { scenario } = await readJson(req, MAX_STORY);
  const title = validateScenario(scenario);
  const id = auth.newId();
  const now = Date.now();
  db.prepare('INSERT INTO scenarios (id, owner_id, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, user.id, title, JSON.stringify({ ...scenario, id }), now, now);
  return [201, scenarioSummary({ ...db.prepare('SELECT * FROM scenarios WHERE id = ?').get(id), _role: 'owner' })];
});

route('GET', '/api/scenarios/:id', async (req, p) => {
  const row = access.getItem(requireUser(req), 'scenario', p.id);
  return [200, { ...scenarioSummary(row), scenario: JSON.parse(row.data) }];
});

route('PUT', '/api/scenarios/:id', async (req, p) => {
  const user = requireUser(req);
  const row = access.getItem(user, 'scenario', p.id, 'editor');
  const { scenario, version } = await readJson(req, MAX_STORY);
  if (version !== row.version) throw new HttpError(409, 'This scenario was changed somewhere else', { version: row.version, updatedAt: row.updated_at });
  const title = validateScenario(scenario);
  const json = JSON.stringify({ ...scenario, id: row.id });
  db.prepare('UPDATE scenarios SET title = ?, data = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?').run(title, json, Math.max(Date.now(), row.updated_at + 1), row.id, version);
  if (row.shared) access.sharePublic(json, user);
  return [200, scenarioSummary({ ...db.prepare('SELECT * FROM scenarios WHERE id = ?').get(row.id), _role: row._role })];
});

route('DELETE', '/api/scenarios/:id', async (req, p) => {
  const row = access.getItem(requireUser(req), 'scenario', p.id, 'owner');
  db.prepare('DELETE FROM scenarios WHERE id = ?').run(row.id);
  db.prepare("DELETE FROM shares WHERE item_type = 'scenario' AND item_id = ?").run(row.id);
  return [200, { ok: true }];
});

route('GET', '/api/public/scenarios/:id', async (req, p) => {
  const row = db.prepare('SELECT data FROM scenarios WHERE id = ? AND shared = 1').get(p.id);
  if (!row) throw new HttpError(404, 'Scenario not found');
  return [200, JSON.parse(row.data), { 'Cache-Control': 'public, max-age=15' }];
});

/* ---------------- Profile and public page ---------------- */

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const RESERVED = new Set(['admin', 'api', 'login', 'signup', 'waymark', 'www', 'support', 'help', 'about']);

route('PUT', '/api/me', async (req) => {
  const user = requireUser(req);
  const body = await readJson(req);
  const cur = db.prepare('SELECT name, handle, bio FROM users WHERE id = ?').get(user.id);
  const name = body.name !== undefined ? String(body.name).trim().slice(0, 100) : cur.name;
  const bio = body.bio !== undefined ? String(body.bio).trim().slice(0, 500) : cur.bio;
  let handle = cur.handle;
  if (body.handle !== undefined) {
    handle = String(body.handle || '').trim().toLowerCase() || null;
    if (handle && (!HANDLE.test(handle) || RESERVED.has(handle))) throw new HttpError(400, 'Use 3–30 lowercase letters, numbers and dashes for your page address');
    if (handle && db.prepare('SELECT 1 FROM users WHERE handle = ? AND id != ?').get(handle, user.id)) throw new HttpError(409, 'That page address is taken');
  }
  db.prepare('UPDATE users SET name = ?, handle = ?, bio = ? WHERE id = ?').run(name, handle, bio, user.id);
  return [200, { user: { id: user.id, email: user.email, name, handle, bio } }];
});

route('GET', '/api/public/users/:handle', async (req, p) => {
  const u = db.prepare('SELECT id, name, handle, bio FROM users WHERE handle = ?').get(String(p.handle).toLowerCase());
  if (!u) throw new HttpError(404, 'Page not found');
  const stories = db.prepare(`SELECT title, slug, published_at, json_extract(published, '$.subtitle') AS subtitle, json_extract(published, '$.cover.image') AS cover
    FROM stories WHERE owner_id = ? AND published IS NOT NULL AND listed = 1 ORDER BY published_at DESC`).all(u.id)
    .map((s) => ({ title: s.title, subtitle: s.subtitle || '', cover: s.cover || null, url: `/s/${s.slug}`, publishedAt: s.published_at }));
  const maps = db.prepare(`SELECT id, title, updated_at, json_extract(data, '$.summary') AS summary, json_extract(data, '$.thumbnail') AS thumbnail FROM maps WHERE owner_id = ? AND shared = 1 AND listed = 1 ORDER BY updated_at DESC`).all(u.id)
    .map((m) => ({ title: m.title, summary: m.summary || '', thumbnail: m.thumbnail || null, url: `/m/${m.id}`, updatedAt: m.updated_at }));
  const dashboards = db.prepare('SELECT id, title, updated_at FROM dashboards WHERE owner_id = ? AND shared = 1 AND listed = 1 ORDER BY updated_at DESC').all(u.id)
    .map((d) => ({ title: d.title, url: `/d/${d.id}`, updatedAt: d.updated_at }));
  const scenarios = db.prepare('SELECT id, title, updated_at FROM scenarios WHERE owner_id = ? AND shared = 1 AND listed = 1 ORDER BY updated_at DESC').all(u.id)
    .map((d) => ({ title: d.title, url: `/w/${d.id}`, updatedAt: d.updated_at }));
  return [200, { name: u.name || u.handle, handle: u.handle, bio: u.bio || '', stories, maps, dashboards, scenarios }, { 'Cache-Control': 'public, max-age=30' }];
});

/* ---------------- Outside services ---------------- */

// Routes and travel-time areas come from a Valhalla server. The default is the free public demo run by
// OpenStreetMap Germany (fair-use only); set ROUTING_URL to your own Valhalla for regular use.
route('GET', '/api/config', async () => [200, {
  routingUrl: (process.env.ROUTING_URL || 'https://valhalla1.openstreetmap.de').replace(/\/$/, ''),
  tileThreshold: TILE_THRESHOLD,
  maxLayerMb: Math.round(MAX_LAYER / 1048576),
}, { 'Cache-Control': 'public, max-age=300' }]);

// Service descriptions (WMS, WMTS and WFS "capabilities") often can't be read by a browser from another site.
// Signed-in people can fetch them through the server: text only, public addresses only, 5 MB at most.
route('GET', '/api/fetch', async (req) => {
  const user = requireUser(req);
  if (auth.rateLimited(`fetch:${user.id}`, 120)) throw new HttpError(429, 'Too many requests, try again later');
  const url = new URL(req.url, 'http://x').searchParams.get('url') || '';
  let res;
  try { res = await safeFetch(url, { maxBytes: 5 * 1024 * 1024, accept: 'application/xml, text/xml, application/json, */*' }); } catch (e) { throw new HttpError(502, e.message); }
  if (res.status >= 400) throw new HttpError(502, `That address answered with HTTP ${res.status}`);
  if (!/xml|json|text\/plain/i.test(res.type)) throw new HttpError(415, 'That address didn\'t return XML or JSON');
  return [200, res.body.toString('utf8'), { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': "default-src 'none'" }];
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

access.register({ route, requireUser, readJson, HttpError, newId: auth.newId });

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
    if (/^\/help(\/[\w-]+)?\/?$/.test(urlPath)) return serveFile(res, path.join(PUBLIC, 'help.html')); // help center; pages load from /help/<page>.md
    const page = /^\/(m|d|f|u|w)\/([\w-]{2,40})\/?$/.exec(urlPath);
    if (page) return serveFile(res, path.join(PUBLIC, { m: 'mapview.html', d: 'dashboard.html', f: 'form.html', u: 'profile.html', w: 'scenario.html' }[page[1]]));
    return serveStatic(req, res, urlPath);
  } catch (err) {
    const known = err instanceof HttpError || err instanceof access.AccessError;
    if (!known) console.error(err);
    const status = known ? err.status : 500;
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error' : err.message, ...(err.extra || {}) });
  }
});

module.exports = { server, mailConfigured, APP_URL };
