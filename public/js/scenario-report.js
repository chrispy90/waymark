// Scenario helpers for running and reviewing a game: outcome tables and matrix arguments with their exact chances,
// the chances of each combat result, the game's timeline, numbers over turns for charts, heat map points, the hotwash
// questionnaire, templates, and scenario files. No DOM here, so it can be tested in Node.
//
// Document additions:
//   tables:  [{ id, name, die: 'd6' | '2d6' | 'd10' | 'd20' | 'd100', rows: [{ min, max, result }], modifiers: [{ label, value }] }]
//   hotwash: { layer: "<hosted layer id>", form: "<form id>" }
//   template: true                       (a scenario kept as a starting point for new ones)
import { sideSummary, turnLabel, branchOf, distanceKm } from './scenario-core.js';
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
