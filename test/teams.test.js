// Teams and sharing, layer history, forms, dashboards, public pages, big-layer tiles, GeoPackage import and refresh.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const { DatabaseSync } = require('node:sqlite');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-teams-'));
let base;
let server;
let source; // a small web server standing in for someone else's data
let sourceBody = '';

before(async () => {
  Object.assign(process.env, { DATA_DIR: tmp, APP_URL: 'http://stories.test', TILE_THRESHOLD: '50' });
  ({ server } = require('../server/index.js'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  source = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': req.url.endsWith('.csv') ? 'text/csv' : 'application/json' }); res.end(sourceBody); });
  await new Promise((r) => source.listen(0, '127.0.0.1', r));
});
after(() => {
  server.close();
  source.close();
  require('../server/db.js').db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  return async (method, url, body, { raw, headers = {} } = {}) => {
    const res = await fetch(base + url, { method, headers: { 'X-Waymark': '1', ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* not JSON */ }
    return { status: res.status, body: json, buf, headers: res.headers };
  };
}
const ana = client();
const ben = client();
const cy = client();
const anon = client();
const pt = (lng, lat, props = {}) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [lng, lat] } });

test('groups: make one, add people by email, and only admins manage it', async () => {
  for (const [c, n] of [[ana, 'ana'], [ben, 'ben'], [cy, 'cy']]) await c('POST', '/api/auth/signup', { email: `${n}@example.com`, password: 'long enough pw', name: n });
  const g = await ana('POST', '/api/groups', { name: 'Field team' });
  assert.equal(g.status, 201);
  assert.equal((await ana('POST', `/api/groups/${g.body.id}/members`, { email: 'nobody@example.com' })).status, 404);
  const added = await ana('POST', `/api/groups/${g.body.id}/members`, { email: 'ben@example.com' });
  assert.deepEqual(added.body.members.map((m) => [m.name, m.role]), [['ana', 'owner'], ['ben', 'member']]);
  assert.equal((await ben('GET', '/api/groups')).body.groups[0].name, 'Field team');
  assert.equal((await cy('GET', '/api/groups')).body.groups.length, 0);
  assert.equal((await ben('POST', `/api/groups/${g.body.id}/members`, { email: 'cy@example.com' })).status, 403, 'members can\'t add people');
  assert.equal((await cy('PUT', `/api/groups/${g.body.id}`, { name: 'Mine now' })).status, 404, 'outsiders can\'t see the group');
});

test('sharing: viewers can open, editors can change, only the owner can delete, publish or re-share', async () => {
  const { body: { groups: [g] } } = await ana('GET', '/api/groups');
  const s = (await ana('POST', '/api/stories', { story: { title: 'Survey', blocks: [] } })).body;
  assert.equal((await ben('GET', `/api/stories/${s.id}`)).status, 404);
  assert.equal((await ana('PUT', `/api/share/story/${s.id}`, { shares: [{ group: g.id, role: 'viewer' }] })).status, 200);
  const seen = await ben('GET', `/api/stories/${s.id}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.role, 'viewer');
  assert.deepEqual((await ben('GET', '/api/stories')).body.stories.map((x) => [x.title, x.role, x.owner]), [['Survey', 'viewer', 'ana']]);
  assert.equal((await ben('PUT', `/api/stories/${s.id}`, { story: seen.body.story, version: seen.body.version })).status, 403);
  assert.equal((await cy('GET', `/api/stories/${s.id}`)).status, 404, 'not in the group');
  // a person can be given more than their group
  await ana('PUT', `/api/share/story/${s.id}`, { shares: [{ group: g.id, role: 'viewer' }, { email: 'ben@example.com', role: 'editor' }, { email: 'cy@example.com', role: 'viewer' }] });
  const edit = await ben('PUT', `/api/stories/${s.id}`, { story: { ...seen.body.story, title: 'Survey (Ben)' }, version: seen.body.version });
  assert.equal(edit.status, 200);
  assert.equal((await ben('DELETE', `/api/stories/${s.id}`)).status, 403);
  assert.equal((await ben('POST', `/api/stories/${s.id}/publish`, {})).status, 403);
  assert.equal((await ben('GET', `/api/share/story/${s.id}`)).status, 403);
  assert.equal((await cy('GET', `/api/stories/${s.id}`)).status, 200);
  assert.equal((await ana('PUT', `/api/share/story/${s.id}`, { shares: [{ group: 'not-a-group', role: 'viewer' }] })).status, 404);
  // leaving the group takes away what came with it
  await ana('PUT', `/api/share/story/${s.id}`, { shares: [{ group: g.id, role: 'editor' }] });
  const { body: me } = await ben('GET', '/api/me');
  assert.equal((await ben('DELETE', `/api/groups/${g.id}/members/${me.user.id}`)).status, 200);
  assert.equal((await ben('GET', `/api/stories/${s.id}`)).status, 404);
  await ana('POST', `/api/groups/${g.id}/members`, { email: 'ben@example.com' });
});

test('a shared story brings its maps and layers, but referencing someone\'s map gives no access to it', async () => {
  const layer = (await ana('POST', '/api/layers', { title: 'Sites', data: { type: 'FeatureCollection', features: [pt(1, 2, { name: 'A' })] } })).body;
  const map = (await ana('POST', '/api/maps', { map: { title: 'Site map', layers: [{ id: 'l1', hostedLayerId: layer.id, url: layer.url }] } })).body;
  const story = (await ana('POST', '/api/stories', { story: { title: 'Sites story', blocks: [{ type: 'map', view: { map: map.id } }] } })).body;
  assert.equal((await ben('GET', `/api/maps/${map.id}`)).status, 404);
  assert.equal((await ben('GET', layer.url)).status, 404);
  await ana('PUT', `/api/share/story/${story.id}`, { shares: [{ email: 'ben@example.com', role: 'viewer' }] });
  assert.equal((await ben('GET', `/api/maps/${map.id}`)).status, 200, 'through the story');
  assert.equal((await ben('GET', layer.url)).status, 200, 'through the map in the story');
  assert.equal((await ben('PUT', `/api/layers/${layer.id}`, { title: 'Hacked' })).status, 404, 'reading through a story is not a share');
  // Cy puts Ana's map id in a story of his own: still no access, and publishing it doesn't make the map public
  const sneaky = (await cy('POST', '/api/stories', { story: { title: 'Sneaky', blocks: [{ type: 'map', view: { map: map.id } }] } })).body;
  assert.equal((await cy('GET', `/api/maps/${map.id}`)).status, 404);
  await cy('POST', `/api/stories/${sneaky.id}/publish`, { slug: 'sneaky-cy' });
  assert.equal((await anon('GET', `/api/public/maps/${map.id}`)).status, 404);
  // "anyone with the link" on the map makes it and its layers public
  assert.equal((await ana('PUT', `/api/share/map/${map.id}`, { link: true, listed: true })).body.link, true);
  assert.equal((await anon('GET', `/api/public/maps/${map.id}`)).status, 200);
  assert.equal((await anon('GET', `/api/public/layers/${layer.id}.geojson`)).status, 200);
});

test('layer history: every change to the features can be listed and undone', async () => {
  const l = (await ana('POST', '/api/layers', { title: 'Trees', data: { type: 'FeatureCollection', features: [pt(0, 0, { kind: 'oak' })] } })).body;
  const v2 = (await ana('PUT', `/api/layers/${l.id}`, { data: { type: 'FeatureCollection', features: [pt(0, 0, { kind: 'oak' }), pt(1, 1, { kind: 'elm' })] }, note: 'Added an elm' })).body;
  assert.equal(v2.featureCount, 2);
  await ana('PUT', `/api/layers/${l.id}`, { title: 'Street trees' }); // a rename isn't a new version of the data
  await ana('PUT', `/api/layers/${l.id}`, { data: { type: 'FeatureCollection', features: [] }, note: 'Oops' });
  const hist = (await ana('GET', `/api/layers/${l.id}/history`)).body;
  assert.deepEqual(hist.versions.map((v) => [v.note, v.featureCount, v.current]), [['Oops', 0, true], ['', 2, false], ['Created', 1, false]].map((x) => x));
  const back = hist.versions[1];
  assert.equal((await ana('GET', `/api/layers/${l.id}/history/${back.version}`)).body.features.length, 2);
  const restored = await ana('POST', `/api/layers/${l.id}/restore/${back.version}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.featureCount, 2);
  assert.equal((await ana('GET', `/api/layers/${l.id}`)).body.data.features.length, 2);
  assert.match((await ana('GET', `/api/layers/${l.id}/history`)).body.versions[0].note, /^Restored version/);
  assert.equal((await ben('GET', `/api/layers/${l.id}/history`)).status, 404);
});

test('forms: the public can add points to a layer, with checks, and each submission is in the history', async () => {
  const l = (await ana('POST', '/api/layers', { title: 'Potholes', fields: [{ name: 'size', type: 'string' }, { name: 'depth_cm', type: 'number' }] })).body;
  const made = await ana('POST', `/api/layers/${l.id}/forms`, { title: 'Report a pothole', description: 'Tell us where.', photo: false,
    fields: [{ name: 'size', label: 'How big?', required: true, choices: ['small', 'large'] }, { name: 'depth_cm', label: 'Depth' }] });
  assert.equal(made.status, 201);
  const f = made.body;
  assert.equal((await ben('PUT', `/api/forms/${f.id}`, { open: false })).status, 404, 'only people who can edit the layer');
  const pub = await anon('GET', `/api/public/forms/${f.id}`);
  assert.equal(pub.body.title, 'Report a pothole');
  assert.equal(pub.body.layerId, undefined, 'the layer isn\'t exposed');
  assert.equal((await anon('POST', `/api/public/forms/${f.id}/submit`, { values: {}, lngLat: [1, 1] })).status, 400, 'required field');
  assert.equal((await anon('POST', `/api/public/forms/${f.id}/submit`, { values: { size: 'huge' }, lngLat: [1, 1] })).status, 400, 'not a choice');
  assert.equal((await anon('POST', `/api/public/forms/${f.id}/submit`, { values: { size: 'small', depth_cm: 'deep' }, lngLat: [1, 1] })).status, 400, 'not a number');
  assert.equal((await anon('POST', `/api/public/forms/${f.id}/submit`, { values: { size: 'small' } })).status, 400, 'no place');
  const ok = await anon('POST', `/api/public/forms/${f.id}/submit`, { values: { size: 'large', depth_cm: '7', extra: 'ignored' }, lngLat: [-77.05, 38.9] });
  assert.equal(ok.status, 201);
  const data = (await ana('GET', `/api/layers/${l.id}`)).body.data;
  assert.equal(data.features.length, 1);
  assert.deepEqual([data.features[0].properties.size, data.features[0].properties.depth_cm, data.features[0].properties.extra], ['large', 7, undefined]);
  assert.deepEqual(data.features[0].geometry.coordinates, [-77.05, 38.9]);
  assert.equal((await ana('GET', `/api/layers/${l.id}/history`)).body.versions[0].note, 'Form: Report a pothole');
  assert.equal((await ana('GET', `/api/layers/${l.id}/forms`)).body.forms[0].submissions, 1);
  await ana('PUT', `/api/forms/${f.id}`, { open: false });
  assert.equal((await anon('POST', `/api/public/forms/${f.id}/submit`, { values: { size: 'small' }, lngLat: [1, 1] })).status, 403);
  // forms need the CSRF header like every other write
  const bare = await fetch(`${base}/api/public/forms/${f.id}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(bare.status, 403);
});

test('dashboards: saved with conflict checks, shared like everything else, public by link', async () => {
  assert.equal((await ana('POST', '/api/dashboards', { dashboard: { title: 'No widgets' } })).status, 400);
  const d = (await ana('POST', '/api/dashboards', { dashboard: { title: 'Ops', map: null, widgets: [{ type: 'number' }] } })).body;
  assert.deepEqual((await ana('GET', '/api/dashboards')).body.dashboards.map((x) => [x.title, x.widgets]), [['Ops', 1]]);
  assert.equal((await ben('GET', `/api/dashboards/${d.id}`)).status, 404);
  await ana('PUT', `/api/share/dashboard/${d.id}`, { shares: [{ email: 'ben@example.com', role: 'editor' }] });
  const got = await ben('GET', `/api/dashboards/${d.id}`);
  assert.equal((await ben('PUT', `/api/dashboards/${d.id}`, { dashboard: { ...got.body.dashboard, title: 'Ops 2' }, version: got.body.version })).status, 200);
  assert.equal((await ben('PUT', `/api/dashboards/${d.id}`, { dashboard: got.body.dashboard, version: got.body.version })).status, 409);
  assert.equal((await anon('GET', `/api/public/dashboards/${d.id}`)).status, 404);
  await ana('PUT', `/api/share/dashboard/${d.id}`, { link: true, listed: true });
  assert.equal((await anon('GET', `/api/public/dashboards/${d.id}`)).body.title, 'Ops 2');
  assert.equal((await ben('DELETE', `/api/dashboards/${d.id}`)).status, 403);
});

test('public page: a handle, and only what was published and listed', async () => {
  assert.equal((await ana('PUT', '/api/me', { handle: 'A!' })).status, 400);
  assert.equal((await ana('PUT', '/api/me', { handle: 'ana-maps', bio: 'Maps of things.' })).status, 200);
  assert.equal((await ben('PUT', '/api/me', { handle: 'Ana-Maps' })).status, 409);
  const s = (await ana('POST', '/api/stories', { story: { title: 'Listed one', subtitle: 'Sub', blocks: [] } })).body;
  const hidden = (await ana('POST', '/api/stories', { story: { title: 'Unlisted', blocks: [] } })).body;
  await ana('POST', `/api/stories/${s.id}/publish`, { slug: 'listed-one' });
  await ana('POST', `/api/stories/${hidden.id}/publish`, { slug: 'unlisted' });
  await ana('PUT', `/api/share/story/${s.id}`, { listed: true });
  const page = await anon('GET', '/api/public/users/ana-maps');
  assert.equal(page.status, 200);
  assert.deepEqual(page.body.stories.map((x) => [x.title, x.url]), [['Listed one', '/s/listed-one']]);
  assert.deepEqual(page.body.maps.map((x) => x.title), ['Site map']);
  assert.deepEqual(page.body.dashboards.map((x) => x.title), ['Ops 2']);
  assert.equal(page.body.email, undefined);
  assert.equal((await anon('GET', '/api/public/users/nobody')).status, 404);
  for (const p of ['/m/abc123', '/d/abc123', '/f/abc123', '/u/ana-maps']) assert.equal((await fetch(base + p)).status, 200, p);
});

// A minimal reader for the vector tile we write: counts features and collects keys.
function readTile(buf) {
  let o = 0;
  const varint = () => { let v = 0; let m = 1; for (;;) { const b = buf[o++]; v += (b & 0x7f) * m; if (b < 0x80) return v; m *= 128; } };
  const msg = (end, on) => { while (o < end) { const t = varint(); const [field, wire] = [t >> 3, t & 7]; if (wire === 2) { const len = varint(); on(field, o, o + len); o += len; } else if (wire === 0) on(field, varint()); else if (wire === 1) o += 8; } };
  const out = { layers: [] };
  msg(buf.length, (field, a, b) => {
    if (field !== 3) return;
    const layer = { name: '', features: 0, keys: [], types: [] };
    const save = o;
    o = a;
    msg(b, (f, x, y) => {
      if (f === 1) layer.name = buf.subarray(x, y).toString();
      if (f === 3) layer.keys.push(buf.subarray(x, y).toString());
      if (f === 2) { layer.features++; const s2 = o; o = x; msg(y, (ff, v) => { if (ff === 3) layer.types.push(v); }); o = s2; }
    });
    o = save;
    out.layers.push(layer);
  });
  return out;
}

test('big layers are served as vector tiles, with a sample of attributes for styling', async () => {
  const features = [];
  for (let i = 0; i < 400; i++) features.push(pt(-77 + (i % 20) * 0.01, 38.8 + Math.floor(i / 20) * 0.01, { n: i, kind: i % 2 ? 'a' : 'b' }));
  features.push({ type: 'Feature', properties: { kind: 'area' }, geometry: { type: 'Polygon', coordinates: [[[-77.2, 38.7], [-76.6, 38.7], [-76.6, 39.2], [-77.2, 39.2], [-77.2, 38.7]]] } });
  const l = (await ana('POST', '/api/layers', { title: 'Many', data: { type: 'FeatureCollection', features } })).body;
  assert.equal(l.tiled, true, 'over the threshold set for this test');
  assert.equal((await ana('GET', '/api/layers')).body.layers.find((x) => x.id === l.id).tileUrl, `/api/layers/${l.id}/tiles/{z}/{x}/{y}.mvt`);
  const sample = (await ana('GET', l.sampleUrl)).body;
  assert.equal(sample.count, 401);
  assert.deepEqual(sample.bbox, [-77.2, 38.7, -76.6, 39.2]);
  assert.equal(sample.features[0].geometry, null);
  // z12 tile over Washington DC: x = 1171, y = 1566
  const t = await ana('GET', `/api/layers/${l.id}/tiles/12/1171/1566.mvt`);
  assert.equal(t.status, 200);
  assert.equal(t.headers.get('content-type'), 'application/vnd.mapbox-vector-tile');
  const tile = readTile(t.buf); // fetch already un-gzipped it
  assert.equal(tile.layers[0].name, 'layer');
  assert.ok(tile.layers[0].features > 5, `${tile.layers[0].features} features`);
  assert.ok(tile.layers[0].types.includes(1) && tile.layers[0].types.includes(3), 'points and the polygon');
  assert.deepEqual(tile.layers[0].keys.sort(), ['kind', 'n']);
  // zoomed far out, points that would land on the same pixel are thinned
  const far = readTile((await ana('GET', `/api/layers/${l.id}/tiles/2/1/1.mvt`)).buf);
  assert.ok(far.layers[0].features < 20, `${far.layers[0].features} features at z2`);
  assert.equal((await ana('GET', `/api/layers/${l.id}/tiles/12/0/0.mvt`)).status, 204, 'empty tile');
  assert.equal((await ana('GET', `/api/layers/${l.id}/tiles/2/9/9.mvt`)).status, 400);
  assert.equal((await ben('GET', `/api/layers/${l.id}/tiles/12/1171/1566.mvt`)).status, 404, 'private layer');
});

test('tile geometry: lines are clipped to the tile and polygons stay closed', () => {
  const { buildIndex, makeTile } = require('../server/tiles.js');
  const index = buildIndex({ features: [
    { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-170, 0], [170, 0]] } },
    { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]], [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]] } },
  ] });
  assert.deepEqual(index.bbox.map(Math.round), [-170, -10, 170, 10]);
  const tile = readTile(zlib.gunzipSync(makeTile(index, 3, 4, 4)));
  assert.equal(tile.layers[0].features, 2);
  assert.equal(makeTile(index, 3, 0, 0), null);
});

test('import: GeoJSON and GeoPackage files become hosted layers', async () => {
  const gj = await ana('POST', '/api/layers/import', Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [pt(3, 4, { a: 1 })] })), { raw: true, headers: { 'X-Filename': 'wells.geojson' } });
  assert.equal(gj.status, 201);
  assert.deepEqual([gj.body.layers[0].title, gj.body.layers[0].featureCount], ['wells', 1]);
  assert.equal((await ana('POST', '/api/layers/import', Buffer.from('not a map'), { raw: true })).status, 400);
  // build a tiny GeoPackage: one table in Web Mercator, one point at (lng 10, lat 20)
  const file = path.join(tmp, 't.gpkg');
  const g = new DatabaseSync(file);
  g.exec(`CREATE TABLE gpkg_contents (table_name TEXT, data_type TEXT, identifier TEXT, srs_id INTEGER);
    CREATE TABLE gpkg_geometry_columns (table_name TEXT, column_name TEXT, srs_id INTEGER);
    CREATE TABLE gpkg_spatial_ref_sys (srs_id INTEGER, organization TEXT, organization_coordsys_id INTEGER);
    CREATE TABLE towns (fid INTEGER PRIMARY KEY, geom BLOB, name TEXT, pop INTEGER);
    INSERT INTO gpkg_contents VALUES ('towns', 'features', 'Towns', 3857);
    INSERT INTO gpkg_geometry_columns VALUES ('towns', 'geom', 3857);
    INSERT INTO gpkg_spatial_ref_sys VALUES (3857, 'EPSG', 3857);`);
  const R = 6378137;
  const wkb = Buffer.alloc(21);
  wkb[0] = 1; wkb.writeUInt32LE(1, 1);
  wkb.writeDoubleLE((10 * Math.PI / 180) * R, 5);
  wkb.writeDoubleLE(Math.log(Math.tan(Math.PI / 4 + (20 * Math.PI / 180) / 2)) * R, 13);
  const head = Buffer.from([0x47, 0x50, 0, 1, 0, 0, 0, 0]);
  head.writeInt32LE(3857, 4);
  g.prepare('INSERT INTO towns (geom, name, pop) VALUES (?, ?, ?)').run(Buffer.concat([head, wkb]), 'Testville', 1200);
  g.close();
  const gp = await ana('POST', '/api/layers/import', fs.readFileSync(file), { raw: true, headers: { 'X-Filename': 'towns.gpkg' } });
  assert.equal(gp.status, 201);
  assert.equal(gp.body.layers[0].title, 'Towns');
  const data = (await ana('GET', `/api/layers/${gp.body.layers[0].id}`)).body.data;
  assert.deepEqual(data.features[0].geometry.coordinates.map((n) => Math.round(n * 1e6) / 1e6), [10, 20]);
  assert.deepEqual([data.features[0].properties.name, data.features[0].properties.pop], ['Testville', 1200]);
});

test('GeoPackage projections: UTM comes back as longitude and latitude', () => {
  const { projectionFor } = require('../server/gpkg.js');
  const [lng, lat] = projectionFor(32618)([323394.3, 4307395.6]); // the White House, UTM zone 18N
  assert.ok(Math.abs(lng + 77.0365) < 0.0005 && Math.abs(lat - 38.8977) < 0.0005, `${lng}, ${lat}`);
  assert.equal(projectionFor(2263), null, 'state plane isn\'t supported');
});

test('refresh: a layer follows its source address, and private addresses are refused', async () => {
  const src = `http://127.0.0.1:${source.address().port}`;
  const l = (await ana('POST', '/api/layers', { title: 'Feed', data: { type: 'FeatureCollection', features: [pt(0, 0)] } })).body;
  sourceBody = JSON.stringify({ type: 'FeatureCollection', features: [pt(5, 5, { v: 1 }), pt(6, 6, { v: 2 })] });
  const set = await ana('PUT', `/api/layers/${l.id}`, { sourceUrl: `${src}/feed.json`, refreshMinutes: 1 });
  assert.deepEqual([set.body.sourceUrl, set.body.refreshMinutes], [`${src}/feed.json`, 5], 'no more often than every 5 minutes');
  delete process.env.ALLOW_PRIVATE_FETCH;
  const blocked = await ana('POST', `/api/layers/${l.id}/refresh`);
  assert.equal(blocked.status, 502);
  assert.match(blocked.body.error, /private network/);
  process.env.ALLOW_PRIVATE_FETCH = '1';
  const done = await ana('POST', `/api/layers/${l.id}/refresh`);
  assert.equal(done.status, 200);
  assert.deepEqual([done.body.featureCount, done.body.changed, done.body.refreshError], [2, true, '']);
  assert.equal((await ana('POST', `/api/layers/${l.id}/refresh`)).body.changed, false, 'same data: no new version');
  assert.equal((await ana('GET', `/api/layers/${l.id}/history`)).body.versions[0].note, 'Refreshed from its source');
  // CSV with latitude/longitude columns
  sourceBody = 'name,lat,lon\n"Smith, J",38.9,-77.0\nNo place,,\n';
  await ana('PUT', `/api/layers/${l.id}`, { sourceUrl: `${src}/feed.csv` });
  const csv = await ana('POST', `/api/layers/${l.id}/refresh`);
  assert.equal(csv.body.featureCount, 1);
  assert.equal((await ana('GET', `/api/layers/${l.id}`)).body.data.features[0].properties.name, 'Smith, J');
  // the service-description fetcher has the same guard
  delete process.env.ALLOW_PRIVATE_FETCH;
  assert.equal((await ana('GET', `/api/fetch?url=${encodeURIComponent(`${src}/feed.json`)}`)).status, 502);
  assert.equal((await anon('GET', `/api/fetch?url=${encodeURIComponent('https://example.com')}`)).status, 401);
});
