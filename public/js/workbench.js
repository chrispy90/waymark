// Data workspaces for the editor: Add data, Analyze (with live map preview), and Draw & measure.
import { h, icon, dialog, toast } from './ui.js';
import { createMap, setVisibleLayers, loadLayerData, layerFeatures, bbox, DEFAULT_VIEW } from './maps.js';
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
        option('pen', 'Draw on the map', 'Sketch points, routes or areas yourself', () => { dlg.close(); openDraw(); }),
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

export function openDraw() {
  const t = window.turf;
  let mode = 'point';
  const done = []; // finished features
  let sketch = []; // coordinates of the shape being drawn
  let cursor = null;
  let map;

  const readout = h('div', { class: 'wb-readout' });
  const listBox = h('div', { class: 'sub-list' });
  const saveBtn = h('button', { type: 'button', class: 'btn btn-brand btn-block', disabled: true, onclick: () => save() }, icon('plus', { size: 16 }), 'Save as a layer');
  const nameInput = h('input', { class: 'input', type: 'text', value: 'My drawing' });
  const modeSeg = h('div', { class: 'seg seg-block' });

  const measure = (geom) => {
    if (!t) return '';
    if (geom.type === 'LineString' && geom.coordinates.length > 1) return fmtDist(t.length(t.feature(geom), { units: 'kilometers' }));
    if (geom.type === 'Polygon' && geom.coordinates[0].length > 3) return `${fmtArea(t.area(t.feature(geom)) / 1e6)} · edge ${fmtDist(t.length(t.polygonToLine(t.feature(geom)), { units: 'kilometers' }))}`;
    return '';
  };
  const sketchGeom = () => {
    const pts = cursor ? [...sketch, cursor] : sketch;
    if (mode === 'line' && pts.length > 1) return { type: 'LineString', coordinates: pts };
    if (mode === 'area' && pts.length > 2) return { type: 'Polygon', coordinates: [[...pts, pts[0]]] };
    if (mode === 'area' && pts.length === 2) return { type: 'LineString', coordinates: pts };
    return null;
  };

  const render = () => {
    const g = sketchGeom();
    const feats = [...done.map((f) => f), ...(g ? [{ type: 'Feature', properties: { sketch: true }, geometry: g }] : []),
      ...sketch.map((c) => ({ type: 'Feature', properties: { vertex: true }, geometry: { type: 'Point', coordinates: c } }))];
    map?.getSource('wm-draw')?.setData({ type: 'FeatureCollection', features: feats });
    const hint = mode === 'point' ? 'Click the map to drop a point.'
      : sketch.length === 0 ? `Click to start the ${mode === 'line' ? 'route' : 'area'}.`
        : `Keep clicking to add corners. Double-click or press Enter to finish${mode === 'area' ? ' the area' : ''}. Esc cancels.`;
    readout.replaceChildren(...kidsOf(h('p', { class: 'field-hint', style: 'margin:0' }, hint), g ? h('div', { class: 'wb-measure' }, icon('ruler', { size: 16 }), measure(g)) : null));
    listBox.replaceChildren(...done.map((f, i) => h('div', { class: 'sub' }, h('div', { class: 'sub-head' },
      icon(f.geometry.type === 'Point' ? 'pin' : f.geometry.type === 'LineString' ? 'line' : 'polygon', { size: 15 }),
      h('input', { class: 'input', style: 'height:30px', type: 'text', value: f.properties.name, oninput: (e) => { f.properties.name = e.target.value; } }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete shape', onclick: () => { done.splice(i, 1); render(); } }, icon('trash', { size: 15 }))),
    f.geometry.type !== 'Point' ? h('div', { class: 'sub-body muted', style: 'font-size:12.5px' }, measure(f.geometry)) : null)));
    saveBtn.disabled = !done.length;
    modeSeg.replaceChildren(...[['point', 'Point', 'pin'], ['line', 'Route', 'line'], ['area', 'Area', 'polygon']].map(([v, l, ic]) =>
      h('button', { type: 'button', class: mode === v ? 'is-on' : '', onclick: () => { mode = v; sketch = []; render(); } }, icon(ic, { size: 15 }), l)));
  };

  const finish = () => {
    const pts = sketch;
    if ((mode === 'line' && pts.length < 2) || (mode === 'area' && pts.length < 3)) return;
    const geometry = mode === 'line' ? { type: 'LineString', coordinates: pts } : { type: 'Polygon', coordinates: [[...pts, pts[0]]] };
    const props = { name: `${mode === 'line' ? 'Route' : 'Area'} ${done.length + 1}` };
    if (t) {
      if (mode === 'line') props.length_km = Math.round(t.length(t.feature(geometry), { units: 'kilometers' }) * 1000) / 1000;
      else props.area_km2 = Math.round((t.area(t.feature(geometry)) / 1e6) * 1000) / 1000;
    }
    done.push({ type: 'Feature', properties: props, geometry });
    sketch = [];
    render();
  };

  const save = () => {
    if (!done.length) return;
    dlg.close();
    addLayer({ id: uid('l'), name: nameInput.value.trim() || 'My drawing', data: { type: 'FeatureCollection', features: done },
      style: { color: RESULT, opacity: 0.22, width: 3, radius: 7, label: 'name' }, popup: { title: '{name}' } });
    toast('Drawing saved as a layer', { tone: 'ok' });
  };

  const side = h('div', { class: 'wb-side' },
    h('p', { class: 'wb-intro' }, 'Sketch your own points, routes and areas. Distances and areas are measured as you draw.'),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Draw a'), modeSeg),
    readout,
    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { type: 'button', class: 'btn btn-sm', onclick: finish }, icon('check', { size: 14 }), 'Finish shape'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { sketch.pop(); render(); } }, icon('undo', { size: 14 }), 'Undo point')),
    h('div', { class: 'rail-section-title' }, 'Shapes'),
    listBox,
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Layer name'), nameInput),
    h('div', { style: 'margin-top:12px' }, saveBtn));

  const { dlg, mapEl } = workspace({ title: 'Draw & measure', side, onClose: () => { map?.remove(); removeEventListener('keydown', onKey); } });
  const story = ctx.story();
  const first = (story.blocks || []).map((b) => b.view || b.slides?.[0]?.media?.view).find(Boolean) || DEFAULT_VIEW;
  map = createMap(mapEl, { ...first, markers: [], layers: [] }, { library: story.layers || [] });
  map.scrollZoom.enable();
  map.doubleClickZoom.disable();
  map.getCanvas().style.cursor = 'crosshair';
  const install = () => {
    if (map.getSource('wm-draw')) return;
    map.addSource('wm-draw', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'wm-draw-fill', type: 'fill', source: 'wm-draw', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': RESULT, 'fill-opacity': 0.2 } });
    map.addLayer({ id: 'wm-draw-line', type: 'line', source: 'wm-draw', filter: ['all', ['!', ['has', 'sketch']], ['in', ['geometry-type'], ['literal', ['Polygon', 'LineString']]]], paint: { 'line-color': RESULT, 'line-width': 3 } });
    map.addLayer({ id: 'wm-draw-sketch', type: 'line', source: 'wm-draw', filter: ['has', 'sketch'], paint: { 'line-color': RESULT, 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'wm-draw-pt', type: 'circle', source: 'wm-draw', filter: ['all', ['==', ['geometry-type'], 'Point'], ['!', ['has', 'vertex']]], paint: { 'circle-color': RESULT, 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
    map.addLayer({ id: 'wm-draw-vx', type: 'circle', source: 'wm-draw', filter: ['has', 'vertex'], paint: { 'circle-color': '#fff', 'circle-radius': 4.5, 'circle-stroke-color': RESULT, 'circle-stroke-width': 2 } });
    render();
  };
  whenStyled(map, install);
  map.on('click', (e) => {
    const c = [Math.round(e.lngLat.lng * 1e6) / 1e6, Math.round(e.lngLat.lat * 1e6) / 1e6];
    if (mode === 'point') done.push({ type: 'Feature', properties: { name: `Point ${done.filter((f) => f.geometry.type === 'Point').length + 1}` }, geometry: { type: 'Point', coordinates: c } });
    else sketch.push(c);
    render();
  });
  map.on('dblclick', (e) => { e.preventDefault(); if (sketch.length) { sketch.pop(); finish(); } });
  map.on('mousemove', (e) => { if (mode !== 'point' && sketch.length) { cursor = [e.lngLat.lng, e.lngLat.lat]; render(); } });
  map.on('mouseout', () => { cursor = null; render(); });
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === 'Enter') finish();
    if (e.key === 'Backspace' && sketch.length) { sketch.pop(); render(); }
  };
  addEventListener('keydown', onKey, true);
  dlg.addEventListener('cancel', (e) => { if (sketch.length) { e.preventDefault(); sketch = []; render(); } });
  render();
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
