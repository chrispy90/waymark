// Saved-map editor: a full-screen map with layers, data, basemaps, bookmarks, analysis, drawing, measuring,
// an attribute table and per-layer settings. Maps made here can be used in any number of stories.
import { api, requireUser, uploadImage } from './api.js';
import { $, h, icon, logo, toast, menu, dialog, confirmDialog, setTitle } from './ui.js';
import { BASEMAPS, createMap, readView, setVisibleLayers, refreshLayers, rebuildLayer, orderLayers, fitToLayer, layerFeatures, fieldNames, bbox } from './maps.js';
import { initWorkbench, openAddData, openAnalysis, openDraw, openPublicData, rerunAnalysis } from './workbench.js';
import { layerEditor } from './layer-form.js';
import { TOOLS, fmtDist, fmtArea } from './analysis.js';
import { findPlaces } from './wizard.js';
import { storyFromMap } from './webmap.js';

await requireUser();
const params = new URLSearchParams(location.search);
const id = params.get('id');
let meta;
let doc;
try {
  const r = await api('GET', `/api/maps/${encodeURIComponent(id)}`);
  doc = r.map;
  const { map: _m, ...rest } = r;
  meta = rest;
} catch (e) {
  document.body.replaceChildren(h('main', { class: 'auth-main', style: 'min-height:100vh' }, h('div', { class: 'auth-card' },
    h('h1', {}, 'Map not found'), h('p', {}, e.message), h('a', { class: 'btn btn-primary', href: '/?tab=maps' }, icon('back'), 'Back to your maps'))));
  throw e;
}
doc.layers ||= [];
doc.bookmarks ||= [];
doc.view ||= { center: [-98.5, 39.5], zoom: 3.3, basemap: 'streets', layers: [], legend: true };
doc.view.layers ||= [];
// The shared tools look for a story's first map to start on; here that is always the map on screen.
Object.defineProperty(doc, 'blocks', { enumerable: false, get: () => [{ view: currentView() }] });

$('#logo-slot').append(logo({ size: 26, withName: false }));
document.querySelectorAll('[data-icon]').forEach((el) => el.prepend(icon(el.dataset.icon, { size: el.classList.contains('icon-btn') ? 18 : 16 })));
const titleInput = $('#title-input');
titleInput.value = doc.title || '';
titleInput.addEventListener('input', () => { doc.title = titleInput.value; setTitle(doc.title || 'Untitled map'); changed(); });
setTitle(doc.title || 'Untitled map');

/* ---------- Saving ---------- */

let saveTimer;
let saving = false;
let dirty = false;
const setSave = (state) => $('#save-state').replaceChildren(...(state === 'saving' ? [h('span', { class: 'spinner', style: 'width:12px;height:12px' }), 'Saving…']
  : state === 'dirty' ? ['Editing…'] : state === 'error' ? [icon('x', { size: 14 }), 'Not saved'] : [icon('check', { size: 14 }), 'Saved']));
function changed({ redraw = true } = {}) {
  dirty = true;
  setSave('dirty');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
  if (redraw) scheduleSync();
}
async function save() {
  if (saving) { saveTimer = setTimeout(save, 300); return; }
  if (!dirty) return;
  dirty = false;
  saving = true;
  setSave('saving');
  try {
    const r = await api('PUT', `/api/maps/${meta.id}`, { map: doc, version: meta.version });
    meta = { ...meta, ...r };
    setSave(dirty ? 'dirty' : 'saved');
  } catch (e) {
    dirty = true;
    if (e.status === 409) {
      setSave('error');
      if (await confirmDialog({ title: 'This map changed somewhere else', confirmLabel: 'Load latest version', message: 'It was edited in another tab. Load the latest version (your last few edits here are discarded)?' })) location.reload();
    } else { setSave('error'); saveTimer = setTimeout(save, 4000); }
  } finally { saving = false; }
}
addEventListener('beforeunload', (e) => { if (dirty || saving) e.preventDefault(); });
setSave('saved');

/* ---------- The map ---------- */

const map = createMap($('#map'), { ...doc.view, markers: [] }, { library: doc.layers });
map.scrollZoom.enable();
map._legend.enabled = doc.view.legend !== false;
const currentView = () => ({ ...readView(map), basemap: doc.view.basemap, layers: [...doc.view.layers], markers: [] });
// The starting view only changes when you say so (Map details → Make this the starting view).
const setStartingView = () => {
  const v = readView(map);
  Object.assign(doc.view, { center: v.center, zoom: v.zoom, bearing: v.bearing, pitch: v.pitch });
  changed({ redraw: false });
  toast('This is now where the map starts', { tone: 'ok' });
};

// Keep the live map in step with the document: new, changed, removed, reordered and toggled layers.
const drawn = new Map(); // layer id → JSON last drawn
let syncTimer;
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 250); }
function sync() {
  if (!map.isStyleLoaded()) { map.once('idle', sync); return; }
  const ids = new Set(doc.layers.map((l) => l.id));
  for (const lid of [...drawn.keys()]) if (!ids.has(lid)) { rebuildGone(lid); drawn.delete(lid); }
  for (const l of doc.layers) {
    const json = JSON.stringify(l);
    if (drawn.has(l.id) && drawn.get(l.id) !== json && map.getSource(`dl-${l.id}`)) rebuildLayer(map, l);
    drawn.set(l.id, json);
  }
  refreshLayers(map);
  orderLayers(map);
  doc.view.layers = doc.view.layers.filter((lid) => ids.has(lid));
  setVisibleLayers(map, doc.view.layers);
  renderPanel();
}
function rebuildGone(lid) {
  map.getStyle().layers.filter((l) => l.id.startsWith(`dl-${lid}-`)).forEach((l) => map.removeLayer(l.id));
  if (map.getSource(`dl-${lid}`)) map.removeSource(`dl-${lid}`);
}
map.on('style.load', () => { drawn.clear(); doc.layers.forEach((l) => drawn.set(l.id, JSON.stringify(l))); setVisibleLayers(map, doc.view.layers); });

/* ---------- Shared tools (catalog, add data, analysis, draw) ---------- */

initWorkbench({
  story: () => doc,
  changed: () => changed(),
  renderRail: () => { scheduleSync(); renderPanel(); },
  openLayer: (lid) => { if (!doc.view.layers.includes(lid)) doc.view.layers.push(lid); changed(); showTool('layers'); selectLayer(lid); },
  insertBlock: () => toast('Big numbers go in a story. Open a story that uses this map and add them there.'),
  selectedIndex: () => null,
});
const LE = layerEditor({ doc: () => doc, changed: () => changed(), rerender: () => renderProps(), onInfo: () => { renderProps(); renderPanel(); }, noun: 'map' });

/* ---------- Tool rail and panels ---------- */

const TOOLBAR = [
  ['layers', 'Layers', 'layers'], ['add', 'Add data', 'plus'], ['basemap', 'Basemap', 'globe'], ['bookmarks', 'Bookmarks', 'target'],
  ['analysis', 'Analysis', 'sparkle'], ['draw', 'Draw', 'pen'], ['measure', 'Measure', 'ruler'], ['details', 'Map details', 'sliders'],
];
let tool = doc.layers.length ? 'layers' : 'add';
const tools = $('#tools');
const panel = $('#panel');
// after adding data, show it in the layer list
const showTool = (k) => { tool = k; renderTools(); renderPanel(); };
function renderTools() {
  tools.replaceChildren(...TOOLBAR.map(([k, label, ic]) => h('button', { type: 'button', class: tool === k ? 'is-on' : '', title: label, 'aria-label': label, 'aria-pressed': tool === k ? 'true' : 'false',
    onclick: () => { if (tool === 'measure' && k !== 'measure') stopMeasure(); tool = k; renderTools(); renderPanel(); } }, icon(ic, { size: 19 }), h('span', {}, label))),
  h('span', { class: 'spacer' }),
  h('button', { type: 'button', class: map._legend.enabled ? 'is-on' : '', title: 'Legend', 'aria-label': 'Show legend', onclick: () => {
    map._legend.enabled = !map._legend.enabled; doc.view.legend = map._legend.enabled; map._legend.render(map); changed({ redraw: false }); renderTools();
  } }, icon('list', { size: 19 }), h('span', {}, 'Legend')));
}

const PANELS = {
  layers: layersPanel, add: addPanel, basemap: basemapPanel, bookmarks: bookmarksPanel, analysis: analysisPanel, draw: drawPanel, measure: measurePanel, details: detailsPanel,
};
function renderPanel() {
  const scroll = panel.scrollTop;
  panel.replaceChildren(...[PANELS[tool]()].flat().filter(Boolean));
  panel.scrollTop = scroll;
}
const head = (title, hint) => [h('h2', { class: 'me-h' }, title), hint ? h('p', { class: 'me-hint' }, hint) : null];

/* Layers: drawing order (top of the list draws on top), visibility, quick actions */
let dragFrom = -1;
function layersPanel() {
  const ordered = doc.layers.map((l, i) => [l, i]).reverse();
  return [
    ...head('Layers', doc.layers.length ? 'Drag to reorder: layers higher in the list draw on top. Click one to style it, filter it or see its table.' : null),
    doc.layers.length ? h('ol', { class: 'me-layers' }, ordered.map(([l, i]) => {
      const on = doc.view.layers.includes(l.id);
      return h('li', { class: `me-layer${selected === l.id ? ' is-on' : ''}${on ? '' : ' is-off'}`, draggable: 'true',
        ondragstart: (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', l.id); },
        ondragover: (e) => { if (dragFrom >= 0) { e.preventDefault(); e.currentTarget.classList.add('is-drop'); } },
        ondragleave: (e) => e.currentTarget.classList.remove('is-drop'),
        ondrop: (e) => { e.preventDefault(); if (dragFrom < 0 || dragFrom === i) return; const [m] = doc.layers.splice(dragFrom, 1); doc.layers.splice(i, 0, m); dragFrom = -1; changed(); },
        ondragend: () => { dragFrom = -1; },
        onclick: () => selectLayer(l.id) },
      h('span', { class: 'tour-grip', 'aria-hidden': 'true' }, icon('grip', { size: 14 })),
      h('input', { type: 'checkbox', checked: on, 'aria-label': `Show ${l.name}`, onclick: (e) => e.stopPropagation(), onchange: (e) => {
        doc.view.layers = e.target.checked ? [...doc.view.layers, l.id] : doc.view.layers.filter((x) => x !== l.id); changed();
      } }),
      h('span', { class: 'swatch', style: `background:${l.type === 'raster' ? 'linear-gradient(135deg,#8ab,#cba)' : l.style?.color || '#2563eb'}` }),
      h('span', { class: 'me-layer-text' }, h('strong', {}, l.name || 'Layer'),
        h('span', { class: 'muted' }, [l.analysis ? `${TOOLS[l.analysis.tool]?.name || 'Analysis'} · ` : '', l.drawn ? 'Drawing · ' : '', LE.layerStatus(l)].join(''))),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${l.name} options`, onclick: (e) => { e.stopPropagation(); layerMenu(e.currentTarget, l); } }, icon('more')));
    })) : h('div', { class: 'data-empty' }, h('span', { class: 'data-empty-art' }, icon('layers', { size: 26 })), h('strong', {}, 'No layers yet'),
      h('p', {}, 'Add live public data, your own files, or draw on the map.'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { tool = 'add'; renderTools(); renderPanel(); } }, icon('plus', { size: 15 }), 'Add data')),
  ];
}
function layerMenu(btn, l) {
  const i = doc.layers.indexOf(l);
  menu(btn, [
    { label: 'Zoom to layer', icon: 'target', onClick: () => fitToLayer(map, l.id) },
    l.type !== 'raster' ? { label: 'Show table', icon: 'list', onClick: () => openTable(l) } : null,
    { label: 'Settings', icon: 'sliders', onClick: () => selectLayer(l.id) },
    l.analysis ? { label: 'Re-run analysis', icon: 'refresh', onClick: () => rerunAnalysis(l) } : null,
    l.drawn && l.data ? { label: 'Edit drawing', icon: 'pen', onClick: () => openDraw({ layer: l, view: currentView(), onSave: () => {} }) } : null,
    { label: 'Duplicate', icon: 'copy', onClick: () => { const c = structuredClone(l); c.id = `l${Math.random().toString(36).slice(2, 8)}`; c.name = `${l.name} copy`; doc.layers.splice(i + 1, 0, c); doc.view.layers.push(c.id); changed(); } },
    'sep',
    { label: 'Remove', icon: 'trash', danger: true, onClick: () => {
      doc.layers.splice(i, 1);
      if (selected === l.id) closeProps();
      changed();
      toast(`Removed “${l.name}”`, { action: { label: 'Undo', onClick: () => { doc.layers.splice(i, 0, l); changed(); } } });
    } },
  ].filter(Boolean));
}

function addPanel() {
  const opt = (ic, title, text, fn) => h('button', { type: 'button', class: 'pick', onclick: fn }, h('span', { class: 'pick-icon' }, icon(ic, { size: 18 })), h('span', {}, h('strong', {}, title), h('span', {}, text)));
  return [...head('Add data'), h('div', { class: 'wb-tools' },
    opt('globe', 'Browse public data', 'NOAA, NASA, USGS, Census, parks, wildfires, plus ArcGIS Online search', () => openPublicData({ onAdd: (l) => { doc.view.layers.push(l.id); changed(); showTool('layers'); } })),
    opt('upload', 'Your data', 'GeoJSON or CSV files, or a link to GeoJSON or an ArcGIS layer', () => openAddData()),
    opt('pen', 'Draw on the map', 'Points, lines, areas, circles and text, styled your way', () => startDraw()))];
}

function basemapPanel() {
  return [...head('Basemap'), h('div', { class: 'basemaps me-basemaps' }, Object.entries(BASEMAPS).map(([k, b]) => h('button', { type: 'button', class: `bm ${doc.view.basemap === k ? 'is-on' : ''}`,
    onclick: () => { doc.view.basemap = k; map.setStyle(BASEMAPS[k].style, { diff: false }); map._basemap = k; changed({ redraw: false }); renderPanel(); } },
  h('span', { class: `bm-swatch-${k}` }), h('span', {}, b.label))))];
}

/* Bookmarks: named views (and which layers are on), the steps a story walks readers through */
function bookmarksPanel() {
  const add = () => {
    const b = { id: `b${Math.random().toString(36).slice(2, 8)}`, name: `View ${doc.bookmarks.length + 1}`, view: pick(readView(map)), layers: [...doc.view.layers] };
    doc.bookmarks.push(b);
    changed({ redraw: false });
    renderPanel();
    requestAnimationFrame(() => [...panel.querySelectorAll('.me-bm input')].pop()?.select());
  };
  const go = (b) => { map.flyTo({ ...b.view, duration: 1200 }); if (b.layers) { doc.view.layers = b.layers.filter((x) => doc.layers.some((l) => l.id === x)); changed(); } };
  return [
    ...head('Bookmarks', 'Save views of the map, with the layers that are on. In a story, a moving map can walk readers through them one card at a time.'),
    h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: add }, icon('plus', { size: 15 }), 'Bookmark this view'),
    h('ol', { class: 'me-bms' }, doc.bookmarks.map((b, i) => h('li', { class: 'me-bm' },
      h('div', { class: 'row' },
        h('span', { class: 'tour-num' }, String(i + 1)),
        h('input', { class: 'input', type: 'text', value: b.name, 'aria-label': 'Bookmark name', oninput: (e) => { b.name = e.target.value; changed({ redraw: false }); } }),
        h('button', { type: 'button', class: 'icon-btn', title: 'Go there', 'aria-label': 'Go to this bookmark', onclick: () => go(b) }, icon('eye', { size: 15 })),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Bookmark options', onclick: (e) => menu(e.currentTarget, [
          { label: 'Update to the current view and layers', icon: 'refresh', onClick: () => { b.view = pick(readView(map)); b.layers = [...doc.view.layers]; changed({ redraw: false }); renderPanel(); toast('Bookmark updated', { tone: 'ok' }); } },
          { label: 'Move up', icon: 'up', disabled: i === 0, onClick: () => { doc.bookmarks.splice(i - 1, 0, doc.bookmarks.splice(i, 1)[0]); changed({ redraw: false }); renderPanel(); } },
          { label: 'Move down', icon: 'down', disabled: i === doc.bookmarks.length - 1, onClick: () => { doc.bookmarks.splice(i + 1, 0, doc.bookmarks.splice(i, 1)[0]); changed({ redraw: false }); renderPanel(); } },
          'sep',
          { label: 'Delete', icon: 'trash', danger: true, onClick: () => { doc.bookmarks.splice(i, 1); changed({ redraw: false }); renderPanel(); } },
        ]) }, icon('more'))),
      h('textarea', { class: 'me-bm-note', rows: 2, placeholder: 'Note for this step (becomes the card text in a story)', value: b.note || '', oninput: (e) => { b.note = e.target.value || undefined; changed({ redraw: false }); } }),
      h('span', { class: 'muted me-bm-meta' }, `Zoom ${(+b.view.zoom).toFixed(1)} · ${(b.layers || []).length} ${(b.layers || []).length === 1 ? 'layer' : 'layers'} on`)))),
    doc.bookmarks.length ? h('button', { type: 'button', class: 'btn btn-block', onclick: newStoryFromMap }, icon('scrollmap', { size: 15 }), 'Start a story that walks through these') : null,
  ];
}
const pick = (v) => ({ center: v.center, zoom: v.zoom, bearing: v.bearing, pitch: v.pitch });

function analysisPanel() {
  const results = doc.layers.filter((l) => l.analysis);
  return [
    ...head('Analysis', 'Buffers, hex bins, counts in areas, distance to nearest, proximity, centers, outlines and attribute filters. Every result is previewed before it becomes a layer.'),
    h('div', { class: 'wb-tools' }, Object.entries(TOOLS).map(([k, t]) => h('button', { type: 'button', class: 'pick', onclick: () => openAnalysis({ tool: k, view: currentView() }) },
      h('span', { class: 'pick-icon' }, icon(t.icon, { size: 18 })), h('span', {}, h('strong', {}, t.name), h('span', {}, t.desc))))),
    results.length ? [h('div', { class: 'rail-section-title' }, 'Results in this map'), h('div', { class: 'sub-list' }, results.map((l) => h('div', { class: 'me-result' },
      h('span', {}, h('strong', {}, l.name), h('span', { class: 'muted' }, TOOLS[l.analysis.tool]?.name || '')),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => rerunAnalysis(l) }, icon('refresh', { size: 14 }), 'Re-run'))))] : null,
  ];
}

function startDraw(layer) {
  openDraw({ layer, view: currentView(), onSave: (l) => { if (!doc.view.layers.includes(l.id)) doc.view.layers.push(l.id); changed(); } });
}
function drawPanel() {
  const drawings = doc.layers.filter((l) => l.drawn && l.data);
  return [
    ...head('Draw', 'Sketch points, lines, freehand routes, areas, boxes, circles and text labels, and style each one.'),
    h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => startDraw() }, icon('pen', { size: 15 }), 'New drawing'),
    drawings.length ? [h('div', { class: 'rail-section-title' }, 'Drawings'), h('div', { class: 'sub-list' }, drawings.map((l) => h('div', { class: 'me-result' },
      h('span', {}, h('strong', {}, l.name), h('span', { class: 'muted' }, `${l.data.features.length} shapes`)),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => startDraw(l) }, icon('pen', { size: 14 }), 'Edit'))))] : null,
  ];
}

/* Measure: click points on the map for a distance or an area */
let measure = null;
function measurePanel() {
  measure ||= { mode: 'line', pts: [] };
  startMeasure();
  const t = window.turf;
  const g = measure.pts.length > 1 ? (measure.mode === 'area' && measure.pts.length > 2 ? { type: 'Polygon', coordinates: [[...measure.pts, measure.pts[0]]] } : { type: 'LineString', coordinates: measure.pts }) : null;
  const value = !g || !t ? '' : g.type === 'Polygon' ? `${fmtArea(t.area(t.feature(g)) / 1e6)} · perimeter ${fmtDist(t.length(t.polygonToLine(t.feature(g)), { units: 'kilometers' }))}`
    : fmtDist(t.length(t.feature(g), { units: 'kilometers' }));
  return [
    ...head('Measure', 'Click points on the map. Nothing is saved; use Draw to keep a shape.'),
    h('div', { class: 'seg seg-block' }, [['line', 'Distance'], ['area', 'Area']].map(([k, l]) => h('button', { type: 'button', class: measure.mode === k ? 'is-on' : '', onclick: () => { measure.mode = k; drawMeasure(); renderPanel(); } }, l))),
    h('div', { class: 'wb-readout' }, value ? h('div', { class: 'wb-measure' }, icon('ruler', { size: 16 }), value) : h('p', { class: 'field-hint', style: 'margin:0' }, measure.pts.length ? 'Keep clicking to add points.' : 'Click the map to start measuring.')),
    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { type: 'button', class: 'btn btn-sm', disabled: !measure.pts.length, onclick: () => { measure.pts.pop(); drawMeasure(); renderPanel(); } }, icon('undo', { size: 14 }), 'Undo point'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', disabled: !measure.pts.length, onclick: () => { measure.pts = []; drawMeasure(); renderPanel(); } }, 'Clear')),
  ];
}
function startMeasure() {
  $('#map').classList.add('is-measuring');
  if (!map.getSource('me-measure') && map.isStyleLoaded()) {
    map.addSource('me-measure', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'me-measure-fill', type: 'fill', source: 'me-measure', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#e4572e', 'fill-opacity': 0.15 } });
    map.addLayer({ id: 'me-measure-line', type: 'line', source: 'me-measure', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#e4572e', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'me-measure-pt', type: 'circle', source: 'me-measure', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4.5, 'circle-color': '#fff', 'circle-stroke-color': '#e4572e', 'circle-stroke-width': 2 } });
  }
  drawMeasure();
}
function drawMeasure() {
  const src = map.getSource('me-measure');
  if (!src || !measure) return;
  const p = measure.pts;
  const feats = p.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }));
  if (p.length > 1) feats.push({ type: 'Feature', properties: {}, geometry: measure.mode === 'area' && p.length > 2 ? { type: 'Polygon', coordinates: [[...p, p[0]]] } : { type: 'LineString', coordinates: p } });
  src.setData({ type: 'FeatureCollection', features: feats });
}
function stopMeasure() {
  $('#map').classList.remove('is-measuring');
  if (measure) { measure.pts = []; drawMeasure(); }
}
map.on('click', (e) => { if (tool !== 'measure' || !measure) return; measure.pts.push(e.lngLat.toArray()); drawMeasure(); renderPanel(); });
map.on('style.load', () => { if (tool === 'measure') startMeasure(); });

/* Map details: title, summary, thumbnail, where the map is used */
let usage = null;
async function loadUsage() {
  try { usage = (await api('GET', `/api/maps/${meta.id}/usage`)).stories; } catch { usage = []; }
  $('#usage').textContent = usage.length ? `Used in ${usage.length} ${usage.length === 1 ? 'story' : 'stories'}` : '';
  if (tool === 'details') renderPanel();
}
function detailsPanel() {
  const thumb = h('div', { class: 'me-thumb' }, doc.thumbnail ? h('img', { src: doc.thumbnail, alt: '' }) : h('span', { class: 'muted' }, 'No thumbnail yet'));
  return [
    ...head('Map details'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Title'), h('input', { class: 'input', type: 'text', value: doc.title || '', oninput: (e) => { doc.title = e.target.value; titleInput.value = doc.title; changed({ redraw: false }); } })),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Summary'), h('textarea', { rows: 3, value: doc.summary || '', placeholder: 'What this map shows, and where its data comes from', oninput: (e) => { doc.summary = e.target.value; changed({ redraw: false }); } })),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Thumbnail'), thumb,
      h('button', { type: 'button', class: 'btn btn-sm', style: 'margin-top:8px', onclick: captureThumbnail }, icon('image', { size: 14 }), 'Use the current view')),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Starting view'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: setStartingView }, icon('target', { size: 14 }), 'Make this the starting view'),
      h('p', { class: 'field-hint' }, `Where the map opens, and what a story shows unless it picks a bookmark. Now: zoom ${(+doc.view.zoom).toFixed(1)}.`)),
    h('div', { class: 'rail-section-title' }, 'Used in'),
    usage == null ? h('p', { class: 'muted' }, 'Checking…') : usage.length ? h('ul', { class: 'me-usage-list' }, usage.map((s) => h('li', {},
      h('a', { href: `/builder.html?id=${s.id}` }, s.title || 'Untitled story'), s.url ? h('span', { class: 'pill is-live' }, 'Live') : h('span', { class: 'pill' }, 'Draft'))))
      : h('p', { class: 'muted', style: 'font-size:13px' }, 'Not used in any story yet.'),
    h('p', { class: 'field-hint' }, 'Edits here show up in every story that uses this map. Published stories load the map live, so readers see changes within about a minute.'),
    meta.shared ? h('p', { class: 'field-hint' }, icon('globe', { size: 13 }), ' Shared publicly, because a published story uses it.') : null,
    h('div', { class: 'row', style: 'margin-top:14px' },
      h('button', { type: 'button', class: 'btn btn-sm', onclick: saveCopy }, icon('copy', { size: 14 }), 'Save a copy'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: deleteMap }, icon('trash', { size: 14 }), 'Delete map')),
  ];
}
function captureThumbnail() {
  // A WebGL canvas can only be read during a frame, so grab it on the next render.
  map.once('render', () => map.getCanvas().toBlob(async (blob) => {
    if (!blob) { toast('Could not capture the map', { tone: 'error' }); return; }
    try {
      doc.thumbnail = (await uploadImage(new File([blob], 'map-thumbnail.png', { type: 'image/png' }))).url;
      changed({ redraw: false });
      renderPanel();
      toast('Thumbnail updated', { tone: 'ok' });
    } catch (e) { toast(e.message, { tone: 'error' }); }
  }, 'image/png'));
  map.triggerRepaint();
}
async function saveCopy() {
  await save();
  const { id: _id, ...copy } = structuredClone(doc);
  const r = await api('POST', '/api/maps', { map: { ...copy, title: `${doc.title || 'Untitled map'} (copy)` } });
  location.href = `/map.html?id=${r.id}`;
}
async function deleteMap() {
  const n = usage?.length || 0;
  const ok = await confirmDialog({ title: `Delete “${doc.title || 'Untitled map'}”?`, danger: true, confirmLabel: 'Delete map',
    message: n ? `${n} ${n === 1 ? 'story uses' : 'stories use'} this map. Those maps will go blank. This can't be undone.` : "This can't be undone." });
  if (!ok) return;
  dirty = false;
  await api('DELETE', `/api/maps/${meta.id}`);
  location.href = '/?tab=maps';
}

/* ---------- Layer settings (right panel) ---------- */

let selected = null;
const props = $('#props');
function selectLayer(lid) {
  selected = lid;
  props.hidden = false;
  renderProps();
  renderPanel();
}
function closeProps() { selected = null; props.hidden = true; renderPanel(); }
function renderProps() {
  const l = doc.layers.find((x) => x.id === selected);
  if (!l) { props.hidden = true; return; }
  LE.inspectLayer(l);
  const scroll = props.scrollTop;
  props.replaceChildren(
    h('div', { class: 'me-props-head' }, h('strong', {}, l.name || 'Layer'), h('span', { class: 'spacer' }),
      l.type !== 'raster' ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openTable(l) }, icon('list', { size: 14 }), 'Table') : null,
      h('button', { type: 'button', class: 'icon-btn', title: 'Zoom to layer', 'aria-label': 'Zoom to layer', onclick: () => fitToLayer(map, l.id) }, icon('target', { size: 16 })),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close settings', onclick: closeProps }, icon('x', { size: 16 }))),
    LE.layerForm(l));
  props.scrollTop = scroll;
}

/* ---------- Attribute table ---------- */

const table = $('#table');
let tableState = null;
async function openTable(l) {
  tableState = { layer: l, sort: null, dir: 1, q: '' };
  table.hidden = false;
  table.replaceChildren(h('p', { class: 'muted', style: 'padding:14px' }, 'Loading…'));
  try { tableState.fc = await layerFeatures(l); } catch (e) { table.replaceChildren(h('p', { class: 'form-error', style: 'padding:14px' }, e.message)); return; }
  drawTable();
}
function drawTable() {
  const { layer, fc } = tableState;
  const cols = fieldNames(fc).slice(0, 14);
  const q = tableState.q.toLowerCase();
  let rows = fc.features.map((f, i) => [f, i]).filter(([f]) => !q || Object.values(f.properties || {}).some((v) => String(v ?? '').toLowerCase().includes(q)));
  if (tableState.sort) {
    const k = tableState.sort;
    rows.sort(([a], [b]) => { const x = a.properties?.[k]; const y = b.properties?.[k]; return (x == null) - (y == null) || (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * tableState.dir; });
  }
  const shown = rows.slice(0, 1000);
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search the table', value: tableState.q, oninput: (e) => { tableState.q = e.target.value; drawTable(); search.focus(); } });
  table.replaceChildren(
    h('div', { class: 'me-table-head' }, h('strong', {}, layer.name), h('span', { class: 'muted' }, `${rows.length.toLocaleString()} of ${fc.features.length.toLocaleString()} features${rows.length > 1000 ? ' · showing the first 1,000' : ''}`),
      h('span', { class: 'spacer' }), search, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close table', onclick: () => { table.hidden = true; tableState = null; } }, icon('x', { size: 16 }))),
    h('div', { class: 'me-table-scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, cols.map((c) => h('th', { onclick: () => { tableState.dir = tableState.sort === c ? -tableState.dir : 1; tableState.sort = c; drawTable(); } },
        c, tableState.sort === c ? (tableState.dir > 0 ? ' ▲' : ' ▼') : '')))),
      h('tbody', {}, shown.map(([f]) => h('tr', { onclick: () => zoomToFeature(f) }, cols.map((c) => h('td', {}, fmtCell(f.properties?.[c])))))))));
}
const fmtCell = (v) => (v == null ? '' : typeof v === 'number' ? (Math.abs(v) > 1e11 && Math.abs(v) < 4e12 ? new Date(v).toLocaleString() : v.toLocaleString()) : String(v).slice(0, 120));
function zoomToFeature(f) {
  const b = bbox({ type: 'FeatureCollection', features: [f] });
  if (b) map.fitBounds(b, { padding: 80, maxZoom: 15, duration: 700 });
  const src = map.getSource('me-hl');
  const data = { type: 'FeatureCollection', features: [f] };
  if (src) src.setData(data);
  else {
    map.addSource('me-hl', { type: 'geojson', data });
    map.addLayer({ id: 'me-hl-line', type: 'line', source: 'me-hl', paint: { 'line-color': '#00e5ff', 'line-width': 4 } });
    map.addLayer({ id: 'me-hl-pt', type: 'circle', source: 'me-hl', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#00e5ff', 'circle-stroke-width': 3 } });
  }
}

/* ---------- Place search ---------- */

{
  const results = h('div', { class: 'me-search-results', hidden: true });
  const q = h('input', { type: 'search', placeholder: 'Search for a place', 'aria-label': 'Search for a place', onkeydown: async (e) => {
    if (e.key === 'Escape') { results.hidden = true; return; }
    if (e.key !== 'Enter' || !q.value.trim()) return;
    results.hidden = false;
    results.replaceChildren(h('p', { class: 'muted' }, 'Searching…'));
    try {
      const found = await findPlaces(q.value.trim());
      results.replaceChildren(...(found.length ? found.map((p) => h('button', { type: 'button', onclick: () => { results.hidden = true; map.flyTo({ center: p.lngLat, zoom: 12, duration: 1200 }); } },
        h('strong', {}, p.name), h('span', { class: 'muted' }, p.detail))) : [h('p', { class: 'muted' }, 'Nothing found.')]));
    } catch (err) { results.replaceChildren(h('p', { class: 'muted' }, err.message)); }
  } });
  $('#search').append(h('label', { class: 'me-search-box' }, icon('search', { size: 15 }), q), results);
}

/* ---------- Use in a story ---------- */

async function newStoryFromMap() {
  await save();
  const s = await api('POST', '/api/stories', { story: storyFromMap(doc, meta.id) });
  location.href = `/builder.html?id=${s.id}&new=1`;
}
$('#btn-story').append(icon('scrollmap', { size: 16 }), 'Use in a new story');
$('#btn-story').addEventListener('click', newStoryFromMap);

renderTools();
renderPanel();
loadUsage();
if (params.get('new')) { titleInput.focus(); titleInput.select(); }
