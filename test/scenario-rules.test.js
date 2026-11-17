// Scenario rules: terrain movement, lines of communication, supply and command, combat, objectives, spotting,
// planned moves and spreadsheet import. Runs on a small made-up terrain grid, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../public/js/scenario-core.js';
import * as r from '../public/js/scenario-rules.js';

// A 1 km hex grid, 24 × 14 cells, of open ground. `paint(col,row)` returns [cover, road, river] overrides.
function makeGrid(paint = () => null, elev = () => 50) {
  const g = r.gridSize([-77.2, 38.8, -76.93, 38.92], 1);
  const cells = [];
  const heights = [];
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      const [cover, road, river] = paint(col, row) || [0, 0, 0];
      cells.push(r.packCell(cover, road, river));
      heights.push(elev(col, row));
    }
  }
  return { origin: g.origin, size: g.size, cols: g.cols, rows: g.rows, kx: g.kx, cover: cells.join(''), elev: r.encodeElevation(heights) };
}
const RIVER_COL = 12;
const BRIDGE_ROW = 6;

function riverGrid() {
  return makeGrid((col, row) => {
    if (col === RIVER_COL) return row === BRIDGE_ROW ? [0, 2, 1] : [0, 0, 1]; // a river running north–south, one road bridge
    if (row === BRIDGE_ROW) return [0, 2, 0]; // the road east–west
    return null;
  });
}

test('terrain grid: every cell center maps back to its cell, and neighbors are one cell apart', () => {
  const T = r.terrainOf(riverGrid());
  assert.ok(T.n > 200);
  for (let i = 0; i < T.n; i += 7) {
    assert.equal(T.cellAt(T.center(i)), i);
    for (let k = 0; k < 6; k++) {
      const j = T.neighbor(i, k);
      if (j < 0) continue;
      assert.equal(T.neighbor(j, (k + 3) % 6), i, 'neighbors are mutual');
      assert.ok(Math.abs(c.distanceKm(T.center(i), T.center(j)) - 1) < 0.03, 'neighbor centers are 1 km apart');
    }
  }
  assert.equal(T.cellAt([-80, 38.85]), -1, 'outside the grid');
  const stats = r.terrainStats(T);
  assert.equal(stats.river, T.rows);
  assert.ok(stats.road >= T.cols);
});

test('routes: wheeled units find the bridge; cutting it blocks them and slows people on foot', () => {
  const doc = c.newScenario();
  doc.terrain = riverGrid();
  const T = r.terrainOf(doc.terrain);
  const t = c.turnOf(doc, 'main', 0);
  const west = T.center(2 * T.cols + 3);
  const east = T.center(2 * T.cols + 20);
  const truck = c.addUnit(doc, t, { side: 'blue', kind: 'supply', lngLat: west });
  const route = r.routeUnit(doc, t, 0, T, truck, east);
  assert.ok(!route.blocked);
  const bridge = BRIDGE_ROW * T.cols + RIVER_COL;
  assert.ok(route.path.some((p) => T.cellAt(p) === bridge), 'the route goes over the bridge');
  assert.ok(route.km > c.distanceKm(west, east) + 4, 'it detours to the bridge');
  assert.ok(route.cost > 0 && route.hours > 0);

  const walker = c.addUnit(doc, t, { side: 'blue', kind: 'infantry', lngLat: west });
  const before = r.routeUnit(doc, t, 0, T, walker, east);

  doc.network = { links: [{ id: 'br', name: 'Road bridge', type: 'bridge', side: null, coords: [T.center(bridge - 1), T.center(bridge + 1)] }], nodes: [] };
  r.setLinkStatus(doc, t, 'br', 'cut');
  assert.equal(r.routeUnit(doc, t, 0, T, truck, east).blocked, true, 'no other way across for wheels');
  const after = r.routeUnit(doc, t, 0, T, walker, east);
  assert.ok(!after.blocked && after.hours > before.hours, 'walkers wade across, slower');
  assert.ok(t.events.some((e) => e.text === 'Road bridge is cut'));

  // A unit's move follows the route, uses supply, and is checked against the turn's length
  const step = c.moveUnit(doc, t, walker.id, east, after);
  assert.equal(walker.path.length, after.path.length);
  assert.ok(walker.used > 0);
  assert.ok(step.overHours > 0, 'too far to walk in one hour');
  assert.match(t.events.at(-1).text, /moved .* km in .*, using \d+% of its supply/);
});

test('reach: a road takes you further, and zones slow or block movement', () => {
  const doc = c.newScenario();
  doc.terrain = riverGrid();
  const T = r.terrainOf(doc.terrain);
  const t = c.turnOf(doc, 'main', 0);
  const onRoad = c.addUnit(doc, t, { side: 'blue', kind: 'recon', lngLat: T.center(BRIDGE_ROW * T.cols + 4) });
  const cells = r.reachCells(doc, t, 0, T, onRoad, 0.2);
  const roadCells = [...cells.keys()].filter((i) => T.roadOf(i)).length;
  assert.ok(roadCells >= 8, 'goes far along the road');
  assert.ok(cells.size < T.n / 2, 'but not everywhere');
  const outline = r.cellsOutline(T, cells);
  assert.equal(outline.type, 'MultiLineString');
  assert.ok(outline.coordinates.length >= 6);

  doc.zones = [{ id: 'z', name: 'Minefield', effect: 'block', from: 0 }];
  doc.zones[0].coords = [[T.center(BRIDGE_ROW * T.cols + 6)[0], T.center((BRIDGE_ROW - 3) * T.cols)[1]], [T.center(BRIDGE_ROW * T.cols + 8)[0], T.center((BRIDGE_ROW - 3) * T.cols)[1]],
    [T.center(BRIDGE_ROW * T.cols + 8)[0], T.center((BRIDGE_ROW + 3) * T.cols)[1]], [T.center(BRIDGE_ROW * T.cols + 6)[0], T.center((BRIDGE_ROW + 3) * T.cols)[1]]];
  const blocked = r.reachCells(doc, t, 0, T, onRoad, 0.2);
  assert.ok(blocked.size < cells.size, 'the minefield cuts the road');
  doc.zones[0].from = 3;
  assert.equal(r.reachCells(doc, t, 0, T, onRoad, 0.2).size, cells.size, 'not active until turn 3');
});

function supplyDoc() {
  const doc = c.newScenario();
  const t = c.turnOf(doc, 'main', 0);
  doc.network = {
    nodes: [{ id: 'd1', name: 'Main depot', type: 'depot', side: 'blue', lngLat: [-77.2, 38.85] }],
    links: [{ id: 'rail', name: 'Rail line', type: 'rail', side: 'blue', coords: [[-77.2, 38.85], [-77.1, 38.85], [-77.0, 38.85]] }],
  };
  const front = c.addUnit(doc, t, { side: 'blue', kind: 'infantry', name: 'Front', lngLat: [-77.0, 38.87] });
  const lost = c.addUnit(doc, t, { side: 'blue', kind: 'infantry', name: 'Lost', lngLat: [-76.6, 39.2] });
  const red = c.addUnit(doc, t, { side: 'red', kind: 'armor', name: 'Raider', lngLat: [-76.5, 38.5] });
  return { doc, t, front, lost, red };
}

test('supply: open lines supply, degraded strain, cut and interdicted lines don\'t', () => {
  const { doc, t, front, lost, red } = supplyDoc();
  let s = r.supplyStates(doc, t);
  assert.equal(s.get(front.id).state, 'in');
  assert.equal(s.get(front.id).via, 'Rail line');
  assert.equal(s.get(lost.id).state, 'out');
  assert.equal(s.get(red.id).state, 'none', 'Red has no depots, so isn\'t tracked');

  r.setLinkStatus(doc, t, 'rail', 'degraded');
  assert.equal(r.supplyStates(doc, t).get(front.id).state, 'strained');
  r.setLinkStatus(doc, t, 'rail', 'cut');
  assert.equal(r.supplyStates(doc, t).get(front.id).state, 'out');
  r.setLinkStatus(doc, t, 'rail', 'open');

  red.lngLat = [-77.1, 38.86]; // sits on the line
  const cuts = r.interdictions(doc, t);
  assert.ok(cuts.some((x) => x.link === 'rail' && x.by === red.id));
  assert.equal(r.supplyStates(doc, t).get(front.id).state, 'out', 'the enemy cuts the line behind it');
  doc.rules = { interdictKm: 0 };
  assert.equal(r.supplyStates(doc, t).get(front.id).state, 'in', 'interdiction off');

  // An inject can cut a line from the turn it's released
  doc.injects.push({ id: 'i1', title: 'Rail bridge down', effects: [{ target: 'rail', status: 'cut' }] });
  c.fireInject(doc, t, 'i1');
  assert.equal(r.statusOf(t, 'rail'), 'cut');
});

test('starting a turn: moves use supply, open lines resupply, and automatic effects cost strength', () => {
  const { doc, t, front, lost } = supplyDoc();
  front.used = 40;
  lost.used = 30;
  doc.rules = { auto: true, lossPct: 15, resupply: 25 };
  const res = r.startTurn(doc, 'main');
  const t1 = c.turnOf(doc, 'main', res.index);
  const f1 = t1.units.find((u) => u.id === front.id);
  const l1 = t1.units.find((u) => u.id === lost.id);
  assert.equal(f1.supply, 85, '100 − 40 + 25');
  assert.equal(l1.supply, 70, 'no resupply when cut off');
  assert.equal(l1.strength, 85, 'loses 15%');
  assert.equal(f1.used, undefined);
  assert.ok(t1.events.some((e) => e.type === 'supply' && /Out of supply: Lost/.test(e.text)));
  assert.equal(r.turnsOutOfSupply(doc, c.branchOf(doc, 'main'), 1, lost.id), 2);
  assert.deepEqual(t1.links, {}, 'line statuses carry over');
});

test('command: radio range, jamming and signal links', () => {
  const doc = c.newScenario();
  const t = c.turnOf(doc, 'main', 0);
  const hq = c.addUnit(doc, t, { side: 'blue', kind: 'hq', name: 'HQ', lngLat: [-77, 38.9] });
  const near = c.addUnit(doc, t, { side: 'blue', kind: 'infantry', name: 'Near', parent: hq.id, lngLat: [-77.05, 38.9] });
  const far = c.addUnit(doc, t, { side: 'blue', kind: 'infantry', name: 'Far', parent: hq.id, lngLat: [-76.4, 38.9] });
  let s = r.commandStates(doc, t, 0);
  assert.equal(s.get(near.id).state, 'ok');
  assert.equal(s.get(far.id).state, 'out');
  assert.equal(s.get(hq.id), undefined, 'no headquarters, not tracked');

  doc.zones = [{ id: 'j', name: 'Jamming', effect: 'jam', coords: [[-77.1, 38.85], [-77.02, 38.85], [-77.02, 38.95], [-77.1, 38.95]], from: 0 }];
  s = r.commandStates(doc, t, 0);
  assert.equal(s.get(near.id).state, 'out');
  assert.equal(s.get(near.id).why, 'Radios jammed');

  doc.network = { nodes: [], links: [{ id: 'cable', name: 'Cable', type: 'signal', side: 'blue', coords: [[-77.05, 38.9], [-77, 38.9], [-76.4, 38.9]] }] };
  s = r.commandStates(doc, t, 0);
  assert.equal(s.get(near.id).state, 'ok', 'cables aren\'t jammed');
  assert.equal(s.get(far.id).state, 'ok');
  hq.status = 'destroyed';
  assert.match(r.commandStates(doc, t, 0).get(near.id).why, /out of action/);
});

test('combat: odds from combat values, terrain helps the defender, results apply', () => {
  const doc = c.newScenario();
  doc.terrain = makeGrid((col, row) => (col === 5 && row === 5 ? [2, 0, 0] : null));
  const T = r.terrainOf(doc.terrain);
  const t = c.turnOf(doc, 'main', 0);
  const town = T.center(5 * T.cols + 5);
  const def = c.addUnit(doc, t, { side: 'red', kind: 'infantry', echelon: 'E', name: 'Defenders', lngLat: town });
  const a1 = c.addUnit(doc, t, { side: 'blue', kind: 'armor', echelon: 'E', name: 'Tanks', lngLat: T.center(5 * T.cols + 7) });
  const a2 = c.addUnit(doc, t, { side: 'blue', kind: 'infantry', echelon: 'E', name: 'Rifles', lngLat: T.center(5 * T.cols + 7) });
  const out = r.resolveCombat(doc, t, 0, T, [a1, a2], [def], 6);
  assert.equal(out.attack, 2.6);
  assert.equal(out.defense, 2, 'infantry in a town counts double');
  assert.equal(out.column, '1:1');
  assert.equal(out.result, r.DEFAULT_CRT.rows[5][2]);
  const text = r.applyCombat(doc, t, out);
  assert.match(text, /^Combat: Tanks, Rifles attacked Defenders at 1:1, rolled 6/);
  assert.equal(def.strength, 80);
  assert.equal(def.status, 'engaged');
  assert.equal(a1.strength, 90);

  const crush = r.resolveCombat(doc, t, 0, T, [{ ...a1, echelon: 'H', strength: 100 }], [def], 3);
  assert.equal(crush.column, '5:1');
  assert.deepEqual(r.parseResult('A10 D30 DR'), { a: 10, d: 30, ar: false, dr: true });
  assert.equal(r.describeResult('A20 AR'), 'attackers lose 20%, attackers fall back');
  const weak = r.resolveCombat(doc, t, 0, T, [{ ...a2, echelon: 'B' }], [def], 1);
  assert.ok(weak.below, 'worse odds than the table shows are resolved at the lowest column');
  doc.combat = { columns: ['1:1', '2:1'], rows: Array.from({ length: 6 }, () => ['A10', 'D10']) };
  assert.equal(r.resolveCombat(doc, t, 0, T, [a1, a2], [def], 2).result, 'A10');
});

test('objectives: control, contested ground and scores', () => {
  const doc = c.newScenario();
  doc.objectives = [{ id: 'o1', name: 'Bridge', lngLat: [-77, 38.9], radiusKm: 2, points: 10 }, { id: 'o2', name: 'Town', lngLat: [-76.9, 38.9], radiusKm: 2, points: 5, holder: 'red' }];
  doc.victory = { target: 20, mode: 'total' };
  const t0 = c.turnOf(doc, 'main', 0);
  const blue = c.addUnit(doc, t0, { side: 'blue', kind: 'infantry', lngLat: [-77.01, 38.9] });
  c.addUnit(doc, t0, { side: 'neutral', kind: 'civilians', lngLat: [-76.9, 38.9] });
  const b = c.branchOf(doc, 'main');
  assert.deepEqual(r.controlAt(doc, b, 0), { o1: 'blue', o2: 'red' }, 'neutral units don\'t take objectives');
  c.nextTurn(doc, 'main');
  c.nextTurn(doc, 'main');
  let s = r.scoreAt(doc, b, 2);
  assert.deepEqual(s.held, { blue: 10, red: 5, neutral: 0 });
  assert.equal(s.total.blue, 20);
  assert.equal(s.winner, 'blue');
  const t2 = c.turnOf(doc, 'main', 2);
  c.addUnit(doc, t2, { side: 'red', kind: 'armor', lngLat: [-77, 38.91] });
  assert.equal(r.controlAt(doc, b, 2).o1, 'contested');
  s = r.scoreAt(doc, b, 2);
  assert.equal(s.held.blue, 0);
  t2.units.find((u) => u.id === blue.id).status = 'destroyed';
  assert.equal(r.controlAt(doc, b, 2).o1, 'red');
});

test('spotting: sensors see what\'s in range and not behind a ridge', () => {
  const doc = c.newScenario();
  doc.terrain = makeGrid(undefined, (col) => (col === 10 ? 400 : 50)); // a ridge along column 10
  const T = r.terrainOf(doc.terrain);
  const t = c.turnOf(doc, 'main', 0);
  const watcher = c.addUnit(doc, t, { side: 'blue', kind: 'recon', sensorKm: 8, lngLat: T.center(5 * T.cols + 7) });
  const sameSide = c.addUnit(doc, t, { side: 'red', kind: 'armor', name: 'Near', lngLat: T.center(5 * T.cols + 9) });
  const behind = c.addUnit(doc, t, { side: 'red', kind: 'armor', name: 'Behind ridge', lngLat: T.center(5 * T.cols + 13) });
  const tooFar = c.addUnit(doc, t, { side: 'red', kind: 'armor', name: 'Far', lngLat: T.center(13 * T.cols + 0) });
  const seen = r.autoSpotted(doc, t, T);
  assert.ok(seen.has(sameSide.id));
  assert.ok(!seen.has(behind.id), 'the ridge hides it');
  assert.ok(!seen.has(tooFar.id));
  assert.ok(!seen.has(watcher.id), 'Red has no sensors');
  assert.equal(r.lineOfSight(null, [0, 0], [1, 1]), true, 'no terrain, nothing in the way');
});

test('planned moves: everyone moves at once, and contacts are logged', () => {
  const doc = c.newScenario();
  const t = c.turnOf(doc, 'main', 0);
  const a = c.addUnit(doc, t, { side: 'blue', kind: 'armor', name: 'Blue tanks', rangeKm: 3, lngLat: [-77.1, 38.9] });
  const b = c.addUnit(doc, t, { side: 'red', kind: 'armor', name: 'Red tanks', lngLat: [-76.9, 38.9] });
  a.plan = { to: [-77.01, 38.9] };
  b.plan = { to: [-76.99, 38.9] };
  const { moved, contacts } = r.executePlans(doc, t);
  assert.deepEqual(moved.sort(), [a.id, b.id].sort());
  assert.equal(a.plan, undefined);
  assert.deepEqual(a.lngLat, [-77.01, 38.9]);
  assert.equal(contacts.length, 1);
  assert.ok(t.events.some((e) => e.type === 'contact' && /Blue tanks and Red tanks/.test(e.text)));
});

test('spreadsheets: units with sides, kinds, sizes and headquarters; injects', () => {
  const doc = c.newScenario();
  const { units, sides, warnings } = r.unitsFromCsv(doc, `${r.ORBAT_TEMPLATE}\nMilitia,Green Army,Guerrillas,,60,,,,,,,,,,\n"Ferry, Inc",Neutral,Ship,,,,,,,,,,naval,,`, [-77, 38.9]);
  assert.equal(units.length, 6);
  const hq = units.find((u) => u.name === '2nd Brigade HQ');
  assert.equal(hq.kind, 'hq');
  assert.equal(hq.echelon, 'H');
  assert.equal(units.find((u) => u.name === '1st Battalion')._parent, '2nd Brigade HQ');
  assert.equal(units.find((u) => u.name === '12th Mech').kind, 'mech');
  assert.equal(units.find((u) => u.name === '12th Mech').spotted, true);
  assert.equal(units.find((u) => u.name === 'Tank Company').speedKmh, 40);
  assert.equal(units.find((u) => u.name === '1st Battalion').rangeKm, 3);
  assert.equal(sides.length, 1);
  assert.equal(sides[0].name, 'Green Army');
  const militia = units.find((u) => u.name === 'Militia');
  assert.equal(militia.kind, 'other');
  assert.equal(militia.strength, 60);
  assert.equal(units.find((u) => u.name === 'Ferry, Inc').mobility, 'naval');
  assert.ok(warnings.some((w) => /Guerrillas/.test(w)));
  assert.ok(warnings.some((w) => /2 units have no coordinates/.test(w)));
  assert.throws(() => r.unitsFromCsv(doc, 'side,kind\nBlue,Armor'), /name/);

  const injects = r.injectsFromCsv(r.INJECTS_TEMPLATE);
  assert.equal(injects.length, 2);
  assert.equal(injects[0].turn, 2);
  assert.deepEqual(injects[0].lngLat, [-77.0699, 38.9022]);
  assert.equal(injects[1].turn, null);
  assert.equal(injects[1].lngLat, undefined);
});

test('story maps show lines, objectives and planning graphics', () => {
  const { doc, t } = supplyDoc();
  doc.objectives = [{ id: 'o1', name: 'Bridge', lngLat: [-77, 38.87], radiusKm: 3, points: 10 }];
  t.graphics = [{ id: 'g1', type: 'arrow', side: 'blue', label: 'Main effort', coords: [[-77.1, 38.8], [-77, 38.9]] }];
  r.setLinkStatus(doc, t, 'rail', 'cut');
  const story = c.storyFromScenario(doc, { decorate: (b, n) => r.storyFeatures(doc, b, n) });
  const feats = story.layers[0].data.features;
  assert.ok(feats.some((f) => f.properties.name === 'Rail line' && f.properties.stroke === '#dc2626'));
  assert.ok(feats.some((f) => /Bridge \(Blue\)/.test(f.properties.text || '')));
  assert.ok(feats.some((f) => f.properties.name === 'Main effort' && f.properties.arrow));
});
