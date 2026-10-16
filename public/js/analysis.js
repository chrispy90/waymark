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
    name: 'Buffer', icon: 'target', group: 'Proximity', desc: 'Draw a zone around every feature, at a distance you choose.',
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
    name: 'Hex bins', icon: 'hex', group: 'Summarize', desc: 'Group points into a hexagon grid and count, sum or average them.',
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
      // Flat-topped hexagons laid out in degrees, scaled for the middle latitude. Built here rather than with
      // turf.hexGrid, which returns nothing once the data spans more than half the globe.
      const rx = side / (111.32 * Math.max(0.2, Math.cos(((box[1] + box[3]) / 2) * Math.PI / 180)));
      const ry = side / 110.57;
      const dx = 1.5 * rx, dy = Math.sqrt(3) * ry;
      const center = (i, j) => [box[0] + i * dx, box[1] + j * dy + (i & 1 ? dy / 2 : 0)];
      const cells = new Map();
      const cellOf = (i, j) => { const k = `${i}:${j}`; return cells.get(k) || cells.set(k, { i, j, n: 0, sum: 0 }).get(k); };
      if (p.keepEmpty) {
        for (let i = 0; i <= Math.ceil((box[2] - box[0]) / dx); i++) for (let j = -1; j <= Math.ceil((box[3] - box[1]) / dy); j++) cellOf(i, j);
      }
      pts.forEach((pt) => {
        const [x, y] = pt.geometry.coordinates;
        // a regular hex tiling is the Voronoi diagram of its centers, so the nearest center wins
        let best = null, bestD = Infinity;
        const i0 = Math.round((x - box[0]) / dx);
        for (let i = i0 - 1; i <= i0 + 1; i++) {
          const j = Math.round((y - box[1] - (i & 1 ? dy / 2 : 0)) / dy);
          const [cx, cy] = center(i, j);
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
          if (d < bestD) { bestD = d; best = [i, j]; }
        }
        const cell = cellOf(best[0], best[1]);
        cell.n++;
        if (p.field) cell.sum += Number(pt.properties?.[p.field]) || 0;
      });
      const hexagon = ({ i, j }) => {
        const [cx, cy] = center(i, j);
        const ring = [0, 1, 2, 3, 4, 5, 0].map((k) => [round(cx + rx * Math.cos(k * Math.PI / 3), 6), round(cy + ry * Math.sin(k * Math.PI / 3), 6)]);
        return { type: 'Polygon', coordinates: [ring] };
      };
      const statName = p.stat === 'count' ? 'count' : p.stat === 'sum' ? `sum_${p.field}` : `mean_${p.field}`;
      const out = [...cells.values()].filter((c) => p.keepEmpty || c.n > 0).map((c) => ({
        type: 'Feature', geometry: hexagon(c),
        properties: { count: c.n, ...(p.stat === 'sum' ? { [statName]: round(c.sum, 2) } : {}), ...(p.stat === 'mean' ? { [statName]: c.n ? round(c.sum / c.n, 2) : 0 } : {}) },
      }));
      return { data: fc(out), field: statName, note: `${out.length.toLocaleString()} hexagons, about ${round(side, 2)} km across` };
    },
    style: (src, r) => ({ color: src.style?.color || '#e4572e', mode: 'graduated', field: r.field, opacity: 0.7, width: 1 }),
  },

  count: {
    name: 'Count in areas', icon: 'layers', group: 'Summarize', desc: 'For each area, count (or total) the points that fall inside it.',
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
    name: 'Distance to nearest', icon: 'pin', group: 'Proximity', desc: 'Measure how far each feature is from the closest feature in another layer.',
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
    name: 'Within distance', icon: 'search', group: 'Proximity', desc: 'Keep only the features that are close to another layer.',
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
    name: 'Center points', icon: 'target', group: 'Manage data', desc: 'Turn areas or lines into a single point at their center.',
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
    name: 'Outline', icon: 'sparkle', group: 'Manage data', desc: 'Draw one boundary that wraps around all the features.',
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
    name: 'Filter', icon: 'sliders', group: 'Manage data', desc: 'Keep the features whose values match a rule.',
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

  /* ---------- Overlay ---------- */

  clip: {
    name: 'Clip', icon: 'polygon', group: 'Overlay', desc: 'Keep only the parts of a layer that fall inside areas, like a cookie cutter.',
    inputs: [{ k: 'input', label: 'Clip this layer' }, { k: 'mask', label: 'To these areas', kind: 'polygon' }],
    params: [],
    name_: (p, a) => `${a.input} clipped to ${a.mask}`,
    run({ input, mask }) {
      const out = overlayEach(input, maskOf(mask), true);
      return { data: fc(out), note: `${out.length.toLocaleString()} features inside the areas` };
    },
    style: (src) => ({ ...src.style }),
  },

  erase: {
    name: 'Erase', icon: 'x', group: 'Overlay', desc: 'Cut areas out of a layer and keep what is left outside them.',
    inputs: [{ k: 'input', label: 'Erase from this layer' }, { k: 'mask', label: 'Using these areas', kind: 'polygon' }],
    params: [],
    name_: (p, a) => `${a.input} outside ${a.mask}`,
    run({ input, mask }) {
      const out = overlayEach(input, maskOf(mask), false);
      return { data: fc(out), note: `${out.length.toLocaleString()} features outside the areas` };
    },
    style: (src) => ({ ...src.style }),
  },

  intersect: {
    name: 'Intersect', icon: 'layers', group: 'Overlay', desc: 'Keep only where two layers overlap, with the attributes of both.',
    inputs: [{ k: 'input', label: 'Features' }, { k: 'overlay', label: 'Overlap with areas', kind: 'polygon' }],
    params: [],
    name_: (p, a) => `${a.input} ∩ ${a.overlay}`,
    run({ input, overlay }) {
      const t = T();
      const areas = overlay.features.filter((f) => geomKind(f) === 'polygon').map((f) => ({ f, b: bboxOf(f) }));
      guard(input.features.length * areas.length, 4e5, 'pairs');
      const out = [];
      input.features.filter((f) => f.geometry).forEach((f) => {
        const fb = bboxOf(f);
        areas.forEach(({ f: a, b }) => {
          if (!overlaps(fb, b)) return;
          prefixed(a.properties, 'overlay_', (extra) => overlayEach(fc([f]), a, true).forEach((piece) => out.push({ ...piece, properties: { ...piece.properties, ...extra } })));
        });
      });
      if (t && out.some((f) => geomKind(f) === 'polygon')) out.forEach((f) => { if (geomKind(f) === 'polygon') f.properties.area_km2 = round(t.area(f) / 1e6, 3); });
      return { data: fc(out), note: `${out.length.toLocaleString()} overlapping pieces` };
    },
    style: (src) => ({ ...src.style, color: '#7c3aed', opacity: 0.45 }),
  },

  spatialjoin: {
    name: 'Join by location', icon: 'link', group: 'Overlay', desc: 'Give each feature the attributes of the area it falls in (a spatial join).',
    inputs: [{ k: 'input', label: 'Features to add attributes to' }, { k: 'join', label: 'Take attributes from areas', kind: 'polygon' }],
    params: [{ k: 'keep', t: 'check', label: 'Keep features that fall in no area', dflt: true }],
    name_: (p, a) => `${a.input} + ${a.join}`,
    run({ input, join }, p) {
      const t = T();
      const areas = join.features.filter((f) => geomKind(f) === 'polygon').map((f) => ({ f, b: bboxOf(f) }));
      guard(input.features.length * areas.length, 5e7, 'comparisons');
      let matched = 0;
      const out = [];
      input.features.filter((f) => f.geometry).forEach((f) => {
        const pt = pointOf(f);
        const [x, y] = pt.geometry.coordinates;
        const hit = areas.find(({ f: a, b }) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && t.booleanPointInPolygon(pt, a));
        if (hit) { matched++; prefixed(hit.f.properties, 'join_', (extra) => out.push({ ...f, properties: { ...f.properties, ...extra } })); }
        else if (p.keep) out.push(f);
      });
      return { data: fc(out), note: `${matched.toLocaleString()} of ${input.features.length.toLocaleString()} features fall in an area` };
    },
    style: (src) => ({ ...src.style }),
  },

  selectLocation: {
    name: 'Select by location', icon: 'search', group: 'Overlay', desc: 'Keep the features that touch, sit inside, contain or stay clear of another layer.',
    inputs: [{ k: 'input', label: 'Keep features from' }, { k: 'other', label: 'Compared with' }],
    params: [{ k: 'relation', t: 'choice', label: 'That', dflt: 'intersects', opts: [['intersects', 'Touch'], ['within', 'Are inside'], ['contains', 'Contain'], ['disjoint', 'Stay clear']] }],
    name_: (p, a) => `${a.input} that ${{ intersects: 'touch', within: 'are inside', contains: 'contain', disjoint: 'stay clear of' }[p.relation]} ${a.other}`,
    run({ input, other }, p) {
      const t = T();
      const others = other.features.filter((f) => f.geometry).map((f) => ({ f, b: bboxOf(f) }));
      guard(input.features.length * others.length, 3e6, 'comparisons');
      const test = { intersects: t.booleanIntersects, within: t.booleanWithin, contains: t.booleanContains }[p.relation] || t.booleanIntersects;
      const safe = (a, b) => { try { return test(a, b); } catch { return t.booleanIntersects(a, b) && p.relation !== 'contains'; } };
      const out = input.features.filter((f) => {
        if (!f.geometry) return false;
        const fb = bboxOf(f);
        const any = others.some(({ f: o, b }) => overlaps(fb, b) && (p.relation === 'disjoint' ? t.booleanIntersects(f, o) : safe(f, o)));
        return p.relation === 'disjoint' ? !any : any;
      });
      return { data: fc(out), note: `${out.length.toLocaleString()} of ${input.features.length.toLocaleString()} features match` };
    },
    style: (src) => ({ ...src.style }),
  },

  merge: {
    name: 'Merge', icon: 'plus', group: 'Overlay', desc: 'Combine two layers into one, noting which layer each feature came from.',
    inputs: [{ k: 'a', label: 'First layer' }, { k: 'b', label: 'Second layer' }],
    params: [],
    name_: (p, a) => `${a.a} + ${a.b}`,
    run({ a, b }, p) {
      const [na, nb] = [p._names?.a || 'first', p._names?.b || 'second'];
      const out = [...a.features.map((f) => ({ ...f, properties: { ...f.properties, source_layer: na } })), ...b.features.map((f) => ({ ...f, properties: { ...f.properties, source_layer: nb } }))];
      return { data: fc(out), field: 'source_layer', note: `${a.features.length.toLocaleString()} + ${b.features.length.toLocaleString()} features` };
    },
    style: (src) => ({ ...src.style, mode: 'categorical', field: 'source_layer' }),
  },

  /* ---------- Summarize ---------- */

  dissolve: {
    name: 'Dissolve', icon: 'polygon', group: 'Summarize', desc: 'Merge areas into one shape, or one per value of a field (for example, counties into states).',
    inputs: [{ k: 'input', label: 'Areas', kind: 'polygon' }],
    params: [{ k: 'field', t: 'field', label: 'One shape per value of (optional)', of: 'input', optional: true }],
    name_: (p, a) => (p.field ? `${a.input} by ${p.field}` : `${a.input} (dissolved)`),
    run({ input }, p) {
      const t = T();
      const polys = [];
      input.features.filter((f) => geomKind(f) === 'polygon').forEach((f) => t.flattenEach(f, (part) => polys.push({ ...part, properties: { ...(p.field ? { [p.field]: f.properties?.[p.field] ?? '' } : {}) } })));
      guard(polys.length, 20000, 'shapes');
      if (!polys.length) throw new Error('This layer has no areas.');
      const groups = new Map();
      polys.forEach((f) => { const k = p.field ? String(f.properties[p.field]) : '*'; (groups.get(k) || groups.set(k, []).get(k)).push(f); });
      const out = [...groups.entries()].map(([k, list]) => {
        const merged = list.length === 1 ? list[0] : t.union(fc(list));
        if (!merged) return null;
        return { type: 'Feature', geometry: merged.geometry, properties: { ...(p.field ? { [p.field]: k } : {}), parts: list.length, area_km2: round(t.area(merged) / 1e6, 2) } };
      }).filter(Boolean);
      return { data: fc(out), field: p.field, note: `${polys.length.toLocaleString()} shapes merged into ${out.length.toLocaleString()}` };
    },
    style: (src) => ({ color: src.style?.color || '#2563eb', opacity: 0.35, width: 2, ...(src.style?.mode === 'categorical' ? { mode: 'categorical', field: src.style.field } : {}) }),
  },

  /* ---------- Proximity ---------- */

  voronoi: {
    name: 'Voronoi areas', icon: 'hex', group: 'Proximity', desc: 'Split the map into areas closest to each point (Thiessen polygons), such as service areas.',
    inputs: [{ k: 'input', label: 'Points', kind: 'point' }],
    params: [],
    name_: (p, a) => `${a.input} (closest areas)`,
    run({ input }) {
      const t = T();
      const pts = input.features.filter((f) => f.geometry?.type === 'Point');
      if (pts.length < 2) throw new Error('Voronoi areas need at least two points.');
      guard(pts.length, 20000, 'points');
      const [w, s, e, n] = t.bbox(fc(pts));
      const pad = Math.max(e - w, n - s) * 0.08 || 0.01;
      const cells = t.voronoi(fc(pts), { bbox: [w - pad, s - pad, e + pad, n + pad] });
      const out = cells.features.map((c, i) => (c ? { ...c, properties: { ...pts[i].properties, area_km2: round(t.area(c) / 1e6, 2) } } : null)).filter(Boolean);
      return { data: fc(out), note: `${out.length.toLocaleString()} areas` };
    },
    style: (src) => ({ color: src.style?.color || '#0891b2', opacity: 0.18, width: 1.5 }),
  },

  /* ---------- Data management ---------- */

  simplify: {
    name: 'Simplify', icon: 'line', group: 'Manage data', desc: 'Remove detail from lines and areas to make them lighter and faster.',
    inputs: [{ k: 'input', label: 'Lines or areas' }],
    params: [{ k: 'level', t: 'choice', label: 'How much', dflt: 'medium', opts: [['light', 'A little'], ['medium', 'Some'], ['strong', 'A lot']] }],
    name_: (p, a) => `${a.input} (simplified)`,
    run({ input }, p) {
      const t = T();
      const [w, s, e, n] = t.bbox(input);
      const tol = Math.hypot(e - w, n - s) * { light: 0.0005, medium: 0.002, strong: 0.008 }[p.level || 'medium'];
      const count = (x) => { let c = 0; t.coordEach(x, () => { c++; }); return c; };
      const before = count(input);
      const out = t.simplify(structuredClone(input), { tolerance: tol, highQuality: true });
      const after = count(out);
      return { data: out, note: `${before.toLocaleString()} → ${after.toLocaleString()} points (${Math.round((1 - after / (before || 1)) * 100)}% lighter)` };
    },
    style: (src) => ({ ...src.style }),
  },

  geometry: {
    name: 'Add geometry attributes', icon: 'ruler', group: 'Manage data', desc: 'Add each feature’s area, length or coordinates as fields.',
    inputs: [{ k: 'input', label: 'Features' }],
    params: [],
    name_: (p, a) => `${a.input} (with measurements)`,
    run({ input }) {
      const t = T();
      const out = input.features.filter((f) => f.geometry).map((f) => {
        const k = geomKind(f);
        const extra = k === 'polygon' ? { area_km2: round(t.area(f) / 1e6, 4), area_mi2: round(t.area(f) / 2.59e6, 4), perimeter_km: round(t.length(t.polygonToLine(f), { units: 'kilometers' }), 3) }
          : k === 'line' ? { length_km: round(t.length(f, { units: 'kilometers' }), 3), length_mi: round(t.length(f, { units: 'miles' }), 3) }
            : { longitude: round(pointOf(f).geometry.coordinates[0], 6), latitude: round(pointOf(f).geometry.coordinates[1], 6) };
        return { ...f, properties: { ...f.properties, ...extra } };
      });
      return { data: fc(out), note: 'Added measurement fields to every feature' };
    },
    style: (src) => ({ ...src.style }),
  },
};

export const OPS = ['=', '≠', '>', '≥', '<', '≤', 'contains', 'is empty', 'is not empty'];


/* ---------- Overlay helpers ---------- */

// All mask polygons as one (multi)polygon, so each input feature is cut once.
function maskOf(mask) {
  const t = T();
  const polys = mask.features.filter((f) => geomKind(f) === 'polygon');
  if (!polys.length) throw new Error('The areas layer has no polygons.');
  guard(polys.length, 5000, 'areas');
  return polys.length === 1 ? polys[0] : t.union(fc(polys)) || polys[0];
}

// The parts of each feature inside (keep = true) or outside (keep = false) a mask polygon.
function overlayEach(input, mask, keep) {
  const t = T();
  const mb = bboxOf(mask);
  const out = [];
  guard(input.features.length, 50000, 'features');
  input.features.filter((f) => f.geometry).forEach((f) => {
    const k = geomKind(f);
    if (!overlaps(bboxOf(f), mb)) { if (!keep) out.push(f); return; }
    if (k === 'point') {
      const pts = f.geometry.type === 'MultiPoint' ? f.geometry.coordinates : [f.geometry.coordinates];
      const kept = pts.filter((c) => t.booleanPointInPolygon(c, mask) === keep);
      if (kept.length) out.push({ ...f, geometry: kept.length === 1 && f.geometry.type === 'Point' ? f.geometry : { type: 'MultiPoint', coordinates: kept } });
    } else if (k === 'polygon') {
      let piece = null;
      try { piece = keep ? t.intersect(fc([f, mask])) : t.difference(fc([f, mask])); } catch { piece = null; }
      if (piece) out.push({ ...f, geometry: piece.geometry });
    } else if (k === 'line') {
      flattenLines(f).forEach((line) => {
        let parts = [line];
        try { const split = t.lineSplit(line, mask); if (split.features.length) parts = split.features; } catch { /* keep the whole line */ }
        parts.forEach((seg) => {
          const len = t.length(seg, { units: 'kilometers' });
          const mid = len > 0 ? t.along(seg, len / 2, { units: 'kilometers' }) : t.point(seg.geometry.coordinates[0]);
          if (t.booleanPointInPolygon(mid, mask) === keep) out.push({ ...f, geometry: seg.geometry });
        });
      });
    }
  });
  return out;
}

// Copies another feature's attributes under a prefix (so "name" from the areas becomes "join_name").
function prefixed(props = {}, prefix, use) {
  use(Object.fromEntries(Object.entries(props || {}).filter(([k]) => !/^(OBJECTID|GLOBALID|FID|SHAPE.*|Shape.*)$/i.test(k)).map(([k, v]) => [`${prefix}${k}`, v])));
}

/** Tools grouped the way desktop GIS toolboxes group them. */
export const TOOL_GROUPS = ['Summarize', 'Proximity', 'Overlay', 'Manage data'];

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
