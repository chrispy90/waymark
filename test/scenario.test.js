// Scenarios: the game logic (turns, moves, branches, injects, the after-action story) and the server routes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const core = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'scenario-core.js')).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-scenario-'));
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
    const res = await fetch(base + url, { method, headers: { 'X-Waymark': '1', ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

test('units are placed, moved and measured against how far they can go in a turn', async () => {
  const c = await core();
  const doc = c.newScenario({ title: 'River crossing' });
  doc.clock.stepMinutes = 30;
  const turn = c.turnOf(doc, 'main', 0);
  const a = c.addUnit(doc, turn, { side: 'blue', kind: 'armor', lngLat: [10, 50], speedKmh: 40 });
  const b = c.addUnit(doc, turn, { side: 'blue', kind: 'armor', lngLat: [10.1, 50] });
  assert.deepEqual([a.name, b.name, a.strength, a.status], ['Blue Armor 1', 'Blue Armor 2', 100, 'ready']);
  assert.equal(c.moveAllowanceKm(doc, a), 20, '40 km/h for half an hour');
  assert.equal(c.moveAllowanceKm(doc, b), null, 'no speed set: no limit');
  const short = c.moveUnit(doc, turn, a.id, [10.1, 50]);
  assert.ok(Math.abs(short.km - 7.15) < 0.1 && short.overBy === 0, JSON.stringify(short));
  const long = c.moveUnit(doc, turn, a.id, [10.5, 50]);
  assert.ok(long.km > 35 && long.overBy > 15, JSON.stringify(long));
  assert.equal(turn.events.filter((e) => e.type === 'move').length, 1, 'one move per unit per turn: the latest');
  assert.deepEqual(a.from, [10, 50], 'measured from where the turn began');
  assert.equal(c.sidcOf(a, c.sideOf(doc, 'blue')), 'SFGPUCA--------');
  assert.equal(c.sidcOf({ kind: 'infantry', echelon: 'E' }, c.sideOf(doc, 'red')), 'SHGPUCI----E---');
  assert.equal(c.sidcOf({ kind: 'police' }, c.sideOf(doc, 'blue')), null, 'civil kinds have badges, not symbol codes');
  const ring = c.circle([10, 50], 5);
  assert.ok(ring.every((p) => Math.abs(c.distanceKm([10, 50], p) - 5) < 0.01), 'range ring points are 5 km out');
});

test('turns carry units forward, injects fire on their turn, and the log records what changed', async () => {
  const c = await core();
  const doc = c.newScenario();
  const setup = c.turnOf(doc, 'main', 0);
  const u = c.addUnit(doc, setup, { side: 'red', kind: 'infantry', lngLat: [0, 0] });
  doc.injects.push({ id: 'i1', title: 'Bridge destroyed', text: 'The bridge is down.', turn: 2, lngLat: [0.1, 0] }, { id: 'i2', title: 'Storm', text: '', turn: null });
  let r = c.nextTurn(doc, 'main');
  assert.deepEqual([r.index, r.injects.length], [1, 0]);
  const t1 = c.turnOf(doc, 'main', 1);
  c.moveUnit(doc, t1, u.id, [0.2, 0]);
  c.updateUnit(t1, u.id, { status: 'degraded', strength: 60 });
  t1.notes = 'Red pushed east.';
  assert.deepEqual(setup.units[0].lngLat, [0, 0], 'earlier turns are untouched');
  r = c.nextTurn(doc, 'main');
  assert.deepEqual(r.injects.map((x) => x.title), ['Bridge destroyed']);
  const t2 = c.turnOf(doc, 'main', 2);
  assert.deepEqual(t2.units[0].from, [0.2, 0], 'the new turn starts where the last one ended');
  assert.deepEqual([t2.units[0].status, t2.units[0].strength, t2.notes], ['degraded', 60, '']);
  assert.equal(c.fireInject(doc, t2, 'i1'), null, 'an inject fires once');
  assert.equal(c.fireInject(doc, t2, 'i2').title, 'Storm', 'unscheduled injects fire on demand');
  assert.deepEqual(c.branchLog(doc, 'main').map((e) => [e.turn, e.type]), [[0, 'add'], [1, 'move'], [1, 'status'], [1, 'strength'], [2, 'inject'], [2, 'inject']]);
  assert.deepEqual([c.turnLabel(doc, 0), c.turnLabel(doc, 2)], ['Setup', 'Turn 2']);
  doc.clock = { mode: 'elapsed', stepMinutes: 90 };
  assert.equal(c.turnLabel(doc, 3), 'H+04:30');
});

test('a branch shares history up to its fork and then plays on by itself', async () => {
  const c = await core();
  const doc = c.newScenario();
  const u = c.addUnit(doc, c.turnOf(doc, 'main', 0), { side: 'blue', kind: 'infantry', lngLat: [0, 0] });
  const foe = c.addUnit(doc, c.turnOf(doc, 'main', 0), { side: 'red', kind: 'armor', lngLat: [1, 0] });
  c.nextTurn(doc, 'main');
  c.moveUnit(doc, c.turnOf(doc, 'main', 1), u.id, [0, 0.1]);
  c.nextTurn(doc, 'main');
  c.updateUnit(c.turnOf(doc, 'main', 2), u.id, { status: 'destroyed' });
  const alt = c.branchFrom(doc, 'main', 1, 'Go south instead');
  assert.deepEqual([alt.parent, alt.forkTurn, alt.turns.length], ['main', 1, 2]);
  c.nextTurn(doc, alt.id);
  c.moveUnit(doc, c.turnOf(doc, alt.id, 2), u.id, [0, -0.1]);
  c.updateUnit(c.turnOf(doc, alt.id, 2), foe.id, { status: 'destroyed' });
  assert.equal(c.turnOf(doc, 'main', 2).units[0].status, 'destroyed', 'the main line is unchanged');
  assert.equal(c.turnOf(doc, alt.id, 2).units[0].status, 'ready');
  const cmp = c.compareBranches(doc, 'main', alt.id);
  assert.deepEqual(cmp.a.sides.map((s) => [s.name, s.active, s.units]), [['Blue', 0, 1], ['Red', 1, 1]]);
  assert.deepEqual(cmp.b.sides.map((s) => [s.name, s.active, s.units]), [['Blue', 1, 1], ['Red', 0, 1]]);
  c.rewind(doc, 'main', 1);
  assert.equal(c.lastTurn(doc, 'main'), 1);
  assert.equal(c.deleteBranch(doc, alt.id), true);
  assert.equal(c.deleteBranch(doc, 'main'), false, 'the last branch can\'t be deleted');
});

test('the after-action story replays each turn on a moving map', async () => {
  const c = await core();
  const doc = c.newScenario({ title: 'Flood response', map: 'MAP123' });
  doc.summary = 'Testing the evacuation plan.';
  const u = c.addUnit(doc, c.turnOf(doc, 'main', 0), { side: 'blue', kind: 'fire', lngLat: [5, 5] });
  doc.injects.push({ id: 'i1', title: 'Levee <breach>', text: '', turn: 1, lngLat: [5.01, 5] });
  c.nextTurn(doc, 'main');
  c.moveUnit(doc, c.turnOf(doc, 'main', 1), u.id, [5.05, 5]);
  c.turnOf(doc, 'main', 1).notes = 'Crew sent to the levee.';
  const alt = c.branchFrom(doc, 'main', 0, 'Hold position');
  c.nextTurn(doc, alt.id);
  const story = c.storyFromScenario(doc);
  assert.equal(story.title, 'Flood response: after-action review');
  assert.deepEqual(story.blocks.map((b) => b.type), ['text', 'chapter', 'scrollmap', 'stats', 'chapter', 'scrollmap', 'stats', 'text', 'text']);
  const [main, other] = story.blocks.filter((b) => b.type === 'scrollmap');
  assert.equal(main.slides.length, 2, 'setup and turn 1');
  assert.equal(other.slides.length, 1, 'a branch replays only what happened after the fork');
  assert.match(main.slides[1].html, /Fire and rescue 1 moved 5\.\d+ km/);
  assert.match(main.slides[1].html, /Inject: Levee &lt;breach&gt;/, 'text is escaped');
  assert.match(main.slides[1].html, /Crew sent to the levee\./);
  assert.equal(main.slides[1].media.view.map, 'MAP123', 'drawn over the scenario\'s saved map');
  const layer = story.layers.find((l) => l.id === main.slides[1].media.view.layers[0]);
  assert.deepEqual(layer.data.features.map((f) => f.geometry.type), ['LineString', 'Point', 'Point'], 'the move, the unit, the inject');
  assert.equal(layer.data.features[1].properties['marker-color'], '#2563eb');
  assert.equal(c.storyFromScenario(doc, { branches: ['main'] }).blocks.filter((b) => b.type === 'chapter').length, 0, 'one branch needs no chapters');
});

test('scenarios are saved, shared and made public like everything else', async () => {
  const c = await core();
  const ana = client();
  const ben = client();
  const anon = client();
  await ana('POST', '/api/auth/signup', { email: 'ana@example.com', password: 'long enough pw', name: 'Ana' });
  await ben('POST', '/api/auth/signup', { email: 'ben@example.com', password: 'long enough pw', name: 'Ben' });
  assert.equal((await ana('POST', '/api/scenarios', { scenario: { title: 'Bad', sides: [], branches: [] } })).status, 400);
  const map = (await ana('POST', '/api/maps', { map: { title: 'Ground', layers: [] } })).body;
  const doc = c.newScenario({ title: 'Exercise', map: map.id });
  c.addUnit(doc, c.turnOf(doc, 'main', 0), { side: 'blue', kind: 'hq', lngLat: [1, 1] });
  const made = await ana('POST', '/api/scenarios', { scenario: doc });
  assert.equal(made.status, 201);
  const { id } = made.body;
  assert.deepEqual((await ana('GET', '/api/scenarios')).body.scenarios.map((s) => [s.title, s.branches, s.turns, s.units]), [['Exercise', 1, 1, 1]]);
  assert.equal((await ben('GET', `/api/scenarios/${id}`)).status, 404);
  await ana('PUT', `/api/share/scenario/${id}`, { shares: [{ email: 'ben@example.com', role: 'viewer' }] });
  const seen = await ben('GET', `/api/scenarios/${id}`);
  assert.deepEqual([seen.status, seen.body.role], [200, 'viewer']);
  assert.equal((await ben('GET', `/api/maps/${map.id}`)).status, 200, 'the scenario brings its map');
  assert.equal((await ben('PUT', `/api/scenarios/${id}`, { scenario: seen.body.scenario, version: seen.body.version })).status, 403);
  const saved = await ana('PUT', `/api/scenarios/${id}`, { scenario: { ...seen.body.scenario, title: 'Exercise 2' }, version: seen.body.version });
  assert.equal(saved.status, 200);
  assert.equal((await ana('PUT', `/api/scenarios/${id}`, { scenario: seen.body.scenario, version: seen.body.version })).status, 409);
  assert.equal((await anon('GET', `/api/public/scenarios/${id}`)).status, 404);
  await ana('PUT', `/api/share/scenario/${id}`, { link: true });
  assert.equal((await anon('GET', `/api/public/scenarios/${id}`)).body.title, 'Exercise 2');
  assert.equal((await anon('GET', `/api/public/maps/${map.id}`)).status, 200, 'and its map becomes readable');
  assert.equal((await fetch(`${base}/w/${id}`)).status, 200);
  assert.equal((await ben('DELETE', `/api/scenarios/${id}`)).status, 403);
  assert.equal((await ana('DELETE', `/api/scenarios/${id}`)).status, 200);
});
