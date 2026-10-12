// Data workspaces for the editor: Add data, Analyze (with live map preview), and Draw & measure.
import { h, icon, dialog, toast } from './ui.js';
import { createMap, setVisibleLayers, reloadLayer, loadLayerData, layerFeatures, bbox, DEFAULT_VIEW } from './maps.js';
import { openCatalog } from './catalog.js';
import { TOOLS, OPS, kinds, layerStats, fmtDist, fmtArea, fmtNum } from './analysis.js';
import { csvToGeoJSON } from './csv.js';

let ctx; // { story, changed, renderRail, openLayer, selectedIndex, insertBlock }
export const initWorkbench = (c) => { ctx = c; };

const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const RESULT = '#e4572e';
const kidsOf = (...a) => a.flat(Infinity).filter((x) => x != null && x !== false);

function addLayer(layer, { open = true } = {}) {
  const story = ctx.story();
  (story.layers ||= []).push(layer);
  ctx.changed();
  if (open) ctx.openLayer(layer.id);
  else ctx.renderRail();
  return layer;
}

/* ---------- Parsing uploads ---------- */

export async function parseDataFile(file) {
  const text = await file.text();
  const data = /\.csv$/i.test(file.name) || file.type === 'text/csv' ? csvToGeoJSON(text) : JSON.parse(text);
  if (data.type === 'Feature') return { type: 'FeatureCollection', features: [data] };
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Expected GeoJSON (a FeatureCollection) or a CSV with lat/lon columns');
  return { type: 'FeatureCollection', features: data.features.filter((f) => f.geometry) };
}

export async function addFromFile(file) {
  try {
    const data = await parseDataFile(file);
    const kb = Math.round(JSON.stringify(data).length / 1024);
    const layer = addLayer({ id: uid('l'), name: file.name.replace(/\.\w+$/, '').replace(/[_-]+/g, ' '), data, style: { color: '#2563eb' }, popup: {} });
    toast(`Added "${layer.name}" · ${data.features.length.toLocaleString()} features`, { tone: 'ok' });
    if (kb > 3000) toast(`That file is ${kb.toLocaleString()} KB. Big files make stories slow to load; hosting it and adding it by link is better.`, { duration: 8000 });
    return layer;
  } catch (e) {
    toast(`Could not read ${file.name}: ${e.message}`, { tone: 'error', duration: 6000 });
    return null;
  }
}

/* ---------- Public data ---------- */

export function openPublicData({ onAdd } = {}) {
  openCatalog({ onAdd: (layer) => { addLayer(layer, { open: false }); onAdd?.(layer); } });
}

/* ---------- Add data ---------- */

export function openAddData() {
  const fileInput = h('input', { type: 'file', accept: '.geojson,.json,.csv,application/json,text/csv', multiple: true, hidden: true,
    onchange: async () => { const files = [...fileInput.files]; dlg.close(); for (const f of files) await addFromFile(f); } });
  const drop = h('button', { type: 'button', class: 'ad-drop', onclick: () => fileInput.click() },
    icon('upload', { size: 26 }), h('strong', {}, 'Drop a file here, or click to browse'), h('span', {}, 'GeoJSON, or CSV with latitude and longitude columns'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-drop'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-drop'));
  drop.addEventListener('drop', async (e) => { e.preventDefault(); const files = [...e.dataTransfer.files]; dlg.close(); for (const f of files) await addFromFile(f); });

  const url = h('input', { class: 'input', type: 'url', placeholder: 'https://… GeoJSON, or an ArcGIS FeatureServer/MapServer layer' });
  const addUrl = () => {
    const u = url.value.trim();
    if (!/^(https?:\/\/|\/)/.test(u)) { toast('Paste a full link starting with https://', { tone: 'error' }); return; }
    const name = decodeURIComponent(u.split('?')[0].split('/').filter(Boolean).slice(-1)[0] || 'Linked data').replace(/\.\w+$/, '').replace(/[_-]+/g, ' ');
    dlg.close();
    addLayer({ id: uid('l'), name: /^\d+$/.test(name) ? 'ArcGIS layer' : name, url: u, style: { color: '#2563eb' }, popup: {} });
    toast('Layer added. Loading its data…', { tone: 'ok' });
  };
  url.addEventListener('keydown', (e) => { if (e.key === 'Enter') addUrl(); });

  const option = (ic, title, text, onclick) => h('button', { type: 'button', class: 'ad-opt', onclick }, h('span', { class: 'pick-icon' }, icon(ic, { size: 18 })), h('span', {}, h('strong', {}, title), h('span', {}, text)));
  const dlg = dialog({
    title: 'Add data',
    body: h('div', { class: 'ad' },
      drop, fileInput,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Or add by link'), h('div', { class: 'row' }, url, h('button', { type: 'button', class: 'btn btn-primary', onclick: addUrl }, 'Add'))),
      h('div', { class: 'ad-opts' },
        option('globe', 'Public data', 'NOAA, NASA, USGS, Census, NPS and thousands more', () => { dlg.close(); openPublicData(); }),
        option('pen', 'Draw on the map', 'Sketch and style points, lines, areas, circles and text', () => { dlg.close(); openDraw(); }),
        option('map', 'Try sample data', 'Landmarks along the Potomac River', () => {
          dlg.close();
          addLayer({ id: uid('l'), name: 'Sample landmarks', url: '/data/landmarks.geojson', style: { color: '#2563eb', mode: 'categorical', field: 'category', label: 'name' }, popup: { title: '{name}' } });
        }))),
  });
  setTimeout(() => url.blur(), 0);
}

/* ---------- Shared map helpers ---------- */

function workspace({ title, side, onClose, cls = '' }) {
  const mapEl = h('div', { class: 'map' });
  const dlg = dialog({ title, cls: `dlg-xl ${cls}`, body: h('div', { class: 'wb' }, side, h('div', { class: 'wb-map' }, mapEl)), onClose });
  dlg.querySelector('.dlg-body').style.padding = '0';
  return { dlg, mapEl };
}

function resultLayers(map, id, color = RESULT) {
  if (map.getSource(id)) return;
  map.addSource(id, { type: 'geojson', data: map._wmResult || { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': color, 'fill-opacity': 0.28 } });
  map.addLayer({ id: `${id}-line`, type: 'line', source: id, filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'LineString']]], paint: { 'line-color': color, 'line-width': 2.5 } });
  map.addLayer({ id: `${id}-pt`, type: 'circle', source: id, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': color, 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
}
const whenStyled = (map, fn) => (map.isStyleLoaded() ? fn() : map.once('style.load', fn));
const fit = (map, data) => { const b = data && bbox(data); if (b) map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 700 }); };

/* ---------- Analyze ---------- */

export async function openAnalysis({ tool: startTool, layerId } = {}) {
  const story = ctx.story();
  const lib = story.layers || [];
  if (!lib.length) { toast('Add a data layer first, then analyze it.'); openAddData(); return; }
  const side = h('div', { class: 'wb-side' }, h('p', { class: 'uploading' }, h('span', { class: 'spinner' }), 'Loading your data…'));
  let map;
  const { dlg, mapEl } = workspace({ title: 'Analyze', side, onClose: () => map?.remove() });
  map = createMap(mapEl, { ...DEFAULT_VIEW, layers: [] }, { library: lib });
  map.scrollZoom.enable();
  whenStyled(map, () => resultLayers(map, 'wm-result'));
  map.on('style.load', () => resultLayers(map, 'wm-result'));

  const data = {};
  await Promise.all(lib.filter((l) => l.type !== 'raster').map(async (l) => { try { const d = await layerFeatures(l); data[l.id] = { data: d, kinds: kinds(d), filtered: !!(l.filters || []).some((f) => f.field) }; } catch { /* unavailable layer */ } }));
  const usable = lib.filter((l) => data[l.id]);
  if (!usable.length) { side.replaceChildren(h('p', { class: 'form-error' }, "None of your layers could be loaded.")); return; }

  const list = () => {
    side.replaceChildren(
      h('p', { class: 'wb-intro' }, 'Pick an analysis. You\'ll see the result on the map before anything is added to your story.'),
      h('div', { class: 'wb-tools' }, Object.entries(TOOLS).map(([id, t]) => h('button', { type: 'button', class: 'pick', onclick: () => form(id) },
        h('span', { class: 'pick-icon' }, icon(t.icon, { size: 18 })), h('span', {}, h('strong', {}, t.name), h('span', {}, t.desc))))));
  };

  const form = (toolId) => {
    const tool = TOOLS[toolId];
    const inputs = {};
    const params = {};
    tool.params.forEach((p) => { if (p.dflt !== undefined) params[p.k] = p.dflt; });
    let result = null;
    const resultBox = h('div', { class: 'wb-result' });
    const paramsBox = h('div');

    tool.inputs.forEach((inp, i) => {
      const fits = usable.filter((l) => !inp.kind || data[l.id].kinds.has(inp.kind));
      const pref = (i === 0 && layerId && fits.find((l) => l.id === layerId)) || fits[i] || fits[0];
      inputs[inp.k] = pref?.id;
    });

    const showInputs = () => {
      const ids = [...new Set(Object.values(inputs).filter(Boolean))];
      setVisibleLayers(map, ids);
      fit(map, inputs[tool.inputs[0].k] && data[inputs[tool.inputs[0].k]]?.data);
    };

    const fieldsOf = (id, numeric) => {
      const st = id && data[id] ? layerStats(data[id].data) : { fields: [] };
      return st.fields.filter((f) => !numeric || f.kind === 'number').map((f) => f.name);
    };

    const drawParams = () => {
      paramsBox.replaceChildren(...kidsOf(tool.params.map((p) => {
        if (p.when && !p.when(params)) return null;
        const set = (v) => { params[p.k] = v; drawParams(); };
        const label = p.label ? h('span', { class: 'field-label' }, p.label) : null;
        switch (p.t) {
          case 'units': return h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Units'), seg([['kilometers', 'km'], ['miles', 'mi'], ['meters', 'm']], params[p.k], set));
          case 'stat': return h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Value for each hexagon'), seg([['count', 'Count'], ['sum', 'Sum'], ['mean', 'Average']], params[p.k], set));
          case 'check': return h('label', { class: 'check', style: 'margin-top:12px' }, h('input', { type: 'checkbox', checked: !!params[p.k], onchange: (e) => { params[p.k] = e.target.checked; } }), p.label);
          case 'field': {
            const opts = fieldsOf(inputs[p.of], p.numeric);
            if (!params[p.k] && !p.optional && opts[0]) params[p.k] = opts[0];
            return h('label', { class: 'field' }, label, h('select', { onchange: (e) => { params[p.k] = e.target.value || undefined; } },
              p.optional ? h('option', { value: '' }, 'None') : null,
              opts.length ? opts.map((o) => h('option', { value: o, selected: params[p.k] === o }, o)) : h('option', { value: '' }, p.numeric ? 'No number fields' : 'No fields')));
          }
          case 'op': return h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Rule'), h('select', { onchange: (e) => set(e.target.value) }, OPS.map((o) => h('option', { value: o, selected: params[p.k] === o }, o))));
          case 'number': return h('label', { class: 'field' }, label, h('input', { type: 'number', min: 0, step: 'any', value: params[p.k] ?? '', oninput: (e) => { params[p.k] = e.target.value; } }));
          default: return h('label', { class: 'field' }, label, h('input', { type: 'text', value: params[p.k] ?? '', oninput: (e) => { params[p.k] = e.target.value; } }));
        }
      })));
    };

    const inputFields = tool.inputs.map((inp) => {
      const fits = usable.filter((l) => !inp.kind || data[l.id].kinds.has(inp.kind));
      return h('label', { class: 'field' }, h('span', { class: 'field-label' }, inp.label),
        fits.length ? h('select', { onchange: (e) => { inputs[inp.k] = e.target.value; showInputs(); drawParams(); } },
          fits.map((l) => h('option', { value: l.id, selected: inputs[inp.k] === l.id }, `${l.name} · ${data[l.id].data.features.length.toLocaleString()}${data[l.id].filtered ? ' (filtered)' : ''}`)))
          : h('p', { class: 'field-hint', style: 'margin:0' }, `You need a layer with ${inp.kind === 'point' ? 'points' : inp.kind === 'polygon' ? 'areas (polygons)' : 'features'} for this.`));
    });

    const runBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => run() }, icon('sparkle', { size: 16 }), 'Run');
    const run = () => {
      if (tool.inputs.some((inp) => !inputs[inp.k])) { toast('Choose the layers to use first.', { tone: 'error' }); return; }
      runBtn.disabled = true;
      runBtn.replaceChildren(h('span', { class: 'spinner' }), 'Working…');
      setTimeout(() => {
        try {
          const ins = Object.fromEntries(Object.entries(inputs).map(([k, id]) => [k, data[id].data]));
          result = tool.run(ins, { ...params });
          map._wmResult = result.data;
          if (map.isStyleLoaded()) resultLayers(map, 'wm-result');
          map.getSource('wm-result')?.setData(result.data);
          fit(map, result.data);
          const names = Object.fromEntries(Object.entries(inputs).map(([k, id]) => [k, lib.find((l) => l.id === id)?.name || 'Layer']));
          const nameInput = h('input', { class: 'input', type: 'text', value: tool.name_(params, names) });
          resultBox.replaceChildren(...kidsOf(
            h('div', { class: 'wb-result-head' }, icon('check', { size: 16 }), h('strong', {}, `${result.data.features.length.toLocaleString()} ${result.data.features.length === 1 ? 'feature' : 'features'}`)),
            result.note ? h('p', { class: 'field-hint', style: 'margin:4px 0 0' }, result.note) : null,
            h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name for the new layer'), nameInput),
            h('button', { type: 'button', class: 'btn btn-brand btn-block', style: 'margin-top:12px', disabled: !result.data.features.length, onclick: () => {
              const src = lib.find((l) => l.id === inputs[tool.inputs[0].k]);
              const layer = { id: uid('l'), name: nameInput.value.trim() || tool.name, data: result.data, style: tool.style(src, result), popup: {},
                analysis: { tool: toolId, inputs: { ...inputs }, params: { ...params }, at: Date.now() } };
              dlg.close();
              addLayer(layer);
              toast(`Added "${layer.name}". Turn it on in any map with "Edit map".`, { tone: 'ok', duration: 5000 });
            } }, icon('plus', { size: 16 }), 'Add to my layers')));
        } catch (e) {
          resultBox.replaceChildren(h('p', { class: 'form-error' }, e.message));
        } finally {
          runBtn.disabled = false;
          runBtn.replaceChildren(icon('sparkle', { size: 16 }), 'Run again');
        }
      }, 30);
    };

    side.replaceChildren(...kidsOf(
      h('button', { type: 'button', class: 'link-btn wb-back', onclick: () => { map._wmResult = null; map.getSource('wm-result')?.setData({ type: 'FeatureCollection', features: [] }); list(); } }, '← All analyses'),
      h('div', { class: 'wb-tool-head' }, h('span', { class: 'pick-icon' }, icon(tool.icon, { size: 18 })), h('div', {}, h('h3', {}, tool.name), h('p', {}, tool.desc))),
      inputFields, paramsBox,
      h('div', { style: 'margin-top:18px' }, runBtn),
      resultBox));
    drawParams();
    showInputs();
  };

  if (startTool && TOOLS[startTool]) form(startTool);
  else list();
}

/** Re-runs a saved analysis against the latest data of its inputs. */
export async function rerunAnalysis(layer) {
  const a = layer.analysis;
  const tool = TOOLS[a?.tool];
  if (!tool) return;
  const lib = ctx.story().layers || [];
  const ins = {};
  for (const [k, id] of Object.entries(a.inputs)) {
    const src = lib.find((l) => l.id === id);
    if (!src) { toast('One of the layers this was made from has been deleted.', { tone: 'error' }); return; }
    ins[k] = await layerFeatures(src);
  }
  try {
    const r = tool.run(ins, a.params);
    layer.data = r.data;
    a.at = Date.now();
    ctx.changed();
    ctx.renderRail();
    toast(`Updated "${layer.name}" · ${r.data.features.length.toLocaleString()} features`, { tone: 'ok' });
  } catch (e) { toast(e.message, { tone: 'error' }); }
}

function seg(opts, value, onPick) {
  const el = h('div', { class: 'seg seg-block' }, opts.map(([v, l]) => h('button', { type: 'button', class: value === v ? 'is-on' : '', onclick: () => onPick(v) }, l)));
  return el;
}

/* ---------- Draw & measure ---------- */

const INK = ['#e4572e', '#f59e0b', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777', '#111827', '#ffffff'];
const DRAW_TOOLS = [
  ['select', 'Select', 'cursor', 'Click a shape to select it. Drag a selected shape to move it.'],
  ['point', 'Point', 'pin', 'Click the map to drop a point.'],
  ['line', 'Line', 'line', 'Click to add corners. Double-click or press Enter to finish.'],
  ['free', 'Freehand', 'scribble', 'Press and drag to draw. Let go to finish.'],
  ['area', 'Area', 'polygon', 'Click to add corners. Double-click or press Enter to close the area.'],
  ['rect', 'Box', 'square', 'Press and drag from one corner to the other.'],
  ['circle', 'Circle', 'circle', 'Press at the center and drag out to the edge.'],
  ['text', 'Text', 'type', 'Click the map where the text should go, then type it in the panel.'],
];
const KIND_OF_TOOL = { point: 'point', text: 'text', line: 'line', free: 'line', area: 'area', rect: 'area', circle: 'area' };
const DRAG_TOOLS = new Set(['free', 'rect', 'circle']);
const kindOf = (f) => (f.properties.text != null ? 'text' : /Point/.test(f.geometry.type) ? 'point' : /LineString/.test(f.geometry.type) ? 'line' : 'area');
const KIND_ICON = { point: 'pin', text: 'type', line: 'line', area: 'polygon' };

// Style properties each kind of shape carries (see FEATURE_STYLE_KEYS in maps.js).
function styleFor(kind, st) {
  if (kind === 'point') return { 'marker-color': st.color, 'marker-size': st.size };
  if (kind === 'text') return { stroke: st.color, 'text-size': st.textSize };
  const line = { stroke: st.color, 'stroke-width': st.width, 'stroke-opacity': st.opacity, 'stroke-dash': st.dash };
  if (kind === 'line') return { ...line, arrow: st.arrow || undefined };
  return { ...line, fill: st.fill || st.color, 'fill-opacity': st.fillOpacity };
}
// The panel's values, read back from a shape.
function styleOf(f, st) {
  const p = f.properties;
  return { ...st, color: p.stroke || p['marker-color'] || st.color, size: p['marker-size'] || st.size, textSize: p['text-size'] ?? st.textSize,
    width: p['stroke-width'] ?? st.width, opacity: p['stroke-opacity'] ?? st.opacity, dash: p['stroke-dash'] || 'solid', arrow: !!p.arrow,
    fill: p.fill && p.fill !== p.stroke ? p.fill : '', fillOpacity: p['fill-opacity'] ?? st.fillOpacity };
}

/**
 * The Draw & measure workspace. Pass `layer` to keep editing a layer drawn earlier. Opened from a map in the editor,
 * `view` is that map (the drawing starts there, over its layers) and `onSave(layer)` puts the drawing on it.
 */
export function openDraw({ layer: editing, view: here, onSave } = {}) {
  const t = window.turf;
  const story = ctx.story();
  let tool = editing ? 'select' : 'line';
  let sel = -1; // index of the selected shape
  let sketch = []; // corners of the shape being drawn
  let cursor = null;
  let drag = null; // { kind: 'free'|'rect'|'circle'|'move', start, ... } while the mouse is down
  let map;
  let st = { color: INK[0], width: 3, opacity: 1, dash: 'solid', arrow: false, fill: '', fillOpacity: 0.25, size: 'medium', textSize: 20 };
  const shapes = editing?.data ? structuredClone(editing.data.features) : [];
  let showNames = editing ? !!editing.style?.label : false;
  if (shapes.length) st = styleOf(shapes.at(-1), st);
  let saved = JSON.stringify(shapes); // to warn before closing with unsaved shapes

  // The drawing is previewed as a real story layer, so it looks exactly as it will in the story.
  const draft = { id: 'wm-draft', name: editing?.name || 'My drawing', drawn: true, popup: { enabled: false }, data: { type: 'FeatureCollection', features: [] },
    style: { color: st.color, width: 3, radius: 7, opacity: 0.25, ...(editing?.style || {}), mode: 'single', display: 'features' } };
  let trace = '';

  const round6 = (c) => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];
  const ll = (e) => round6([e.lngLat.lng, e.lngLat.lat]);
  const measure = (geom, props = {}) => {
    if (!t || !geom) return '';
    if (props.radius_km) return `radius ${fmtDist(props.radius_km)} · ${fmtArea(t.area(t.feature(geom)) / 1e6)}`;
    if (geom.type === 'LineString' && geom.coordinates.length > 1) return fmtDist(t.length(t.feature(geom), { units: 'kilometers' }));
    if (geom.type === 'Polygon' && geom.coordinates[0].length > 3) return `${fmtArea(t.area(t.feature(geom)) / 1e6)} · edge ${fmtDist(t.length(t.polygonToLine(t.feature(geom)), { units: 'kilometers' }))}`;
    return '';
  };
  const box = (a, b) => ({ type: 'Polygon', coordinates: [[a, [b[0], a[1]], b, [a[0], b[1]], a]] });
  const disc = (c, edge) => {
    const km = t ? t.distance(c, edge, { units: 'kilometers' }) : 0;
    return { km, geom: km > 0 && t ? t.circle(c, km, { steps: 72, units: 'kilometers' }).geometry : null };
  };
  const sketchGeom = () => {
    if (drag?.kind === 'rect' && drag.end) return box(drag.start, drag.end);
    if (drag?.kind === 'circle' && drag.end) return disc(drag.start, drag.end).geom;
    if (drag?.kind === 'free' && drag.pts.length > 1) return { type: 'LineString', coordinates: drag.pts };
    const pts = cursor ? [...sketch, cursor] : sketch;
    if (tool === 'line' && pts.length > 1) return { type: 'LineString', coordinates: pts };
    if (tool === 'area' && pts.length > 2) return { type: 'Polygon', coordinates: [[...pts, pts[0]]] };
    if (tool === 'area' && pts.length === 2) return { type: 'LineString', coordinates: pts };
    return null;
  };

  /* ----- Side panel ----- */
  const toolGrid = h('div', { class: 'draw-tools', role: 'toolbar', 'aria-label': 'Drawing tools' });
  const readout = h('div', { class: 'wb-readout' });
  const stylePanel = h('div', { class: 'draw-style' });
  const listBox = h('div', { class: 'sub-list draw-list' });
  const nameInput = h('input', { class: 'input', type: 'text', value: editing?.name || 'My drawing', oninput: () => { draft.name = nameInput.value || 'Drawing'; map?._legend.render(map); } });
  let cornerBtns;
  const saveBtn = h('button', { type: 'button', class: 'btn btn-brand btn-block', onclick: () => save() }, icon('plus', { size: 16 }), onSave ? (editing ? 'Save drawing' : 'Add to this map') : editing ? 'Save changes' : 'Save as a layer');
  const traceSelect = h('select', { onchange: (e) => { trace = e.target.value; setVisibleLayers(map, [trace, draft.id].filter(Boolean)); } },
    h('option', { value: '' }, 'Nothing'), (story.layers || []).filter((l) => l.id !== editing?.id).map((l) => h('option', { value: l.id }, l.name || 'Layer')));

  const update = () => { // shapes changed: redraw the preview layer and the panel
    draft.data = { type: 'FeatureCollection', features: shapes.map((f, i) => ({ ...f, properties: { ...f.properties, __i: i } })) };
    draft.style.label = showNames ? 'name' : undefined;
    if (map?.getSource(`dl-${draft.id}`)) {
      map.setLayoutProperty(`dl-${draft.id}-label`, 'visibility', showNames ? 'visible' : 'none');
      map.setLayoutProperty(`dl-${draft.id}-label`, 'text-field', ['to-string', ['get', 'name']]);
      reloadLayer(map, draft);
    }
    render();
  };

  const swatches = (value, onPick, { none } = {}) => h('div', { class: 'swatches' },
    none ? h('button', { type: 'button', class: `sw sw-none${!value ? ' is-on' : ''}`, title: none, 'aria-label': none, onclick: () => onPick('') }) : null,
    INK.map((c) => h('button', { type: 'button', class: `sw${value === c ? ' is-on' : ''}`, style: `--c:${c}`, title: c, 'aria-label': `Color ${c}`, onclick: () => onPick(c) })),
    h('label', { class: 'sw sw-custom', title: 'Any color' }, h('input', { type: 'color', value: value || st.color, 'aria-label': 'Any color', oninput: (e) => onPick(e.target.value) })));
  const slider = (label, value, { min, max, step = 1, fmt = String }, onSet) => {
    const out = h('span', { class: 'muted' }, fmt(value));
    return h('label', { class: 'field draw-range' }, h('span', { class: 'field-label' }, h('span', {}, label), out),
      h('input', { type: 'range', min, max, step, value, oninput: (e) => { out.textContent = fmt(+e.target.value); onSet(+e.target.value, false); }, onchange: (e) => onSet(+e.target.value, true) }));
  };
  const pct = (v) => `${Math.round(v * 100)}%`;

  // Changing a style sets it for the selected shape and for the next shapes you draw.
  const setStyle = (patch, full = true) => {
    st = { ...st, ...patch };
    const f = shapes[sel];
    if (f) {
      const kind = kindOf(f);
      const props = { ...f.properties, ...styleFor(kind, st) };
      Object.keys(props).forEach((k) => props[k] === undefined && delete props[k]);
      f.properties = props;
      if (full) update();
      else { draft.data.features[sel].properties = { ...props, __i: sel }; reloadLayer(map, draft); }
    }
    if (full) renderStyle();
  };

  const renderStyle = () => {
    const f = shapes[sel];
    const kind = f ? kindOf(f) : KIND_OF_TOOL[tool];
    if (!kind) { stylePanel.replaceChildren(h('p', { class: 'field-hint', style: 'margin:0' }, 'Select a shape to change how it looks, or pick a drawing tool.')); return; }
    const title = f ? `Style · ${f.properties.name || 'shape'}` : `Style for new ${kind === 'area' ? 'areas' : kind === 'text' ? 'text' : `${kind}s`}`;
    const rows = [h('div', { class: 'rail-section-title' }, title)];
    if (f && kind === 'text') {
      rows.push(h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Text'),
        h('textarea', { rows: 2, class: 'draw-text-input', value: f.properties.text, oninput: (e) => { f.properties.text = e.target.value || ' '; draft.data.features[sel].properties.text = f.properties.text; reloadLayer(map, draft); }, onchange: update })));
    }
    rows.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, kind === 'area' ? 'Outline color' : 'Color'), swatches(st.color, (c) => setStyle({ color: c }))));
    if (kind === 'area') {
      rows.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Fill color'), swatches(st.fill, (c) => setStyle({ fill: c }), { none: 'Same as the outline' })));
      rows.push(slider('Fill', st.fillOpacity, { min: 0, max: 1, step: 0.05, fmt: (v) => (v ? pct(v) : 'None') }, (v, full) => setStyle({ fillOpacity: v }, full)));
    }
    if (kind === 'line' || kind === 'area') {
      rows.push(slider('Line width', st.width, { min: 1, max: 14, step: 0.5, fmt: (v) => `${v}px` }, (v, full) => setStyle({ width: v }, full)));
      rows.push(slider('Line opacity', st.opacity, { min: 0.1, max: 1, step: 0.05, fmt: pct }, (v, full) => setStyle({ opacity: v }, full)));
      rows.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Line style'), seg([['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], st.dash, (v) => setStyle({ dash: v }))));
    }
    if (kind === 'line') rows.push(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.arrow, onchange: (e) => setStyle({ arrow: e.target.checked }) }), 'Arrowhead at the end'));
    if (kind === 'point') rows.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Size'), seg([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], st.size, (v) => setStyle({ size: v }))));
    if (kind === 'text') rows.push(slider('Text size', st.textSize, { min: 11, max: 56, fmt: (v) => `${v}px` }, (v, full) => setStyle({ textSize: v }, full)));
    if (f) {
      if (kind !== 'text') {
        rows.push(h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'),
          h('input', { class: 'input', type: 'text', value: f.properties.name || '', oninput: (e) => { f.properties.name = e.target.value; }, onchange: update })));
        rows.push(h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Description (shown when readers click it)'),
          h('textarea', { rows: 2, value: f.properties.description || '', oninput: (e) => { f.properties.description = e.target.value || undefined; } })));
      }
      rows.push(h('div', { class: 'row', style: 'margin-top:4px' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: duplicate }, icon('copy', { size: 14 }), 'Duplicate'),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => remove(sel) }, icon('trash', { size: 14 }), 'Delete')));
    }
    stylePanel.replaceChildren(...rows);
  };

  const render = () => {
    const g = sketchGeom();
    const f = shapes[sel];
    const overlay = [
      ...(g ? [{ type: 'Feature', properties: { sketch: true }, geometry: g }] : []),
      ...sketch.map((c) => ({ type: 'Feature', properties: { vertex: true }, geometry: { type: 'Point', coordinates: c } })),
      ...(f ? [{ type: 'Feature', properties: { sel: true, point: f.geometry.type === 'Point' }, geometry: f.geometry }] : []),
      ...(f ? corners(f.geometry).map((c) => ({ type: 'Feature', properties: { handle: true }, geometry: { type: 'Point', coordinates: c } })) : []),
    ];
    map?.getSource('wm-draw')?.setData({ type: 'FeatureCollection', features: overlay });
    const hint = DRAW_TOOLS.find(([k]) => k === tool)[3];
    const live = drag?.kind === 'circle' && drag.end ? `radius ${fmtDist(disc(drag.start, drag.end).km)}` : measure(g) || (f ? measure(f.geometry, f.properties) : '');
    readout.replaceChildren(...kidsOf(h('p', { class: 'field-hint', style: 'margin:0' }, sketch.length ? `${hint} Esc cancels.` : hint),
      live ? h('div', { class: 'wb-measure' }, icon('ruler', { size: 16 }), live) : null));
    toolGrid.replaceChildren(...DRAW_TOOLS.map(([k, label, ic]) => h('button', { type: 'button', class: tool === k ? 'is-on' : '', 'aria-pressed': tool === k ? 'true' : 'false', title: label,
      onclick: () => setTool(k) }, icon(ic, { size: 17 }), h('span', {}, label))));
    listBox.replaceChildren(...(shapes.length ? shapes.map((s, i) => {
      const kind = kindOf(s);
      const c = s.properties.fill || s.properties.stroke || s.properties['marker-color'] || st.color;
      return h('button', { type: 'button', class: `draw-item${i === sel ? ' is-on' : ''}`, onclick: () => select(i === sel ? -1 : i) },
        h('span', { class: 'draw-item-icon', style: `--c:${c}${/^#f{3}(f{3})?$/i.test(c) ? ';color:#111827' : ''}` }, icon(KIND_ICON[kind], { size: 14 })),
        h('span', { class: 'draw-item-name' }, kind === 'text' ? `“${s.properties.text}”` : s.properties.name || 'Shape'),
        h('span', { class: 'muted' }, kind === 'text' || kind === 'point' ? '' : measure(s.geometry, s.properties).split(' · ')[0]));
    }) : [h('p', { class: 'field-hint', style: 'margin:0' }, 'Nothing drawn yet.')]));
    saveBtn.disabled = !shapes.length;
    mapEl.classList.toggle('is-drawing', tool !== 'select');
    cornerBtns.hidden = tool !== 'line' && tool !== 'area';
  };

  const setTool = (k) => { tool = k; sketch = []; cursor = null; if (k !== 'select') sel = -1; render(); renderStyle(); };
  const select = (i) => {
    sel = i;
    if (shapes[i]) st = styleOf(shapes[i], st);
    render(); renderStyle();
    if (shapes[i] && kindOf(shapes[i]) === 'text') requestAnimationFrame(() => stylePanel.querySelector('.draw-text-input')?.select());
  };
  const remove = (i) => { shapes.splice(i, 1); sel = -1; update(); renderStyle(); };
  const duplicate = () => {
    const f = structuredClone(shapes[sel]);
    // nudge the copy a little to the right and down so it's visible
    const b = map.getBounds();
    const dx = (b.getEast() - b.getWest()) * 0.03, dy = (b.getNorth() - b.getSouth()) * -0.03;
    f.geometry = shiftGeom(f.geometry, dx, dy);
    if (f.properties.name) f.properties.name += ' copy';
    shapes.push(f);
    select(shapes.length - 1);
    update();
  };
  const count = (kind) => shapes.filter((s) => kindOf(s) === kind).length + 1;
  const add = (geometry, extra = {}) => {
    const kind = extra.text != null ? 'text' : geometry.type === 'Point' ? 'point' : geometry.type === 'LineString' ? 'line' : 'area';
    const props = { name: { point: 'Point', line: 'Line', area: 'Area', text: '' }[kind] + (kind === 'text' ? '' : ` ${count(kind)}`), ...extra, ...styleFor(kind, st) };
    if (t && kind === 'line') props.length_km = Math.round(t.length(t.feature(geometry), { units: 'kilometers' }) * 1000) / 1000;
    if (t && kind === 'area') props.area_km2 = Math.round((t.area(t.feature(geometry)) / 1e6) * 1000) / 1000;
    Object.keys(props).forEach((k) => (props[k] === undefined || props[k] === '') && delete props[k]);
    shapes.push({ type: 'Feature', properties: props, geometry });
    sel = shapes.length - 1;
    update();
    renderStyle();
  };
  const finish = () => {
    if ((tool === 'line' && sketch.length < 2) || (tool === 'area' && sketch.length < 3)) return;
    const geometry = tool === 'line' ? { type: 'LineString', coordinates: sketch } : { type: 'Polygon', coordinates: [[...sketch, sketch[0]]] };
    sketch = [];
    cursor = null;
    add(geometry);
  };

  const save = () => {
    if (!shapes.length) return;
    const data = { type: 'FeatureCollection', features: structuredClone(shapes) };
    const name = nameInput.value.trim() || 'My drawing';
    saved = JSON.stringify(shapes);
    dlg.close();
    if (editing) {
      Object.assign(editing, { name, data });
      editing.style = { ...(editing.style || {}), label: showNames ? 'name' : undefined };
      if (onSave) onSave(editing);
      else ctx.openLayer(editing.id);
      ctx.changed();
      toast('Drawing updated', { tone: 'ok' });
      return;
    }
    const layer = addLayer({ id: uid('l'), name, drawn: true, data, style: { color: st.color, opacity: 0.25, width: 3, radius: 7, label: showNames ? 'name' : undefined }, popup: { title: '{name}' } }, { open: !onSave });
    if (onSave) { onSave(layer); ctx.changed(); toast('Drawing added to this map', { tone: 'ok' }); }
    else toast('Drawing saved as a layer. Turn it on in any map.', { tone: 'ok' });
  };

  const side = h('div', { class: 'wb-side' },
    h('p', { class: 'wb-intro' }, 'Sketch points, lines, areas, boxes, circles and text, and style each one. Distances and areas are measured as you draw.'),
    toolGrid,
    readout,
    cornerBtns = h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { type: 'button', class: 'btn btn-sm', onclick: finish }, icon('check', { size: 14 }), 'Finish shape'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { sketch.pop(); render(); } }, icon('undo', { size: 14 }), 'Undo corner')),
    stylePanel,
    h('div', { class: 'rail-section-title' }, 'Shapes'),
    listBox,
    h('div', { class: 'rail-section-title' }, 'Layer'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Layer name'), nameInput),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: showNames, onchange: (e) => { showNames = e.target.checked; update(); } }), 'Show shape names on the map'),
    (story.layers || []).length ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Show another layer to trace over'), traceSelect) : null,
    h('div', { style: 'margin-top:12px' }, saveBtn));

  const { dlg, mapEl } = workspace({ title: here ? (editing ? `Draw on this map · ${editing.name}` : 'Draw on this map') : editing ? `Edit drawing · ${editing.name}` : 'Draw & measure', side, onClose: () => { map?.remove(); removeEventListener('keydown', onKey, true); removeEventListener('mouseup', onUp); } });
  const first = here || (story.blocks || []).map((b) => b.view || b.slides?.[0]?.media?.view).find(Boolean) || DEFAULT_VIEW;
  const others = (story.layers || []).filter((l) => l.id !== editing?.id);
  // Drawing on a particular map shows that map's other layers underneath, so shapes line up with them.
  const context = here ? (here.layers || []).filter((id) => id !== editing?.id && others.some((l) => l.id === id)) : [];
  map = createMap(mapEl, { ...first, markers: here?.markers || [], layers: [...context, draft.id] }, { library: [...others, draft] });
  map.scrollZoom.enable();
  map.doubleClickZoom.disable();
  if (editing && shapes.length && t && !here) map.once('load', () => {
    const b = t.bbox({ type: 'FeatureCollection', features: shapes });
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 15, duration: 0 });
  });
  const install = () => {
    if (map.getSource('wm-draw')) return;
    map.addSource('wm-draw', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'wm-draw-sel', type: 'line', source: 'wm-draw', filter: ['all', ['has', 'sel'], ['!=', ['geometry-type'], 'Point']], paint: { 'line-color': '#111827', 'line-width': 1.5, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'wm-draw-selpt', type: 'circle', source: 'wm-draw', filter: ['all', ['has', 'sel'], ['==', ['geometry-type'], 'Point']], paint: { 'circle-radius': 16, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#111827', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'wm-draw-sketch', type: 'line', source: 'wm-draw', filter: ['has', 'sketch'], paint: { 'line-color': st.color, 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'wm-draw-sketchfill', type: 'fill', source: 'wm-draw', filter: ['all', ['has', 'sketch'], ['==', ['geometry-type'], 'Polygon']], paint: { 'fill-color': st.color, 'fill-opacity': 0.12 } });
    map.addLayer({ id: 'wm-draw-handle', type: 'circle', source: 'wm-draw', filter: ['has', 'handle'], paint: { 'circle-color': '#fff', 'circle-radius': 4, 'circle-stroke-color': '#111827', 'circle-stroke-width': 1.5 } });
    map.addLayer({ id: 'wm-draw-vx', type: 'circle', source: 'wm-draw', filter: ['has', 'vertex'], paint: { 'circle-color': '#fff', 'circle-radius': 4.5, 'circle-stroke-color': '#111827', 'circle-stroke-width': 2 } });
    update();
  };
  whenStyled(map, install);

  const hitShape = (point) => {
    const ids = ['fill', 'line', 'dash', 'dot', 'circle', 'note', 'arrow'].map((k) => `dl-${draft.id}-${k}`).filter((id) => map.getLayer(id));
    const f = map.queryRenderedFeatures([[point.x - 4, point.y - 4], [point.x + 4, point.y + 4]], { layers: ids }).find((x) => x.properties.__i != null && !x.properties.__arrow);
    return f ? Number(f.properties.__i) : -1;
  };
  map.on('click', (e) => {
    if (drag?.moved) return;
    const c = ll(e);
    if (tool === 'select') return select(hitShape(e.point));
    if (tool === 'point') return add({ type: 'Point', coordinates: c });
    if (tool === 'text') { add({ type: 'Point', coordinates: c }, { text: 'Your text' }); return select(shapes.length - 1); }
    if (tool === 'line' || tool === 'area') { sketch.push(c); render(); }
  });
  map.on('dblclick', (e) => { e.preventDefault(); if (sketch.length) { sketch.pop(); finish(); } });
  map.on('mousedown', (e) => {
    if (e.originalEvent.button !== 0) return;
    if (DRAG_TOOLS.has(tool)) {
      drag = { kind: tool, start: ll(e), pts: [ll(e)] };
      map.dragPan.disable();
    } else if (tool === 'select') {
      const i = hitShape(e.point);
      if (i < 0 || i !== sel) return;
      drag = { kind: 'move', start: ll(e), geom: structuredClone(shapes[i].geometry) };
      map.dragPan.disable();
    }
  });
  map.on('mousemove', (e) => {
    if (drag) {
      const c = ll(e);
      drag.moved = true;
      if (drag.kind === 'free') { const last = drag.pts.at(-1); if (Math.abs(c[0] - last[0]) + Math.abs(c[1] - last[1]) > 0) drag.pts.push(c); }
      else if (drag.kind === 'move') {
        shapes[sel].geometry = shiftGeom(drag.geom, c[0] - drag.start[0], c[1] - drag.start[1]);
        draft.data.features[sel].geometry = shapes[sel].geometry;
        reloadLayer(map, draft);
      } else drag.end = c;
      render();
      return;
    }
    if ((tool === 'line' || tool === 'area') && sketch.length) { cursor = [e.lngLat.lng, e.lngLat.lat]; render(); }
  });
  const onUp = () => {
    if (!drag) return;
    const d = drag;
    map.dragPan.enable();
    setTimeout(() => { drag = null; }, 0); // let the click that follows mouseup see that this was a drag
    if (!d.moved) { drag = null; return; }
    drag = { moved: true };
    if (d.kind === 'free' && d.pts.length > 1) {
      // thin out the points: about one per screen pixel and a half at the current zoom
      const tol = (360 / (512 * 2 ** map.getZoom())) * 1.5;
      const line = t ? t.simplify(t.lineString(d.pts), { tolerance: tol, highQuality: true }).geometry : { type: 'LineString', coordinates: d.pts };
      add({ ...line, coordinates: line.coordinates.map(round6) });
    } else if (d.kind === 'rect' && d.end) add(box(d.start, d.end));
    else if (d.kind === 'circle' && d.end) {
      const { km, geom } = disc(d.start, d.end);
      if (geom) add({ ...geom, coordinates: [geom.coordinates[0].map(round6)] }, { radius_km: Math.round(km * 1000) / 1000 });
    } else if (d.kind === 'move') update();
    render();
  };
  addEventListener('mouseup', onUp);
  map.on('mouseout', () => { cursor = null; render(); });
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Enter') finish();
    if (e.key === 'Backspace' && sketch.length) { e.preventDefault(); sketch.pop(); render(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0) { e.preventDefault(); remove(sel); }
  };
  addEventListener('keydown', onKey, true);
  dlg.addEventListener('cancel', (e) => {
    if (sketch.length) { e.preventDefault(); sketch = []; render(); } else if (sel >= 0) { e.preventDefault(); select(-1); }
    else if (JSON.stringify(shapes) !== saved && !confirm('Close without saving your drawing?')) e.preventDefault();
  });
  render();
  renderStyle();
}

// Corner handles shown on the selected shape (circles and freehand lines get a sample, not every point).
function corners(g) {
  if (g.type === 'Point') return [];
  const rings = g.type === 'LineString' ? [g.coordinates] : g.type === 'Polygon' ? [g.coordinates[0].slice(0, -1)] : [];
  return rings.flatMap((r) => (r.length > 24 ? r.filter((_, i) => i % Math.ceil(r.length / 12) === 0) : r));
}

function shiftGeom(g, dx, dy) {
  const mv = (c) => (typeof c[0] === 'number' ? [Math.round((c[0] + dx) * 1e6) / 1e6, Math.round((c[1] + dy) * 1e6) / 1e6] : c.map(mv));
  return { ...g, coordinates: mv(g.coordinates) };
}

/* ---------- Insights ---------- */

const bars = (values) => {
  if (!values?.length) return null;
  const min = values[0];
  const max = values.at(-1);
  const bins = new Array(16).fill(0);
  values.forEach((v) => { bins[max === min ? 0 : Math.min(15, Math.floor(((v - min) / (max - min)) * 16))]++; });
  const top = Math.max(...bins);
  return h('svg', { class: 'spark', viewBox: '0 0 160 28', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
    bins.map((b, i) => h('rect', { x: i * 10 + 1, y: 28 - (b / top) * 26, width: 8, height: Math.max(1, (b / top) * 26), rx: 1.5 })));
};

/** The "Insights" panel for a layer: size, field summaries, and a shortcut to story numbers. */
export function insightsPanel(layer, data) {
  const s = layerStats(data);
  const tiles = [['Features', s.count.toLocaleString()]];
  if (s.areaKm2 > 0) tiles.push(['Total area', fmtArea(s.areaKm2).split(' · ')[0]]);
  if (s.lengthKm > 0) tiles.push(['Total length', fmtDist(s.lengthKm).split(' · ')[0]]);
  const numeric = s.fields.filter((f) => f.kind === 'number').slice(0, 6);
  const text = s.fields.filter((f) => f.kind === 'text' && f.distinct > 1 && f.distinct < s.count).slice(0, 3);
  const toStory = () => {
    const items = [{ value: s.count.toLocaleString(), label: `${layer.name}` }];
    if (s.areaKm2 > 0) items.push({ value: `${fmtNum(s.areaKm2)} km²`, label: 'total area' });
    if (s.lengthKm > 0) items.push({ value: `${fmtNum(s.lengthKm)} km`, label: 'total length' });
    if (numeric[0]) items.push({ value: /year|yr$|date/i.test(numeric[0].name) ? String(Math.round(numeric[0].mean)) : fmtNum(numeric[0].mean), label: `average ${numeric[0].name}` });
    ctx.insertBlock({ type: 'stats', items: items.slice(0, 4), caption: `Source: ${layer.name}` });
  };
  return h('div', { class: 'insights' },
    h('div', { class: 'ins-tiles' }, tiles.map(([k, v]) => h('div', { class: 'ins-tile' }, h('span', {}, k), h('strong', {}, v)))),
    numeric.map((f) => {
      // Epoch-millisecond timestamps (e.g. earthquake times) read better as dates.
      const epoch = f.min > 1e11 && f.max < 4e12;
      const fmt = epoch ? (v) => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: f.max - f.min > 3e10 ? 'numeric' : undefined })
        : /year|yr$|date/i.test(f.name) ? (v) => String(Math.round(v)) : fmtNum;
      return h('div', { class: 'ins-field' },
      h('div', { class: 'ins-field-head' }, h('strong', {}, f.name), h('span', { class: 'muted' }, epoch ? `${fmt(f.min)} – ${fmt(f.max)}` : `avg ${fmt(f.mean)}`)),
      bars(f.values),
      h('div', { class: 'ins-range' }, h('span', {}, fmt(f.min)), h('span', {}, fmt(f.max)))); }),
    text.map((f) => h('div', { class: 'ins-field' },
      h('div', { class: 'ins-field-head' }, h('strong', {}, f.name), h('span', { class: 'muted' }, `${f.distinct.toLocaleString()} values`)),
      h('div', { class: 'ins-top' }, f.top.map(([v, c]) => h('div', {}, h('span', {}, v), h('span', { class: 'muted' }, c.toLocaleString())))))),
    h('div', { class: 'row row-wrap', style: 'margin-top:12px' },
      h('button', { type: 'button', class: 'btn btn-sm', onclick: toStory }, icon('sliders', { size: 14 }), 'Add as big numbers'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openAnalysis({ layerId: layer.id }) }, icon('sparkle', { size: 14 }), 'Analyze')));
}
