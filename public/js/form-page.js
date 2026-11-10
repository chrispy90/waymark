// Public form (/f/<id>): answer a few questions, mark the place on a map, add a photo, send. Each submission
// becomes a point in a hosted layer. Built for phones first.
import { h, icon, setTitle, fill } from './ui.js';

const id = /^\/f\/([\w-]+)/.exec(location.pathname)?.[1] || new URLSearchParams(location.search).get('id');
const root = document.getElementById('page');
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'X-Waymark': '1', ...headers }, body });

const res = await fetch(`/api/public/forms/${encodeURIComponent(id)}`);
const form = res.ok ? await res.json() : null;

if (!form) {
  fill(root, h('main', { class: 'pv-missing' }, h('h1', {}, 'This form isn\'t available'), h('p', {}, 'The link may be wrong, or the form was deleted.')));
} else if (!form.open) {
  setTitle(form.title);
  fill(root, h('main', { class: 'pv-missing' }, h('h1', {}, form.title), h('p', {}, 'This form is closed and isn\'t taking new submissions.')));
} else {
  setTitle(form.title);
  let lngLat = null;
  let marker = null;
  let photoFile = null;
  const error = h('p', { class: 'form-error', role: 'alert' });
  const place = h('p', { class: 'fp-place muted' }, 'Tap the map where it is, or use your location.');
  const mapEl = h('div', { class: 'fp-map' });

  const inputs = form.fields.map((f) => {
    let el;
    if (f.choices?.length) el = h('select', { required: f.required }, h('option', { value: '' }, 'Choose…'), f.choices.map((c) => h('option', { value: c }, c)));
    else if (f.type === 'boolean') el = h('select', { required: f.required }, h('option', { value: '' }, 'Choose…'), h('option', { value: 'true' }, 'Yes'), h('option', { value: 'false' }, 'No'));
    else if (f.long) el = h('textarea', { class: 'input', rows: 3, required: f.required, maxlength: 4000 });
    else el = h('input', { class: 'input', type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text', step: 'any', required: f.required, maxlength: 4000 });
    return { f, el, row: h('label', { class: 'field' }, h('span', { class: 'field-label' }, f.label, f.required ? h('span', { class: 'fp-req', title: 'Required' }, ' *') : null), el, f.hint ? h('span', { class: 'field-hint' }, f.hint) : null) };
  });

  const setPlace = (ll, how) => {
    lngLat = [Math.round(ll[0] * 1e6) / 1e6, Math.round(ll[1] * 1e6) / 1e6];
    if (!marker) {
      marker = new maplibregl.Marker({ color: '#e4572e', draggable: true }).setLngLat(lngLat).addTo(map);
      marker.on('dragend', () => { const p = marker.getLngLat(); setPlace([p.lng, p.lat], 'Marked'); });
    }
    marker.setLngLat(lngLat);
    place.textContent = `${how}: ${lngLat[1].toFixed(5)}, ${lngLat[0].toFixed(5)}. Drag the pin to adjust.`;
    place.classList.remove('muted');
  };
  const locate = h('button', { type: 'button', class: 'btn', onclick: () => {
    if (!navigator.geolocation) { place.textContent = 'This device can\'t share its location. Tap the map instead.'; return; }
    locate.disabled = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      locate.disabled = false;
      setPlace([pos.coords.longitude, pos.coords.latitude], 'Your location');
      map.easeTo({ center: lngLat, zoom: Math.max(map.getZoom(), 16) });
    }, () => { locate.disabled = false; place.textContent = 'Couldn\'t get your location. Tap the map where it is.'; }, { enableHighAccuracy: true, timeout: 15000 });
  } }, icon('target', { size: 15 }), 'Use my location');

  const photoName = h('span', { class: 'muted' }, 'No photo chosen');
  const photoInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', capture: 'environment', hidden: true, onchange: () => { photoFile = photoInput.files[0] || null; photoName.textContent = photoFile ? photoFile.name : 'No photo chosen'; } });

  // Shrink the photo before sending: faster on mobile data, and it drops the camera's location and device details.
  async function prepare(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  }

  const send = h('button', { type: 'submit', class: 'btn btn-primary btn-lg btn-block' }, form.button || 'Send');
  const el = h('form', { class: 'fp-form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    error.textContent = '';
    const missing = inputs.find(({ f, el: input }) => f.required && !input.value.trim());
    if (missing) { error.textContent = `"${missing.f.label}" is required.`; missing.el.focus(); return; }
    if (form.location === 'required' && !lngLat) { error.textContent = 'Mark the place on the map first.'; mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    send.disabled = true;
    send.textContent = 'Sending…';
    try {
      let photo;
      if (photoFile) {
        const up = await post(`/api/public/forms/${id}/photo`, await prepare(photoFile), { 'Content-Type': 'image/jpeg' });
        if (!up.ok) throw new Error((await up.json().catch(() => null))?.error || 'The photo could not be uploaded');
        photo = (await up.json()).url;
      }
      const values = Object.fromEntries(inputs.map(({ f, el: input }) => [f.name, input.value]));
      const r = await post(`/api/public/forms/${id}/submit`, JSON.stringify({ values, lngLat, photo }), { 'Content-Type': 'application/json' });
      const out = await r.json().catch(() => null);
      if (!r.ok) throw new Error(out?.error || 'That didn\'t go through. Try again.');
      fill(root, h('main', { class: 'pv-missing fp-done' }, h('span', { class: 'fp-check' }, icon('check', { size: 30 })), h('h1', {}, 'Sent'), h('p', {}, out.thanks || 'Thanks! Your submission was received.'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => location.reload() }, 'Send another')));
    } catch (err) {
      error.textContent = err.message;
      send.disabled = false;
      send.textContent = form.button || 'Send';
    }
  } },
  inputs.map((i) => i.row),
  h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Where is it?', form.location === 'required' ? h('span', { class: 'fp-req', title: 'Required' }, ' *') : h('span', { class: 'muted' }, ' (optional)')),
    mapEl, h('div', { class: 'row fp-place-row' }, locate, place)),
  form.photo ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Photo ', h('span', { class: 'muted' }, '(optional)')),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => photoInput.click() }, icon('image', { size: 15 }), 'Add a photo'), photoName, photoInput)) : null,
  error, send);

  fill(root, h('main', { class: 'fp' }, h('h1', {}, form.title), form.description ? h('p', { class: 'fp-intro' }, form.description) : null, el,
    h('p', { class: 'fp-foot muted' }, 'Made with ', h('a', { href: '/' }, 'Waymark'))));

  const map = new maplibregl.Map({ container: mapEl, style: 'https://tiles.openfreemap.org/styles/liberty', center: form.center || [-98.5, 39.5], zoom: form.zoom ?? (form.center ? 12 : 3), attributionControl: { compact: true }, cooperativeGestures: true });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.on('click', (e) => setPlace([e.lngLat.lng, e.lngLat.lat], 'Marked'));
}
