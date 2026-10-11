// Map helpers on top of MapLibre GL (global `maplibregl` loaded from CDN).
// A "view" is { center:[lng,lat], zoom, bearing, pitch, basemap, markers:[…], layers:[layerId…], legend }.
// Data layers are defined once per story (story.layers) and each view says which are visible.

export const BASEMAPS = {
  streets: { label: 'Streets', style: 'https://tiles.openfreemap.org/styles/liberty' },
  bright: { label: 'Bright', style: 'https://tiles.openfreemap.org/styles/bright' },
  light: { label: 'Light gray', style: 'https://tiles.openfreemap.org/styles/positron' },
  dark: { label: 'Dark', style: 'https://tiles.openfreemap.org/styles/dark' },
};

export const DEFAULT_VIEW = { center: [-77.04, 38.85], zoom: 10, bearing: 0, pitch: 0, basemap: 'streets', markers: [], layers: [] };

const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5'];
const OTHER = '#9ca3af';

const styleUrl = (key) => (BASEMAPS[key] || BASEMAPS.streets).style;

export function createMap(container, view = DEFAULT_VIEW, { interactive = true, library = [] } = {}) {
  const v = { ...DEFAULT_VIEW, ...view };
  const map = new maplibregl.Map({
    container,
    style: styleUrl(v.basemap),
    center: v.center,
    zoom: v.zoom,
    bearing: v.bearing,
    pitch: v.pitch,
    interactive,
    attributionControl: { compact: true },
  });
  if (interactive) map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.scrollZoom.disable(); // never hijack page scroll
  container._smMap = map; // handy for debugging from devtools
  map._basemap = v.basemap;
  map._markers = [];
  map._library = library;
  map._visible = v.layers || [];
  map._legend = new LegendControl();
  map._legend.enabled = v.legend !== false;
  map.addControl(map._legend, 'bottom-left');
  map.on('style.load', () => installLayers(map));
  if (interactive) bindPopups(map);
  setMarkers(map, v.markers);
  return map;
}

export function setMarkers(map, markers = []) {
  map._markers.forEach((m) => m.remove());
  map._markers = markers.map((mk, i) => {
    const el = document.createElement('div');
    el.className = 'sm-marker';
    el.textContent = mk.label ?? (markers.length > 1 ? String(i + 1) : '');
    const marker = new maplibregl.Marker({ element: el }).setLngLat(mk.lngLat);
    if (mk.title || mk.text) {
      const pop = document.createElement('div');
      if (mk.title) { const h = document.createElement('strong'); h.textContent = mk.title; pop.append(h); }
      if (mk.text) { const p = document.createElement('p'); p.textContent = mk.text; pop.append(p); }
      marker.setPopup(new maplibregl.Popup({ offset: 18, closeButton: false }).setDOMContent(pop));
    }
    return marker.addTo(map);
  });
}

export function applyView(map, view, { animate = true } = {}) {
  const v = { ...DEFAULT_VIEW, ...view };
  map._legend.enabled = v.legend !== false;
  setVisibleLayers(map, v.layers || []);
  if (v.basemap !== map._basemap) {
    map.setStyle(styleUrl(v.basemap), { diff: false }); // style.load re-installs data layers
    map._basemap = v.basemap;
  }
  const cam = { center: v.center, zoom: v.zoom, bearing: v.bearing, pitch: v.pitch };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (animate && !reduce) map.flyTo({ ...cam, duration: 2200, essential: true });
  else map.jumpTo(cam);
  setMarkers(map, v.markers);
}

export function readView(map) {
  const c = map.getCenter();
  return {
    center: [round(c.lng, 5), round(c.lat, 5)],
    zoom: round(map.getZoom(), 2),
    bearing: round(map.getBearing(), 1),
    pitch: round(map.getPitch(), 1),
    basemap: map._basemap,
    layers: [...map._visible],
    legend: map._legend.enabled,
  };
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

/* ---------------- Data loading ---------------- */

const cache = new Map();
const FEATURE_SERVICE = /\/(FeatureServer|MapServer)\/\d+\/?$/i;

/** Resolves a layer definition to a GeoJSON FeatureCollection (cached by URL). */
export function loadLayerData(layer) {
  if (layer.data) return Promise.resolve(layer.data);
  if (!layer.url) return Promise.resolve(emptyFC());
  if (!cache.has(layer.url)) {
    const p = (FEATURE_SERVICE.test(layer.url) ? fetchFeatureService(layer.url) : fetchJson(layer.url))
      .then(toFeatureCollection)
      .catch((err) => { cache.delete(layer.url); throw err; });
    cache.set(layer.url, p);
  }
  return cache.get(layer.url);
}

const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
// Relative paths are relative to the site root, so they work from /s/<slug> pages too.
const absolute = (url) => (/^(https?:)?\/\//i.test(url) || url.startsWith('/') ? url : `/${url}`);
const fetchJson = (url) => fetch(absolute(url)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));

// Public ArcGIS REST layers expose GeoJSON via /query; page through the server's record limit.
async function fetchFeatureService(url, maxFeatures = 20000) {
  const base = url.replace(/\/?$/, '/query');
  const features = [];
  for (let offset = 0; offset < maxFeatures;) {
    const q = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', f: 'geojson', resultOffset: offset });
    const page = await fetchJson(`${base}?${q}`);
    if (page.error) throw new Error(page.error.message || 'Service error');
    features.push(...(page.features || []));
    const more = page.exceededTransferLimit || page.properties?.exceededTransferLimit;
    if (!more || !page.features?.length) break;
    offset += page.features.length;
  }
  return { type: 'FeatureCollection', features };
}

function toFeatureCollection(json) {
  if (json?.type === 'FeatureCollection') return { type: 'FeatureCollection', features: json.features.filter((f) => f.geometry) };
  if (json?.type === 'Feature') return { type: 'FeatureCollection', features: [json] };
  if (json?.type && json.coordinates) return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: json }] };
  throw new Error('Not GeoJSON');
}

export const fieldNames = (fc) => {
  const names = new Set();
  fc.features.slice(0, 200).forEach((f) => Object.keys(f.properties || {}).forEach((k) => names.add(k)));
  return [...names];
};

export function bbox(fc) {
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => {
    if (typeof c[0] === 'number') { b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])]; return; }
    c.forEach(walk);
  };
  fc.features.forEach((f) => f.geometry && walk(f.geometry.coordinates));
  return b[0] === Infinity ? null : b;
}

export async function fitToLayer(map, id) {
  const layer = map._library.find((l) => l.id === id);
  if (!layer) return;
  const b = bbox(await loadLayerData(layer));
  if (b) map.fitBounds(b, { padding: 48, maxZoom: 16, duration: 800 });
}

/* ---------------- Styling ---------------- */

/** Computes the MapLibre color expression and legend entries for a layer given its data. */
export function colorRamp(layer, fc) {
  const s = layer.style || {};
  const color = s.color || PALETTE[0];
  const field = s.field;
  if (s.mode === 'categorical' && field) {
    const counts = new Map();
    fc.features.forEach((f) => { const v = String(f.properties?.[field] ?? '—'); counts.set(v, (counts.get(v) || 0) + 1); });
    const cats = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, PALETTE.length).map(([v]) => v);
    const pick = (v, i) => s.colors?.[v] || PALETTE[i];
    const entries = cats.map((v, i) => [v, pick(v, i)]);
    if (counts.size > cats.length) entries.push(['Other', OTHER]);
    const expr = cats.length ? ['match', ['to-string', ['coalesce', ['get', field], '—']], ...cats.flatMap((v, i) => [v, pick(v, i)]), OTHER] : color;
    return { expr, legend: { type: 'categories', entries } };
  }
  if (s.mode === 'graduated' && field) {
    const vals = fc.features.map((f) => Number(f.properties?.[field])).filter(Number.isFinite);
    if (vals.length) {
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const low = mix(color, '#ffffff', 0.8);
      const expr = min === max ? color : ['interpolate', ['linear'], ['to-number', ['get', field], min], min, low, max, color];
      return { expr, legend: { type: 'ramp', min, max, low, high: color } };
    }
  }
  return { expr: color, legend: { type: 'single', color } };
}

function mix(a, b, t) {
  const p = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

const POLY = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];
const LINE = ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]];
const POINT = ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]];
const subIds = (id) => ['fill', 'line', 'circle', 'label'].map((k) => `dl-${id}-${k}`);

function installLayers(map) {
  map._legendInfo = {};
  map._library.forEach((layer) => {
    const src = `dl-${layer.id}`;
    if (map.getSource(src)) return;
    const s = layer.style || {};
    const vis = map._visible.includes(layer.id) ? 'visible' : 'none';
    const color = s.color || PALETTE[0];
    map.addSource(src, { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: `${src}-fill`, type: 'fill', source: src, filter: POLY, layout: { visibility: vis },
      paint: { 'fill-color': color, 'fill-opacity': s.opacity ?? 0.45 } });
    map.addLayer({ id: `${src}-line`, type: 'line', source: src, filter: ['any', POLY, LINE], layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': ['case', LINE, s.width ?? 3, 1] } });
    map.addLayer({ id: `${src}-circle`, type: 'circle', source: src, filter: POINT, layout: { visibility: vis },
      paint: { 'circle-color': color, 'circle-radius': s.radius ?? 6, 'circle-opacity': 0.9, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: `${src}-label`, type: 'symbol', source: src, layout: {
      visibility: s.label ? vis : 'none', 'text-field': s.label ? ['to-string', ['get', s.label]] : '', 'text-font': ['Noto Sans Regular'],
      'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': '#1f2937', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });

    if (vis === 'visible') loadInto(map, layer);
  });
  map._legend.render(map);
}

// Fetch a layer's data the first time it becomes visible on this style.
function loadInto(map, layer) {
  const src = `dl-${layer.id}`;
  const source = map.getSource(src);
  if (!source || source._smLoading) return;
  source._smLoading = true;
  const s = layer.style || {};
  loadLayerData(layer).then((fc) => {
    if (map.getSource(src) !== source) return; // style was swapped while loading
    source.setData(fc);
    const { expr, legend } = colorRamp(layer, fc);
    map.setPaintProperty(`${src}-fill`, 'fill-color', expr);
    map.setPaintProperty(`${src}-line`, 'line-color', s.mode && s.mode !== 'single' ? ['case', POLY, '#ffffff', expr] : expr);
    map.setPaintProperty(`${src}-circle`, 'circle-color', expr);
    map._legendInfo[layer.id] = legend;
    map._legend.render(map);
  }).catch((err) => {
    map._legendInfo[layer.id] = { type: 'error', message: err.message };
    map._legend.render(map);
  });
}

export function setVisibleLayers(map, ids) {
  map._visible = ids;
  map._library.forEach((layer) => {
    const vis = ids.includes(layer.id) ? 'visible' : 'none';
    if (vis === 'visible') loadInto(map, layer);
    subIds(layer.id).forEach((lid, k) => {
      if (!map.getLayer(lid)) return;
      map.setLayoutProperty(lid, 'visibility', k === 3 && !layer.style?.label ? 'none' : vis);
    });
  });
  map._legend.render(map);
}

/* ---------------- Popups ---------------- */

function bindPopups(map) {
  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px' });
  map.on('click', (e) => {
    const ids = map._library.flatMap((l) => subIds(l.id).slice(0, 3)).filter((id) => map.getLayer(id));
    if (!ids.length) return;
    const f = map.queryRenderedFeatures(e.point, { layers: ids })[0];
    if (!f) return;
    const layer = map._library.find((l) => f.layer.id.startsWith(`dl-${l.id}-`));
    if (!layer || layer.popup?.enabled === false) return;
    popup.setLngLat(e.lngLat).setDOMContent(popupContent(layer, f.properties)).addTo(map);
  });
  map.on('mousemove', (e) => {
    const ids = map._library.flatMap((l) => subIds(l.id).slice(0, 3)).filter((id) => map.getLayer(id));
    const hit = ids.length && map.queryRenderedFeatures(e.point, { layers: ids }).length;
    map.getCanvas().style.cursor = hit ? 'pointer' : '';
  });
}

function popupContent(layer, props = {}) {
  const p = layer.popup || {};
  const el = document.createElement('div');
  el.className = 'sm-popup';
  const title = (p.title || '').replace(/\{([^}]+)\}/g, (_, k) => props[k.trim()] ?? '');
  if (title.trim()) { const h = document.createElement('strong'); h.textContent = title; el.append(h); }
  const fields = p.fields?.length ? p.fields : Object.keys(props).filter((k) => !/^(OBJECTID|GLOBALID|FID|SHAPE.*|Shape.*)$/i.test(k)).slice(0, 8);
  const table = document.createElement('table');
  fields.forEach((k) => {
    if (props[k] == null || props[k] === '') return;
    const tr = table.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = String(props[k]);
  });
  if (table.rows.length) el.append(table);
  return el;
}

/* ---------------- Legend ---------------- */

class LegendControl {
  onAdd() {
    this.el = document.createElement('div');
    this.el.className = 'maplibregl-ctrl sm-legend';
    this.el.hidden = true;
    return this.el;
  }
  onRemove() { this.el.remove(); }
  render(map) {
    if (!this.el) return;
    const shown = map._library.filter((l) => map._visible.includes(l.id));
    this.el.hidden = !this.enabled || !shown.length;
    this.el.replaceChildren(...shown.map((layer) => {
      const info = map._legendInfo?.[layer.id];
      const row = document.createElement('div');
      row.className = 'sm-legend-layer';
      const name = document.createElement('div');
      name.className = 'sm-legend-name';
      name.textContent = layer.name || 'Layer';
      row.append(name);
      if (!info) { name.append(' …'); return row; }
      if (info.type === 'error') { const e = document.createElement('div'); e.className = 'sm-legend-err'; e.textContent = 'Could not load: ' + info.message; row.append(e); }
      if (info.type === 'single') name.prepend(swatch(info.color));
      if (info.type === 'categories') info.entries.forEach(([label, c]) => { const d = document.createElement('div'); d.append(swatch(c), label); row.append(d); });
      if (info.type === 'ramp') {
        const bar = document.createElement('div');
        bar.className = 'sm-legend-ramp';
        bar.style.background = `linear-gradient(to right, ${info.low}, ${info.high})`;
        const lbl = document.createElement('div');
        lbl.className = 'sm-legend-range';
        lbl.innerHTML = '<span></span><span></span>';
        lbl.children[0].textContent = fmt(info.min);
        lbl.children[1].textContent = fmt(info.max);
        row.append(bar, lbl);
      }
      return row;
    }));
  }
}

const swatch = (c) => { const s = document.createElement('span'); s.className = 'sm-swatch'; s.style.background = c; return s; };
const fmt = (n) => (Math.abs(n) >= 1000 ? n.toLocaleString() : String(round(n, 2)));
