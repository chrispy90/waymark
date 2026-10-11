// Story builder: form-based editor on the left, live preview iframe on the right.
import { BASEMAPS, DEFAULT_VIEW, createMap, readView, setMarkers } from './maps.js';
import { sanitize } from './sanitize.js';
import { getLocalStory, saveLocalStory, listLocalStories, newId } from './store.js';

const $ = (sel, el = document) => el.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const view = (v = {}) => ({ ...clone(DEFAULT_VIEW), ...v });

/* ---------- Block catalogue ---------- */

const BASEMAP_OPTS = Object.entries(BASEMAPS).map(([value, b]) => [value, b.label]);
const SIZE_OPTS = [['small', 'Small'], ['standard', 'Standard'], ['wide', 'Wide'], ['full', 'Full width']];

const CATALOG = {
  text: { label: 'Text', make: () => ({ html: '<p>Write something…</p>' }),
    fields: [{ k: 'html', t: 'rich' }, { k: 'style', t: 'select', label: 'Style', opts: [['', 'Normal'], ['large', 'Large intro']] }] },
  quote: { label: 'Quote', make: () => ({ text: 'A memorable line.', cite: '' }),
    fields: [{ k: 'text', t: 'textarea', label: 'Quote' }, { k: 'cite', label: 'Attribution' }] },
  image: { label: 'Image', make: () => ({ url: '', alt: '', caption: '', size: 'wide' }),
    fields: [{ k: 'url', label: 'Image URL' }, { k: 'alt', label: 'Alt text' }, { k: 'caption', label: 'Caption' }, { k: 'size', t: 'select', label: 'Size', opts: SIZE_OPTS }] },
  video: { label: 'Video', make: () => ({ url: '', caption: '', size: 'wide' }),
    fields: [{ k: 'url', label: 'YouTube, Vimeo or .mp4 URL' }, { k: 'caption', label: 'Caption' }, { k: 'size', t: 'select', label: 'Size', opts: SIZE_OPTS }] },
  embed: { label: 'Embed', make: () => ({ url: '', caption: '', size: 'wide' }),
    fields: [{ k: 'url', label: 'Page URL' }, { k: 'caption', label: 'Caption' }, { k: 'size', t: 'select', label: 'Size', opts: SIZE_OPTS }] },
  map: { label: 'Map', make: () => ({ view: view(), caption: '', size: 'full' }),
    fields: [{ k: 'view', t: 'view', label: 'Map view' }, { k: 'caption', label: 'Caption' }, { k: 'size', t: 'select', label: 'Size', opts: SIZE_OPTS }] },
  sidecar: { label: 'Sidecar (scrolling map story)', make: () => ({ layout: 'docked', slides: [makeSlide(), makeSlide()] }),
    fields: [{ k: 'layout', t: 'select', label: 'Layout', opts: [['docked', 'Docked panel'], ['floating', 'Floating cards']] }, { k: 'slides', t: 'slides' }] },
  tour: { label: 'Guided tour', make: () => ({ basemap: 'streets', zoom: 14, places: [makePlace()] }),
    fields: [{ k: 'basemap', t: 'select', label: 'Basemap', opts: BASEMAP_OPTS }, { k: 'zoom', t: 'number', label: 'Zoom per place' }, { k: 'places', t: 'places' }] },
  swipe: { label: 'Swipe compare', make: () => ({ left: 'streets', right: 'dark', leftLabel: '', rightLabel: '', view: view(), caption: '' }),
    fields: [{ k: 'left', t: 'select', label: 'Left basemap', opts: BASEMAP_OPTS }, { k: 'right', t: 'select', label: 'Right basemap', opts: BASEMAP_OPTS },
      { k: 'leftLabel', label: 'Left label' }, { k: 'rightLabel', label: 'Right label' }, { k: 'view', t: 'view', label: 'Map view', noMarkers: true }, { k: 'caption', label: 'Caption' }] },
  separator: { label: 'Separator', make: () => ({}), fields: [] },
};

function makeSlide() { return { html: '<h3>New slide</h3><p>Narrative text.</p>', media: { type: 'map', view: view() } }; }
function makePlace() { return { title: 'New place', lngLat: [...DEFAULT_VIEW.center], image: '', html: '' }; }

const blankStory = () => ({
  id: newId(), title: 'Untitled story', subtitle: '', author: '', date: '', theme: 'light', cover: { image: '' },
  blocks: [CATALOG.text.make()].map((b) => ({ type: 'text', ...b })), credits: '',
});

/* ---------- State ---------- */

let story;
const params = new URLSearchParams(location.search);
const frame = $('#preview');
let previewReady = false;

async function load() {
  if (params.get('id')) story = getLocalStory(params.get('id'));
  if (!story && params.get('from')) {
    const src = params.get('from');
    if (/^stories\/[\w-]+\.json$/.test(src)) {
      const s = await fetch(src).then((r) => r.json()).catch(() => null);
      if (s) story = { ...s, id: newId() };
    }
  }
  if (!story) story = blankStory();
  history.replaceState(null, '', `?id=${story.id}`);
  saveLocalStory(story);
  renderAll();
}

let timer;
function changed() {
  clearTimeout(timer);
  $('#status').textContent = 'Editing…';
  timer = setTimeout(() => {
    $('#status').textContent = saveLocalStory(story) ? 'Saved in this browser' : 'Could not save (storage blocked)';
    pushPreview();
  }, 350);
}
function pushPreview() {
  if (previewReady) frame.contentWindow.postMessage({ type: 'story', story }, location.origin);
}
frame.addEventListener('load', () => { previewReady = true; pushPreview(); });
addEventListener('message', (e) => {
  if (e.origin === location.origin && e.data?.type === 'preview-ready') { previewReady = true; pushPreview(); }
});

/* ---------- Generic fields ---------- */

function field(obj, spec, onStructure) {
  const label = spec.label ? h('span', { class: 'b-label' }, spec.label) : null;
  const set = (v) => { obj[spec.k] = v; changed(); };
  switch (spec.t) {
    case 'rich': return richEditor(obj, spec.k);
    case 'textarea': return h('label', { class: 'b-field' }, label, h('textarea', { rows: 3, value: obj[spec.k] ?? '', oninput: (e) => set(e.target.value) }));
    case 'number': return h('label', { class: 'b-field' }, label, h('input', { type: 'number', step: '0.5', value: obj[spec.k] ?? '', oninput: (e) => set(e.target.value === '' ? undefined : +e.target.value) }));
    case 'select': return h('label', { class: 'b-field' }, label,
      h('select', { onchange: (e) => { set(e.target.value); spec.structural && onStructure(); } },
        spec.opts.map(([v, l]) => h('option', { value: v, ...(String(obj[spec.k] ?? '') === v ? { selected: '' } : {}) }, l))));
    case 'view': return viewField(obj, spec);
    case 'slides': return listField(obj, 'slides', 'Slide', makeSlide, slideForm, onStructure);
    case 'places': return listField(obj, 'places', 'Place', makePlace, placeForm, onStructure);
    default: return h('label', { class: 'b-field' }, label, h('input', { type: 'text', value: obj[spec.k] ?? '', oninput: (e) => set(e.target.value) }));
  }
}

function richEditor(obj, key) {
  const ed = h('div', { class: 'b-rich-area', contenteditable: 'true' });
  ed.innerHTML = sanitize(obj[key] || '');
  ed.addEventListener('input', () => { obj[key] = sanitize(ed.innerHTML); changed(); });
  const cmd = (c, v) => (e) => { e.preventDefault(); ed.focus(); document.execCommand(c, false, v); };
  const bar = h('div', { class: 'b-rich-bar' },
    h('button', { type: 'button', title: 'Bold', onmousedown: cmd('bold') }, h('b', {}, 'B')),
    h('button', { type: 'button', title: 'Italic', onmousedown: cmd('italic') }, h('i', {}, 'I')),
    h('button', { type: 'button', title: 'Heading', onmousedown: cmd('formatBlock', 'H2') }, 'H2'),
    h('button', { type: 'button', title: 'Subheading', onmousedown: cmd('formatBlock', 'H3') }, 'H3'),
    h('button', { type: 'button', title: 'Paragraph', onmousedown: cmd('formatBlock', 'P') }, '¶'),
    h('button', { type: 'button', title: 'Bulleted list', onmousedown: cmd('insertUnorderedList') }, '•'),
    h('button', { type: 'button', title: 'Link', onmousedown: (e) => { e.preventDefault(); const u = prompt('Link URL'); if (u) { ed.focus(); document.execCommand('createLink', false, u); } } }, '🔗'));
  return h('div', { class: 'b-rich' }, bar, ed);
}

function viewField(obj, spec) {
  const summary = () => {
    const v = obj[spec.k] || {};
    return `${BASEMAPS[v.basemap]?.label || 'Streets'} · zoom ${v.zoom ?? '?'} · ${(v.markers || []).length} marker(s)`;
  };
  const text = h('span', { class: 'b-muted' }, summary());
  return h('div', { class: 'b-field' }, h('span', { class: 'b-label' }, spec.label || 'Map view'),
    h('div', { class: 'b-row' }, text,
      h('button', { type: 'button', class: 'b-btn', onclick: () => openPicker({ mode: 'view', value: obj[spec.k], noMarkers: spec.noMarkers },
        (v) => { obj[spec.k] = v; text.textContent = summary(); changed(); }) }, 'Set map view…')));
}

function listField(obj, key, noun, make, form, onStructure) {
  const items = (obj[key] ||= []);
  const wrap = h('div', { class: 'b-list' });
  items.forEach((item, i) => {
    wrap.append(h('div', { class: 'b-item' },
      h('div', { class: 'b-item-head' }, h('strong', {}, `${noun} ${i + 1}`),
        itemControls(items, i, onStructure)),
      form(item, onStructure)));
  });
  wrap.append(h('button', { type: 'button', class: 'b-btn b-add', onclick: () => { items.push(make()); changed(); onStructure(); } }, `+ Add ${noun.toLowerCase()}`));
  return wrap;
}

function itemControls(arr, i, onStructure) {
  const move = (d) => () => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; changed(); onStructure(); };
  return h('span', { class: 'b-ctrls' },
    h('button', { type: 'button', title: 'Move up', 'aria-label': 'Move up', onclick: move(-1), disabled: i === 0 }, '↑'),
    h('button', { type: 'button', title: 'Move down', 'aria-label': 'Move down', onclick: move(1), disabled: i === arr.length - 1 }, '↓'),
    h('button', { type: 'button', title: 'Duplicate', 'aria-label': 'Duplicate', onclick: () => { arr.splice(i + 1, 0, clone(arr[i])); changed(); onStructure(); } }, '⧉'),
    h('button', { type: 'button', title: 'Delete', 'aria-label': 'Delete', class: 'is-danger', onclick: () => { if (confirm('Delete this item?')) { arr.splice(i, 1); changed(); onStructure(); } } }, '✕'));
}

function slideForm(slide, onStructure) {
  slide.media ||= { type: 'map', view: view() };
  const m = slide.media;
  const mediaFields = (m.type || 'map') === 'map'
    ? [field(m, { k: 'view', t: 'view', label: 'Map for this slide' })]
    : [field(m, { k: 'url', label: m.type === 'image' ? 'Image URL' : m.type === 'video' ? 'Video URL' : 'Page URL' }), field(m, { k: 'alt', label: 'Alt text / title' })];
  return h('div', {},
    richEditor(slide, 'html'),
    h('label', { class: 'b-field' }, h('span', { class: 'b-label' }, 'Media'),
      h('select', { onchange: (e) => { m.type = e.target.value; if (m.type === 'map') m.view ||= view(); changed(); onStructure(); } },
        [['map', 'Map'], ['image', 'Image'], ['video', 'Video'], ['embed', 'Embed']].map(([v, l]) => h('option', { value: v, ...((m.type || 'map') === v ? { selected: '' } : {}) }, l)))),
    mediaFields);
}

function placeForm(place) {
  const loc = h('span', { class: 'b-muted' }, place.lngLat.map((n) => n.toFixed(4)).join(', '));
  return h('div', {},
    field(place, { k: 'title', label: 'Title' }),
    h('div', { class: 'b-field' }, h('span', { class: 'b-label' }, 'Location'),
      h('div', { class: 'b-row' }, loc, h('button', { type: 'button', class: 'b-btn', onclick: () => openPicker({ mode: 'point', value: { center: place.lngLat, zoom: 13 } },
        (p) => { place.lngLat = p; loc.textContent = p.map((n) => n.toFixed(4)).join(', '); changed(); }) }, 'Pick on map…'))),
    field(place, { k: 'image', label: 'Image URL' }),
    richEditor(place, 'html'));
}

/* ---------- Panels ---------- */

function renderAll() {
  renderSettings();
  renderBlocks();
  $('#title-input').value = story.title;
  pushPreview();
}

function renderSettings() {
  story.cover ||= {};
  $('#settings').replaceChildren(
    field(story, { k: 'subtitle', t: 'textarea', label: 'Subtitle' }),
    h('div', { class: 'b-grid2' }, field(story, { k: 'author', label: 'Author' }), field(story, { k: 'date', label: 'Date' })),
    field(story.cover, { k: 'image', label: 'Cover image URL' }),
    field(story, { k: 'theme', t: 'select', label: 'Theme', opts: [['light', 'Light'], ['dark', 'Dark']] }),
    field(story, { k: 'credits', t: 'textarea', label: 'Credits (HTML allowed)' }));
}

function renderBlocks() {
  const list = $('#blocks');
  const scroll = $('#editor').scrollTop;
  list.replaceChildren(...story.blocks.map((b, i) => {
    const cat = CATALOG[b.type];
    const body = h('div', { class: 'b-block-body' }, ...(cat?.fields || []).map((f) => field(b, f, renderBlocks)));
    const card = h('details', { class: 'b-block', open: b._open === false ? null : '' },
      h('summary', {}, h('span', { class: 'b-type' }, cat?.label || b.type), h('span', { class: 'b-peek' }, peek(b)),
        itemControls(story.blocks, i, renderBlocks)),
      body);
    card.addEventListener('toggle', () => { Object.defineProperty(b, '_open', { value: card.open, enumerable: false, writable: true, configurable: true }); });
    return h('div', {}, card, addBar(i + 1));
  }));
  list.prepend(addBar(0));
  $('#editor').scrollTop = scroll;
}

function peek(b) {
  const txt = (b.html || b.text || b.caption || b.url || '').replace(/<[^>]+>/g, ' ').trim();
  return txt.length > 40 ? txt.slice(0, 40) + '…' : txt;
}

function addBar(index) {
  const sel = h('select', { class: 'b-add-select', 'aria-label': 'Add block', onchange: (e) => {
    const type = e.target.value;
    if (!type) return;
    story.blocks.splice(index, 0, { type, ...CATALOG[type].make() });
    changed();
    renderBlocks();
  } }, h('option', { value: '' }, '+ Add block'), Object.entries(CATALOG).map(([k, c]) => h('option', { value: k }, c.label)));
  return h('div', { class: 'b-addbar' }, sel);
}

/* ---------- Map picker modal ---------- */

let pickerMap = null;
function openPicker({ mode, value, noMarkers }, done) {
  const dlg = $('#picker');
  const v = view(clone(value || {}));
  const markers = clone(v.markers || []);
  const mapEl = h('div', { class: 'b-picker-map' });
  const markerList = h('div', { class: 'b-marker-list' });
  const basemapSel = h('select', { onchange: (e) => { pickerMap.setStyle(BASEMAPS[e.target.value].style); pickerMap._basemap = e.target.value; } },
    BASEMAP_OPTS.map(([k, l]) => h('option', { value: k, ...(k === v.basemap ? { selected: '' } : {}) }, l)));
  let point = mode === 'point' ? [...v.center] : null;

  const drawMarkers = () => {
    if (mode === 'point') { setMarkers(pickerMap, [{ lngLat: point }]); return; }
    setMarkers(pickerMap, markers);
    markerList.replaceChildren(...markers.map((mk, i) => h('div', { class: 'b-row' },
      h('span', { class: 'sm-marker-mini' }, String(i + 1)),
      h('input', { type: 'text', value: mk.title || '', placeholder: 'Marker title', oninput: (e) => { mk.title = e.target.value; } }),
      h('button', { type: 'button', class: 'b-btn', onclick: () => { markers.splice(i, 1); drawMarkers(); } }, 'Remove'))));
  };

  const hint = mode === 'point' ? 'Click the map to place this location.'
    : noMarkers ? 'Pan, zoom, rotate (right-drag) and tilt (ctrl-drag) to frame the view.'
      : 'Frame the view. Click the map to drop markers.';
  dlg.replaceChildren(h('form', { method: 'dialog', class: 'b-picker' },
    h('div', { class: 'b-row b-picker-top' }, h('strong', {}, mode === 'point' ? 'Pick location' : 'Set map view'), h('span', { class: 'b-muted' }, hint),
      mode === 'point' ? null : h('label', { class: 'b-row' }, 'Basemap ', basemapSel)),
    h('div', { class: 'b-row', style: 'gap:8px' }, h('input', { type: 'search', placeholder: 'Search a place (OpenStreetMap)…', class: 'b-search' }),
      h('button', { type: 'button', class: 'b-btn', onclick: (e) => geocode(e.target.previousSibling.value) }, 'Search')),
    mapEl,
    noMarkers || mode === 'point' ? null : markerList,
    h('div', { class: 'b-row b-picker-actions' },
      h('button', { value: 'cancel', class: 'b-btn' }, 'Cancel'),
      h('button', { type: 'button', class: 'b-btn is-primary', onclick: () => {
        done(mode === 'point' ? point : { ...readView(pickerMap), markers: noMarkers ? [] : markers });
        dlg.close();
      } }, 'Use this'))));
  dlg.showModal();
  pickerMap?.remove();
  pickerMap = createMap(mapEl, { ...v, markers: [] });
  pickerMap.scrollZoom.enable();
  pickerMap.on('click', (e) => {
    const ll = [+e.lngLat.lng.toFixed(5), +e.lngLat.lat.toFixed(5)];
    if (mode === 'point') point = ll;
    else if (!noMarkers) markers.push({ lngLat: ll, title: '' });
    drawMarkers();
  });
  drawMarkers();
  dlg.addEventListener('close', () => { pickerMap?.remove(); pickerMap = null; }, { once: true });

  async function geocode(q) {
    if (!q?.trim()) return;
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const [hit] = await fetch(url).then((r) => r.json()).catch(() => []);
    if (hit) pickerMap.flyTo({ center: [+hit.lon, +hit.lat], zoom: 14 });
    else alert('No match found.');
  }
}

/* ---------- Toolbar ---------- */

$('#title-input').addEventListener('input', (e) => { story.title = e.target.value; changed(); });
$('#btn-new').addEventListener('click', () => { story = blankStory(); history.replaceState(null, '', `?id=${story.id}`); saveLocalStory(story); renderAll(); });
$('#btn-view').addEventListener('click', () => { saveLocalStory(story); window.open(`viewer.html?local=${story.id}`, '_blank'); });
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(story, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${(story.title || 'story').replace(/\W+/g, '-').toLowerCase()}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const s = JSON.parse(await file.text());
    if (!Array.isArray(s.blocks)) throw new Error('No blocks array');
    story = { ...s, id: newId() };
    history.replaceState(null, '', `?id=${story.id}`);
    saveLocalStory(story);
    renderAll();
  } catch (err) { alert('Not a valid story file: ' + err.message); }
  e.target.value = '';
});
$('#btn-open').addEventListener('click', () => {
  const dlg = $('#picker');
  const rows = listLocalStories();
  dlg.replaceChildren(h('form', { method: 'dialog', class: 'b-picker b-open' },
    h('strong', {}, 'Your stories (this browser)'),
    rows.length ? h('ul', {}, rows.map((s) => h('li', {}, h('a', { href: `builder.html?id=${s.id}` }, s.title || 'Untitled'),
      h('span', { class: 'b-muted' }, ' · ' + new Date(s.updated).toLocaleString())))) : h('p', { class: 'b-muted' }, 'No saved stories yet.'),
    h('div', { class: 'b-row b-picker-actions' }, h('button', { class: 'b-btn' }, 'Close'))));
  dlg.showModal();
});

load();
