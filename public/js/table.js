// Hosted Feature Layers & Editable Attribute Table Studio.
// Provides pure schema/table/field-calculator operations (Node-testable) plus interactive DOM UI.
import { h, icon, toast, dialog, copyText } from './ui.js';
import { api } from './api.js';
import { loadLayerData, invalidateLayerCache, reloadLayer, rebuildLayer, FEATURE_STYLE_KEYS, PALETTE } from './maps.js';
import { csvToGeoJSON } from './csv.js';

const INTERNAL_KEYS = new Set(['__t', '__sym', '__arrow', '__i', ...FEATURE_STYLE_KEYS]);

export const LAYER_TEMPLATES = {
  blank: {
    label: 'Custom / Blank Layer',
    geomType: 'Point',
    fields: [
      { name: 'name', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'notes', type: 'string' },
    ],
  },
  realestate: {
    label: 'Site Selection & Commercial Real Estate',
    geomType: 'Point',
    fields: [
      { name: 'site_name', type: 'string' },
      { name: 'status', type: 'string', default: 'Candidate' },
      { name: 'sqft', type: 'number', default: 15000 },
      { name: 'annual_rent', type: 'number', default: 420000 },
      { name: 'projected_revenue', type: 'number', default: 1250000 },
      { name: 'market_score', type: 'number', default: 85 },
      { name: 'analyst_notes', type: 'string' },
    ],
  },
  assets: {
    label: 'Field Asset & Infrastructure Inspection',
    geomType: 'Point',
    fields: [
      { name: 'asset_id', type: 'string' },
      { name: 'asset_type', type: 'string', default: 'Transformer' },
      { name: 'condition', type: 'string', default: 'Good' },
      { name: 'risk_score', type: 'number', default: 2 },
      { name: 'last_inspected', type: 'date', default: new Date().toISOString().slice(0, 10) },
      { name: 'inspector', type: 'string' },
    ],
  },
  territory: {
    label: 'Sales Territories & Trade Zones',
    geomType: 'Polygon',
    fields: [
      { name: 'territory_name', type: 'string' },
      { name: 'region', type: 'string', default: 'North' },
      { name: 'account_exec', type: 'string' },
      { name: 'store_count', type: 'number', default: 12 },
      { name: 'arr_usd', type: 'number', default: 850000 },
      { name: 'yoy_growth_pct', type: 'number', default: 14.5 },
    ],
  },
};

/* ---------------- Pure Schema & Attribute Helpers ---------------- */

export function hostedLayerIdOf(layer) {
  if (!layer) return null;
  if (layer.hostedLayerId) return String(layer.hostedLayerId);
  const m = /^\/api\/(?:public\/)?layers\/([\w-]+?)(?:\/geojson|\.geojson)?$/.exec(String(layer.url || ''));
  return m ? m[1] : null;
}

export function isHostedLayer(layer) {
  return Boolean(hostedLayerIdOf(layer));
}

export function isEditableLayer(layer) {
  if (!layer || layer.type === 'raster') return false;
  return Boolean(layer.data || isHostedLayer(layer));
}

export function ensureMetadata(fc) {
  if (!fc || typeof fc !== 'object') return { type: 'FeatureCollection', metadata: { fields: [] }, features: [] };
  if (!fc.metadata || typeof fc.metadata !== 'object') fc.metadata = {};
  if (!Array.isArray(fc.metadata.fields)) fc.metadata.fields = [];
  if (!Array.isArray(fc.features)) fc.features = [];
  return fc;
}

export function getLayerSchema(fc, explicitFields) {
  const out = [];
  const seen = new Set();
  const baseFields = Array.isArray(explicitFields) ? explicitFields : fc?.metadata?.fields;
  if (Array.isArray(baseFields)) {
    for (const f of baseFields) {
      const name = String(typeof f === 'string' ? f : f?.name || '').trim();
      if (!name || seen.has(name) || INTERNAL_KEYS.has(name)) continue;
      seen.add(name);
      const type = ['string', 'number', 'boolean', 'date'].includes(f?.type) ? f.type : 'string';
      out.push({ name, type, ...(f?.alias ? { alias: f.alias } : {}), ...(f?.default !== undefined ? { default: f.default } : {}) });
    }
  }
  for (const feat of fc?.features || []) {
    const props = feat?.properties;
    if (!props || typeof props !== 'object') continue;
    for (const [k, v] of Object.entries(props)) {
      if (!k || seen.has(k) || INTERNAL_KEYS.has(k)) continue;
      seen.add(k);
      const type = typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? 'date' : 'string';
      out.push({ name: k, type });
    }
  }
  return out;
}

export function coerceValue(rawVal, fieldType = 'string') {
  if (rawVal === null || rawVal === undefined) return '';
  if (fieldType === 'number') {
    if (rawVal === '') return null;
    const n = Number(String(rawVal).replace(/[,$%\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (fieldType === 'boolean') {
    if (typeof rawVal === 'boolean') return rawVal;
    const s = String(rawVal).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
  }
  return String(rawVal);
}

export function addSchemaField(fc, { name, type = 'string', alias = '', defaultValue = '' } = {}) {
  ensureMetadata(fc);
  const clean = String(name || '').trim().replace(/[^\w\s-]/g, '').trim();
  if (!clean) throw new Error('Enter a field name');
  const schema = getLayerSchema(fc);
  if (schema.some((f) => f.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error(`Field "${clean}" already exists`);
  }
  const fieldType = ['string', 'number', 'boolean', 'date'].includes(type) ? type : 'string';
  const def = defaultValue !== '' && defaultValue !== undefined ? coerceValue(defaultValue, fieldType) : (fieldType === 'number' ? null : fieldType === 'boolean' ? false : '');
  const entry = { name: clean, type: fieldType };
  if (alias) entry.alias = String(alias).trim();
  if (defaultValue !== '' && defaultValue !== undefined) entry.default = def;
  fc.metadata.fields = [...schema, entry];
  for (const feat of fc.features) {
    feat.properties ||= {};
    if (!(clean in feat.properties)) feat.properties[clean] = def;
  }
  return fc.metadata.fields;
}

export function renameSchemaField(fc, oldName, newName) {
  ensureMetadata(fc);
  const clean = String(newName || '').trim().replace(/[^\w\s-]/g, '').trim();
  if (!clean) throw new Error('Enter a valid field name');
  if (clean === oldName) return getLayerSchema(fc);
  const schema = getLayerSchema(fc);
  if (schema.some((f) => f.name !== oldName && f.name.toLowerCase() === clean.toLowerCase())) {
    throw new Error(`Field "${clean}" already exists`);
  }
  fc.metadata.fields = schema.map((f) => (f.name === oldName ? { ...f, name: clean } : f));
  for (const feat of fc.features) {
    if (!feat?.properties || !(oldName in feat.properties)) continue;
    const nextProps = {};
    for (const [k, v] of Object.entries(feat.properties)) {
      nextProps[k === oldName ? clean : k] = v;
    }
    feat.properties = nextProps;
  }
  return fc.metadata.fields;
}

export function deleteSchemaField(fc, fieldName) {
  ensureMetadata(fc);
  const schema = getLayerSchema(fc);
  fc.metadata.fields = schema.filter((f) => f.name !== fieldName);
  for (const feat of fc.features) {
    if (feat?.properties) delete feat.properties[fieldName];
  }
  return fc.metadata.fields;
}

export function addFeatureRow(fc, { properties = {}, center = [-98.5, 39.8], geomType } = {}) {
  ensureMetadata(fc);
  const schema = getLayerSchema(fc);
  const props = {};
  for (const f of schema) {
    props[f.name] = f.default !== undefined ? f.default : (f.type === 'number' ? null : f.type === 'boolean' ? false : '');
  }
  Object.assign(props, properties);
  const gType = geomType || fc.metadata?.geomType || fc.features[0]?.geometry?.type || 'Point';
  const [lng, lat] = Array.isArray(center) && center.length >= 2 ? [+center[0] || 0, +center[1] || 0] : [-98.5, 39.8];
  let geometry = { type: 'Point', coordinates: [+(lng.toFixed(5)), +(lat.toFixed(5))] };
  if (gType.includes('Line')) {
    geometry = { type: 'LineString', coordinates: [[+(lng - 0.01).toFixed(5), +lat.toFixed(5)], [+(lng + 0.01).toFixed(5), +lat.toFixed(5)]] };
  } else if (gType.includes('Polygon')) {
    const d = 0.008;
    geometry = {
      type: 'Polygon',
      coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]],
    };
  }
  const feature = { type: 'Feature', id: Date.now() + Math.floor(Math.random() * 1000), properties: props, geometry };
  fc.features.push(feature);
  return feature;
}

export function deleteFeatureRow(fc, index) {
  ensureMetadata(fc);
  if (index >= 0 && index < fc.features.length) fc.features.splice(index, 1);
  return fc.features;
}

/* ---------------- Geometry Measurements & Field Calculator ---------------- */

export function geomCentroid(geom) {
  if (!geom || !geom.coordinates) return [0, 0];
  if (geom.type === 'Point') return geom.coordinates;
  const pts = [];
  const walk = (c) => {
    if (typeof c?.[0] === 'number') { pts.push(c); return; }
    if (Array.isArray(c)) c.forEach(walk);
  };
  walk(geom.coordinates);
  if (!pts.length) return [0, 0];
  const sum = pts.reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
  return [sum[0] / pts.length, sum[1] / pts.length];
}

function sphericalRingAreaSqm(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const R = 6378137;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    area += ((lon2 - lon1) * Math.PI / 180) * (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  return Math.abs((area * R * R) / 2);
}

function geomAreaSqm(feat) {
  if (globalThis.turf?.area) {
    try { return globalThis.turf.area(feat); } catch {}
  }
  const g = feat?.geometry;
  if (!g) return 0;
  if (g.type === 'Polygon') return sphericalRingAreaSqm(g.coordinates[0]);
  if (g.type === 'MultiPolygon') return g.coordinates.reduce((s, poly) => s + sphericalRingAreaSqm(poly[0]), 0);
  return 0;
}

function haversineKm(a, b) {
  const R = 6371.0088;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function geomLengthKm(feat) {
  if (globalThis.turf?.length) {
    try { return globalThis.turf.length(feat, { units: 'kilometers' }); } catch {}
  }
  const g = feat?.geometry;
  if (!g) return 0;
  const lineKm = (coords) => {
    let d = 0;
    for (let i = 1; i < coords.length; i++) d += haversineKm(coords[i - 1], coords[i]);
    return d;
  };
  if (g.type === 'LineString') return lineKm(g.coordinates);
  if (g.type === 'MultiLineString') return g.coordinates.reduce((s, c) => s + lineKm(c), 0);
  if (g.type === 'Polygon') return lineKm(g.coordinates[0] || []);
  return 0;
}

function evalSimpleArithmetic(expr) {
  const clean = String(expr || '').trim();
  if (!clean) return null;
  if (!/^[\d\s.+*/%()-]+$/.test(clean)) return clean;
  try {
    const val = Function(`"use strict"; return (${clean});`)();
    return typeof val === 'number' && Number.isFinite(val) ? Math.round(val * 10000) / 10000 : null;
  } catch {
    return null;
  }
}

export function calculateField(fc, targetField, spec = {}) {
  ensureMetadata(fc);
  const cfg = typeof spec === 'string' ? { mode: 'formula', expression: spec } : spec;
  const schema = getLayerSchema(fc);
  let fieldMeta = schema.find((f) => f.name === targetField);
  if (!fieldMeta) {
    const inferredType = ['math', 'geometry', 'rank'].includes(cfg.mode) ? 'number' : 'string';
    addSchemaField(fc, { name: targetField, type: inferredType });
    fieldMeta = fc.metadata.fields.find((f) => f.name === targetField);
  }
  const { mode = 'formula', expression = '', fieldA = '', op = '+', fieldB = '', metric = 'area_sqkm' } = cfg;

  if (mode === 'rank') {
    const indexed = fc.features.map((f, idx) => ({ f, idx, v: fieldA ? Number(f.properties?.[fieldA]) : idx }));
    if (fieldA) indexed.sort((a, b) => (Number.isFinite(b.v) ? b.v : -Infinity) - (Number.isFinite(a.v) ? a.v : -Infinity));
    indexed.forEach((item, rankIdx) => {
      item.f.properties ||= {};
      item.f.properties[targetField] = rankIdx + 1;
    });
    fieldMeta.type = 'number';
    return fc;
  }

  fc.features.forEach((feat, idx) => {
    feat.properties ||= {};
    const p = feat.properties;
    if (mode === 'constant') {
      p[targetField] = coerceValue(expression, fieldMeta.type);
      return;
    }
    if (mode === 'geometry') {
      const [lon, lat] = geomCentroid(feat.geometry);
      const sqm = geomAreaSqm(feat);
      const km = geomLengthKm(feat);
      let val = 0;
      if (metric === 'area_sqkm') val = +(sqm / 1e6).toFixed(3);
      else if (metric === 'area_acres') val = +(sqm * 0.000247105).toFixed(2);
      else if (metric === 'area_sqft') val = Math.round(sqm * 10.7639);
      else if (metric === 'length_km') val = +km.toFixed(3);
      else if (metric === 'length_miles') val = +(km * 0.621371).toFixed(3);
      else if (metric === 'latitude') val = +lat.toFixed(6);
      else if (metric === 'longitude') val = +lon.toFixed(6);
      p[targetField] = val;
      fieldMeta.type = 'number';
      return;
    }
    if (mode === 'math') {
      const a = Number(p[fieldA]);
      const b = fieldB in p ? Number(p[fieldB]) : Number(fieldB);
      if (!Number.isFinite(a) || !Number.isFinite(b)) { p[targetField] = null; return; }
      let res = null;
      if (op === '+') res = a + b;
      else if (op === '-') res = a - b;
      else if (op === '*') res = a * b;
      else if (op === '/') res = b !== 0 ? a / b : null;
      else if (op === 'pct') res = b !== 0 ? (a / b) * 100 : null;
      else if (op === 'change') res = b !== 0 ? ((a - b) / Math.abs(b)) * 100 : null;
      p[targetField] = res !== null && Number.isFinite(res) ? Math.round(res * 1000) / 1000 : null;
      fieldMeta.type = 'number';
      return;
    }
    const [lon, lat] = geomCentroid(feat.geometry);
    const replaced = String(expression || '')
      .replace(/\$ROW\b/gi, String(idx + 1))
      .replace(/\$LAT\b/gi, String(+lat.toFixed(5)))
      .replace(/\$LON\b/gi, String(+lon.toFixed(5)))
      .replace(/\$AREA_KM2\b/gi, String(+(geomAreaSqm(feat) / 1e6).toFixed(3)))
      .replace(/\$AREA_ACRES\b/gi, String(+(geomAreaSqm(feat) * 0.000247105).toFixed(2)))
      .replace(/\$LEN_KM\b/gi, String(+geomLengthKm(feat).toFixed(3)))
      .replace(/\{([^}]+)\}/g, (_, k) => {
        const v = p[k.trim()];
        return v == null ? '' : String(v);
      });
    const numRes = evalSimpleArithmetic(replaced);
    if (typeof numRes === 'number') {
      p[targetField] = numRes;
      fieldMeta.type = 'number';
    } else {
      p[targetField] = coerceValue(replaced, fieldMeta.type);
    }
  });
  return fc;
}

export function columnStats(fcOrFeatures, fieldName) {
  const list = Array.isArray(fcOrFeatures) ? fcOrFeatures : (fcOrFeatures?.features || []);
  const vals = list.map((f) => Number(f?.properties?.[fieldName])).filter((v) => Number.isFinite(v));
  if (!vals.length) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  return {
    kind: 'number',
    count: vals.length,
    sum: Math.round(sum * 100) / 100,
    avg: Math.round((sum / vals.length) * 100) / 100,
    min: Math.min(...vals),
    max: Math.max(...vals),
  };
}

export function featuresToCSV(fc, fields) {
  const cols = (fields || getLayerSchema(fc)).map((f) => (typeof f === 'string' ? f : f.name));
  const allCols = [...cols, 'longitude', 'latitude'];
  const escCsv = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [allCols.map(escCsv).join(',')];
  for (const feat of fc?.features || []) {
    const [lon, lat] = geomCentroid(feat.geometry);
    const row = cols.map((c) => escCsv(feat.properties?.[c]));
    row.push(escCsv(Number.isFinite(lon) ? +lon.toFixed(6) : ''), escCsv(Number.isFinite(lat) ? +lat.toFixed(6) : ''));
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

/* ---------------- Server Persistence Helpers ---------------- */

export async function saveHostedLayer(layer, fc, extra = {}) {
  const id = hostedLayerIdOf(layer);
  if (!id) return null;
  ensureMetadata(fc);
  const payload = {
    title: extra.title ?? layer.name ?? fc.metadata?.title ?? 'Hosted layer',
    attribution: extra.attribution ?? layer.attribution ?? fc.metadata?.attribution ?? '',
    summary: extra.summary ?? fc.metadata?.summary ?? '',
    fields: fc.metadata.fields,
    style: layer.style || {},
    popup: layer.popup || {},
    ...(extra.shared !== undefined ? { shared: extra.shared } : {}),
    data: fc,
  };
  const res = await api('PUT', `/api/layers/${id}`, payload);
  invalidateLayerCache(layer.url);
  invalidateLayerCache(`/api/layers/${id}/geojson`);
  invalidateLayerCache(`/api/public/layers/${id}.geojson`);
  if (layer.data) layer.data = res.data;
  layer.attribution = res.attribution;
  return res;
}

export async function publishLayerAsHosted(layer, { shared = false, summary = '' } = {}) {
  const fc = JSON.parse(JSON.stringify(await loadLayerData(layer)));
  ensureMetadata(fc);
  fc.metadata.fields = getLayerSchema(fc);
  const created = await api('POST', '/api/layers', {
    title: layer.name || 'Hosted Layer',
    summary,
    attribution: layer.attribution || fc.metadata.attribution || '',
    fields: fc.metadata.fields,
    style: layer.style || { color: PALETTE[0] },
    popup: layer.popup || {},
    shared,
    data: fc,
  });
  layer.hostedLayerId = created.id;
  layer.url = created.url;
  layer.attribution = created.attribution;
  delete layer.data;
  invalidateLayerCache(layer.url);
  return created;
}

function promptTextDialog({ title, label, value = '', placeholder = '', okLabel = 'Save' }) {
  return new Promise((resolve) => {
    let result = null;
    const inp = h('input', { class: 'input', type: 'text', value, placeholder, onkeydown: (e) => { if (e.key === 'Enter') { result = inp.value.trim(); dlg.close(); } } });
    const dlg = dialog({
      title,
      cls: 'dlg-sm',
      body: h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), inp),
      onClose: () => resolve(result),
      actions: [
        h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { result = inp.value.trim(); dlg.close(); } }, okLabel),
      ],
    });
    setTimeout(() => { inp.focus(); inp.select(); }, 20);
  });
}

/* ---------------- Interactive Attribute Table UI ---------------- */

export async function renderAttributeTable(container, layer, { map, onChange, onClose, onZoom } = {}) {
  container.hidden = false;
  container.replaceChildren(h('p', { class: 'muted', style: 'padding:14px' }, 'Loading attribute table…'));

  let fc;
  let hostedMeta = null;
  const hostedId = hostedLayerIdOf(layer);
  try {
    if (hostedId) {
      const res = await api('GET', `/api/layers/${hostedId}`);
      hostedMeta = res;
      fc = res.data;
      if (!layer.attribution && res.attribution) layer.attribution = res.attribution;
    } else if (layer.data) {
      fc = layer.data;
    } else {
      fc = JSON.parse(JSON.stringify(await loadLayerData(layer)));
    }
  } catch (err) {
    container.replaceChildren(h('p', { class: 'form-error', style: 'padding:14px' }, `Could not load layer data: ${err.message}`));
    return;
  }

  ensureMetadata(fc);
  if (hostedMeta?.fields?.length && !fc.metadata.fields?.length) fc.metadata.fields = hostedMeta.fields;
  fc.metadata.fields = getLayerSchema(fc);

  let editable = Boolean(layer.data || hostedId);
  let searchQuery = '';
  let sortCol = null;
  let sortAsc = true;
  let activeSubbar = null; // 'add-field' | 'calc' | 'meta' | null
  let saveTimer = null;

  const statusBadge = h('span', { class: `pill ${hostedId ? 'is-live' : ''}` }, hostedId ? 'Hosted GeoJSON · Synced' : editable ? 'Editable layer' : 'Read-only feed');

  const syncChanges = (rebuild = false) => {
    if (layer.data) layer.data = fc;
    invalidateLayerCache(layer.url);
    if (map) {
      if (rebuild) rebuildLayer(map, layer);
      else reloadLayer(map, layer);
    }
    onChange?.(layer, fc);
    if (hostedId) {
      statusBadge.textContent = 'Saving…';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          await saveHostedLayer(layer, fc);
          statusBadge.textContent = 'Hosted GeoJSON · Saved';
        } catch (err) {
          statusBadge.textContent = `Save failed: ${err.message}`;
        }
      }, 380);
    }
  };

  const downloadBlob = (text, filename, mime) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    a.click();
  };

  const zoomToFeature = (feat) => {
    if (onZoom) { onZoom(feat); return; }
    if (!map || !feat?.geometry) return;
    const [lon, lat] = geomCentroid(feat.geometry);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 12), duration: 700 });
    }
  };

  const subbarHost = h('div', { class: 'me-table-subbar-host' });
  const gridWrap = h('div', { class: 'me-table-scroll' });

  function renderSubbar() {
    subbarHost.replaceChildren();
    if (!activeSubbar) return;

    if (activeSubbar === 'add-field') {
      const nameIn = h('input', { class: 'input', type: 'text', placeholder: 'e.g. revenue_usd or status', style: 'width:180px' });
      const typeSel = h('select', { style: 'width:135px' },
        h('option', { value: 'string' }, 'Text (string)'),
        h('option', { value: 'number' }, 'Number'),
        h('option', { value: 'date' }, 'Date'),
        h('option', { value: 'boolean' }, 'Yes / No (boolean)'),
      );
      const defIn = h('input', { class: 'input', type: 'text', placeholder: 'Default value (optional)', style: 'width:160px' });
      const addBtn = h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => {
        try {
          const fieldName = nameIn.value.trim();
          addSchemaField(fc, { name: fieldName, type: typeSel.value, defaultValue: defIn.value });
          activeSubbar = null;
          renderSubbar();
          renderToolbar();
          renderGrid();
          syncChanges(true);
          toast(`Added field "${fieldName}"`, { tone: 'ok' });
        } catch (err) { toast(err.message, { tone: 'error' }); }
      } }, icon('plus', { size: 14 }), 'Add field');
      subbarHost.append(h('div', { class: 'me-table-subbar' },
        h('strong', {}, 'New Field:'),
        nameIn, typeSel, defIn, addBtn,
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { activeSubbar = null; renderSubbar(); renderToolbar(); } }, 'Cancel'),
      ));
      nameIn.focus();
      return;
    }

    if (activeSubbar === 'calc') {
      const cols = getLayerSchema(fc);
      const targetIn = h('input', { class: 'input', type: 'text', list: 'wm-calc-fields', placeholder: 'Target field', value: cols[0]?.name || 'score', style: 'width:145px' });
      const dl = h('datalist', { id: 'wm-calc-fields' }, cols.map((c) => h('option', { value: c.name })));
      const modeSel = h('select', { style: 'width:175px' },
        h('option', { value: 'formula' }, 'Formula / Expression'),
        h('option', { value: 'math' }, 'Math between fields'),
        h('option', { value: 'geometry' }, 'Spatial Measurement'),
        h('option', { value: 'rank' }, 'Rank / Sequence (1..N)'),
        h('option', { value: 'constant' }, 'Fill Constant Value'),
      );
      const paramBox = h('span', { class: 'row', style: 'gap:6px;flex:1' });

      const updateParams = () => {
        paramBox.replaceChildren();
        const m = modeSel.value;
        if (m === 'formula') {
          const exprIn = h('input', { class: 'input', type: 'text', placeholder: 'e.g. {projected_revenue} - {annual_rent} or $AREA_KM2 * 100', style: 'flex:1;min-width:220px' });
          paramBox.append(exprIn);
          paramBox._getSpec = () => ({ mode: 'formula', expression: exprIn.value });
        } else if (m === 'math') {
          const selA = h('select', {}, cols.map((c) => h('option', { value: c.name }, c.name)));
          const opSel = h('select', { style: 'width:110px' },
            h('option', { value: '+' }, '+ Add'),
            h('option', { value: '-' }, '− Subtract'),
            h('option', { value: '*' }, '× Multiply'),
            h('option', { value: '/' }, '÷ Divide'),
            h('option', { value: 'pct' }, '% of (A/B×100)'),
            h('option', { value: 'change' }, '% Change'),
          );
          const inB = h('input', { class: 'input', type: 'text', list: 'wm-calc-fields', placeholder: 'Field B or number', style: 'width:135px' });
          paramBox.append(selA, opSel, inB);
          paramBox._getSpec = () => ({ mode: 'math', fieldA: selA.value, op: opSel.value, fieldB: inB.value });
        } else if (m === 'geometry') {
          const metSel = h('select', {},
            h('option', { value: 'area_sqkm' }, 'Area (sq km)'),
            h('option', { value: 'area_acres' }, 'Area (acres)'),
            h('option', { value: 'area_sqft' }, 'Area (sq ft)'),
            h('option', { value: 'length_km' }, 'Length / Perimeter (km)'),
            h('option', { value: 'length_miles' }, 'Length / Perimeter (miles)'),
            h('option', { value: 'latitude' }, 'Centroid Latitude'),
            h('option', { value: 'longitude' }, 'Centroid Longitude'),
          );
          paramBox.append(metSel);
          paramBox._getSpec = () => ({ mode: 'geometry', metric: metSel.value });
        } else if (m === 'rank') {
          const selA = h('select', {}, h('option', { value: '' }, 'Row order (1..N)'), cols.map((c) => h('option', { value: c.name }, `By ${c.name} (high → low)`)));
          paramBox.append(selA);
          paramBox._getSpec = () => ({ mode: 'rank', fieldA: selA.value });
        } else {
          const valIn = h('input', { class: 'input', type: 'text', placeholder: 'Value for all rows', style: 'width:180px' });
          paramBox.append(valIn);
          paramBox._getSpec = () => ({ mode: 'constant', expression: valIn.value });
        }
      };
      modeSel.addEventListener('change', updateParams);
      updateParams();

      const runBtn = h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => {
        const target = targetIn.value.trim();
        if (!target) { toast('Specify a target field name', { tone: 'error' }); return; }
        calculateField(fc, target, paramBox._getSpec());
        renderGrid();
        syncChanges(true);
        toast(`Calculated "${target}" across ${fc.features.length} features`, { tone: 'ok' });
      } }, icon('sparkle', { size: 14 }), 'Calculate');

      subbarHost.append(h('div', { class: 'me-table-subbar' },
        h('strong', {}, 'fx Calculate:'),
        targetIn, dl, h('span', { class: 'muted' }, '='), modeSel, paramBox, runBtn,
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { activeSubbar = null; renderSubbar(); renderToolbar(); } }, 'Close'),
      ));
      return;
    }

    if (activeSubbar === 'meta') {
      const nameIn = h('input', { class: 'input', type: 'text', value: layer.name || fc.metadata?.title || '', placeholder: 'Layer title', style: 'width:180px' });
      const attrIn = h('input', { class: 'input', type: 'text', value: layer.attribution || fc.metadata?.attribution || '', placeholder: 'Attribution / Credits (e.g. US Census 2026, City GIS)', style: 'flex:1;min-width:220px' });
      const sharedChk = h('input', { type: 'checkbox', checked: Boolean(hostedMeta?.shared) });
      const saveMetaBtn = h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: async () => {
        layer.name = nameIn.value.trim() || layer.name;
        layer.attribution = attrIn.value.trim();
        fc.metadata.title = layer.name;
        fc.metadata.attribution = layer.attribution;
        if (hostedId) {
          hostedMeta = await saveHostedLayer(layer, fc, { title: layer.name, attribution: layer.attribution, shared: sharedChk.checked });
        }
        syncChanges(true);
        toast('Layer attribution & metadata updated', { tone: 'ok' });
      } }, 'Save');

      const serviceUrl = hostedId ? `${location.origin}/api/layers/${hostedId}/geojson` : null;
      subbarHost.append(h('div', { class: 'me-table-subbar' },
        h('strong', {}, 'Attribution & Service:'),
        nameIn,
        attrIn,
        hostedId ? h('label', { class: 'check', style: 'margin:0;font-size:12px' }, sharedChk, 'Public GeoJSON service') : null,
        serviceUrl ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { copyText(serviceUrl); toast('Copied GeoJSON service URL', { tone: 'ok' }); } }, icon('link', { size: 14 }), 'Copy URL') : null,
        saveMetaBtn,
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { activeSubbar = null; renderSubbar(); renderToolbar(); } }, 'Close'),
      ));
    }
  }

  function renderGrid() {
    const schema = getLayerSchema(fc);
    const q = searchQuery.trim().toLowerCase();
    let rows = fc.features.map((feat, idx) => ({ feat, idx }));
    if (q) {
      rows = rows.filter(({ feat }) => schema.some((col) => String(feat.properties?.[col.name] ?? '').toLowerCase().includes(q)));
    }
    if (sortCol) {
      rows.sort((a, b) => {
        const va = a.feat.properties?.[sortCol];
        const vb = b.feat.properties?.[sortCol];
        const na = Number(va);
        const nb = Number(vb);
        const cmp = Number.isFinite(na) && Number.isFinite(nb) && va !== '' && vb !== ''
          ? na - nb
          : String(va ?? '').localeCompare(String(vb ?? ''));
        return sortAsc ? cmp : -cmp;
      });
    }

    countBadge.textContent = `${rows.length === fc.features.length ? fc.features.length.toLocaleString() : `${rows.length.toLocaleString()}/${fc.features.length.toLocaleString()}`} features · ${schema.length} fields`;

    if (!schema.length && !fc.features.length) {
      gridWrap.replaceChildren(h('p', { class: 'muted', style: 'padding:18px' },
        'This layer has no fields or features yet. Click "+ Field" to define its schema or "+ Row" to add a feature.'));
      return;
    }

    const typeIcon = { string: 'Aa', number: '#', boolean: '✓', date: '📅' };

    const thead = h('thead', {}, h('tr', {},
      h('th', { class: 'attr-th-num' }, '#'),
      schema.map((col) => h('th', {},
        h('div', { class: 'attr-th-inner' },
          h('button', {
            type: 'button',
            class: 'attr-sort-btn',
            title: `Sort by ${col.name} (${col.type})`,
            onclick: () => {
              if (sortCol === col.name) sortAsc = !sortAsc;
              else { sortCol = col.name; sortAsc = true; }
              renderGrid();
            },
          },
            h('span', { class: 'attr-col-type' }, typeIcon[col.type] || 'Aa'),
            h('span', { class: 'attr-col-name' }, col.alias || col.name),
            sortCol === col.name ? h('span', { class: 'attr-sort-ind' }, sortAsc ? '▲' : '▼') : null,
          ),
          editable ? h('span', { class: 'attr-col-actions' },
            h('button', {
              type: 'button',
              title: 'Rename field',
              onclick: async (e) => {
                e.stopPropagation();
                const next = await promptTextDialog({ title: 'Rename field', label: 'New field name', value: col.name, okLabel: 'Rename' });
                if (!next || next === col.name) return;
                try {
                  renameSchemaField(fc, col.name, next);
                  if (sortCol === col.name) sortCol = next;
                  renderGrid();
                  syncChanges(true);
                } catch (err) { toast(err.message, { tone: 'error' }); }
              },
            }, '✎'),
            h('button', {
              type: 'button',
              title: `Delete field "${col.name}"`,
              onclick: (e) => {
                e.stopPropagation();
                deleteSchemaField(fc, col.name);
                if (sortCol === col.name) sortCol = null;
                renderGrid();
                syncChanges(true);
                toast(`Deleted field "${col.name}"`, { tone: 'ok' });
              },
            }, '×'),
          ) : null,
        ),
      )),
      h('th', { class: 'attr-th-act' }, ''),
    ));

    const tbody = h('tbody');
    const tfoot = h('tfoot');
    const displayRows = rows.slice(0, 500);
    for (const { feat, idx } of displayRows) {
      feat.properties ||= {};
      const tr = h('tr', {},
        h('td', { class: 'attr-td-num', onclick: () => zoomToFeature(feat), title: 'Click to zoom to feature' }, String(idx + 1)),
        schema.map((col) => {
          const val = feat.properties[col.name];
          if (!editable) {
            return h('td', { onclick: () => zoomToFeature(feat) }, val == null ? '' : String(val));
          }
          if (col.type === 'boolean') {
            const chk = h('input', {
              type: 'checkbox',
              checked: Boolean(val),
              onchange: (e) => {
                feat.properties[col.name] = e.target.checked;
                syncChanges(false);
              },
            });
            return h('td', { class: 'attr-td-cell' }, chk);
          }
          const inp = h('input', {
            class: `attr-cell-input ${col.type === 'number' ? 'is-num' : ''}`,
            type: col.type === 'date' ? 'date' : 'text',
            value: val == null ? '' : String(val),
            onchange: (e) => {
              feat.properties[col.name] = coerceValue(e.target.value, col.type);
              if (col.type === 'number' && feat.properties[col.name] !== null) e.target.value = String(feat.properties[col.name]);
              renderFooter(tfoot, schema);
              syncChanges(false);
            },
          });
          return h('td', { class: 'attr-td-cell' }, inp);
        }),
        h('td', { class: 'attr-td-act' },
          h('button', { type: 'button', class: 'icon-btn', title: 'Zoom to feature', onclick: () => zoomToFeature(feat) }, icon('target', { size: 14 })),
          editable ? h('button', {
            type: 'button',
            class: 'icon-btn',
            title: 'Delete feature row',
            onclick: () => {
              deleteFeatureRow(fc, idx);
              renderGrid();
              syncChanges(false);
            },
          }, icon('trash', { size: 14 })) : null,
        ),
      );
      tbody.append(tr);
    }

    renderFooter(tfoot, schema);
    gridWrap.replaceChildren(h('table', { class: 'attr-table' }, thead, tbody, tfoot));
  }

  function renderFooter(tfoot, schema) {
    tfoot.replaceChildren();
    const hasNumeric = schema.some((c) => c.type === 'number' || columnStats(fc, c.name));
    if (!hasNumeric || !fc.features.length) return;
    tfoot.append(h('tr', { class: 'attr-stats-row' },
      h('td', { class: 'attr-td-num' }, 'Σ'),
      schema.map((col) => {
        const st = col.type === 'number' ? columnStats(fc, col.name) : null;
        if (!st) return h('td', { class: 'attr-stat-cell muted' }, '—');
        return h('td', { class: 'attr-stat-cell', title: `Min: ${st.min.toLocaleString()} · Max: ${st.max.toLocaleString()} · Count: ${st.count}` },
          `Σ ${st.sum.toLocaleString()} · μ ${st.avg.toLocaleString()}`);
      }),
      h('td', {}),
    ));
  }

  const countBadge = h('span', { class: 'muted' });
  const searchIn = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Search table…',
    style: 'max-width:200px',
    oninput: (e) => { searchQuery = e.target.value; renderGrid(); },
  });

  const publishBtn = !hostedId ? h('button', {
    type: 'button',
    class: 'btn btn-sm btn-primary',
    title: 'Save this layer as a Hosted Feature Layer on the server with editable attributes and attribution',
    onclick: async () => {
      try {
        publishBtn.disabled = true;
        publishBtn.textContent = 'Publishing…';
        layer.data = fc;
        await publishLayerAsHosted(layer);
        toast(`Published "${layer.name}" as a Hosted Feature Layer`, { tone: 'ok' });
        renderAttributeTable(container, layer, { map, onChange, onClose, onZoom });
      } catch (err) {
        publishBtn.disabled = false;
        publishBtn.textContent = 'Publish Hosted Layer';
        toast(err.message, { tone: 'error' });
      }
    },
  }, icon('database', { size: 14 }), 'Publish Hosted Layer') : null;

  const unlockBtn = !editable ? h('button', {
    type: 'button',
    class: 'btn btn-sm',
    title: 'Copy this feed into an editable layer so you can modify its attribute table',
    onclick: () => {
      layer.data = fc;
      editable = true;
      statusBadge.textContent = 'Editable layer';
      unlockBtn.remove();
      renderToolbar();
      renderGrid();
      syncChanges(true);
      toast('Layer is now editable! You can modify cells, add fields, or publish as a Hosted Layer.', { tone: 'ok' });
    },
  }, icon('pen', { size: 14 }), 'Make Editable') : null;

  const headBar = h('div', { class: 'me-table-head' });

  function renderToolbar() {
    headBar.replaceChildren(
      h('strong', {}, layer.name || 'Layer'),
      statusBadge,
      countBadge,
      h('span', { class: 'spacer' }),
      searchIn,
      unlockBtn,
      editable ? h('button', {
        type: 'button',
        class: 'btn btn-sm',
        onclick: () => {
          const c = map?.getCenter ? [map.getCenter().lng, map.getCenter().lat] : [-98.5, 39.8];
          addFeatureRow(fc, { center: c });
          renderGrid();
          syncChanges(false);
        },
      }, icon('plus', { size: 14 }), 'Row') : null,
      editable ? h('button', {
        type: 'button',
        class: `btn btn-sm ${activeSubbar === 'add-field' ? 'btn-primary' : ''}`,
        onclick: () => { activeSubbar = activeSubbar === 'add-field' ? null : 'add-field'; renderSubbar(); renderToolbar(); },
      }, icon('plus', { size: 14 }), 'Field') : null,
      editable ? h('button', {
        type: 'button',
        class: `btn btn-sm ${activeSubbar === 'calc' ? 'btn-primary' : ''}`,
        onclick: () => { activeSubbar = activeSubbar === 'calc' ? null : 'calc'; renderSubbar(); renderToolbar(); },
      }, icon('sparkle', { size: 14 }), 'Calculate') : null,
      h('button', {
        type: 'button',
        class: `btn btn-sm ${activeSubbar === 'meta' ? 'btn-primary' : ''}`,
        onclick: () => { activeSubbar = activeSubbar === 'meta' ? null : 'meta'; renderSubbar(); renderToolbar(); },
      }, 'Attribution'),
      publishBtn,
      h('button', {
        type: 'button',
        class: 'btn btn-sm btn-ghost',
        title: 'Download CSV',
        onclick: () => downloadBlob(featuresToCSV(fc), `${(layer.name || 'layer').toLowerCase().replace(/\W+/g, '-')}.csv`, 'text/csv'),
      }, icon('download', { size: 14 }), 'CSV'),
      h('button', {
        type: 'button',
        class: 'btn btn-sm btn-ghost',
        title: 'Download GeoJSON',
        onclick: () => downloadBlob(JSON.stringify(fc, null, 2), `${(layer.name || 'layer').toLowerCase().replace(/\W+/g, '-')}.geojson`, 'application/geo+json'),
      }, icon('download', { size: 14 }), 'GeoJSON'),
      onClose ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close table', onclick: onClose }, icon('x', { size: 16 })) : null,
    );
  }

  renderToolbar();
  renderSubbar();
  renderGrid();
  container.replaceChildren(headBar, subbarHost, gridWrap);
}

/* ---------------- Modal Dialogs for Attribute Table & Hosted Layer Creation ---------------- */

export function openAttributeTableDialog(layer, { map, onChange } = {}) {
  const body = h('div', { class: 'attr-dialog-body' });
  const dlg = dialog({
    title: `Attribute Table · ${layer.name || 'Layer'}`,
    cls: 'dlg-xl attr-dlg',
    body,
  });
  dlg.querySelector('.dlg-body').style.padding = '0';
  renderAttributeTable(body, layer, { map, onChange });
  return dlg;
}

export function openNewHostedLayerDialog({ onCreated } = {}) {
  let fields = JSON.parse(JSON.stringify(LAYER_TEMPLATES.blank.fields));
  let uploadedFc = null;

  const titleIn = h('input', { class: 'input', type: 'text', placeholder: 'e.g. Q4 Retail Expansion Sites or Municipal Hydrants', value: 'New Hosted Feature Layer' });
  const attrIn = h('input', { class: 'input', type: 'text', placeholder: 'e.g. Operations GIS Team · Surveyed Oct 2026' });
  const summaryIn = h('input', { class: 'input', type: 'text', placeholder: 'Optional description of this feature layer and its schema' });
  const geomSel = h('select', {},
    h('option', { value: 'Point' }, 'Points (sites, addresses, sensors)'),
    h('option', { value: 'Polygon' }, 'Polygons (territories, parcels, trade areas)'),
    h('option', { value: 'LineString' }, 'Lines (routes, corridors, pipelines)'),
  );
  const tplSel = h('select', {
    onchange: (e) => {
      const tpl = LAYER_TEMPLATES[e.target.value];
      if (!tpl) return;
      geomSel.value = tpl.geomType;
      fields = JSON.parse(JSON.stringify(tpl.fields));
      renderFieldsList();
    },
  }, Object.entries(LAYER_TEMPLATES).map(([k, v]) => h('option', { value: k }, v.label)));

  const fieldsBox = h('div', { style: 'display:flex;flex-direction:column;gap:6px;max-height:210px;overflow:auto;padding:4px 0' });

  function renderFieldsList() {
    fieldsBox.replaceChildren(...fields.map((f, i) => h('div', { class: 'row', style: 'gap:6px' },
      h('input', {
        class: 'input',
        type: 'text',
        value: f.name,
        placeholder: 'Field name',
        style: 'flex:1',
        oninput: (e) => { f.name = e.target.value; },
      }),
      h('select', {
        style: 'width:125px',
        onchange: (e) => { f.type = e.target.value; },
      },
        h('option', { value: 'string', selected: f.type === 'string' }, 'Text'),
        h('option', { value: 'number', selected: f.type === 'number' }, 'Number'),
        h('option', { value: 'date', selected: f.type === 'date' }, 'Date'),
        h('option', { value: 'boolean', selected: f.type === 'boolean' }, 'Boolean'),
      ),
      h('input', {
        class: 'input',
        type: 'text',
        value: f.default ?? '',
        placeholder: 'Default',
        style: 'width:120px',
        oninput: (e) => { f.default = e.target.value; },
      }),
      h('button', {
        type: 'button',
        class: 'icon-btn',
        'aria-label': 'Remove field',
        onclick: () => { fields.splice(i, 1); renderFieldsList(); },
      }, icon('x', { size: 15 })),
    )));
  }
  renderFieldsList();

  const fileStatus = h('span', { class: 'muted', style: 'font-size:12.5px' }, 'Or import existing GeoJSON / CSV:');
  const fileIn = h('input', {
    type: 'file',
    accept: '.geojson,.json,.csv,application/json,text/csv',
    onchange: async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        const data = /\.csv$/i.test(f.name) || f.type === 'text/csv' ? csvToGeoJSON(text) : JSON.parse(text);
        uploadedFc = data.type === 'Feature' ? { type: 'FeatureCollection', features: [data] } : data;
        if (titleIn.value === 'New Hosted Feature Layer') titleIn.value = f.name.replace(/\.\w+$/, '').replace(/[_-]+/g, ' ');
        fields = getLayerSchema(uploadedFc);
        renderFieldsList();
        fileStatus.textContent = `Loaded ${uploadedFc.features.length} features (${fields.length} fields) from ${f.name}`;
      } catch (err) { toast(err.message, { tone: 'error' }); }
    },
  });

  const seedChk = h('input', { type: 'checkbox', checked: true });

  const createBtn = h('button', {
    type: 'button',
    class: 'btn btn-primary',
    onclick: async () => {
      const cleanFields = fields.map((f) => ({ ...f, name: String(f.name || '').trim() })).filter((f) => f.name);
      if (!cleanFields.length) { toast('Add at least one attribute field', { tone: 'error' }); return; }
      createBtn.disabled = true;
      createBtn.textContent = 'Creating…';
      try {
        const fc = uploadedFc || { type: 'FeatureCollection', metadata: { fields: cleanFields, geomType: geomSel.value }, features: [] };
        if (!uploadedFc && seedChk.checked) {
          addFeatureRow(fc, { center: [-98.5795, 39.8283], geomType: geomSel.value });
        }
        const created = await api('POST', '/api/layers', {
          title: titleIn.value.trim() || 'Untitled Layer',
          attribution: attrIn.value.trim(),
          summary: summaryIn.value.trim(),
          geomType: geomSel.value,
          fields: cleanFields,
          style: { color: PALETTE[0], opacity: 0.75, radius: 7, width: 2.5 },
          data: fc,
        });
        toast(`Created hosted layer "${created.title}"`, { tone: 'ok' });
        dlg.close();
        onCreated?.(created);
      } catch (err) {
        createBtn.disabled = false;
        createBtn.textContent = 'Create Hosted Layer';
        toast(err.message, { tone: 'error' });
      }
    },
  }, icon('database', { size: 15 }), 'Create Hosted Layer');

  const dlg = dialog({
    title: 'New Hosted Feature Layer',
    body: h('div', {},
      h('p', { class: 'field-hint', style: 'margin:0 0 12px' },
        'Hosted layers store GeoJSON on your server with a structured attribute schema and source attribution — like ArcGIS Online Hosted Feature Layers. Edit their attribute tables or geometry anytime.'),
      h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Layer Title'), titleIn),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Schema Preset'), tplSel)),
      h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Attribution / Credits (shown in map legend)'), attrIn),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Geometry Type'), geomSel)),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Summary / Description'), summaryIn),
      h('div', { class: 'field' },
        h('div', { class: 'row', style: 'margin-bottom:6px' },
          h('span', { class: 'field-label', style: 'margin:0' }, 'Attribute Table Schema (Fields)'),
          h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { fields.push({ name: `field_${fields.length + 1}`, type: 'string' }); renderFieldsList(); } }, icon('plus', { size: 14 }), 'Add field')),
        fieldsBox),
      h('div', { class: 'row', style: 'padding-top:10px;border-top:1px solid var(--border);margin-top:8px' },
        h('div', { style: 'display:flex;flex-direction:column;gap:4px;flex:1' }, fileStatus, fileIn),
        h('label', { class: 'check', style: 'font-size:12.5px' }, seedChk, 'Seed 1 starter row if blank'))),
    actions: [
      h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
      createBtn,
    ],
  });
  return dlg;
}
