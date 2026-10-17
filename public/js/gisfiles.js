// Universal GIS file ingest: turns KML and GPX into GeoJSON FeatureCollections.
// Regex-based (no DOMParser) so it runs the same in the browser and in Node tests.

const decode = (s = '') => String(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
  .trim();
const stripTags = (s = '') => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
// Matches <ns:tag ...>…</ns:tag> with an optional namespace prefix.
const tagRe = (tag, flags = 'g') => new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, flags);
const first = (xml, tag) => { const m = tagRe(tag, '').exec(xml); return m ? m[1] : null; };
const all = (xml, tag) => [...xml.matchAll(tagRe(tag))].map((m) => m[1]);
const attr = (tagText, name) => { const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(tagText); return m ? m[1] : null; };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/* ---------- KML ---------- */

const kmlCoords = (text) => decode(text).split(/\s+/).filter(Boolean)
  .map((t) => t.split(',').map(Number))
  .filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
  .map((c) => (Number.isFinite(c[2]) && c[2] !== 0 ? [c[0], c[1], c[2]] : [c[0], c[1]]));

function kmlGeometries(xml) {
  const geoms = [];
  all(xml, 'Point').forEach((p) => { const c = kmlCoords(first(p, 'coordinates') || ''); if (c.length) geoms.push({ type: 'Point', coordinates: c[0] }); });
  all(xml, 'LineString').forEach((l) => { const c = kmlCoords(first(l, 'coordinates') || ''); if (c.length > 1) geoms.push({ type: 'LineString', coordinates: c }); });
  all(xml, 'Polygon').forEach((pg) => {
    const outer = first(pg, 'outerBoundaryIs');
    const rings = [outer, ...all(pg, 'innerBoundaryIs')].filter(Boolean).map((b) => kmlCoords(first(b, 'coordinates') || '')).filter((r) => r.length >= 4);
    if (rings.length) geoms.push({ type: 'Polygon', coordinates: rings });
  });
  // Google Earth tracks (gx:Track): <gx:coord>lng lat alt</gx:coord>
  const track = all(xml, 'coord').map((c) => c.trim().split(/\s+/).map(Number)).filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])).map((c) => [c[0], c[1]]);
  if (track.length > 1) geoms.push({ type: 'LineString', coordinates: track });
  return geoms;
}

function combine(geoms) {
  if (geoms.length === 1) return geoms[0];
  const types = new Set(geoms.map((g) => g.type));
  if (types.size === 1) {
    const t = geoms[0].type;
    return { type: `Multi${t}`, coordinates: geoms.map((g) => g.coordinates) };
  }
  return { type: 'GeometryCollection', geometries: geoms };
}

export function parseKML(text) {
  const xml = String(text || '');
  if (!/<(?:\w+:)?kml\b/i.test(xml) && !/<(?:\w+:)?Placemark\b/.test(xml)) throw new Error('This does not look like a KML file');
  const features = [];
  all(xml, 'Placemark').forEach((pm) => {
    const geoms = kmlGeometries(pm);
    if (!geoms.length) return;
    const props = {};
    const name = first(pm, 'name');
    if (name != null) props.name = stripTags(name);
    const desc = first(pm, 'description');
    if (desc != null && stripTags(desc)) props.description = stripTags(desc);
    // <ExtendedData><Data name="x"><value>…</value></Data> and <SimpleData name="x">…</SimpleData>
    for (const m of pm.matchAll(/<(?:\w+:)?Data\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Data>/g)) {
      const k = attr(m[1], 'name');
      if (k) props[k] = coerce(stripTags(first(m[2], 'value') ?? ''));
    }
    for (const m of pm.matchAll(/<(?:\w+:)?SimpleData\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?SimpleData>/g)) {
      const k = attr(m[1], 'name');
      if (k) props[k] = coerce(stripTags(m[2]));
    }
    const when = first(pm, 'when');
    if (when) props.time = stripTags(when);
    features.push({ type: 'Feature', geometry: combine(geoms), properties: props });
  });
  return { type: 'FeatureCollection', features };
}

const coerce = (v) => (v !== '' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);

/* ---------- GPX ---------- */

const gpxPoint = (tagText, body) => {
  const lat = num(attr(tagText, 'lat'));
  const lon = num(attr(tagText, 'lon'));
  if (lat == null || lon == null) return null;
  const ele = num(first(body, 'ele'));
  return { c: ele != null ? [lon, lat, ele] : [lon, lat], ele, time: first(body, 'time')?.trim() || null };
};
const pointsOf = (xml, tag) => [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${tag}>)`, 'g'))]
  .map((m) => gpxPoint(m[1], m[2] || '')).filter(Boolean);

function lineStats(pts) {
  let km = 0; let gain = 0; let loss = 0;
  for (let i = 1; i < pts.length; i++) {
    km += haversineKm(pts[i - 1].c, pts[i].c);
    if (pts[i].ele != null && pts[i - 1].ele != null) {
      const d = pts[i].ele - pts[i - 1].ele;
      if (d > 0) gain += d; else loss -= d;
    }
  }
  const eles = pts.map((p) => p.ele).filter((e) => e != null);
  const out = { length_km: Math.round(km * 1000) / 1000, points: pts.length };
  if (eles.length) Object.assign(out, { elev_gain_m: Math.round(gain), elev_loss_m: Math.round(loss), elev_min_m: Math.round(Math.min(...eles)), elev_max_m: Math.round(Math.max(...eles)) });
  if (pts[0]?.time) out.start_time = pts[0].time;
  if (pts.at(-1)?.time) out.end_time = pts.at(-1).time;
  return out;
}

export function parseGPX(text) {
  const xml = String(text || '');
  if (!/<(?:\w+:)?gpx\b/i.test(xml)) throw new Error('This does not look like a GPX file');
  const features = [];
  for (const m of xml.matchAll(/<(?:\w+:)?wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?wpt>)/g)) {
    const p = gpxPoint(m[1], m[2] || '');
    if (!p) continue;
    const body = m[2] || '';
    const props = { kind: 'waypoint' };
    const name = first(body, 'name'); if (name) props.name = stripTags(name);
    const desc = first(body, 'desc') || first(body, 'cmt'); if (desc) props.description = stripTags(desc);
    if (p.ele != null) props.elevation_m = Math.round(p.ele * 10) / 10;
    if (p.time) props.time = p.time;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p.c }, properties: props });
  }
  for (const [tag, ptTag, kind] of [['trk', 'trkpt', 'track'], ['rte', 'rtept', 'route']]) {
    all(xml, tag).forEach((body, i) => {
      const segs = tag === 'trk' ? all(body, 'trkseg').map((s) => pointsOf(s, ptTag)) : [pointsOf(body, ptTag)];
      const good = segs.filter((s) => s.length > 1);
      if (!good.length) return;
      const name = first(body.replace(tagRe(ptTag), ''), 'name');
      const props = { kind, name: name ? stripTags(name) : `${kind[0].toUpperCase()}${kind.slice(1)} ${i + 1}`, ...lineStats(good.flat()) };
      const geometry = good.length === 1 ? { type: 'LineString', coordinates: good[0].map((p) => p.c) } : { type: 'MultiLineString', coordinates: good.map((s) => s.map((p) => p.c)) };
      features.push({ type: 'Feature', geometry, properties: props });
    });
  }
  return { type: 'FeatureCollection', features };
}

/* ---------- Helpers ---------- */

export function haversineKm([lon1, lat1], [lon2, lat2]) {
  const R = 6371.0088;
  const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Which parser handles this file name, or null. */
export function fileKind(name = '', type = '') {
  if (/\.kml$/i.test(name) || type === 'application/vnd.google-earth.kml+xml') return 'kml';
  if (/\.gpx$/i.test(name) || type === 'application/gpx+xml') return 'gpx';
  if (/\.(jpe?g)$/i.test(name) || type === 'image/jpeg') return 'photo';
  if (/\.csv$/i.test(name) || type === 'text/csv') return 'csv';
  if (/\.(geo)?json$/i.test(name) || type === 'application/json' || type === 'application/geo+json') return 'geojson';
  return null;
}

export const ACCEPT = '.geojson,.json,.csv,.kml,.gpx,.jpg,.jpeg,application/json,application/geo+json,text/csv,application/vnd.google-earth.kml+xml,application/gpx+xml,image/jpeg';
export const SUPPORTED = /\.(geo)?json$|\.csv$|\.kml$|\.gpx$|\.jpe?g$/i;
