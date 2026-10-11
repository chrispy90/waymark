// End-to-end API tests: `npm test`. Uses a temporary data directory and a fake SMTP server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-test-'));
const mails = [];
let smtp;
let base;
let server;

// Tiny SMTP sink that records each message's DATA section.
function startSmtp() {
  return new Promise((resolve) => {
    smtp = net.createServer((sock) => {
      let data = null;
      let buf = '';
      sock.write('220 test ESMTP\r\n');
      sock.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (data !== null) {
            if (line === '.') { mails.push(data.join('\n')); data = null; sock.write('250 queued\r\n'); } else data.push(line);
          } else if (/^EHLO/i.test(line)) sock.write('250-test\r\n250 AUTH PLAIN\r\n');
          else if (/^AUTH/i.test(line)) sock.write('235 ok\r\n');
          else if (/^DATA/i.test(line)) { data = []; sock.write('354 go\r\n'); }
          else if (/^QUIT/i.test(line)) { sock.write('221 bye\r\n'); sock.end(); }
          else sock.write('250 ok\r\n');
        }
      });
    }).listen(0, '127.0.0.1', () => resolve(smtp.address().port));
  });
}

before(async () => {
  const smtpPort = await startSmtp();
  Object.assign(process.env, {
    DATA_DIR: tmp, APP_URL: 'http://stories.test', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtpPort),
    SMTP_SECURE: 'none', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'Waymark <no-reply@stories.test>',
  });
  ({ server } = require('../server/index.js'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  smtp.close();
  require('../server/db.js').db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Minimal cookie-jar client.
function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'X-Waymark': '1', ...(cookie ? { Cookie: cookie } : {}), ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
}

const waitFor = async (fn) => { for (let i = 0; i < 50; i++) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); } throw new Error('timed out'); };

const alice = client();
const bob = client();
const story = { title: 'Hello World', blocks: [{ type: 'text', html: '<p>hi</p>' }] };

test('sign up, sign in, and reject bad credentials', async () => {
  assert.equal((await alice('POST', '/api/auth/signup', { email: 'alice@example.com', password: 'correct horse', name: 'Alice' })).status, 201);
  assert.equal((await alice('POST', '/api/auth/signup', { email: 'ALICE@example.com', password: 'whatever12' })).status, 409);
  assert.equal((await alice('POST', '/api/auth/signup', { email: 'x@example.com', password: 'short' })).status, 400);
  assert.equal((await bob('POST', '/api/auth/login', { email: 'alice@example.com', password: 'wrong pass' })).status, 401);
  assert.equal((await alice('GET', '/api/me')).body.user.email, 'alice@example.com');
});

test('mutations without the CSRF header are refused', async () => {
  const res = await fetch(`${base}/api/stories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

let storyId;
test('drafts save with version checks, and stay private', async () => {
  const created = await alice('POST', '/api/stories', { story });
  assert.equal(created.status, 201);
  storyId = created.body.id;
  const saved = await alice('PUT', `/api/stories/${storyId}`, { story: { ...story, title: 'Hello again' }, version: 1 });
  assert.equal(saved.body.version, 2);
  assert.equal((await alice('PUT', `/api/stories/${storyId}`, { story, version: 1 })).status, 409);
  await bob('POST', '/api/auth/signup', { email: 'bob@example.com', password: 'bobs password' });
  assert.equal((await bob('GET', `/api/stories/${storyId}`)).status, 404);
  assert.equal((await bob('PUT', `/api/stories/${storyId}`, { story, version: 2 })).status, 404);
});

test('publish, public page with share tags, unpublished changes, unpublish', async () => {
  const pub = await alice('POST', `/api/stories/${storyId}/publish`, { slug: 'hello' });
  assert.equal(pub.body.url, '/s/hello');
  assert.equal((await bob('POST', `/api/stories/${storyId}/publish`, {})).status, 404);
  const page = await client()('GET', '/s/hello');
  assert.match(page.text, /<meta property="og:title" content="Hello again">/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  await alice('PUT', `/api/stories/${storyId}`, { story: { ...story, title: 'Draft only' }, version: 2 });
  assert.equal((await client()('GET', '/api/public/hello')).body.title, 'Hello again');
  assert.equal((await alice('GET', '/api/stories')).body.stories[0].hasUnpublishedChanges, true);
  await alice('POST', `/api/stories/${storyId}/unpublish`, {});
  assert.equal((await client()('GET', '/api/public/hello')).status, 404);
});

test('uploads accept real images only', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await alice('POST', '/api/uploads', png, { 'Content-Type': 'image/png' });
  assert.equal(up.status, 201);
  const file = await fetch(base + up.body.url);
  assert.equal(file.headers.get('content-type'), 'image/png');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await alice('POST', '/api/uploads', svg, { 'Content-Type': 'image/png' })).status, 415);
  assert.equal((await bob('DELETE', `/api/uploads/${up.body.id}`)).status, 404);
});

test('password reset: emailed link, single use, signs out old sessions', async () => {
  const unknown = await client()('POST', '/api/auth/forgot', { email: 'nobody@example.com' });
  const known = await client()('POST', '/api/auth/forgot', { email: 'alice@example.com' });
  assert.deepEqual(unknown.body, known.body); // no account enumeration
  const mail = await waitFor(() => mails.find((m) => m.includes('To: alice@example.com')));
  const link = /http:\/\/stories\.test\/reset\.html\?token=([\w-]+)/.exec(mail);
  assert.ok(link, 'reset link uses APP_URL');
  const token = link[1];

  assert.equal((await client()('GET', `/api/auth/reset/${token}`)).body.valid, true);
  assert.equal((await client()('POST', '/api/auth/reset', { token, password: 'short' })).status, 400);
  const fresh = client();
  assert.equal((await fresh('POST', '/api/auth/reset', { token, password: 'new password 1' })).status, 200);
  assert.equal((await fresh('GET', '/api/me')).body.user.email, 'alice@example.com');
  assert.equal((await client()('POST', '/api/auth/reset', { token, password: 'another one 2' })).status, 400); // used
  assert.equal((await alice('GET', '/api/me')).body.user, null); // old session revoked
  assert.equal((await client()('POST', '/api/auth/login', { email: 'alice@example.com', password: 'correct horse' })).status, 401);
  assert.equal((await alice('POST', '/api/auth/login', { email: 'alice@example.com', password: 'new password 1' })).status, 200);
});

test('change password requires the current one', async () => {
  assert.equal((await alice('POST', '/api/auth/password', { current: 'nope', password: 'whatever123' })).status, 400);
  assert.equal((await alice('POST', '/api/auth/password', { current: 'new password 1', password: 'newest pass 3' })).status, 200);
  assert.equal((await alice('GET', '/api/me')).body.user.email, 'alice@example.com');
});

test('static files cannot escape the public folder', async () => {
  assert.notEqual((await fetch(`${base}/..%2F..%2Fserver%2Fdb.js`)).status, 200);
  assert.equal((await fetch(`${base}/uploads/..%2Fwaymark.db`)).status, 404);
});
