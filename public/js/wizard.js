// The "New story" wizard: kind of story → look → title and cover → places or chapters → extras.
// It builds the story from what people type (story-kit.js), so nobody has to clear out a demo first.
import { api, uploadImage } from './api.js';
import { h, icon, dialog, toast } from './ui.js';
import { LOOKS, KINDS, EXTRAS, buildStory } from './story-kit.js';
import { TEMPLATES } from './templates.js';
import { createMap, setMarkers } from './maps.js';

const MAPLIBRE = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
let mapLib;
// The map library is only needed for picking places, so it loads when that step opens.
function loadMapLib() {
  if (window.maplibregl) return Promise.resolve();
  mapLib ||= new Promise((resolve, reject) => {
    document.head.append(h('link', { rel: 'stylesheet', href: `${MAPLIBRE}.css` }), h('link', { rel: 'stylesheet', href: '/css/map.css' }));
    const s = h('script', { src: `${MAPLIBRE}.js` });
    s.onload = resolve;
    s.onerror = () => { mapLib = null; reject(new Error('The map could not load. Check your connection.')); };
    document.head.append(s);
  });
  return mapLib;
}

// Place search uses OpenStreetMap's Nominatim, one request per search (no search-as-you-type, per its usage policy).
async function findPlaces(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Search is not available right now. Click the map to add places instead.');
  return (await r.json()).map((p) => ({ name: p.name || p.display_name.split(',')[0], detail: p.display_name, lngLat: [+(+p.lon).toFixed(5), +(+p.lat).toFixed(5)] }));
}

export function openWizard({ user }) {
  const st = { kind: '', look: 'classic', title: '', subtitle: '', author: user.name || '', cover: '', places: [], chapters: ['The beginning', 'The turn', 'What it means'],
    extras: new Set(['statement']), guide: true };
  let step = 0;
  let map;
  let creating = false;

  const steps = () => {
    const k = KINDS[st.kind];
    return [
      { id: 'kind', label: 'Type' },
      { id: 'look', label: 'Look' },
      { id: 'basics', label: 'Title' },
      ...(k?.places ? [{ id: 'places', label: k.places === 'one' ? 'Place' : 'Places' }] : []),
      ...(k?.chapters ? [{ id: 'chapters', label: 'Chapters' }] : []),
      ...(st.kind && st.kind !== 'blank' ? [{ id: 'extras', label: 'Extras' }] : []),
    ];
  };

  const body = h('div', { class: 'wiz' });
  const progress = h('ol', { class: 'wiz-steps', 'aria-label': 'Steps' });
  const back = h('button', { type: 'button', class: 'btn', onclick: () => go(step - 1) }, icon('back', { size: 16 }), 'Back');
  const next = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => (step === steps().length - 1 ? create() : go(step + 1)) });
  const hint = h('span', { class: 'wiz-hint muted' });
  const tabs = h('div', { class: 'seg wiz-tabs', role: 'tablist' });
  let tab = 'guided';

  const dlg = dialog({ title: 'Start a new story', cls: 'dlg-lg dlg-wiz', backdropCloses: false, onClose: () => map?.remove(),
    body: h('div', {}, tabs, progress, body),
    actions: [hint, h('span', { class: 'spacer' }), back, next] });
  const foot = dlg.querySelector('.dlg-foot');

  const valid = (id) => (id === 'kind' ? !!st.kind : id === 'basics' ? !!st.title.trim() : true);
  const go = (n) => {
    const list = steps();
    if (n > step && !valid(list[step].id)) return;
    map?.remove();
    map = null;
    step = Math.max(0, Math.min(n, list.length - 1));
    render();
  };

  function render() {
    tabs.replaceChildren(...[['guided', 'Set it up for me'], ['examples', 'Explore an example']].map(([k, l]) =>
      h('button', { type: 'button', role: 'tab', class: tab === k ? 'is-on' : '', 'aria-selected': tab === k ? 'true' : 'false', onclick: () => { tab = k; render(); } }, l)));
    if (tab === 'examples') {
      progress.hidden = true;
      foot.hidden = true;
      body.replaceChildren(examples());
      return;
    }
    progress.hidden = false;
    foot.hidden = false;
    const list = steps();
    const cur = list[step];
    progress.replaceChildren(...list.map((s, i) => h('li', { class: i === step ? 'is-on' : i < step ? 'is-done' : '' },
      h('button', { type: 'button', disabled: i > step && !list.slice(0, i).every((x) => valid(x.id)), onclick: () => go(i) },
        h('span', { class: 'wiz-dot' }, i < step ? icon('check', { size: 12 }) : String(i + 1)), s.label))));
    back.hidden = step === 0;
    const last = step === list.length - 1;
    next.replaceChildren(...(last ? [icon('sparkle', { size: 16 }), 'Create my story'] : ['Next', icon('back', { size: 16, cls: 'rot' })]));
    next.disabled = !valid(cur.id) || creating;
    hint.textContent = cur.id === 'kind' ? 'Everything can be changed later.' : cur.id === 'look' ? 'You can switch looks any time.' : '';
    body.replaceChildren(VIEWS[cur.id]());
    body.querySelector('[autofocus]')?.focus();
  }
  const refreshFoot = () => { next.disabled = !valid(steps()[step].id) || creating; };

  const VIEWS = {
    kind: () => h('div', {},
      h('h3', { class: 'wiz-q' }, 'What are you making?'),
      h('div', { class: 'wiz-cards' }, Object.entries(KINDS).map(([k, v]) => h('button', { type: 'button', class: `wiz-card${st.kind === k ? ' is-on' : ''}`,
        onclick: () => { st.kind = k; render(); } },
      h('span', { class: 'wiz-card-icon' }, icon(v.icon, { size: 22 })),
      h('strong', {}, v.name), h('span', { class: 'muted' }, v.desc))))),

    look: () => h('div', {},
      h('h3', { class: 'wiz-q' }, 'Pick a look'),
      h('div', { class: 'wiz-looks' }, Object.entries(LOOKS).map(([k, v]) => h('button', { type: 'button', class: `wiz-look${st.look === k ? ' is-on' : ''}`,
        onclick: () => { st.look = k; render(); } },
      lookMock(k, st.title || 'Your title here'),
      h('strong', {}, v.name), h('span', { class: 'muted' }, v.desc))))),

    basics: () => {
      const coverBox = h('div', { class: 'wiz-cover' });
      const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
        const f = fileInput.files[0];
        if (!f) return;
        coverBox.classList.add('is-busy');
        try { st.cover = (await uploadImage(f)).url; } catch (e) { toast(e.message, { tone: 'error' }); }
        coverBox.classList.remove('is-busy');
        drawCover();
      } });
      const drawCover = () => coverBox.replaceChildren(...(st.cover
        ? [h('img', { src: st.cover, alt: '' }), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { st.cover = ''; drawCover(); } }, icon('trash', { size: 14 }), 'Remove')]
        : [h('button', { type: 'button', class: 'wiz-drop', onclick: () => fileInput.click() }, icon('image', { size: 22 }), h('strong', {}, 'Add a cover photo'), h('span', { class: 'muted' }, 'Optional. Drop one here or click to choose'))]));
      coverBox.addEventListener('dragover', (e) => { e.preventDefault(); coverBox.classList.add('is-drop'); });
      coverBox.addEventListener('dragleave', () => coverBox.classList.remove('is-drop'));
      coverBox.addEventListener('drop', (e) => { e.preventDefault(); coverBox.classList.remove('is-drop'); const f = e.dataTransfer.files[0]; if (f) { const dt = new DataTransfer(); dt.items.add(f); fileInput.files = dt.files; fileInput.onchange(); } });
      drawCover();
      const text = (k, label, attrs = {}) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label),
        h(attrs.rows ? 'textarea' : 'input', { class: 'input', type: 'text', value: st[k], ...attrs, oninput: (e) => { st[k] = e.target.value; refreshFoot(); } }));
      return h('div', { class: 'wiz-basics' },
        h('div', {},
          h('h3', { class: 'wiz-q' }, 'Give it a title'),
          text('title', 'Title', { placeholder: KINDS[st.kind]?.name === 'A walking tour' ? 'A walk through old Lisbon' : 'The river that made the city', autofocus: true, maxlength: 140,
            onkeydown: (e) => { if (e.key === 'Enter') go(step + 1); } }),
          text('subtitle', 'Subtitle (optional)', { placeholder: 'One line that makes people want to read on', rows: 2 }),
          text('author', 'Author')),
        h('div', {}, h('span', { class: 'field-label' }, 'Cover photo'), coverBox, fileInput));
    },

    places: () => {
      const one = KINDS[st.kind].places === 'one';
      const listBox = h('div', { class: 'wiz-places' });
      const listTitle = h('div', { class: 'rail-section-title' });
      const results = h('div', { class: 'wiz-results' });
      const q = h('input', { class: 'input', type: 'search', placeholder: 'Search for a city, park, address…', autofocus: true,
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } } });
      const mapEl = h('div', { class: 'wiz-map' });
      const addPlace = (p) => {
        if (one) st.places = [p];
        else if (st.places.length < 20) st.places.push(p);
        drawList();
        if (map) map.flyTo({ center: p.lngLat, zoom: Math.max(map.getZoom(), one ? 8 : 5), duration: 800 });
      };
      const search = async () => {
        if (!q.value.trim()) return;
        results.replaceChildren(h('p', { class: 'muted' }, 'Searching…'));
        try {
          const found = await findPlaces(q.value.trim());
          results.replaceChildren(...(found.length ? found.map((p) => h('button', { type: 'button', class: 'wiz-result', onclick: () => { addPlace(p); results.replaceChildren(); q.value = ''; q.focus(); } },
            icon('pin', { size: 15 }), h('span', {}, h('strong', {}, p.name), h('span', { class: 'muted' }, p.detail)), icon('plus', { size: 15 })))
            : [h('p', { class: 'muted' }, 'Nothing found. Try another spelling, or click the map.')]));
        } catch (e) { results.replaceChildren(h('p', { class: 'muted' }, e.message)); }
      };
      const drawList = () => {
        listTitle.textContent = one ? 'Place' : `In order · ${st.places.length || 'none yet'}`;
        listBox.replaceChildren(...(st.places.length ? st.places.map((p, i) => h('div', { class: 'wiz-place' },
          h('span', { class: 'wiz-num' }, String(i + 1)),
          h('input', { class: 'input', type: 'text', value: p.name, 'aria-label': `Name of place ${i + 1}`, oninput: (e) => { p.name = e.target.value || `Place ${i + 1}`; } }),
          one ? null : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { st.places.splice(i - 1, 0, st.places.splice(i, 1)[0]); drawList(); } }, icon('up', { size: 15 })),
          one ? null : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move down', disabled: i === st.places.length - 1, onclick: () => { st.places.splice(i + 1, 0, st.places.splice(i, 1)[0]); drawList(); } }, icon('down', { size: 15 })),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove', onclick: () => { st.places.splice(i, 1); drawList(); } }, icon('trash', { size: 15 }))))
          : [h('p', { class: 'muted wiz-empty' }, one ? 'No place yet. The map will start with the whole country.' : 'No places yet. You can also skip this and add them in the editor.')]));
        if (map) setMarkers(map, st.places.map((p) => ({ lngLat: p.lngLat, title: p.name })));
      };
      loadMapLib().then(() => {
        if (!mapEl.isConnected) return;
        const first = st.places[0]?.lngLat;
        map = createMap(mapEl, { center: first || [10, 30], zoom: first ? 5 : 1.3, basemap: LOOKS[st.look].basemap, markers: [], layers: [], legend: false });
        map.scrollZoom.enable();
        map.getCanvas().style.cursor = 'crosshair';
        map.on('click', (e) => addPlace({ name: `Place ${st.places.length + 1}`, lngLat: [+e.lngLat.lng.toFixed(5), +e.lngLat.lat.toFixed(5)] }));
        setMarkers(map, st.places.map((p) => ({ lngLat: p.lngLat, title: p.name })));
      }).catch((e) => mapEl.replaceChildren(h('p', { class: 'muted', style: 'padding:16px' }, e.message)));
      drawList();
      return h('div', {},
        h('h3', { class: 'wiz-q' }, one ? 'Where is your map? (optional)' : st.kind === 'tour' ? 'Where are the stops?' : 'Where does the story go?'),
        h('div', { class: 'wiz-places-grid' },
          h('div', {},
            h('div', { class: 'row' }, q, h('button', { type: 'button', class: 'btn', onclick: search }, icon('search', { size: 15 }), 'Find')),
            results,
            listTitle,
            listBox,
            h('p', { class: 'field-hint' }, 'Tip: click the map to drop a place anywhere. Search by ', h('a', { href: 'https://nominatim.openstreetmap.org/', target: '_blank', rel: 'noopener' }, 'OpenStreetMap Nominatim'), '.')),
          mapEl));
    },

    chapters: () => {
      const listBox = h('div', { class: 'wiz-places' });
      const draw = () => listBox.replaceChildren(...st.chapters.map((c, i) => h('div', { class: 'wiz-place' },
        h('span', { class: 'wiz-num' }, String(i + 1)),
        h('input', { class: 'input', type: 'text', value: c, 'aria-label': `Chapter ${i + 1} title`, oninput: (e) => { st.chapters[i] = e.target.value; } }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove chapter', disabled: st.chapters.length === 1, onclick: () => { st.chapters.splice(i, 1); draw(); } }, icon('trash', { size: 15 })))),
      st.chapters.length < 12 ? h('button', { type: 'button', class: 'btn btn-sm sub-add', onclick: () => { st.chapters.push(''); draw(); [...listBox.querySelectorAll('input')].pop().focus(); } }, icon('plus', { size: 14 }), 'Add a chapter') : null);
      draw();
      return h('div', { class: 'wiz-narrow' }, h('h3', { class: 'wiz-q' }, 'Name your chapters'),
        h('p', { class: 'muted' }, 'Each one becomes a full-screen title that recolors the page, followed by space to write. Rough titles are fine.'), listBox);
    },

    extras: () => h('div', { class: 'wiz-narrow' },
      h('h3', { class: 'wiz-q' }, 'Anything else?'),
      h('div', { class: 'wiz-extras' }, Object.entries(EXTRAS).map(([k, v]) => {
        const locked = st.kind === 'data' && k === 'numbers';
        return h('label', { class: `wiz-extra${st.extras.has(k) || locked ? ' is-on' : ''}` },
          h('input', { type: 'checkbox', checked: st.extras.has(k) || locked, disabled: locked, onchange: (e) => { e.target.checked ? st.extras.add(k) : st.extras.delete(k); e.target.closest('.wiz-extra').classList.toggle('is-on', e.target.checked); } }),
          h('span', {}, h('strong', {}, v.name), h('span', { class: 'muted' }, locked ? `${v.desc} Included in data stories.` : v.desc)));
      })),
      h('label', { class: 'check wiz-guide' }, h('input', { type: 'checkbox', checked: st.guide, onchange: (e) => { st.guide = e.target.checked; } }),
        h('span', {}, h('strong', {}, 'Show me a checklist in the editor'), ' that walks me through finishing the story'))),
  };

  async function create() {
    if (creating) return;
    creating = true;
    refreshFoot();
    next.replaceChildren(h('span', { class: 'spinner', style: 'width:14px;height:14px' }), 'Creating…');
    try {
      const story = buildStory({ ...st, extras: [...st.extras] });
      const created = await api('POST', '/api/stories', { story });
      location.href = `/builder.html?id=${created.id}&new=1`;
    } catch (e) {
      creating = false;
      toast(e.message, { tone: 'error' });
      render();
    }
  }

  function examples() {
    return h('div', {},
      h('p', { class: 'muted', style: 'margin:0 0 14px' }, 'Finished stories you can take apart. Open one to see how it is built, then change anything.'),
      h('div', { class: 'templates' }, TEMPLATES.filter((t) => t.id !== 'blank').map((t) => h('button', { type: 'button', class: 'tpl', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const story = await t.make(user.name || '');
          const created = await api('POST', '/api/stories', { story });
          location.href = `/builder.html?id=${created.id}&new=1`;
        } catch (err) { toast(err.message, { tone: 'error' }); e.currentTarget.disabled = false; }
      } },
      h('span', { class: 'tpl-art', style: `background:${t.art}` }, icon(t.icon, { size: 34 })),
      h('strong', {}, t.name.replace(/^Sample: /, '')),
      h('span', {}, t.description)))));
  }

  render();
  return dlg;
}

/** A tiny page mock-up in a look's style, used on the look cards. */
export function lookMock(key, title) {
  return h('span', { class: `look-mock look-${key}`, 'aria-hidden': 'true' },
    h('span', { class: 'lm-bar' }, h('span', {})),
    h('span', { class: 'lm-cover' }, h('span', { class: 'lm-kicker' }, 'Chapter 1'), h('span', { class: 'lm-title' }, title)),
    h('span', { class: 'lm-body' }, h('span', { class: 'lm-line' }), h('span', { class: 'lm-line' }), h('span', { class: 'lm-line short' })),
    h('span', { class: 'lm-map' }, h('span', { class: 'lm-pin' }), h('span', { class: 'lm-card' })));
}
