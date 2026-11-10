// Reads zipped shapefiles (.zip holding .shp, .dbf and .prj) into GeoJSON, in the browser. No DOM here, so it can be
// tested in Node. Coordinates are converted to longitude/latitude from WGS 84, NAD83, Web Mercator and UTM;
// other coordinate systems are refused with a message that says so.

/* ---------- zip ---------- */

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lists a zip's files as { name, read(): Promise<Uint8Array> } (stored or deflated entries). */
export function unzip(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) if (u32(v, i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('That isn\'t a zip file');
  const count = u16(v, end + 10);
  let o = u32(v, end + 16);
  const files = [];
  for (let i = 0; i < count && u32(v, o) === 0x02014b50; i++) {
    const method = u16(v, o + 10);
    const size = u32(v, o + 20);
    const [nameLen, extraLen, commentLen] = [u16(v, o + 28), u16(v, o + 30), u16(v, o + 32)];
    const local = u32(v, o + 42);
    const name = new TextDecoder().decode(bytes.subarray(o + 46, o + 46 + nameLen));
    o += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    files.push({ name, read: async () => {
      const start = local + 30 + u16(v, local + 26) + u16(v, local + 28);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflate(data);
      throw new Error(`${name} uses a kind of zip compression that isn't supported`);
    } });
  }
  return files;
}

/* ---------- coordinate systems ---------- */

const R = 6378137;
const fromWebMercator = ([x, y]) => [(x / R) * (180 / Math.PI), (Math.atan(Math.sinh(y / R)) * 180) / Math.PI];

// Inverse transverse Mercator on the GRS80/WGS84 ellipsoid: lon0 in degrees, false easting/northing in metres.
function fromTransverseMercator(lon0deg, k0 = 0.9996, fe = 500000, fn = 0, lat0deg = 0) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const ep2 = e2 / (1 - e2);
  const lon0 = (lon0deg * Math.PI) / 180;
  const p0 = (lat0deg * Math.PI) / 180;
  const M0 = a * ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * p0 - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * p0)
    + ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * p0) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * p0));
  return ([x, y]) => {
    const M = M0 + (y - fn) / k0;
    const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
    const p1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
      + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
    const [s, c, t] = [Math.sin(p1), Math.cos(p1), Math.tan(p1)];
    const C1 = ep2 * c * c;
    const T1 = t * t;
    const N1 = a / Math.sqrt(1 - e2 * s * s);
    const R1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5;
    const D = (x - fe) / (N1 * k0);
    const lat = p1 - ((N1 * t) / R1) * ((D * D) / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24
      + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
    const lon = lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / c;
    return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
  };
}

/**
 * A function that converts a coordinate to longitude/latitude, from the text of a .prj file.
 * Returns null for coordinate systems that aren't supported. No .prj means longitude/latitude already.
 */
export function projectionFromPrj(wkt) {
  const text = String(wkt || '').trim();
  if (!text) return (c) => c;
  if (!/^PROJCS|^PROJCRS/i.test(text)) return (c) => c; // a geographic system: degrees already
  if (/Mercator_Auxiliary_Sphere|Popular.Visualisation|Pseudo.Mercator|Google/i.test(text)) return fromWebMercator;
  const param = (name) => { const m = new RegExp(`PARAMETER\\["${name}",\\s*(-?[\\d.eE+]+)\\]`, 'i').exec(text); return m ? Number(m[1]) : null; };
  if (/Transverse_Mercator/i.test(text)) {
    const unit = /UNIT\["(?:Foot_US|US survey foot)[^\]]*?,\s*([\d.]+)\]\s*\]\s*$/i.exec(text) || /UNIT\["Foot[^\]]*?,\s*([\d.]+)\]\s*\]\s*$/i.exec(text);
    const k = unit ? Number(unit[1]) : 1; // metres per unit
    const inner = fromTransverseMercator(param('central_meridian') ?? 0, param('scale_factor') ?? 0.9996, (param('false_easting') ?? 0) * k, (param('false_northing') ?? 0) * k, param('latitude_of_origin') ?? 0);
    return ([x, y]) => inner([x * k, y * k]);
  }
  return null;
}

/* ---------- .dbf ---------- */

export function parseDbf(bytes, encoding = 'utf-8') {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = u32(v, 4);
  const headerLen = u16(v, 8);
  const recordLen = u16(v, 10);
  let dec;
  try { dec = new TextDecoder(encoding); } catch { dec = new TextDecoder('utf-8'); }
  const fields = [];
  for (let o = 32; o < headerLen - 1 && bytes[o] !== 0x0d; o += 32) {
    const nameEnd = bytes.subarray(o, o + 11).indexOf(0);
    fields.push({ name: dec.decode(bytes.subarray(o, o + (nameEnd < 0 ? 11 : nameEnd))).trim(), type: String.fromCharCode(bytes[o + 11]), length: bytes[o + 16] });
  }
  const rows = [];
  for (let i = 0; i < count; i++) {
    let o = headerLen + i * recordLen + 1; // first byte marks deleted rows
    if (o + recordLen - 1 > bytes.length) break;
    const row = {};
    for (const f of fields) {
      const raw = dec.decode(bytes.subarray(o, o + f.length)).trim();
      o += f.length;
      if (raw === '' || /^\*+$/.test(raw)) continue;
      if (f.type === 'N' || f.type === 'F') { const n = Number(raw); row[f.name] = Number.isFinite(n) ? n : raw; } else if (f.type === 'L') row[f.name] = /^[YyTt]/.test(raw);
      else if (f.type === 'D' && /^\d{8}$/.test(raw)) row[f.name] = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
      else row[f.name] = raw;
    }
    rows.push(row);
  }
  return rows;
}

/* ---------- .shp ---------- */

const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; };
const inside = (pt, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/** Geometries of a .shp file, one per record (null for empty shapes). `proj` converts each coordinate. */
export function parseShp(bytes, proj = (c) => c) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getInt32(0, false) !== 9994) throw new Error('That isn\'t a shapefile (.shp)');
  const out = [];
  let o = 100;
  const f64 = (at) => v.getFloat64(at, true);
  while (o + 8 <= bytes.length) {
    const len = v.getInt32(o + 4, false) * 2;
    const at = o + 8;
    o = at + len;
    if (o > bytes.length || len < 4) break;
    const type = u32(v, at) % 10; // Z (1x) and M (2x) variants share the 2D layout up front
    if (type === 0) { out.push(null); continue; }
    if (type === 1) { out.push({ type: 'Point', coordinates: proj([f64(at + 4), f64(at + 12)]) }); continue; }
    if (type === 8) {
      const n = u32(v, at + 36);
      out.push({ type: 'MultiPoint', coordinates: Array.from({ length: n }, (_, i) => proj([f64(at + 40 + i * 16), f64(at + 48 + i * 16)])) });
      continue;
    }
    if (type !== 3 && type !== 5) { out.push(null); continue; }
    const nParts = u32(v, at + 36);
    const nPoints = u32(v, at + 40);
    const starts = Array.from({ length: nParts }, (_, i) => u32(v, at + 44 + i * 4));
    const base = at + 44 + nParts * 4;
    const parts = starts.map((s, i) => {
      const e = i + 1 < nParts ? starts[i + 1] : nPoints;
      return Array.from({ length: e - s }, (_, k) => proj([f64(base + (s + k) * 16), f64(base + (s + k) * 16 + 8)]));
    }).filter((p) => p.length > 1);
    if (!parts.length) { out.push(null); continue; }
    if (type === 3) { out.push(parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts }); continue; }
    // Polygons: clockwise rings are outlines, counter-clockwise rings are holes in the outline that contains them.
    const polys = [];
    const holes = [];
    for (const ring of parts) (ringArea(ring) <= 0 ? polys.push([ring]) : holes.push(ring));
    if (!polys.length) holes.splice(0).forEach((ring) => polys.push([ring]));
    for (const hole of holes) (polys.find((p) => inside(hole[0], p[0])) || polys[0]).push(hole);
    out.push(polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys });
  }
  return out;
}

/** GeoJSON from a zipped shapefile. A zip holding several shapefiles gives one collection per .shp. */
export async function readShapefileZip(buffer) {
  const files = unzip(buffer);
  const find = (base, ext) => files.find((f) => f.name.toLowerCase() === `${base}.${ext}`);
  const shps = files.filter((f) => /\.shp$/i.test(f.name) && !/(^|\/)__MACOSX\//.test(f.name));
  if (!shps.length) throw new Error('No .shp file was found in that zip');
  const out = [];
  for (const shp of shps) {
    const base = shp.name.replace(/\.shp$/i, '').toLowerCase();
    const prj = find(base, 'prj');
    const proj = projectionFromPrj(prj ? new TextDecoder().decode(await prj.read()) : '');
    if (!proj) throw new Error(`${shp.name} uses a coordinate system Waymark can't convert. Re-save it as WGS 84 (EPSG:4326) and try again.`);
    const geoms = parseShp(await shp.read(), proj);
    const dbf = find(base, 'dbf');
    const cpg = find(base, 'cpg');
    const rows = dbf ? parseDbf(await dbf.read(), cpg ? new TextDecoder().decode(await cpg.read()).trim().toLowerCase() : 'utf-8') : [];
    const features = geoms.map((g, i) => (g ? { type: 'Feature', properties: rows[i] || {}, geometry: g } : null)).filter(Boolean);
    out.push({ name: shp.name.split('/').pop().replace(/\.shp$/i, ''), data: { type: 'FeatureCollection', features } });
  }
  return out;
}
