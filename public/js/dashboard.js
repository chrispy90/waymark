// Dashboards: a saved map beside numbers, bar charts, donuts and tables made from its layers. Clicking a bar or a
// slice filters the map and every other chart; "only what's in view" makes the charts follow the map.
// /dashboard.html?id=<id> is the editor (for the owner and editors); /d/<id> is the public page (?embed=1 for websites).
import { api } from './api.js';
import { createMap, layerFeatures, fieldNames, highlightMapFeatures, bbox } from './maps.js';
import { $, h, icon, logo, toast, menu, dialog, confirmDialog, setTitle, BRAND } from './ui.js';
import { openShare } from './share.js';

const params = new URLSearchParams(location.search);
const publicId = /^\/d\/([\w-]+)/.exec(location.pathname)?.[1];
const id = publicId || params.get('id');
const embed = params.has('embed');
document.documentElement.classList.toggle('is-embed', embed);
const root = $('#page');
const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
const STATS = [['count', 'Count'], ['sum', 'Sum'], ['avg', 'Average'], ['min', 'Smallest'], ['max', 'Largest']];
const TYPES = [['number', 'Big number', 'chart'], ['bars', 'Bar chart', 'chart'], ['donut', 'Donut', 'circle'], ['table', 'Table', 'list']];
const uid = () => `w${Math.random().toString(36).slice(2, 8)}`;
const fmt = (n) => (!Number.isFinite(n) ? '–' : Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : String(Math.round(n * 100) / 100));

let doc; // { title, map, widgets, extentFilter }
let meta = {};
let mapDoc;
let map;
let editing = false;
const data = {}; // layer id → FeatureCollection
let sel = null; // { layer, field, value }
let bounds = null;

/* ---------- loading ---------- */

async function load() {
  if (publicId) {
    const res = await fetch(`/api/public/dashboards/${encodeURIComponent(id)}`);
    if (res.ok) { doc = await res.json(); return 'public'; }
  }
  const { user } = await api('GET', '/api/me');
  if (!user) { if (publicId) return null; location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`; return new Promise(() => {}); }
  try {
    const r = await api('GET', `/api/dashboards/${encodeURIComponent(id)}`);
    doc = r.dashboard;
    const { dashboard: _d, ...rest } = r;
    meta = rest;
    return rest.role === 'viewer' || publicId ? 'viewer' : 'editor';
  } catch { return null; }
}
async function loadMap(mode) {
  if (!doc.map) return null;
  if (mode === 'public') { const res = await fetch(`/api/public/maps/${encodeURIComponent(doc.map)}`); return res.ok ? res.json() : null; }
  try { return (await api('GET', `/api/maps/${encodeURIComponent(doc.map)}`)).map; } catch { return null; }
}

/* ---------- saving ---------- */

let saveTimer;
let dirty = false;
const setSave = (text) => { const el = $('#save-state'); if (el) el.textContent = text; };
function changed() {
  if (!editing) return;
  dirty = true;
  setSave('Editing…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}
async function save() {
  if (!dirty) return;
  dirty = false;
  setSave('Saving…');
  try {
    const r = await api('PUT', `/api/dashboards/${meta.id}`, { dashboard: doc, version: meta.version });
    meta = { ...meta, ...r };
    setSave(dirty ? 'Editing…' : 'Saved');
  } catch (e) {
    dirty = true;
    setSave('Not saved');
    if (e.status === 409) { if (await confirmDialog({ title: 'This dashboard changed somewhere else', confirmLabel: 'Load latest version', message: 'It was edited in another tab or by someone else. Load the latest version (your last few edits here are discarded)?' })) location.reload(); } else saveTimer = setTimeout(save, 4000);
  }
}
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

/* ---------- numbers ---------- */

const layerName = (lid) => (mapDoc?.layers || []).find((l) => l.id === lid)?.name || 'Layer';
const valueOf = (f, field) => f.properties?.[field];
const label = (v) => (v == null || v === '' ? '—' : String(v));

function inView(f) {
  if (!bounds || !f.geometry) return true;
  const b = f.geometry.type === 'Point' ? [...f.geometry.coordinates, ...f.geometry.coordinates] : bbox({ features: [f] });
  return b && b[2] >= bounds[0] && b[0] <= bounds[2] && b[3] >= bounds[1] && b[1] <= bounds[3];
}
// The features a chart works on: its layer, narrowed by the map's extent and by a selection made on another chart.
function featuresFor(w, { ignoreSel = false } = {}) {
  let list = data[w.layer]?.features || [];
  if (doc.extentFilter && bounds) list = list.filter(inView);
  if (sel && !ignoreSel && sel.layer === w.layer) list = list.filter((f) => label(valueOf(f, sel.field)) === sel.value);
  return list;
}
function stat(list, kind, field) {
  if (kind === 'count' || !field) return list.length;
  const nums = list.map((f) => Number(valueOf(f, field))).filter(Number.isFinite);
  if (!nums.length) return NaN;
  if (kind === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (kind === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
  return kind === 'min' ? Math.min(...nums) : Math.max(...nums);
}
function groups(w) {
  const own = sel && sel.layer === w.layer && sel.field === w.group; // the chart that made the selection keeps all its bars
  const by = new Map();
  for (const f of featuresFor(w, { ignoreSel: own })) { const k = label(valueOf(f, w.group)); (by.get(k) || by.set(k, []).get(k)).push(f); }
  return [...by.entries()].map(([k, list]) => ({ key: k, value: stat(list, w.stat || 'count', w.field) })).filter((g) => Number.isFinite(g.value)).sort((a, b) => b.value - a.value);
}
const statLabel = (w) => (w.stat && w.stat !== 'count' && w.field ? `${STATS.find((s) => s[0] === w.stat)[1]} of ${w.field}` : 'Count');

/* ---------- selection ---------- */

function select(layer, field, value) {
  sel = sel && sel.layer === layer && sel.field === field && sel.value === value ? null : { layer, field, value };
  applyMapFilter();
  drawWidgets();
}
function applyMapFilter() {
  if (!map?.isStyleLoaded()) return;
  for (const l of map.getStyle().layers) {
    const m = /^dl-(.+)-[a-z]+$/.exec(l.id);
    if (!m || !map._baseFilters || !(l.id in map._baseFilters)) continue;
    const base = map._baseFilters[l.id] ?? ['all'];
    map.setFilter(l.id, sel && sel.layer === m[1] ? ['all', base, ['==', ['to-string', ['coalesce', ['get', sel.field], '—']], sel.value]] : base);
  }
}

/* ---------- widgets ---------- */

function widgetBody(w) {
  if (!data[w.layer]) return h('p', { class: 'muted' }, mapDoc ? 'This chart\'s layer is no longer on the map.' : 'The map could not be loaded.');
  if (w.type === 'number') {
    const v = stat(featuresFor(w), w.stat || 'count', w.field);
    return h('div', { class: 'db-number' }, h('strong', {}, `${w.prefix || ''}${fmt(v)}${w.suffix || ''}`), h('span', {}, `${statLabel(w)} · ${layerName(w.layer)}`));
  }
  if (w.type === 'table') {
    const cols = w.fields?.length ? w.fields : fieldNames(data[w.layer]).slice(0, 4);
    let rows = featuresFor(w);
    if (w.field) rows = [...rows].sort((a, b) => (Number(valueOf(b, w.field)) || 0) - (Number(valueOf(a, w.field)) || 0));
    const shown = rows.slice(0, w.limit || 25);
    return h('div', { class: 'db-table-wrap' }, h('table', { class: 'db-table' },
      h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c)))),
      h('tbody', {}, shown.map((f) => h('tr', { tabindex: 0, title: 'Show on the map', onclick: () => highlightMapFeatures(map, [f]) }, cols.map((c) => h('td', {}, label(valueOf(f, c))))))),
    ), rows.length > shown.length ? h('p', { class: 'muted db-more' }, `Top ${shown.length} of ${rows.length.toLocaleString()}`) : null);
  }
  if (!w.group) return h('p', { class: 'muted' }, 'Choose a field to group by.');
  const all = groups(w);
  if (!all.length) return h('p', { class: 'muted' }, 'Nothing to show.');
  const isSel = (g) => sel && sel.layer === w.layer && sel.field === w.group && sel.value === g.key;
  const dim = (g) => sel && sel.layer === w.layer && sel.field === w.group && !isSel(g);
  if (w.type === 'bars') {
    const top = all.slice(0, w.limit || 8);
    const max = Math.max(...top.map((g) => g.value), 0) || 1;
    return h('div', { class: 'db-bars' }, top.map((g, i) => h('button', { type: 'button', class: `db-bar ${isSel(g) ? 'is-on' : ''} ${dim(g) ? 'is-dim' : ''}`, 'aria-pressed': isSel(g) ? 'true' : 'false',
      title: `Filter to ${g.key}`, onclick: () => select(w.layer, w.group, g.key) },
    h('span', { class: 'db-bar-label' }, g.key), h('span', { class: 'db-bar-track' }, h('span', { class: 'db-bar-fill', style: `width:${Math.max(1.5, (g.value / max) * 100)}%;background:${w.color || COLORS[0]}` })),
    h('span', { class: 'db-bar-value' }, fmt(g.value)))), all.length > top.length ? h('p', { class: 'muted db-more' }, `Top ${top.length} of ${all.length}`) : null);
  }
  // donut
  const top = all.slice(0, 6);
  const rest = all.slice(6).reduce((a, g) => a + g.value, 0);
  const parts = rest > 0 ? [...top, { key: 'Other', value: rest, other: true }] : top;
  const total = parts.reduce((a, g) => a + g.value, 0) || 1;
  let at = 0;
  const arc = (g, i) => {
    const [a0, a1] = [at / total, (at += g.value) / total].map((t) => t * 2 * Math.PI - Math.PI / 2);
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a, r) => `${50 + r * Math.cos(a)} ${50 + r * Math.sin(a)}`;
    const d = parts.length === 1 ? 'M50 8a42 42 0 1 0 .01 0zM50 26a24 24 0 1 1 -.01 0z' : `M${p(a0, 42)}A42 42 0 ${big} 1 ${p(a1, 42)}L${p(a1, 24)}A24 24 0 ${big} 0 ${p(a0, 24)}Z`;
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('d', d);
    el.setAttribute('fill', g.other ? '#9ca3af' : COLORS[i % COLORS.length]);
    el.setAttribute('fill-rule', 'evenodd');
    if (dim(g)) el.setAttribute('opacity', '0.3');
    if (!g.other) { el.style.cursor = 'pointer'; el.addEventListener('click', () => select(w.layer, w.group, g.key)); }
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = `${g.key}: ${fmt(g.value)}`;
    el.append(t);
    return el;
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'db-donut');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${w.title || 'Donut chart'}: ${parts.map((g) => `${g.key} ${fmt(g.value)}`).join(', ')}`);
  svg.append(...parts.map(arc));
  return h('div', { class: 'db-donut-wrap' }, h('div', { class: 'db-donut-box' }, svg, h('div', { class: 'db-donut-total' }, h('strong', {}, fmt(total)), h('span', {}, statLabel(w)))),
    h('div', { class: 'db-legend' }, parts.map((g, i) => h('button', { type: 'button', class: `db-leg ${isSel(g) ? 'is-on' : ''}`, disabled: g.other, onclick: () => select(w.layer, w.group, g.key) },
      h('i', { style: `background:${g.other ? '#9ca3af' : COLORS[i % COLORS.length]}` }), h('span', {}, g.key), h('b', {}, `${Math.round((g.value / total) * 100)}%`)))));
}

function drawWidgets() {
  const box = $('#widgets');
  if (!box) return;
  const chip = sel ? h('div', { class: 'db-chip' }, icon('sliders', { size: 14 }), h('span', {}, `Showing ${sel.field}: `, h('strong', {}, sel.value)), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Clear the filter', onclick: () => select(sel.layer, sel.field, sel.value) }, icon('x', { size: 14 }))) : null;
  box.replaceChildren(...[chip, ...doc.widgets.map((w, i) => h('section', { class: `db-card is-${w.type}` },
    h('div', { class: 'db-card-head' }, h('h2', {}, w.title || TYPES.find((t) => t[0] === w.type)?.[1] || 'Chart'),
      editing ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Options for ${w.title || 'chart'}`, onclick: (e) => menu(e.currentTarget, [
        { label: 'Edit', icon: 'sliders', onClick: () => editWidget(w) },
        i > 0 ? { label: 'Move up', icon: 'up', onClick: () => { doc.widgets.splice(i - 1, 0, doc.widgets.splice(i, 1)[0]); changed(); drawWidgets(); } } : null,
        i < doc.widgets.length - 1 ? { label: 'Move down', icon: 'down', onClick: () => { doc.widgets.splice(i + 1, 0, doc.widgets.splice(i, 1)[0]); changed(); drawWidgets(); } } : null,
        'sep',
        { label: 'Delete', icon: 'trash', danger: true, onClick: () => { doc.widgets.splice(i, 1); if (sel) { sel = null; applyMapFilter(); } changed(); drawWidgets(); } },
      ].filter(Boolean)) }, icon('more')) : null),
    widgetBody(w))),
  !doc.widgets.length ? h('section', { class: 'db-empty' }, icon('chart', { size: 32 }), h('h2', {}, editing ? 'Add your first chart' : 'No charts yet'),
    editing ? h('p', {}, 'Big numbers, bar charts, donuts and tables, each made from a layer on the map. Click a bar or slice to filter everything else.') : null,
    editing ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => editWidget(null) }, icon('plus', { size: 15 }), 'Add a chart') : null) : null].filter(Boolean));
}

function editWidget(existing) {
  const layers = (mapDoc?.layers || []).filter((l) => data[l.id]);
  if (!layers.length) { toast('The map has no layers with features to chart. Add data to the map first.', { tone: 'error', duration: 6000 }); return; }
  const w = existing ? { ...existing } : { id: uid(), type: 'bars', title: '', layer: layers[0].id, stat: 'count' };
  const form = h('div');
  const draw = () => {
    const fields = data[w.layer] ? fieldNames(data[w.layer]) : [];
    const nums = fields.filter((f) => (data[w.layer].features || []).slice(0, 200).some((x) => typeof x.properties?.[f] === 'number' || (x.properties?.[f] !== '' && x.properties?.[f] != null && Number.isFinite(Number(x.properties[f])))));
    const pick = (key, text, opts, empty) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, text),
      h('select', { onchange: (e) => { w[key] = e.target.value || undefined; draw(); } }, empty ? h('option', { value: '' }, empty) : null, opts.map(([v, l]) => h('option', { value: v, selected: w[key] === v }, l))));
    if (w.type !== 'number' && w.type !== 'table' && !w.group) w.group = fields.find((f) => !nums.includes(f)) || fields[0];
    form.replaceChildren(
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Kind of chart'), h('div', { class: 'seg seg-block' }, TYPES.map(([v, l]) => h('button', { type: 'button', class: w.type === v ? 'is-on' : '', onclick: () => { w.type = v; draw(); } }, l)))),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Title'), h('input', { class: 'input', type: 'text', value: w.title || '', placeholder: 'e.g. Reports by neighborhood', oninput: (e) => { w.title = e.target.value; } })),
      pick('layer', 'Layer', layers.map((l) => [l.id, `${l.name || 'Layer'} · ${data[l.id].features.length.toLocaleString()}`])),
      w.type === 'bars' || w.type === 'donut' ? pick('group', 'One bar or slice for each', fields.map((f) => [f, f])) : null,
      w.type !== 'table' ? h('div', { class: 'grid-2' }, pick('stat', 'Show the', STATS), w.stat && w.stat !== 'count' ? pick('field', 'Of field', nums.map((f) => [f, f]), nums.length ? 'Choose…' : 'No number fields') : h('span')) : null,
      w.type === 'number' ? h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Before the number'), h('input', { class: 'input', type: 'text', value: w.prefix || '', placeholder: '$', maxlength: 8, oninput: (e) => { w.prefix = e.target.value; } })),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'After the number'), h('input', { class: 'input', type: 'text', value: w.suffix || '', placeholder: '%', maxlength: 12, oninput: (e) => { w.suffix = e.target.value; } }))) : null,
      w.type === 'table' ? [
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Columns'), h('input', { class: 'input', type: 'text', value: (w.fields || []).join(', '), placeholder: fields.slice(0, 4).join(', ') || 'Field names, separated by commas',
          oninput: (e) => { w.fields = e.target.value.split(',').map((x) => x.trim()).filter((x) => fields.includes(x)); } })),
        pick('field', 'Biggest first, by', nums.map((f) => [f, f]), 'Keep the layer\'s order')] : null,
      w.type !== 'number' ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, w.type === 'table' ? 'Rows to show' : 'How many to show'),
        h('input', { class: 'input', type: 'number', min: 1, max: 200, value: w.limit || (w.type === 'table' ? 25 : w.type === 'donut' ? 6 : 8), disabled: w.type === 'donut', oninput: (e) => { w.limit = Math.max(1, Math.min(200, +e.target.value || 8)); } })) : null);
  };
  draw();
  const dlg = dialog({ title: existing ? 'Edit chart' : 'Add a chart', body: form, actions: [
    h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
      if (w.stat && w.stat !== 'count' && !w.field) { toast('Choose the number field to use.', { tone: 'error' }); return; }
      if (existing) Object.assign(existing, w); else doc.widgets.push(w);
      Object.keys(existing || {}).forEach((k) => { if (!(k in w)) delete existing[k]; });
      dlg.close();
      changed();
      drawWidgets();
    } }, existing ? 'Save' : 'Add chart')] });
}

/* ---------- page ---------- */

const mode = await load();
if (!mode || !doc) {
  root.replaceChildren(h('main', { class: 'pv-missing' }, h('h1', {}, 'This dashboard isn\'t available'), h('p', {}, 'It may have been deleted, or it isn\'t shared with you.'), h('a', { class: 'btn btn-primary', href: '/?tab=dashboards' }, 'Go to Waymark')));
} else {
  editing = mode === 'editor';
  doc.widgets ||= [];
  setTitle(doc.title || 'Dashboard');
  mapDoc = await loadMap(mode);
  const mapEl = h('div', { class: 'db-map' });
  const title = editing ? h('input', { class: 'bld-title', 'aria-label': 'Dashboard title', value: doc.title || '', placeholder: 'Untitled dashboard', oninput: (e) => { doc.title = e.target.value; setTitle(doc.title || 'Dashboard'); changed(); } })
    : h('h1', { class: 'db-title' }, doc.title || 'Untitled dashboard');
  const extent = h('label', { class: 'check db-extent', title: 'Charts count only the features inside the map\'s current view' },
    h('input', { type: 'checkbox', checked: !!doc.extentFilter, onchange: (e) => { doc.extentFilter = e.target.checked; changed(); drawWidgets(); } }), 'Only what\'s in view');
  root.replaceChildren(
    embed ? null : h('header', { class: 'bld-top db-top' },
      mode === 'public' ? h('a', { href: '/', class: 'pv-logo', 'aria-label': BRAND.name }, logo({ size: 26, withName: false }))
        : [h('a', { href: '/?tab=dashboards', class: 'icon-btn', title: 'All dashboards', 'aria-label': 'All dashboards' }, icon('back')), logo({ size: 26, withName: false }), h('span', { class: 'bld-sep', 'aria-hidden': 'true' })],
      title,
      editing ? h('span', { id: 'save-state', class: 'save-state', 'aria-live': 'polite' }, 'Saved') : null,
      h('span', { class: 'spacer' }),
      editing ? extent : null,
      editing && mapDoc ? h('a', { class: 'btn', href: `/map.html?id=${doc.map}` }, icon('map', { size: 15 }), 'Edit the map') : null,
      editing && meta.role === 'owner' ? h('button', { type: 'button', class: 'btn', onclick: () => openShare({ type: 'dashboard', id: meta.id, title: doc.title }) }, icon('link', { size: 15 }), 'Share') : null,
      editing ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => editWidget(null) }, icon('plus', { size: 15 }), 'Add a chart') : null),
    h('main', { class: 'db-main' }, h('div', { class: 'db-map-wrap' }, mapEl), h('aside', { class: 'db-side', id: 'widgets', 'aria-live': 'polite' }, h('p', { class: 'uploading' }, h('span', { class: 'spinner' }), 'Loading the data…'))));

  if (mapDoc) {
    map = createMap(mapEl, { ...mapDoc.view, markers: [] }, { library: mapDoc.layers || [] });
    if (!embed) map.scrollZoom.enable();
    const readBounds = () => { const b = map.getBounds(); bounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; };
    let moveTimer;
    map.on('moveend', () => { readBounds(); if (doc.extentFilter) { clearTimeout(moveTimer); moveTimer = setTimeout(drawWidgets, 150); } });
    map.on('load', readBounds);
    map.on('styledata', () => { if (sel) applyMapFilter(); });
    await Promise.all((mapDoc.layers || []).filter((l) => l.type !== 'raster' && (l.data || l.url)).map(async (l) => { try { data[l.id] = await layerFeatures(l); } catch { /* a layer that can't be loaded just has no charts */ } }));
  } else {
    mapEl.replaceWith(h('div', { class: 'db-nomap' }, h('p', {}, 'The map this dashboard uses could not be loaded. It may have been deleted, or it isn\'t shared with you.')));
  }
  drawWidgets();
  if (editing && params.has('new') && !doc.widgets.length) editWidget(null);
}
