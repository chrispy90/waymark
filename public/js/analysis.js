// Geospatial analysis for the editor, built on Turf.js (global `turf`, loaded only in the builder).
// Every tool turns input layers into a new FeatureCollection that is saved as an ordinary layer.

const T = () => {
  if (!window.turf) throw new Error('The analysis library did not load. Check your connection and reload.');
  return window.turf;
};
const fc = (features) => ({ type: 'FeatureCollection', features });
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const UNIT_LABEL = { kilometers: 'km', miles: 'mi', meters: 'm' };

export const geomKind = (f) => {
  const t = f?.geometry?.type || '';
  return t.includes('Polygon') ? 'polygon' : t.includes('Line') ? 'line' : t.includes('Point') ? 'point' : 'other';
};
export function kinds(data) {
  const k = new Set();
  data.features.forEach((f) => k.add(geomKind(f)));
  k.delete('other');
  return k;
}

/** A readable name for a feature, from the usual name-like fields. */
export function featureName(props = {}) {
  const key = Object.keys(props).find((k) => /^(name|title|label|NAME|TITLE|LABEL|Name)$/.test(k))
    || Object.keys(props).find((k) => typeof props[k] === 'string' && props[k].length && props[k].length < 60);
  return key ? String(props[key]) : '';
}

const bboxOf = (f) => T().bbox(f);
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const pointOf = (f) => (geomKind(f) === 'point' && f.geometry.type === 'Point' ? f : T().centroid(f));

// Distance (km) from a point to any feature: 0 inside polygons, edge distance otherwise.
function distanceKm(pt, target) {
  const t = T();
  const k = geomKind(target);
  if (k === 'point') {
    const pts = target.geometry.type === 'MultiPoint' ? target.geometry.coordinates.map((c) => t.point(c)) : [target];
    return Math.min(...pts.map((p) => t.distance(pt, p, { units: 'kilometers' })));
  }
  const toLine = (lines) => Math.min(...lines.map((l) => t.pointToLineDistance(pt, l, { units: 'kilometers' })));
  if (k === 'line') return toLine(flattenLines(target));
  if (k === 'polygon') {
    if (t.booleanPointInPolygon(pt, target)) return 0;
    const outline = t.polygonToLine(target);
    const parts = outline.type === 'FeatureCollection' ? outline.features : [outline];
    return toLine(parts.flatMap(flattenLines));
  }
  return Infinity;
}
function flattenLines(f) {
  const out = [];
  T().flattenEach(f, (part) => out.push(part));
  return out;
}

const toUnits = (km, units) => (units === 'miles' ? km * 0.621371 : units === 'meters' ? km * 1000 : km);
const toKm = (d, units) => (units === 'miles' ? d / 0.621371 : units === 'meters' ? d / 1000 : d);

function guard(n, max, what) {
  if (n > max) throw new Error(`That's too much for the browser (${n.toLocaleString()} ${what}). Filter the layer first, or use fewer features.`);
}

/* ---------- Tools ---------- */

export const TOOLS = {
  buffer: {
    name: 'Buffer', icon: 'target', desc: 'Draw a zone around every feature, at a distance you choose.',
    inputs: [{ k: 'input', label: 'Around features in' }],
    params: [{ k: 'distance', t: 'number', label: 'Distance', dflt: 1 }, { k: 'units', t: 'units', dflt: 'kilometers' }, { k: 'merge', t: 'check', label: 'Merge overlapping zones into one', dflt: true }],
    name_: (p, a) => `${a.input} within ${p.distance} ${UNIT_LABEL[p.units]}`,
    run({ input }, p) {
      const t = T();
      guard(input.features.length, 5000, 'features');
      const d = Number(p.distance);
      if (!(d > 0)) throw new Error('Enter a distance greater than zero.');
      const zones = input.features.filter((f) => f.geometry).map((f) => t.buffer(f, d, { units: p.units, steps: 16 })).filter(Boolean);
      if (!p.merge || zones.length < 2) return { data: fc(zones.map((z, i) => ({ ...z, properties: { ...input.features[i]?.properties, buffer: `${d} ${UNIT_LABEL[p.units]}` } }))) };
      const merged = t.union(fc(zones));
      const parts = merged ? (merged.geometry.type === 'MultiPolygon' ? merged.geometry.coordinates.length : 1) : 0;
      return { data: fc(merged ? [{ ...merged, properties: { buffer: `${d} ${UNIT_LABEL[p.units]}`, zones: parts } }] : []) };
    },
    style: (src) => ({ color: src.style?.color || '#2563eb', opacity: 0.2, width: 2 }),
  },

  hexbin: {
    name: 'Hex bins', icon: 'hex', desc: 'Group points into a hexagon grid and count, sum or average them.',
    inputs: [{ k: 'input', label: 'Points', kind: 'point' }],
    params: [{ k: 'size', t: 'number', label: 'Hexagon size in km (blank picks one for you)', dflt: '' },
      { k: 'stat', t: 'stat', dflt: 'count' }, { k: 'field', t: 'field', label: 'Field to sum or average', of: 'input', numeric: true, when: (p) => p.stat !== 'count' },
      { k: 'keepEmpty', t: 'check', label: 'Keep empty hexagons', dflt: false }],
    name_: (p, a) => `${a.input} by hexagon`,
    run({ input }, p) {
      const t = T();
      const pts = input.features.filter((f) => geomKind(f) === 'point').map(pointOf);
      if (!pts.length) throw new Error('This layer has no points.');
      guard(pts.length, 200000, 'points');
      let box = t.bbox(fc(pts));
      if (box[0] === box[2] && box[1] === box[3]) box = [box[0] - 0.01, box[1] - 0.01, box[2] + 0.01, box[3] + 0.01];
      const areaKm2 = t.area(t.bboxPolygon(box)) / 1e6;
      let side = Number(p.size) > 0 ? Number(p.size) : Math.max(0.05, Math.sqrt(areaKm2 / 350 / 2.598));
      while (areaKm2 / (2.598 * side * side) > 6000) side *= 1.25; // keep the grid manageable
      const pad = side / 111;
      const grid = t.hexGrid([box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad], side, { units: 'kilometers' });
      const cells = grid.features.map((h) => ({ h, b: t.bbox(h), n: 0, sum: 0 }));
      // bucket hexagons on a coarse grid so each point only tests a few candidates
      const cw = cells[0] ? cells[0].b[2] - cells[0].b[0] : 1;
      const ch = cells[0] ? cells[0].b[3] - cells[0].b[1] : 1;
      const buckets = new Map();
      const key = (x, y) => `${Math.floor(x / cw)}:${Math.floor(y / ch)}`;
      cells.forEach((c) => {
        for (let x = Math.floor(c.b[0] / cw); x <= Math.floor(c.b[2] / cw); x++) for (let y = Math.floor(c.b[1] / ch); y <= Math.floor(c.b[3] / ch); y++) {
          const k = `${x}:${y}`;
          (buckets.get(k) || buckets.set(k, []).get(k)).push(c);
        }
      });
      pts.forEach((pt) => {
        const [x, y] = pt.geometry.coordinates;
        const cell = (buckets.get(key(x, y)) || []).find((c) => t.booleanPointInPolygon(pt, c.h));
        if (!cell) return;
        cell.n++;
        if (p.field) cell.sum += Number(pt.properties?.[p.field]) || 0;
      });
      const statName = p.stat === 'count' ? 'count' : p.stat === 'sum' ? `sum_${p.field}` : `mean_${p.field}`;
      const out = cells.filter((c) => p.keepEmpty || c.n > 0).map((c) => ({
        type: 'Feature', geometry: c.h.geometry,
        properties: { count: c.n, ...(p.stat === 'sum' ? { [statName]: round(c.sum, 2) } : {}), ...(p.stat === 'mean' ? { [statName]: c.n ? round(c.sum / c.n, 2) : 0 } : {}) },
      }));
      return { data: fc(out), field: statName, note: `${out.length.toLocaleString()} hexagons, about ${round(side, 2)} km across` };
    },
    style: (src, r) => ({ color: src.style?.color || '#e4572e', mode: 'graduated', field: r.field, opacity: 0.7, width: 1 }),
  },

  count: {
    name: 'Count in areas', icon: 'layers', desc: 'For each area, count (or total) the points that fall inside it.',
    inputs: [{ k: 'areas', label: 'Areas', kind: 'polygon' }, { k: 'points', label: 'Points to count', kind: 'point' }],
    params: [{ k: 'field', t: 'field', label: 'Also total this field (optional)', of: 'points', numeric: true, optional: true }],
    name_: (p, a) => `${a.points} per ${a.areas}`,
    run({ areas, points }, p) {
      const t = T();
      const polys = areas.features.filter((f) => geomKind(f) === 'polygon');
      const pts = points.features.filter((f) => geomKind(f) === 'point').map(pointOf);
      if (!polys.length) throw new Error('The areas layer has no polygons.');
      guard(polys.length * pts.length, 5e7, 'comparisons');
      const boxed = polys.map((f) => ({ f, b: bboxOf(f), n: 0, sum: 0 }));
      pts.forEach((pt) => {
        const [x, y] = pt.geometry.coordinates;
        boxed.forEach((a) => {
          if (x < a.b[0] || x > a.b[2] || y < a.b[1] || y > a.b[3]) return;
          if (!t.booleanPointInPolygon(pt, a.f)) return;
          a.n++;
          if (p.field) a.sum += Number(pt.properties?.[p.field]) || 0;
        });
      });
      const sumKey = p.field ? `total_${p.field}` : null;
      const out = boxed.map((a) => ({ ...a.f, properties: { ...a.f.properties, count: a.n, ...(sumKey ? { [sumKey]: round(a.sum, 2) } : {}) } }));
      const inside = boxed.reduce((s, a) => s + a.n, 0);
      return { data: fc(out), field: 'count', note: `${inside.toLocaleString()} of ${pts.length.toLocaleString()} points fall inside an area` };
    },
    style: (src, r) => ({ color: '#e4572e', mode: 'graduated', field: r.field, opacity: 0.65, width: 1 }),
  },

  nearest: {
    name: 'Distance to nearest', icon: 'pin', desc: 'Measure how far each feature is from the closest feature in another layer.',
    inputs: [{ k: 'input', label: 'For each feature in' }, { k: 'target', label: 'Find the closest in' }],
    params: [{ k: 'units', t: 'units', dflt: 'kilometers' }],
    name_: (p, a) => `${a.input}: distance to ${a.target}`,
    run({ input, target }, p) {
      const targets = target.features.filter((f) => geomKind(f) !== 'other');
      if (!targets.length) throw new Error('The second layer is empty.');
      guard(input.features.length * targets.length, 3e6, 'comparisons');
      const key = `nearest_${UNIT_LABEL[p.units]}`;
      const out = input.features.filter((f) => f.geometry).map((f) => {
        const pt = pointOf(f);
        let best = Infinity;
        let who = null;
        targets.forEach((tg) => { const d = distanceKm(pt, tg); if (d < best) { best = d; who = tg; } });
        return { ...f, properties: { ...f.properties, [key]: round(toUnits(best, p.units), 3), nearest: featureName(who?.properties) } };
      });
      const vals = out.map((f) => f.properties[key]);
      const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      return { data: fc(out), field: key, note: `Average distance ${round(avg, 2)} ${UNIT_LABEL[p.units]}` };
    },
    style: (src, r) => ({ ...src.style, mode: 'graduated', field: r.field, color: '#7c3aed' }),
  },

  within: {
    name: 'Within distance', icon: 'search', desc: 'Keep only the features that are close to another layer.',
    inputs: [{ k: 'input', label: 'Keep features from' }, { k: 'target', label: 'That are near' }],
    params: [{ k: 'distance', t: 'number', label: 'Within', dflt: 1 }, { k: 'units', t: 'units', dflt: 'kilometers' }],
    name_: (p, a) => `${a.input} within ${p.distance} ${UNIT_LABEL[p.units]} of ${a.target}`,
    run({ input, target }, p) {
      const limit = toKm(Number(p.distance), p.units);
      if (!(limit >= 0)) throw new Error('Enter a distance.');
      const targets = target.features.filter((f) => geomKind(f) !== 'other');
      guard(input.features.length * targets.length, 3e6, 'comparisons');
      const out = input.features.filter((f) => f.geometry && targets.some((tg) => distanceKm(pointOf(f), tg) <= limit));
      return { data: fc(out), note: `${out.length.toLocaleString()} of ${input.features.length.toLocaleString()} features are within range` };
    },
    style: (src) => ({ ...src.style }),
  },

  centroids: {
    name: 'Center points', icon: 'target', desc: 'Turn areas or lines into a single point at their center.',
    inputs: [{ k: 'input', label: 'Features' }],
    params: [],
    name_: (p, a) => `${a.input} (centers)`,
    run({ input }) {
      const t = T();
      return { data: fc(input.features.filter((f) => f.geometry).map((f) => t.centroid(f, { properties: { ...f.properties } }))) };
    },
    style: (src) => ({ color: src.style?.color || '#2563eb', radius: 6, label: src.style?.label }),
  },

  hull: {
    name: 'Outline', icon: 'sparkle', desc: 'Draw one boundary that wraps around all the features.',
    inputs: [{ k: 'input', label: 'Features' }],
    params: [],
    name_: (p, a) => `${a.input} (outline)`,
    run({ input }) {
      const t = T();
      const pts = [];
      t.coordEach(input, (c) => pts.push(t.point(c)));
      if (pts.length < 3) throw new Error('An outline needs at least three points.');
      const hull = t.convex(fc(pts));
      if (!hull) throw new Error('Could not draw an outline around these features.');
      return { data: fc([{ ...hull, properties: { area_km2: round(t.area(hull) / 1e6, 2) } }]), note: `Covers ${round(t.area(hull) / 1e6, 2).toLocaleString()} km²` };
    },
    style: (src) => ({ color: src.style?.color || '#2563eb', opacity: 0.08, width: 2.5 }),
  },

  filter: {
    name: 'Filter', icon: 'sliders', desc: 'Keep the features whose values match a rule.',
    inputs: [{ k: 'input', label: 'Features' }],
    params: [{ k: 'field', t: 'field', label: 'Field', of: 'input' }, { k: 'op', t: 'op', dflt: '=' }, { k: 'value', t: 'text', label: 'Value', when: (p) => !/empty/.test(p.op || '') }],
    name_: (p, a) => `${a.input} where ${p.field} ${p.op} ${p.value ?? ''}`.trim(),
    run({ input }, p) {
      if (!p.field) throw new Error('Choose a field.');
      const v = p.value ?? '';
      const num = Number(v);
      const test = (x) => {
        const isNum = v !== '' && Number.isFinite(num) && x !== '' && x != null && Number.isFinite(Number(x));
        switch (p.op) {
          case '=': return isNum ? Number(x) === num : String(x ?? '').toLowerCase() === v.toLowerCase();
          case '≠': return isNum ? Number(x) !== num : String(x ?? '').toLowerCase() !== v.toLowerCase();
          case '>': return Number(x) > num;
          case '≥': return Number(x) >= num;
          case '<': return Number(x) < num;
          case '≤': return Number(x) <= num;
          case 'contains': return String(x ?? '').toLowerCase().includes(v.toLowerCase());
          case 'is empty': return x == null || x === '';
          case 'is not empty': return !(x == null || x === '');
          default: return true;
        }
      };
      const out = input.features.filter((f) => test(f.properties?.[p.field]));
      return { data: fc(out), note: `${out.length.toLocaleString()} of ${input.features.length.toLocaleString()} features match` };
    },
    style: (src) => ({ ...src.style }),
  },
};

export const OPS = ['=', '≠', '>', '≥', '<', '≤', 'contains', 'is empty', 'is not empty'];

/* ---------- Statistics ---------- */

/** Summary of a layer: counts, total size, and per-field statistics. */
export function layerStats(data) {
  const t = window.turf;
  const types = { point: 0, line: 0, polygon: 0 };
  let areaKm2 = 0;
  let lengthKm = 0;
  data.features.forEach((f) => {
    const k = geomKind(f);
    if (k in types) types[k]++;
    if (!t) return;
    try {
      if (k === 'polygon') areaKm2 += t.area(f) / 1e6;
      if (k === 'line') lengthKm += t.length(f, { units: 'kilometers' });
    } catch { /* skip bad geometry */ }
  });
  const fields = new Map();
  data.features.slice(0, 50000).forEach((f) => {
    for (const [k, v] of Object.entries(f.properties || {})) {
      if (/^(OBJECTID|GLOBALID|FID|SHAPE.*|Shape.*)$/i.test(k)) continue;
      const s = fields.get(k) || fields.set(k, { name: k, nums: [], texts: new Map(), filled: 0 }).get(k);
      if (v == null || v === '') continue;
      s.filled++;
      const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : NaN);
      if (Number.isFinite(n)) s.nums.push(n);
      else s.texts.set(String(v), (s.texts.get(String(v)) || 0) + 1);
    }
  });
  const fieldStats = [...fields.values()].map((s) => {
    if (s.nums.length && s.nums.length >= s.texts.size) {
      const sum = s.nums.reduce((a, b) => a + b, 0);
      const sorted = [...s.nums].sort((a, b) => a - b);
      return { name: s.name, kind: 'number', filled: s.filled, min: sorted[0], max: sorted.at(-1), sum, mean: sum / sorted.length, median: sorted[Math.floor(sorted.length / 2)], values: sorted };
    }
    const top = [...s.texts.entries()].sort((a, b) => b[1] - a[1]);
    return { name: s.name, kind: 'text', filled: s.filled, distinct: top.length, top: top.slice(0, 5) };
  });
  return { count: data.features.length, types, areaKm2, lengthKm, bbox: t && data.features.length ? t.bbox(data) : null, fields: fieldStats };
}

/* ---------- Formatting ---------- */

const n = (v, d = 1) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : round(v, d).toLocaleString());
export const fmtDist = (km) => (km < 1 ? `${n(km * 1000, 0)} m · ${n(km * 3280.84, 0)} ft` : `${n(km, 2)} km · ${n(km * 0.621371, 2)} mi`);
export const fmtArea = (km2) => (km2 < 1 ? `${n(km2 * 1e6, 0)} m² · ${n(km2 * 247.105, 1)} acres` : `${n(km2, 2)} km² · ${n(km2 * 0.386102, 2)} sq mi`);
export const fmtNum = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : String(round(v, 2)));
