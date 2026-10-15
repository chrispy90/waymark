// Saved maps: create, list, save with conflict checks, usage lookup, and public access once a published story uses one.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-maps-'));
let base;
let server;

before(async () => {
  Object.assign(process.env, { DATA_DIR: tmp, APP_URL: 'http://stories.test' });
  ({ server } = require('../server/index.js'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  require('../server/db.js').db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'X-Waymark': '1', ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}
const ana = client();
const ben = client();
const anon = client();

test('saved maps can be made, listed, edited and are private to their owner', async () => {
  await ana('POST', '/api/auth/signup', { email: 'ana@example.com', password: 'long enough pw', name: 'Ana' });
  await ben('POST', '/api/auth/signup', { email: 'ben@example.com', password: 'long enough pw', name: 'Ben' });
  assert.equal((await ana('POST', '/api/maps', { map: { title: 'No layers' } })).status, 400);
  const made = await ana('POST', '/api/maps', { map: { title: 'Quake watch', layers: [{ id: 'q', name: 'Quakes' }], bookmarks: [{ id: 'b', name: 'Japan', view: { center: [140, 37], zoom: 5 } }], view: { basemap: 'dark' } } });
  assert.equal(made.status, 201);
  const { id } = made.body;
  const list = await ana('GET', '/api/maps');
  assert.deepEqual(list.body.maps.map((m) => [m.title, m.layers, m.bookmarks, m.shared]), [['Quake watch', 1, 1, false]]);
  assert.equal((await ben('GET', `/api/maps/${id}`)).status, 404);
  const got = await ana('GET', `/api/maps/${id}`);
  const saved = await ana('PUT', `/api/maps/${id}`, { map: { ...got.body.map, title: 'Quake watch 2' }, version: got.body.version });
  assert.equal(saved.status, 200);
  assert.equal((await ana('PUT', `/api/maps/${id}`, { map: got.body.map, version: got.body.version })).status, 409, 'stale version');
  assert.equal((await anon('GET', `/api/public/maps/${id}`)).status, 404, 'not public until a published story uses it');
});

test('publishing a story that uses a map shares the map, and usage lists the story', async () => {
  const { body: { maps: [m] } } = await ana('GET', '/api/maps');
  const s = await ana('POST', '/api/stories', { story: { title: 'Restless', blocks: [{ type: 'map', view: { map: m.id, center: [0, 0], zoom: 2 } }] } });
  assert.deepEqual((await ana('GET', `/api/maps/${m.id}/usage`)).body.stories.map((x) => [x.title, x.url]), [['Restless', null]]);
  await ana('POST', `/api/stories/${s.body.id}/publish`, { slug: 'restless' });
  const pub = await anon('GET', `/api/public/maps/${m.id}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.title, 'Quake watch 2');
  assert.equal((await ana('GET', `/api/maps/${m.id}/usage`)).body.stories[0].url, '/s/restless');
  // someone else's story can't share your map by referencing it
  const { body: other } = await ana('POST', '/api/maps', { map: { title: 'Private', layers: [] } });
  const bs = await ben('POST', '/api/stories', { story: { title: 'Sneaky', blocks: [{ type: 'map', view: { map: other.id } }] } });
  await ben('POST', `/api/stories/${bs.body.id}/publish`, { slug: 'sneaky' });
  assert.equal((await anon('GET', `/api/public/maps/${other.id}`)).status, 404);
  assert.equal((await ana('DELETE', `/api/maps/${other.id}`)).status, 200);
});
