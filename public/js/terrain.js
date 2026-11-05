// Terrain sampling from the free AWS Terrarium DEM (the same tiles that drive 3D terrain).
// Pure helpers (decode, tile math, profile stats) run in Node; sampling fetches PNG tiles in the browser.
import { haversineKm } from './gisfiles.js';

export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const DEM_ATTRIBUTION = 'Elevation: Mapzen Terrarium / AWS Open Data (SRTM, 3DEP, ETOPO1)';

/** Terrarium encoding: meters = R*256 + G + B/256 - 32768. */
export const decodeTerrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

/** Web-mercator tile + pixel for a lng/lat at zoom z (256px tiles). */
export function lngLatToTilePixel([lng, lat], z) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const latR = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const tx = Math.floor(x); const ty = Math.floor(y);
  return { tx, ty, px: Math.min(255, Math.floor((x - tx) * 256)), py: Math.min(255, Math.floor((y - ty) * 256)) };
}

/** Evenly spaced points along a polyline: [{ c:[lng,lat], km }]. */
export function densifyLine(coords, samples = 100) {
  const pts = coords.map((c) => [c[0], c[1]]);
  if (pts.length < 2) return pts.map((c) => ({ c, km: 0 }));
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = haversineKm(pts[i - 1], pts[i]); seg.push(d); total += d; }
  const n = Math.max(2, Math.min(1000, Math.round(samples)));
  const out = [];
  let i = 0; let acc = 0;
  for (let s = 0; s < n; s++) {
    const target = (total * s) / (n - 1);
    while (i < seg.length - 1 && acc + seg[i] < target) { acc += seg[i]; i++; }
    const t = seg[i] ? Math.min(1, (target - acc) / seg[i]) : 0;
    const a = pts[i]; const b = pts[i + 1];
    out.push({ c: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], km: target });
  }
  return out;
}

/** Gain, loss, min/max and steepest grade (%) for samples with { km, elev }. */
export function profileStats(samples) {
  let gain = 0; let loss = 0; let maxGrade = 0;
  const grades = [0];
  for (let i = 1; i < samples.length; i++) {
    const dz = samples[i].elev - samples[i - 1].elev;
    const dm = (samples[i].km - samples[i - 1].km) * 1000;
    if (dz > 0) gain += dz; else loss -= dz;
    const g = dm > 0 ? (dz / dm) * 100 : 0;
    grades.push(g);
    if (Math.abs(g) > Math.abs(maxGrade)) maxGrade = g;
  }
  const e = samples.map((s) => s.elev);
  return {
    grades,
    gain_m: Math.round(gain), loss_m: Math.round(loss),
    min_m: Math.round(Math.min(...e)), max_m: Math.round(Math.max(...e)),
    max_grade_pct: Math.round(maxGrade * 10) / 10,
    length_km: Math.round((samples.at(-1)?.km || 0) * 1000) / 1000,
  };
}

/* ---------- Browser sampling ---------- */

const tileCache = new Map();
async function tilePixels(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (!tileCache.has(key)) {
    tileCache.set(key, (async () => {
      const res = await fetch(DEM_TILES.replace('{z}', z).replace('{x}', x).replace('{y}', y), { mode: 'cors' });
      if (!res.ok) throw new Error(`Elevation tile ${key} failed (${res.status})`);
      const bmp = await createImageBitmap(await res.blob());
      const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, 256, 256).data;
    })());
    if (tileCache.size > 400) tileCache.delete(tileCache.keys().next().value);
  }
  return tileCache.get(key);
}

/** Elevation (m) for each [lng,lat]. Zoom 12 ≈ 30 m pixels: a good balance of detail and tile count. */
export async function sampleElevations(coords, { zoom = 12 } = {}) {
  const out = new Array(coords.length);
  await Promise.all(coords.map(async (c, i) => {
    const { tx, ty, px, py } = lngLatToTilePixel(c, zoom);
    try {
      const d = await tilePixels(zoom, tx, ty);
      const o = (py * 256 + px) * 4;
      out[i] = Math.round(decodeTerrarium(d[o], d[o + 1], d[o + 2]) * 10) / 10;
    } catch { out[i] = null; }
  }));
  return out;
}

/* ---------- Geospatial Cost Surface & Least-Cost Path Engine ---------- */

/**
 * Tobler's hiking function (1993): off-path walking speed in km/h as a function of slope (%).
 * Peaks at ~6 km/h on a gentle -5% downhill grade and decays exponentially on steep ascents/descents.
 */
export function toblerHikingKmh(slopePct = 0) {
  const s = Number.isFinite(slopePct) ? slopePct / 100 : 0;
  return Math.max(0.25, 6 * Math.exp(-3.5 * Math.abs(s + 0.05)));
}

function roundN(n, d = 3) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

function featureCenter(f) {
  const g = f?.geometry;
  if (!g) return [0, 0];
  if (g.type === 'Point') return g.coordinates;
  const flat = [];
  const walk = (c) => (typeof c?.[0] === 'number' ? flat.push(c) : Array.isArray(c) && c.forEach(walk));
  walk(g.coordinates);
  if (!flat.length) return [0, 0];
  return [flat.reduce((s, c) => s + c[0], 0) / flat.length, flat.reduce((s, c) => s + c[1], 0) / flat.length];
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]; const yi = ring[i][1];
    const xj = ring[j][0]; const yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
  }
  return inside;
}

function pointInPolygonGeom(pt, geom) {
  if (!geom) return false;
  const checkPoly = (rings) => {
    if (!rings.length || !pointInRing(pt, rings[0])) return false;
    for (let i = 1; i < rings.length; i++) if (pointInRing(pt, rings[i])) return false;
    return true;
  };
  if (geom.type === 'Polygon') return checkPoly(geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some(checkPoly);
  return false;
}

function pointToSegmentKm(pt, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return haversineKm(pt, [a[0] + t * dx, a[1] + t * dy]);
}

function featureHitsCell(pt, cellRadiusKm, f) {
  const g = f?.geometry;
  if (!g) return false;
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
    if (pointInPolygonGeom(pt, g)) return true;
    const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
    return rings.some((r) => {
      for (let i = 1; i < r.length; i++) if (pointToSegmentKm(pt, r[i - 1], r[i]) <= cellRadiusKm * 0.85) return true;
      return false;
    });
  }
  if (g.type === 'LineString' || g.type === 'MultiLineString') {
    const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    return lines.some((l) => {
      for (let i = 1; i < l.length; i++) if (pointToSegmentKm(pt, l[i - 1], l[i]) <= cellRadiusKm) return true;
      return false;
    });
  }
  if (g.type === 'Point') return haversineKm(pt, g.coordinates) <= cellRadiusKm * 1.25;
  if (g.type === 'MultiPoint') return g.coordinates.some((c) => haversineKm(pt, c) <= cellRadiusKm * 1.25);
  return false;
}

/**
 * Builds an anisotropic / isotropic geospatial cost surface and runs Dijkstra wavefront propagation
 * from `origins`. Supports DEM terrain slope (Tobler's hiking function) and barrier/corridor layers.
 */
export async function buildCostSurface({
  origins,
  destinations = null,
  barriers = null,
  resolution = 28,
  padKm = 2.5,
  useTerrain = true,
  barrierFactor = 5,
  zoom = 11,
  elevSampler = sampleElevations,
} = {}) {
  const origFeats = (origins?.features || []).filter((f) => f.geometry);
  if (!origFeats.length) throw new Error('Cost surface requires at least one origin feature.');
  const destFeats = (destinations?.features || []).filter((f) => f.geometry);
  const barFeats = (barriers?.features || []).filter((f) => f.geometry);

  const allPts = [...origFeats, ...destFeats].map(featureCenter);
  let minLng = Infinity; let minLat = Infinity; let maxLng = -Infinity; let maxLat = -Infinity;
  allPts.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });

  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const spanKm = Math.max(haversineKm([minLng, minLat], [maxLng, maxLat]), 1.5);
  const marginKm = Math.max(Number(padKm) || 2, spanKm * 0.22);
  const dLatPad = marginKm / 111.32;
  const dLngPad = marginKm / (111.32 * cosLat);
  minLat = Math.max(-84, minLat - dLatPad);
  maxLat = Math.min(84, maxLat + dLatPad);
  minLng -= dLngPad;
  maxLng += dLngPad;

  const cols = Math.max(10, Math.min(64, Math.round(Number(resolution) || 28)));
  const aspect = Math.max(0.4, Math.min(2.5, ((maxLat - minLat) / ((maxLng - minLng) * cosLat || 1e-6))));
  const rows = Math.max(10, Math.min(64, Math.round(cols * aspect)));

  const dLng = (maxLng - minLng) / cols;
  const dLat = (maxLat - minLat) / rows;
  const cellWKm = haversineKm([minLng, midLat], [minLng + dLng, midLat]);
  const cellHKm = haversineKm([minLng, minLat], [minLng, minLat + dLat]);
  const cellRadiusKm = Math.hypot(cellWKm, cellHKm) * 0.55;

  const nCells = rows * cols;
  const centers = new Array(nCells);
  for (let r = 0; r < rows; r++) {
    const lat = minLat + (r + 0.5) * dLat;
    for (let c = 0; c < cols; c++) {
      centers[r * cols + c] = [minLng + (c + 0.5) * dLng, lat];
    }
  }

  let elevs = new Array(nCells).fill(0);
  if (useTerrain && typeof elevSampler === 'function') {
    try {
      const sampled = await elevSampler(centers, { zoom });
      if (Array.isArray(sampled) && sampled.some((v) => v != null)) {
        const valid = sampled.find((v) => v != null) || 0;
        elevs = sampled.map((v) => (v == null ? valid : v));
      }
    } catch { /* fallback to flat 0m when offline */ }
  }

  // Compute per-cell friction multiplier from optional barriers / corridors layer
  const mult = new Float64Array(nCells).fill(1);
  const defaultFactor = Number.isFinite(Number(barrierFactor)) ? Number(barrierFactor) : 5;
  if (barFeats.length) {
    for (let i = 0; i < nCells; i++) {
      const pt = centers[i];
      for (const bf of barFeats) {
        if (featureHitsCell(pt, cellRadiusKm, bf)) {
          const p = bf.properties || {};
          const custom = Number(p.friction ?? p.cost ?? p.multiplier ?? p.weight);
          const fVal = Number.isFinite(custom) && custom >= 0 ? custom : defaultFactor;
          // 0 means impassable barrier
          if (fVal === 0) { mult[i] = Infinity; break; }
          mult[i] = Math.max(mult[i], fVal);
          if (fVal < 1 && mult[i] === 1) mult[i] = fVal;
        }
      }
    }
  }

  // Local terrain slope (%) at each cell from finite differences
  const cellSlopePct = new Float64Array(nCells);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const eL = elevs[r * cols + Math.max(0, c - 1)];
      const eR = elevs[r * cols + Math.min(cols - 1, c + 1)];
      const eD = elevs[Math.max(0, r - 1) * cols + c];
      const eU = elevs[Math.min(rows - 1, r + 1) * cols + c];
      const dzdx = (eR - eL) / (Math.max(1e-3, cellWKm * (c > 0 && c < cols - 1 ? 2 : 1)) * 1000);
      const dzdy = (eU - eD) / (Math.max(1e-3, cellHKm * (r > 0 && r < rows - 1 ? 2 : 1)) * 1000);
      cellSlopePct[idx] = Math.hypot(dzdx, dzdy) * 100;
    }
  }

  // Dijkstra wavefront with 8-neighbor king's graph connectivity
  const distMin = new Float64Array(nCells).fill(Infinity);
  const distKm = new Float64Array(nCells).fill(Infinity);
  const parent = new Int32Array(nCells).fill(-1);
  const originIdx = new Int32Array(nCells).fill(-1);
  const visited = new Uint8Array(nCells);

  // Binary min-heap keyed by distMin
  const heap = [];
  const push = (node, cost) => {
    heap.push({ node, cost });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].cost <= heap[i].cost) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      while (true) {
        const l = 2 * i + 1; const r = l + 1;
        let s = i;
        if (l < heap.length && heap[l].cost < heap[s].cost) s = l;
        if (r < heap.length && heap[r].cost < heap[s].cost) s = r;
        if (s === i) break;
        [heap[i], heap[s]] = [heap[s], heap[i]];
        i = s;
      }
    }
    return top;
  };

  const nearestCell = ([lng, lat]) => {
    const c = Math.max(0, Math.min(cols - 1, Math.floor((lng - minLng) / dLng)));
    const r = Math.max(0, Math.min(rows - 1, Math.floor((lat - minLat) / dLat)));
    return r * cols + c;
  };

  const originNames = origFeats.map((f, i) => {
    const p = f.properties || {};
    const k = Object.keys(p).find((key) => /^(name|title|label|id)$/i.test(key));
    return k && p[k] != null ? String(p[k]) : `Origin ${i + 1}`;
  });

  origFeats.forEach((f, oi) => {
    const idx = nearestCell(featureCenter(f));
    if (mult[idx] === Infinity) mult[idx] = 1; // Ensure origins themselves are passable
    distMin[idx] = 0;
    distKm[idx] = 0;
    originIdx[idx] = oi;
    push(idx, 0);
  });

  const dirs = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];

  while (heap.length) {
    const { node: u, cost: dU } = pop();
    if (visited[u]) continue;
    visited[u] = 1;
    const rU = Math.floor(u / cols);
    const cU = u % cols;

    for (const [dr, dc] of dirs) {
      const rV = rU + dr; const cV = cU + dc;
      if (rV < 0 || rV >= rows || cV < 0 || cV >= cols) continue;
      const v = rV * cols + cV;
      if (visited[v] || mult[v] === Infinity) continue;

      const stepKm = haversineKm(centers[u], centers[v]);
      const dz = elevs[v] - elevs[u];
      const slopePct = stepKm > 0 ? (dz / (stepKm * 1000)) * 100 : 0;
      const speedKmh = useTerrain ? toblerHikingKmh(slopePct) : 5.0;
      const avgMult = (mult[u] + mult[v]) / 2;
      const stepMin = (stepKm / speedKmh) * 60 * avgMult;
      const nextCost = dU + stepMin;

      if (nextCost < distMin[v]) {
        distMin[v] = nextCost;
        distKm[v] = distKm[u] + stepKm;
        parent[v] = u;
        originIdx[v] = originIdx[u];
        push(v, nextCost);
      }
    }
  }

  const finiteCosts = [...distMin].filter(Number.isFinite);
  const maxCost = Math.max(1e-6, ...finiteCosts);

  const features = [];
  for (let r = 0; r < rows; r++) {
    const y0 = roundN(minLat + r * dLat, 6);
    const y1 = roundN(minLat + (r + 1) * dLat, 6);
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const x0 = roundN(minLng + c * dLng, 6);
      const x1 = roundN(minLng + (c + 1) * dLng, 6);
      const reachable = Number.isFinite(distMin[idx]);
      const baseSpeed = useTerrain ? toblerHikingKmh(cellSlopePct[idx]) : 5.0;
      const unitFriction = mult[idx] === Infinity ? 999 : roundN((5.0 / baseSpeed) * mult[idx], 2);
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
        },
        properties: {
          cell_id: idx + 1,
          row: r + 1,
          col: c + 1,
          travel_time_min: reachable ? roundN(distMin[idx], 1) : null,
          cost_index: reachable ? roundN((distMin[idx] / maxCost) * 100, 1) : 100,
          distance_km: reachable ? roundN(distKm[idx], 2) : null,
          unit_friction: unitFriction,
          barrier_multiplier: mult[idx] === Infinity ? 'Impassable' : roundN(mult[idx], 2),
          elevation_m: roundN(elevs[idx], 1),
          slope_pct: roundN(cellSlopePct[idx], 1),
          nearest_origin: originIdx[idx] >= 0 ? originNames[originIdx[idx]] : 'Unreachable',
          passable: mult[idx] !== Infinity,
        },
      });
    }
  }

  return {
    grid: { type: 'FeatureCollection', features },
    rows, cols, minLng, minLat, maxLng, maxLat, dLng, dLat,
    centers, elevs, mult, distMin, distKm, parent, originIdx, originNames, nearestCell,
  };
}

function chaikinSmooth(coords, iterations = 2) {
  if (coords.length < 3) return coords;
  let pts = coords;
  for (let it = 0; it < iterations; it++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]; const b = pts[i + 1];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    next.push(pts.at(-1));
    pts = next;
  }
  return pts.map(([x, y]) => [roundN(x, 6), roundN(y, 6)]);
}

/**
 * Backtraces minimum-cost paths from `destinations` back to their optimal `origins` across a computed cost surface.
 */
export function traceLeastCostPaths(surface, destinations, { smooth = true } = {}) {
  const destFeats = (destinations?.features || []).filter((f) => f.geometry);
  if (!destFeats.length) throw new Error('Least-cost path requires at least one destination feature.');
  const { centers, elevs, distMin, parent, originIdx, originNames, nearestCell } = surface;
  const out = [];

  destFeats.forEach((df, di) => {
    const destPt = featureCenter(df);
    const p = df.properties || {};
    const k = Object.keys(p).find((key) => /^(name|title|label|id)$/i.test(key));
    const destName = k && p[k] != null ? String(p[k]) : `Destination ${di + 1}`;
    let curr = nearestCell(destPt);

    // If destination cell itself is unreachable, pick nearest reachable cell
    if (!Number.isFinite(distMin[curr])) {
      let best = -1; let bestD = Infinity;
      for (let i = 0; i < centers.length; i++) {
        if (!Number.isFinite(distMin[i])) continue;
        const d = haversineKm(destPt, centers[i]);
        if (d < bestD) { bestD = d; best = i; }
      }
      curr = best;
    }
    if (curr < 0 || !Number.isFinite(distMin[curr])) return;

    const chain = [];
    let guard = centers.length + 5;
    let node = curr;
    while (node >= 0 && guard-- > 0) {
      chain.push(node);
      if (parent[node] === -1) break;
      node = parent[node];
    }
    chain.reverse();
    if (chain.length < 2) {
      const origPt = centers[chain[0] || curr];
      if (haversineKm(origPt, destPt) < 1e-4) return;
      chain.push(curr);
    }

    const rawCoords = chain.map((idx) => centers[idx]);
    // Snap endpoints to exact origin/destination coordinates for visual precision
    rawCoords[rawCoords.length - 1] = [roundN(destPt[0], 6), roundN(destPt[1], 6)];
    const coords = smooth && rawCoords.length >= 3 ? chaikinSmooth(rawCoords, 2) : rawCoords.map(([x, y]) => [roundN(x, 6), roundN(y, 6)]);

    let pathKm = 0;
    for (let i = 1; i < coords.length; i++) pathKm += haversineKm(coords[i - 1], coords[i]);
    const straightKm = Math.max(0.001, haversineKm(coords[0], coords.at(-1)));

    let gain = 0; let loss = 0; let maxSlope = 0;
    for (let i = 1; i < chain.length; i++) {
      const dz = elevs[chain[i]] - elevs[chain[i - 1]];
      const dKm = haversineKm(centers[chain[i - 1]], centers[chain[i]]);
      if (dz > 0) gain += dz; else loss -= dz;
      const sl = dKm > 0 ? Math.abs((dz / (dKm * 1000)) * 100) : 0;
      if (sl > maxSlope) maxSlope = sl;
    }

    const origName = originIdx[curr] >= 0 ? originNames[originIdx[curr]] : 'Origin';
    out.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {
        origin: origName,
        destination: destName,
        route: `${origName} → ${destName}`,
        travel_time_min: roundN(distMin[curr], 1),
        distance_km: roundN(pathKm, 2),
        straight_km: roundN(straightKm, 2),
        detour_ratio: roundN(Math.max(1, pathKm / straightKm), 2),
        elev_gain_m: Math.round(gain),
        elev_loss_m: Math.round(loss),
        max_slope_pct: roundN(maxSlope, 1),
      },
    });
  });

  return { type: 'FeatureCollection', features: out };
}

