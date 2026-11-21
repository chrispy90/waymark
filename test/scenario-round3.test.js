// Map grid, weather and daylight, arcs, the schedule, adjudication odds, analysis series, templates and scenario files.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../public/js/scenario-core.js';
import * as r from '../public/js/scenario-rules.js';
import * as x from '../public/js/scenario-report.js';
import * as m from '../public/js/mgrs.js';

test('MGRS: grid references, round trips, bearings and grid lines', () => {
  assert.equal(m.toMgrs([-77.0365, 38.8977]), '18S UJ 23394 07395');
  assert.equal(m.toMgrs([2.2945, 48.8584], 3), '31U DQ 482 119');
  assert.equal(m.toMgrs([151.2153, -33.8568]).slice(0, 6), '56H LH');
  assert.equal(m.toMgrs([0, 85]), null, 'polar areas use another grid');
  assert.equal(m.utmZone(7, 60), 32, 'the Norway exception');
  for (const p of [[-77.03, 38.9], [139.69, 35.68], [-58.38, -34.6], [18.42, -33.92]]) {
    const back = m.fromUtm(m.toUtm(p));
    assert.ok(Math.abs(back[0] - p[0]) < 1e-6 && Math.abs(back[1] - p[1]) < 1e-6, `round trip ${p}`);
  }
  assert.equal(Math.round(m.bearing([0, 0], [1, 0])), 90);
  assert.equal(Math.round(m.bearing([0, 0], [0, -1])), 180);
  assert.equal(m.toMils(180), 3200);
  assert.equal(m.gridSpacing(20), 1000);
  assert.equal(m.gridSpacing(2), 100);
  assert.equal(m.gridSpacing(100), 10000);
  const g = m.gridLines([-77.2, 38.8, -76.9, 38.95], 1000);
  assert.equal(g.zone, 18);
  assert.ok(g.lines.some((l) => l.kind === 'e') && g.lines.some((l) => l.kind === 'n'));
  assert.ok(g.lines.every((l) => /^\d\d$/.test(l.label)));
  const u = m.toUtm(g.lines.find((l) => l.kind === 'e').coords[3]);
  assert.ok(Math.abs(u.easting % 1000) < 1 || Math.abs((u.easting % 1000) - 1000) < 1, 'easting lines sit on whole kilometres');
});

test('daylight: the sun at the play area sets day, twilight and night', () => {
  const doc = c.newScenario({ view: { center: [-77, 38.9], zoom: 10 } });
  doc.clock = { mode: 'turns', stepMinutes: 60, start: '2026-06-21T12:00', utcOffset: -4 };
  assert.equal(r.lightAt(doc, 0).state, 'day');
  assert.ok(r.lightAt(doc, 0).alt > 60, 'midsummer noon sun is high');
  assert.equal(r.lightAt(doc, 12).state, 'night', 'midnight');
  const dusk = [8, 9].map((n) => r.lightAt(doc, n).state);
  assert.ok(dusk.includes('twilight') || dusk.includes('night'));
  delete doc.clock.start;
  assert.equal(r.lightAt(doc, 0), null, 'no start, no daylight');
  doc.clock.start = '2026-06-21T12:00';
  delete doc.clock.utcOffset;
  assert.equal(r.turnTime(doc, 0).toISOString(), '2026-06-21T17:00:00.000Z', 'time zone guessed from longitude (-5)');
});

test('weather and night slow units off-road, cut sensors and ground aircraft', () => {
  const doc = c.newScenario({ view: { center: [-77.07, 38.86], zoom: 11 } });
  const g = r.gridSize([-77.2, 38.8, -76.93, 38.92], 1);
  doc.terrain = { origin: g.origin, size: g.size, cols: g.cols, rows: g.rows, kx: g.kx, cover: 'A'.repeat(g.cells), elev: '' };
  const T = r.terrainOf(doc.terrain);
  const t = c.turnOf(doc, 'main', 0);
  const clear = r.movementField(doc, t, 0, T, 'tracked').speed[50];
  t.weather = 'snow';
  assert.ok(Math.abs(r.movementField(doc, t, 0, T, 'tracked').speed[50] - clear * 0.5) < 1e-6);
  t.weather = 'storm';
  assert.equal(r.movementField(doc, t, 0, T, 'air').speed[50], 0, 'aircraft grounded');
  t.weather = 'fog';
  const watcher = c.addUnit(doc, t, { side: 'blue', kind: 'recon', sensorKm: 10, lngLat: [-77.1, 38.86] });
  const target = c.addUnit(doc, t, { side: 'red', kind: 'armor', lngLat: [-77.05, 38.86] }); // about 4.3 km away
  assert.equal(r.sensorRange(doc, t, 0, watcher), 3);
  assert.ok(!r.autoSpotted(doc, t, T, 0).has(target.id), 'fog hides it');
  t.weather = 'clear';
  assert.ok(r.autoSpotted(doc, t, T, 0).has(target.id));
  doc.clock = { mode: 'turns', stepMinutes: 60, start: '2026-01-10T23:00', utcOffset: -5 };
  assert.equal(r.conditions(doc, t, 0).light, 'night');
  assert.equal(r.sensorRange(doc, t, 0, watcher), 4);
  assert.ok(!r.autoSpotted(doc, t, T, 0).has(target.id), 'night halves the range and more');
  assert.ok(Math.abs(r.movementField(doc, t, 0, T, 'tracked').speed[50] - clear * 0.75) < 1e-6);
});

test('arcs: fans limit range, sensors and contact', () => {
  const doc = c.newScenario();
  const t = c.turnOf(doc, 'main', 0);
  const gun = c.addUnit(doc, t, { side: 'blue', kind: 'artillery', rangeKm: 10, sensorKm: 10, fanDir: 90, fanArc: 60, lngLat: [0, 0] });
  const east = c.addUnit(doc, t, { side: 'red', kind: 'armor', lngLat: [0.05, 0] });
  const north = c.addUnit(doc, t, { side: 'red', kind: 'armor', lngLat: [0, 0.05] });
  assert.ok(r.inArc(gun, east.lngLat));
  assert.ok(!r.inArc(gun, north.lngLat));
  const contacts = r.findContacts(doc, t).map((k) => k.b);
  assert.ok(contacts.includes(east.id) && !contacts.includes(north.id));
  const seen = r.autoSpotted(doc, t, null, 0);
  assert.ok(seen.has(east.id) && !seen.has(north.id));
  const fan = r.rangeShape(gun, 10);
  assert.deepEqual(fan[0], [0, 0], 'a fan starts at the unit');
  assert.ok(fan.length < 30);
  assert.equal(r.rangeShape({ lngLat: [0, 0] }, 5).length, 73, 'all round');
});

test('schedule: reinforcements arrive, units withdraw and the weather turns, per branch', () => {
  const doc = c.newScenario();
  const t0 = c.turnOf(doc, 'main', 0);
  const old = c.addUnit(doc, t0, { side: 'blue', kind: 'infantry', name: 'Old guard', lngLat: [0, 0] });
  doc.schedule = [
    { id: 's1', type: 'arrive', turn: 2, unit: { name: '2nd Brigade', side: 'blue', kind: 'armor', echelon: 'H' }, lngLat: [1, 1] },
    { id: 's2', type: 'withdraw', turn: 1, unitId: old.id, name: 'Old guard' },
    { id: 's3', type: 'weather', turn: 2, weather: 'rain' },
  ];
  r.startTurn(doc, 'main');
  const t1 = c.turnOf(doc, 'main', 1);
  assert.ok(!t1.units.some((u) => u.id === old.id));
  assert.ok(t1.events.some((e) => e.type === 'withdraw' && e.text === 'Old guard withdraws'));
  r.startTurn(doc, 'main');
  const t2 = c.turnOf(doc, 'main', 2);
  assert.ok(t2.units.some((u) => u.name === '2nd Brigade' && u.echelon === 'H'));
  assert.ok(t2.events.some((e) => e.text === '2nd Brigade arrives'));
  assert.equal(t2.weather, 'rain');
  assert.equal(r.weatherOf(t2), 'rain');
  c.nextTurn(doc, 'main');
  assert.equal(c.turnOf(doc, 'main', 3).weather, 'rain', 'weather carries over');
  const alt = c.branchFrom(doc, 'main', 0, 'Alt');
  r.startTurn(doc, alt.id);
  assert.ok(!c.turnOf(doc, alt.id, 1).units.some((u) => u.id === old.id), 'the schedule applies on every branch');

  doc.injects.push({ id: 'i1', title: 'Fog rolls in', effects: [{ target: 'weather', status: 'fog' }] });
  c.fireInject(doc, t2, 'i1');
  assert.equal(t2.weather, 'fog');
  assert.ok(t2.events.some((e) => e.text === 'Weather: Fog'));
});

test('adjudication: dice odds, outcome tables, matrix arguments and combat chances', () => {
  const two = x.diceDistribution('2d6');
  assert.equal(two.size, 11);
  assert.ok(Math.abs(two.get(7) - 1 / 6) < 1e-9);
  assert.ok(Math.abs([...x.diceDistribution('d100').values()].reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const table = x.EXAMPLE_TABLE();
  const ch = x.tableChances(table, 0);
  assert.equal(ch.find((k) => k.result === 'It collapses').p, 0.2778);
  assert.equal(ch.reduce((s, k) => s + k.p, 0).toFixed(3), '1.000');
  assert.ok(x.tableChances(table, 2).find((k) => k.result === 'It holds').p > ch.find((k) => k.result === 'It holds').p, 'modifiers shift the odds');
  assert.equal(x.tableRow(table, 1).result, 'It collapses', 'below the table: first row');
  assert.equal(x.tableRow(table, 15).result, 'It holds');
  assert.equal(x.matrixChance(0), 0.5833);
  assert.equal(x.matrixChance(2), 0.8333);
  assert.equal(x.matrixChance(-5), 0.0278);
  assert.equal(x.matrixChance(-6), 0, 'needs 13 on two dice');
  const roll = x.rollDice('2d6', () => 0.999);
  assert.deepEqual(roll, { faces: [6, 6], total: 12 });
  const doc = c.newScenario();
  const cc = x.crtChances(doc, '3:1');
  assert.equal(cc.defenderFallsBack, 0.6667);
  assert.ok(cc.defenderLoss > cc.attackerLoss);
  assert.equal(x.crtChances(doc, '9:1'), null);
});

test('timeline, numbers over turns and heat points', () => {
  const doc = c.newScenario();
  const t0 = c.turnOf(doc, 'main', 0);
  const a = c.addUnit(doc, t0, { side: 'blue', kind: 'infantry', name: 'A', lngLat: [0, 0] });
  const b = c.addUnit(doc, t0, { side: 'red', kind: 'infantry', name: 'B', lngLat: [0.005, 0] });
  doc.injects.push({ id: 'i1', title: 'Storm', turn: 2 }, { id: 'i2', title: 'Rumor', turn: null });
  doc.schedule = [{ id: 's1', type: 'arrive', turn: 4, unit: { name: 'C', side: 'blue', kind: 'armor' }, lngLat: [0, 0.01] }];
  doc.zones = [{ id: 'z1', name: 'Flood', effect: 'slow', from: 3, until: 5, coords: [[0, 0], [1, 0], [1, 1]] }];
  doc.objectives = [{ id: 'o', name: 'Hill', lngLat: [0, 0], radiusKm: 0.2, points: 5 }];
  r.startTurn(doc, 'main');
  r.startTurn(doc, 'main');
  const tl = x.timeline(doc, 'main');
  assert.equal(tl.played, 2);
  assert.ok(tl.turns >= 6);
  assert.equal(tl.rows.find((k) => k.id === 'i1').done, true);
  assert.equal(tl.rows.find((k) => k.id === 'i2').onDemand, true);
  assert.equal(tl.rows.find((k) => k.id === 's1').label, 'C arrives');
  assert.equal(tl.rows.find((k) => k.id === 'z1').until, 5);

  const t2 = c.turnOf(doc, 'main', 2);
  t2.events.push({ type: 'combat', units: [a.id, b.id], text: 'Combat' });
  t2.units.find((u) => u.id === b.id).status = 'destroyed';
  const s = x.seriesFor(doc, 'main');
  assert.equal(s.turns.length, 3);
  assert.equal(s.turns[2].sides.red.active, 0);
  assert.equal(s.turns[2].sides.blue.held, 5);
  assert.equal(s.turns[0].sides.blue.supplied, null, 'supply not tracked');
  assert.deepEqual(s.sides.map((k) => k.id), ['blue', 'red']);
  const heat = x.heatPoints(doc, 'main');
  assert.ok(heat.features.some((f) => f.properties.kind === 'combat' && f.properties.w === 4));
  assert.equal(heat.features.filter((f) => f.properties.kind === 'unit').length, 5);
  t2.units.find((u) => u.id === a.id).from = [0, -0.01];
  assert.ok(x.distanceMoved(doc, 'main').blue > 1);
});

test('templates and scenario files', () => {
  const doc = c.newScenario({ title: 'Exercise' });
  const t0 = c.turnOf(doc, 'main', 0);
  c.addUnit(doc, t0, { side: 'blue', kind: 'infantry', lngLat: [0, 0] });
  doc.hotwash = { layer: 'L', form: 'F' };
  r.startTurn(doc, 'main');
  c.branchFrom(doc, 'main', 0, 'Alt');
  const tpl = x.toTemplate(doc);
  assert.equal(tpl.template, true);
  assert.equal(tpl.title, 'Exercise (template)');
  assert.equal(tpl.branches.length, 1);
  assert.equal(tpl.branches[0].turns.length, 1);
  assert.equal(tpl.branches[0].turns[0].events.length, 0);
  assert.equal(tpl.branches[0].turns[0].units.length, 1);
  assert.equal(tpl.hotwash, undefined);
  assert.equal(x.toTemplate(tpl).title, 'Exercise (template)', 'no double suffix');
  const fresh = x.fromTemplate(tpl);
  assert.equal(fresh.template, undefined);
  assert.equal(fresh.title, 'Exercise');

  const file = JSON.stringify(x.packScenario(doc));
  const back = x.unpackScenario(file);
  assert.equal(back.branches.length, 2);
  assert.equal(back.hotwash, undefined, 'links to this server are dropped');
  assert.throws(() => x.unpackScenario('not json'), /isn't a Waymark scenario/);
  assert.throws(() => x.unpackScenario({ format: 'waymark-scenario', scenario: { sides: [], branches: [] } }), /no sides/);
  assert.throws(() => x.unpackScenario({ sides: [{ id: 'a' }], branches: [{ turns: [{ units: [{ name: 'U' }] }] }] }), /"U" .* no position/);
  assert.equal(x.unpackScenario({ sides: [{ id: 'a' }], branches: [{ turns: [{ units: [] }] }] }).injects.length, 0, 'a bare scenario works too');
});

test('hotwash: questions and a summary of the answers', () => {
  const doc = c.newScenario({ title: 'Ex' });
  const spec = x.hotwashSpec(doc);
  assert.equal(spec.form.location, 'optional');
  assert.ok(spec.form.fields.find((f) => f.name === 'role').choices.includes('Blue'));
  assert.deepEqual(spec.layer.fields.map((f) => f.name), spec.form.fields.map((f) => f.name));
  const sum = x.summariseHotwash([{ properties: { role: 'Blue', useful: '5 – Very useful', went_well: 'Good map' } }, { properties: { role: 'Blue', useful: '3', improve: 'More time' } }]);
  assert.equal(sum.count, 2);
  assert.equal(sum.useful, 4);
  assert.deepEqual(sum.roles, { Blue: 2 });
  assert.deepEqual(sum.improve, ['More time']);
});

test('branchDiff ghost overlay, Monte Carlo combat sensitivity & synchronization matrix', () => {
  const doc = c.newScenario({ title: 'COA Test' });
  const t0 = c.turnOf(doc, 'main', 0);
  const u1 = c.addUnit(doc, t0, { side: 'blue', kind: 'armor', name: '1st Armor', strength: 100, lngLat: [-77.0, 38.9] });
  const u2 = c.addUnit(doc, t0, { side: 'red', kind: 'infantry', name: 'Red Guard', strength: 80, lngLat: [-76.95, 38.9] });
  doc.schedule = [{ id: 's1', type: 'weather', turn: 3, weather: 'rain' }];
  doc.injects = [{ id: 'i1', title: 'Bridge Out', text: 'Span dropped', turn: 2 }];

  // Advance main branch and move u1 east
  r.startTurn(doc, 'main');
  const m1 = c.turnOf(doc, 'main', 1);
  c.moveUnit(doc, m1, u1.id, [-76.96, 38.9]);
  c.updateUnit(m1, u2.id, { strength: 50 });

  // Branch from setup and move u1 north instead
  const alt = c.branchFrom(doc, 'main', 0, 'Northern Flank');
  r.startTurn(doc, alt.id);
  const a1 = c.turnOf(doc, alt.id, 1);
  c.moveUnit(doc, a1, u1.id, [-77.0, 38.96]);

  const diff = x.branchDiff(doc, 'main', alt.id, 1);
  assert.equal(diff.movedCount, 1);
  assert.ok(diff.avgDispKm > 5);
  assert.ok(diff.features.some((f) => f.properties.kind === 'ghost-unit' && /1st Armor/.test(f.properties.name)));
  assert.ok(diff.features.some((f) => f.properties.kind === 'ghost-delta' && f.geometry.type === 'LineString'));
  const redSide = diff.sides.find((s) => s.id === 'red');
  assert.equal(redSide.strengthDelta, 30, 'Red is 30% stronger in the Northern Flank branch');

  // Monte Carlo COA simulation
  const mc = x.monteCarloCombat(doc, { column: '3:1', attackerStrength: 90, defenderStrength: 70, trials: 500 });
  assert.equal(mc.trials, 500);
  assert.ok(mc.defender.mean < 70);
  assert.ok(mc.defender.p10 <= mc.defender.p50 && mc.defender.p50 <= mc.defender.p90);
  assert.ok(mc.outcomes.length >= 1);

  // Synchronization matrix + CSV export
  const mx = x.synchMatrix(doc, 'main');
  assert.equal(mx.rows.length, 6);
  assert.equal(mx.turns.length, 4, 'Includes played turns 0-1 plus scheduled turns 2-3');
  assert.ok(mx.rows.find((row) => row.key === 'c2').cells[2].some((s) => /Bridge Out/.test(s)));
  assert.ok(mx.rows.find((row) => row.key === 'conditions').cells[3].some((s) => /Rain/.test(s)));
  const csv = x.synchMatrixCsv(mx);
  assert.ok(csv.includes('Warfighting Function'));
  assert.ok(csv.includes('Maneuver & movement'));
});
