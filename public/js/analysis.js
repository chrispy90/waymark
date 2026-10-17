// Geospatial analysis for the editor, built on Turf.js (global `turf`, loaded only in the builder).
// Every tool turns input layers into a new FeatureCollection that is saved as an ordinary layer.
import { densifyLine, profileStats, sampleElevations } from './terrain.js';

const T = () => {
  const t = globalThis.turf || (typeof window !== 'undefined' ? window.turf : null);
  if (!t) throw new Error('The analysis library did not load. Check your connection and reload.');
  return t;
};
const fc = (features) => ({ type: 'FeatureCollection', features });
const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const UNIT_LABEL = { kilometers: 'km', miles: 'mi', meters: 'm' };

// Geodesic Haversine distance in kilometers between two [lng, lat] coordinates (pure JS fallback).
function haversineKm([lon1, lat1], [lon2, lat2]) {
  const R = 6371.0088;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Geodesic circle ring around [lng, lat] at radiusKm (pure JS).
function geodesicCircleRing([lon, lat], radiusKm, steps = 48) {
  const R = 6371.0088;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const d = radiusKm / R;
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (2 * Math.PI * (i % steps)) / steps;
    const lat2 = Math.asin(Math.sin(latRad) * Math.cos(d) + Math.cos(latRad) * Math.sin(d) * Math.cos(brng));
    const lon2 = lonRad + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(latRad), Math.cos(d) - Math.sin(latRad) * Math.sin(lat2));
    ring.push([round((lon2 * 180) / Math.PI, 6), round((lat2 * 180) / Math.PI, 6)]);
  }
  return ring;
}

function centerCoordsOf(f) {
  const g = f?.geometry;
  if (!g) return [0, 0];
  if (g.type === 'Point') return g.coordinates;
  const t = globalThis.turf || (typeof window !== 'undefined' ? window.turf : null);
  if (t) return t.centroid(f).geometry.coordinates;
  const flat = [];
  const walk = (c) => (typeof c?.[0] === 'number' ? flat.push(c) : Array.isArray(c) && c.forEach(walk));
  walk(g.coordinates);
  if (!flat.length) return [0, 0];
  return [flat.reduce((s, c) => s + c[0], 0) / flat.length, flat.reduce((s, c) => s + c[1], 0) / flat.length];
}

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

  rings: {
    name: 'Multi-ring trade areas', icon: 'target', group: 'Proximity', desc: 'Concentric distance bands (e.g. 1, 3, 5 km/mi) around stores, sites or transit stops for catchment analysis.',
    inputs: [{ k: 'input', label: 'Sites or locations' }],
    params: [
      { k: 'radii', label: 'Ring distances (comma-separated)', dflt: '1, 3, 5' },
      { k: 'units', t: 'units', dflt: 'kilometers' },
      { k: 'donuts', t: 'check', label: 'Non-overlapping donut bands (hollow out inner rings)', dflt: true },
    ],
    name_: (p, a) => `${a.input} trade rings (${p.radii} ${UNIT_LABEL[p.units]})`,
    run({ input }, p) {
      guard(input.features.length, 1000, 'sites');
      const u = p.units || 'kilometers';
      const uLabel = UNIT_LABEL[u] || 'km';
      const radii = String(p.radii || '1, 3, 5').split(/[\s,;]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
      if (!radii.length) throw new Error('Enter at least one positive ring distance (for example: 1, 3, 5).');
      const out = [];
      // Render from largest ring to smallest so smaller rings draw on top if overlapping
      input.features.filter((f) => f.geometry).forEach((f, idx) => {
        const c = centerCoordsOf(f);
        const siteName = featureName(f.properties) || `Site ${idx + 1}`;
        for (let rIdx = radii.length - 1; rIdx >= 0; rIdx--) {
          const rOuter = radii[rIdx];
          const rInner = rIdx > 0 && p.donuts ? radii[rIdx - 1] : 0;
          const outerRing = geodesicCircleRing(c, toKm(rOuter, u), 48);
          const coords = rInner > 0 ? [outerRing, geodesicCircleRing(c, toKm(rInner, u), 48).reverse()] : [outerRing];
          const bandLabel = rInner > 0 ? `${rInner}–${rOuter} ${uLabel}` : `0–${rOuter} ${uLabel}`;
          const areaKm2 = round(Math.PI * (toKm(rOuter, u) ** 2 - toKm(rInner, u) ** 2), 2);
          out.push({
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: coords },
            properties: {
              ...f.properties,
              site_name: siteName,
              ring_distance: rOuter,
              ring_band: bandLabel,
              area_km2: areaKm2,
            },
          });
        }
      });
      return { data: fc(out), field: 'ring_distance', note: `${out.length.toLocaleString()} trade area rings across ${radii.length} distance bands` };
    },
    style: () => ({ color: '#e4572e', mode: 'graduated', field: 'ring_distance', ramp: 'sunset', opacity: 0.35, width: 1.5 }),
  },

  spider: {
    name: 'Hub & spoke desire lines', icon: 'route', group: 'Proximity', desc: 'Connect every origin point or site to its nearest hub with flow lines and distance metrics.',
    inputs: [{ k: 'origins', label: 'Origins (customers, stores, incidents)' }, { k: 'hubs', label: 'Destination hubs (warehouses, clinics, stations)' }],
    params: [
      { k: 'units', t: 'units', dflt: 'kilometers' },
      { k: 'maxDist', t: 'number', label: 'Max connection distance (optional, 0 = no limit)', dflt: 0 },
    ],
    name_: (p, a) => `${a.origins} → ${a.hubs} desire lines`,
    run({ origins, hubs }, p) {
      const hubList = hubs.features.filter((f) => f.geometry).map((f, i) => ({ f, c: centerCoordsOf(f), name: featureName(f.properties) || `Hub ${i + 1}` }));
      if (!hubList.length) throw new Error('The hubs layer has no features.');
      const origList = origins.features.filter((f) => f.geometry);
      guard(origList.length * hubList.length, 3e6, 'comparisons');
      const u = p.units || 'kilometers';
      const uLabel = UNIT_LABEL[u] || 'km';
      const distKey = `distance_${uLabel}`;
      const maxKm = Number(p.maxDist) > 0 ? toKm(Number(p.maxDist), u) : Infinity;
      const out = [];
      origList.forEach((orig, idx) => {
        const oc = centerCoordsOf(orig);
        let bestHub = null;
        let bestKm = Infinity;
        for (const hItem of hubList) {
          const dKm = haversineKm(oc, hItem.c);
          if (dKm < bestKm) { bestKm = dKm; bestHub = hItem; }
        }
        if (!bestHub || bestKm > maxKm) return;
        out.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [oc, bestHub.c] },
          properties: {
            ...orig.properties,
            origin_name: featureName(orig.properties) || `Origin ${idx + 1}`,
            hub_name: bestHub.name,
            [distKey]: round(toUnits(bestKm, u), 3),
          },
        });
      });
      const avg = out.length ? out.reduce((s, f) => s + f.properties[distKey], 0) / out.length : 0;
      return { data: fc(out), field: distKey, note: `${out.length.toLocaleString()} connections · avg distance ${round(avg, 2)} ${uLabel}` };
    },
    style: () => ({ color: '#0891b2', mode: 'categorical', field: 'hub_name', width: 2.2, opacity: 0.8 }),
  },

  clusters: {
    name: 'Spatial density clusters', icon: 'sparkle', group: 'Summarize', desc: 'Discover natural spatial clusters of points (DBSCAN) and label each cluster or draw cluster footprints.',
    inputs: [{ k: 'input', label: 'Points to cluster', kind: 'point' }],
    params: [
      { k: 'distance', t: 'number', label: 'Search radius', dflt: 2 },
      { k: 'units', t: 'units', dflt: 'kilometers' },
      { k: 'minPoints', t: 'number', label: 'Minimum points per cluster', dflt: 3 },
      { k: 'keepNoise', t: 'check', label: 'Include unclustered outlier points', dflt: false },
    ],
    name_: (p, a) => `${a.input} clusters`,
    run({ input }, p) {
      const pts = input.features.filter((f) => f.geometry).map((f) => ({ f, c: centerCoordsOf(f) }));
      if (!pts.length) throw new Error('This layer has no points.');
      guard(pts.length, 15000, 'points');
      const epsKm = toKm(Number(p.distance) || 1, p.units || 'kilometers');
      const minPts = Math.max(2, Math.round(Number(p.minPoints) || 3));
      const n = pts.length;
      const labels = new Int32Array(n).fill(-1); // -1 = unvisited, 0 = noise, >0 = cluster_id
      const visited = new Uint8Array(n);
      const neighbors = (i) => {
        const res = [];
        const ci = pts[i].c;
        for (let j = 0; j < n; j++) {
          if (haversineKm(ci, pts[j].c) <= epsKm) res.push(j);
        }
        return res;
      };
      let clusterId = 0;
      for (let i = 0; i < n; i++) {
        if (visited[i]) continue;
        visited[i] = 1;
        const nb = neighbors(i);
        if (nb.length < minPts) {
          labels[i] = 0;
          continue;
        }
        clusterId++;
        labels[i] = clusterId;
        const queue = [...nb];
        const inQueue = new Set(nb);
        for (let q = 0; q < queue.length; q++) {
          const curr = queue[q];
          if (!visited[curr]) {
            visited[curr] = 1;
            const nb2 = neighbors(curr);
            if (nb2.length >= minPts) {
              for (const m of nb2) if (!inQueue.has(m)) { inQueue.add(m); queue.push(m); }
            }
          }
          if (labels[curr] <= 0) labels[curr] = clusterId;
        }
      }
      const counts = new Map();
      for (let i = 0; i < n; i++) {
        if (labels[i] > 0) counts.set(labels[i], (counts.get(labels[i]) || 0) + 1);
      }
      const out = [];
      for (let i = 0; i < n; i++) {
        const cid = labels[i];
        if (cid === 0 && !p.keepNoise) continue;
        out.push({
          ...pts[i].f,
          properties: {
            ...pts[i].f.properties,
            cluster_id: cid > 0 ? `Cluster ${cid}` : 'Outlier',
            cluster_size: cid > 0 ? counts.get(cid) : 1,
          },
        });
      }
      return { data: fc(out), field: 'cluster_id', note: `${clusterId} spatial ${clusterId === 1 ? 'cluster' : 'clusters'} found (${counts.size ? [...counts.values()].reduce((a, b) => a + b, 0) : 0} clustered points)` };
    },
    style: () => ({ color: '#2563eb', mode: 'categorical', field: 'cluster_id', radius: 7, opacity: 0.85 }),
  },

  tablejoin: {
    name: 'Join attributes by field', icon: 'table', group: 'Manage data', desc: 'Enrich a layer with columns from another layer by matching a shared ID, code or name field.',
    inputs: [{ k: 'input', label: 'Target layer (keeps its shapes)' }, { k: 'join', label: 'Join table layer (attributes to copy)' }],
    params: [
      { k: 'targetField', t: 'field', label: 'Key field in target layer', of: 'input' },
      { k: 'joinField', t: 'field', label: 'Matching key field in join layer', of: 'join' },
      { k: 'keepUnmatched', t: 'check', label: 'Keep target features with no match', dflt: true },
    ],
    name_: (p, a) => `${a.input} joined with ${a.join}`,
    run({ input, join }, p) {
      if (!p.targetField || !p.joinField) throw new Error('Choose the matching key fields in both layers.');
      const lookup = new Map();
      const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase());
      join.features.forEach((jf) => {
        const key = norm(jf.properties?.[p.joinField]);
        if (key && !lookup.has(key)) lookup.set(key, jf.properties || {});
      });
      let matched = 0;
      const out = [];
      input.features.forEach((f) => {
        const key = norm(f.properties?.[p.targetField]);
        const hit = key ? lookup.get(key) : null;
        if (hit) {
          matched++;
          prefixed(hit, 'join_', (extra) => out.push({ ...f, properties: { ...f.properties, ...extra } }));
        } else if (p.keepUnmatched) {
          out.push(f);
        }
      });
      return { data: fc(out), note: `Matched ${matched.toLocaleString()} of ${input.features.length.toLocaleString()} features on ${p.targetField} = ${p.joinField}` };
    },
    style: (src) => ({ ...src?.style }),
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

  elevation: {
    name: 'Elevation profile & slope', icon: 'mountain', group: 'Terrain',
    desc: 'Lines become a profile of sample points with elevation, distance and grade (%). Points and areas get an elevation_m field. Uses free global DEM data, no setup.',
    inputs: [{ k: 'input', label: 'Routes, trails, sites or areas' }],
    params: [
      { k: 'samples', t: 'number', label: 'Profile samples per line', dflt: 120 },
      { k: 'detail', t: 'choice', label: 'DEM detail', dflt: '12', opts: [['10', '~120 m'], ['12', '~30 m'], ['14', '~8 m']] },
    ],
    name_: (p, a) => `${a.input} elevation`,
    async run({ input }, p) {
      const zoom = Number(p.detail) || 12;
      const feats = input.features.filter((f) => f.geometry);
      guard(feats.length, 2000, 'features');
      const lines = feats.filter((f) => geomKind(f) === 'line');
      if (lines.length) {
        const samples = Math.max(10, Math.min(500, Number(p.samples) || 120));
        const out = [];
        const notes = [];
        for (const [li, f] of lines.slice(0, 25).entries()) {
          const parts = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
          const coords = parts.flat();
          const pts = densifyLine(coords, samples);
          const elev = await sampleElevations(pts.map((s) => s.c), { zoom });
          const good = pts.map((s, i) => ({ ...s, elev: elev[i] })).filter((s) => s.elev != null);
          if (good.length < 2) continue;
          const st = profileStats(good);
          const name = featureName(f.properties) || `Line ${li + 1}`;
          good.forEach((s, i) => out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [round(s.c[0], 6), round(s.c[1], 6)] },
            properties: { line: name, sample: i + 1, distance_km: round(s.km, 3), elevation_m: s.elev, grade_pct: round(st.grades[i], 1) } }));
          notes.push(`${name}: ${st.length_km} km, +${st.gain_m} m / −${st.loss_m} m, ${st.min_m}–${st.max_m} m, steepest ${st.max_grade_pct}%`);
        }
        if (!out.length) throw new Error('Could not read elevation for these lines. Check your connection and try again.');
        return { data: fc(out), field: 'elevation_m', note: notes.join(' · ') };
      }
      const centers = feats.map((f) => pointOfSafe(f));
      const elev = await sampleElevations(centers, { zoom });
      const out = feats.map((f, i) => ({ ...f, properties: { ...f.properties, elevation_m: elev[i], elevation_ft: elev[i] == null ? null : round(elev[i] * 3.28084, 1) } }));
      const vals = elev.filter((e) => e != null);
      return { data: fc(out), field: 'elevation_m', note: vals.length ? `Elevation ${Math.round(Math.min(...vals))}–${Math.round(Math.max(...vals))} m across ${vals.length.toLocaleString()} features` : 'No elevation could be read' };
    },
    style: (src, r) => ({ color: '#15803d', mode: 'graduated', field: r?.field || 'elevation_m' }),
  },
};

// A representative [lng,lat] for any feature, falling back to vertex averaging when Turf is missing.
const pointOfSafe = (f) => centerCoordsOf(f);

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
export const TOOL_GROUPS = ['Summarize', 'Proximity', 'Overlay', 'Terrain', 'Manage data'];

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
