// Scenarios: units on a map, played turn by turn in a meeting, with branches for "what if we had…" alternatives.
// This file is the game's rules and data handling. No DOM here, so it can be tested in Node; scenario.js draws it.
//
// A scenario document:
// {
//   title, summary, map: "<saved map id>" | null, view: { center, zoom, bearing, pitch, basemap },
//   sides: [{ id, name, color, affiliation: 'F' | 'H' | 'N' | 'U' }],
//   clock: { mode: 'turns' | 'elapsed' | 'time', stepMinutes, start: "2026-06-01T06:00" },
//   injects: [{ id, title, text, turn: 3 | null, lngLat?: [x, y] }],
//   branches: [{ id, name, parent: "<branch id>" | null, forkTurn, turns: [Turn] }]
// }
// Turn: { units: [Unit], events: [Event], notes, fired: ["<inject id>"], links: { "<link or node id>": status }, graphics: [Graphic] }
//   (a full snapshot, so any turn can be shown or branched from)
// Unit: { id, name, side, kind, echelon, strength 0–100, status, rangeKm, speedKmh, spotted, notes, lngLat, from,
//         mobility?, sensorKm?, power?, parent?, supply?, used?, path?, hours?, plan? }
//   `from` is where the unit stood when the turn began, so the turn's move can be drawn and measured.
// Terrain, lines of communication, objectives, combat and the other optional rules are in scenario-rules.js.

const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const clone = (x) => JSON.parse(JSON.stringify(x));
const lower = (label) => (/^(Setup|Turn )/.test(label) ? label.toLowerCase() : label); // "after turn 3", but "after H+01:30"
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const DEFAULT_SIDES = [
  { id: 'blue', name: 'Blue', color: '#2563eb', affiliation: 'F' },
  { id: 'red', name: 'Red', color: '#dc2626', affiliation: 'H' },
  { id: 'neutral', name: 'Neutral', color: '#16a34a', affiliation: 'N' },
];

// Kinds of unit. Military kinds carry the function part of a MIL-STD-2525C / APP-6 symbol code; the rest are plain badges.
export const KINDS = {
  infantry: { label: 'Infantry', group: 'Land', dim: 'G', fn: 'UCI---' },
  mech: { label: 'Mechanized infantry', group: 'Land', dim: 'G', fn: 'UCIZ--' },
  armor: { label: 'Armor', group: 'Land', dim: 'G', fn: 'UCA---' },
  artillery: { label: 'Artillery', group: 'Land', dim: 'G', fn: 'UCF---' },
  recon: { label: 'Reconnaissance', group: 'Land', dim: 'G', fn: 'UCR---' },
  engineer: { label: 'Engineers', group: 'Land', dim: 'G', fn: 'UCE---' },
  airdefense: { label: 'Air defense', group: 'Land', dim: 'G', fn: 'UCD---' },
  aviation: { label: 'Army aviation', group: 'Land', dim: 'G', fn: 'UCVR--' },
  signal: { label: 'Signals', group: 'Land', dim: 'G', fn: 'UUS---' },
  supply: { label: 'Supply', group: 'Land', dim: 'G', fn: 'USS---' },
  medical: { label: 'Medical', group: 'Land', dim: 'G', fn: 'USM---' },
  hq: { label: 'Headquarters', group: 'Land', dim: 'G', fn: 'UH----' },
  aircraft: { label: 'Aircraft', group: 'Air and sea', dim: 'A', fn: 'MF----' },
  helicopter: { label: 'Helicopter', group: 'Air and sea', dim: 'A', fn: 'MH----' },
  ship: { label: 'Warship', group: 'Air and sea', dim: 'S', fn: 'CL----' },
  submarine: { label: 'Submarine', group: 'Air and sea', dim: 'U', fn: 'S-----' },
  police: { label: 'Police', group: 'Civil', badge: 'PD' },
  fire: { label: 'Fire and rescue', group: 'Civil', badge: 'FD' },
  ems: { label: 'Ambulance', group: 'Civil', badge: 'EMS' },
  command: { label: 'Command post', group: 'Civil', badge: 'CP' },
  shelter: { label: 'Shelter', group: 'Civil', badge: 'SH' },
  team: { label: 'Team', group: 'Civil', badge: 'TM' },
  vehicle: { label: 'Vehicle', group: 'Civil', badge: 'VH' },
  civilians: { label: 'Civilians', group: 'Civil', badge: 'CIV' },
  hazard: { label: 'Hazard', group: 'Civil', badge: '!' },
  other: { label: 'Other', group: 'Civil', badge: '•' },
};
export const ECHELONS = [['', 'No size'], ['A', 'Team'], ['B', 'Squad'], ['D', 'Platoon'], ['E', 'Company'], ['F', 'Battalion'], ['H', 'Brigade'], ['I', 'Division']];
export const STATUSES = [['ready', 'Ready'], ['engaged', 'Engaged'], ['degraded', 'Degraded'], ['destroyed', 'Out of action']];
export const statusLabel = (s) => (STATUSES.find((x) => x[0] === s) || STATUSES[0])[1];

/** The 15-character symbol code for a military unit, or null for a civil badge. */
export function sidcOf(unit, side) {
  const k = KINDS[unit.kind];
  if (!k?.fn) return null;
  return `S${side?.affiliation || 'U'}${k.dim}P${k.fn}-${unit.echelon || '-'}---`.slice(0, 15);
}

/* ---------- geometry ---------- */

const R_KM = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
export function distanceKm(a, b) {
  const [dLat, dLng] = [rad(b[1] - a[1]), rad(b[0] - a[0])];
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** A ring of [lng, lat] points `km` from a center, for range rings. */
export function circle(center, km, steps = 72) {
  const [lng, lat] = [rad(center[0]), rad(center[1])];
  const d = km / R_KM;
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const b = (i / steps) * 2 * Math.PI;
    const lat2 = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(b));
    const lng2 = lng + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(lat2));
    ring.push([round((lng2 * 180) / Math.PI, 6), round((lat2 * 180) / Math.PI, 6)]);
  }
  return ring;
}

/* ---------- documents ---------- */

const newTurn = () => ({ units: [], events: [], notes: '', fired: [] });

export function newScenario({ title = 'Untitled scenario', map = null, view } = {}) {
  return {
    title, summary: '', map,
    view: { center: [-98.5, 39.5], zoom: 3.5, bearing: 0, pitch: 0, basemap: 'light', ...(view || {}) },
    sides: clone(DEFAULT_SIDES),
    clock: { mode: 'turns', stepMinutes: 60, start: '' },
    injects: [],
    branches: [{ id: 'main', name: 'Main line', parent: null, forkTurn: 0, turns: [newTurn()] }],
  };
}

export const branchOf = (doc, id) => doc.branches.find((b) => b.id === id) || doc.branches[0];
export const turnOf = (doc, branchId, n) => { const b = branchOf(doc, branchId); return b.turns[Math.max(0, Math.min(b.turns.length - 1, n))]; };
export const sideOf = (doc, id) => doc.sides.find((s) => s.id === id) || doc.sides[0];
export const lastTurn = (doc, branchId) => branchOf(doc, branchId).turns.length - 1;

/** What a turn is called: "Setup", "Turn 3", "H+06:00" or a date and time, depending on the clock. */
export function turnLabel(doc, n) {
  const c = doc.clock || {};
  if (n === 0 && c.mode !== 'time') return 'Setup';
  const mins = n * (Number(c.stepMinutes) || 60);
  if (c.mode === 'elapsed') return `H+${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.round(mins % 60)).padStart(2, '0')}`;
  if (c.mode === 'time' && c.start && !Number.isNaN(Date.parse(c.start))) {
    return new Date(Date.parse(c.start) + mins * 60000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  return n === 0 ? 'Setup' : `Turn ${n}`;
}

/** How far a unit may move in one turn, from its speed and the clock; null when either isn't set. */
export function moveAllowanceKm(doc, unit) {
  const step = Number(doc.clock?.stepMinutes) || 0;
  const speed = Number(unit.speedKmh) || 0;
  return step > 0 && speed > 0 ? round((speed * step) / 60, 1) : null;
}

/* ---------- units ---------- */

export function addUnit(doc, turn, props = {}) {
  const side = sideOf(doc, props.side);
  const kind = KINDS[props.kind] ? props.kind : 'infantry';
  const n = turn.units.filter((u) => u.side === side.id && u.kind === kind).length + 1;
  const unit = {
    id: uid('u'), name: `${side.name} ${KINDS[kind].label} ${n}`, side: side.id, kind, echelon: '', strength: 100, status: 'ready',
    rangeKm: 0, speedKmh: 0, spotted: false, notes: '', ...props, kind, side: side.id,
  };
  unit.lngLat = [round(unit.lngLat[0], 6), round(unit.lngLat[1], 6)];
  unit.from = [...unit.lngLat];
  turn.units.push(unit);
  turn.events.push({ type: 'add', unit: unit.id, text: `${unit.name} placed` });
  return unit;
}

export function removeUnit(turn, id) {
  const i = turn.units.findIndex((u) => u.id === id);
  if (i < 0) return null;
  const [unit] = turn.units.splice(i, 1);
  turn.events = turn.events.filter((e) => e.unit !== id);
  turn.events.push({ type: 'remove', text: `${unit.name} removed` });
  return unit;
}

/**
 * Moves a unit within a turn. The turn keeps one move per unit (the latest), measured from where the unit started the
 * turn. Returns { km, allowance, overBy } so the screen can warn when the move is longer than the unit's speed allows.
 */
export function moveUnit(doc, turn, id, lngLat, route) {
  const unit = turn.units.find((u) => u.id === id);
  if (!unit) return null;
  unit.lngLat = [round(lngLat[0], 6), round(lngLat[1], 6)];
  turn.events = turn.events.filter((e) => !(e.type === 'move' && e.unit === id));
  // With terrain, a move follows the route it was given: its length, the hours it takes and the supply it uses.
  if (route?.path?.length > 1) {
    unit.path = route.path.map((p) => [round(p[0], 5), round(p[1], 5)]);
    unit.path[0] = [...(unit.from || unit.lngLat)];
    unit.path[unit.path.length - 1] = [...unit.lngLat];
    unit.used = round(route.cost || 0, 1);
    unit.hours = round(route.hours || 0, 2);
  } else { delete unit.path; delete unit.hours; unit.used = 0; }
  const km = unit.path ? round(route.km, 2) : round(distanceKm(unit.from || unit.lngLat, unit.lngLat), 2);
  if (km > 0.005) {
    const dist = `${km < 10 ? km : Math.round(km)} km`;
    turn.events.push({ type: 'move', unit: id, km, text: unit.path ? `${unit.name} moved ${dist} in ${hoursLabel(unit.hours)}${unit.used ? `, using ${Math.round(unit.used)}% of its supply` : ''}` : `${unit.name} moved ${dist}` });
  }
  if (unit.path) {
    const limit = (Number(doc.clock?.stepMinutes) || 60) / 60;
    return { km, hours: unit.hours, allowanceHours: limit, overHours: unit.hours > limit + 1e-6 ? round(unit.hours - limit, 2) : 0, cost: unit.used };
  }
  const allowance = moveAllowanceKm(doc, unit);
  return { km, allowance, overBy: allowance != null && km > allowance ? round(km - allowance, 1) : 0 };
}

/** "45 min", "2 h 30 min". */
export function hoursLabel(h) {
  const mins = Math.round((Number(h) || 0) * 60);
  if (mins < 60) return `${mins} min`;
  return mins % 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins / 60} h`;
}

/** Changes a unit's fields; changes to status and strength are written to the turn's log. */
export function updateUnit(turn, id, patch) {
  const unit = turn.units.find((u) => u.id === id);
  if (!unit) return null;
  if (patch.status && patch.status !== unit.status) {
    turn.events = turn.events.filter((e) => !(e.type === 'status' && e.unit === id));
    turn.events.push({ type: 'status', unit: id, text: `${patch.name || unit.name} is now ${statusLabel(patch.status).toLowerCase()}` });
  }
  if (patch.strength != null && Number(patch.strength) !== Number(unit.strength)) {
    turn.events = turn.events.filter((e) => !(e.type === 'strength' && e.unit === id));
    turn.events.push({ type: 'strength', unit: id, text: `${patch.name || unit.name} at ${Math.round(patch.strength)}% strength` });
  }
  Object.assign(unit, patch);
  if (patch.strength != null) unit.strength = Math.max(0, Math.min(100, Math.round(Number(patch.strength) || 0)));
  return unit;
}

export const logEvent = (turn, event) => { turn.events.push(event); return event; };

/* ---------- turns and branches ---------- */

/** Fires an inject on a turn (once). Returns the inject, or null if it had already fired. */
export function fireInject(doc, turn, injectId) {
  const inject = (doc.injects || []).find((x) => x.id === injectId);
  if (!inject || turn.fired.includes(injectId)) return null;
  turn.fired.push(injectId);
  turn.events.push({ type: 'inject', inject: injectId, text: `Inject: ${inject.title || 'Untitled'}` });
  // An inject can change lines of communication: "the rail bridge is down" cuts that link from now on.
  for (const e of inject.effects || []) {
    if (!e?.target || !e.status) continue;
    turn.links = { ...(turn.links || {}), [e.target]: e.status };
    const item = [...(doc.network?.links || []), ...(doc.network?.nodes || [])].find((x) => x.id === e.target);
    if (item) turn.events.push({ type: 'link', link: item.id, text: `${item.name || 'A line'} ${{ open: 'is open again', degraded: 'is degraded', cut: item.lngLat ? 'is lost' : 'is cut' }[e.status] || e.status}` });
  }
  return inject;
}

/**
 * Starts the next turn of a branch: every unit carries over (its position becomes where it starts the new turn), the
 * log and notes start empty, and injects scheduled for the new turn fire. Returns { index, injects }.
 */
export function nextTurn(doc, branchId) {
  const branch = branchOf(doc, branchId);
  const prev = branch.turns.at(-1);
  const turn = { units: clone(prev.units).map((u) => ({ ...u, from: [...u.lngLat] })), events: [], notes: '', fired: [...prev.fired],
    links: { ...(prev.links || {}) }, graphics: clone(prev.graphics || []) };
  branch.turns.push(turn);
  const index = branch.turns.length - 1;
  const injects = (doc.injects || []).filter((x) => Number(x.turn) === index).map((x) => fireInject(doc, turn, x.id)).filter(Boolean);
  return { index, injects };
}

/** A new branch that shares history up to and including `turnIndex`, to play out an alternative from there. */
export function branchFrom(doc, branchId, turnIndex, name) {
  const from = branchOf(doc, branchId);
  const at = Math.max(0, Math.min(from.turns.length - 1, turnIndex));
  const branch = { id: uid('b'), name: (name || '').trim() || `Alternative ${doc.branches.length}`, parent: from.id, forkTurn: at, turns: clone(from.turns.slice(0, at + 1)) };
  doc.branches.push(branch);
  return branch;
}

export function deleteBranch(doc, branchId) {
  if (doc.branches.length < 2) return false;
  const i = doc.branches.findIndex((b) => b.id === branchId);
  if (i < 0) return false;
  doc.branches.splice(i, 1);
  doc.branches.forEach((b) => { if (b.parent === branchId) b.parent = null; }); // branches made from it keep their own copy of the history
  return true;
}

/** Drops every turn after `turnIndex`, to replay a branch from there. */
export function rewind(doc, branchId, turnIndex) {
  const branch = branchOf(doc, branchId);
  branch.turns.length = Math.max(1, Math.min(branch.turns.length, turnIndex + 1));
  return branch;
}

/* ---------- summaries ---------- */

/** Per side: how many units, how many still in action, and their combined strength. */
export function sideSummary(doc, turn) {
  return doc.sides.map((side) => {
    const units = turn.units.filter((u) => u.side === side.id);
    const active = units.filter((u) => u.status !== 'destroyed');
    return { id: side.id, name: side.name, color: side.color, units: units.length, active: active.length, lost: units.length - active.length,
      strength: units.length ? Math.round(active.reduce((s, u) => s + (Number(u.strength) || 0), 0) / units.length) : 0 };
  }).filter((s) => s.units);
}

/** Two branches side by side, at their last turns. */
export function compareBranches(doc, aId, bId) {
  const [a, b] = [branchOf(doc, aId), branchOf(doc, bId)];
  const of = (branch) => ({ id: branch.id, name: branch.name, turns: branch.turns.length - 1, label: turnLabel(doc, branch.turns.length - 1), sides: sideSummary(doc, branch.turns.at(-1)) });
  return { a: of(a), b: of(b) };
}

/** Every logged event of a branch, in order, with the turn it happened on. */
export const branchLog = (doc, branchId) => branchOf(doc, branchId).turns.flatMap((t, n) => t.events.map((e) => ({ ...e, turn: n, label: turnLabel(doc, n) })));

/* ---------- after-action story ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A view that shows every unit of a turn: the middle of their bounding box, zoomed so they all fit.
function viewFor(doc, units) {
  const base = { bearing: 0, pitch: 0, basemap: doc.view?.basemap || 'light', markers: [] };
  if (!units.length) return { ...base, center: doc.view?.center || [0, 20], zoom: doc.view?.zoom ?? 2 };
  const xs = units.flatMap((u) => [u.lngLat[0], (u.from || u.lngLat)[0]]);
  const ys = units.flatMap((u) => [u.lngLat[1], (u.from || u.lngLat)[1]]);
  const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(e - w, (n - s) * 1.6, 0.02);
  return { ...base, center: [round((w + e) / 2, 5), round((s + n) / 2, 5)], zoom: round(Math.max(1, Math.min(14, Math.log2(360 / span) - 1)), 2) };
}

// One turn as a map layer: a point per unit (colored by side, gray when out of action), a dashed arrow for each move.
function turnLayer(doc, branch, n, id, decorate) {
  const turn = branch.turns[n];
  const features = decorate ? decorate(branch, n) || [] : [];
  for (const u of turn.units) {
    const side = sideOf(doc, u.side);
    const out = u.status === 'destroyed';
    if (u.from && distanceKm(u.from, u.lngLat) > 0.005) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: u.path?.length > 1 ? u.path : [u.from, u.lngLat] }, properties: { stroke: side.color, 'stroke-width': 2.5, 'stroke-dash': 'dashed', arrow: true } });
    }
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: u.lngLat },
      properties: { name: u.name, side: side.name, kind: KINDS[u.kind]?.label || 'Unit', status: statusLabel(u.status), strength: `${u.strength}%`, 'marker-color': out ? '#9ca3af' : side.color, 'marker-size': 'large' } });
  }
  for (const x of (doc.injects || []).filter((i) => turn.fired.includes(i.id) && Array.isArray(i.lngLat))) {
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: x.lngLat }, properties: { name: x.title || 'Inject', text: `⚠ ${x.title || 'Inject'}`, 'text-size': 15, stroke: '#b45309' } });
  }
  return { id, name: `${branch.name}: ${turnLabel(doc, n)}`, data: { type: 'FeatureCollection', features }, drawn: true,
    style: { color: '#64748b', label: 'name', radius: 7 }, popup: { title: '{name}', fields: ['side', 'kind', 'status', 'strength'] } };
}

/**
 * A story that replays the scenario: a moving map with one card per turn (what happened, and the notes taken), a
 * chapter per branch when there are several, and a summary of how each branch ended.
 */
export function storyFromScenario(doc, { branches, decorate } = {}) {
  const chosen = (branches?.length ? branches.map((id) => branchOf(doc, id)) : doc.branches).filter((b, i, all) => all.indexOf(b) === i);
  const layers = [];
  const blocks = [{ type: 'text', style: 'large', html: `<p>${esc(doc.summary || 'What we set out to test, and who took part.')}</p>` }];
  const several = chosen.length > 1;
  chosen.forEach((branch, bi) => {
    if (several) {
      const parent = branch.parent ? branchOf(doc, branch.parent) : null;
      blocks.push({ type: 'chapter', kicker: bi === 0 ? 'The game' : 'What if', title: branch.name,
        text: parent && branch.parent !== branch.id ? `Branches from ${parent.name} after ${lower(turnLabel(doc, branch.forkTurn))}.` : '', bg: bi % 2 ? '#1f2937' : '#13233a', fg: '#f3efe6', align: 'center' });
    }
    // A branch replays from where it left its parent; the shared turns were already shown.
    const first = several && branch.parent && chosen.some((b) => b.id === branch.parent) ? Math.min(branch.forkTurn + 1, branch.turns.length - 1) : 0;
    const slides = [];
    for (let n = first; n < branch.turns.length; n++) {
      const turn = branch.turns[n];
      const id = `wg-${branch.id}-${n}`;
      layers.push(turnLayer(doc, branch, n, id, decorate));
      const events = turn.events.filter((e) => e.type !== 'add' || n > 0);
      const html = `<h3>${esc(turnLabel(doc, n))}</h3>${events.length ? `<ul>${events.map((e) => `<li>${esc(e.text)}</li>`).join('')}</ul>` : n === 0 ? `<p>${turn.units.length} units in their starting positions.</p>` : '<p>No moves this turn.</p>'}${turn.notes ? `<p>${esc(turn.notes)}</p>` : ''}`;
      slides.push({ html, media: { type: 'map', view: { ...viewFor(doc, turn.units), layers: [id], legend: false, ...(doc.map ? { map: doc.map } : {}) } } });
    }
    blocks.push({ type: 'scrollmap', layout: 'overlay', slides });
    const end = sideSummary(doc, branch.turns.at(-1));
    if (end.length) {
      blocks.push({ type: 'stats', items: end.slice(0, 4).map((s) => ({ value: `${s.active} of ${s.units}`, label: `${s.name} units still in action` })),
        caption: `${branch.name}, after ${lower(turnLabel(doc, branch.turns.length - 1))}` });
    }
  });
  if (several) {
    blocks.push({ type: 'text', html: `<h2>How the branches compare</h2><ul>${chosen.map((b) => `<li><strong>${esc(b.name)}</strong>: ${sideSummary(doc, b.turns.at(-1)).map((s) => `${esc(s.name)} ${s.active} of ${s.units} in action at ${s.strength}% strength`).join('; ') || 'no units'}</li>`).join('')}</ul>` });
  }
  blocks.push({ type: 'text', html: '<h2>What we learned</h2><p>Write the conclusions the group reached, and what to do next.</p>' });
  return { title: `${doc.title || 'Scenario'}: after-action review`, subtitle: doc.summary || '', theme: 'light', motion: 'subtle', cover: { image: '' }, layers, blocks };
}
