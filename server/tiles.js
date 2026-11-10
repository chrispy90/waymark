// Vector tiles for big hosted layers, made on request from the layer's GeoJSON. No dependencies.
// A layer is indexed once (projected to Web Mercator, one bounding box per feature) and kept in memory; each tile
// then picks the features that touch it, thins what can't be seen at that zoom, clips to the tile and writes
// Mapbox Vector Tile protobuf. Browsers only download what's on screen, so layers can hold millions of features.
const zlib = require('zlib');

const EXTENT = 4096;
const BUFFER = 64; // tile units drawn past each edge, so lines and outlines join up across tiles
const MAX_ZOOM = 14; // MapLibre overzooms past this
const LAYER_NAME = 'layer';

/* ---------- index ---------- */

const mercX = (lng) => lng / 360 + 0.5;
const mercY = (lat) => {
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return 0.5 - (0.25 * Math.log((1 + s) / (1 - s))) / Math.PI;
};

// kind: 1 point, 2 line, 3 polygon. parts: arrays of [x, y] in 0..1 mercator space.
function project(geom) {
  if (!geom) return null;
  const pt = (c) => [mercX(c[0]), mercY(c[1])];
  const ring = (cs) => cs.map(pt);
  switch (geom.type) {
    case 'Point': return { kind: 1, parts: [[pt(geom.coordinates)]] };
    case 'MultiPoint': return { kind: 1, parts: [ring(geom.coordinates)] };
    case 'LineString': return { kind: 2, parts: [ring(geom.coordinates)] };
    case 'MultiLineString': return { kind: 2, parts: geom.coordinates.map(ring) };
    case 'Polygon': return { kind: 3, parts: geom.coordinates.map(ring), polys: [geom.coordinates.length] };
    case 'MultiPolygon': return { kind: 3, parts: geom.coordinates.flatMap((p) => p.map(ring)), polys: geom.coordinates.map((p) => p.length) };
    default: return null;
  }
}

/** Builds the in-memory index for a FeatureCollection. */
function buildIndex(fc) {
  const feats = [];
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  (fc.features || []).forEach((f, i) => {
    let g;
    try { g = project(f.geometry); } catch { g = null; }
    if (!g) return;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const part of g.parts) for (const p of part) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    if (x0 === Infinity) return;
    feats.push({ id: i + 1, g, props: f.properties || {}, x0, y0, x1, y1 });
    if (x0 < minX) minX = x0; if (x1 > maxX) maxX = x1; if (y0 < minY) minY = y0; if (y1 > maxY) maxY = y1;
  });
  if (feats.length) {
    w = (minX - 0.5) * 360; e = (maxX - 0.5) * 360;
    const lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
    n = lat(minY); s = lat(maxY);
  }
  // A coarse grid of feature lists, so a tile doesn't have to look at every feature.
  const G = feats.length > 20000 ? 128 : 32;
  const grid = new Map();
  feats.forEach((f, idx) => {
    const [c0, c1, r0, r1] = [Math.floor(f.x0 * G), Math.floor(f.x1 * G), Math.floor(f.y0 * G), Math.floor(f.y1 * G)];
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > 64) { (grid.get(-1) || grid.set(-1, []).get(-1)).push(idx); return; } // very large features: checked for every tile
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) { const k = r * G + c; (grid.get(k) || grid.set(k, []).get(k)).push(idx); }
  });
  return { feats, grid, G, bbox: feats.length ? [w, s, e, n] : null, count: feats.length };
}

function candidates(index, x0, y0, x1, y1) {
  const { G, grid, feats } = index;
  const out = new Set(grid.get(-1) || []);
  const [c0, c1, r0, r1] = [Math.max(0, Math.floor(x0 * G)), Math.min(G - 1, Math.floor(x1 * G)), Math.max(0, Math.floor(y0 * G)), Math.min(G - 1, Math.floor(y1 * G))];
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) for (const i of grid.get(r * G + c) || []) out.add(i);
  const list = [];
  for (const i of out) { const f = feats[i]; if (f.x1 >= x0 && f.x0 <= x1 && f.y1 >= y0 && f.y0 <= y1) list.push(f); }
  return list.sort((a, b) => a.id - b.id);
}

/* ---------- clipping (in tile units) ---------- */

const LO = -BUFFER;
const HI = EXTENT + BUFFER;

// Cuts a line into the pieces that lie inside the buffered tile.
function clipLine(pts) {
  const out = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    let [ax, ay] = pts[i];
    let [bx, by] = pts[i + 1];
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    let ok = true;
    for (const [p, q] of [[-dx, ax - LO], [dx, HI - ax], [-dy, ay - LO], [dy, HI - ay]]) { // Liang–Barsky
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { cur = null; continue; }
    const a = [Math.round(ax + t0 * dx), Math.round(ay + t0 * dy)];
    const b = [Math.round(ax + t1 * dx), Math.round(ay + t1 * dy)];
    if (!cur || t0 > 0) { cur = [a]; out.push(cur); }
    cur.push(b);
    if (t1 < 1) cur = null;
  }
  return out.map(dedupe).filter((l) => l.length > 1);
}

// Sutherland–Hodgman: clips a ring against the buffered tile square.
function clipRing(ring) {
  let pts = ring;
  const edges = [
    [(p) => p[0] >= LO, (a, b) => [LO, a[1] + ((b[1] - a[1]) * (LO - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= HI, (a, b) => [HI, a[1] + ((b[1] - a[1]) * (HI - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= LO, (a, b) => [a[0] + ((b[0] - a[0]) * (LO - a[1])) / (b[1] - a[1]), LO]],
    [(p) => p[1] <= HI, (a, b) => [a[0] + ((b[0] - a[0]) * (HI - a[1])) / (b[1] - a[1]), HI]],
  ];
  for (const [inside, cut] of edges) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ain = inside(a);
      const bin = inside(b);
      if (ain) out.push(a);
      if (ain !== bin) out.push(cut(a, b));
    }
    pts = out;
    if (pts.length < 3) return null;
  }
  const r = dedupe(pts.map((p) => [Math.round(p[0]), Math.round(p[1])]));
  if (r.length > 1 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]) r.pop();
  return r.length >= 3 ? r : null;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) { const q = out.at(-1); if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); }
  return out;
}

// Drops points closer than `tol` tile units to the last kept one (first and last always stay).
function thin(pts, tol) {
  if (tol <= 0 || pts.length < 3) return pts;
  const out = [pts[0]];
  const t2 = tol * tol;
  for (let i = 1; i < pts.length - 1; i++) {
    const q = out.at(-1);
    const dx = pts[i][0] - q[0];
    const dy = pts[i][1] - q[1];
    if (dx * dx + dy * dy >= t2) out.push(pts[i]);
  }
  out.push(pts.at(-1));
  return out;
}

const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i]; const q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

/* ---------- protobuf ---------- */

class Pbf {
  constructor() { this.chunks = []; this.len = 0; }
  byte(b) { this.chunks.push(b); this.len++; }
  varint(v) { v = Math.floor(v); while (v > 0x7f) { this.byte((v % 128) | 0x80); v = Math.floor(v / 128); } this.byte(v); }
  tag(field, type) { this.varint(field * 8 + type); }
  bytes(field, buf) { this.tag(field, 2); this.varint(buf.length); this.chunks.push(buf); this.len += buf.length; }
  string(field, s) { this.bytes(field, Buffer.from(String(s), 'utf8')); }
  uint(field, v) { this.tag(field, 0); this.varint(v); }
  double(field, v) { this.tag(field, 1); const b = Buffer.alloc(8); b.writeDoubleLE(v); this.chunks.push(b); this.len += 8; }
  packed(field, nums) { const p = new Pbf(); for (const n of nums) p.varint(n); this.bytes(field, p.finish()); }
  finish() {
    const out = Buffer.allocUnsafe(this.len);
    let o = 0;
    for (const c of this.chunks) { if (typeof c === 'number') out[o++] = c; else { c.copy(out, o); o += c.length; } }
    return out;
  }
}
const zig = (n) => (n < 0 ? -n * 2 - 1 : n * 2);

function geometryCommands(kind, parts) {
  const cmds = [];
  let [cx, cy] = [0, 0];
  const move = (p) => { cmds.push(zig(p[0] - cx), zig(p[1] - cy)); cx = p[0]; cy = p[1]; };
  if (kind === 1) {
    const pts = parts[0];
    cmds.push((pts.length << 3) | 1);
    pts.forEach(move);
    return cmds;
  }
  for (const part of parts) {
    cmds.push((1 << 3) | 1);
    move(part[0]);
    cmds.push(((part.length - 1) << 3) | 2);
    for (let i = 1; i < part.length; i++) move(part[i]);
    if (kind === 3) cmds.push((1 << 3) | 7);
  }
  return cmds;
}

/* ---------- tile ---------- */

/** One tile as a gzipped Mapbox Vector Tile, or null when nothing falls in it. */
function makeTile(index, z, x, y) {
  const n = 2 ** z;
  const pad = BUFFER / EXTENT / n;
  const list = candidates(index, x / n - pad, y / n - pad, (x + 1) / n + pad, (y + 1) / n + pad);
  if (!list.length) return null;
  const toTile = (p) => [(p[0] * n - x) * EXTENT, (p[1] * n - y) * EXTENT];
  const detail = z < MAX_ZOOM; // below the top zoom, drop what's smaller than a pixel or two
  const minSize = detail ? 8 / EXTENT / n : 0; // about half a pixel, in mercator units
  const tol = detail ? 6 : 0;
  const taken = detail ? new Set() : null; // one point per 2-pixel cell
  const keys = [];
  const keyIx = new Map();
  const values = [];
  const valIx = new Map();
  const features = [];

  for (const f of list) {
    let parts;
    if (f.g.kind === 1) {
      const pts = [];
      for (const p of f.g.parts[0]) {
        const t = toTile(p).map(Math.round);
        if (t[0] < LO || t[0] > HI || t[1] < LO || t[1] > HI) continue;
        if (taken) { const cell = (t[1] >> 5) * 512 + (t[0] >> 5); if (taken.has(cell)) continue; taken.add(cell); }
        pts.push(t);
      }
      if (!pts.length) continue;
      parts = [pts];
    } else if (f.g.kind === 2) {
      if (Math.max(f.x1 - f.x0, f.y1 - f.y0) < minSize) continue;
      parts = f.g.parts.flatMap((part) => clipLine(thin(part.map(toTile), tol)));
      if (!parts.length) continue;
    } else {
      if (Math.max(f.x1 - f.x0, f.y1 - f.y0) < minSize) continue;
      parts = [];
      let at = 0;
      for (const count of f.g.polys) {
        const rings = f.g.parts.slice(at, at + count);
        at += count;
        const outer = clipRing(thin(rings[0].map(toTile), tol));
        if (!outer) continue;
        if (area(outer) < 0) outer.reverse(); // outer rings wind clockwise on screen (positive area), holes the other way
        parts.push(outer);
        for (const hole of rings.slice(1)) {
          const h = clipRing(thin(hole.map(toTile), tol));
          if (!h) continue;
          if (area(h) > 0) h.reverse();
          parts.push(h);
        }
      }
      if (!parts.length) continue;
    }
    const tags = [];
    for (const [k, v] of Object.entries(f.props)) {
      if (v == null || v === '' || typeof v === 'object') continue;
      let ki = keyIx.get(k);
      if (ki === undefined) { ki = keys.length; keys.push(k); keyIx.set(k, ki); }
      const val = typeof v === 'string' && v.length > 300 ? v.slice(0, 300) : v;
      const vk = `${typeof val}:${val}`;
      let vi = valIx.get(vk);
      if (vi === undefined) { vi = values.length; values.push(val); valIx.set(vk, vi); }
      tags.push(ki, vi);
    }
    features.push({ id: f.id, kind: f.g.kind, tags, cmds: geometryCommands(f.g.kind, parts) });
  }
  if (!features.length) return null;

  const layer = new Pbf();
  layer.uint(15, 2);
  layer.string(1, LAYER_NAME);
  for (const f of features) {
    const fb = new Pbf();
    fb.uint(1, f.id);
    if (f.tags.length) fb.packed(2, f.tags);
    fb.uint(3, f.kind);
    fb.packed(4, f.cmds);
    layer.bytes(2, fb.finish());
  }
  for (const k of keys) layer.string(3, k);
  for (const v of values) {
    const vb = new Pbf();
    if (typeof v === 'string') vb.string(1, v);
    else if (typeof v === 'boolean') vb.uint(7, v ? 1 : 0);
    else vb.double(3, Number(v));
    layer.bytes(4, vb.finish());
  }
  layer.uint(5, EXTENT);
  const tile = new Pbf();
  tile.bytes(3, layer.finish());
  return zlib.gzipSync(tile.finish(), { level: 6 });
}

/* ---------- caches ---------- */

const indexes = new Map(); // layer id -> { version, index, used }
const tiles = new Map(); // "id@version/z/x/y" -> Buffer | null
const MAX_INDEXES = 6;
const MAX_TILES = 3000;

/** The index for a layer at a version, building it with `load()` (returns the FeatureCollection) when needed. */
function indexFor(id, version, load) {
  const hit = indexes.get(id);
  if (hit && hit.version === version) { hit.used = Date.now(); return hit.index; }
  const index = buildIndex(load());
  indexes.set(id, { version, index, used: Date.now() });
  if (indexes.size > MAX_INDEXES) {
    const oldest = [...indexes.entries()].sort((a, b) => a[1].used - b[1].used)[0][0];
    indexes.delete(oldest);
  }
  for (const k of tiles.keys()) if (k.startsWith(`${id}@`) && !k.startsWith(`${id}@${version}/`)) tiles.delete(k);
  return index;
}

function tileFor(id, version, load, z, x, y) {
  const key = `${id}@${version}/${z}/${x}/${y}`;
  if (tiles.has(key)) return tiles.get(key);
  const buf = makeTile(indexFor(id, version, load), z, x, y);
  tiles.set(key, buf);
  if (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value);
  return buf;
}

const forget = (id) => { indexes.delete(id); for (const k of tiles.keys()) if (k.startsWith(`${id}@`)) tiles.delete(k); };

module.exports = { buildIndex, makeTile, indexFor, tileFor, forget, MAX_ZOOM, LAYER_NAME, EXTENT };
