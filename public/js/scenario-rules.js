// Scenario rules beyond moving pieces: terrain that slows and wears down movement, lines of communication that keep
// units supplied and in contact, a combat results table, objectives and scoring, automatic spotting, planned moves,
// and importing units and injects from a spreadsheet. No DOM here, so it can all be tested in Node.
//
// Added to the scenario document (all optional):
//   terrain:  { origin: [lng, lat], size: km (hex center to corner), cols, rows, cover: "<one character per cell>",
//               elev: "<base64 Int16 per cell, metres>", built, note }
//   zones:    [{ id, name, coords: [[lng, lat]…], effect: 'slow' | 'block' | 'cost' | 'jam', factor, costMult,
//               mobility: ['tracked', …] | null, from: turn, until: turn | null, inject: "<inject id>" | null }]
//   movement: { tracked: { forest: 0.2, … }, … }   overrides of FACTORS
//   network:  { links: [{ id, name, type, side | null, coords, capacity }], nodes: [{ id, name, type, side, lngLat }] }
//   objectives: [{ id, name, lngLat, radiusKm, points, holder | null }]
//   victory:  { text, target, mode: 'held' | 'total' }
//   combat:   { columns: ['1:3', …], rows: [['A50 AR', …] × 6] }     a 1d6 combat results table
//   rules:    see DEFAULT_RULES
//   schedule: [{ id, type: 'arrive', turn, unit: { …unit fields }, lngLat } | { id, type: 'withdraw', turn, unitId, name }
//              | { id, type: 'weather', turn, weather }]
// Turn additions: links: { id: 'open' | 'degraded' | 'cut' }, graphics: [{ id, type, coords, side, label }], weather.
// Unit additions: fanDir, fanArc (degrees: a unit whose range and sensors only cover an arc).
import { KINDS, distanceKm, sideOf, branchOf, nextTurn, moveUnit, statusLabel, addUnit, removeUnit } from './scenario-core.js';
import { bearing } from './mgrs.js';
import { parseCsv } from './csv.js';

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const SQ3 = Math.sqrt(3);
const RAD = Math.PI / 180;

export const DEFAULT_RULES = {
  planning: false, // plan moves for each side, then reveal and move them all at once
  autoSpot: false, // units are seen when an opposing unit's sensor range and line of sight reach them
  auto: false, // apply supply effects automatically
  c2Delay: false, // units out of HQ radio contact or jammed execute move orders on the next turn
  lossPct: 10, // strength lost per turn out of supply (when auto)
  resupply: 50, // supply regained per turn in supply (half when strained)
  reachKm: 5, // how far from a line of communication a unit can still draw supply or use a signal link
  radioKm: 25, // radio range between a unit and its headquarters
  interdictKm: 2, // enemy units this close to a side's line cut it (0 = off)
};
export const rulesOf = (doc) => ({ ...DEFAULT_RULES, ...(doc.rules || {}) });

/* ---------- movement ---------- */

// How each kind of unit gets around. speed: typical top speed (km/h) when a unit has none of its own.
// rate: share of a full supply load (%) used per km on easy going.
export const MOBILITY = {
  foot: { label: 'On foot', speed: 5, rate: 0.5 },
  wheeled: { label: 'Wheeled', speed: 50, rate: 0.3 },
  tracked: { label: 'Tracked', speed: 35, rate: 0.8 },
  amphibious: { label: 'Amphibious', speed: 30, rate: 0.8 },
  air: { label: 'Air', speed: 250, rate: 0.1 },
  naval: { label: 'Naval', speed: 30, rate: 0.1 },
  fixed: { label: 'Doesn\'t move', speed: 0, rate: 0 },
};
const KIND_MOBILITY = {
  infantry: 'foot', mech: 'tracked', armor: 'tracked', artillery: 'tracked', recon: 'wheeled', engineer: 'tracked', airdefense: 'wheeled',
  aviation: 'air', signal: 'wheeled', supply: 'wheeled', medical: 'wheeled', hq: 'wheeled', aircraft: 'air', helicopter: 'air', ship: 'naval',
  submarine: 'naval', police: 'wheeled', fire: 'wheeled', ems: 'wheeled', command: 'wheeled', shelter: 'fixed', team: 'foot', vehicle: 'wheeled',
  civilians: 'foot', hazard: 'fixed', other: 'foot',
};
export const mobilityOf = (u) => (MOBILITY[u.mobility] ? u.mobility : KIND_MOBILITY[u.kind] || 'foot');
export const typicalSpeed = (u) => MOBILITY[mobilityOf(u)].speed;
export const speedOf = (u) => Number(u.speedKmh) || typicalSpeed(u);

// Ground cover in a terrain cell. Each cell also records the best road through it and whether a river crosses it.
export const COVER = [
  { key: 'open', label: 'Open ground', color: '#e9e4c9' },
  { key: 'forest', label: 'Forest', color: '#8fbc83' },
  { key: 'urban', label: 'Built-up', color: '#bdb2a7' },
  { key: 'water', label: 'Water', color: '#93bde3' },
  { key: 'marsh', label: 'Marsh', color: '#a5cbbb' },
];
export const TERRAIN_KEYS = ['road', 'minor', 'open', 'forest', 'urban', 'marsh', 'water', 'river'];
export const TERRAIN_LABELS = { road: 'Main road', minor: 'Minor road', open: 'Open ground', forest: 'Forest', urban: 'Built-up', marsh: 'Marsh', water: 'Water', river: 'River crossing' };
// Share of top speed on each kind of ground; 0 means it can't go there. A road through a cell wins over its cover,
// so a road across a river is a bridge.
export const FACTORS = {
  foot: { road: 1, minor: 1, open: 0.8, forest: 0.6, urban: 0.7, marsh: 0.35, water: 0, river: 0.15 },
  wheeled: { road: 1, minor: 0.7, open: 0.35, forest: 0.1, urban: 0.5, marsh: 0.05, water: 0, river: 0 },
  tracked: { road: 1, minor: 0.8, open: 0.65, forest: 0.3, urban: 0.4, marsh: 0.15, water: 0, river: 0.05 },
  amphibious: { road: 1, minor: 0.8, open: 0.65, forest: 0.3, urban: 0.4, marsh: 0.45, water: 0.25, river: 0.35 },
  air: { road: 1, minor: 1, open: 1, forest: 1, urban: 1, marsh: 1, water: 1, river: 1 },
  naval: { road: 0, minor: 0, open: 0, forest: 0, urban: 0, marsh: 0, water: 1, river: 0.6 },
  fixed: { road: 0, minor: 0, open: 0, forest: 0, urban: 0, marsh: 0, water: 0, river: 0 },
};
// The steepest grade (rise ÷ run) each can climb off-road; speed falls off toward it. Roads halve the grade.
const GRADE_LIMIT = { foot: 1, wheeled: 0.35, tracked: 0.6, amphibious: 0.6 };
export const factorsFor = (doc, m) => ({ ...FACTORS[m], ...(doc.movement?.[m] || {}) });

/* ---------- the terrain grid ---------- */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64V = new Int8Array(128).fill(0);
for (let i = 0; i < 64; i++) B64V[B64.charCodeAt(i)] = i;
export const packCell = (cover, road, river) => B64[(cover & 7) | ((road & 3) << 3) | ((river ? 1 : 0) << 5)];
const NO_ELEV = -32768;

export function encodeElevation(values) {
  const a = new Int16Array(values.length);
  values.forEach((v, i) => { a[i] = v == null || !Number.isFinite(v) ? NO_ELEV : clamp(Math.round(v), -32767, 32767); });
  const bytes = new Uint8Array(a.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function decodeElevation(str, n) {
  const out = new Int16Array(n).fill(NO_ELEV);
  if (!str) return out;
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  out.set(new Int16Array(bytes.buffer, 0, Math.min(n, bytes.length >> 1)));
  return out;
}

/** The size of a grid of hexes `cellKm` apart covering [west, south, east, north]. */
export function gridSize(bounds, cellKm) {
  const [w, s, e, n] = bounds;
  const lat0 = s;
  const kx = 111.32 * Math.cos(((s + n) / 2) * RAD);
  const size = cellKm / SQ3;
  const cols = Math.max(1, Math.ceil(((e - w) * kx) / cellKm) + 1);
  const rows = Math.max(1, Math.ceil(((n - lat0) * 110.574) / (1.5 * size)) + 1);
  return { origin: [w, lat0], size, cols, rows, cells: cols * rows, kx };
}

// Hex neighbors in axial coordinates, in the order of the edges they share (east, then counter-clockwise).
const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
const cache = new WeakMap();

/** The working form of a scenario's terrain grid (cached): cell lookups, centers, neighbors and outlines. */
export function terrainOf(grid) {
  if (!grid?.cols || !grid?.rows || typeof grid.cover !== 'string') return null;
  let T = cache.get(grid);
  if (T) return T;
  const { cols, rows } = grid;
  const s = grid.size;
  const [lng0, lat0] = grid.origin;
  const kx = grid.kx || 111.32 * Math.cos((lat0 + (rows * 1.5 * s) / 110.574 / 2) * RAD);
  const ky = 110.574;
  const n = cols * rows;
  const cover = new Uint8Array(n);
  for (let i = 0; i < n && i < grid.cover.length; i++) cover[i] = B64V[grid.cover.charCodeAt(i) & 127];
  const elev = decodeElevation(grid.elev, n);
  const xy = (i) => { const c = i % cols; const r = (i / cols) | 0; return [s * SQ3 * (c + 0.5 * (r & 1)), 1.5 * s * r]; };
  const toLL = ([x, y]) => [lng0 + x / kx, lat0 + y / ky];
  T = {
    grid, n, cols, rows, s, kx, ky, cover, elev, step: s * SQ3,
    xy, toLL,
    center: (i) => toLL(xy(i)),
    cellAt([lng, lat]) {
      const x = (lng - lng0) * kx;
      const y = (lat - lat0) * ky;
      let q = ((SQ3 / 3) * x - y / 3) / s;
      let r = ((2 / 3) * y) / s;
      let z = -q - r;
      let [rq, rr, rz] = [Math.round(q), Math.round(r), Math.round(z)];
      const [dq, dr, dz] = [Math.abs(rq - q), Math.abs(rr - r), Math.abs(rz - z)];
      if (dq > dr && dq > dz) rq = -rr - rz; else if (dr > dz) rr = -rq - rz;
      if (rr < 0 || rr >= rows) return -1;
      const col = rq + (rr - (rr & 1)) / 2;
      if (col < 0 || col >= cols) return -1;
      return rr * cols + col;
    },
    neighbor(i, k) {
      const c = i % cols;
      const r = (i / cols) | 0;
      const q = c - (r - (r & 1)) / 2;
      const nq = q + DIRS[k][0];
      const nr = r + DIRS[k][1];
      if (nr < 0 || nr >= rows) return -1;
      const nc = nq + (nr - (nr & 1)) / 2;
      return nc < 0 || nc >= cols ? -1 : nr * cols + nc;
    },
    corner(i, k) { const [x, y] = xy(i); const a = (60 * k - 30) * RAD; return toLL([x + s * Math.cos(a), y + s * Math.sin(a)]); },
    ring(i) { const pts = [0, 1, 2, 3, 4, 5].map((k) => T.corner(i, k)); pts.push(pts[0]); return pts; },
    coverOf: (i) => cover[i] & 7,
    roadOf: (i) => (cover[i] >> 3) & 3,
    riverOf: (i) => (cover[i] >> 5) & 1,
    elevOf: (i) => (elev[i] === NO_ELEV ? null : elev[i]),
    bounds() { const a = toLL([-s, -s]); const b = toLL([s * SQ3 * (cols + 0.5) + s, 1.5 * s * rows + s]); return [a[0], a[1], b[0], b[1]]; },
  };
  cache.set(grid, T);
  return T;
}

/** Counts of each kind of ground, roads and rivers, for the terrain summary. */
export function terrainStats(T) {
  const cover = COVER.map(() => 0);
  let road = 0; let minor = 0; let river = 0;
  for (let i = 0; i < T.n; i++) {
    cover[T.coverOf(i)]++;
    const rd = T.roadOf(i);
    if (rd === 2) road++; else if (rd === 1) minor++;
    if (T.riverOf(i)) river++;
  }
  return { cells: T.n, cover: COVER.map((c, i) => ({ ...c, cells: cover[i], pct: round((100 * cover[i]) / T.n, 1) })), road, minor, river };
}

/* ---------- geometry helpers ---------- */

export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Distance (km) from a point to a segment, on a local flat projection (fine at game scales). */
export function pointSegmentKm(p, a, b) {
  const kx = 111.32 * Math.cos(p[1] * RAD);
  const ky = 110.574;
  const [ax, ay] = [(a[0] - p[0]) * kx, (a[1] - p[1]) * ky];
  const [bx, by] = [(b[0] - p[0]) * kx, (b[1] - p[1]) * ky];
  const [dx, dy] = [bx - ax, by - ay];
  const len = dx * dx + dy * dy;
  const t = len ? clamp(-(ax * dx + ay * dy) / len, 0, 1) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
const lineKm = (coords) => coords.slice(1).reduce((sum, p, i) => sum + distanceKm(coords[i], p), 0);
/** The point halfway along a line, and the bearing there (for labels and markers). */
export function midpoint(coords) {
  const total = lineKm(coords);
  let run = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = distanceKm(coords[i - 1], coords[i]);
    if (run + d >= total / 2 && d > 0) {
      const t = (total / 2 - run) / d;
      return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t];
    }
    run += d;
  }
  return coords[0];
}
/** A filled arrowhead polygon at the end of a line, sized in km. */
export function arrowHead(coords, km = 0.6) {
  if (coords.length < 2) return null;
  const b = coords[coords.length - 1];
  const a = coords[coords.length - 2];
  const kx = 111.32 * Math.cos(b[1] * RAD);
  const ky = 110.574;
  const [dx, dy] = [(b[0] - a[0]) * kx, (b[1] - a[1]) * ky];
  const len = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / len, dy / len];
  const size = Math.min(km, len * 0.6);
  const back = [b[0] - (ux * size) / kx, b[1] - (uy * size) / ky];
  const w = size * 0.6;
  return [[b[0], b[1]], [back[0] + (-uy * w) / kx, back[1] + (ux * w) / ky], [back[0] - (-uy * w) / kx, back[1] - (ux * w) / ky], [b[0], b[1]]];
}

/* ---------- weather and daylight ---------- */

// offroad and road: share of speed kept; sensor: share of sensor range kept; air: whether aircraft can fly.
export const WEATHER = {
  clear: { label: 'Clear', icon: '☀', offroad: 1, road: 1, sensor: 1, air: true },
  rain: { label: 'Rain', icon: '🌧', offroad: 0.8, road: 0.95, sensor: 0.8, air: true },
  storm: { label: 'Heavy rain', icon: '⛈', offroad: 0.55, road: 0.85, sensor: 0.6, air: false },
  fog: { label: 'Fog', icon: '🌫', offroad: 0.9, road: 0.85, sensor: 0.3, air: false },
  snow: { label: 'Snow', icon: '❄', offroad: 0.5, road: 0.7, sensor: 0.7, air: true },
  wind: { label: 'High winds', icon: '💨', offroad: 1, road: 1, sensor: 0.9, air: false },
};
export const LIGHT = {
  day: { label: 'Day', icon: '☀', offroad: 1, sensor: 1 },
  twilight: { label: 'Twilight', icon: '◐', offroad: 0.9, sensor: 0.7 },
  night: { label: 'Night', icon: '☾', offroad: 0.75, sensor: 0.4 },
};
export const weatherOf = (turn) => (WEATHER[turn?.weather] ? turn.weather : 'clear');

/** The real time a turn starts (UTC), when the clock has a start; local times are read at the play area's time zone. */
export function turnTime(doc, n) {
  const c = doc.clock || {};
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(c.start || '');
  if (!m) return null;
  const lng = doc.view?.center?.[0] ?? 0;
  const offset = c.utcOffset !== undefined && c.utcOffset !== '' && Number.isFinite(Number(c.utcOffset)) ? Number(c.utcOffset) : Math.round(lng / 15);
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - offset * 3600000;
  return new Date(utc + n * (Number(c.stepMinutes) || 60) * 60000);
}

/** The sun's height above the horizon (degrees) at a time and place. Accurate to well under a degree. */
export function sunAltitude(date, lat, lng) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const ha = (gmst * 15 + lng) * RAD - ra;
  return Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha)) / RAD;
}

/** Day, twilight (sun up to 6° below the horizon) or night at the start of turn n; null when the clock has no start. */
export function lightAt(doc, n) {
  const time = turnTime(doc, n);
  if (!time) return null;
  const [lng, lat] = doc.view?.center || [0, 0];
  const alt = sunAltitude(time, lat, lng);
  return { state: alt > 0 ? 'day' : alt > -6 ? 'twilight' : 'night', alt: round(alt, 1), time };
}

/** What weather and light do to movement and sensors on a turn. */
export function conditions(doc, turn, n) {
  const w = WEATHER[weatherOf(turn)];
  const light = lightAt(doc, n);
  const l = LIGHT[light?.state] || LIGHT.day;
  return { weather: weatherOf(turn), light: light?.state || null, alt: light?.alt ?? null, offroad: w.offroad * l.offroad, road: w.road, sensor: w.sensor * l.sensor, air: w.air };
}

/* ---------- arcs ---------- */

const hasArc = (u) => Number(u.fanArc) > 0 && Number(u.fanArc) < 360;
/** Whether a point lies inside a unit's arc (always true for an all-round unit). */
export function inArc(u, p) {
  if (!hasArc(u)) return true;
  const diff = Math.abs(((bearing(u.lngLat, p) - Number(u.fanDir || 0) + 540) % 360) - 180);
  return diff <= Number(u.fanArc) / 2;
}
/** A range ring, or a fan when the unit only covers an arc, as a polygon ring. */
export function rangeShape(u, km, steps = 72) {
  const [lng, lat] = u.lngLat;
  const kx = 111.32 * Math.cos(lat * RAD);
  const at = (deg) => [lng + (km * Math.sin(deg * RAD)) / kx, lat + (km * Math.cos(deg * RAD)) / 110.574];
  if (!hasArc(u)) { const ring = []; for (let i = 0; i <= steps; i++) ring.push(at((360 * i) / steps)); return ring; }
  const arc = Number(u.fanArc);
  const start = Number(u.fanDir || 0) - arc / 2;
  const n = Math.max(6, Math.round((steps * arc) / 360));
  const ring = [[lng, lat]];
  for (let i = 0; i <= n; i++) ring.push(at(start + (arc * i) / n));
  ring.push([lng, lat]);
  return ring;
}
/** A unit's sensor range on this turn, after weather and light. */
export const sensorRange = (doc, turn, n, u) => round((Number(u.sensorKm) || 0) * conditions(doc, turn, n).sensor, 2);

/* ---------- zones and the movement field ---------- */

export const ZONE_EFFECTS = {
  slow: 'Slows movement',
  block: 'Can\'t be crossed',
  cost: 'Uses more supply',
  jam: 'Jams radios',
};
export const zoneActive = (zone, turn, n) => (Number(zone.from) || 0) <= n && (zone.until == null || zone.until === '' || n <= Number(zone.until)) && (!zone.inject || (turn.fired || []).includes(zone.inject));
const zoneApplies = (zone, m) => !zone.mobility?.length || zone.mobility.includes(m);
export const inZone = (zone, p) => Array.isArray(zone.coords) && zone.coords.length > 2 && pointInRing(p, zone.coords);

const maskCache = new WeakMap(); // terrain → Map(key → cell indices)
function cellsUnder(T, key, test, bbox) {
  let m = maskCache.get(T);
  if (!m) maskCache.set(T, (m = new Map()));
  if (m.has(key)) return m.get(key);
  const out = [];
  const [w, s, e, n] = bbox;
  for (let i = 0; i < T.n; i++) {
    const [x, y] = T.center(i);
    if (x >= w && x <= e && y >= s && y <= n && test([x, y])) out.push(i);
  }
  if (m.size > 200) m.delete(m.keys().next().value);
  m.set(key, out);
  return out;
}
const bboxOf = (coords, padLng = 0, padLat = 0) => {
  const xs = coords.map((p) => p[0]);
  const ys = coords.map((p) => p[1]);
  return [Math.min(...xs) - padLng, Math.min(...ys) - padLat, Math.max(...xs) + padLng, Math.max(...ys) + padLat];
};
const zoneCells = (T, zone) => cellsUnder(T, `z${JSON.stringify(zone.coords)}`, (p) => pointInRing(p, zone.coords), bboxOf(zone.coords));
// Cells a line of communication passes through (within half a cell of it).
export function linkCells(T, link) {
  const half = T.s;
  return cellsUnder(T, `l${JSON.stringify(link.coords)}`, (p) => link.coords.slice(1).some((b, i) => pointSegmentKm(p, link.coords[i], b) <= half),
    bboxOf(link.coords, half / T.kx, half / T.ky));
}

export const statusOf = (turn, id) => (turn?.links || {})[id] || 'open';

/**
 * How fast (share of top speed) and how costly (supply multiplier) each cell is for one kind of mobility on this turn,
 * after zones and damaged crossings. A cut road, rail or bridge line loses its crossings: where it crosses a river
 * the cell goes back to being a river.
 */
export function movementField(doc, turn, n, T, m) {
  const f = factorsFor(doc, m);
  const cond = conditions(doc, turn, n);
  const speed = new Float32Array(T.n);
  const cost = new Float32Array(T.n).fill(1);
  const broken = new Map();
  for (const link of doc.network?.links || []) {
    if (!['road', 'rail', 'bridge'].includes(link.type)) continue;
    const st = statusOf(turn, link.id);
    if (st === 'open' || !Array.isArray(link.coords) || link.coords.length < 2) continue;
    for (const i of linkCells(T, link)) if (T.riverOf(i) || T.coverOf(i) === 3) broken.set(i, broken.get(i) === 'cut' ? 'cut' : st);
  }
  for (let i = 0; i < T.n; i++) {
    const c = T.coverOf(i);
    const river = T.riverOf(i);
    let road = T.roadOf(i);
    const br = broken.get(i);
    if (br === 'cut') road = 0;
    let v;
    if (m === 'naval') v = (c === 3 ? f.water : river ? f.river : 0) * (cond.weather === 'storm' ? 0.6 : 1);
    else if (m === 'air') v = cond.air ? 1 : 0;
    else {
      const ground = (c === 3 ? f.water : river ? Math.min(f[COVER[c].key], f.river) : f[COVER[c].key]) * cond.offroad;
      v = road ? Math.max(ground, (road === 2 ? f.road : f.minor) * cond.road) : ground;
      if (br === 'degraded' && road) v = Math.max(ground, v * 0.5);
    }
    speed[i] = v;
  }
  for (const z of doc.zones || []) {
    if (z.effect === 'jam' || !zoneActive(z, turn, n) || !zoneApplies(z, m) || !(z.coords?.length > 2)) continue;
    const cells = zoneCells(T, z);
    if (z.effect === 'block') for (const i of cells) speed[i] = 0;
    else if (z.effect === 'slow') { const k = clamp(Number(z.factor) || 0.5, 0, 1); for (const i of cells) speed[i] *= k; }
    else if (z.effect === 'cost') { const k = Math.max(1, Number(z.costMult) || 2); for (const i of cells) cost[i] *= k; }
  }
  return { speed, cost, m };
}

// The time (hours) and supply (%) to step from cell a into neighboring cell b.
function stepCost(T, field, a, b, speedKmh, rate) {
  const f = field.speed[b];
  if (!(f > 0)) return null;
  let mult = 1;
  const lim = GRADE_LIMIT[field.m];
  if (lim) {
    const ea = T.elevOf(a);
    const eb = T.elevOf(b);
    if (ea != null && eb != null) {
      const grade = (Math.abs(eb - ea) / (T.step * 1000)) * (T.roadOf(b) ? 0.5 : 1);
      mult = grade >= lim ? 0 : 1 - grade / lim;
      if (mult <= 0.02) return null;
    }
  }
  const eff = f * mult;
  return { hours: T.step / (speedKmh * eff), supply: T.step * rate * Math.min(4, 1 / eff) * field.cost[b] };
}

class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1; const r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

/**
 * The quickest route for a unit from where it started the turn to `to`, over the terrain: { path, km, hours, cost }.
 * `cost` is the share of a full supply load used. Returns { blocked: true } when it can't get there, or null when
 * either end is outside the terrain grid (the screen then falls back to a straight line).
 */
export function routeUnit(doc, turn, n, T, unit, to, { field, costMult = 1 } = {}) {
  const m = mobilityOf(unit);
  const from = unit.from || unit.lngLat;
  const a = T.cellAt(from);
  const b = T.cellAt(to);
  if (a < 0 || b < 0) return null;
  const speed = speedOf(unit);
  if (m === 'fixed' || !(speed > 0)) return { blocked: true, reason: 'This unit doesn\'t move.' };
  const rate = MOBILITY[m].rate * costMult;
  const fld = field || movementField(doc, turn, n, T, m);
  const end = (path, hours, cost) => {
    const coords = path.length > 2 ? [from, ...path.slice(1, -1).map((i) => T.center(i)), to] : [from, to];
    return { path: coords, km: round(lineKm(coords), 2), hours: round(hours, 3), cost: round(cost, 1), mobility: m };
  };
  if (a === b) {
    const f = fld.speed[a] || (m === 'air' ? 1 : 0.5);
    const km = distanceKm(from, to);
    return end([a], km / (speed * f), km * MOBILITY[m].rate * costMult * Math.min(4, 1 / f) * fld.cost[a]);
  }
  const g = new Float64Array(T.n).fill(Infinity);
  const sup = new Float64Array(T.n);
  const prev = new Int32Array(T.n).fill(-1);
  const goal = T.xy(b);
  const h = (i) => { const p = T.xy(i); return Math.hypot(p[0] - goal[0], p[1] - goal[1]) / speed; };
  const heap = new Heap();
  g[a] = 0;
  heap.push(h(a), a);
  while (heap.size) {
    const [, i] = heap.pop();
    if (i === b) break;
    for (let k = 0; k < 6; k++) {
      const j = T.neighbor(i, k);
      if (j < 0) continue;
      const c = stepCost(T, fld, i, j, speed, rate);
      if (!c) continue;
      const ng = g[i] + c.hours;
      if (ng < g[j] - 1e-12) { g[j] = ng; sup[j] = sup[i] + c.supply; prev[j] = i; heap.push(ng + h(j), j); }
    }
  }
  if (!Number.isFinite(g[b])) return { blocked: true, reason: `A ${MOBILITY[m].label.toLowerCase()} unit can't get there over this terrain.` };
  const path = [];
  for (let i = b; i >= 0; i = prev[i]) path.unshift(i);
  return end(path, g[b], sup[b]);
}

/** Every cell a unit can reach within `hours` from where it started the turn: Map(cell → hours). */
export function reachCells(doc, turn, n, T, unit, hours, { field } = {}) {
  const m = mobilityOf(unit);
  const speed = speedOf(unit);
  const out = new Map();
  const a = T.cellAt(unit.from || unit.lngLat);
  if (a < 0 || m === 'fixed' || !(speed > 0)) return out;
  const fld = field || movementField(doc, turn, n, T, m);
  const g = new Float64Array(T.n).fill(Infinity);
  const heap = new Heap();
  g[a] = 0;
  heap.push(0, a);
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d > g[i]) continue;
    out.set(i, d);
    for (let k = 0; k < 6; k++) {
      const j = T.neighbor(i, k);
      if (j < 0) continue;
      const c = stepCost(T, fld, i, j, speed, 0);
      if (!c) continue;
      const ng = d + c.hours;
      if (ng <= hours && ng < g[j]) { g[j] = ng; heap.push(ng, j); }
    }
  }
  return out;
}

/** The outline of a set of cells, as one MultiLineString of the edges between cells inside and outside. */
export function cellsOutline(T, cells) {
  const lines = [];
  for (const i of cells.keys ? cells.keys() : cells) {
    for (let k = 0; k < 6; k++) {
      const j = T.neighbor(i, k);
      if (j < 0 || (cells.has ? cells.has(j) : cells.includes(j))) continue; // the grid's own edge isn't a limit worth drawing
      lines.push([T.corner(i, k), T.corner(i, (k + 1) % 6)]);
    }
  }
  return { type: 'MultiLineString', coordinates: lines };
}

/**
 * Multi-turn terrain-adjusted reach isochrones (e.g. 1, 2, 3 turns out) from a single Dijkstra pass.
 * Returns [{ turn, hours, count, outline }] for each band that adds reachable cells.
 */
export function multiTurnReach(doc, turn, n, T, unit, { turns = 3, field } = {}) {
  const stepHours = (Number(doc.clock?.stepMinutes) || 60) / 60;
  const maxTurns = Math.max(1, Math.min(6, Math.round(turns)));
  const all = reachCells(doc, turn, n, T, unit, stepHours * maxTurns, { field });
  const bands = [];
  for (let k = 1; k <= maxTurns; k++) {
    const limit = stepHours * k;
    const set = new Set();
    for (const [cell, hrs] of all) if (hrs <= limit + 1e-9) set.add(cell);
    if (set.size > 1) bands.push({ turn: k, hours: round(limit, 2), count: set.size, outline: cellsOutline(T, set) });
  }
  return bands;
}

/* ---------- lines of communication ---------- */

export const LINK_TYPES = {
  road: { label: 'Road', color: '#57534e' },
  rail: { label: 'Rail', color: '#1f2937' },
  bridge: { label: 'Bridge', color: '#7c2d12' },
  river: { label: 'River or canal', color: '#2563eb' },
  sea: { label: 'Sea lane', color: '#0e7490' },
  air: { label: 'Air route', color: '#6d28d9' },
  pipeline: { label: 'Pipeline', color: '#a16207' },
  signal: { label: 'Signal link', color: '#9333ea' },
};
export const NODE_TYPES = { depot: 'Depot', port: 'Port', airfield: 'Airfield', relay: 'Signal relay' };
export const LINK_STATUSES = [['open', 'Open'], ['degraded', 'Degraded'], ['cut', 'Cut']];
const SUPPLY_NODES = ['depot', 'port', 'airfield'];

export const isOpposed = (doc, a, b) => a !== b && sideOf(doc, a).affiliation !== 'N' && sideOf(doc, b).affiliation !== 'N';
const activeUnits = (turn) => turn.units.filter((u) => u.status !== 'destroyed');

/** Segments of a side's own lines (and its depots) that enemy units are close enough to cut, per the rules. */
export function interdictions(doc, turn) {
  const r = rulesOf(doc);
  const out = [];
  if (!(r.interdictKm > 0)) return out;
  const units = activeUnits(turn);
  for (const link of doc.network?.links || []) {
    if (!link.side || statusOf(turn, link.id) === 'cut') continue;
    for (let i = 1; i < (link.coords || []).length; i++) {
      const by = units.find((u) => isOpposed(doc, u.side, link.side) && pointSegmentKm(u.lngLat, link.coords[i - 1], link.coords[i]) <= r.interdictKm);
      if (by) out.push({ link: link.id, seg: i, by: by.id, coords: [link.coords[i - 1], link.coords[i]] });
    }
  }
  for (const node of doc.network?.nodes || []) {
    if (!node.side || statusOf(turn, node.id) === 'cut') continue;
    const by = units.find((u) => isOpposed(doc, u.side, node.side) && distanceKm(u.lngLat, node.lngLat) <= r.interdictKm);
    if (by) out.push({ node: node.id, by: by.id });
  }
  return out;
}

// A side's network as a graph of line vertices: edges along each usable line, joins where lines meet.
function networkGraph(doc, turn, side, signal, blocked) {
  const V = [];
  const adj = [];
  const edges = [];
  const add = (p) => { V.push(p); adj.push([]); return V.length - 1; };
  for (const link of doc.network?.links || []) {
    if ((link.type === 'signal') !== signal || (link.side && link.side !== side) || !(link.coords?.length > 1)) continue;
    const st = statusOf(turn, link.id);
    if (st === 'cut') continue;
    let last = add(link.coords[0]);
    for (let i = 1; i < link.coords.length; i++) {
      const v = add(link.coords[i]);
      if (!blocked.has(`${link.id}:${i}`)) {
        const e = { a: last, b: v, km: distanceKm(link.coords[i - 1], link.coords[i]), degraded: st === 'degraded', link };
        edges.push(e);
        adj[last].push(e);
        adj[v].push(e);
      }
      last = v;
    }
  }
  // Lines that meet join up: vertices close together, or a vertex lying on another line.
  for (let i = 0; i < V.length; i++) {
    for (let j = i + 1; j < V.length; j++) {
      if (distanceKm(V[i], V[j]) <= 0.25) { const e = { a: i, b: j, km: 0, join: true }; adj[i].push(e); adj[j].push(e); }
    }
  }
  for (const e of edges.slice()) {
    for (let i = 0; i < V.length; i++) {
      if (i === e.a || i === e.b || pointSegmentKm(V[i], V[e.a], V[e.b]) > 0.25) continue;
      const j = { a: i, b: e.a, km: distanceKm(V[i], V[e.a]), degraded: e.degraded, link: e.link };
      adj[i].push(j); adj[e.a].push(j);
    }
  }
  return { V, adj, edges };
}

function spread(G, starts, allowDegraded) {
  const dist = new Float64Array(G.V.length).fill(Infinity);
  const heap = new Heap();
  for (const [v, d] of starts) if (d < dist[v]) { dist[v] = d; heap.push(d, v); }
  while (heap.size) {
    const [d, v] = heap.pop();
    if (d > dist[v]) continue;
    for (const e of G.adj[v]) {
      if (e.degraded && !allowDegraded) continue;
      const w = e.a === v ? e.b : e.a;
      if (d + e.km < dist[w]) { dist[w] = d + e.km; heap.push(d + e.km, w); }
    }
  }
  return dist;
}

/**
 * Whether each unit can draw supply: Map(unit id → { state: 'in' | 'strained' | 'out' | 'none', via, km }).
 * A unit is in supply when it is within reach of one of its side's depots, ports or airfields, or of a line connected
 * to one by open lines. Through a degraded line it is strained. Sides with no depots aren't tracked ('none').
 */
export function supplyStates(doc, turn) {
  const r = rulesOf(doc);
  const out = new Map();
  const cuts = interdictions(doc, turn);
  const blockedSegs = new Set(cuts.filter((c) => c.link).map((c) => `${c.link}:${c.seg}`));
  const lostNodes = new Set(cuts.filter((c) => c.node).map((c) => c.node));
  for (const side of doc.sides) {
    const units = turn.units.filter((u) => u.side === side.id);
    if (!units.length) continue;
    const sources = (doc.network?.nodes || []).filter((x) => x.side === side.id && SUPPLY_NODES.includes(x.type));
    if (!sources.length) { units.forEach((u) => out.set(u.id, { state: 'none' })); continue; }
    const live = sources.filter((x) => statusOf(turn, x.id) !== 'cut' && !lostNodes.has(x.id));
    const G = networkGraph(doc, turn, side.id, false, blockedSegs);
    const starts = [];
    for (const src of live) G.V.forEach((p, v) => { const d = distanceKm(src.lngLat, p); if (d <= r.reachKm) starts.push([v, d]); });
    const clean = spread(G, starts, false);
    const any = spread(G, starts, true);
    const near = (u, dist) => {
      let best = null;
      for (const e of G.edges) {
        if (!Number.isFinite(dist[e.a]) && !Number.isFinite(dist[e.b])) continue;
        const d = pointSegmentKm(u.lngLat, G.V[e.a], G.V[e.b]);
        if (d <= r.reachKm && (!best || d < best.d)) best = { d, link: e.link, km: Math.min(dist[e.a], dist[e.b]) };
      }
      return best;
    };
    for (const u of units) {
      const direct = live.map((x) => ({ x, d: distanceKm(u.lngLat, x.lngLat) })).filter((o) => o.d <= r.reachKm).sort((p, q) => p.d - q.d)[0];
      if (direct) { out.set(u.id, { state: 'in', via: direct.x.name || NODE_TYPES[direct.x.type], km: round(direct.d, 1) }); continue; }
      const c = near(u, clean);
      if (c) { out.set(u.id, { state: 'in', via: c.link?.name || LINK_TYPES[c.link?.type]?.label || 'a line', km: round(c.km + c.d, 1) }); continue; }
      const s = near(u, any);
      out.set(u.id, s ? { state: 'strained', via: s.link?.name || 'a degraded line', km: round(s.km + s.d, 1) } : { state: 'out' });
    }
  }
  return out;
}
export const SUPPLY_LABELS = { in: 'In supply', strained: 'Supply strained', out: 'Out of supply', none: 'Not tracked' };

/** How many turns in a row a unit has been out of supply, up to and including turn n of a branch. */
export function turnsOutOfSupply(doc, branch, n, unitId) {
  let count = 0;
  for (let i = n; i >= 0; i--) {
    const t = branch.turns[i];
    if (!t.units.some((u) => u.id === unitId) || supplyStates(doc, t).get(unitId)?.state !== 'out') break;
    count++;
  }
  return count;
}

/**
 * Whether each unit with a headquarters can reach it: Map(unit id → { state: 'ok' | 'out', why }). Contact is by radio
 * within range (unless either is inside an active jamming zone), or over open signal links both are near.
 */
export function commandStates(doc, turn, n) {
  const r = rulesOf(doc);
  const out = new Map();
  const jams = (doc.zones || []).filter((z) => z.effect === 'jam' && zoneActive(z, turn, n));
  const jammed = (u) => jams.some((z) => inZone(z, u.lngLat));
  const graphs = new Map();
  const signalGraph = (side) => {
    if (!graphs.has(side)) {
      const G = networkGraph(doc, turn, side, true, new Set());
      const comp = new Int32Array(G.V.length).fill(-1);
      let c = 0;
      for (let v = 0; v < G.V.length; v++) {
        if (comp[v] >= 0) continue;
        const stack = [v];
        comp[v] = c;
        while (stack.length) { const x = stack.pop(); for (const e of G.adj[x]) { const w = e.a === x ? e.b : e.a; if (comp[w] < 0) { comp[w] = c; stack.push(w); } } }
        c++;
      }
      graphs.set(side, { G, comp });
    }
    return graphs.get(side);
  };
  const components = (u) => {
    const { G, comp } = signalGraph(u.side);
    const set = new Set();
    for (const e of G.edges) if (pointSegmentKm(u.lngLat, G.V[e.a], G.V[e.b]) <= r.reachKm) set.add(comp[e.a]);
    for (const node of (doc.network?.nodes || []).filter((x) => x.type === 'relay' && (!x.side || x.side === u.side) && statusOf(turn, x.id) !== 'cut')) {
      if (distanceKm(u.lngLat, node.lngLat) > Math.max(r.radioKm, r.reachKm) || jammed(u)) continue;
      G.V.forEach((p, v) => { if (distanceKm(p, node.lngLat) <= r.reachKm) set.add(comp[v]); });
    }
    return set;
  };
  for (const u of turn.units) {
    if (!u.parent) continue;
    const hq = turn.units.find((x) => x.id === u.parent);
    if (!hq) { out.set(u.id, { state: 'out', why: 'Its headquarters is no longer on the map' }); continue; }
    if (hq.status === 'destroyed') { out.set(u.id, { state: 'out', why: `${hq.name} is out of action` }); continue; }
    const d = distanceKm(u.lngLat, hq.lngLat);
    if (r.radioKm > 0 && d <= r.radioKm && !jammed(u) && !jammed(hq)) { out.set(u.id, { state: 'ok', why: `Radio to ${hq.name}, ${round(d, 1)} km` }); continue; }
    const mine = components(u);
    const theirs = components(hq);
    if ([...mine].some((c) => theirs.has(c))) { out.set(u.id, { state: 'ok', why: `Signal link to ${hq.name}` }); continue; }
    out.set(u.id, { state: 'out', why: jammed(u) || jammed(hq) ? 'Radios jammed' : `${hq.name} is out of radio range (${round(d, 1)} km)` });
  }
  return out;
}

/* ---------- spotting ---------- */

const OBSTACLE_M = [0, 15, 12, 0, 0]; // forest and built-up areas block sight above the ground

/** Whether a can see b over the terrain (straight line, with the earth's curve and woods and buildings in the way). */
export function lineOfSight(T, a, b, { observerM = 2, targetM = 2 } = {}) {
  if (!T) return true;
  const ia = T.cellAt(a);
  const ib = T.cellAt(b);
  const ea = ia >= 0 ? T.elevOf(ia) : null;
  const eb = ib >= 0 ? T.elevOf(ib) : null;
  if (ea == null || eb == null) return true;
  const total = distanceKm(a, b);
  const steps = Math.max(2, Math.ceil(total / (T.step / 2)));
  const [ha, hb] = [ea + observerM, eb + targetM];
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const i = T.cellAt(p);
    if (i < 0 || i === ia || i === ib) continue;
    const e = T.elevOf(i);
    if (e == null) continue;
    const d1 = total * t;
    const curve = (d1 * (total - d1)) / 12.74; // metres the earth bulges up at this point
    if (e + OBSTACLE_M[T.coverOf(i)] + curve > ha + (hb - ha) * t) return false;
  }
  return true;
}

/**
 * Computes an instant terrain-masked viewshed polygon directly from the scenario's hex terrain grid `T`,
 * respecting unit fan arc (`fanDir`/`fanArc`), DEM elevation, forest/urban obstacle height, and Earth curvature.
 * Returns { ring, visibleRatio, maxVisibleKm }.
 */
export function viewshedPolygon(T, unit, rangeKm, { rays = 72, observerM = 2, targetM = 2 } = {}) {
  const rKm = Number(rangeKm) || 0;
  if (!T || !(rKm > 0)) return { ring: rangeShape(unit, rKm, rays), visibleRatio: 1, maxVisibleKm: rKm };
  const [lng, lat] = unit.lngLat;
  const ia = T.cellAt(unit.lngLat);
  const ea = ia >= 0 ? T.elevOf(ia) : null;
  if (ea == null) return { ring: rangeShape(unit, rKm, rays), visibleRatio: 1, maxVisibleKm: rKm };

  const kx = 111.32 * Math.cos(lat * RAD);
  const arc = hasArc(unit) ? Number(unit.fanArc) : 360;
  const startDeg = hasArc(unit) ? Number(unit.fanDir || 0) - arc / 2 : 0;
  const nRays = hasArc(unit) ? Math.max(12, Math.round((rays * arc) / 360)) : rays;
  const nSteps = Math.max(8, Math.min(48, Math.ceil(rKm / Math.max(0.15, T.step * 0.6))));
  const ha = ea + observerM;

  const ring = hasArc(unit) ? [[lng, lat]] : [];
  let sumFrac = 0;
  let maxVis = 0;

  for (let r = 0; r <= nRays; r++) {
    const deg = startDeg + (arc * r) / nRays;
    const dx = Math.sin(deg * RAD) / kx;
    const dy = Math.cos(deg * RAD) / 110.574;
    let maxSlope = -Infinity;
    let furthestKm = 0;

    for (let s = 1; s <= nSteps; s++) {
      const d = (rKm * s) / nSteps;
      const p = [lng + d * dx, lat + d * dy];
      const cell = T.cellAt(p);
      if (cell < 0 || cell === ia) {
        furthestKm = d;
        continue;
      }
      const e = T.elevOf(cell);
      if (e == null) { furthestKm = d; continue; }
      const curve = (d * d) / 12.74; // Earth curvature drop in meters
      const groundH = e - curve;
      const obstacleH = groundH + OBSTACLE_M[T.coverOf(cell)];
      const tgtSlope = (groundH + targetM - ha) / (d * 1000);
      const obsSlope = (obstacleH - ha) / (d * 1000);
      if (tgtSlope >= maxSlope - 1e-6) {
        furthestKm = d;
      } else {
        // Blocked by intervening ridge/forest/urban: stop extending outer continuous sightline polygon
        break;
      }
      if (obsSlope > maxSlope) maxSlope = obsSlope;
    }

    if (r < nRays || hasArc(unit)) {
      sumFrac += furthestKm / rKm;
      if (furthestKm > maxVis) maxVis = furthestKm;
    }
    ring.push([round(lng + furthestKm * dx, 6), round(lat + furthestKm * dy, 6)]);
  }
  if (hasArc(unit)) ring.push([lng, lat]);
  const denom = hasArc(unit) ? nRays + 1 : nRays;
  return { ring, visibleRatio: round(sumFrac / Math.max(1, denom), 3), maxVisibleKm: round(maxVis, 2) };
}

/** Units seen by at least one opposing unit with a sensor range: in range (after weather and light), in its arc, and in line of sight. */
export function autoSpotted(doc, turn, T, n = 0) {
  const seen = new Set();
  const factor = conditions(doc, turn, n).sensor;
  const units = activeUnits(turn);
  const watchers = units.filter((w) => Number(w.sensorKm) > 0);
  for (const u of turn.units) {
    for (const w of watchers) {
      if (w.side === u.side || !isOpposed(doc, w.side, u.side)) continue;
      if (distanceKm(w.lngLat, u.lngLat) <= Number(w.sensorKm) * factor && inArc(w, u.lngLat) && lineOfSight(T, w.lngLat, u.lngLat)) { seen.add(u.id); break; }
    }
  }
  return seen;
}

/* ---------- combat ---------- */

export const POWER = {
  infantry: 1, mech: 1.3, armor: 1.6, artillery: 1.2, recon: 0.5, engineer: 0.7, airdefense: 0.4, aviation: 1.4, signal: 0.2, supply: 0.1,
  medical: 0.1, hq: 0.3, aircraft: 1.5, helicopter: 1.3, ship: 2, submarine: 1.5, police: 0.3, fire: 0.1, ems: 0.1, command: 0.2, shelter: 0,
  team: 0.3, vehicle: 0.2, civilians: 0, hazard: 0, other: 0.3,
};
const DEFENSE_ONLY = { artillery: 0.5, hq: 0.6, airdefense: 0.8 };
export const SIZE = { '': 1, A: 0.05, B: 0.1, D: 0.3, E: 1, F: 3, H: 9, I: 27 };
const COVER_DEFENSE = [1, 1.5, 2, 1, 1.2];

export const DEFAULT_CRT = {
  columns: ['1:3', '1:2', '1:1', '2:1', '3:1', '4:1', '5:1'],
  rows: [ // by die roll 1–6; higher rolls favor the attacker
    ['A50 AR', 'A40 AR', 'A30 AR', 'A20', 'A20 D10', 'A10 D20', 'A10 D20 DR'],
    ['A40 AR', 'A30 AR', 'A20', 'A20 D10', 'A10 D20', 'A10 D20 DR', 'D30 DR'],
    ['A30 AR', 'A30', 'A20 D10', 'A10 D20', 'A10 D20 DR', 'A10 D30 DR', 'D30 DR'],
    ['A30', 'A20 D10', 'A10 D10', 'A10 D20 DR', 'A10 D30 DR', 'D30 DR', 'D40 DR'],
    ['A20 D10', 'A20 D10', 'A10 D20', 'A10 D30 DR', 'D30 DR', 'D40 DR', 'D50 DR'],
    ['A10 D10', 'A10 D20', 'A10 D20 DR', 'D30 DR', 'D40 DR', 'D50 DR', 'D60 DR'],
  ],
};
export const crtOf = (doc) => (doc.combat?.columns?.length && doc.combat?.rows?.length === 6 ? doc.combat : DEFAULT_CRT);

/** "A10 D20 DR" → attacker loses 10 points of strength, defender 20, and the defender falls back. */
export function parseResult(code) {
  const out = { a: 0, d: 0, ar: false, dr: false };
  for (const tok of String(code || '').toUpperCase().split(/[\s,/]+/)) {
    let m;
    if (tok === 'AR') out.ar = true;
    else if (tok === 'DR') out.dr = true;
    else if ((m = /^A(\d+)$/.exec(tok))) out.a = clamp(+m[1], 0, 100);
    else if ((m = /^D(\d+)$/.exec(tok))) out.d = clamp(+m[1], 0, 100);
  }
  return out;
}
export function describeResult(code) {
  const r = parseResult(code);
  const parts = [];
  if (r.a) parts.push(`attackers lose ${r.a}%`);
  if (r.ar) parts.push('attackers fall back');
  if (r.d) parts.push(`defenders lose ${r.d}%`);
  if (r.dr) parts.push('defenders fall back');
  return parts.length ? parts.join(', ') : 'no effect';
}
const ratioOf = (col) => { const [a, b] = String(col).split(':').map(Number); return a > 0 && b > 0 ? a / b : 1; };

/** One unit's combat value, with what went into it. */
export function unitPower(doc, turn, n, T, u, role, { supply, command } = {}) {
  const parts = [];
  let v;
  if (u.power !== undefined && u.power !== null && u.power !== '' && Number.isFinite(Number(u.power))) { v = Number(u.power); parts.push(['Combat value', v]); } else {
    v = (POWER[u.kind] ?? 0.3) * (SIZE[u.echelon || ''] ?? 1);
    parts.push([`${KINDS[u.kind]?.label || 'Unit'}${u.echelon ? `, ${SIZE_LABEL[u.echelon] || ''}` : ''}`, round(v, 2)]);
  }
  const mult = (label, k) => { if (k !== 1) { v *= k; parts.push([label, `×${k}`]); } };
  mult(`${u.strength}% strength`, round((Number(u.strength) || 0) / 100, 2));
  if (role === 'defend' && DEFENSE_ONLY[u.kind]) mult('Weak in defense', DEFENSE_ONLY[u.kind]);
  const sup = supply?.get(u.id)?.state;
  if (sup === 'out') mult('Out of supply', 0.5); else if (sup === 'strained') mult('Supply strained', 0.8);
  if (command?.get(u.id)?.state === 'out') mult('Out of contact', 0.8);
  if (Number(u.ammoMax) > 0 && Number(u.ammo ?? 0) <= 0) mult('Out of munitions / sorties', 0.25);
  if (role === 'defend' && T) {
    const i = T.cellAt(u.lngLat);
    if (i >= 0) {
      const c = T.coverOf(i);
      if (COVER_DEFENSE[c] !== 1) mult(`Defending in ${COVER[c].label.toLowerCase()}`, COVER_DEFENSE[c]);
      if (T.riverOf(i) && !T.roadOf(i)) mult('Behind a river', 1.3);
    }
  }
  return { value: round(Math.max(0, v), 3), parts };
}
const SIZE_LABEL = { A: 'team', B: 'squad', D: 'platoon', E: 'company', F: 'battalion', H: 'brigade', I: 'division' };

/** The odds and the result for a roll: { att, def, ratio, column, result, effects, … }. */
export function resolveCombat(doc, turn, n, T, attackers, defenders, roll, states = {}) {
  const crt = crtOf(doc);
  const att = attackers.map((u) => ({ u, ...unitPower(doc, turn, n, T, u, 'attack', states) }));
  const def = defenders.map((u) => ({ u, ...unitPower(doc, turn, n, T, u, 'defend', states) }));
  let A = att.reduce((s, x) => s + x.value, 0);
  let D = def.reduce((s, x) => s + x.value, 0);
  let height = null;
  if (T) {
    const avg = (list) => { const vals = list.map((x) => T.cellAt(x.u.lngLat)).filter((i) => i >= 0).map((i) => T.elevOf(i)).filter((e) => e != null); return vals.length ? vals.reduce((s, e) => s + e, 0) / vals.length : null; };
    const [ea, ed] = [avg(att), avg(def)];
    if (ea != null && ed != null && ed - ea > 50) { D *= 1.25; height = Math.round(ed - ea); }
  }
  const ratio = D > 0 ? A / D : A > 0 ? 99 : 0;
  let col = 0;
  crt.columns.forEach((c, i) => { if (ratio >= ratioOf(c) - 1e-9) col = i; });
  const die = clamp(Math.round(Number(roll) || 1), 1, 6);
  const code = crt.rows[die - 1]?.[col] || '';
  return { att, def, attack: round(A, 2), defense: round(D, 2), ratio: round(ratio, 2), column: crt.columns[col], below: ratio < ratioOf(crt.columns[0]) - 1e-9, height, roll: die, result: code, effects: parseResult(code) };
}

/** Applies a combat result to the units and writes one line to the log. */
export function applyCombat(doc, turn, outcome) {
  const hit = (list, loss, spendAmmo) => list.forEach(({ u }) => {
    const unit = turn.units.find((x) => x.id === u.id);
    if (!unit) return;
    unit.strength = clamp(Math.round((Number(unit.strength) || 0) - loss), 0, 100);
    unit.status = unit.strength <= 0 ? 'destroyed' : 'engaged';
    if (spendAmmo && Number(unit.ammoMax) > 0 && Number(unit.ammo ?? 0) > 0) unit.ammo = Math.max(0, Number(unit.ammo) - 1);
  });
  hit(outcome.att, outcome.effects.a, true);
  hit(outcome.def, outcome.effects.d, false);
  const names = (list) => list.map((x) => x.u.name).join(', ');
  const text = `Combat: ${names(outcome.att)} attacked ${names(outcome.def)} at ${outcome.column}${outcome.below ? ' (worse odds, resolved at the lowest column)' : ''}, rolled ${outcome.roll}: ${describeResult(outcome.result)}`;
  turn.events.push({ type: 'combat', text, units: [...outcome.att, ...outcome.def].map((x) => x.u.id) });
  return text;
}

/* ---------- objectives and scoring ---------- */

/**
 * Who holds each objective at the end of turn n: { id: side id | 'contested' | null }. A side takes an objective when
 * it has units in action there and no other side does; it keeps it until someone else takes it.
 */
export function controlAt(doc, branch, n) {
  const objs = doc.objectives || [];
  const held = Object.fromEntries(objs.map((o) => [o.id, o.holder || null]));
  let now = {};
  for (let t = 0; t <= Math.min(n, branch.turns.length - 1); t++) {
    const units = activeUnits(branch.turns[t]);
    now = {};
    for (const o of objs) {
      const sides = [...new Set(units.filter((u) => sideOf(doc, u.side).affiliation !== 'N' && distanceKm(u.lngLat, o.lngLat) <= (Number(o.radiusKm) || 1)).map((u) => u.side))];
      if (sides.length === 1) held[o.id] = sides[0];
      now[o.id] = sides.length > 1 ? 'contested' : held[o.id];
    }
  }
  return now;
}

/** Each side's score at turn n: points held now, and points added up over every turn held. */
export function scoreAt(doc, branch, n) {
  const objs = doc.objectives || [];
  const total = Object.fromEntries(doc.sides.map((s) => [s.id, 0]));
  let held = Object.fromEntries(doc.sides.map((s) => [s.id, 0]));
  for (let t = 0; t <= Math.min(n, branch.turns.length - 1); t++) {
    const ctl = controlAt(doc, branch, t);
    held = Object.fromEntries(doc.sides.map((s) => [s.id, 0]));
    for (const o of objs) if (held[ctl[o.id]] !== undefined) held[ctl[o.id]] += Number(o.points) || 0;
    if (t > 0) for (const id in held) total[id] += held[id];
  }
  const v = doc.victory || {};
  const target = Number(v.target) || 0;
  const measure = v.mode === 'total' ? total : held;
  const winner = target > 0 ? doc.sides.find((s) => measure[s.id] >= target) || null : null;
  return { held, total, winner: winner ? winner.id : null };
}

/* ---------- planned moves ---------- */

/** Opposing units in action close enough to fight: within either one's range, or 1 km. */
export function findContacts(doc, turn) {
  const units = activeUnits(turn);
  const out = [];
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const [a, b] = [units[i], units[j]];
      if (!isOpposed(doc, a.side, b.side)) continue;
      const d = distanceKm(a.lngLat, b.lngLat);
      const reachA = inArc(a, b.lngLat) ? Number(a.rangeKm) || 0 : 0;
      const reachB = inArc(b, a.lngLat) ? Number(b.rangeKm) || 0 : 0;
      if (d <= Math.max(reachA, reachB, 1)) out.push({ a: a.id, b: b.id, km: round(d, 1) });
    }
  }
  return out.sort((p, q) => p.km - q.km);
}

/** Moves every unit with a planned move at once, then logs the contacts that result. */
export function executePlans(doc, turn) {
  const moved = [];
  for (const u of turn.units) {
    if (!u.plan?.to) continue;
    const { to, path, km, hours, cost } = u.plan;
    delete u.plan;
    moveUnit(doc, turn, u.id, to, path ? { path, km, hours, cost } : null);
    moved.push(u.id);
  }
  const contacts = findContacts(doc, turn);
  const name = (id) => turn.units.find((u) => u.id === id)?.name;
  turn.events = turn.events.filter((e) => e.type !== 'contact');
  for (const c of contacts) turn.events.push({ type: 'contact', units: [c.a, c.b], text: `Contact: ${name(c.a)} and ${name(c.b)}, ${c.km} km apart` });
  return { moved, contacts };
}

/* ---------- starting a turn ---------- */

/**
 * Starts the next turn with the rules applied: units use up the supply their moves cost and get resupplied if their
 * lines are open; with automatic effects on, units out of supply lose strength. Supply, contact and lines cut by the
 * enemy are written to the log. Returns what nextTurn returns.
 */
export function startTurn(doc, branchId) {
  const b = branchOf(doc, branchId);
  const prev = b.turns.at(-1);
  const r = rulesOf(doc);
  const supply = supplyStates(doc, prev);
  const command = commandStates(doc, prev, b.turns.length - 1);
  const cuts = interdictions(doc, prev);
  const res = nextTurn(doc, branchId);
  const t = b.turns[res.index];
  applySchedule(doc, t, res.index);
  const lost = [];
  for (const u of t.units) {
    const level = clamp((u.supply ?? 100) - (Number(u.used) || 0), 0, 100);
    const st = supply.get(u.id)?.state;
    const gain = st === 'in' ? r.resupply : st === 'strained' ? r.resupply / 2 : st === 'out' ? 0 : 100;
    u.supply = Math.round(clamp(level + gain, 0, 100));
    if (Number(u.ammoMax) > 0 && st !== 'out' && st !== 'strained') {
      u.ammo = Math.min(Number(u.ammoMax), Math.max(0, Number(u.ammo ?? 0)) + 1);
    }
    const delayed = u.delayedPlan;
    delete u.used; delete u.path; delete u.hours; delete u.plan; delete u.delayedPlan;
    if (delayed?.to && u.status !== 'destroyed') {
      moveUnit(doc, t, u.id, delayed.to, delayed.path ? { path: delayed.path, km: delayed.km, hours: delayed.hours, cost: delayed.cost } : null);
      t.events.push({ type: 'command', unit: u.id, text: `${u.name} executes delayed C2 move order` });
    }
    if (r.auto && st === 'out' && u.status !== 'destroyed' && r.lossPct > 0) {
      u.strength = clamp(Math.round((Number(u.strength) || 0) - r.lossPct), 0, 100);
      if (u.strength <= 0) u.status = 'destroyed';
      lost.push(u.name);
    }
  }
  const named = (pred) => prev.units.filter(pred).map((u) => u.name);
  const out = named((u) => u.status !== 'destroyed' && supply.get(u.id)?.state === 'out');
  const strained = named((u) => u.status !== 'destroyed' && supply.get(u.id)?.state === 'strained');
  const noContact = named((u) => u.status !== 'destroyed' && command.get(u.id)?.state === 'out');
  if (out.length) t.events.push({ type: 'supply', text: `Out of supply: ${out.join(', ')}${lost.length ? ` (each loses ${r.lossPct}% strength)` : ''}` });
  if (strained.length) t.events.push({ type: 'supply', text: `Supply strained: ${strained.join(', ')}` });
  if (noContact.length) t.events.push({ type: 'command', text: `Out of contact with their headquarters: ${noContact.join(', ')}` });
  const linkNames = [...new Set(cuts.map((c) => (c.link ? doc.network.links.find((l) => l.id === c.link)?.name || 'A line' : doc.network.nodes.find((x) => x.id === c.node)?.name || 'A depot')))];
  if (linkNames.length) t.events.push({ type: 'link', text: `Cut by enemy units: ${linkNames.join(', ')}` });
  return res;
}

/** Applies what's scheduled for turn n: units arrive or withdraw, the weather changes. */
export function applySchedule(doc, t, n) {
  for (const item of (doc.schedule || []).filter((x) => Number(x.turn) === n)) {
    if (item.type === 'arrive' && item.unit && Array.isArray(item.lngLat)) {
      const before = t.events.length;
      const u = addUnit(doc, t, { ...item.unit, lngLat: item.lngLat });
      t.events.splice(before);
      t.events.push({ type: 'arrive', unit: u.id, text: `${u.name} arrives` });
    } else if (item.type === 'withdraw') {
      const u = t.units.find((x) => x.id === item.unitId);
      if (!u) continue;
      removeUnit(t, u.id);
      t.events = t.events.filter((e) => e.type !== 'remove' || !e.text.startsWith(u.name));
      t.events.push({ type: 'withdraw', text: `${u.name} withdraws` });
    } else if (item.type === 'weather' && WEATHER[item.weather]) {
      t.weather = item.weather;
      t.events.push({ type: 'weather', text: `Weather: ${WEATHER[item.weather].label}` });
    }
  }
}

/** Sets a line's or depot's status on a turn and logs it. */
export function setLinkStatus(doc, turn, id, status) {
  const item = (doc.network?.links || []).find((l) => l.id === id) || (doc.network?.nodes || []).find((x) => x.id === id);
  if (!item) return null;
  turn.links = { ...(turn.links || {}), [id]: status };
  turn.events = turn.events.filter((e) => !(e.type === 'link' && e.link === id));
  const label = { open: 'is open again', degraded: 'is degraded', cut: item.lngLat ? 'is lost' : 'is cut' }[status] || status;
  turn.events.push({ type: 'link', link: id, text: `${item.name || 'A line'} ${label}` });
  return item;
}

/* ---------- importing from a spreadsheet ---------- */

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s_\-()]+/g, '').replace(/km$|kmh$|\(km\)$/, '');
const pick = (row, idx, ...names) => { for (const n of names) if (idx[n] != null && row[idx[n]] != null && String(row[idx[n]]).trim() !== '') return String(row[idx[n]]).trim(); return ''; };
const KIND_ALIASES = { tank: 'armor', tanks: 'armor', armour: 'armor', armored: 'armor', mechanized: 'mech', mechanised: 'mech', arty: 'artillery', reconnaissance: 'recon', cavalry: 'recon', engineers: 'engineer', headquarters: 'hq', commandpost: 'command', ambulance: 'ems', firerescue: 'fire', fireandrescue: 'fire', civilian: 'civilians', warship: 'ship', helo: 'helicopter', logistics: 'supply', signals: 'signal' };
const SIDE_COLORS = ['#7c3aed', '#0891b2', '#ca8a04', '#db2777', '#4b5563'];

function indexOf(header) {
  const idx = {};
  header.forEach((h, i) => { idx[norm(h)] = i; });
  return idx;
}

export const ORBAT_TEMPLATE = [
  'name,side,kind,size,strength,status,latitude,longitude,range_km,speed_kmh,sensor_km,reports_to,mobility,seen,notes',
  '2nd Brigade HQ,Blue,Headquarters,Brigade,100,ready,38.895,-77.008,,,10,,,,',
  '1st Battalion,Blue,Infantry,Battalion,100,ready,38.887,-77.045,3,,4,2nd Brigade HQ,,,Holding the bridge',
  'Tank Company,Blue,Armor,Company,100,ready,38.905,-77.020,4,40,4,2nd Brigade HQ,,,',
  '12th Mech,Red,Mechanized infantry,Battalion,100,ready,38.880,-77.115,4,30,5,,,yes,',
].join('\n');

/**
 * Units from a spreadsheet (CSV): { units: [unit fields + _parent name], sides: [sides to add], warnings }.
 * Rows without coordinates are laid out in a block around `center`.
 */
export function unitsFromCsv(doc, text, center = [0, 0]) {
  const [header, ...rows] = parseCsv(String(text).replace(/^﻿/, ''));
  if (!header) throw new Error('The file is empty.');
  const idx = indexOf(header);
  if (idx.name == null) throw new Error('The first row needs a "name" column.');
  const sides = [];
  const allSides = () => [...doc.sides, ...sides];
  const warnings = [];
  const units = [];
  let unplaced = 0;
  rows.forEach((row, n) => {
    const name = pick(row, idx, 'name');
    if (!name) return;
    const sideName = pick(row, idx, 'side', 'force', 'team');
    let side = sideName ? allSides().find((s) => norm(s.id) === norm(sideName) || norm(s.name) === norm(sideName)) : allSides()[0];
    if (!side) {
      side = { id: norm(sideName).replace(/[^a-z0-9]/g, '') || uid('s'), name: sideName, color: SIDE_COLORS[sides.length % SIDE_COLORS.length], affiliation: 'U' };
      sides.push(side);
    }
    const kindName = norm(pick(row, idx, 'kind', 'type', 'unittype'));
    let kind = Object.keys(KINDS).find((k) => k === kindName || norm(KINDS[k].label) === kindName) || KIND_ALIASES[kindName];
    if (!kind && kindName) { kind = Object.keys(KINDS).find((k) => norm(KINDS[k].label).includes(kindName) || kindName.includes(k)); }
    if (!kind) { kind = 'other'; if (kindName) warnings.push(`Row ${n + 2}: "${pick(row, idx, 'kind', 'type', 'unittype')}" isn't a kind Waymark knows, so ${name} is "Other".`); }
    const sizeName = norm(pick(row, idx, 'size', 'echelon'));
    const echelon = !sizeName ? '' : Object.entries(SIZE_LABEL).find(([k, l]) => norm(k) === sizeName || l === sizeName || `${l}s` === sizeName)?.[0] ?? '';
    const statusName = norm(pick(row, idx, 'status'));
    const status = ['ready', 'engaged', 'degraded', 'destroyed'].find((s) => s === statusName || norm(statusLabel(s)) === statusName) || 'ready';
    const lat = parseFloat(pick(row, idx, 'latitude', 'lat', 'y'));
    const lng = parseFloat(pick(row, idx, 'longitude', 'lon', 'lng', 'long', 'x'));
    let lngLat;
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) lngLat = [lng, lat];
    else { const k = unplaced++; lngLat = [center[0] + ((k % 8) - 3.5) * 0.01, center[1] - Math.floor(k / 8) * 0.008]; }
    const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
    const strength = pick(row, idx, 'strength', 'strengthpct');
    const mob = norm(pick(row, idx, 'mobility', 'movement'));
    const seen = norm(pick(row, idx, 'seen', 'spotted', 'visible'));
    units.push({
      name, side: side.id, kind, echelon, status, lngLat,
      strength: strength === '' ? 100 : clamp(Math.round(num(strength)), 0, 100),
      rangeKm: num(pick(row, idx, 'range', 'rangekm')), speedKmh: num(pick(row, idx, 'speed', 'speedkmh', 'speedkm')),
      sensorKm: num(pick(row, idx, 'sensor', 'sensorkm', 'detection')),
      mobility: Object.keys(MOBILITY).find((k) => k === mob || norm(MOBILITY[k].label) === mob) || undefined,
      spotted: ['yes', 'y', 'true', '1', 'seen'].includes(seen),
      notes: pick(row, idx, 'notes', 'note', 'comments'),
      _parent: pick(row, idx, 'reportsto', 'parent', 'hq', 'higher'),
    });
  });
  if (unplaced) warnings.push(`${unplaced} ${unplaced === 1 ? 'unit has' : 'units have'} no coordinates and ${unplaced === 1 ? 'is' : 'are'} placed in a block in the middle of the map.`);
  return { units, sides, warnings };
}

export const INJECTS_TEMPLATE = [
  'title,details,turn,latitude,longitude',
  'Key Bridge destroyed,A demolition charge has dropped the center span.,2,38.9022,-77.0699',
  'Fog grounds aircraft,Visibility under 200 m along the river. No air support this turn.,,,',
].join('\n');

/** Injects from a spreadsheet (CSV): title, details, turn (blank = released by hand), latitude, longitude. */
export function injectsFromCsv(text) {
  const [header, ...rows] = parseCsv(String(text).replace(/^﻿/, ''));
  if (!header) throw new Error('The file is empty.');
  const idx = indexOf(header);
  if (idx.title == null) throw new Error('The first row needs a "title" column.');
  return rows.map((row) => {
    const title = pick(row, idx, 'title', 'name', 'event');
    if (!title) return null;
    const turn = parseInt(pick(row, idx, 'turn', 'at', 'when'), 10);
    const lat = parseFloat(pick(row, idx, 'latitude', 'lat', 'y'));
    const lng = parseFloat(pick(row, idx, 'longitude', 'lon', 'lng', 'long', 'x'));
    return { id: uid('i'), title: title.slice(0, 120), text: pick(row, idx, 'details', 'text', 'description', 'message').slice(0, 1200), turn: turn > 0 ? turn : null,
      ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lngLat: [lng, lat] } : {}) };
  }).filter(Boolean);
}

/* ---------- the after-action story ---------- */

/** Lines of communication, objectives and planning graphics for one turn, as features for the story's maps. */
export function storyFeatures(doc, branch, n) {
  const turn = branch.turns[n];
  const features = [];
  for (const link of doc.network?.links || []) {
    if (!(link.coords?.length > 1)) continue;
    const st = statusOf(turn, link.id);
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: link.coords },
      properties: { name: link.name || LINK_TYPES[link.type]?.label, stroke: st === 'cut' ? '#dc2626' : st === 'degraded' ? '#d97706' : link.side ? sideOf(doc, link.side).color : LINK_TYPES[link.type]?.color || '#57534e', 'stroke-width': 3, ...(st === 'open' ? {} : { 'stroke-dash': 'dashed' }) } });
  }
  const ctl = controlAt(doc, branch, n);
  for (const o of doc.objectives || []) {
    const holder = ctl[o.id];
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: o.lngLat },
      properties: { name: o.name, text: `★ ${o.name}${holder === 'contested' ? ' (contested)' : holder ? ` (${sideOf(doc, holder).name})` : ''}`, 'text-size': 14, stroke: holder && holder !== 'contested' ? sideOf(doc, holder).color : '#6b7280' } });
  }
  for (const g of turn.graphics || []) {
    if (!(g.coords?.length > 1)) continue;
    const color = g.type === 'obstacle' ? '#d97706' : g.type === 'ea' ? '#dc2626' : g.side ? sideOf(doc, g.side).color : '#111827';
    const isPoly = g.type === 'area' || g.type === 'ea' || g.type === 'nai';
    const coords = isPoly ? [...g.coords, g.coords[0]] : g.coords;
    features.push({
      type: 'Feature',
      geometry: isPoly ? { type: 'Polygon', coordinates: [coords] } : { type: 'LineString', coordinates: coords },
      properties: {
        name: g.label || '',
        stroke: color,
        fill: color,
        'fill-opacity': g.type === 'ea' ? 0.18 : 0.1,
        'stroke-width': g.type === 'arrow' || g.type === 'flot' ? 4 : g.type === 'obstacle' ? 3 : 2,
        ...(g.type === 'phase' || isPoly || g.type === 'obstacle' ? { 'stroke-dash': 'dashed' } : {}),
        ...(g.type === 'arrow' ? { arrow: true } : {}),
      },
    });
  }
  return features;
}
