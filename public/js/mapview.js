// Public page for a saved map (/m/<id>): the map with its legend, bookmarks and time slider, nothing to edit.
// Add ?embed=1 to drop the header for use inside another website.
import { createMap, applyView } from './maps.js';
import { api } from './api.js';
import { h, icon, logo, setTitle, BRAND } from './ui.js';

const params = new URLSearchParams(location.search);
const id = /^\/m\/([\w-]+)/.exec(location.pathname)?.[1] || params.get('id');
const embed = params.has('embed');
document.documentElement.classList.toggle('is-embed', embed);
const root = document.getElementById('page');

async function load() {
  const pub = await fetch(`/api/public/maps/${encodeURIComponent(id)}`);
  if (pub.ok) return pub.json();
  try { return (await api('GET', `/api/maps/${encodeURIComponent(id)}`)).map; } catch { return null; } // yours or shared with you, when signed in
}

const doc = await load();
if (!doc) {
  root.replaceChildren(h('main', { class: 'pv-missing' }, h('h1', {}, 'This map isn\'t available'), h('p', {}, 'It may have been deleted, or it isn\'t shared by link.'), h('a', { class: 'btn btn-primary', href: '/' }, 'Go to Waymark')));
} else {
  setTitle(doc.title || 'Map');
  const mapEl = h('div', { class: 'pv-map' });
  const bookmarks = doc.bookmarks || [];
  const view = { ...doc.view, markers: [] };
  let map;
  const go = (bm) => applyView(map, bm ? { ...view, ...bm.view, layers: bm.layers ?? view.layers, time: bm.time, markers: [] } : view);
  const note = h('p', { class: 'pv-note', hidden: true });
  const picker = bookmarks.length ? h('select', { class: 'pv-bookmarks', 'aria-label': 'Go to a view', onchange: (e) => {
    const bm = bookmarks.find((b) => b.id === e.target.value);
    go(bm);
    note.hidden = !bm?.note;
    note.textContent = bm?.note || '';
  } }, h('option', { value: '' }, 'Starting view'), bookmarks.map((b) => h('option', { value: b.id }, b.name || 'Untitled view'))) : null;
  root.replaceChildren(
    embed ? null : h('header', { class: 'pv-head' },
      h('a', { href: '/', class: 'pv-logo', 'aria-label': BRAND.name }, logo({ size: 26, withName: false })),
      h('div', { class: 'pv-titles' }, h('h1', {}, doc.title || 'Untitled map'), doc.summary ? h('p', {}, doc.summary) : null),
      h('span', { class: 'spacer' }), picker),
    h('main', { class: 'pv-main' }, mapEl, note,
      embed ? h('div', { class: 'pv-embed-bar' }, picker, h('a', { href: location.pathname, target: '_blank', rel: 'noopener', title: 'Open the full map' }, doc.title || 'Open map', icon('external', { size: 13 }))) : null));
  map = createMap(mapEl, view, { library: doc.layers || [] });
  if (!embed) map.scrollZoom.enable();
  map.addControl(new maplibregl.FullscreenControl(), 'top-right');
}
