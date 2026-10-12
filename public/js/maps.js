// Map helpers on top of MapLibre GL (global `maplibregl` loaded from CDN).
// A "view" is { center:[lng,lat], zoom, bearing, pitch, basemap, markers:[…], layers:[layerId…], legend }.
// Data layers are defined once per story (story.layers) and each view says which are visible.

// Raster basemaps need glyphs for our own label layers, so they point at OpenFreeMap's font server.
const rasterStyle = (id, tiles, attribution, maxzoom = 19) => ({
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: { [id]: { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom, attribution } },
  layers: [{ id: `${id}-bg`, type: 'background', paint: { 'background-color': '#0b1220' } }, { id, type: 'raster', source: id }],
});

export const BASEMAPS = {
  streets: { label: 'Streets', style: 'https://tiles.openfreemap.org/styles/liberty' },
  bright: { label: 'Bright', style: 'https://tiles.openfreemap.org/styles/bright' },
  light: { label: 'Light gray', style: 'https://tiles.openfreemap.org/styles/positron' },
  dark: { label: 'Dark', style: 'https://tiles.openfreemap.org/styles/dark' },
  satellite: { label: 'Satellite', style: rasterStyle('s2', 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg',
    '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)', 15) },
  'usgs-imagery': { label: 'USGS imagery', style: rasterStyle('usgsimg', 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    'USGS The National Map: Orthoimagery', 16) },
  'usgs-topo': { label: 'USGS topo', style: rasterStyle('usgstopo', 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    'USGS The National Map', 16) },
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
  // Start the credits collapsed (one tap opens them) so long source lists don't cover the map.
  map.once('load', () => container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
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

/** Resolves a layer definition to a GeoJSON FeatureCollection (cached by URL + options). */
export function loadLayerData(layer) {
  if (layer.data) return Promise.resolve(layer.data);
  if (!layer.url || layer.type === 'raster') return Promise.resolve(emptyFC());
  const key = `${layer.url}|${JSON.stringify(layer.query || {})}|${layer.transform || ''}`;
  if (!cache.has(key)) {
    const p = (FEATURE_SERVICE.test(layer.url) ? fetchFeatureService(layer.url, layer.query) : fetchGeoJSON(layer.url))
      .then((json) => (TRANSFORMS[layer.transform] ? TRANSFORMS[layer.transform](json) : json))
      .then(toFeatureCollection)
      .catch((err) => { cache.delete(key); throw err; });
    cache.set(key, p);
  }
  return cache.get(key);
}

const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
// Relative paths are relative to the site root, so they work from /s/<slug> pages too.
const absolute = (url) => (/^(https?:)?\/\//i.test(url) || url.startsWith('/') ? url : `/${url}`);
const fetchJson = (url) => fetch(absolute(url)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));

// GeoJSON, following OGC API "next" links (e.g. USGS Water Data) up to a sensible limit.
async function fetchGeoJSON(url, maxFeatures = 20000) {
  let json = await fetchJson(url);
  if (json?.type !== 'FeatureCollection' || !Array.isArray(json.links)) return json;
  const features = [...json.features];
  for (let pages = 0; pages < 40 && features.length < maxFeatures; pages++) {
    const next = json.links.find((l) => l.rel === 'next' && /json/i.test(l.type || 'json'))?.href;
    if (!next || !json.features?.length) break;
    json = await fetchJson(next);
    features.push(...(json.features || []));
  }
  return { type: 'FeatureCollection', features };
}

// Public ArcGIS REST layers expose GeoJSON via /query; page through the server's record limit.
// query: optional { where, outFields, maxAllowableOffset, orderByFields } passed to the server.
async function fetchFeatureService(url, query = {}, maxFeatures = 20000) {
  const base = url.replace(/\/?$/, '/query');
  const features = [];
  for (let offset = 0; offset < maxFeatures;) {
    const q = new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', f: 'geojson', ...query, resultOffset: offset });
    const page = await fetchJson(`${base}?${q}`);
    if (page.error) throw new Error(page.error.message || 'Service error');
    features.push(...(page.features || []));
    const more = page.exceededTransferLimit || page.properties?.exceededTransferLimit;
    if (!more || !page.features?.length) break;
    offset += page.features.length;
  }
  return { type: 'FeatureCollection', features };
}

// Converters for public feeds that aren't plain, flat GeoJSON.
const iso = (t) => (t ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '');
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null && o[k] !== '').map((k) => [k, o[k]]));
export const TRANSFORMS = {
  'usgs-quakes': (j) => ({ type: 'FeatureCollection', features: j.features.map((f) => ({ ...f, properties: {
    title: f.properties.title, magnitude: f.properties.mag, place: f.properties.place, when: iso(f.properties.time), time: f.properties.time,
    depth_km: f.geometry?.coordinates?.[2], alert: f.properties.alert || 'none', tsunami: f.properties.tsunami ? 'yes' : 'no', felt: f.properties.felt, url: f.properties.url,
  } })) }),
  eonet: (j) => ({ type: 'FeatureCollection', features: j.features.map((f) => ({ ...f, properties: {
    title: f.properties.title, category: (f.properties.categories || []).map((c) => c.title).join(', '), date: iso(f.properties.date), time: Date.parse(f.properties.date) || null,
    magnitude: f.properties.magnitudeValue, unit: f.properties.magnitudeUnit, source: (f.properties.sources || []).map((x) => x.id).join(', '), link: f.properties.link,
  } })) }),
  'nws-alerts': (j) => ({ type: 'FeatureCollection', features: j.features.filter((f) => f.geometry).map((f) => ({ ...f, properties: {
    ...pick(f.properties, ['event', 'severity', 'certainty', 'urgency', 'headline', 'areaDesc', 'senderName']),
    onset: iso(f.properties.onset || f.properties.effective), expires: iso(f.properties.expires), time: Date.parse(f.properties.onset || f.properties.effective) || null,
  } })) }),
  'coops-stations': (j) => ({ type: 'FeatureCollection', features: (j.stations || []).filter((st) => Number.isFinite(+st.lng) && Number.isFinite(+st.lat)).map((st) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [+st.lng, +st.lat] },
    properties: { name: st.name, station_id: st.id, state: st.state || '', tidal: st.tidal ? 'yes' : 'no', great_lakes: st.greatlakes ? 'yes' : 'no',
      data: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${st.id}` },
  })) }),
  'usgs-water': (j) => ({ type: 'FeatureCollection', features: j.features.map((f) => ({ ...f, properties: {
    ...pick(f.properties, ['monitoring_location_name', 'monitoring_location_number', 'site_type', 'county_name', 'state_name', 'hydrologic_unit_code', 'altitude', 'drainage_area']),
    data: f.properties.monitoring_location_number ? `https://waterdata.usgs.gov/monitoring-location/${f.properties.monitoring_location_number}/` : undefined,
  } })) }),
};

/* ---------------- Filters ---------------- */

// A layer's filters: layer.filters = [{ field, op, value }], combined with layer.filterMatch ('all' | 'any').
export const FILTER_OPS = ['=', '≠', '>', '≥', '<', '≤', 'contains', 'in the last (days)', 'is empty', 'is not empty'];
const asTime = (v) => (typeof v === 'number' ? (v > 1e11 ? v : v * 1000) : Date.parse(String(v ?? '').replace(' UTC', 'Z')));
export function matchesFilter(props, { field, op, value }) {
  if (!field || !op) return true;
  const x = props?.[field];
  const v = value ?? '';
  const empty = x == null || x === '';
  if (op === 'is empty') return empty;
  if (op === 'is not empty') return !empty;
  if (v === '') return true; // a rule without a value yet doesn't filter anything
  if (op === 'in the last (days)') { const t = asTime(x); return Number.isFinite(t) && Date.now() - t <= Number(v) * 864e5; }
  if (op === 'contains') return String(x ?? '').toLowerCase().includes(String(v).toLowerCase());
  const nx = Number(x);
  const nv = Number(v);
  const numeric = v !== '' && !empty && Number.isFinite(nx) && Number.isFinite(nv);
  // dates like 2024-05-01 compare as dates
  const dates = !numeric && /^\d{4}-\d{2}-\d{2}/.test(String(v)) && Number.isFinite(asTime(x));
  const a = numeric ? nx : dates ? asTime(x) : String(x ?? '').toLowerCase();
  const b = numeric ? nv : dates ? Date.parse(v) : String(v).toLowerCase();
  switch (op) {
    case '=': return a === b;
    case '≠': return a !== b;
    case '>': return a > b;
    case '≥': return a >= b;
    case '<': return a < b;
    case '≤': return a <= b;
    default: return true;
  }
}
export const activeFilters = (layer) => (layer.filters || []).filter((f) => f.field && f.op);
export function filterData(layer, fc) {
  const rules = activeFilters(layer);
  if (!rules.length) return fc;
  const any = layer.filterMatch === 'any';
  return { type: 'FeatureCollection', features: fc.features.filter((f) => (any ? rules.some((r) => matchesFilter(f.properties, r)) : rules.every((r) => matchesFilter(f.properties, r)))) };
}
/** The features a layer actually shows: its data with its filters applied. */
export const layerFeatures = async (layer) => filterData(layer, await loadLayerData(layer));

// GIBS-style daily imagery uses {date}; default to yesterday (today's mosaic is usually incomplete).
export const tileUrl = (layer) => String(layer.tiles || '').replace('{date}', layer.date || new Date(Date.now() - 864e5).toISOString().slice(0, 10));

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
// Each data layer is drawn with several MapLibre layers; which ones exist depends on style.display.
const SUBS = ['raster', 'fill', 'lineglow', 'line', 'dash', 'dot', 'glow', 'circle', 'arrow', 'note', 'label', 'heat', 'cluster', 'count'];
const subIds = (id) => SUBS.map((k) => `dl-${id}-${k}`);
const hitIds = (map) => map._library.flatMap((l) => ['fill', 'line', 'dash', 'dot', 'circle', 'note', 'cluster'].map((k) => `dl-${l.id}-${k}`)).filter((id) => map.getLayer(id));

/* Per-feature styles. Features can carry their own look in the simplestyle convention (also written by geojson.io):
   stroke, stroke-width, stroke-opacity, fill, fill-opacity, marker-color, marker-size. Waymark adds stroke-dash
   (solid | dashed | dotted), arrow (an arrowhead at the end of a line) and text (a point drawn as a text label,
   sized by text-size). In single-color layers these win over the layer's own style. */
export const FEATURE_STYLE_KEYS = ['stroke', 'stroke-width', 'stroke-opacity', 'fill', 'fill-opacity', 'marker-color', 'marker-size', 'marker-symbol', 'stroke-dash', 'arrow', 'text', 'text-size'];
const num = (key, fallback) => ['case', ['has', key], ['to-number', ['get', key], fallback], fallback];
const DASH = ['coalesce', ['get', 'stroke-dash'], 'solid'];
const NOTE = ['has', 'text'];
const ARROWHEAD = ['has', '__arrow'];
const PLAIN_POINT = ['all', POINT, ['!', NOTE], ['!', ARROWHEAD]];
// Themes whose maps draw data with a soft glow ("firefly" cartography).
// Labels and text notes switch to light text on dark and imagery basemaps.
const darkBase = (map) => ['dark', 'satellite', 'usgs-imagery'].includes(map._basemap);
const glowing = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'aurora';

// Arrowheads are extra points at the end of each line marked `arrow`, rotated to the last segment.
function withArrows(fc) {
  const heads = [];
  fc.features.forEach((f) => {
    const p = f.properties;
    if (!p?.arrow || p.arrow === 'false' || !f.geometry) return;
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    lines.forEach((c) => {
      if (c.length < 2) return;
      const [a, b] = [c.at(-2), c.at(-1)];
      const k = Math.cos((b[1] * Math.PI) / 180);
      const rotate = (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI;
      heads.push({ type: 'Feature', geometry: { type: 'Point', coordinates: b },
        properties: { __arrow: true, rotate, stroke: p.stroke, 'stroke-width': p['stroke-width'], 'stroke-opacity': p['stroke-opacity'] } });
    });
  });
  return heads.length ? { ...fc, features: [...fc.features, ...heads] } : fc;
}

// A triangle drawn as a signed-distance image, so MapLibre can tint it with icon-color.
function addArrowImage(map) {
  if (map.hasImage('wm-arrow')) return;
  const n = 48;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(n / 2, 6); g.lineTo(n - 8, n - 8); g.lineTo(n / 2, n - 16); g.lineTo(8, n - 8); g.closePath(); g.fill();
  map.addImage('wm-arrow', g.getImageData(0, 0, n, n), { sdf: true, pixelRatio: 2 });
}
const displayOf = (layer) => layer.style?.display || 'features';
const NOT_CLUSTER = ['!', ['has', 'point_count']];

function rgba(hex, a) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}
const heatStops = (color) => [[0, rgba(color, 0)], [0.15, rgba(color, 0.35)], [0.4, color], [0.7, mix(color, '#ffc64d', 0.6)], [1, '#fff4c2']];

/** Adds any library layers that a live map doesn't have yet (e.g. just added from the catalog). */
export function refreshLayers(map) {
  if (map.isStyleLoaded()) installLayers(map);
}

function installLayers(map) {
  map._legendInfo ||= {};
  map._library.forEach((layer) => {
    const src = `dl-${layer.id}`;
    if (map.getSource(src)) return;
    const s = layer.style || {};
    const display = displayOf(layer);
    const vis = map._visible.includes(layer.id) ? 'visible' : 'none';
    const color = /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : PALETTE[0];
    const radius = s.radius ?? 6;
    if (layer.type === 'raster') {
      // Imagery overlays sit under the basemap's labels so place names stay readable.
      map.addSource(src, { type: 'raster', tiles: [tileUrl(layer)], tileSize: 256, maxzoom: layer.maxzoom ?? 18, attribution: layer.attribution || '' });
      const labels = map.getStyle().layers.find((l) => l.type === 'symbol' && !l.id.startsWith('dl-'))?.id;
      map.addLayer({ id: `${src}-raster`, type: 'raster', source: src, layout: { visibility: vis }, paint: { 'raster-opacity': s.opacity ?? 0.85 } }, labels);
      map._legendInfo[layer.id] = { type: 'imagery' };
      return;
    }
    map.addSource(src, { type: 'geojson', data: emptyFC(), ...(layer.attribution ? { attribution: layer.attribution } : {}), ...(display === 'clusters' ? { cluster: true, clusterRadius: 50, clusterMaxZoom: 14 } : {}) });
    addArrowImage(map);
    const width = num('stroke-width', ['case', LINE, s.width ?? 3, 1]);
    const lineOpacity = num('stroke-opacity', 1);
    map.addLayer({ id: `${src}-fill`, type: 'fill', source: src, filter: POLY, layout: { visibility: vis },
      paint: { 'fill-color': color, 'fill-opacity': num('fill-opacity', s.opacity ?? 0.45) } });
    if (glowing()) {
      map.addLayer({ id: `${src}-lineglow`, type: 'line', source: src, filter: LINE, layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': ['*', width, 5], 'line-blur': ['*', width, 3.5], 'line-opacity': 0.4 } });
    }
    // Dashes can't vary per feature in MapLibre, so dashed and dotted outlines get layers of their own.
    map.addLayer({ id: `${src}-line`, type: 'line', source: src, filter: ['all', ['any', POLY, LINE], ['==', DASH, 'solid']], layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': width, 'line-opacity': lineOpacity } });
    map.addLayer({ id: `${src}-dash`, type: 'line', source: src, filter: ['all', ['any', POLY, LINE], ['==', DASH, 'dashed']], layout: { visibility: vis, 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': width, 'line-opacity': lineOpacity, 'line-dasharray': [2.4, 1.6] } });
    map.addLayer({ id: `${src}-dot`, type: 'line', source: src, filter: ['all', ['any', POLY, LINE], ['==', DASH, 'dotted']], layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': width, 'line-opacity': lineOpacity, 'line-dasharray': [0, 2] } });
    if (display === 'heatmap') {
      map.addLayer({ id: `${src}-heat`, type: 'heatmap', source: src, filter: POINT, maxzoom: 17, layout: { visibility: vis }, paint: {
        'heatmap-weight': 1,
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, radius * 1.6, 15, radius * 6],
        'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], ...heatStops(color).flat()],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.92, 16, 0.2],
      } });
    }
    if (display === 'clusters') {
      map.addLayer({ id: `${src}-cluster`, type: 'circle', source: src, filter: ['has', 'point_count'], layout: { visibility: vis }, paint: {
        'circle-color': color, 'circle-opacity': 0.88,
        'circle-radius': ['step', ['get', 'point_count'], 15, 10, 19, 50, 25, 250, 32, 1000, 40],
        'circle-stroke-color': rgba(color, 0.35), 'circle-stroke-width': 6,
      } });
      map.addLayer({ id: `${src}-count`, type: 'symbol', source: src, filter: ['has', 'point_count'], layout: {
        visibility: vis, 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true },
      paint: { 'text-color': '#ffffff' } });
    }
    const pointSize = ['match', ['get', 'marker-size'], 'small', radius * 0.7, 'large', radius * 1.7, radius];
    if (glowing() && display !== 'heatmap') {
      map.addLayer({ id: `${src}-glow`, type: 'circle', source: src, filter: display === 'clusters' ? ['all', PLAIN_POINT, NOT_CLUSTER] : PLAIN_POINT, layout: { visibility: vis },
        paint: { 'circle-color': color, 'circle-radius': ['*', pointSize, 3], 'circle-blur': 1, 'circle-opacity': 0.55 } });
    }
    map.addLayer({ id: `${src}-circle`, type: 'circle', source: src, filter: display === 'clusters' ? ['all', PLAIN_POINT, NOT_CLUSTER] : PLAIN_POINT, layout: { visibility: vis },
      paint: { 'circle-color': color, 'circle-radius': pointSize,
        'circle-stroke-color': glowing() ? 'rgba(255,255,255,0.85)' : '#ffffff', 'circle-stroke-width': glowing() ? 0.8 : ['match', ['get', 'marker-size'], 'large', 2.5, 1.5],
        'circle-opacity': display === 'heatmap' ? ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15.5, 0.92] : 0.92,
        'circle-stroke-opacity': display === 'heatmap' ? ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15.5, 1] : 1 } });
    map.addLayer({ id: `${src}-arrow`, type: 'symbol', source: src, filter: ['all', POINT, ARROWHEAD], layout: {
      visibility: vis, 'icon-image': 'wm-arrow', 'icon-rotate': ['get', 'rotate'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], num('stroke-width', s.width ?? 3), 1, 0.55, 12, 2.2] },
    paint: { 'icon-color': color, 'icon-opacity': lineOpacity } });
    map.addLayer({ id: `${src}-note`, type: 'symbol', source: src, filter: ['all', POINT, NOTE], layout: {
      visibility: vis, 'text-field': ['to-string', ['get', 'text']], 'text-font': ['Noto Sans Bold'], 'text-size': num('text-size', 18),
      'text-max-width': 14, 'text-allow-overlap': true, 'text-ignore-placement': true },
    paint: { 'text-color': color, 'text-halo-color': darkBase(map) ? 'rgba(8,8,16,0.85)' : '#ffffff', 'text-halo-width': 2, 'text-opacity': lineOpacity } });
    map.addLayer({ id: `${src}-label`, type: 'symbol', source: src, filter: display === 'clusters' ? NOT_CLUSTER : ['all', ['!', NOTE], ['!', ARROWHEAD]], layout: {
      visibility: s.label ? vis : 'none', 'text-field': s.label ? ['to-string', ['get', s.label]] : '', 'text-font': ['Noto Sans Regular'],
      'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
    paint: darkBase(map) ? { 'text-color': '#f3f2fb', 'text-halo-color': 'rgba(8,8,16,0.85)', 'text-halo-width': 1.5 } : { 'text-color': '#1f2937', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });

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
  const display = displayOf(layer);
  if (layer.type === 'raster') return;
  layerFeatures(layer).then((fc) => {
    if (map.getSource(src) !== source) return; // style was swapped while loading
    source.setData(display === 'features' ? withArrows(fc) : fc);
    const { expr, legend } = colorRamp(layer, fc);
    const own = !s.mode || s.mode === 'single'; // features' own colors only override a single-color style
    const line = own ? ['to-color', ['get', 'stroke'], expr] : ['case', POLY, '#ffffff', expr];
    map.setPaintProperty(`${src}-fill`, 'fill-color', own ? ['to-color', ['get', 'fill'], ['get', 'stroke'], expr] : expr);
    ['line', 'dash', 'dot'].forEach((k) => map.setPaintProperty(`${src}-${k}`, 'line-color', line));
    map.setPaintProperty(`${src}-arrow`, 'icon-color', line);
    map.setPaintProperty(`${src}-note`, 'text-color', own ? ['to-color', ['get', 'stroke'], darkBase(map) ? '#f3f2fb' : '#1f2937'] : expr);
    map.setPaintProperty(`${src}-circle`, 'circle-color', own ? ['to-color', ['get', 'marker-color'], expr] : expr);
    if (map.getLayer(`${src}-glow`)) map.setPaintProperty(`${src}-glow`, 'circle-color', own ? ['to-color', ['get', 'marker-color'], expr] : expr);
    if (map.getLayer(`${src}-lineglow`)) map.setPaintProperty(`${src}-lineglow`, 'line-color', line);
    let info = drawnLegend(layer, fc) || legend;
    if (display === 'heatmap') {
      const color = /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : PALETTE[0];
      if (s.weight) {
        const vals = fc.features.map((f) => Number(f.properties?.[s.weight])).filter(Number.isFinite);
        const max = vals.length ? Math.max(...vals) : 0;
        if (max > 0) map.setPaintProperty(`${src}-heat`, 'heatmap-weight', ['interpolate', ['linear'], ['to-number', ['get', s.weight], 0], 0, 0, max, 1]);
      }
      info = { type: 'heat', stops: heatStops(color), weight: s.weight };
    }
    if (display === 'clusters') info = { ...legend, clusters: true };
    map._legendInfo[layer.id] = info;
    map._legend.render(map);
  }).catch((err) => {
    map._legendInfo[layer.id] = { type: 'error', message: err.message };
    map._legend.render(map);
  });
}

/** Re-reads a layer's data and paint after its features changed (used while drawing). */
export function reloadLayer(map, layer) {
  const source = map.getSource(`dl-${layer.id}`);
  if (!source) return;
  source._smLoading = false;
  loadInto(map, layer);
}

// A drawn layer's legend lists its named shapes with their own colors.
function drawnLegend(layer, fc) {
  if (!layer.drawn || (layer.style?.mode && layer.style.mode !== 'single')) return null;
  const seen = new Set();
  const entries = [];
  fc.features.forEach((f) => {
    const p = f.properties || {};
    const name = String(p.name || '').trim();
    const c = p.fill || p.stroke || p['marker-color'] || layer.style?.color || PALETTE[0];
    if (!name || p.text || seen.has(name + c) || entries.length >= 8) return;
    seen.add(name + c);
    entries.push([name, c]);
  });
  return entries.length ? { type: 'categories', entries } : null;
}

export function setVisibleLayers(map, ids) {
  map._visible = ids;
  map._library.forEach((layer) => {
    const vis = ids.includes(layer.id) ? 'visible' : 'none';
    if (vis === 'visible') loadInto(map, layer);
    SUBS.forEach((k) => {
      const lid = `dl-${layer.id}-${k}`;
      if (!map.getLayer(lid)) return;
      map.setLayoutProperty(lid, 'visibility', k === 'label' && !layer.style?.label ? 'none' : vis);
    });
  });
  map._legend.render(map);
}

/* ---------------- Popups ---------------- */

function bindPopups(map) {
  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px' });
  map.on('click', (e) => {
    const ids = hitIds(map);
    if (!ids.length) return;
    const f = map.queryRenderedFeatures(e.point, { layers: ids })[0];
    if (!f) return;
    if (f.layer.id.endsWith('-cluster')) { // zoom into a cluster
      map.getSource(f.layer.source).getClusterExpansionZoom(f.properties.cluster_id)
        .then((z) => map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3 })).catch(() => {});
      return;
    }
    const layer = map._library.find((l) => f.layer.id.startsWith(`dl-${l.id}-`));
    if (!layer || layer.popup?.enabled === false) return;
    const content = popupContent(layer, f.properties);
    if (content.childNodes.length) popup.setLngLat(e.lngLat).setDOMContent(content).addTo(map);
  });
  map.on('mousemove', (e) => {
    const ids = hitIds(map);
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
  if (props.description && !p.fields?.includes('description')) { const d = document.createElement('p'); d.textContent = String(props.description); el.append(d); }
  const fields = p.fields?.length ? p.fields : layer.drawn ? [] : Object.keys(props)
    .filter((k) => !/^(OBJECTID|GLOBALID|FID|SHAPE.*|Shape.*|description)$/i.test(k) && !FEATURE_STYLE_KEYS.includes(k)).slice(0, 8);
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
      if (layer.attribution) { const src = document.createElement('div'); src.className = 'sm-legend-src'; src.textContent = layer.attribution.replace(/<[^>]+>/g, ''); row.append(src); }
      if (info.type === 'error') { const e = document.createElement('div'); e.className = 'sm-legend-err'; e.textContent = 'Could not load: ' + info.message; row.append(e); }
      if (info.type === 'single') name.prepend(swatch(info.color, info.clusters));
      if (info.clusters) { const d = document.createElement('div'); d.className = 'sm-legend-note'; d.textContent = 'Nearby points are grouped; click a group to zoom in'; row.append(d); }
      if (info.type === 'heat') {
        const bar = document.createElement('div');
        bar.className = 'sm-legend-ramp';
        bar.style.background = `linear-gradient(to right, ${info.stops.map(([at, c]) => `${c} ${at * 100}%`).join(', ')})`;
        const lbl = document.createElement('div');
        lbl.className = 'sm-legend-range';
        lbl.innerHTML = '<span>Fewer</span><span>More</span>';
        if (info.weight) lbl.children[1].textContent = `More ${info.weight}`;
        row.append(bar, lbl);
      }
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

const swatch = (c, round = false) => { const s = document.createElement('span'); s.className = 'sm-swatch'; s.style.background = c; if (round) s.style.borderRadius = '50%'; return s; };
const fmt = (n) => (Math.abs(n) >= 1000 ? n.toLocaleString() : String(round(n, 2)));
