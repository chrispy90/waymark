// Tour builder for "Stop by stop" blocks: every stop on one big map, a reorderable list, and the selected stop's
// photo, title and text side by side. Drop a batch of photos and each becomes a stop where (and in the order) it was taken.
import { uploadImage } from './api.js';
import { h, icon, dialog, toast } from './ui.js';
import { createMap, DEFAULT_VIEW } from './maps.js';
import { readPhotoMeta, titleFromFilename } from './exif.js';
import { findPlaces } from './wizard.js';

const round = (c) => [+c[0].toFixed(6), +c[1].toFixed(6)];

/**
 * block: the stops block (edited in place). helpers: { story, changed, richEditor }.
 * Opens on stop `start`; `addPhotos` opens the file picker straight away.
 */
export function openTour(block, { story, changed, richEditor, onClose }, { start = 0, addPhotos = false } = {}) {
  const places = (block.places ||= []);
  let sel = places.length ? Math.min(start, places.length - 1) : -1;
  let mode = null; // 'add' (next map click adds a stop) | 'move' (next click moves the selected stop)
  let map;
  let markers = [];
  let busy = '';

  const listEl = h('ol', { class: 'tour-list', 'aria-label': 'Stops in order' });
  const editEl = h('div', { class: 'tour-edit' });
  const mapEl = h('div', { class: 'map' });
  const banner = h('div', { class: 'tour-banner', hidden: true });
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', multiple: true, hidden: true,
    onchange: () => { const files = [...fileInput.files]; fileInput.value = ''; addFromPhotos(files); } });
  const results = h('div', { class: 'tour-results', hidden: true });
  const q = h('input', { class: 'input', type: 'search', placeholder: 'Find a place to add…', 'aria-label': 'Find a place to add as a stop',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } if (e.key === 'Escape') results.hidden = true; } });

  const save = () => changed();
  const select = (i, { fly = true } = {}) => {
    sel = i;
    if (fly && map && places[i] && !places[i].needsLocation) map.easeTo({ center: places[i].lngLat, duration: 600 });
    render();
  };
  const setMode = (m) => {
    mode = m;
    mapEl.classList.toggle('is-placing', !!m);
    banner.hidden = !m;
    banner.replaceChildren(...(m ? [icon('pin', { size: 15 }), h('span', {}, m === 'add' ? 'Click the map where the new stop goes.' : `Click the map to place “${places[sel]?.title || 'this stop'}”.`),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => setMode(null) }, 'Cancel')] : []));
  };
  const addStop = (lngLat, extra = {}) => {
    const p = { title: extra.title || `Stop ${places.length + 1}`, lngLat: round(lngLat), image: extra.image || '', html: '' };
    places.push(p);
    save();
    select(places.length - 1, { fly: false });
    requestAnimationFrame(() => editEl.querySelector('.tour-title')?.select());
    return p;
  };
  const remove = (i) => {
    const [p] = places.splice(i, 1);
    save();
    sel = places.length ? Math.min(i, places.length - 1) : -1;
    render();
    toast(`Removed “${p.title || 'stop'}”`, { action: { label: 'Undo', onClick: () => { places.splice(i, 0, p); save(); select(i); } } });
  };
  const move = (from, to) => {
    if (to < 0 || to >= places.length || from === to) return;
    places.splice(to, 0, places.splice(from, 1)[0]);
    save();
    sel = to;
    render();
  };

  /* ----- Photos → stops ----- */
  async function addFromPhotos(files) {
    const imgs = files.filter((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type));
    if (!imgs.length) { toast('Choose JPEG, PNG, WebP or GIF photos', { tone: 'error' }); return; }
    const added = [];
    for (const [n, f] of imgs.entries()) {
      busy = `Adding photo ${n + 1} of ${imgs.length}…`;
      render();
      const meta = readPhotoMeta(await f.arrayBuffer()); // before upload: uploads are re-encoded without EXIF
      try {
        const { url } = await uploadImage(f);
        added.push({ title: titleFromFilename(f.name), image: url, meta, order: n });
      } catch (e) { toast(`${f.name}: ${e.message}`, { tone: 'error' }); }
    }
    busy = '';
    // in the order they were taken; photos without a time keep their place at the end
    added.sort((a, b) => (a.meta.takenAt ?? Infinity) - (b.meta.takenAt ?? Infinity) || a.order - b.order);
    const center = map ? map.getCenter().toArray() : DEFAULT_VIEW.center;
    const first = places.length;
    added.forEach((a, k) => places.push({ title: a.title || `Stop ${first + k + 1}`, lngLat: round(a.meta.lngLat || center), image: a.image, html: '',
      ...(a.meta.lngLat ? {} : { needsLocation: true }) }));
    save();
    const located = added.filter((a) => a.meta.lngLat).length;
    const missing = added.length - located;
    if (added.length) {
      sel = places.findIndex((p, i) => i >= first && p.needsLocation);
      if (sel < 0) sel = first;
      render();
      fit(places.slice(first).filter((p) => !p.needsLocation));
      toast(missing ? `Added ${added.length} stops. ${missing} had no location: click the map to place each one.` : `Added ${added.length} stops where the photos were taken.`,
        { tone: 'ok', duration: missing ? 7000 : 3800 });
      if (missing) setMode('move');
    } else render();
  }

  async function search() {
    if (!q.value.trim()) return;
    results.hidden = false;
    results.replaceChildren(h('p', { class: 'muted' }, 'Searching…'));
    try {
      const found = await findPlaces(q.value.trim());
      results.replaceChildren(...(found.length ? found.map((p) => h('button', { type: 'button', class: 'wiz-result', onclick: () => {
        results.hidden = true; q.value = '';
        addStop(p.lngLat, { title: p.name });
        map?.flyTo({ center: p.lngLat, zoom: Math.max(map.getZoom(), block.zoom ?? 14), duration: 900 });
      } }, icon('pin', { size: 15 }), h('span', {}, h('strong', {}, p.name), h('span', { class: 'muted' }, p.detail)), icon('plus', { size: 15 })))
        : [h('p', { class: 'muted' }, 'Nothing found. Try another spelling, or press Add stop and click the map.')]));
    } catch (e) { results.replaceChildren(h('p', { class: 'muted' }, e.message)); }
  }

  const fit = (list = places.filter((p) => !p.needsLocation)) => {
    if (!map || !list.length) return;
    if (list.length === 1) { map.easeTo({ center: list[0].lngLat, zoom: block.zoom ?? 14, duration: 600 }); return; }
    const lngs = list.map((p) => p.lngLat[0]);
    const lats = list.map((p) => p.lngLat[1]);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 70, maxZoom: block.zoom ?? 15, duration: 700 });
  };

  /* ----- Drawing ----- */
  function drawMarkers() {
    if (!map) return;
    markers.forEach((m) => m.remove());
    markers = places.map((p, i) => {
      const el = h('div', { class: `sm-marker tour-marker${i === sel ? ' is-active' : ''}${p.needsLocation ? ' is-unplaced' : ''}`, title: p.title || '' }, String(i + 1));
      el.addEventListener('click', (e) => { e.stopPropagation(); select(i, { fly: false }); });
      const mk = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(p.lngLat).addTo(map);
      mk.on('dragstart', () => {
        // select without redrawing the markers: rebuilding them would drop the one being dragged
        sel = i;
        drawList();
        drawEditor();
        markers.forEach((m, j) => m.getElement().classList.toggle('is-active', j === i));
      });
      mk.on('dragend', () => {
        p.lngLat = round(mk.getLngLat().toArray());
        delete p.needsLocation;
        save();
        render();
      });
      return mk;
    });
  }

  let dragFrom = -1;
  function drawList() {
    listEl.replaceChildren(...places.map((p, i) => h('li', {
      class: `tour-row${i === sel ? ' is-on' : ''}`, draggable: 'true',
      ondragstart: (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); },
      ondragover: (e) => { if (dragFrom < 0) return; e.preventDefault(); e.currentTarget.classList.add('is-drop'); },
      ondragleave: (e) => e.currentTarget.classList.remove('is-drop'),
      ondrop: (e) => { if (dragFrom < 0) return; e.preventDefault(); e.stopPropagation(); const from = dragFrom; dragFrom = -1; move(from, i); },
      ondragend: () => { dragFrom = -1; },
      onclick: () => select(i),
    },
    h('span', { class: 'tour-grip', 'aria-hidden': 'true' }, icon('grip', { size: 14 })),
    h('span', { class: 'tour-num' }, String(i + 1)),
    p.image ? h('img', { class: 'tour-thumb', src: p.image, alt: '' }) : h('span', { class: 'tour-thumb is-empty' }, icon('image', { size: 15 })),
    h('span', { class: 'tour-row-text' }, h('strong', {}, p.title || 'Untitled stop'),
      p.needsLocation ? h('span', { class: 'tour-warn' }, 'Needs a location') : h('span', { class: 'muted' }, p.html ? p.html.replace(/<[^>]+>/g, ' ').trim().slice(0, 60) : 'No description yet')))),
    ...(places.length ? [] : [h('li', { class: 'tour-empty' }, h('strong', {}, 'No stops yet'),
      h('span', {}, 'Drop photos here, search for a place, or press Add stop and click the map.'))]));
  }

  function drawEditor() {
    const p = places[sel];
    if (!p) {
      editEl.replaceChildren(h('div', { class: 'tour-hello' }, icon('route', { size: 28 }), h('strong', {}, 'Build your tour'),
        h('p', {}, 'Every stop has a photo, a title and a few lines of text. Readers step through them in order.'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => fileInput.click() }, icon('image', { size: 15 }), 'Add photos'),
        h('p', { class: 'field-hint' }, 'Photos taken on a phone are placed on the map automatically, in the order you took them.')));
      return;
    }
    const photo = h('div', { class: 'tour-photo' });
    const one = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', hidden: true, onchange: async () => {
      const f = one.files[0];
      one.value = '';
      if (f) await setPhoto(f);
    } });
    const setPhoto = async (f) => {
      photo.classList.add('is-busy');
      try {
        const meta = readPhotoMeta(await f.arrayBuffer());
        p.image = (await uploadImage(f)).url;
        if (!p.title || /^Stop \d+$/.test(p.title)) p.title = titleFromFilename(f.name) || p.title;
        if (p.needsLocation && meta.lngLat) { p.lngLat = round(meta.lngLat); delete p.needsLocation; }
        save();
        render();
      } catch (e) { toast(e.message, { tone: 'error' }); photo.classList.remove('is-busy'); }
    };
    photo.replaceChildren(...(p.image
      ? [h('img', { src: p.image, alt: '' }), h('span', { class: 'tour-photo-btns' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => one.click() }, 'Replace'),
        h('button', { type: 'button', class: 'btn btn-sm', 'aria-label': 'Remove photo', onclick: () => { p.image = ''; save(); render(); } }, icon('trash', { size: 14 })))]
      : [h('button', { type: 'button', class: 'tour-photo-drop', onclick: () => one.click() }, icon('image', { size: 22 }), h('strong', {}, 'Add a photo'), h('span', { class: 'muted' }, 'Drop one here or click to choose'))]), one);
    photo.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); photo.classList.add('is-drop'); });
    photo.addEventListener('dragleave', () => photo.classList.remove('is-drop'));
    photo.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); photo.classList.remove('is-drop'); const f = e.dataTransfer.files[0]; if (f) setPhoto(f); });
    const rich = richEditor(p, 'html');
    const zoomLabel = p.zoom != null ? `Zoom ${(+p.zoom).toFixed(1)} for this stop` : `Zoom ${block.zoom ?? 14} (same as the other stops)`;
    editEl.replaceChildren(
      h('div', { class: 'tour-edit-head' }, h('span', { class: 'tour-num' }, String(sel + 1)), h('span', { class: 'muted' }, `Stop ${sel + 1} of ${places.length}`),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'icon-btn', title: 'Move earlier', 'aria-label': 'Move earlier', disabled: sel === 0, onclick: () => move(sel, sel - 1) }, icon('up', { size: 15 })),
        h('button', { type: 'button', class: 'icon-btn', title: 'Move later', 'aria-label': 'Move later', disabled: sel === places.length - 1, onclick: () => move(sel, sel + 1) }, icon('down', { size: 15 })),
        h('button', { type: 'button', class: 'icon-btn', title: 'Delete stop', 'aria-label': 'Delete stop', onclick: () => remove(sel) }, icon('trash', { size: 15 }))),
      photo,
      h('input', { class: 'input tour-title', type: 'text', value: p.title || '', placeholder: 'Name this stop', 'aria-label': 'Stop name',
        oninput: (e) => { p.title = e.target.value; save(); listEl.querySelector('.tour-row.is-on strong').textContent = p.title || 'Untitled stop'; } }),
      rich,
      h('div', { class: 'tour-where' },
        h('span', { class: p.needsLocation ? 'tour-warn' : 'muted' }, p.needsLocation ? 'Not placed yet' : `${p.lngLat[1].toFixed(4)}, ${p.lngLat[0].toFixed(4)}`),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => setMode('move') }, icon('pin', { size: 14 }), p.needsLocation ? 'Place on map' : 'Move'),
        h('span', { class: 'muted tour-tip' }, 'or drag its marker')),
      h('div', { class: 'tour-where' },
        h('span', { class: 'muted' }, zoomLabel),
        h('button', { type: 'button', class: 'btn btn-sm', title: 'Use the map’s current zoom when readers reach this stop', onclick: () => { p.zoom = +map.getZoom().toFixed(2); save(); render(); } }, 'Use current zoom'),
        p.zoom != null ? h('button', { type: 'button', class: 'link-btn', onclick: () => { delete p.zoom; save(); render(); } }, 'Reset') : null));
  }

  function render() {
    drawList();
    drawEditor();
    drawMarkers();
    status.textContent = busy || (places.length ? `${places.length} ${places.length === 1 ? 'stop' : 'stops'}` : '');
    status.classList.toggle('is-busy', !!busy);
  }

  const status = h('span', { class: 'tour-status muted' });
  const body = h('div', { class: 'tour' },
    h('aside', { class: 'tour-side' },
      h('div', { class: 'tour-tools' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => fileInput.click() }, icon('image', { size: 15 }), 'Add photos'),
        h('button', { type: 'button', class: 'btn', onclick: () => setMode(mode === 'add' ? null : 'add') }, icon('plus', { size: 15 }), 'Add stop')),
      h('div', { class: 'tour-search' }, icon('search', { size: 15 }), q), results,
      h('div', { class: 'tour-list-head' }, h('span', { class: 'rail-section-title' }, 'Stops'), status),
      listEl, fileInput),
    h('div', { class: 'tour-map' }, mapEl, banner,
      h('button', { type: 'button', class: 'btn btn-sm tour-fit', onclick: () => fit() }, icon('target', { size: 14 }), 'Show all stops')),
    editEl);
  // drop photos anywhere in the builder
  body.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); body.classList.add('is-drop'); } });
  body.addEventListener('dragleave', (e) => { if (!body.contains(e.relatedTarget)) body.classList.remove('is-drop'); });
  body.addEventListener('drop', (e) => { body.classList.remove('is-drop'); if (!e.dataTransfer.files.length) return; e.preventDefault(); addFromPhotos([...e.dataTransfer.files]); });

  const dlg = dialog({ title: 'Edit stops', cls: 'dlg-xl dlg-tour', body, backdropCloses: false, onClose: () => { map?.remove(); removeEventListener('keydown', onKey, true); onClose?.(); },
    actions: [h('span', { class: 'muted tour-foot' }, 'Changes save as you go.'), h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done')] });
  dlg.querySelector('.dlg-body').style.padding = '0';
  const onKey = (e) => { if (e.key === 'Escape' && mode) { e.preventDefault(); e.stopPropagation(); setMode(null); } };
  addEventListener('keydown', onKey, true);

  const startAt = places.find((p) => !p.needsLocation)?.lngLat;
  map = createMap(mapEl, { basemap: block.basemap || 'streets', center: startAt || DEFAULT_VIEW.center, zoom: startAt ? (block.zoom ?? 14) : 3, layers: block.layers || [], markers: [], legend: false },
    { library: story.layers || [] });
  map.scrollZoom.enable();
  map.on('click', (e) => {
    if (!mode) return;
    const c = e.lngLat.toArray();
    if (mode === 'add') { setMode(null); addStop(c); return; }
    const p = places[sel];
    const wasUnplaced = !!p?.needsLocation;
    if (p) { p.lngLat = round(c); delete p.needsLocation; save(); }
    // after placing a photo that had no location, go straight on to the next one
    const next = wasUnplaced ? places.findIndex((x) => x.needsLocation) : -1;
    if (next >= 0) { sel = next; render(); setMode('move'); } else { setMode(null); render(); }
  });
  map.once('load', () => { if (places.filter((p) => !p.needsLocation).length > 1) fit(); });
  render();
  if (addPhotos) fileInput.click();
  return dlg;
}
