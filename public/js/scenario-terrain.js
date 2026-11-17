// Builds a scenario's terrain grid: hex cells over an area, each with its ground cover, best road, whether a river
// crosses it, and its elevation. Elevation comes from the same open elevation tiles as the analysis tools; roads,
// rivers, water, forest and built-up areas from OpenStreetMap (Overpass API). Built once, then saved with the scenario.
import { sampleElevations } from './terrain.js';
import { gridSize, packCell, encodeElevation, pointInRing, terrainOf } from './scenario-rules.js';

export const MAX_CELLS = 30000;
export const CELL_SIZES = [0.1, 0.25, 0.5, 1, 2, 5, 10];
// The main Overpass server, then a public mirror if it's busy.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
export const TERRAIN_CREDIT = 'Terrain: elevation from Mapzen Terrarium / AWS Open Data; roads, rivers, water, forest and built-up areas © OpenStreetMap contributors';

/** The smallest cell size that keeps the grid to a comfortable number of cells for an area. */
export function suggestCellKm(bounds) {
  return CELL_SIZES.find((k) => gridSize(bounds, k).cells <= 12000) || CELL_SIZES.at(-1);
}

const MAJOR = /^(motorway|trunk|primary|secondary)(_link)?$/;
const MINOR = /^(tertiary|tertiary_link|unclassified|residential|track|service)$/;
const URBAN = /^(residential|commercial|industrial|retail)$/;

function query([w, s, e, n], cellKm) {
  const bb = `(${s},${w},${n},${e})`;
  const fine = cellKm <= 2;
  const parts = [
    `way["highway"~"^(motorway|trunk|primary${fine ? '|secondary|tertiary' : ''})(_link)?$"]${bb};`,
    cellKm <= 0.5 ? `way["highway"~"^(unclassified|residential|track)$"]${bb};` : '',
    `way["waterway"~"^(river|canal)$"]${bb};`,
    `way["natural"="water"]${bb};`, `relation["natural"="water"]${bb};`, `way["waterway"="riverbank"]${bb};`, `way["landuse"="reservoir"]${bb};`,
    fine ? `way["landuse"~"^(forest|residential|commercial|industrial|retail)$"]${bb}; relation["landuse"~"^(forest|residential)$"]${bb}; way["natural"~"^(wood|wetland)$"]${bb}; relation["natural"~"^(wood|wetland)$"]${bb};`
      : `node["place"~"^(city|town)$"]${bb};`,
  ];
  return `[out:json][timeout:90][maxsize:268435456];(${parts.join('')});out geom qt;`;
}

// Joins the outer ways of a multipolygon into closed rings.
function rings(members) {
  const parts = members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry?.length > 1).map((m) => m.geometry.map((p) => [p.lon, p.lat]));
  const out = [];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (parts.length) {
    let ring = parts.shift();
    let grew = true;
    while (!same(ring[0], ring.at(-1)) && grew) {
      grew = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (same(p[0], ring.at(-1))) ring = ring.concat(p.slice(1));
        else if (same(p.at(-1), ring.at(-1))) ring = ring.concat(p.slice(0, -1).reverse());
        else continue;
        parts.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length > 3) out.push(ring);
  }
  return out;
}

const RANK = [0, 1, 3, 4, 2]; // open < forest < marsh < built-up < water, by cover code

/**
 * Builds the terrain for `bounds` ([west, south, east, north]) with cells `cellKm` apart. `onProgress(text)` reports
 * each step. Returns the grid to store as the scenario's `terrain`; `grid.partial` says what couldn't be fetched.
 */
export async function buildTerrain(bounds, cellKm, { onProgress = () => {} } = {}) {
  const g = gridSize(bounds, cellKm);
  if (g.cells > MAX_CELLS) throw new Error(`That's ${g.cells.toLocaleString()} cells, more than the ${MAX_CELLS.toLocaleString()} limit. Choose bigger cells or zoom in.`);
  const base = { origin: g.origin, size: g.size, cols: g.cols, rows: g.rows, kx: g.kx, cover: 'A'.repeat(g.cells), elev: '' };
  const T = terrainOf(base);
  const cover = new Uint8Array(T.n);
  const road = new Uint8Array(T.n);
  const river = new Uint8Array(T.n);
  const partial = [];

  // Elevation, at a zoom whose pixels are about half a cell
  onProgress(`Reading elevation for ${T.n.toLocaleString()} cells…`);
  const lat = (bounds[1] + bounds[3]) / 2;
  const zoom = Math.max(5, Math.min(12, Math.ceil(Math.log2((156543 * Math.cos((lat * Math.PI) / 180)) / (cellKm * 500)))));
  const centers = Array.from({ length: T.n }, (_, i) => T.center(i));
  let elev = [];
  try { elev = await sampleElevations(centers, { zoom }); } catch { elev = []; }
  if (!elev.some((v) => v != null)) partial.push('elevation');
  // The sea floor is below sea level in the elevation data: treat deep cells as water.
  elev.forEach((v, i) => { if (v != null && v <= -10) cover[i] = 3; });

  // Map features
  onProgress('Getting roads, rivers, water, forest and towns from OpenStreetMap…');
  let elements = [];
  let got = false;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query(bounds, cellKm))}` });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      elements = (await res.json()).elements || [];
      got = true;
      break;
    } catch { onProgress('OpenStreetMap is busy, trying a mirror…'); }
  }
  if (!got) partial.push('map features');

  onProgress(`Laying ${elements.length.toLocaleString()} map features onto the grid…`);
  const setCover = (i, c) => { if (i >= 0 && RANK[c] > RANK[cover[i]]) cover[i] = c; };
  const fillRing = (ring, c) => {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const [w, s, e, n] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const r0 = Math.max(0, Math.floor(((s - T.grid.origin[1]) * T.ky) / (1.5 * T.s)) - 1);
    const r1 = Math.min(T.rows - 1, Math.ceil(((n - T.grid.origin[1]) * T.ky) / (1.5 * T.s)) + 1);
    const c0 = Math.max(0, Math.floor(((w - T.grid.origin[0]) * T.kx) / T.step) - 1);
    const c1 = Math.min(T.cols - 1, Math.ceil(((e - T.grid.origin[0]) * T.kx) / T.step) + 1);
    let hit = false;
    for (let r = r0; r <= r1; r++) {
      for (let col = c0; col <= c1; col++) {
        const i = r * T.cols + col;
        if (pointInRing(T.center(i), ring)) { setCover(i, c); hit = true; }
      }
    }
    // Features smaller than a cell still count for the cell they sit in.
    if (!hit) setCover(T.cellAt([(w + e) / 2, (s + n) / 2]), c);
  };
  const walk = (coords, mark) => {
    for (let k = 1; k < coords.length; k++) {
      const [a, b] = [coords[k - 1], coords[k]];
      const km = Math.hypot((b[0] - a[0]) * T.kx, (b[1] - a[1]) * T.ky);
      const steps = Math.max(1, Math.ceil(km / (T.s * 0.5)));
      for (let j = 0; j <= steps; j++) { const i = T.cellAt([a[0] + ((b[0] - a[0]) * j) / steps, a[1] + ((b[1] - a[1]) * j) / steps]); if (i >= 0) mark(i); }
    }
  };
  const coverFor = (t) => (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' ? 3
    : URBAN.test(t.landuse || '') ? 2 : t.natural === 'wetland' ? 4 : t.landuse === 'forest' || t.natural === 'wood' ? 1 : -1);
  for (const el of elements) {
    const t = el.tags || {};
    if (el.type === 'node' && t.place) {
      const radius = t.place === 'city' ? 3 : 1.2;
      const center = [el.lon, el.lat];
      const i0 = T.cellAt(center);
      if (i0 < 0) continue;
      const span = Math.ceil(radius / T.step) + 1;
      const row0 = (i0 / T.cols) | 0;
      const col0 = i0 % T.cols;
      for (let r = Math.max(0, row0 - span); r <= Math.min(T.rows - 1, row0 + span); r++) {
        for (let col = Math.max(0, col0 - span); col <= Math.min(T.cols - 1, col0 + span); col++) {
          const i = r * T.cols + col;
          const [x, y] = T.center(i);
          if (Math.hypot((x - el.lon) * T.kx, (y - el.lat) * T.ky) <= radius) setCover(i, 2);
        }
      }
      continue;
    }
    const geom = el.type === 'way' ? (el.geometry || []).map((p) => [p.lon, p.lat]) : null;
    if (t.highway && geom) { const lvl = MAJOR.test(t.highway) ? 2 : MINOR.test(t.highway) ? 1 : 0; if (lvl) walk(geom, (i) => { if (lvl > road[i]) road[i] = lvl; }); continue; }
    if ((t.waterway === 'river' || t.waterway === 'canal') && geom) { walk(geom, (i) => { river[i] = 1; }); continue; }
    const c = coverFor(t);
    if (c < 0) continue;
    if (geom) { if (geom.length > 3) fillRing(geom, c); } else if (el.type === 'relation') rings(el.members || []).forEach((ring) => fillRing(ring, c));
  }

  onProgress('Saving the terrain…');
  let packed = '';
  for (let i = 0; i < T.n; i++) packed += packCell(cover[i], road[i], river[i] && cover[i] !== 3);
  return {
    origin: g.origin, size: g.size, cols: g.cols, rows: g.rows, kx: g.kx, cellKm, cover: packed,
    elev: elev.length ? encodeElevation(elev) : '', built: new Date().toISOString(), bounds,
    ...(partial.length ? { partial: partial.join(' and ') } : {}),
  };
}
