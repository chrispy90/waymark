// Story builder: form-based editor on the left, live preview iframe on the right.
import { BASEMAPS, DEFAULT_VIEW, createMap, readView, setMarkers, setVisibleLayers, fitToLayer, loadLayerData, fieldNames, colorRamp } from './maps.js';
import { csvToGeoJSON } from './csv.js';
import { sanitize } from './sanitize.js';
import { api, requireUser, uploadImage } from './api.js';

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
    fields: [{ k: 'url', t: 'image', label: 'Image' }, { k: 'alt', label: 'Alt text' }, { k: 'caption', label: 'Caption' }, { k: 'size', t: 'select', label: 'Size', opts: SIZE_OPTS }] },
  video: { label: 'Video', make: () => ({ url: '', caption: '', size: 'wide' }),
    fields: [{ k: 'url', label: 'YouTube, Vimeo or .mp4 URL' }, { k: 'caption', label: 'Caption' }, { k: 'size', t: 'select', label: 'Size', opts: SIZE_OPTS }] },
  embed: { label: 'Embed', make: () => ({ url: '', caption: '', size: 'wide' }),
    fields: [{ k: 'url', label: 'Page URL' }, { k: 'caption', label: 'Caption' }, { k: 'size', t: 'select', label: 'Size', opts: SIZE_OPTS }] },
  map: { label: 'Map', make: () => ({ view: view(), caption: '', size: 'full' }),
    fields: [{ k: 'view', t: 'view', label: 'Map view' }, { k: 'caption', label: 'Caption' }, { k: 'size', t: 'select', label: 'Size', opts: SIZE_OPTS }] },
  sidecar: { label: 'Sidecar (scrolling map story)', make: () => ({ layout: 'docked', slides: [makeSlide(), makeSlide()] }),
    fields: [{ k: 'layout', t: 'select', label: 'Layout', opts: [['docked', 'Docked panel'], ['floating', 'Floating cards']] }, { k: 'slides', t: 'slides' }] },
  tour: { label: 'Guided tour', make: () => ({ basemap: 'streets', zoom: 14, places: [makePlace()] }),
    fields: [{ k: 'basemap', t: 'select', label: 'Basemap', opts: BASEMAP_OPTS }, { k: 'zoom', t: 'number', label: 'Zoom per place' }, { k: 'layers', t: 'layerset', label: 'Data layers' }, { k: 'places', t: 'places' }] },
  swipe: { label: 'Swipe compare', make: () => ({ left: 'streets', right: 'dark', leftLabel: '', rightLabel: '', view: view(), caption: '' }),
    fields: [{ k: 'left', t: 'select', label: 'Left basemap', opts: BASEMAP_OPTS }, { k: 'right', t: 'select', label: 'Right basemap', opts: BASEMAP_OPTS },
      { k: 'leftLabel', label: 'Left label' }, { k: 'rightLabel', label: 'Right label' },
      { k: 'leftLayers', t: 'layerset', label: 'Left data layers' }, { k: 'rightLayers', t: 'layerset', label: 'Right data layers' },
      { k: 'view', t: 'view', label: 'Map view', noMarkers: true, noLayers: true }, { k: 'caption', label: 'Caption' }] },
  separator: { label: 'Separator', make: () => ({}), fields: [] },
};

function makeSlide() { return { html: '<h3>New slide</h3><p>Narrative text.</p>', media: { type: 'map', view: view() } }; }
function makePlace() { return { title: 'New place', lngLat: [...DEFAULT_VIEW.center], image: '', html: '' }; }

/* ---------- State & saving ---------- */

let story;
let meta = {}; // server summary: id, version, slug, url, hasUnpublishedChanges
const params = new URLSearchParams(location.search);
const frame = $('#preview');
let previewReady = false;

async function load() {
  await requireUser();
  const id = params.get('id');
  if (!id) { location.replace('/'); return; }
  try {
    const r = await api('GET', `/api/stories/${encodeURIComponent(id)}`);
    story = r.story;
    setMeta(r);
  } catch (e) {
    document.body.replaceChildren(h('main', { class: 'b-auth' }, h('h1', {}, 'Story not found'),
      h('p', { class: 'b-muted' }, e.message), h('a', { class: 'b-btn', href: '/' }, '← Your stories')));
    return;
  }
  renderAll();
}

function setMeta(m) {
  const { story: _ignored, ...rest } = m;
  meta = rest;
  const btn = $('#btn-publish');
  btn.textContent = !meta.url ? 'Publish…' : meta.hasUnpublishedChanges ? 'Publish changes…' : 'Published ✓';
}

const setStatus = (text, isError = false) => {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('is-error', isError);
};

let saveTimer;
let previewTimer;
let dirty = false;
let saving = false;
let queued = false;

function changed() {
  dirty = true;
  setStatus('Unsaved changes');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
  clearTimeout(previewTimer);
  previewTimer = setTimeout(pushPreview, 350);
}

async function save() {
  if (saving) { queued = true; return; }
  if (!dirty) return;
  dirty = false;
  saving = true;
  setStatus('Saving…');
  try {
    setMeta(await api('PUT', `/api/stories/${meta.id}`, { story, version: meta.version }));
    setStatus(dirty ? 'Unsaved changes' : 'All changes saved');
  } catch (e) {
    dirty = true;
    if (e.status === 409) await resolveConflict(e.body);
    else { setStatus(`Not saved: ${e.message}. Retrying…`, true); saveTimer = setTimeout(save, 5000); }
  } finally {
    saving = false;
    if (queued) { queued = false; save(); }
  }
}

async function resolveConflict(body) {
  setStatus('Edited somewhere else', true);
  const reload = confirm('This story was changed in another tab or device.\n\nOK: load the latest version (your recent edits here are discarded).\nCancel: keep your version and overwrite the other one.');
  if (reload) { dirty = false; location.reload(); return; }
  meta.version = body?.version ?? meta.version;
  queued = true;
}

/** Saves any pending edits now and waits for them to land. */
async function flush() {
  clearTimeout(saveTimer);
  for (let i = 0; i < 20 && (dirty || saving); i++) {
    if (!saving) await save();
    else await new Promise((r) => setTimeout(r, 150));
  }
  if (dirty) throw new Error('Could not save your latest changes');
}

addEventListener('beforeunload', (e) => { if (dirty || saving) e.preventDefault(); });

function pushPreview() {
  if (previewReady && story) frame.contentWindow.postMessage({ type: 'story', story }, location.origin);
}
frame.addEventListener('load', () => { previewReady = true; pushPreview(); });
addEventListener('message', (e) => {
  if (e.origin === location.origin && e.data?.type === 'preview-ready') { previewReady = true; pushPreview(); }
});

/* ---------- Images ---------- */

function imageField(obj, spec) {
  const thumb = h('img', { class: 'b-thumb', alt: '', hidden: !obj[spec.k] || null, src: obj[spec.k] || null });
  const input = h('input', { type: 'text', value: obj[spec.k] ?? '', placeholder: 'Paste a link, upload, or drop an image here', oninput: (e) => set(e.target.value) });
  const note = h('span', { class: 'b-muted' });
  const set = (url) => {
    obj[spec.k] = url;
    input.value = url;
    thumb.hidden = !url;
    if (url) thumb.src = url;
    changed();
  };
  const upload = async (file) => {
    if (!file) return;
    note.textContent = 'Uploading…';
    note.classList.remove('is-error');
    try { set((await uploadImage(file)).url); note.textContent = ''; } catch (e) { note.textContent = e.message; note.classList.add('is-error'); }
  };
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: '', onchange: (e) => { upload(e.target.files[0]); e.target.value = ''; } });
  const wrap = h('div', { class: 'b-field b-image-field' },
    h('span', { class: 'b-label' }, spec.label || 'Image'),
    h('div', { class: 'b-row' }, thumb, input),
    h('div', { class: 'b-row', style: 'margin-top:6px' },
      h('button', { type: 'button', class: 'b-btn b-small', onclick: () => fileInput.click() }, 'Upload…'),
      h('button', { type: 'button', class: 'b-btn b-small', onclick: () => openLibrary(set) }, 'My images'),
      obj[spec.k] ? h('button', { type: 'button', class: 'b-btn b-small', onclick: (e) => { set(''); e.target.remove(); } }, 'Remove') : null,
      note, fileInput));
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('is-drop'); });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('is-drop'));
  wrap.addEventListener('drop', (e) => { e.preventDefault(); wrap.classList.remove('is-drop'); upload(e.dataTransfer.files[0]); });
  return wrap;
}

async function openLibrary(onPick) {
  const dlg = $('#picker');
  const grid = h('div', { class: 'b-library' }, h('p', { class: 'b-muted' }, 'Loading…'));
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', multiple: '', hidden: '' });
  const refresh = async () => {
    const { uploads } = await api('GET', '/api/uploads');
    grid.replaceChildren(...(uploads.length ? uploads.map((u) => h('figure', { class: 'b-lib-item' },
      h('button', { type: 'button', class: 'b-lib-pick', title: u.name || 'Use this image', onclick: () => { onPick(u.url); dlg.close(); } },
        h('img', { src: u.url, alt: u.name || '', loading: 'lazy' })),
      h('figcaption', {}, h('span', {}, `${Math.round(u.bytes / 1024)} KB`),
        h('button', { type: 'button', class: 'b-link is-danger', onclick: async () => {
          if (!confirm('Delete this image? Stories that use it will show a broken image.')) return;
          await api('DELETE', `/api/uploads/${u.id}`);
          refresh();
        } }, 'Delete')))) : [h('p', { class: 'b-muted' }, 'No uploaded images yet.')]));
  };
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    grid.prepend(h('p', { class: 'b-muted' }, `Uploading ${files.length}…`));
    for (const f of files) await uploadImage(f).catch((e) => alert(`${f.name}: ${e.message}`));
    fileInput.value = '';
    refresh();
  });
  dlg.replaceChildren(h('form', { method: 'dialog', class: 'b-picker' },
    h('div', { class: 'b-row b-picker-top' }, h('strong', {}, 'My images'), h('span', { class: 'b-muted' }, 'Click an image to use it.'),
      h('button', { type: 'button', class: 'b-btn', onclick: () => fileInput.click() }, 'Upload…'), fileInput),
    grid,
    h('div', { class: 'b-row b-picker-actions' }, h('button', { class: 'b-btn' }, 'Close'))));
  dlg.showModal();
  refresh().catch((e) => grid.replaceChildren(h('p', { class: 'is-error' }, e.message)));
}

/* ---------- Publishing ---------- */

function openPublish() {
  const dlg = $('#picker');
  const origin = location.origin;
  const slugInput = h('input', { type: 'text', class: 'b-slug', value: meta.slug || '', placeholder: 'leave blank to use the title', spellcheck: 'false' });
  const msg = h('p', { class: 'b-muted', role: 'status' });
  const linkRow = h('div', { class: 'b-publish-live' });

  const showLive = () => {
    if (!meta.url) { linkRow.replaceChildren(h('p', { class: 'b-muted' }, 'Not published yet. Publishing creates a public link that anyone can open.')); return; }
    const full = origin + meta.url;
    linkRow.replaceChildren(
      h('p', {}, meta.hasUnpublishedChanges ? '● Live, with unpublished changes' : '● Live and up to date'),
      h('div', { class: 'b-row' }, h('a', { href: meta.url, target: '_blank', rel: 'noopener', class: 'b-live-link' }, full),
        h('button', { type: 'button', class: 'b-btn b-small', onclick: async (e) => { await navigator.clipboard.writeText(full).catch(() => {}); e.target.textContent = 'Copied'; } }, 'Copy')),
      h('p', { class: 'b-muted' }, `Last published ${new Date(meta.publishedAt).toLocaleString()}`));
  };

  const run = async (path, body, label) => {
    msg.classList.remove('is-error');
    msg.textContent = label;
    try {
      await flush();
      setMeta(await api('POST', `/api/stories/${meta.id}/${path}`, body));
      slugInput.value = meta.slug || '';
      msg.textContent = path === 'publish' ? 'Published.' : 'Unpublished. The link no longer works.';
      render();
    } catch (e) { msg.textContent = e.message; msg.classList.add('is-error'); }
  };

  const render = () => {
    showLive();
    actions.replaceChildren(
      h('button', { value: 'close', class: 'b-btn' }, 'Close'),
      meta.url ? h('button', { type: 'button', class: 'b-btn', onclick: () => confirm('Unpublish? The public link will stop working.') && run('unpublish', {}, 'Unpublishing…') }, 'Unpublish') : null,
      h('button', { type: 'button', class: 'b-btn is-primary', onclick: () => {
        const slug = slugInput.value.trim();
        run('publish', slug ? { slug } : {}, 'Publishing…');
      } }, meta.url ? (meta.hasUnpublishedChanges ? 'Publish changes' : 'Republish') : 'Publish'));
  };
  const actions = h('div', { class: 'b-row b-picker-actions' });

  dlg.replaceChildren(h('form', { method: 'dialog', class: 'b-picker b-publish' },
    h('strong', {}, 'Publish story'),
    linkRow,
    h('label', { class: 'b-field' }, h('span', { class: 'b-label' }, 'Public link'),
      h('div', { class: 'b-row b-slug-row' }, h('span', { class: 'b-muted' }, `${origin}/s/`), slugInput)),
    h('p', { class: 'b-muted b-hint' }, 'Edits are saved as a draft. Readers see the published version until you publish again.'),
    msg, actions));
  render();
  dlg.showModal();
}

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
    case 'layerset': return layerSet(obj, spec);
    case 'image': return imageField(obj, spec);
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
    const n = (v.layers || []).length;
    return `${BASEMAPS[v.basemap]?.label || 'Streets'} · zoom ${v.zoom ?? '?'} · ${(v.markers || []).length} marker(s)${n ? ` · ${n} layer(s)` : ''}`;
  };
  const text = h('span', { class: 'b-muted' }, summary());
  return h('div', { class: 'b-field' }, h('span', { class: 'b-label' }, spec.label || 'Map view'),
    h('div', { class: 'b-row' }, text,
      h('button', { type: 'button', class: 'b-btn', onclick: () => openPicker({ mode: 'view', value: obj[spec.k], noMarkers: spec.noMarkers, noLayers: spec.noLayers },
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
    : [field(m, { k: 'url', t: m.type === 'image' ? 'image' : undefined, label: m.type === 'image' ? 'Image' : m.type === 'video' ? 'Video URL' : 'Page URL' }), field(m, { k: 'alt', label: 'Alt text / title' })];
  const rich = richEditor(slide, 'html');
  return h('div', {},
    rich,
    h('label', { class: 'b-field' }, h('span', { class: 'b-label' }, 'Media'),
      h('select', { onchange: (e) => { m.type = e.target.value; if (m.type === 'map') m.view ||= view(); changed(); onStructure(); } },
        [['map', 'Map'], ['image', 'Image'], ['video', 'Video'], ['embed', 'Embed']].map(([v, l]) => h('option', { value: v, ...((m.type || 'map') === v ? { selected: '' } : {}) }, l)))),
    mediaFields,
    actionsField(slide, rich.querySelector('.b-rich-area'), onStructure));
}

// Map actions: named alternate views, triggered by #action:<id> links in the slide text.
function actionsField(slide, editor, onStructure) {
  const actions = (slide.actions ||= []);
  const insertLink = (a) => (e) => {
    e.preventDefault();
    const sel = getSelection();
    const inEditor = sel.rangeCount && editor.contains(sel.anchorNode);
    if (inEditor && !sel.isCollapsed) {
      document.execCommand('createLink', false, `#action:${a.id}`);
    } else {
      // No selection: append the link to the end of the text.
      const link = h('a', { href: `#action:${a.id}` }, a.label || 'map action');
      let target = editor.lastElementChild;
      if (!target || !/^(P|H2|H3|H4|LI)$/.test(target.tagName)) target = editor.appendChild(h('p'));
      target.append(' ', link);
    }
    editor.dispatchEvent(new Event('input'));
  };
  return h('div', { class: 'b-field' },
    h('span', { class: 'b-label' }, 'Map actions'),
    h('p', { class: 'b-muted b-hint' }, 'Links in the text that change the map. Select words in the text, then click "Link selected text", or insert a new link.'),
    actions.map((a, i) => {
      const summary = h('span', { class: 'b-muted' }, viewSummary(a.view));
      return h('div', { class: 'b-item' },
        h('div', { class: 'b-item-head' }, h('strong', {}, `Action ${i + 1}`), itemControls(actions, i, onStructure)),
        field(a, { k: 'label', label: 'Link text' }),
        h('div', { class: 'b-row', style: 'margin-top:8px' }, summary,
          h('button', { type: 'button', class: 'b-btn', onclick: () => openPicker({ mode: 'view', value: a.view || slide.media?.view },
            (v) => { a.view = v; summary.textContent = viewSummary(v); changed(); }) }, 'Set view…')),
        h('div', { class: 'b-row', style: 'margin-top:8px' },
          h('button', { type: 'button', class: 'b-btn', onmousedown: insertLink(a) }, 'Link selected text'),
          h('span', { class: 'b-muted' }, `#action:${a.id}`)));
    }),
    h('button', { type: 'button', class: 'b-btn b-add', onclick: () => {
      actions.push({ id: 'a' + Math.random().toString(36).slice(2, 7), label: 'see this', view: clone(slide.media?.view || view()) });
      changed(); onStructure();
    } }, '+ Add map action'));
}

const viewSummary = (v = {}) => `${BASEMAPS[v.basemap]?.label || 'Streets'} · zoom ${v.zoom ?? '?'}${(v.layers || []).length ? ` · ${v.layers.length} layer(s)` : ''}`;

function layerSet(obj, spec) {
  const lib = story.layers || [];
  const ids = (obj[spec.k] ||= []);
  return h('div', { class: 'b-field' }, h('span', { class: 'b-label' }, spec.label),
    lib.length ? h('div', { class: 'b-checks' }, lib.map((l) => h('label', {},
      h('input', { type: 'checkbox', ...(ids.includes(l.id) ? { checked: '' } : {}), onchange: (e) => {
        const i = ids.indexOf(l.id);
        if (e.target.checked && i < 0) ids.push(l.id);
        if (!e.target.checked && i >= 0) ids.splice(i, 1);
        changed();
      } }), ' ', l.name || l.id)))
      : h('span', { class: 'b-muted' }, 'No data layers yet. Add them under "Data layers" above.'));
}

function placeForm(place) {
  const loc = h('span', { class: 'b-muted' }, place.lngLat.map((n) => n.toFixed(4)).join(', '));
  return h('div', {},
    field(place, { k: 'title', label: 'Title' }),
    h('div', { class: 'b-field' }, h('span', { class: 'b-label' }, 'Location'),
      h('div', { class: 'b-row' }, loc, h('button', { type: 'button', class: 'b-btn', onclick: () => openPicker({ mode: 'point', value: { center: place.lngLat, zoom: 13 } },
        (p) => { place.lngLat = p; loc.textContent = p.map((n) => n.toFixed(4)).join(', '); changed(); }) }, 'Pick on map…'))),
    field(place, { k: 'image', t: 'image', label: 'Image' }),
    richEditor(place, 'html'));
}

/* ---------- Data layers ---------- */

const layerInfo = {}; // id -> { key, count, fields, fc, loading, error }
const openLayers = new Set();
const layerStatus = (l) => {
  const i = layerInfo[l.id] || {};
  return i.loading ? 'Loading…' : i.error ? 'Error' : i.count != null ? `${i.count.toLocaleString()} features` : '';
};
const sourceKey = (l) => (l.data ? `data:${l.data.features?.length}` : `url:${l.url || ''}`);

function inspectLayer(layer) {
  const key = sourceKey(layer);
  if (layerInfo[layer.id]?.key === key) return;
  layerInfo[layer.id] = { key, loading: true };
  loadLayerData(layer).then((fc) => {
    if (layerInfo[layer.id]?.key !== key) return;
    layerInfo[layer.id] = { key, count: fc.features.length, fields: fieldNames(fc), fc };
    renderLayers();
  }).catch((err) => {
    if (layerInfo[layer.id]?.key !== key) return;
    layerInfo[layer.id] = { key, error: err.message };
    renderLayers();
  });
}

function renderLayers() {
  const lib = (story.layers ||= []);
  lib.forEach(inspectLayer);
  $('#layers').replaceChildren(
    h('p', { class: 'b-muted b-hint' }, 'Layers are shared by every map in the story. Turn them on per map in "Set map view…".'),
    ...lib.map((layer, i) => {
      const card = h('details', { class: 'b-block b-layer', ...(openLayers.has(layer.id) ? { open: '' } : {}) },
        h('summary', {}, h('span', { class: 'sm-swatch', style: `background:${layer.style?.color || '#2563eb'}` }),
          h('span', { class: 'b-type' }, layer.name || 'Layer'), h('span', { class: 'b-peek' }, layerStatus(layer)), itemControls(lib, i, renderAllForms)),
        h('div', { class: 'b-block-body' }, layerForm(layer)));
      card.addEventListener('toggle', () => (card.open ? openLayers.add(layer.id) : openLayers.delete(layer.id)));
      return card;
    }),
    h('div', { class: 'b-row', style: 'margin-top:10px' },
      h('button', { type: 'button', class: 'b-btn', onclick: () => {
        const id = 'l' + Math.random().toString(36).slice(2, 7);
        lib.push({ id, name: 'New layer', url: '', style: { color: '#2563eb' }, popup: {} });
        openLayers.add(id);
        changed(); renderAllForms();
      } }, '+ Add layer')));
}

function layerForm(layer) {
  layer.style ||= {};
  layer.popup ||= {};
  const st = layer.style;
  const info = layerInfo[layer.id] || {};
  const fields = info.fields || [];
  const fieldSelect = (obj, k, label, empty = 'None') => h('label', { class: 'b-field' }, h('span', { class: 'b-label' }, label),
    h('select', { onchange: (e) => { obj[k] = e.target.value || undefined; changed(); renderLayers(); } },
      h('option', { value: '' }, empty), fields.map((f) => h('option', { value: f, ...(obj[k] === f ? { selected: '' } : {}) }, f))));
  const status = info.loading ? 'Loading…' : info.error ? `Could not load: ${info.error}` : info.count != null ? `${info.count.toLocaleString()} features · ${fields.length} fields` : '';

  const fileInput = h('input', { type: 'file', accept: '.geojson,.json,.csv,application/json,text/csv', hidden: '', onchange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const fc = /\.csv$/i.test(file.name) ? csvToGeoJSON(text) : JSON.parse(text);
      if (fc.type !== 'FeatureCollection') throw new Error('Expected a GeoJSON FeatureCollection');
      layer.data = fc;
      delete layer.url;
      if (layer.name === 'New layer') layer.name = file.name.replace(/\.\w+$/, '');
      const kb = Math.round(JSON.stringify(fc).length / 1024);
      if (kb > 1500) alert(`This file is ${kb} KB. Browser storage holds about 5 MB in total, so large files may fail to save. Hosting it and using a URL is safer.`);
      changed(); renderAllForms();
    } catch (err) { alert('Could not read file: ' + err.message); }
  } });

  const cats = st.mode === 'categorical' && st.field && info.fc ? colorRamp(layer, info.fc).legend.entries.filter(([v]) => v !== 'Other') : [];

  return h('div', {},
    field(layer, { k: 'name', label: 'Name (shown in legend)' }),
    h('label', { class: 'b-field' }, h('span', { class: 'b-label' }, 'Data URL: GeoJSON, or an ArcGIS FeatureServer/MapServer layer'),
      h('input', { type: 'text', value: layer.data ? '' : layer.url || '', placeholder: layer.data ? `Uploaded file (${layer.data.features.length} features)` : 'https://…',
        onchange: (e) => { layer.url = e.target.value.trim(); delete layer.data; changed(); renderLayers(); } })),
    h('div', { class: 'b-row', style: 'margin-top:6px' },
      h('button', { type: 'button', class: 'b-btn', onclick: () => fileInput.click() }, 'Upload GeoJSON / CSV…'), fileInput,
      h('span', { class: `b-muted ${info.error ? 'is-error' : ''}` }, status)),
    h('div', { class: 'b-grid2' },
      h('label', { class: 'b-field' }, h('span', { class: 'b-label' }, 'Style'),
        h('select', { onchange: (e) => { st.mode = e.target.value; changed(); renderLayers(); } },
          [['single', 'Single color'], ['categorical', 'Color by category'], ['graduated', 'Color by number']].map(([v, l]) => h('option', { value: v, ...((st.mode || 'single') === v ? { selected: '' } : {}) }, l)))),
      h('label', { class: 'b-field' }, h('span', { class: 'b-label' }, st.mode === 'categorical' ? 'Fallback color' : 'Color'),
        h('input', { type: 'color', value: st.color || '#2563eb', oninput: (e) => { st.color = e.target.value; changed(); } }))),
    st.mode && st.mode !== 'single' ? fieldSelect(st, 'field', 'Field to color by', 'Choose a field…') : null,
    cats.length ? h('div', { class: 'b-field' }, h('span', { class: 'b-label' }, 'Category colors'),
      h('div', { class: 'b-cats' }, cats.map(([v, c]) => h('label', { class: 'b-row' },
        h('input', { type: 'color', value: c, oninput: (e) => { (st.colors ||= {})[v] = e.target.value; changed(); } }), v)))) : null,
    h('div', { class: 'b-grid3' },
      field(st, { k: 'opacity', t: 'number', label: 'Fill opacity' }),
      field(st, { k: 'radius', t: 'number', label: 'Point size' }),
      field(st, { k: 'width', t: 'number', label: 'Line width' })),
    fieldSelect(st, 'label', 'Label field'),
    field(layer.popup, { k: 'title', label: 'Popup title, e.g. {NAME}' }),
    h('label', { class: 'b-field' }, h('span', { class: 'b-label' }, 'Popup fields (comma separated; blank = first 8)'),
      h('input', { type: 'text', value: (layer.popup.fields || []).join(', '), placeholder: fields.slice(0, 4).join(', '),
        oninput: (e) => { layer.popup.fields = e.target.value.split(',').map((f) => f.trim()).filter(Boolean); changed(); } })));
}

function renderAllForms() { renderLayers(); renderBlocks(); }

/* ---------- Panels ---------- */

function renderAll() {
  renderSettings();
  renderLayers();
  renderBlocks();
  $('#title-input').value = story.title;
  pushPreview();
}

function renderSettings() {
  story.cover ||= {};
  $('#settings').replaceChildren(
    field(story, { k: 'subtitle', t: 'textarea', label: 'Subtitle' }),
    h('div', { class: 'b-grid2' }, field(story, { k: 'author', label: 'Author' }), field(story, { k: 'date', label: 'Date' })),
    field(story.cover, { k: 'image', t: 'image', label: 'Cover image' }),
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
function openPicker({ mode, value, noMarkers, noLayers }, done) {
  const dlg = $('#picker');
  const v = view(clone(value || {}));
  const markers = clone(v.markers || []);
  const mapEl = h('div', { class: 'b-picker-map' });
  const markerList = h('div', { class: 'b-marker-list' });
  const basemapSel = h('select', { onchange: (e) => { pickerMap.setStyle(BASEMAPS[e.target.value].style, { diff: false }); pickerMap._basemap = e.target.value; } },
    BASEMAP_OPTS.map(([k, l]) => h('option', { value: k, ...(k === v.basemap ? { selected: '' } : {}) }, l)));
  let point = mode === 'point' ? [...v.center] : null;
  const lib = story.layers || [];
  const visible = [...(v.layers || [])];
  const layerPanel = mode === 'point' || noLayers || !lib.length ? null : h('div', { class: 'b-picker-layers' },
    h('strong', {}, 'Data layers'),
    lib.map((l) => h('div', { class: 'b-row' },
      h('label', { class: 'b-row', style: 'flex:1' }, h('input', { type: 'checkbox', ...(visible.includes(l.id) ? { checked: '' } : {}), onchange: (e) => {
        const i = visible.indexOf(l.id);
        if (e.target.checked && i < 0) visible.push(l.id);
        if (!e.target.checked && i >= 0) visible.splice(i, 1);
        setVisibleLayers(pickerMap, lib.filter((x) => visible.includes(x.id)).map((x) => x.id));
      } }), l.name || l.id),
      h('button', { type: 'button', class: 'b-btn b-small', title: 'Zoom to layer', onclick: () => fitToLayer(pickerMap, l.id) }, 'Zoom to'))),
    h('label', { class: 'b-row', style: 'margin-top:6px' }, h('input', { type: 'checkbox', ...(v.legend !== false ? { checked: '' } : {}), onchange: (e) => {
      pickerMap._legend.enabled = e.target.checked; pickerMap._legend.render(pickerMap);
    } }), 'Show legend'));

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
    h('div', { class: layerPanel ? 'b-picker-body has-layers' : 'b-picker-body' }, mapEl, layerPanel),
    noMarkers || mode === 'point' ? null : markerList,
    h('div', { class: 'b-row b-picker-actions' },
      h('button', { value: 'cancel', class: 'b-btn' }, 'Cancel'),
      h('button', { type: 'button', class: 'b-btn is-primary', onclick: () => {
        const out = { ...readView(pickerMap), markers: noMarkers ? [] : markers };
        if (noLayers) delete out.layers;
        done(mode === 'point' ? point : out);
        dlg.close();
      } }, 'Use this'))));
  dlg.showModal();
  pickerMap?.remove();
  pickerMap = createMap(mapEl, { ...v, markers: [], layers: visible }, { library: lib });
  pickerMap.scrollZoom.enable();
  pickerMap.on('click', (e) => {
    const ll = [+e.lngLat.lng.toFixed(5), +e.lngLat.lat.toFixed(5)];
    if (mode !== 'point' && pickerMap.queryRenderedFeatures(e.point).some((f) => f.layer.id.startsWith('dl-'))) return; // clicked a feature: show its popup
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
$('#btn-publish').addEventListener('click', openPublish);
$('#btn-view').addEventListener('click', async () => {
  const win = window.open('', '_blank');
  try { await flush(); } catch { /* preview whatever is saved */ }
  if (win) win.location = `/viewer.html?draft=${meta.id}`;
});
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(story, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${(story.title || 'story').replace(/\W+/g, '-').toLowerCase()}.json` });
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const s = JSON.parse(await file.text());
    if (!Array.isArray(s.blocks)) throw new Error('No blocks array');
    const { id, ...imported } = s;
    const created = await api('POST', '/api/stories', { story: imported });
    location.href = `/builder.html?id=${created.id}`;
  } catch (err) { alert('Could not import: ' + err.message); }
});

load();
