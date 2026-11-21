// Scenario helpers for running and reviewing a game: outcome tables and matrix arguments with their exact chances,
// the chances of each combat result, the game's timeline, numbers over turns for charts, heat map points, the hotwash
// questionnaire, templates, and scenario files. No DOM here, so it can be tested in Node.
//
// Document additions:
//   tables:  [{ id, name, die: 'd6' | '2d6' | 'd10' | 'd20' | 'd100', rows: [{ min, max, result }], modifiers: [{ label, value }] }]
//   hotwash: { layer: "<hosted layer id>", form: "<form id>" }
//   template: true                       (a scenario kept as a starting point for new ones)
import { sideSummary, sideOf, turnLabel, branchOf, distanceKm } from './scenario-core.js';
import { supplyStates, scoreAt, crtOf, parseResult, WEATHER } from './scenario-rules.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/* ---------- dice and outcome tables ---------- */

export const DICE = { d6: [1, 6], '2d6': [2, 6], d10: [1, 10], d20: [1, 20], d100: [1, 100] };

/** Every possible total of a roll and its chance: Map(total → probability). */
export function diceDistribution(die) {
  const [count, sides] = DICE[die] || DICE.d6;
  let dist = new Map([[0, 1]]);
  for (let k = 0; k < count; k++) {
    const next = new Map();
    for (const [t, p] of dist) for (let f = 1; f <= sides; f++) next.set(t + f, (next.get(t + f) || 0) + p / sides);
    dist = next;
  }
  return dist;
}
export function rollDice(die, random = Math.random) {
  const [count, sides] = DICE[die] || DICE.d6;
  const faces = Array.from({ length: count }, () => 1 + Math.floor(random() * sides));
  return { faces, total: faces.reduce((a, b) => a + b, 0) };
}

/** The row of a table a (modified) total lands on. Totals beyond the table use its first or last row. */
export function tableRow(table, total) {
  const rows = [...(table.rows || [])].sort((a, b) => a.min - b.min);
  if (!rows.length) return null;
  return rows.find((r) => total >= r.min && total <= r.max) || (total < rows[0].min ? rows[0] : rows.at(-1));
}

/** Each result of a table and its exact chance, after a modifier: [{ result, p }]. */
export function tableChances(table, modifier = 0) {
  const out = new Map();
  for (const [t, p] of diceDistribution(table.die)) {
    const row = tableRow(table, t + modifier);
    if (row) out.set(row.result, (out.get(row.result) || 0) + p);
  }
  return [...out].map(([result, p]) => ({ result, p: round(p, 4) }));
}

export const EXAMPLE_TABLE = () => ({
  id: uid('t'), name: 'Does the bridge hold?', die: '2d6',
  rows: [{ min: 2, max: 5, result: 'It collapses' }, { min: 6, max: 8, result: 'It holds, but only for foot traffic' }, { min: 9, max: 12, result: 'It holds' }],
  modifiers: [{ label: 'Engineers on site', value: 2 }, { label: 'Under artillery fire', value: -2 }],
});

/** A matrix game argument succeeds on 7 or more on two dice, plus one for each reason for and minus one for each against. */
export function matrixChance(net) {
  let p = 0;
  for (const [t, q] of diceDistribution('2d6')) if (t + net >= 7) p += q;
  return round(p, 4);
}

/** For a combat table column: the chance of each result, and the average losses. */
export function crtChances(doc, column) {
  const crt = crtOf(doc);
  const col = crt.columns.indexOf(column);
  if (col < 0) return null;
  const results = crt.rows.map((row) => row[col] || '');
  const fx = results.map(parseResult);
  const share = (pred) => round(fx.filter(pred).length / 6, 4);
  return {
    results: [...new Set(results)].map((r) => ({ result: r, p: round(results.filter((x) => x === r).length / 6, 4) })),
    attackerLoss: round(fx.reduce((s, e) => s + e.a, 0) / 6, 1),
    defenderLoss: round(fx.reduce((s, e) => s + e.d, 0) / 6, 1),
    defenderFallsBack: share((e) => e.dr),
    attackerFallsBack: share((e) => e.ar),
  };
}

/* ---------- the timeline ---------- */

/**
 * Everything scripted to happen, by turn, for the facilitator's timeline: rows of { kind, id, label, turn, until, done }.
 * `done` is set for injects already released on this branch.
 */
export function timeline(doc, branchId) {
  const b = branchOf(doc, branchId);
  const firedAt = (id) => b.turns.findIndex((t) => (t.fired || []).includes(id));
  const rows = [];
  for (const x of doc.injects || []) {
    const at = firedAt(x.id);
    rows.push({ kind: 'inject', id: x.id, label: x.title || 'Inject', turn: x.turn ? Number(x.turn) : at >= 0 ? at : null, done: at >= 0, onDemand: !x.turn });
  }
  for (const s of doc.schedule || []) {
    const label = s.type === 'arrive' ? `${s.unit?.name || 'Unit'} arrives` : s.type === 'withdraw' ? `${s.name || 'Unit'} withdraws` : `Weather: ${WEATHER[s.weather]?.label || s.weather}`;
    rows.push({ kind: s.type, id: s.id, label, turn: Number(s.turn), done: Number(s.turn) <= b.turns.length - 1 });
  }
  for (const z of doc.zones || []) {
    const injectTurn = z.inject ? firedAt(z.inject) : -1;
    rows.push({ kind: 'zone', id: z.id, label: z.name || 'Area', turn: z.inject ? (injectTurn >= 0 ? injectTurn : null) : Number(z.from) || 0, until: z.until == null || z.until === '' ? null : Number(z.until),
      after: z.inject ? (doc.injects || []).find((x) => x.id === z.inject)?.title || 'an inject' : null });
  }
  const last = b.turns.length - 1;
  const span = Math.max(last + 3, 6, ...rows.map((r) => (r.until ?? r.turn ?? 0) + 1));
  return { rows, played: last, turns: Math.min(span, 60) };
}

/* ---------- numbers over turns ---------- */

/** Per turn of a branch, per side: units in action, average strength, units in supply, score. For the analysis charts. */
export function seriesFor(doc, branchId) {
  const b = branchOf(doc, branchId);
  const scoring = (doc.objectives || []).length > 0;
  const turns = b.turns.map((t, n) => {
    const sides = sideSummary(doc, t);
    const supply = supplyStates(doc, t);
    const score = scoring ? scoreAt(doc, b, n) : null;
    return {
      n, label: turnLabel(doc, n),
      sides: Object.fromEntries(doc.sides.map((s) => {
        const sum = sides.find((x) => x.id === s.id);
        const units = t.units.filter((u) => u.side === s.id && u.status !== 'destroyed');
        const tracked = units.filter((u) => supply.get(u.id) && supply.get(u.id).state !== 'none');
        return [s.id, { active: sum?.active ?? 0, strength: sum?.strength ?? 0, supplied: tracked.length ? tracked.filter((u) => supply.get(u.id).state === 'in').length : null,
          held: score ? score.held[s.id] : null, total: score ? score.total[s.id] : null }];
      })),
    };
  });
  return { turns, sides: doc.sides.filter((s) => turns.some((t) => t.sides[s.id].active || t.sides[s.id].held)), scoring };
}

/** Points for heat maps: where units stood each turn, and where fights and contacts happened. */
export function heatPoints(doc, branchId) {
  const b = branchOf(doc, branchId);
  const features = [];
  b.turns.forEach((t, n) => {
    for (const u of t.units) if (u.status !== 'destroyed') features.push({ type: 'Feature', properties: { kind: 'unit', side: u.side, n, w: 1 }, geometry: { type: 'Point', coordinates: u.lngLat } });
    for (const e of t.events) {
      if ((e.type !== 'combat' && e.type !== 'contact') || !e.units?.length) continue;
      const pts = e.units.map((id) => t.units.find((u) => u.id === id)?.lngLat).filter(Boolean);
      if (!pts.length) continue;
      const c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
      features.push({ type: 'Feature', properties: { kind: e.type, n, w: e.type === 'combat' ? 4 : 2, text: e.text }, geometry: { type: 'Point', coordinates: c } });
    }
  });
  return { type: 'FeatureCollection', features };
}

/** How far each side's units moved in total on a branch (km), from their recorded moves. */
export function distanceMoved(doc, branchId) {
  const b = branchOf(doc, branchId);
  const out = Object.fromEntries(doc.sides.map((s) => [s.id, 0]));
  for (const t of b.turns) for (const u of t.units) if (u.from && out[u.side] !== undefined) out[u.side] += u.path?.length > 1 ? u.path.slice(1).reduce((s, p, i) => s + distanceKm(u.path[i], p), 0) : distanceKm(u.from, u.lngLat);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, round(v, 1)]));
}

/* ---------- hotwash ---------- */

/** The hosted layer and public form for the hotwash questionnaire. */
export function hotwashSpec(doc) {
  const sides = doc.sides.map((s) => s.name);
  const fields = [
    { name: 'role', type: 'string', label: 'Your role in the exercise', choices: [...sides, 'Control or facilitator', 'Observer'] },
    { name: 'went_well', type: 'string', label: 'What went well?', long: true },
    { name: 'improve', type: 'string', label: 'What should we do differently?', long: true },
    { name: 'surprise', type: 'string', label: 'What surprised you?', long: true },
    { name: 'useful', type: 'string', label: 'How useful was the exercise?', choices: ['5 – Very useful', '4', '3', '2', '1 – Not useful'] },
  ];
  return {
    layer: { title: `Hotwash: ${doc.title || 'Scenario'}`, geomType: 'Point', fields: fields.map(({ name, type }) => ({ name, type })), summary: `Answers to the hotwash questionnaire for the scenario "${doc.title || 'Scenario'}".` },
    form: { title: `Hotwash: ${doc.title || 'Scenario'}`, description: `Thanks for taking part in "${doc.title || 'the exercise'}". A few quick questions while it's fresh. Answers are anonymous.`,
      thanks: 'Thank you. Your answers go into the after-action review.', button: 'Send answers', location: 'optional', photo: false, fields },
  };
}

/** Answers summarised for the screen and the after-action story. */
export function summariseHotwash(features) {
  const answers = features.map((f) => f.properties || {});
  const useful = answers.map((a) => parseInt(a.useful, 10)).filter(Number.isFinite);
  const roles = {};
  answers.forEach((a) => { if (a.role) roles[a.role] = (roles[a.role] || 0) + 1; });
  const quotes = (k) => answers.map((a) => String(a[k] || '').trim()).filter(Boolean);
  return { count: answers.length, useful: useful.length ? round(useful.reduce((s, v) => s + v, 0) / useful.length, 1) : null, roles, wentWell: quotes('went_well'), improve: quotes('improve'), surprise: quotes('surprise') };
}

/* ---------- templates and scenario files ---------- */

/** A scenario reduced to its starting point (setup only), kept as a template. */
export function toTemplate(doc) {
  const t = clone(doc);
  const first = t.branches[0].turns[0];
  first.units = first.units.map(({ path, used, hours, plan, ...u }) => ({ ...u, from: [...u.lngLat] }));
  first.events = [];
  first.notes = '';
  first.fired = [];
  first.links = {};
  delete first.weather;
  t.branches = [{ id: 'main', name: 'Main line', parent: null, forkTurn: 0, turns: [first] }];
  t.template = true;
  delete t.hotwash;
  t.title = `${(doc.title || 'Scenario').replace(/ \(template\)$/, '')} (template)`;
  return t;
}
/** A new scenario from a template. */
export function fromTemplate(tpl, title) {
  const t = clone(tpl);
  delete t.template;
  t.title = title || (tpl.title || 'Scenario').replace(/ \(template\)$/, '');
  return t;
}

export const FILE_FORMAT = 'waymark-scenario';
/** A scenario as a file another Waymark server can import. */
export function packScenario(doc) {
  const scenario = clone(doc);
  delete scenario.hotwash; // links to hosted items on this server only
  return { format: FILE_FORMAT, version: 1, exported: new Date().toISOString(), scenario };
}
/** The scenario inside a file, checked. Throws an error that can be shown to the person importing. */
export function unpackScenario(json) {
  let data = json;
  if (typeof json === 'string') { try { data = JSON.parse(json); } catch { throw new Error('That file isn\'t a Waymark scenario (it isn\'t JSON).'); } }
  const s = data?.format === FILE_FORMAT ? data.scenario : data?.branches ? data : null;
  if (!s || typeof s !== 'object') throw new Error('That file isn\'t a Waymark scenario.');
  if (!Array.isArray(s.sides) || !s.sides.length) throw new Error('The scenario in that file has no sides.');
  if (!Array.isArray(s.branches) || !s.branches.length || s.branches.some((b) => !Array.isArray(b?.turns) || !b.turns.length)) throw new Error('The scenario in that file has no turns.');
  for (const b of s.branches) for (const t of b.turns) {
    if (!Array.isArray(t.units)) throw new Error('A turn in that file has no units list.');
    for (const u of t.units) if (!Array.isArray(u.lngLat) || u.lngLat.length !== 2 || !u.lngLat.every(Number.isFinite)) throw new Error(`The unit "${u.name || '?'}" in that file has no position.`);
    t.events ||= []; t.fired ||= []; t.notes ||= '';
  }
  s.injects ||= [];
  delete s.hotwash;
  return s;
}

/* ---------- ghost branch diff, Monte Carlo COA & synchronization matrix ---------- */

/**
 * Compares two branches at a specific turn index (clamped to each branch's length).
 * Returns per-unit position/strength deltas, side-level deltas, and GeoJSON features
 * for rendering Branch B as a ghost overlay with displacement vectors over Branch A.
 */
export function branchDiff(doc, aId, bId, turnIndex = null) {
  const ba = branchOf(doc, aId);
  const bb = branchOf(doc, bId);
  const nA = turnIndex == null ? ba.turns.length - 1 : Math.max(0, Math.min(ba.turns.length - 1, turnIndex));
  const nB = turnIndex == null ? bb.turns.length - 1 : Math.max(0, Math.min(bb.turns.length - 1, turnIndex));
  const ta = ba.turns[nA];
  const tb = bb.turns[nB];
  const byA = new Map(ta.units.map((u) => [u.id, u]));
  const byB = new Map(tb.units.map((u) => [u.id, u]));
  const ids = [...new Set([...byA.keys(), ...byB.keys()])];

  const units = [];
  const features = [];
  let movedCount = 0;
  let totalDispKm = 0;

  for (const id of ids) {
    const ua = byA.get(id);
    const ub = byB.get(id);
    const side = sideOf(doc, (ub || ua).side);
    const dispKm = ua && ub ? round(distanceKm(ua.lngLat, ub.lngLat), 2) : null;
    const strengthDelta = ua && ub ? Math.round((Number(ub.strength) || 0) - (Number(ua.strength) || 0)) : null;
    const statusChanged = !!(ua && ub && ua.status !== ub.status);
    if (dispKm != null && dispKm > 0.05) { movedCount++; totalDispKm += dispKm; }

    units.push({
      id,
      name: (ub || ua).name,
      side: side.id,
      inA: !!ua,
      inB: !!ub,
      dispKm,
      strengthA: ua ? ua.strength : null,
      strengthB: ub ? ub.strength : null,
      strengthDelta,
      statusA: ua?.status || null,
      statusB: ub?.status || null,
      statusChanged,
    });

    if (ub) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: ub.lngLat },
        properties: {
          kind: 'ghost-unit',
          id: ub.id,
          name: `${ub.name} (${bb.name})`,
          color: side.color,
          strength: ub.strength,
          status: ub.status,
          branch: bb.name,
        },
      });
      if (ua && dispKm > 0.05) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [ua.lngLat, ub.lngLat] },
          properties: {
            kind: 'ghost-delta',
            id: ub.id,
            name: `${ub.name}: ${dispKm} km`,
            color: side.color,
            width: 1.8,
            opacity: 0.75,
          },
        });
      }
    }
  }

  const sumA = new Map(sideSummary(doc, ta).map((s) => [s.id, s]));
  const sumB = new Map(sideSummary(doc, tb).map((s) => [s.id, s]));
  const sides = doc.sides.map((s) => {
    const a = sumA.get(s.id);
    const b = sumB.get(s.id);
    if (!a && !b) return null;
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      activeA: a?.active ?? 0,
      activeB: b?.active ?? 0,
      activeDelta: (b?.active ?? 0) - (a?.active ?? 0),
      strengthA: a?.strength ?? 0,
      strengthB: b?.strength ?? 0,
      strengthDelta: (b?.strength ?? 0) - (a?.strength ?? 0),
    };
  }).filter(Boolean);

  return {
    branchA: { id: ba.id, name: ba.name, turn: nA, label: turnLabel(doc, nA) },
    branchB: { id: bb.id, name: bb.name, turn: nB, label: turnLabel(doc, nB) },
    movedCount,
    avgDispKm: movedCount ? round(totalDispKm / movedCount, 2) : 0,
    units,
    sides,
    features,
  };
}

/**
 * Runs a Monte Carlo COA simulation (default 1,000 trials) over a combat odds column
 * (with starting attacker/defender strengths) using the scenario's CRT.
 */
export function monteCarloCombat(doc, { column, attackerStrength = 100, defenderStrength = 100, trials = 1000, random = Math.random } = {}) {
  const crt = crtOf(doc);
  const colIdx = crt.columns.indexOf(column);
  if (colIdx < 0) return null;
  const n = Math.max(10, Math.min(20000, Math.round(trials)));
  const a0 = Math.max(0, Math.min(100, Number(attackerStrength) || 0));
  const d0 = Math.max(0, Math.min(100, Number(defenderStrength) || 0));

  const aRem = new Float64Array(n);
  const dRem = new Float64Array(n);
  const counts = new Map();
  let aFall = 0; let dFall = 0; let aOut = 0; let dOut = 0;

  for (let i = 0; i < n; i++) {
    const roll = Math.floor(random() * 6);
    const code = (crt.rows[roll]?.[colIdx] || '').trim();
    const fx = parseResult(code);
    const aAfter = Math.max(0, a0 - fx.a);
    const dAfter = Math.max(0, d0 - fx.d);
    aRem[i] = aAfter;
    dRem[i] = dAfter;
    if (fx.ar) aFall++;
    if (fx.dr) dFall++;
    if (aAfter <= 0) aOut++;
    if (dAfter <= 0) dOut++;
    const label = code || 'No effect';
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  const stats = (arr) => {
    const sorted = [...arr].sort((x, y) => x - y);
    const mean = sorted.reduce((s, v) => s + v, 0) / n;
    return {
      mean: round(mean, 1),
      p10: round(sorted[Math.floor(n * 0.1)], 1),
      p50: round(sorted[Math.floor(n * 0.5)], 1),
      p90: round(sorted[Math.min(n - 1, Math.floor(n * 0.9))], 1),
    };
  };

  return {
    column,
    trials: n,
    attacker: { ...stats(aRem), fallbackPct: round((aFall / n) * 100, 1), destroyedPct: round((aOut / n) * 100, 1) },
    defender: { ...stats(dRem), fallbackPct: round((dFall / n) * 100, 1), destroyedPct: round((dOut / n) * 100, 1) },
    outcomes: [...counts.entries()].map(([result, count]) => ({ result, count, pct: round((count / n) * 100, 1) })).sort((a, b) => b.count - a.count),
  };
}

export const SYNCH_FUNCTIONS = [
  ['maneuver', 'Maneuver & movement'],
  ['fires', 'Fires & combat'],
  ['isr', 'ISR & contacts'],
  ['logistics', 'Logistics & supply'],
  ['c2', 'C2, EW & injects'],
  ['conditions', 'Weather & schedule'],
];

/**
 * Builds a military Synchronization Matrix (Warfighting Functions × Turns) from a branch's
 * played events plus scheduled reinforcements, withdrawals, weather changes, and injects.
 */
export function synchMatrix(doc, branchId) {
  const b = branchOf(doc, branchId);
  const played = b.turns.length - 1;
  const scheduledMax = Math.max(
    played,
    ...(doc.schedule || []).map((s) => Number(s.turn) || 0),
    ...(doc.injects || []).map((x) => Number(x.turn) || 0),
  );
  const totalTurns = Math.min(40, Math.max(played, scheduledMax));
  const turns = Array.from({ length: totalTurns + 1 }, (_, n) => ({ n, label: turnLabel(doc, n), future: n > played }));
  const rows = SYNCH_FUNCTIONS.map(([key, label]) => ({ key, label, cells: turns.map(() => []) }));
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.cells]));

  for (let n = 0; n <= played; n++) {
    const t = b.turns[n];
    for (const ev of t.events || []) {
      if (ev.type === 'move' || ev.type === 'add' || ev.type === 'remove') {
        if (n > 0 || ev.type === 'move') byKey.maneuver[n].push(ev.text);
      } else if (ev.type === 'combat' || ev.type === 'roll' || ev.type === 'matrix') {
        byKey.fires[n].push(ev.text);
      } else if (ev.type === 'contact') {
        byKey.isr[n].push(ev.text);
      } else if (ev.type === 'supply' || ev.type === 'link') {
        byKey.logistics[n].push(ev.text);
      } else if (ev.type === 'command' || ev.type === 'inject') {
        byKey.c2[n].push(ev.text);
      } else if (ev.type === 'arrive' || ev.type === 'withdraw' || ev.type === 'weather') {
        byKey.conditions[n].push(ev.text);
      }
    }
    if (n === 0 && t.units.length) byKey.maneuver[0].push(`${t.units.length} units deployed`);
  }

  // Future scheduled items
  for (const s of doc.schedule || []) {
    const n = Number(s.turn);
    if (n > played && n <= totalTurns) {
      const txt = s.type === 'arrive' ? `[Sched] ${s.unit?.name || 'Unit'} arrives`
        : s.type === 'withdraw' ? `[Sched] ${s.name || 'Unit'} withdraws`
          : `[Sched] Weather: ${WEATHER[s.weather]?.label || s.weather}`;
      byKey.conditions[n].push(txt);
    }
  }
  for (const x of doc.injects || []) {
    const n = Number(x.turn);
    if (n > played && n <= totalTurns) byKey.c2[n].push(`[Sched] Inject: ${x.title || 'Inject'}`);
  }

  return { branch: b.name, played, turns, rows };
}

/** Exports a Synchronization Matrix to RFC-4180 CSV. */
export function synchMatrixCsv(matrix) {
  const escCsv = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const head = ['Warfighting Function', ...matrix.turns.map((t) => t.label)].map(escCsv).join(',');
  const body = matrix.rows.map((r) => [r.label, ...r.cells.map((c) => c.join(' | '))].map(escCsv).join(','));
  return [head, ...body].join('\n');
}
