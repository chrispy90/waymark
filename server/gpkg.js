// Reads GeoPackage files (.gpkg). A GeoPackage is a SQLite database, so Node's built-in SQLite opens it directly.
// Returns one GeoJSON FeatureCollection per feature table, in WGS 84 longitude/latitude.
const { DatabaseSync } = require('node:sqlite');

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
const isSqlite = (buf) => buf.length > 16 && buf.subarray(0, 16).equals(SQLITE_MAGIC);

/* ---------- coordinate systems ---------- */

const R = 6378137;
const fromWebMercator = ([x, y, ...rest]) => [(x / R) * (180 / Math.PI), (Math.atan(Math.sinh(y / R)) * 180) / Math.PI, ...rest];

// Inverse transverse Mercator (UTM) on the GRS80/WGS84 ellipsoid.
function fromUtm(zone, south) {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const ep2 = e2 / (1 - e2);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  return ([x, y, ...rest]) => {
    const M = (south ? y - 1e7 : y) / k0;
    const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
    const p1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
      + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
    const [s, c, t] = [Math.sin(p1), Math.cos(p1), Math.tan(p1)];
    const C1 = ep2 * c * c;
    const T1 = t * t;
    const N1 = a / Math.sqrt(1 - e2 * s * s);
    const R1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5;
    const D = (x - 500000) / (N1 * k0);
    const lat = p1 - ((N1 * t) / R1) * ((D * D) / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24
      + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
    const lon = lon0 + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / c;
    return [(lon * 180) / Math.PI, (lat * 180) / Math.PI, ...rest];
  };
}

/** A function that converts a coordinate in EPSG:<code> to longitude/latitude, or null when the system isn't supported. */
function projectionFor(code) {
  const n = Number(code);
  if ([4326, 4979, 4269, 4258, 4283, 0, -1].includes(n) || code === 'CRS84') return (c) => c; // geographic, within a metre or two of WGS 84
  if ([3857, 900913, 3785, 102100, 102113].includes(n)) return fromWebMercator;
  if (n >= 32601 && n <= 32660) return fromUtm(n - 32600, false);
  if (n >= 32701 && n <= 32760) return fromUtm(n - 32700, true);
  if (n >= 26901 && n <= 26923) return fromUtm(n - 26900, false); // NAD83 UTM
  if (n >= 25828 && n <= 25838) return fromUtm(n - 25800, false); // ETRS89 UTM
  return null;
}

/* ---------- well-known binary ---------- */

function readWkb(buf, start, proj) {
  let o = start;
  const geom = () => {
    const le = buf[o] === 1;
    o += 1;
    let type = le ? buf.readUInt32LE(o) : buf.readUInt32BE(o);
    o += 4;
    let dims = 2;
    if (type & 0x80000000) dims++; // EWKB Z
    if (type & 0x40000000) dims++; // EWKB M
    if (type & 0x20000000) o += 4; // EWKB SRID
    type &= 0x0fffffff;
    if (type >= 3000) { dims = 4; type -= 3000; } else if (type >= 2000) { dims = 3; type -= 2000; } else if (type >= 1000) { dims = 3; type -= 1000; }
    const u32 = () => { const v = le ? buf.readUInt32LE(o) : buf.readUInt32BE(o); o += 4; return v; };
    const f64 = () => { const v = le ? buf.readDoubleLE(o) : buf.readDoubleBE(o); o += 8; return v; };
    const point = () => { const x = f64(); const y = f64(); o += (dims - 2) * 8; return proj([x, y]); };
    const points = () => Array.from({ length: u32() }, point);
    const rings = () => Array.from({ length: u32() }, points);
    const many = () => Array.from({ length: u32() }, geom);
    switch (type) {
      case 1: { const c = point(); return Number.isNaN(c[0]) ? null : { type: 'Point', coordinates: c }; }
      case 2: return { type: 'LineString', coordinates: points() };
      case 3: return { type: 'Polygon', coordinates: rings() };
      case 4: return { type: 'MultiPoint', coordinates: many().filter(Boolean).map((g) => g.coordinates) };
      case 5: return { type: 'MultiLineString', coordinates: many().map((g) => g.coordinates) };
      case 6: return { type: 'MultiPolygon', coordinates: many().map((g) => g.coordinates) };
      case 7: return { type: 'GeometryCollection', geometries: many().filter(Boolean) };
      default: throw new Error(`Unsupported geometry type ${type}`);
    }
  };
  return geom();
}

// GeoPackage geometry: "GP", version, flags, srs id, optional envelope, then standard WKB.
function readGeometry(blob, proj) {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length < 8 || buf[0] !== 0x47 || buf[1] !== 0x50) return null;
  const flags = buf[3];
  if (flags & 0x10) return null; // empty geometry
  const envelope = [0, 32, 48, 48, 64][(flags >> 1) & 7] ?? 0;
  return readWkb(buf, 8 + envelope, proj);
}

/** Reads every feature table of a GeoPackage file. Returns [{ name, title, features }]. */
function readGeoPackage(file, { maxTables = 12 } = {}) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    let tables;
    try {
      tables = db.prepare(`SELECT c.table_name AS name, c.identifier AS title, g.column_name AS col, g.srs_id AS srs
        FROM gpkg_contents c JOIN gpkg_geometry_columns g ON g.table_name = c.table_name WHERE c.data_type = 'features'`).all();
    } catch { throw new Error('That file is a SQLite database but not a GeoPackage'); }
    if (!tables.length) throw new Error('That GeoPackage has no feature tables');
    return tables.slice(0, maxTables).map((t) => {
      let code = t.srs;
      try { const row = db.prepare('SELECT organization, organization_coordsys_id AS id FROM gpkg_spatial_ref_sys WHERE srs_id = ?').get(t.srs); if (row?.id) code = row.id; } catch { /* use srs_id */ }
      const proj = projectionFor(code);
      if (!proj) throw new Error(`"${t.name}" uses coordinate system EPSG:${code}, which Waymark can't convert. Re-save it as WGS 84 (EPSG:4326) and try again.`);
      const quoted = `"${String(t.name).replace(/"/g, '""')}"`;
      const features = [];
      for (const row of db.prepare(`SELECT * FROM ${quoted}`).iterate()) {
        const props = {};
        let geometry = null;
        for (const [k, v] of Object.entries(row)) {
          if (k === t.col) { try { geometry = v ? readGeometry(v, proj) : null; } catch { geometry = null; } continue; }
          if (v == null || v instanceof Uint8Array) continue;
          props[k] = typeof v === 'bigint' ? Number(v) : v;
        }
        if (geometry) features.push({ type: 'Feature', properties: props, geometry });
      }
      return { name: t.name, title: t.title || t.name, features };
    });
  } finally { db.close(); }
}

module.exports = { readGeoPackage, isSqlite, projectionFor };
