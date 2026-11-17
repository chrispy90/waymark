// UTM and MGRS (the military grid) on the WGS84 ellipsoid: coordinates, grid references, true bearings, and grid lines
// for drawing a grid over a map. No dependencies and no DOM, so it works in the browser and in Node tests.

const A = 6378137; // WGS84 semi-major axis (m)
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const RAD = Math.PI / 180;
const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
const COLS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

/** The UTM zone for a point, including the Norway and Svalbard exceptions. */
export function utmZone(lng, lat) {
  let z = Math.floor((((lng + 180) % 360) + 360) % 360 / 6) + 1;
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) z = 32;
  if (lat >= 72 && lat < 84) {
    if (lng >= 0 && lng < 9) z = 31; else if (lng >= 9 && lng < 21) z = 33; else if (lng >= 21 && lng < 33) z = 35; else if (lng >= 33 && lng < 42) z = 37;
  }
  return z;
}
const centralMeridian = (zone) => (zone - 1) * 6 - 180 + 3;

/** [lng, lat] → { zone, south, easting, northing } (metres). `zone` can be forced, for a grid that spans a zone edge. */
export function toUtm([lng, lat], zone = utmZone(lng, lat)) {
  const phi = lat * RAD;
  const lam = (lng - centralMeridian(zone)) * RAD;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const t = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * s * s);
  const T = t * t;
  const C = EP2 * c * c;
  const Aa = c * lam;
  const M = A * ((1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * phi - ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));
  const easting = K0 * N * (Aa + ((1 - T + C) * Aa ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5) / 120) + 500000;
  let northing = K0 * (M + N * t * ((Aa * Aa) / 2 + ((5 - T + 9 * C + 4 * C * C) * Aa ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6) / 720));
  const south = lat < 0;
  if (south) northing += 10000000;
  return { zone, south, easting, northing };
}

/** { zone, south, easting, northing } → [lng, lat]. */
export function fromUtm({ zone, south, easting, northing }) {
  const x = easting - 500000;
  const y = south ? northing - 10000000 : northing;
  const M = y / K0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1);
  const c = Math.cos(phi1);
  const t = Math.tan(phi1);
  const N1 = A / Math.sqrt(1 - E2 * s * s);
  const T1 = t * t;
  const C1 = EP2 * c * c;
  const R1 = (A * (1 - E2)) / (1 - E2 * s * s) ** 1.5;
  const D = x / (N1 * K0);
  const lat = phi1 - ((N1 * t) / R1) * ((D * D) / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);
  const lng = (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) / c;
  return [centralMeridian(zone) + lng / RAD, lat / RAD];
}

/** The MGRS grid reference of a point, e.g. "18S UJ 22850 07430" (precision 5 = 1 m, 4 = 10 m, 3 = 100 m). */
export function toMgrs([lng, lat], precision = 5) {
  if (lat < -80 || lat > 84) return null; // the polar regions use a different grid
  const u = toUtm([lng, lat]);
  const band = BANDS[Math.min(19, Math.floor((lat + 80) / 8))];
  const col = COLS[(u.zone - 1) % 3][Math.floor(u.easting / 100000) - 1] || '?';
  const row = ROWS[(Math.floor(u.northing / 100000) + (u.zone % 2 === 0 ? 5 : 0)) % 20];
  const digits = (v) => String(Math.floor((v % 100000) / 10 ** (5 - precision))).padStart(precision, '0');
  return `${u.zone}${band} ${col}${row} ${digits(u.easting)} ${digits(u.northing)}`;
}

/** Initial true bearing (degrees, 0–360) from a to b along the great circle. */
export function bearing(a, b) {
  const [l1, p1, l2, p2] = [a[0] * RAD, a[1] * RAD, b[0] * RAD, b[1] * RAD];
  const y = Math.sin(l2 - l1) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
/** NATO mils: 6400 to a circle. */
export const toMils = (deg) => Math.round((deg / 360) * 6400) % 6400;

/** A sensible grid spacing (m) for a map view about `widthKm` across: up to 28 lines. */
export function gridSpacing(widthKm) {
  for (const m of [100, 1000, 10000, 100000]) if ((widthKm * 1000) / m <= 28) return m;
  return 100000;
}

/**
 * UTM grid lines for a view ([west, south, east, north]), in the zone of its center and clipped to that zone:
 * { zone, spacing, lines: [{ kind: 'e' | 'n', value, label, coords: [[lng, lat]…] }] }.
 */
export function gridLines(bounds, spacing) {
  const [w, s, e, n] = bounds;
  const center = [(w + e) / 2, (s + n) / 2];
  const zone = utmZone(...center);
  const south = center[1] < 0;
  const zw = centralMeridian(zone) - 3;
  const ze = centralMeridian(zone) + 3;
  const samples = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) samples.push([w + ((e - w) * i) / 4, s + ((n - s) * j) / 4]);
  const pts = samples.map((p) => toUtm(p, zone)).map((u) => (south !== u.south ? { ...u, northing: u.northing + (south ? -10000000 : 10000000) } : u));
  const [e0, e1] = [Math.min(...pts.map((p) => p.easting)), Math.max(...pts.map((p) => p.easting))];
  const [n0, n1] = [Math.min(...pts.map((p) => p.northing)), Math.max(...pts.map((p) => p.northing))];
  const label = (v) => (spacing >= 100000 ? String(Math.floor(v / 100000)) : spacing >= 1000 ? String(Math.floor(v / 1000) % 100).padStart(2, '0') : String(Math.floor(v / 100) % 1000).padStart(3, '0'));
  const inZone = (p) => p[0] >= zw - 1e-9 && p[0] <= ze + 1e-9;
  const lines = [];
  const steps = 24;
  const run = (kind, value, from, to) => {
    const coords = [];
    for (let k = 0; k <= steps; k++) {
      const v = from + ((to - from) * k) / steps;
      const p = kind === 'e' ? fromUtm({ zone, south, easting: value, northing: v }) : fromUtm({ zone, south, easting: v, northing: value });
      if (inZone(p)) coords.push(p);
    }
    if (coords.length > 1) lines.push({ kind, value, label: label(value), coords });
  };
  if ((e1 - e0) / spacing > 60 || (n1 - n0) / spacing > 60) return { zone, spacing, lines };
  for (let v = Math.ceil(e0 / spacing) * spacing; v <= e1; v += spacing) run('e', v, n0, n1);
  for (let v = Math.ceil(n0 / spacing) * spacing; v <= n1; v += spacing) run('n', v, e0, e1);
  return { zone, spacing, lines };
}
