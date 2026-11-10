// Tools for hosted layers: version history (undo), keeping a layer in sync with a URL, forms that collect points
// from the public, and uploading big files.
import { api } from './api.js';
import { h, icon, dialog, toast, confirmDialog, copyText, relTime, fill } from './ui.js';
import { invalidateLayerCache } from './maps.js';
import { fileKind } from './gisfiles.js';
import { readShapefileZip } from './shapefile.js';

/* ---------- Upload ---------- */

/** Uploads GeoJSON, a zipped shapefile or a GeoPackage as hosted layers. Returns the layers made. */
export async function uploadLayerFiles(files) {
  const made = [];
  for (const file of files) {
    const kind = fileKind(file.name, file.type);
    const busy = toast(`Uploading ${file.name}…`, { duration: 600000 });
    try {
      const send = (body, name) => api('POST', '/api/layers/import', body, { raw: true, headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(name) } });
      if (kind === 'shapefile') {
        for (const set of await readShapefileZip(await file.arrayBuffer())) if (set.data.features.length) made.push(...(await send(new Blob([JSON.stringify(set.data)]), `${set.name}.geojson`)).layers);
      } else if (kind === 'geojson' || kind === 'geopackage') made.push(...(await send(file, file.name)).layers);
      else throw new Error('use GeoJSON, a zipped shapefile or a GeoPackage');
    } catch (e) { toast(`${file.name}: ${e.message}`, { tone: 'error', duration: 7000 }); } finally { busy?.(); }
  }
  if (made.length) toast(`Uploaded ${made.length === 1 ? `"${made[0].title}"` : `${made.length} layers`} · ${made.reduce((n, l) => n + l.featureCount, 0).toLocaleString()} features`, { tone: 'ok', duration: 5000 });
  return made;
}

/* ---------- History ---------- */

export async function openHistory(layer, { onChange } = {}) {
  const body = h('div', {}, h('p', { class: 'uploading' }, h('span', { class: 'spinner' }), 'Loading…'));
  const dlg = dialog({ title: `History of "${layer.title}"`, body, actions: [h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done')] });
  const canEdit = !layer.role || layer.role !== 'viewer';
  const load = async () => {
    const { versions } = await api('GET', `/api/layers/${layer.id}/history`);
    fill(body,
      h('p', { class: 'field-hint', style: 'margin-top:0' }, 'Every change to this layer\'s features is kept here: edits in the table, drawing, form submissions and refreshes. Restoring a version makes a new one, so nothing is lost. The newest 25 are kept.'),
      h('div', { class: 'share-list' }, versions.map((v) => h('div', { class: 'share-row' },
        h('span', { class: 'share-who' }, icon(v.current ? 'check' : 'undo', { size: 16 }),
          h('span', {}, h('strong', {}, v.note || 'Edited'), h('span', { class: 'muted' }, `${v.featureCount.toLocaleString()} features · ${relTime(v.savedAt)}${v.by ? ` · ${v.by}` : ''}`))),
        v.current ? h('span', { class: 'pill is-live' }, 'Current')
          : h('span', { class: 'row', style: 'gap:6px' },
            h('a', { class: 'btn btn-sm', href: `/api/layers/${layer.id}/history/${v.version}`, download: `${layer.title} v${v.version}.geojson` }, icon('download', { size: 14 }), 'Download'),
            canEdit ? h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: async () => {
              if (!await confirmDialog({ title: 'Restore this version?', confirmLabel: 'Restore', message: `The layer goes back to how it was ${relTime(v.savedAt)} (${v.featureCount.toLocaleString()} features). Maps and stories that use it update too. You can undo this from the history.` })) return;
              try {
                await api('POST', `/api/layers/${layer.id}/restore/${v.version}`);
                invalidateLayerCache();
                toast('Version restored', { tone: 'ok' });
                onChange?.();
                load();
              } catch (e) { toast(e.message, { tone: 'error' }); }
            } }, 'Restore') : null)))));
  };
  load().catch((e) => fill(body, h('p', { class: 'form-error' }, e.message)));
  return dlg;
}

/* ---------- Keep in sync with a URL ---------- */

const EVERY = [[0, 'Only when I press Refresh'], [15, 'Every 15 minutes'], [60, 'Every hour'], [360, 'Every 6 hours'], [1440, 'Every day'], [10080, 'Every week']];

export function openSync(layer, { onChange } = {}) {
  const url = h('input', { class: 'input', type: 'url', value: layer.sourceUrl || '', placeholder: 'https://… GeoJSON, a CSV with lat/lon columns, or an ArcGIS feature layer' });
  const every = h('select', {}, EVERY.map(([v, l]) => h('option', { value: v, selected: (layer.refreshMinutes || 0) === v }, l)));
  const status = h('p', { class: 'field-hint' });
  const showStatus = (l) => fill(status, ...(l.refreshError ? [h('span', { class: 'form-error' }, `Last refresh failed: ${l.refreshError}`)]
    : l.refreshedAt ? [`Last refreshed ${relTime(l.refreshedAt)}.`] : ['Not refreshed yet.']));
  showStatus(layer);
  const save = async (thenRefresh) => {
    try {
      let l = await api('PUT', `/api/layers/${layer.id}`, { sourceUrl: url.value.trim(), refreshMinutes: +every.value });
      if (thenRefresh && url.value.trim()) {
        const busy = toast('Refreshing…', { duration: 120000 });
        try { l = await api('POST', `/api/layers/${layer.id}/refresh`); toast(l.changed ? `Refreshed · ${l.featureCount.toLocaleString()} features` : 'Already up to date', { tone: 'ok' }); } finally { busy?.(); }
        invalidateLayerCache();
      } else toast('Saved', { tone: 'ok' });
      Object.assign(layer, l);
      showStatus(l);
      onChange?.();
      if (!thenRefresh) dlg.close();
    } catch (e) { toast(e.message, { tone: 'error', duration: 7000 }); api('GET', `/api/layers/${layer.id}?data=0`).then(showStatus).catch(() => {}); }
  };
  const dlg = dialog({ title: `Keep "${layer.title}" in sync`, body: h('div', {},
    h('p', { class: 'field-hint', style: 'margin-top:0' }, 'Waymark fetches this address on a schedule and replaces the layer\'s features with what it finds, so maps and stories stay current without anyone opening them. Each refresh that changes something is kept in the layer\'s history.'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Source address'), url),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Refresh'), every),
    status,
    h('p', { class: 'field-hint' }, 'A refresh replaces any edits made by hand. Results of analysis run in the browser, so analysis layers are re-run from the layer\'s settings, not on this schedule.')),
  actions: [h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
    h('button', { type: 'button', class: 'btn', onclick: () => save(true) }, icon('refresh', { size: 15 }), 'Save and refresh now'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => save(false) }, 'Save')] });
  return dlg;
}

/* ---------- Forms ---------- */

const TYPE_LABEL = { string: 'Text', number: 'Number', boolean: 'Yes / no', date: 'Date' };

function editForm(layer, form, { onSaved }) {
  const isNew = !form;
  const f = form ? structuredClone(form) : { title: layer.title, description: '', thanks: '', location: 'required', photo: false, open: true,
    fields: (layer.fields || []).filter((x) => !/^(photo_url|submitted_at)$/.test(x.name)).slice(0, 12).map((x) => ({ name: x.name, type: x.type, label: x.alias || x.name, required: false })) };
  const list = h('div', { class: 'form-fields' });
  const draw = () => fill(list, ...f.fields.map((fld, i) => h('div', { class: 'form-field' },
    h('div', { class: 'row' },
      h('input', { class: 'input', type: 'text', value: fld.label, placeholder: 'Question', 'aria-label': 'Question', style: 'flex:2', oninput: (e) => { fld.label = e.target.value; if (fld._new) fld.name = e.target.value.trim().toLowerCase().replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40); } }),
      h('select', { 'aria-label': 'Answer type', onchange: (e) => { fld.type = e.target.value; } }, Object.entries(TYPE_LABEL).map(([v, l]) => h('option', { value: v, selected: fld.type === v }, l))),
      h('label', { class: 'check', style: 'margin:0' }, h('input', { type: 'checkbox', checked: fld.required, onchange: (e) => { fld.required = e.target.checked; } }), 'Required'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove question', onclick: () => { f.fields.splice(i, 1); draw(); } }, icon('x', { size: 15 }))),
    h('input', { class: 'input', type: 'text', value: (fld.choices || []).join(', '), placeholder: 'Choices, separated by commas (leave blank for a free answer)', 'aria-label': 'Choices',
      oninput: (e) => { const c = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); if (c.length) fld.choices = c; else delete fld.choices; } }))));
  draw();
  const title = h('input', { class: 'input', type: 'text', value: f.title, maxlength: 200 });
  const desc = h('textarea', { class: 'input', rows: 2, maxlength: 2000, placeholder: 'Shown under the title: what you\'re collecting and why' }, f.description || '');
  const thanks = h('input', { class: 'input', type: 'text', value: f.thanks || '', maxlength: 500, placeholder: 'Thanks! Your report was received.' });
  const save = async () => {
    const payload = { title: title.value, description: desc.value, thanks: thanks.value, location: f.location, photo: f.photo, open: f.open,
      fields: f.fields.filter((x) => x.name && x.label.trim()).map(({ _new, ...x }) => x) };
    if (!payload.fields.length && !payload.photo) { toast('Add at least one question.', { tone: 'error' }); return; }
    try {
      const saved = isNew ? await api('POST', `/api/layers/${layer.id}/forms`, payload) : await api('PUT', `/api/forms/${form.id}`, payload);
      dlg.close();
      onSaved(saved);
    } catch (e) { toast(e.message, { tone: 'error', duration: 6000 }); }
  };
  const dlg = dialog({ title: isNew ? 'New form' : 'Edit form', body: h('div', {},
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Title'), title),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Introduction'), desc),
    h('div', { class: 'rail-section-title' }, 'Questions'),
    h('p', { class: 'field-hint', style: 'margin-top:0' }, 'Each answer is saved in the layer under the question\'s field. New questions add a field.'),
    list,
    h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { f.fields.push({ name: '', type: 'string', label: '', required: false, _new: true }); draw(); list.lastChild?.querySelector('input')?.focus(); } }, icon('plus', { size: 14 }), 'Add a question'),
    h('div', { class: 'rail-section-title' }, 'Place and photo'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.location === 'required', onchange: (e) => { f.location = e.target.checked ? 'required' : 'optional'; } }), 'People must mark the place on the map'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.photo, onchange: (e) => { f.photo = e.target.checked; } }), 'Let people add a photo'),
    h('label', { class: 'field', style: 'margin-top:10px' }, h('span', { class: 'field-label' }, 'Message after sending'), thanks)),
  actions: [h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'), h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, isNew ? 'Make form' : 'Save')] });
  return dlg;
}

export async function openForms(layer, { onChange } = {}) {
  const body = h('div', {}, h('p', { class: 'uploading' }, h('span', { class: 'spinner' }), 'Loading…'));
  const dlg = dialog({ title: `Forms for "${layer.title}"`, body, actions: [h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done')], onClose: () => onChange?.() });
  const load = async () => {
    const { forms } = await api('GET', `/api/layers/${layer.id}/forms`);
    const create = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => editForm(layer, null, { onSaved: (f) => { toast('Form made. Copy its link to share it.', { tone: 'ok' }); load(); copyText(location.origin + f.url); } }) }, icon('plus', { size: 15 }), 'New form');
    fill(body,
      h('p', { class: 'field-hint', style: 'margin-top:0' }, 'A form is a public page where anyone with the link can add a point to this layer: answers to your questions, a place on the map, and a photo if you allow it. It works on phones. Nobody filling it in can see the layer\'s other data.'),
      forms.length ? h('div', { class: 'share-list' }, forms.map((f) => h('div', { class: 'share-row' },
        h('span', { class: 'share-who' }, icon('list', { size: 16 }), h('span', {}, h('strong', {}, f.title), h('span', { class: 'muted' }, `${f.submissions.toLocaleString()} ${f.submissions === 1 ? 'submission' : 'submissions'} · ${f.fields.length} ${f.fields.length === 1 ? 'question' : 'questions'}`))),
        h('span', { class: 'row', style: 'gap:6px' },
          h('span', { class: `pill ${f.open ? 'is-live' : ''}` }, f.open ? 'Open' : 'Closed'),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { await copyText(location.origin + f.url); toast('Form link copied', { tone: 'ok' }); } }, icon('link', { size: 14 }), 'Copy link'),
          h('a', { class: 'btn btn-sm', href: f.url, target: '_blank', rel: 'noopener' }, icon('external', { size: 14 }), 'Open'),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => editForm(layer, f, { onSaved: () => { toast('Form saved', { tone: 'ok' }); load(); } }) }, 'Edit'),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { await api('PUT', `/api/forms/${f.id}`, { open: !f.open }); load(); } }, f.open ? 'Close' : 'Reopen'),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Delete ${f.title}`, onclick: async () => {
            if (!await confirmDialog({ title: `Delete the form "${f.title}"?`, danger: true, confirmLabel: 'Delete form', message: 'Its link stops working. What people already sent stays in the layer.' })) return;
            await api('DELETE', `/api/forms/${f.id}`); load();
          } }, icon('trash', { size: 15 }))))))
        : h('p', { class: 'muted' }, 'No forms yet.'),
      h('div', { style: 'margin-top:12px' }, create));
  };
  load().catch((e) => fill(body, h('p', { class: 'form-error' }, e.message)));
  return dlg;
}
