// Waymark editor: block outline + settings on the left, live preview on the right.
import { BASEMAPS, DEFAULT_VIEW, createMap, readView, setMarkers, setVisibleLayers, fitToLayer, loadLayerData, fieldNames, colorRamp } from './maps.js';
import { csvToGeoJSON } from './csv.js';
import { sanitize } from './sanitize.js';
import { api, requireUser, uploadImage } from './api.js';
import { $, h, icon, logo, toast, menu, dialog, confirmDialog, copyText, relTime, setTitle } from './ui.js';
import { initWorkbench, openAddData, openAnalysis, openDraw, rerunAnalysis, insightsPanel, addFromFile } from './workbench.js';
import { TOOLS, kinds } from './analysis.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const view = (v = {}) => ({ ...clone(DEFAULT_VIEW), ...v });
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const kids = (...a) => a.flat(Infinity).filter((x) => x != null && x !== false);

/* ---------- Block catalogue ---------- */

const BASEMAP_OPTS = Object.entries(BASEMAPS).map(([value, b]) => [value, b.label]);
const SIZE_OPTS = [['standard', 'Text width'], ['wide', 'Wide'], ['full', 'Full bleed']];

function makeSlide() { return { html: '<h3>New card</h3><p>Write what readers see while the map shows this place.</p>', media: { type: 'map', view: view() } }; }
function makePlace() { return { title: 'New place', lngLat: [...DEFAULT_VIEW.center], image: '', html: '' }; }

const CATALOG = {
  text: { label: 'Text', icon: 'text', group: 'Write', desc: 'Paragraphs, headings and links',
    make: () => ({ html: '<p>Write something…</p>' }),
    fields: [{ k: 'html', t: 'rich' }, { k: 'style', t: 'seg', label: 'Style', opts: [['', 'Normal'], ['large', 'Big intro']] }] },
  quote: { label: 'Quote', icon: 'quote', group: 'Write', desc: 'A pull quote that stands out',
    make: () => ({ text: 'A line worth remembering.', cite: '' }),
    fields: [{ k: 'text', t: 'textarea', label: 'Quote' }, { k: 'cite', label: 'Who said it' }] },
  statement: { label: 'Statement', icon: 'sparkle', group: 'Scroll effects', desc: 'Huge text that lights up word by word as you scroll', isNew: true,
    make: () => ({ text: 'One big idea, revealed one word at a time as the reader scrolls.', cite: '' }),
    fields: [{ k: 'text', t: 'textarea', label: 'Statement' }, { k: 'cite', label: 'Small caption (optional)' }, { k: 'style', t: 'seg', label: 'Typeface', opts: [['', 'Serif'], ['sans', 'Sans']] }] },
  chapter: { label: 'Chapter', icon: 'heading', group: 'Scroll effects', desc: 'Full-screen title that recolors the page from here on', isNew: true,
    make: () => ({ kicker: 'Chapter', title: 'A new chapter', text: '', bg: '#13233a', fg: '#f3efe6', align: 'center', image: '' }),
    fields: [{ k: 'kicker', label: 'Small label' }, { k: 'title', label: 'Title' }, { k: 'text', t: 'textarea', label: 'Intro line (optional)' },
      { row: [{ k: 'bg', t: 'color', label: 'Page color' }, { k: 'fg', t: 'color', label: 'Text color' }] },
      { k: 'align', t: 'seg', label: 'Alignment', opts: [['center', 'Center'], ['left', 'Left']] },
      { k: 'image', t: 'image', label: 'Background image (optional)' }],
    hint: 'Everything after this chapter takes on its colors, until the next chapter.' },
  stats: { label: 'Big numbers', icon: 'sliders', group: 'Scroll effects', desc: 'Figures that count up when they appear', isNew: true,
    make: () => ({ items: [{ value: '120', label: 'What this number means' }, { value: '3.4M', label: 'Another fact' }, { value: '98%', label: 'And one more' }], caption: '' }),
    fields: [{ k: 'items', t: 'stats' }, { k: 'caption', label: 'Caption (optional)' }] },
  gallery: { label: 'Scroll gallery', icon: 'swipe', group: 'Scroll effects', desc: 'A row of photos that slides sideways as you scroll down', isNew: true,
    make: () => ({ title: 'Gallery title', text: '', images: [{ url: '', caption: '' }, { url: '', caption: '' }, { url: '', caption: '' }] }),
    fields: [{ k: 'title', label: 'Title' }, { k: 'text', label: 'Short intro (optional)' }, { k: 'images', t: 'gallery' }] },
  image: { label: 'Image', icon: 'image', group: 'Media', desc: 'A photo with caption and optional scroll motion',
    make: () => ({ url: '', alt: '', caption: '', size: 'wide', effect: 'none' }),
    fields: [{ k: 'url', t: 'image', label: 'Image' }, { k: 'caption', label: 'Caption' }, { k: 'alt', label: 'Alt text (describe it for screen readers)' },
      { k: 'size', t: 'seg', label: 'Width', opts: SIZE_OPTS },
      { k: 'effect', t: 'seg', label: 'Scroll motion', opts: [['none', 'None'], ['parallax', 'Parallax'], ['zoom', 'Zoom'], ['reveal', 'Reveal']] }] },
  video: { label: 'Video', icon: 'video', group: 'Media', desc: 'YouTube, Vimeo or a video file',
    make: () => ({ url: '', caption: '', size: 'wide' }),
    fields: [{ k: 'url', label: 'Video link', placeholder: 'https://youtube.com/watch?v=…' }, { k: 'caption', label: 'Caption' }, { k: 'size', t: 'seg', label: 'Width', opts: SIZE_OPTS }] },
  embed: { label: 'Embed', icon: 'embed', group: 'Media', desc: 'Any web page, chart or dashboard',
    make: () => ({ url: '', caption: '', size: 'wide' }),
    fields: [{ k: 'url', label: 'Page link', placeholder: 'https://…' }, { k: 'caption', label: 'Caption' }, { k: 'size', t: 'seg', label: 'Width', opts: SIZE_OPTS }] },
  separator: { label: 'Divider', icon: 'separator', group: 'Write', desc: 'A quiet break between sections', make: () => ({}), fields: [] },
  sidecar: { label: 'Scrolling map', icon: 'sidecar', group: 'Maps', desc: 'Cards scroll by while the map flies to each place',
    make: () => ({ layout: 'floating', slides: [makeSlide(), makeSlide()] }),
    fields: [{ k: 'layout', t: 'seg', label: 'Layout', opts: [['floating', 'Cards over map'], ['docked', 'Text beside map']] }, { k: 'slides', t: 'slides' }] },
  map: { label: 'Map', icon: 'map', group: 'Maps', desc: 'An interactive map with markers and data',
    make: () => ({ view: view(), caption: '', size: 'full' }),
    fields: [{ k: 'view', t: 'view', label: 'Map' }, { k: 'caption', label: 'Caption' }, { k: 'size', t: 'seg', label: 'Width', opts: SIZE_OPTS }] },
  tour: { label: 'Guided tour', icon: 'tour', group: 'Maps', desc: 'Step through numbered places with photos',
    make: () => ({ basemap: 'streets', zoom: 14, places: [makePlace()] }),
    fields: [{ k: 'places', t: 'places' }, { k: 'basemap', t: 'select', label: 'Basemap', opts: BASEMAP_OPTS }, { k: 'zoom', t: 'number', label: 'Zoom level at each place' }, { k: 'layers', t: 'layerset', label: 'Data layers' }] },
  swipe: { label: 'Swipe compare', icon: 'swipe', group: 'Maps', desc: 'Before and after, with a draggable divider',
    make: () => ({ left: 'streets', right: 'dark', leftLabel: 'Before', rightLabel: 'After', view: view(), caption: '' }),
    fields: [{ k: 'view', t: 'view', label: 'Map', noMarkers: true, noLayers: true },
      { row: [{ k: 'leftLabel', label: 'Left label' }, { k: 'rightLabel', label: 'Right label' }] },
      { row: [{ k: 'left', t: 'select', label: 'Left basemap', opts: BASEMAP_OPTS }, { k: 'right', t: 'select', label: 'Right basemap', opts: BASEMAP_OPTS }] },
      { k: 'leftLayers', t: 'layerset', label: 'Left data layers' }, { k: 'rightLayers', t: 'layerset', label: 'Right data layers' }, { k: 'caption', label: 'Caption' }] },
};
const GROUPS = ['Write', 'Media', 'Maps', 'Scroll effects'];

/* ---------- State & saving ---------- */

let story;
let meta = {};
let selected = null; // index of the open block
let tab = 'content';
const params = new URLSearchParams(location.search);
const frame = $('#preview');
let previewReady = false;

document.querySelectorAll('[data-icon]').forEach((el) => el.prepend(icon(el.dataset.icon, { size: el.classList.contains('icon-btn') ? 18 : 16 })));
$('#logo-slot').append(logo({ size: 24, withName: false }));

async function load() {
  await requireUser();
  const id = params.get('id');
  if (!id) { location.replace('/'); return; }
  try {
    const r = await api('GET', `/api/stories/${encodeURIComponent(id)}`);
    story = r.story;
    setMeta(r);
  } catch (e) {
    document.body.replaceChildren(h('main', { class: 'auth-main', style: 'min-height:100vh' }, h('div', { class: 'auth-card' },
      h('h1', {}, 'Story not found'), h('p', {}, e.message), h('a', { class: 'btn btn-primary', href: '/' }, icon('back'), 'Back to your stories'))));
    return;
  }
  story.blocks ||= [];
  $('#title-input').value = story.title || '';
  setTitle(story.title || 'Editor');
  renderRail();
  pushPreview();
  setSave('saved');
  hist.last = snapshot();
  syncUndo();
  if (params.get('new')) {
    history.replaceState(null, '', `?id=${meta.id}`);
    const t = $('#title-input');
    t.focus();
    t.select();
  }
}

function setMeta(m) {
  const { story: _ignored, ...rest } = m;
  meta = rest;
  const btn = $('#btn-publish');
  btn.classList.toggle('is-done', !!meta.url && !meta.hasUnpublishedChanges);
  btn.classList.toggle('is-pending', !!meta.url && meta.hasUnpublishedChanges);
  btn.classList.toggle('btn-primary', !meta.url || meta.hasUnpublishedChanges);
  btn.replaceChildren(...(!meta.url ? [icon('globe', { size: 16 }), 'Publish'] : meta.hasUnpublishedChanges ? [icon('upload', { size: 16 }), 'Publish changes'] : [icon('check', { size: 16 }), 'Published']));
}

function setSave(state, text) {
  const el = $('#save-state');
  el.classList.toggle('is-error', state === 'error');
  el.replaceChildren(...(state === 'saving' ? [h('span', { class: 'spinner', style: 'width:12px;height:12px' }), 'Saving…']
    : state === 'dirty' ? ['Editing…'] : state === 'error' ? [icon('x', { size: 14 }), text || 'Not saved'] : [icon('check', { size: 14 }), 'Saved']));
}

/* ---------- Undo / redo ---------- */

const hist = { past: [], future: [], last: null, timer: 0, applying: false };
const snapshot = () => JSON.stringify(story);
function recordHistory() {
  if (hist.applying) return;
  clearTimeout(hist.timer);
  hist.timer = setTimeout(commitHistory, 450);
}
function commitHistory() {
  clearTimeout(hist.timer);
  hist.timer = 0;
  const snap = snapshot();
  if (snap === hist.last) return;
  if (hist.last != null) hist.past.push(hist.last);
  hist.last = snap;
  hist.future = [];
  let total = hist.past.reduce((n, x) => n + x.length, 0);
  while (hist.past.length > 100 || (total > 40e6 && hist.past.length > 1)) total -= hist.past.shift().length;
  syncUndo();
}
function restore(snap) {
  hist.last = snap;
  hist.applying = true;
  story = JSON.parse(snap);
  story.blocks ||= [];
  $('#title-input').value = story.title || '';
  if (selected != null && selected >= story.blocks.length) selected = null;
  changed();
  hist.applying = false;
  renderRail();
  syncUndo();
}
function undo() {
  if (hist.timer) commitHistory();
  const prev = hist.past.pop();
  if (prev == null) { toast('Nothing to undo', { duration: 1200 }); return; }
  hist.future.push(hist.last);
  restore(prev);
}
function redo() {
  const next = hist.future.pop();
  if (next == null) { toast('Nothing to redo', { duration: 1200 }); return; }
  hist.past.push(hist.last);
  restore(next);
}
function syncUndo() {
  $('#btn-undo').disabled = !hist.past.length && !hist.timer;
  $('#btn-redo').disabled = !hist.future.length;
}

let saveTimer;
let previewTimer;
let dirty = false;
let saving = false;
let queued = false;

function changed() {
  recordHistory();
  dirty = true;
  setSave('dirty');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
  clearTimeout(previewTimer);
  previewTimer = setTimeout(pushPreview, 300);
}

async function save() {
  if (saving) { queued = true; return; }
  if (!dirty) return;
  dirty = false;
  saving = true;
  setSave('saving');
  try {
    setMeta(await api('PUT', `/api/stories/${meta.id}`, { story, version: meta.version }));
    setSave(dirty ? 'dirty' : 'saved');
  } catch (e) {
    dirty = true;
    if (e.status === 409) await resolveConflict(e.body);
    else { setSave('error', 'Offline, retrying…'); saveTimer = setTimeout(save, 5000); }
  } finally {
    saving = false;
    if (queued) { queued = false; save(); }
  }
}

async function resolveConflict(body) {
  setSave('error', 'Changed elsewhere');
  const reload = await confirmDialog({ title: 'This story changed somewhere else', confirmLabel: 'Load latest version',
    message: 'It was edited in another tab or on another device. Load the latest version (your last few edits here are discarded), or cancel to keep yours and overwrite the other.' });
  if (reload) { dirty = false; location.reload(); return; }
  meta.version = body?.version ?? meta.version;
  queued = true;
}

async function flush() {
  clearTimeout(saveTimer);
  for (let i = 0; i < 20 && (dirty || saving); i++) {
    if (!saving) await save();
    else await new Promise((r) => setTimeout(r, 150));
  }
  if (dirty) throw new Error('Could not save your latest changes');
}

addEventListener('beforeunload', (e) => { if (dirty || saving) e.preventDefault(); });
addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); flush().then(() => toast('Saved', { tone: 'ok', duration: 1500 })).catch((err) => toast(err.message, { tone: 'error' })); return; }
  if (mod && k === 'k') { e.preventDefault(); if (!document.querySelector('dialog[open]')) openPalette(); return; }
  if (document.querySelector('dialog[open], .menu')) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (k === '/' || (k === '+' && !mod)) { e.preventDefault(); openBlockPicker(selected != null ? selected + 1 : story.blocks.length); return; }
  if (k === '?') { e.preventDefault(); openShortcuts(); return; }
  if (selected == null || tab !== 'content') return;
  const i = selected;
  if (k === 'escape') { select(i); return; }
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); removeAt(story.blocks, i, 'Block deleted', () => { selected = null; }); return; }
  if (mod && k === 'd') { e.preventDefault(); story.blocks.splice(i + 1, 0, clone(story.blocks[i])); selected = i + 1; changed(); renderRail(); return; }
  if (e.altKey && (k === 'arrowup' || k === 'arrowdown')) {
    e.preventDefault();
    const j = i + (k === 'arrowup' ? -1 : 1);
    if (j < 0 || j >= story.blocks.length) return;
    [story.blocks[i], story.blocks[j]] = [story.blocks[j], story.blocks[i]];
    selected = j;
    changed();
    renderRail();
  }
});

/* ---------- Preview ---------- */

const post = (msg) => previewReady && frame.contentWindow.postMessage(msg, location.origin);
function pushPreview() {
  if (!story) return;
  post({ type: 'story', story });
  post({ type: 'select', index: selected, scroll: false });
}
frame.addEventListener('load', () => { previewReady = true; pushPreview(); });
addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  if (e.data?.type === 'preview-ready') { previewReady = true; pushPreview(); }
  if (e.data?.type === 'select' && Number.isInteger(e.data.index)) select(e.data.index, { fromPreview: true });
});

function select(i, { fromPreview = false } = {}) {
  selected = selected === i && !fromPreview ? null : i;
  tab = 'content';
  syncTabs();
  renderRail();
  post({ type: 'select', index: selected, scroll: !fromPreview });
  if (selected != null) requestAnimationFrame(() => $(`.blk[data-i="${selected}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

$('#device').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-device]');
  if (!b) return;
  $('#device').querySelectorAll('button').forEach((x) => x.classList.toggle('is-on', x === b));
  $('#stage').classList.toggle('is-phone', b.dataset.device === 'phone');
});

/* ---------- Rail ---------- */

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  syncTabs();
  renderRail();
});
function syncTabs() { $('#tabs').querySelectorAll('button').forEach((x) => { x.classList.toggle('is-on', x.dataset.tab === tab); x.setAttribute('aria-selected', x.dataset.tab === tab); }); }

function renderRail() {
  const rail = $('#rail');
  const scroll = rail.scrollTop;
  rail.replaceChildren(...kids(tab === 'content' ? contentTab() : tab === 'story' ? storyTab() : dataTab()));
  rail.scrollTop = scroll;
}

function contentTab() {
  const blocks = story.blocks;
  const rows = [];
  blocks.forEach((b, i) => {
    rows.push(addBetween(i));
    rows.push(blockRow(b, i));
  });
  return [
    tipCard(),
    h('div', { class: 'rail-section-title' }, `Blocks · ${blocks.length}`),
    blocks.length ? h('div', { class: 'outline' }, rows) : h('p', { class: 'muted', style: 'margin:8px 2px 0' }, 'Your story is empty. Add a first block to get going.'),
    h('button', { type: 'button', class: 'add-block', onclick: () => openBlockPicker(blocks.length) }, icon('plus'), 'Add block'),
  ];
}

function tipCard() {
  let seen = false;
  try { seen = localStorage.getItem('wm.tip.editor') === '1'; } catch { /* storage blocked */ }
  if (seen) return null;
  const card = h('div', { class: 'tip' },
    h('span', { class: 'tip-icon' }, icon('target', { size: 16 })),
    h('div', {}, h('strong', {}, 'Quick tips'),
      h('p', {}, 'Click anything in the preview to edit it. Press ', h('kbd', {}, '/'), ' to add a block, or ', h('kbd', {}, modKey, 'K'), ' to find any command.')),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Dismiss tips', onclick: () => { try { localStorage.setItem('wm.tip.editor', '1'); } catch { /* ignore */ } card.remove(); } }, icon('x', { size: 15 })));
  return card;
}
const modKey = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl ';

function addBetween(index) {
  return h('div', { class: 'add-between' }, h('button', { type: 'button', title: 'Insert block here', 'aria-label': 'Insert block here', onclick: () => openBlockPicker(index) }, icon('plus', { size: 14 })));
}

let dragFrom = null;
function blockRow(b, i) {
  const cat = CATALOG[b.type] || { label: b.type, icon: 'file', fields: [] };
  const open = selected === i;
  const moreBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Block options', onclick: (e) => { e.stopPropagation(); blockMenu(e.currentTarget, i); } }, icon('more'));
  const grip = h('span', { class: 'blk-grip', title: 'Drag to reorder', draggable: 'true' }, icon('grip', { size: 16 }));
  const head = h('div', { class: 'blk-head', onclick: () => select(i) },
    grip,
    h('span', { class: 'blk-icon' }, icon(cat.icon, { size: 17 })),
    h('span', { class: 'blk-text' }, h('span', { class: 'blk-name' }, cat.label), h('span', { class: 'blk-peek' }, peek(b) || cat.desc || '')),
    moreBtn);
  const row = h('div', { class: `blk ${open ? 'is-open' : ''}`, 'data-i': i }, head,
    open ? h('div', { class: 'blk-body' }, cat.hint ? h('p', { class: 'field-hint', style: 'margin-top:12px' }, cat.hint) : null, fields(b, cat.fields)) : null);

  grip.addEventListener('dragstart', (e) => { dragFrom = i; row.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
  grip.addEventListener('dragend', () => { row.classList.remove('is-dragging'); dragFrom = null; });
  row.addEventListener('dragover', (e) => {
    if (dragFrom == null) return;
    e.preventDefault();
    const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
    row.classList.toggle('drop-after', after);
    row.classList.toggle('drop-before', !after);
  });
  row.addEventListener('dragleave', () => row.classList.remove('drop-after', 'drop-before'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const after = row.classList.contains('drop-after');
    row.classList.remove('drop-after', 'drop-before');
    if (dragFrom == null) return;
    let to = i + (after ? 1 : 0);
    const [moved] = story.blocks.splice(dragFrom, 1);
    if (dragFrom < to) to--;
    story.blocks.splice(to, 0, moved);
    if (selected === dragFrom) selected = to;
    dragFrom = null;
    changed();
    renderRail();
  });
  return row;
}

function blockMenu(anchor, i) {
  const n = story.blocks.length;
  const move = (d) => { const j = i + d; [story.blocks[i], story.blocks[j]] = [story.blocks[j], story.blocks[i]]; if (selected === i) selected = j; changed(); renderRail(); };
  menu(anchor, [
    { label: 'Move up', icon: 'up', disabled: i === 0, onClick: () => move(-1) },
    { label: 'Move down', icon: 'down', disabled: i === n - 1, onClick: () => move(1) },
    { label: 'Duplicate', icon: 'copy', onClick: () => { story.blocks.splice(i + 1, 0, clone(story.blocks[i])); selected = i + 1; changed(); renderRail(); } },
    'sep',
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => removeAt(story.blocks, i, 'Block deleted', () => { if (selected === i) selected = null; else if (selected > i) selected--; }) },
  ]);
}

function removeAt(arr, i, message, after) {
  const [item] = arr.splice(i, 1);
  after?.();
  changed();
  renderRail();
  toast(message, { action: { label: 'Undo', onClick: () => { arr.splice(i, 0, item); changed(); renderRail(); } } });
}

function peek(b) {
  const raw = b.title || b.html || b.text || b.caption || b.url || (b.slides && `${b.slides.length} cards`) || (b.places && `${b.places.length} places`) || (b.items && b.items.map((x) => x.value).join(' · ')) || '';
  return String(raw).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function addBlockAt(index, block) {
  story.blocks.splice(index, 0, block);
  selected = index;
  tab = 'content';
  syncTabs();
  changed();
  renderRail();
  requestAnimationFrame(() => $(`.blk[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  setTimeout(() => post({ type: 'select', index, scroll: true }), 450);
}
const insertIndex = () => (selected != null ? selected + 1 : story.blocks.length);

function openBlockPicker(index) {
  const dlg = dialog({
    title: 'Add a block',
    cls: 'dlg-lg',
    body: h('div', { class: 'picker-groups' }, GROUPS.map((g) => h('section', { class: 'picker-group' },
      h('h3', {}, g),
      h('div', { class: 'picker-grid' }, Object.entries(CATALOG).filter(([, c]) => c.group === g).map(([type, c]) =>
        h('button', { type: 'button', class: 'pick', onclick: () => {
          dlg.close();
          addBlockAt(index, { type, ...c.make() });
        } },
        h('span', { class: 'pick-icon' }, icon(c.icon, { size: 19 })),
        h('span', {}, h('strong', {}, c.label, c.isNew ? h('span', { class: 'new' }, 'New') : null), h('span', {}, c.desc)))))))),
  });
}

/* ---------- Story & data tabs ---------- */

function storyTab() {
  story.cover ||= {};
  return [
    h('div', { class: 'rail-section-title' }, 'Cover'),
    fields(story, [{ k: 'subtitle', t: 'textarea', label: 'Subtitle', placeholder: 'One line that makes people want to read on' }]),
    fields(story.cover, [{ k: 'kicker', label: 'Small label above the title (optional)' }, { k: 'image', t: 'image', label: 'Cover image' },
      { k: 'effect', t: 'seg', label: 'Cover motion', opts: [['none', 'Still'], ['parallax', 'Parallax'], ['zoom', 'Zoom']], dflt: 'parallax' }]),
    fields(story, [{ row: [{ k: 'author', label: 'Author' }, { k: 'date', label: 'Date' }] }]),
    h('div', { class: 'rail-section-title' }, 'Look & feel'),
    fields(story, [
      { k: 'theme', t: 'seg', label: 'Theme', opts: [['light', 'Light'], ['dark', 'Dark']], dflt: 'light' },
      { k: 'motion', t: 'seg', label: 'Scroll animations', opts: [['none', 'Off'], ['subtle', 'Subtle'], ['expressive', 'Expressive']], dflt: 'subtle',
        hint: 'How blocks animate into view as readers scroll. Readers who turn on "reduce motion" always get a still page.' }]),
    h('div', { class: 'rail-section-title' }, 'Credits'),
    fields(story, [{ k: 'credits', t: 'textarea', label: 'Sources and credits (shown at the end)' }]),
  ];
}

function dataTab() {
  const lib = (story.layers ||= []);
  lib.forEach(inspectLayer);
  const actions = h('div', { class: 'data-actions' },
    h('button', { type: 'button', class: 'btn btn-primary', onclick: openAddData }, icon('plus', { size: 16 }), 'Add data'),
    h('button', { type: 'button', class: 'btn', onclick: () => openAnalysis() }, icon('sparkle', { size: 16 }), 'Analyze'),
    h('button', { type: 'button', class: 'btn', onclick: openDraw }, icon('pen', { size: 16 }), 'Draw'));
  if (!lib.length) {
    return [actions, h('div', { class: 'data-empty' },
      h('span', { class: 'data-empty-art' }, icon('database', { size: 26 })),
      h('strong', {}, 'Bring your data to the map'),
      h('p', {}, 'Drop a GeoJSON or CSV file here, paste a link to an ArcGIS layer, or draw your own shapes. Then analyze it and turn it on in any map.'))];
  }
  return [
    actions,
    h('div', { class: 'rail-section-title' }, `Your layers · ${lib.length}`),
    h('div', { class: 'sub-list' }, lib.map((layer, i) => subItem(lib, i, {
      title: h('span', { class: 'row' }, h('span', { class: 'swatch', style: `background:${layer.style?.color || '#2563eb'}` }), layer.name || 'Layer',
        layer.analysis ? h('span', { class: 'pill no-dot', title: 'Made with an analysis tool' }, TOOLS[layer.analysis.tool]?.name || 'Analysis') : null),
      summary: layerStatus(layer), body: () => layerForm(layer), noun: 'Layer' }))),
    h('p', { class: 'field-hint', style: 'margin:12px 2px 0' }, 'Tip: drop GeoJSON or CSV files anywhere on this panel to add them.'),
  ];
}

function openLayer(id) {
  const layer = (story.layers || []).find((l) => l.id === id);
  if (layer) openSubs.add(layer);
  tab = 'data';
  syncTabs();
  renderRail();
  requestAnimationFrame(() => [...document.querySelectorAll('.sub')].at((story.layers || []).indexOf(layer))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

// Drop data files onto the Data tab to add them.
$('#rail').addEventListener('dragover', (e) => { if (tab === 'data' && e.dataTransfer.types.includes('Files')) { e.preventDefault(); $('#rail').classList.add('is-drop'); } });
$('#rail').addEventListener('dragleave', (e) => { if (!$('#rail').contains(e.relatedTarget)) $('#rail').classList.remove('is-drop'); });
$('#rail').addEventListener('drop', async (e) => {
  $('#rail').classList.remove('is-drop');
  if (tab !== 'data') return;
  const files = [...e.dataTransfer.files].filter((f) => /\.(geo)?json$|\.csv$/i.test(f.name));
  if (!files.length) return;
  e.preventDefault();
  for (const f of files) await addFromFile(f);
});

/* ---------- Fields ---------- */

function fields(obj, specs, extra) {
  return h('div', {}, specs.map((s) => s.row ? h('div', { class: 'grid-2' }, s.row.map((r) => field(obj, r))) : field(obj, s)), extra);
}

function labelEl(text, extra) { return text ? h('span', { class: 'field-label' }, h('span', {}, text), extra) : null; }

function field(obj, spec) {
  const set = (v) => { obj[spec.k] = v; changed(); };
  const val = obj[spec.k] ?? spec.dflt ?? '';
  const hint = spec.hint ? h('p', { class: 'field-hint' }, spec.hint) : null;
  switch (spec.t) {
    case 'rich': return richEditor(obj, spec.k);
    case 'textarea': return h('label', { class: 'field' }, labelEl(spec.label), h('textarea', { rows: 3, value: val, placeholder: spec.placeholder, oninput: (e) => set(e.target.value) }), hint);
    case 'number': return h('label', { class: 'field' }, labelEl(spec.label), h('input', { type: 'number', step: '0.5', value: val, oninput: (e) => set(e.target.value === '' ? undefined : +e.target.value) }), hint);
    case 'select': return h('label', { class: 'field' }, labelEl(spec.label),
      h('select', { onchange: (e) => set(e.target.value) }, spec.opts.map(([v, l]) => h('option', { value: v, selected: String(val) === v }, l))), hint);
    case 'seg': {
      const seg = h('div', { class: 'seg seg-block', role: 'group' }, spec.opts.map(([v, l]) => h('button', { type: 'button', class: String(val) === v ? 'is-on' : '',
        onclick: (e) => { set(v); seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b === e.currentTarget)); if (spec.k === 'display' || spec.k === 'mode') renderRail(); } }, l)));
      return h('div', { class: 'field' }, labelEl(spec.label), seg, hint);
    }
    case 'color': return h('label', { class: 'field' }, labelEl(spec.label),
      h('span', { class: 'row' }, h('input', { type: 'color', value: val || '#000000', oninput: (e) => { set(e.target.value); e.target.nextSibling.textContent = e.target.value; } }), h('span', { class: 'muted' }, val)), hint);
    case 'image': return imageField(obj, spec);
    case 'view': return viewField(obj, spec);
    case 'layerset': return layerSet(obj, spec);
    case 'slides': return listField(obj, 'slides', { noun: 'Card', make: makeSlide, form: slideForm, summary: (s) => peek(s) });
    case 'places': return listField(obj, 'places', { noun: 'Place', make: makePlace, form: placeForm, summary: (p) => p.title });
    case 'stats': return listField(obj, 'items', { noun: 'Number', make: () => ({ value: '100', label: '' }), summary: (it) => `${it.value} ${it.label || ''}`,
      form: (it) => fields(it, [{ row: [{ k: 'value', label: 'Number', placeholder: '1,200 or 98% or $3.4M' }, { k: 'label', label: 'What it means' }] }]) });
    case 'gallery': return listField(obj, 'images', { noun: 'Photo', make: () => ({ url: '', caption: '' }), summary: (im) => im.caption || (im.url ? 'Photo' : 'No image yet'),
      form: (im) => fields(im, [{ k: 'url', t: 'image', label: 'Photo' }, { k: 'caption', label: 'Caption' }, { k: 'alt', label: 'Alt text' }]) });
    default: return h('label', { class: 'field' }, labelEl(spec.label), h('input', { type: 'text', value: val, placeholder: spec.placeholder, oninput: (e) => set(e.target.value) }), hint);
  }
}

function richEditor(obj, key) {
  const ed = h('div', { class: 'rich-area', contenteditable: 'true', 'data-placeholder': 'Start writing…' });
  ed.innerHTML = sanitize(obj[key] || '');
  ed.addEventListener('input', () => { obj[key] = sanitize(ed.innerHTML); changed(); });
  const cmd = (c, v) => (e) => { e.preventDefault(); ed.focus(); document.execCommand(c, false, v); };
  const btn = (title, content, fn) => h('button', { type: 'button', title, 'aria-label': title, onmousedown: fn }, content);
  const bar = h('div', { class: 'rich-bar' },
    btn('Bold', icon('bold', { size: 15 }), cmd('bold')),
    btn('Italic', icon('italic', { size: 15 }), cmd('italic')),
    btn('Heading', 'H2', cmd('formatBlock', 'H2')),
    btn('Subheading', 'H3', cmd('formatBlock', 'H3')),
    btn('Normal text', '¶', cmd('formatBlock', 'P')),
    btn('Bulleted list', icon('list', { size: 15 }), cmd('insertUnorderedList')),
    btn('Link', icon('link', { size: 15 }), (e) => { e.preventDefault(); const u = prompt('Link address (https://…)'); if (u) { ed.focus(); document.execCommand('createLink', false, u); } }));
  return h('div', { class: 'rich' }, bar, ed);
}

function imageField(obj, spec) {
  const wrap = h('div', { class: 'field' });
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true, onchange: (e) => { upload(e.target.files[0]); e.target.value = ''; } });
  const set = (url) => { obj[spec.k] = url; changed(); draw(); };
  const upload = async (file) => {
    if (!file) return;
    draw(true);
    try { set((await uploadImage(file)).url); toast('Image uploaded', { tone: 'ok', duration: 1800 }); } catch (e) { draw(); toast(e.message, { tone: 'error' }); }
  };
  const draw = (uploading = false) => {
    const url = obj[spec.k];
    const urlBox = h('details', { class: 'img-url' }, h('summary', {}, 'or paste an image link'),
      h('input', { class: 'input', type: 'text', value: url || '', placeholder: 'https://…', onchange: (e) => set(e.target.value.trim()) }));
    wrap.replaceChildren(...kids(labelEl(spec.label || 'Image'),
      uploading ? h('div', { class: 'img-drop' }, h('div', { class: 'uploading' }, h('span', { class: 'spinner' }), 'Uploading…'))
        : url ? h('div', { class: 'img-preview' }, h('img', { src: url, alt: '' }),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn btn-sm', onclick: () => fileInput.click() }, 'Replace'),
            h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openLibrary(set) }, 'Library'),
            h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': 'Remove image', onclick: () => set('') }, icon('trash', { size: 14 }))))
          : h('div', { class: 'img-drop' }, icon('image', { size: 24 }), h('p', {}, 'Drop an image here'),
            h('div', { class: 'row' },
              h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => fileInput.click() }, icon('upload', { size: 14 }), 'Upload'),
              h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openLibrary(set) }, 'From library'))),
      url && !uploading ? null : urlBox, fileInput));
  };
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.querySelector('.img-drop, .img-preview')?.classList.add('is-drop'); });
  wrap.addEventListener('dragleave', () => wrap.querySelector('.is-drop')?.classList.remove('is-drop'));
  wrap.addEventListener('drop', (e) => { e.preventDefault(); upload(e.dataTransfer.files[0]); });
  draw();
  return wrap;
}

function openLibrary(onPick) {
  const grid = h('div', { class: 'library' }, h('p', { class: 'muted' }, 'Loading…'));
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', multiple: true, hidden: true });
  const refresh = async () => {
    const { uploads } = await api('GET', '/api/uploads');
    grid.replaceChildren(...(uploads.length ? uploads.map((u) => h('figure', { class: 'lib-item' },
      h('button', { type: 'button', class: 'lib-pick', title: u.name || 'Use this image', onclick: () => { onPick(u.url); dlg.close(); } }, h('img', { src: u.url, alt: u.name || '', loading: 'lazy' })),
      h('button', { type: 'button', class: 'icon-btn lib-del', 'aria-label': 'Delete image', onclick: async () => {
        if (!(await confirmDialog({ title: 'Delete this image?', message: 'Stories that use it will show a broken image.', confirmLabel: 'Delete', danger: true }))) return;
        await api('DELETE', `/api/uploads/${u.id}`);
        refresh();
      } }, icon('trash', { size: 15 })))) : [h('p', { class: 'muted' }, 'No images yet. Upload some to reuse them across stories.')]));
  };
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    grid.prepend(h('p', { class: 'uploading', style: 'grid-column:1/-1' }, h('span', { class: 'spinner' }), `Uploading ${files.length}…`));
    for (const f of files) await uploadImage(f).catch((e) => toast(`${f.name}: ${e.message}`, { tone: 'error' }));
    fileInput.value = '';
    refresh();
  });
  const dlg = dialog({ title: 'Your images', cls: 'dlg-lg', body: grid,
    actions: [fileInput, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => fileInput.click() }, icon('upload', { size: 16 }), 'Upload images')] });
  refresh().catch((e) => grid.replaceChildren(h('p', { class: 'form-error' }, e.message)));
}

const viewSummary = (v = {}) => {
  const bits = [`Zoom ${Math.round((v.zoom ?? 0) * 10) / 10}`];
  if ((v.markers || []).length) bits.push(`${v.markers.length} marker${v.markers.length > 1 ? 's' : ''}`);
  if ((v.layers || []).length) bits.push(`${v.layers.length} layer${v.layers.length > 1 ? 's' : ''}`);
  return bits.join(' · ');
};

function viewField(obj, spec) {
  const wrap = h('div', { class: 'field' });
  const draw = () => {
    const v = obj[spec.k] || {};
    wrap.replaceChildren(labelEl(spec.label || 'Map'), h('div', { class: 'mapfield' },
      h('span', { class: `mapfield-thumb bm-${v.basemap || 'streets'}` }, icon('map', { size: 20 })),
      h('span', { class: 'mapfield-text' }, h('strong', {}, BASEMAPS[v.basemap]?.label || 'Streets'), viewSummary(v)),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openPicker({ mode: 'view', value: obj[spec.k], noMarkers: spec.noMarkers, noLayers: spec.noLayers },
        (nv) => { obj[spec.k] = nv; changed(); draw(); }) }, icon('pin', { size: 14 }), 'Edit map')));
  };
  draw();
  return wrap;
}

const openSubs = new WeakSet();
function subItem(arr, i, { title, summary, body, noun }) {
  const item = arr[i];
  const open = openSubs.has(item);
  const n = arr.length;
  const move = (d) => { [arr[i], arr[i + d]] = [arr[i + d], arr[i]]; changed(); renderRail(); };
  const more = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${noun} options`, onclick: (e) => {
    e.stopPropagation();
    menu(e.currentTarget, [
      { label: 'Move up', icon: 'up', disabled: i === 0, onClick: () => move(-1) },
      { label: 'Move down', icon: 'down', disabled: i === n - 1, onClick: () => move(1) },
      { label: 'Duplicate', icon: 'copy', onClick: () => { const c = clone(item); if (c.id) c.id = uid(c.id[0]); arr.splice(i + 1, 0, c); openSubs.add(c); changed(); renderRail(); } },
      'sep',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => removeAt(arr, i, `${noun} deleted`) },
    ]);
  } }, icon('more'));
  return h('div', { class: 'sub' },
    h('div', { class: 'sub-head', style: 'cursor:pointer', onclick: () => { open ? openSubs.delete(item) : openSubs.add(item); renderRail(); } },
      icon(open ? 'chevron' : 'back', { size: 14, cls: open ? '' : 'rot' }),
      h('span', {}, title), h('span', { class: 'muted' }, summary || ''), more),
    open ? h('div', { class: 'sub-body' }, body()) : null);
}

function listField(obj, key, { noun, make, form, summary }) {
  const items = (obj[key] ||= []);
  return h('div', { class: 'sub-list' },
    items.map((it, i) => subItem(items, i, { title: `${noun} ${i + 1}`, summary: summary?.(it), body: () => form(it), noun })),
    h('button', { type: 'button', class: 'btn btn-sm sub-add', onclick: () => { const it = make(); items.push(it); openSubs.add(it); changed(); renderRail(); } }, icon('plus', { size: 14 }), `Add ${noun.toLowerCase()}`));
}

function slideForm(slide) {
  slide.media ||= { type: 'map', view: view() };
  const m = slide.media;
  const rich = richEditor(slide, 'html');
  const kind = m.type || 'map';
  return h('div', {},
    rich,
    h('div', { class: 'field' }, labelEl('Beside this card, show'),
      h('div', { class: 'seg seg-block' }, [['map', 'Map'], ['image', 'Image'], ['video', 'Video'], ['embed', 'Embed']].map(([v, l]) =>
        h('button', { type: 'button', class: kind === v ? 'is-on' : '', onclick: () => { m.type = v; if (v === 'map') m.view ||= view(); changed(); renderRail(); } }, l)))),
    kind === 'map' ? field(m, { k: 'view', t: 'view', label: 'Map for this card' })
      : fields(m, [{ k: 'url', t: kind === 'image' ? 'image' : undefined, label: kind === 'image' ? 'Image' : kind === 'video' ? 'Video link' : 'Page link' }, { k: 'alt', label: 'Description' }]),
    actionsField(slide, rich.querySelector('.rich-area')));
}

// Map actions: alternate views triggered by #action:<id> links in the card text.
function actionsField(slide, editor) {
  const actions = (slide.actions ||= []);
  const insertLink = (a) => (e) => {
    e.preventDefault();
    const sel = getSelection();
    const inEditor = sel.rangeCount && editor.contains(sel.anchorNode);
    if (inEditor && !sel.isCollapsed) document.execCommand('createLink', false, `#action:${a.id}`);
    else {
      const link = h('a', { href: `#action:${a.id}` }, a.label || 'see on map');
      let target = editor.lastElementChild;
      if (!target || !/^(P|H2|H3|H4|LI)$/.test(target.tagName)) target = editor.appendChild(h('p'));
      target.append(' ', link);
    }
    editor.dispatchEvent(new Event('input'));
    toast('Link added to the card text', { tone: 'ok', duration: 1800 });
  };
  return h('div', { class: 'field' },
    labelEl('Map actions', h('span', { class: 'muted', style: 'font-weight:400' }, 'optional')),
    h('p', { class: 'field-hint', style: 'margin:0 0 8px' }, 'Links in the text that move the map somewhere else. Select some words in the text, then press "Link selected words".'),
    h('div', { class: 'sub-list', style: 'margin-top:0' }, actions.map((a, i) => subItem(actions, i, {
      title: a.label || `Action ${i + 1}`, summary: viewSummary(a.view), noun: 'Action',
      body: () => h('div', {},
        field(a, { k: 'label', label: 'Link text' }),
        field(a, { k: 'view', t: 'view', label: 'Where the map goes' }),
        h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { type: 'button', class: 'btn btn-sm', onmousedown: insertLink(a) }, icon('link', { size: 14 }), 'Link selected words'))),
    })),
    h('button', { type: 'button', class: 'btn btn-sm sub-add', onclick: () => {
      const a = { id: uid('a'), label: 'see on map', view: clone(slide.media?.view || view()) };
      actions.push(a); openSubs.add(a); changed(); renderRail();
    } }, icon('plus', { size: 14 }), 'Add map action')));
}

function layerSet(obj, spec) {
  const lib = story.layers || [];
  const ids = (obj[spec.k] ||= []);
  return h('div', { class: 'field' }, labelEl(spec.label),
    lib.length ? h('div', {}, lib.map((l) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: ids.includes(l.id), onchange: (e) => {
        const i = ids.indexOf(l.id);
        if (e.target.checked && i < 0) ids.push(l.id);
        if (!e.target.checked && i >= 0) ids.splice(i, 1);
        changed();
      } }), h('span', { class: 'swatch', style: `background:${l.style?.color || '#2563eb'}` }), l.name || l.id)))
      : h('p', { class: 'field-hint', style: 'margin:0' }, 'No data yet. Add layers in the Data tab.'));
}

function placeForm(place) {
  const loc = h('span', { class: 'mapfield-text' }, h('strong', {}, 'Location'), place.lngLat.map((n) => n.toFixed(4)).join(', '));
  return h('div', {},
    field(place, { k: 'title', label: 'Name' }),
    h('div', { class: 'field' }, h('div', { class: 'mapfield' }, h('span', { class: 'mapfield-thumb' }, icon('pin', { size: 20 })), loc,
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openPicker({ mode: 'point', value: { center: place.lngLat, zoom: 14 } },
        (p) => { place.lngLat = p; changed(); renderRail(); }) }, 'Pick on map'))),
    field(place, { k: 'image', t: 'image', label: 'Photo' }),
    richEditor(place, 'html'));
}

/* ---------- Data layers ---------- */

const layerInfo = {};
const layerStatus = (l) => {
  const i = layerInfo[l.id] || {};
  return i.loading ? 'Loading…' : i.error ? 'Could not load' : i.count != null ? `${i.count.toLocaleString()} ${i.count === 1 ? 'feature' : 'features'}` : 'No data yet';
};
const sourceKey = (l) => (l.data ? `data:${l.data.features?.length}` : `url:${l.url || ''}`);

function inspectLayer(layer) {
  const key = sourceKey(layer);
  if (layerInfo[layer.id]?.key === key) return;
  if (!layer.data && !layer.url) { layerInfo[layer.id] = { key }; return; }
  layerInfo[layer.id] = { key, loading: true };
  const done = (info) => { if (layerInfo[layer.id]?.key === key) { layerInfo[layer.id] = { key, ...info }; if (tab === 'data') renderRail(); } };
  loadLayerData(layer).then((fc) => done({ count: fc.features.length, fields: fieldNames(fc), fc })).catch((err) => done({ error: err.message }));
}

function layerForm(layer) {
  layer.style ||= {};
  layer.popup ||= {};
  const st = layer.style;
  const info = layerInfo[layer.id] || {};
  const flds = info.fields || [];
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
      if (layer.name === 'New layer') layer.name = file.name.replace(/\.\w+$/, '');
      const kb = Math.round(JSON.stringify(fc).length / 1024);
      if (kb > 3000) toast(`That file is ${kb.toLocaleString()} KB. Large files make stories slow; hosting it and using a link is better.`, { duration: 7000 });
      changed(); renderRail();
    } catch (err) { toast(`Could not read file: ${err.message}`, { tone: 'error' }); }
  } });
  const cats = st.mode === 'categorical' && st.field && info.fc ? colorRamp(layer, info.fc).legend.entries.filter(([v]) => v !== 'Other') : [];
  const status = info.loading ? h('span', { class: 'pill' }, 'Loading…') : info.error ? h('span', { class: 'pill is-error' }, info.error)
    : info.count != null ? h('span', { class: 'pill is-live' }, `${info.count.toLocaleString()} features · ${flds.length} fields`) : null;

  const isPoints = info.fc ? kinds(info.fc).has('point') : false;
  const a = layer.analysis;
  const inputNames = a ? Object.values(a.inputs).map((id) => (story.layers || []).find((l) => l.id === id)?.name || 'a deleted layer').join(' and ') : '';
  return h('div', {},
    a ? h('div', { class: 'provenance' }, icon('sparkle', { size: 15 }),
      h('span', {}, `${TOOLS[a.tool]?.name || 'Analysis'} of ${inputNames}`),
      h('button', { type: 'button', class: 'btn btn-sm', title: 'Run the analysis again with the latest data', onclick: () => rerunAnalysis(layer) }, icon('refresh', { size: 14 }), 'Re-run')) : null,
    field(layer, { k: 'name', label: 'Name (shown in the legend)' }),
    a ? null : h('div', { class: 'field' }, labelEl('Data'),
      h('div', { class: 'row' },
        h('input', { class: 'input', type: 'text', value: layer.data ? '' : layer.url || '', placeholder: layer.data ? `Uploaded file (${layer.data.features.length} features)` : 'Paste a GeoJSON or ArcGIS layer link',
          onchange: (e) => { layer.url = e.target.value.trim(); delete layer.data; changed(); renderRail(); } }),
        h('button', { type: 'button', class: 'btn', title: 'Upload GeoJSON or CSV', onclick: () => fileInput.click() }, icon('upload', { size: 15 }), 'File'), fileInput),
      h('p', { class: 'field-hint' }, 'GeoJSON link, public ArcGIS FeatureServer layer, or a .geojson / .csv file (CSV needs lat and lon columns).'),
      status ? h('div', { style: 'margin-top:8px' }, status) : null),
    info.fc ? [h('div', { class: 'rail-section-title' }, 'Insights'), insightsPanel(layer, info.fc)] : null,
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
    fieldSelect(st, 'label', 'Show labels from'),
    h('div', { class: 'rail-section-title' }, 'Popup'),
    field(layer.popup, { k: 'title', label: 'Popup title', placeholder: flds[0] ? `{${flds[0]}}` : '{name}', hint: 'Put field names in braces, like {NAME}.' }),
    h('label', { class: 'field' }, labelEl('Fields to list'),
      h('input', { type: 'text', value: (layer.popup.fields || []).join(', '), placeholder: flds.slice(0, 4).join(', ') || 'Leave blank to show the first few',
        oninput: (e) => { layer.popup.fields = e.target.value.split(',').map((f) => f.trim()).filter(Boolean); changed(); } })));
}

/* ---------- Map picker ---------- */

let pickerMap = null;
function openPicker({ mode, value, noMarkers, noLayers }, done) {
  const v = view(clone(value || {}));
  const markers = clone(v.markers || []);
  const lib = story.layers || [];
  const visible = [...(v.layers || [])];
  let point = mode === 'point' ? [...v.center] : null;
  const mapEl = h('div', { class: 'map' });
  const markerList = h('div');
  const search = h('input', { type: 'search', placeholder: 'Search for a place', 'aria-label': 'Search for a place',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); geocode(search.value); } } });

  const basemaps = h('div', { class: 'basemaps' }, BASEMAP_OPTS.map(([k, l]) => h('button', { type: 'button', class: `bm ${k === v.basemap ? 'is-on' : ''}`, onclick: (e) => {
    pickerMap.setStyle(BASEMAPS[k].style, { diff: false });
    pickerMap._basemap = k;
    basemaps.querySelectorAll('.bm').forEach((b) => b.classList.toggle('is-on', b === e.currentTarget));
  } }, h('span', { class: `bm-swatch-${k}` }), h('span', {}, l))));

  const drawMarkers = () => {
    if (mode === 'point') { setMarkers(pickerMap, [{ lngLat: point }]); return; }
    setMarkers(pickerMap, markers);
    markerList.replaceChildren(...(markers.length ? markers.map((mk, i) => h('div', { class: 'marker-row' },
      h('span', { class: 'marker-num' }, String(i + 1)),
      h('input', { type: 'text', value: mk.title || '', placeholder: 'Label (optional)', oninput: (e) => { mk.title = e.target.value; } }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove marker', onclick: () => { markers.splice(i, 1); drawMarkers(); } }, icon('x', { size: 15 }))))
      : [h('p', { class: 'field-hint', style: 'margin:0' }, 'Click the map to drop a marker.')]));
  };

  const side = h('div', { class: 'mp-side' },
    mode === 'point' ? h('p', { class: 'muted', style: 'margin:0' }, 'Click the map to place this stop, or search for it.') : [
      h('h4', {}, 'Basemap'), basemaps,
      noMarkers ? null : [h('h4', {}, 'Markers'), markerList],
      noLayers || !lib.length ? null : [h('h4', {}, 'Data layers'), lib.map((l) => h('div', { class: 'row' },
        h('label', { class: 'check', style: 'flex:1' }, h('input', { type: 'checkbox', checked: visible.includes(l.id), onchange: (e) => {
          const i = visible.indexOf(l.id);
          if (e.target.checked && i < 0) visible.push(l.id);
          if (!e.target.checked && i >= 0) visible.splice(i, 1);
          setVisibleLayers(pickerMap, lib.filter((x) => visible.includes(x.id)).map((x) => x.id));
        } }), h('span', { class: 'swatch', style: `background:${l.style?.color || '#2563eb'}` }), l.name || l.id),
        h('button', { type: 'button', class: 'icon-btn', title: 'Zoom to layer', 'aria-label': `Zoom to ${l.name}`, onclick: () => fitToLayer(pickerMap, l.id) }, icon('search', { size: 15 })))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v.legend !== false, onchange: (e) => { pickerMap._legend.enabled = e.target.checked; pickerMap._legend.render(pickerMap); } }), 'Show legend')],
      h('h4', {}, 'Tips'),
      h('p', { class: 'field-hint', style: 'margin:0' }, 'Drag to move. Scroll to zoom. Right-drag to rotate, Ctrl-drag to tilt.')]);

  const dlg = dialog({
    title: mode === 'point' ? 'Pick a location' : 'Edit map',
    cls: 'dlg-xl',
    body: h('div', { class: 'mp' }, h('div', { class: 'mp-map' }, mapEl,
      h('div', { class: 'mp-search' }, icon('search', { size: 16 }), search),
      h('div', { class: 'mp-hint' }, mode === 'point' ? 'Click to place' : noMarkers ? 'Frame the view you want' : 'Frame the view · click to add a marker')), side),
    actions: [
      h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
        const out = { ...readView(pickerMap), markers: noMarkers ? [] : markers };
        if (noLayers) delete out.layers;
        done(mode === 'point' ? point : out);
        dlg.close();
      } }, icon('check', { size: 16 }), mode === 'point' ? 'Use this spot' : 'Use this view'),
    ],
    onClose: () => { pickerMap?.remove(); pickerMap = null; },
  });
  dlg.querySelector('.dlg-body').style.padding = '0';
  pickerMap = createMap(mapEl, { ...v, markers: [], layers: visible }, { library: lib });
  pickerMap.scrollZoom.enable();
  setTimeout(() => pickerMap?.resize(), 260); // after the dialog's open animation
  pickerMap.on('click', (e) => {
    const ll = [+e.lngLat.lng.toFixed(5), +e.lngLat.lat.toFixed(5)];
    if (mode !== 'point' && pickerMap.queryRenderedFeatures(e.point).some((f) => f.layer.id.startsWith('dl-'))) return;
    if (mode === 'point') point = ll;
    else if (!noMarkers) markers.push({ lngLat: ll, title: '' });
    drawMarkers();
  });
  drawMarkers();

  async function geocode(q) {
    if (!q?.trim()) return;
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const [hit] = await fetch(url).then((r) => r.json()).catch(() => []);
    if (!hit) { toast('No place found with that name', { tone: 'error' }); return; }
    const ll = [+hit.lon, +hit.lat];
    pickerMap.flyTo({ center: ll, zoom: 14 });
    if (mode === 'point') { point = ll.map((n) => +n.toFixed(5)); drawMarkers(); }
  }
}

/* ---------- Publishing ---------- */

const slugify = (s) => String(s || 'story').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 48).replace(/^-|-$/g, '') || 'story';

function openPublish() {
  const origin = location.origin;
  const body = h('div');
  const foot = h('div', { class: 'row', style: 'width:100%' });
  const dlg = dialog({ title: 'Share', cls: 'dlg-sm', body, actions: [foot] });
  dlg.querySelector('.dlg-foot').style.justifyContent = 'stretch';

  const run = async (path, payload) => {
    try {
      await flush();
      setMeta(await api('POST', `/api/stories/${meta.id}/${path}`, payload));
      if (path === 'publish') toast('Your story is live', { tone: 'ok' });
      else toast('Story unpublished');
      draw();
    } catch (e) { toast(e.message, { tone: 'error' }); }
  };

  const draw = () => {
    if (!meta.url) {
      const slug = h('input', { type: 'text', value: meta.slug || slugify(story.title), spellcheck: 'false', 'aria-label': 'Link name' });
      body.replaceChildren(h('div', { class: 'pub-hero' },
        h('div', { class: 'pub-badge' }, icon('globe', { size: 26 })),
        h('h3', {}, 'Publish your story'),
        h('p', {}, 'Anyone with the link can read it. Keep editing afterward. Readers only see changes when you publish again.')),
      h('div', { class: 'pub-link' }, h('span', { class: 'prefix' }, `${origin.replace(/^https?:\/\//, '')}/s/`), slug));
      foot.replaceChildren(h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Not yet'),
        h('button', { type: 'button', class: 'btn btn-brand', onclick: () => run('publish', { slug: slug.value.trim().toLowerCase() || undefined }) }, icon('globe', { size: 16 }), 'Publish'));
      setTimeout(() => slug.focus(), 50);
      return;
    }
    const full = origin + meta.url;
    body.replaceChildren(...kids(h('div', { class: 'pub-hero' },
      h('div', { class: 'pub-badge is-live' }, icon('check', { size: 26 })),
      h('h3', {}, 'Your story is live'),
      h('p', {}, `Published ${relTime(meta.publishedAt)}.`)),
    h('div', { class: 'pub-link' }, h('a', { href: meta.url, target: '_blank', rel: 'noopener' }, full.replace(/^https?:\/\//, '')),
      h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: async (e) => { if (await copyText(full)) { e.currentTarget.replaceChildren(icon('check', { size: 14 }), 'Copied'); toast('Link copied', { tone: 'ok', duration: 1500 }); } } }, icon('copy', { size: 14 }), 'Copy'),
      h('a', { class: 'btn btn-sm', href: meta.url, target: '_blank', rel: 'noopener', 'aria-label': 'Open the live story' }, icon('external', { size: 14 }))),
    meta.hasUnpublishedChanges ? h('div', { class: 'pub-changes' }, icon('sparkle', { size: 16 }), 'You have edits readers haven\'t seen yet.') : null));
    foot.replaceChildren(
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: async () => {
        if (await confirmDialog({ title: 'Unpublish this story?', message: 'The link will stop working for everyone until you publish again.', confirmLabel: 'Unpublish', danger: true })) run('unpublish', {});
      } }, 'Unpublish'),
      h('span', { class: 'spacer' }),
      meta.hasUnpublishedChanges
        ? h('button', { type: 'button', class: 'btn btn-brand', onclick: () => run('publish', {}) }, icon('upload', { size: 16 }), 'Publish changes')
        : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done'));
  };
  draw();
}

/* ---------- Command palette ---------- */

function commands() {
  const go = (t) => () => { tab = t; syncTabs(); renderRail(); };
  return [
    ...Object.entries(CATALOG).map(([type, c]) => ({ label: `Add ${c.label.toLowerCase()}`, hint: c.desc, icon: c.icon, group: 'Add a block', run: () => addBlockAt(insertIndex(), { type, ...c.make() }) })),
    { label: 'Add data…', hint: 'Upload a file, paste a link, or use sample data', icon: 'database', group: 'Data', run: openAddData },
    { label: 'Draw & measure on a map', hint: 'Sketch points, routes and areas', icon: 'pen', group: 'Data', run: openDraw },
    ...Object.entries(TOOLS).map(([id, t]) => ({ label: `Analyze: ${t.name}`, hint: t.desc, icon: t.icon, group: 'Data', run: () => openAnalysis({ tool: id }) })),
    ...story.blocks.map((b, i) => ({ label: `${i + 1}. ${CATALOG[b.type]?.label || b.type}`, hint: peek(b), icon: CATALOG[b.type]?.icon || 'file', group: 'Go to block', run: () => { selected = null; select(i); } })),
    { label: 'Content', hint: 'Blocks in your story', icon: 'text', group: 'Go to', run: go('content') },
    { label: 'Story settings', hint: 'Cover, theme, scroll animations', icon: 'sliders', group: 'Go to', run: go('story') },
    { label: 'Data layers', hint: 'Your data and analyses', icon: 'layers', group: 'Go to', run: go('data') },
    { label: 'Publish…', icon: 'globe', group: 'Story', run: openPublish },
    { label: 'Preview in a new tab', icon: 'external', group: 'Story', run: () => $('#btn-preview').click() },
    { label: 'Undo', icon: 'undo', group: 'Story', run: undo, keys: `${modKey}Z` },
    { label: 'Redo', icon: 'redo', group: 'Story', run: redo, keys: `${modKey}⇧Z` },
    { label: 'Download story file', icon: 'download', group: 'Story', run: downloadStory },
    { label: 'Keyboard shortcuts', icon: 'keyboard', group: 'Help', run: openShortcuts, keys: '?' },
    { label: 'All stories', icon: 'back', group: 'Help', run: () => { location.href = '/'; } },
  ];
}

function openPalette() {
  const all = commands();
  let shown = all;
  let active = 0;
  const input = h('input', { class: 'pal-input', type: 'text', placeholder: 'Type a command, a block, or an analysis…', 'aria-label': 'Search commands', autocomplete: 'off' });
  const list = h('div', { class: 'pal-list', role: 'listbox' });
  const draw = () => {
    let group = null;
    list.replaceChildren(...(shown.length ? shown.flatMap((c, i) => {
      const out = [];
      if (c.group !== group) { group = c.group; out.push(h('div', { class: 'pal-group' }, group)); }
      out.push(h('button', { type: 'button', role: 'option', class: `pal-item ${i === active ? 'is-active' : ''}`, 'aria-selected': i === active,
        onmousemove: () => { if (active !== i) { active = i; draw(); } }, onclick: () => pick(c) },
      icon(c.icon, { size: 16 }), h('span', { class: 'pal-label' }, c.label, c.hint ? h('span', { class: 'pal-hint' }, c.hint) : null),
      c.keys ? h('kbd', {}, c.keys) : null));
      return out;
    }) : [h('p', { class: 'muted', style: 'padding:14px' }, 'No matching commands.')]));
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (c) => { dlg.close(); setTimeout(c.run, 0); };
  input.addEventListener('input', () => {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = all.filter((c) => { const t = `${c.label} ${c.hint || ''} ${c.group}`.toLowerCase(); return words.every((w) => t.includes(w)); });
    active = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); draw(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
    if (e.key === 'Enter' && shown[active]) { e.preventDefault(); pick(shown[active]); }
  });
  const dlg = dialog({ title: 'Commands', cls: 'dlg-palette', body: h('div', {}, h('div', { class: 'pal-search' }, icon('search', { size: 17 }), input), list) });
  dlg.querySelector('.dlg-head').remove();
  dlg.querySelector('.dlg-body').style.padding = '0';
  draw();
  input.focus();
}

function openShortcuts() {
  const rows = [
    [`${modKey}K`, 'Find any command'], ['/', 'Add a block'], [`${modKey}Z`, 'Undo'], [`${modKey}⇧Z`, 'Redo'], [`${modKey}S`, 'Save now'],
    ['Delete', 'Delete the open block'], [`${modKey}D`, 'Duplicate the open block'], ['Alt ↑ / ↓', 'Move the open block'], ['Esc', 'Close the open block'], ['?', 'Show this list'],
  ];
  dialog({ title: 'Keyboard shortcuts', cls: 'dlg-sm', body: h('div', { class: 'keys' }, rows.map(([k, v]) => h('div', {}, h('span', {}, v), h('kbd', {}, k)))) });
}

function downloadStory() {
  const blob = new Blob([JSON.stringify(story, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${slugify(story.title)}.waymark.json` });
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- Top bar ---------- */

$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);
$('#btn-cmd').addEventListener('click', openPalette);
$('#btn-cmd').title = `Commands (${modKey}K)`;
$('#cmd-kbd').textContent = `${modKey}K`;

$('#title-input').addEventListener('input', (e) => { story.title = e.target.value; setTitle(story.title || 'Editor'); changed(); });
$('#title-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#btn-publish').addEventListener('click', openPublish);
$('#btn-preview').addEventListener('click', async () => {
  const win = window.open('', '_blank');
  try { await flush(); } catch { /* preview the last saved version */ }
  if (win) win.location = `/viewer.html?draft=${meta.id}`;
});
$('#btn-more').addEventListener('click', (e) => menu(e.currentTarget, [
  { label: 'Open preview in new tab', icon: 'external', onClick: () => $('#btn-preview').click() },
  { label: 'Story settings', icon: 'sliders', onClick: () => { tab = 'story'; syncTabs(); renderRail(); } },
  'sep',
  { label: 'Keyboard shortcuts', icon: 'keyboard', onClick: openShortcuts },
  { label: 'Download as file', icon: 'download', onClick: downloadStory },
  { label: 'Import a story file…', icon: 'upload', onClick: () => {
    const input = h('input', { type: 'file', accept: 'application/json,.json', onchange: async () => {
      try {
        const s = JSON.parse(await input.files[0].text());
        if (!Array.isArray(s.blocks)) throw new Error('This file is not a story');
        const { id, ...imported } = s;
        const created = await api('POST', '/api/stories', { story: imported });
        location.href = `/builder.html?id=${created.id}`;
      } catch (err) { toast(`Could not import: ${err.message}`, { tone: 'error' }); }
    } });
    input.click();
  } },
]));

initWorkbench({
  story: () => story,
  changed,
  renderRail,
  openLayer,
  insertBlock: (block) => { addBlockAt(insertIndex(), block); toast('Added to your story', { tone: 'ok' }); },
});

load();
