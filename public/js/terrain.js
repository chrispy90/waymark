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
