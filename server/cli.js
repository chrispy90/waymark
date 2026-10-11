// Admin commands that run against the database directly (no server needed).
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { pathToFileURL } = require('url');
const { db, UPLOAD_DIR } = require('./db');
const auth = require('./auth');
const brand = require('./brand');

const PORT = +process.env.PORT || 5180;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PUBLIC = path.join(__dirname, '..', 'public');

function findUser(email) {
  if (!email) throw new Error('Give an email address, e.g. node server.js reset-link you@example.com');
  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email.trim());
  if (!user) throw new Error(`No account with email ${email}`);
  return user;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

/* ---------- export ---------- */

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

// Resolves a site path ('/css/x.css', '/uploads/y.webp') to a file, refusing anything outside the app folders.
function localFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const [root, rel] = clean.startsWith('/uploads/') ? [UPLOAD_DIR, clean.slice('/uploads/'.length)] : [PUBLIC, clean];
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(path.normalize(root))) throw new Error(`Refusing to read ${urlPath}`);
  return file;
}

async function fetchOk(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

function serverIO(loadLayerData) {
  return {
    async text(p) {
      if (p === '/js/brand.js') return `export const BRAND = ${JSON.stringify(brand)};\n`;
      return fs.promises.readFile(localFile(p), 'utf8');
    },
    async bytes(url) {
      if (/^https?:\/\//i.test(url)) {
        const r = await fetchOk(url);
        return { data: new Uint8Array(await r.arrayBuffer()), type: (r.headers.get('content-type') || '').split(';')[0] };
      }
      const file = localFile(url);
      return { data: new Uint8Array(await fs.promises.readFile(file)), type: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' };
    },
    async layerData(layer) {
      if (layer.data) return layer.data;
      if (/^https?:\/\//i.test(layer.url)) return loadLayerData(layer);
      const json = JSON.parse(await fs.promises.readFile(localFile(layer.url.startsWith('/') ? layer.url : `/${layer.url}`), 'utf8'));
      return json.type === 'FeatureCollection' ? json : { type: 'FeatureCollection', features: json.type === 'Feature' ? [json] : [] };
    },
    remote: async (url) => (await fetchOk(url)).text(),
  };
}

function parseFlags(args) {
  const flags = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--out' || a === '-o') flags.out = args[++i];
    else if (a.startsWith('--')) flags[a.slice(2)] = true;
    else flags._.push(a);
  }
  return flags;
}

/* ---------- commands ---------- */

const commands = {
  async 'reset-link'(email) {
    const user = findUser(email);
    console.log(`Reset link for ${user.email} (valid ${auth.RESET_MINUTES} minutes, single use):\n\n  ${APP_URL}/reset.html?token=${auth.createResetToken(user.id)}\n`);
  },
  async 'set-password'(email) {
    const user = findUser(email);
    const pw = await askHidden('New password (min 8 characters): ');
    if (pw.length < 8) throw new Error('Password must be at least 8 characters');
    if ((await askHidden('Repeat it: ')) !== pw) throw new Error('Passwords did not match');
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(pw), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    console.log(`Password updated for ${user.email}. Existing sessions were signed out.`);
  },
  async users() {
    const rows = db.prepare('SELECT email, name, created_at FROM users ORDER BY created_at').all();
    if (!rows.length) console.log('No accounts yet.');
    rows.forEach((u) => console.log(`${u.email}\t${u.name || ''}\t${new Date(u.created_at).toISOString().slice(0, 10)}`));
  },
  async stories() {
    const rows = db.prepare(`SELECT s.id, s.title, s.slug, s.published IS NOT NULL AS live, u.email FROM stories s JOIN users u ON u.id = s.owner_id ORDER BY s.updated_at DESC`).all();
    if (!rows.length) console.log('No stories yet.');
    rows.forEach((r) => console.log(`${r.id}\t${r.live ? `live at /s/${r.slug}` : 'draft'}\t${r.title}\t(${r.email})`));
  },
  async export(...args) {
    const f = parseFlags(args);
    const key = f._[0];
    if (!key) throw new Error('Name a story by its link or id, e.g. node server.js export my-story --war\nList them with: node server.js stories');
    const row = db.prepare('SELECT * FROM stories WHERE slug = ? OR id = ?').get(key, key);
    if (!row) throw new Error(`No story with the link or id "${key}". List them with: node server.js stories`);
    let json = row.published;
    if (f.draft || !json) {
      if (!f.draft) console.log('This story is not published, so exporting the current draft.');
      json = row.draft;
    }
    const story = JSON.parse(json);
    const format = f.war ? 'war' : 'zip';
    const pub = (m) => pathToFileURL(path.join(PUBLIC, 'js', m)).href;
    const [{ buildExport }, { loadLayerData }] = await Promise.all([import(pub('export-core.js')), import(pub('maps.js'))]);
    const out = await buildExport(story, { format, images: !f['no-images'], data: !f['no-data'], vendor: !f['no-vendor'] }, serverIO(loadLayerData), brand,
      (s) => console.log(`  ${s}…`));
    const file = path.resolve(f.out || out.filename);
    fs.writeFileSync(file, Buffer.from(await out.blob.arrayBuffer()));
    console.log(`\nWrote ${file} (${(out.blob.size / 1048576).toFixed(1)} MB, ${out.count} files)`);
    out.warnings.forEach((w) => console.log(`  ! ${w}`));
    if (format === 'war') console.log(`\nCopy it into Tomcat's webapps/ folder, then open http://your-server:8080/${path.basename(file, '.war')}/`);
    else console.log('\nUnzip it and upload the folder to any web server (or into Tomcat\'s webapps/).');
  },
};

const USAGE = `Usage:
  node server.js                                start the server
  node server.js users                          list accounts
  node server.js stories                        list stories
  node server.js reset-link <email>             print a password reset link
  node server.js set-password <email>           set a password from the terminal
  node server.js export <link-or-id> [options]  export a story as a static website
      --war          Tomcat web app (.war) instead of a .zip
      --draft        export the current draft instead of the published version
      --out <file>   where to write it (default: <story-link>.zip or .war)
      --no-images    keep linked images as links instead of copying them
      --no-data      keep linked map data as links instead of copying it
      --no-vendor    load the map library from unpkg instead of bundling it`;

async function run(command, ...args) {
  const fn = commands[command];
  if (!fn) {
    console.log(USAGE);
    return command === 'help' || command === '--help' ? 0 : 1;
  }
  await fn(...args);
  return 0;
}

module.exports = { run };
