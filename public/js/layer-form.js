// Settings for one data layer (source, filters, insights, style, labels, visible range, popup). Shared by the story
// editor's Data tab and the saved-map editor, which pass in how to save and redraw.
import { h, icon, toast } from './ui.js';
import { loadLayerData, fieldNames, colorRamp, FILTER_OPS, filterData, activeFilters } from './maps.js';
import { layerStats, TOOLS, kinds } from './analysis.js';
import { csvToGeoJSON } from './csv.js';
import { openDraw, rerunAnalysis, insightsPanel } from './workbench.js';
import { openAttributeTableDialog, isHostedLayer, publishLayerAsHosted, saveHostedLayer } from './table.js';

/**
 * ctx: { doc() → the story or saved map whose .layers these are, changed(), rerender(), onInfo(layer)?, noun? }
 * Returns { layerForm, inspectLayer, layerStatus, layerInfo }.
 */
export function layerEditor({ doc, changed, rerender, onInfo, noun = 'story' }) {
  const renderRail = rerender;
  const layerInfo = {};

  const labelEl = (text, extra) => (text ? h('span', { class: 'field-label' }, h('span', {}, text), extra) : null);
  // The few field types layer settings need, with the same markup as the rest of the editor.
  function field(obj, spec) {
    const set = (v) => { obj[spec.k] = v; changed(); };
    const val = obj[spec.k] ?? spec.dflt ?? '';
    const hint = spec.hint ? h('p', { class: 'field-hint' }, spec.hint) : null;
    switch (spec.t) {
      case 'number': return h('label', { class: 'field' }, labelEl(spec.label), h('input', { type: 'number', step: '0.5', value: val, placeholder: spec.placeholder, oninput: (e) => set(e.target.value === '' ? undefined : +e.target.value) }), hint);
      case 'seg': {
        const seg = h('div', { class: 'seg seg-block', role: 'group' }, spec.opts.map(([v, l]) => h('button', { type: 'button', class: String(val) === v ? 'is-on' : '',
          onclick: (e) => { set(v); seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b === e.currentTarget)); if (spec.k === 'display' || spec.k === 'mode') renderRail(); } }, l)));
        return h('div', { class: 'field' }, labelEl(spec.label), seg, hint);
      }
      case 'color': return h('label', { class: 'field' }, labelEl(spec.label),
        h('span', { class: 'row' }, h('input', { type: 'color', value: val || '#000000', oninput: (e) => { set(e.target.value); e.target.nextSibling.textContent = e.target.value; } }), h('span', { class: 'muted' }, val)), hint);
      default: return h('label', { class: 'field' }, labelEl(spec.label), h('input', { type: 'text', value: val, placeholder: spec.placeholder, oninput: (e) => set(e.target.value) }), hint);
    }
  }

  const layerStatus = (l) => {
    if (l.type === 'raster') return 'Imagery';
    const prefix = isHostedLayer(l) ? 'Hosted · ' : '';
    const i = layerInfo[l.id] || {};
    if (i.count != null && activeFilters(l).length) return `${prefix}${i.shown.toLocaleString()} of ${i.count.toLocaleString()} features`;
    return i.loading ? 'Loading…' : i.error ? 'Could not load' : i.count != null ? `${prefix}${i.count.toLocaleString()} ${i.count === 1 ? 'feature' : 'features'}` : 'No data yet';
  };
  const sourceKey = (l) => (l.data ? `data:${l.data.features?.length}` : `url:${l.url || ''}`);

  function inspectLayer(layer) {
    const key = sourceKey(layer);
    if (layerInfo[layer.id]?.key === key) return;
    if (!layer.data && !layer.url) { layerInfo[layer.id] = { key }; return; }
    layerInfo[layer.id] = { key, loading: true };
    const done = (info) => { if (layerInfo[layer.id]?.key === key) { layerInfo[layer.id] = { key, ...info }; onInfo?.(layer); } };
    loadLayerData(layer).then((fc) => {
      if (!layer.attribution && fc.metadata?.attribution) layer.attribution = fc.metadata.attribution;
      done({ count: fc.features.length, shown: filterData(layer, fc).features.length, fields: fieldNames(fc), fc });
    }).catch((err) => done({ error: err.message }));
  }

  function rasterForm(layer) {
    layer.style ||= {};
    return h('div', {},
      field(layer, { k: 'name', label: 'Name (shown in the legend)' }),
      field(layer, { k: 'attribution', label: 'Attribution / Source credits (shown in legend)', placeholder: 'e.g. NASA GIBS, USGS' }),
      h('p', { class: 'field-hint' }, 'An imagery layer: a picture of the map rather than individual features, so it can be shown but not filtered or analyzed.'),
      field(layer.style, { k: 'opacity', t: 'number', label: 'Opacity (0 to 1)', dflt: 0.85 }),
      /\{date\}/.test(layer.tiles || '') ? h('label', { class: 'field' }, labelEl('Date of the imagery'),
        h('input', { type: 'date', value: layer.date || '', max: new Date().toISOString().slice(0, 10), onchange: (e) => { layer.date = e.target.value || undefined; changed(); } }),
        h('p', { class: 'field-hint' }, 'Leave blank to always show yesterday\'s image.')) : null);
  }

  function filtersField(layer, info) {
    const rules = (layer.filters ||= []);
    const stats = info.fc ? layerStats(info.fc) : { fields: [] };
    const statFor = (name) => stats.fields.find((f) => f.name === name);
    const count = h('span', { class: 'pill no-dot' });
    const update = () => {
      if (!info.fc) return;
      const shown = filterData(layer, info.fc).features.length;
      info.shown = shown;
      count.textContent = activeFilters(layer).length ? `Showing ${shown.toLocaleString()} of ${info.fc.features.length.toLocaleString()}` : `All ${info.fc.features.length.toLocaleString()} features`;
      count.className = `pill no-dot ${activeFilters(layer).length ? 'is-live' : ''}`;
    };
    const rows = rules.map((r, i) => {
      const st = statFor(r.field);
      const listId = `vals-${layer.id}-${i}`;
      const value = /empty/.test(r.op) ? null : h('input', { class: 'input', type: r.op === 'in the last (days)' ? 'number' : 'text', min: 0, value: r.value ?? '', list: st?.kind === 'text' ? listId : null,
        placeholder: r.op === 'in the last (days)' ? 'days' : st?.kind === 'number' ? `${Math.round(st.min)} to ${Math.round(st.max)}` : 'value',
        oninput: (e) => { r.value = e.target.value; update(); changed(); }, onchange: () => renderRail() });
      return h('div', { class: 'filter-row' },
        h('select', { 'aria-label': 'Field', onchange: (e) => { r.field = e.target.value; changed(); renderRail(); } },
          h('option', { value: '' }, 'Field…'), (info.fields || []).map((f) => h('option', { value: f, selected: r.field === f }, f))),
        h('select', { 'aria-label': 'Rule', onchange: (e) => { r.op = e.target.value; changed(); renderRail(); } },
          FILTER_OPS.map((o) => h('option', { value: o, selected: (r.op || '=') === o }, o))),
        value,
        st?.kind === 'text' ? h('datalist', { id: listId }, st.top.map(([v]) => h('option', { value: v }))) : null,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove filter', onclick: () => { rules.splice(i, 1); changed(); renderRail(); } }, icon('x', { size: 15 })));
    });
    const el = h('div', { class: 'filters' },
      rules.length > 1 ? h('div', { class: 'row', style: 'margin-bottom:8px' }, h('span', { class: 'muted', style: 'font-size:12.5px' }, 'Show features that match'),
        h('div', { class: 'seg' }, [['all', 'all rules'], ['any', 'any rule']].map(([v, l]) => h('button', { type: 'button', class: (layer.filterMatch || 'all') === v ? 'is-on' : '',
          onclick: () => { layer.filterMatch = v; changed(); renderRail(); } }, l)))) : null,
      rows,
      h('div', { class: 'row', style: 'margin-top:8px' },
        h('button', { type: 'button', class: 'btn btn-sm', disabled: !info.fields?.length, onclick: () => { rules.push({ field: '', op: '=', value: '' }); renderRail(); } }, icon('plus', { size: 14 }), 'Add filter'),
        h('span', { class: 'spacer' }), count),
      h('p', { class: 'field-hint' }, 'Filters change what every map, analysis and export uses. Try a rule like magnitude ≥ 5, or a date field "in the last (days)" 7.'));
    update();
    return el;
  }

  function layerForm(layer) {
    if (layer.type === 'raster') return rasterForm(layer);
    layer.style ||= {};
    layer.popup ||= {};
    const st = layer.style;
    const info = layerInfo[layer.id] || {};
    const flds = info.fields || [];
    const hosted = isHostedLayer(layer);
    const fieldSelect = (obj, k, label, empty = 'None') => h('label', { class: 'field' }, labelEl(label),
      h('select', { onchange: (e) => { obj[k] = e.target.value || undefined; changed(); renderRail(); } },
        h('option', { value: '' }, empty), flds.map((f) => h('option', { value: f, selected: obj[k] === f }, f))));
    const fileInput = h('input', { type: 'file', accept: '.geojson,.json,.csv,application/json,text/csv', hidden: true, onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const fc = /\.csv$/i.test(file.name) ? csvToGeoJSON(text) : JSON.parse(text);
        if (fc.type !== 'FeatureCollection') throw new Error('Expected a GeoJSON FeatureCollection');
        layer.data = fc;
        delete layer.url;
        delete layer.hostedLayerId;
        if (layer.name === 'New layer') layer.name = file.name.replace(/\.\w+$/, '');
        const kb = Math.round(JSON.stringify(fc).length / 1024);
        if (kb > 3000) toast(`That file is ${kb.toLocaleString()} KB. Large files make stories slow; hosting it and using a link is better.`, { duration: 7000 });
        delete layerInfo[layer.id];
        changed(); renderRail();
      } catch (err) { toast(`Could not read file: ${err.message}`, { tone: 'error' }); }
    } });
    const cats = st.mode === 'categorical' && st.field && info.fc ? colorRamp(layer, info.fc).legend.entries.filter(([v]) => v !== 'Other') : [];
    const status = info.loading ? h('span', { class: 'pill' }, 'Loading…') : info.error ? h('span', { class: 'pill is-error' }, info.error)
      : info.count != null ? h('span', { class: 'pill is-live' }, `${hosted ? 'Hosted GeoJSON · ' : ''}${info.count.toLocaleString()} features · ${flds.length} fields`) : null;

    const isPoints = info.fc ? kinds(info.fc).has('point') : false;
    const a = layer.analysis;
    const inputNames = a ? Object.values(a.inputs).map((id) => (doc().layers || []).find((l) => l.id === id)?.name || 'a deleted layer').join(' and ') : '';
    return h('div', {},
      hosted ? h('div', { class: 'provenance' }, icon('database', { size: 15 }),
        h('span', {}, 'Hosted Feature Layer (GeoJSON)'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openAttributeTableDialog(layer, { onChange: () => { delete layerInfo[layer.id]; changed(); renderRail(); } }) }, icon('list', { size: 14 }), 'Edit table'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openDraw({ layer }) }, icon('pen', { size: 14 }), 'Edit shapes')) : null,
      a ? h('div', { class: 'provenance' }, icon('sparkle', { size: 15 }),
        h('span', {}, `${TOOLS[a.tool]?.name || 'Analysis'} of ${inputNames}`),
        h('button', { type: 'button', class: 'btn btn-sm', title: 'Run the analysis again with the latest data', onclick: () => rerunAnalysis(layer) }, icon('refresh', { size: 14 }), 'Re-run')) : null,
      !a && !hosted && layer.data?.features?.length <= 2000 ? h('div', { class: 'provenance' }, icon('pen', { size: 15 }),
        h('span', {}, layer.drawn ? 'Drawn on the map' : `Shapes stored in this ${noun}`),
        h('button', { type: 'button', class: 'btn btn-sm', title: 'Draw, move, restyle or delete shapes in this layer', onclick: () => openDraw({ layer }) }, icon('pen', { size: 14 }), 'Edit shapes')) : null,
      field(layer, { k: 'name', label: 'Name (shown in the legend)' }),
      h('label', { class: 'field' }, labelEl('Attribution / Credits (shown in legend)'),
        h('input', {
          class: 'input',
          type: 'text',
          value: layer.attribution || '',
          placeholder: 'e.g. City GIS, US Census 2026, Field Survey',
          oninput: (e) => { layer.attribution = e.target.value; changed(); },
          onchange: () => { if (hosted && info.fc) saveHostedLayer(layer, info.fc, { attribution: layer.attribution }).catch(() => {}); },
        })),
      a || layer.catalog || hosted ? (status ? h('div', { style: 'margin:4px 0 8px' }, status) : null) : h('div', { class: 'field' }, labelEl('Data'),
        h('div', { class: 'row' },
          h('input', { class: 'input', type: 'text', value: layer.data ? '' : layer.url || '', placeholder: layer.data ? `Uploaded file (${layer.data.features.length} features)` : 'Paste a GeoJSON or ArcGIS layer link',
            onchange: (e) => { layer.url = e.target.value.trim(); delete layer.data; delete layerInfo[layer.id]; changed(); renderRail(); } }),
          h('button', { type: 'button', class: 'btn', title: 'Upload GeoJSON or CSV', onclick: () => fileInput.click() }, icon('upload', { size: 15 }), 'File'), fileInput),
        h('p', { class: 'field-hint' }, 'GeoJSON link, public ArcGIS FeatureServer layer, or a .geojson / .csv file (CSV needs lat and lon columns).'),
        status ? h('div', { style: 'margin-top:8px' }, status) : null),
      h('div', { class: 'row row-wrap', style: 'margin:8px 0 4px;gap:6px' },
        h('button', {
          type: 'button',
          class: 'btn btn-sm',
          onclick: () => openAttributeTableDialog(layer, { onChange: () => { delete layerInfo[layer.id]; changed(); renderRail(); } }),
        }, icon('list', { size: 14 }), 'Attribute table & schema'),
        !hosted && info.fc ? h('button', {
          type: 'button',
          class: 'btn btn-sm',
          title: 'Save as a reusable Hosted Feature Layer on the server with editable attributes',
          onclick: async () => {
            try {
              await publishLayerAsHosted(layer);
              delete layerInfo[layer.id];
              changed();
              renderRail();
              toast(`Published "${layer.name}" as a Hosted Feature Layer`, { tone: 'ok' });
            } catch (err) { toast(err.message, { tone: 'error' }); }
          },
        }, icon('database', { size: 14 }), 'Publish as Hosted Layer') : null),
      info.fc ? [h('div', { class: 'rail-section-title' }, 'Filters'), filtersField(layer, info)] : null,
      info.fc ? [h('div', { class: 'rail-section-title' }, activeFilters(layer).length ? 'Insights (filtered)' : 'Insights'), insightsPanel(layer, filterData(layer, info.fc))] : null,
      h('div', { class: 'rail-section-title' }, 'Style'),
      isPoints ? field(st, { k: 'display', t: 'seg', label: 'Show points as', opts: [['features', 'Dots'], ['heatmap', 'Heatmap'], ['clusters', 'Clusters']], dflt: 'features' }) : null,
      isPoints && st.display === 'heatmap' ? fieldSelect(st, 'weight', 'Weight the heat by (optional)', 'Each point counts the same') : null,
      field(st, { k: 'mode', t: 'seg', label: 'Color', opts: [['single', 'One color'], ['categorical', 'By category'], ['graduated', 'By number']], dflt: 'single' }),
      h('div', { class: 'grid-2' },
        field(st, { k: 'color', t: 'color', label: st.mode === 'categorical' ? 'Other values' : st.mode === 'graduated' ? 'Highest values' : 'Color', dflt: '#2563eb' }),
        st.mode && st.mode !== 'single' ? fieldSelect(st, 'field', 'Based on field', 'Choose…') : h('span')),
      cats.length ? h('div', { class: 'field' }, labelEl('Category colors'), h('div', { class: 'cats' }, cats.map(([v, c]) => h('label', {},
        h('input', { type: 'color', value: c, oninput: (e) => { (st.colors ||= {})[v] = e.target.value; changed(); } }), v)))) : null,
      h('div', { class: 'grid-3' },
        field(st, { k: 'opacity', t: 'number', label: 'Fill opacity' }),
        field(st, { k: 'radius', t: 'number', label: 'Point size' }),
        field(st, { k: 'width', t: 'number', label: 'Line width' })),
      h('div', { class: 'rail-section-title' }, 'Size'),
      sizeField(st, info),
      h('div', { class: 'rail-section-title' }, 'Time'),
      timeField(layer, info),
      h('div', { class: 'rail-section-title' }, 'Labels and visibility'),
      fieldSelect(st, 'label', 'Show labels from'),
      h('div', { class: 'grid-2' },
        field(st, { k: 'minzoom', t: 'number', label: 'Visible from zoom', placeholder: '0' }),
        field(st, { k: 'maxzoom', t: 'number', label: 'Up to zoom', placeholder: '24' })),
      h('p', { class: 'field-hint', style: 'margin-top:-6px' }, 'Hide the layer when readers zoom far out or far in. Leave blank to always show it.'),
      h('div', { class: 'rail-section-title' }, 'Popup'),
      field(layer.popup, { k: 'title', label: 'Popup title', placeholder: flds[0] ? `{${flds[0]}}` : '{name}', hint: 'Put field names in braces, like {NAME}.' }),
      h('label', { class: 'field' }, labelEl('Fields to list'),
        h('input', { type: 'text', value: (layer.popup.fields || []).join(', '), placeholder: flds.slice(0, 4).join(', ') || 'Leave blank to show the first few',
          oninput: (e) => { layer.popup.fields = e.target.value.split(',').map((f) => f.trim()).filter(Boolean); changed(); } })));
  }

  // Proportional symbols: size points (circle area), areas (a circle at the center) or lines (width) by a number.
  function sizeField(st, info) {
    const stats = info.fc ? layerStats(info.fc) : { fields: [] };
    const nums = stats.fields.filter((f) => f.kind === 'number').map((f) => f.name);
    const lines = info.fc ? kinds(info.fc).size === 1 && kinds(info.fc).has('line') : false;
    return h('div', {},
      h('label', { class: 'field' }, labelEl('Size by number'),
        h('select', { onchange: (e) => { st.sizeField = e.target.value || undefined; changed(); renderRail(); } },
          h('option', { value: '' }, 'Same size for all'), nums.map((f) => h('option', { value: f, selected: st.sizeField === f }, f)))),
      st.sizeField ? h('div', { class: 'grid-2' },
        field(st, { k: 'sizeMin', t: 'number', label: lines ? 'Thinnest (px)' : 'Smallest (px)', placeholder: lines ? '1' : '4' }),
        field(st, { k: 'sizeMax', t: 'number', label: lines ? 'Widest (px)' : 'Largest (px)', placeholder: lines ? '10' : '28' })) : null,
      h('p', { class: 'field-hint' }, st.sizeField ? (lines ? 'Lines get wider as the value grows.' : 'Circle area grows with the value, so twice the value looks twice as big. Areas get a circle at their center. Works together with color.')
        : nums.length ? 'Proportional symbols: bigger circles (or wider lines) for bigger values.' : 'This layer has no number fields to size by.'));
  }

  // A time field adds a time slider to every map that shows this layer, in the editor and in stories.
  function timeField(layer, info) {
    const flds = info.fields || [];
    const sample = info.fc?.features?.slice(0, 50) || [];
    const looksLikeTime = (f) => /time|date|when|year|day|updated|created|start|end/i.test(f)
      || sample.some((ft) => { const v = ft.properties?.[f]; return (typeof v === 'number' && v > 1e11 && v < 4e12) || (typeof v === 'string' && /^\d{4}-\d\d-\d\d/.test(v)); });
    const ordered = [...flds.filter(looksLikeTime), ...flds.filter((f) => !looksLikeTime(f))];
    return h('div', {},
      h('label', { class: 'field' }, labelEl('Time field'),
        h('select', { onchange: (e) => { if (e.target.value) layer.time = { field: e.target.value }; else delete layer.time; changed(); renderRail(); } },
          h('option', { value: '' }, 'No time slider'), ordered.map((f) => h('option', { value: f, selected: layer.time?.field === f }, looksLikeTime(f) ? `${f} (looks like a date)` : f)))),
      h('p', { class: 'field-hint' }, layer.time?.field ? 'Maps showing this layer get a time slider with play. Readers can scrub through it; bookmarks and story cards remember where it was set.'
        : 'Pick a date or time field to add a time slider with play to maps showing this layer.'));
  }

  return { layerForm, inspectLayer, layerStatus, layerInfo };
}
