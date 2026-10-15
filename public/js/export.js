// "Export as a website" dialog. The build itself lives in export-core.js (shared with the CLI).
import { api } from './api.js';
import { h, icon, dialog, toast, BRAND } from './ui.js';
import { loadLayerData } from './maps.js';
import { buildExport } from './export-core.js';
import { withMaps } from './webmap.js';

// Browser implementation of the exporter's file and network access.
const browserIO = {
  text: async (path) => { const r = await fetch(path); if (!r.ok) throw new Error(`Could not load ${path}`); return r.text(); },
  bytes: async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const blob = await r.blob();
    return { data: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
  },
  layerData: (layer) => loadLayerData(layer),
  remote: async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); },
};

/** opts: { id } to load a story, or { story, meta, flush } from the editor. */
export async function openExport({ id, story: current, meta: currentMeta, flush } = {}) {
  let meta = currentMeta;
  let draft = current;
  if (!draft) {
    const r = await api('GET', `/api/stories/${encodeURIComponent(id)}`);
    draft = r.story;
    meta = r;
  }
  const state = { format: 'zip', version: meta?.url ? 'published' : 'draft', images: true, data: true, vendor: true };
  const body = h('div', { class: 'ex' });
  const foot = h('div', { class: 'row', style: 'width:100%' });
  const dlg = dialog({ title: 'Export as a website', cls: 'dlg-md', body, actions: [foot] });

  const choice = (key, value, title, text, ic) => h('button', { type: 'button', class: `ex-card ${state[key] === value ? 'is-on' : ''}`, onclick: () => { state[key] = value; draw(); } },
    h('span', { class: 'pick-icon' }, icon(ic, { size: 18 })), h('span', {}, h('strong', {}, title), h('span', {}, text)));
  const check = (key, label, hint) => h('label', { class: 'check ex-check' }, h('input', { type: 'checkbox', checked: state[key], onchange: (e) => { state[key] = e.target.checked; } }),
    h('span', {}, label, h('span', { class: 'field-hint', style: 'display:block;margin:2px 0 0' }, hint)));

  const draw = () => {
    body.replaceChildren(
      h('p', { class: 'muted', style: 'margin:0 0 16px' }, `Download a complete copy of this story that runs on any web server, with no ${BRAND.name} needed.`),
      h('div', { class: 'field-label' }, 'Format'),
      h('div', { class: 'ex-cards' },
        choice('format', 'zip', 'Website folder (.zip)', 'For Apache, nginx, IIS, S3, GitHub Pages, any static host, or just opening on your computer', 'globe'),
        choice('format', 'war', 'Tomcat web app (.war)', 'Copy into Tomcat\'s webapps folder and it is served automatically', 'file')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Version'),
        h('div', { class: 'seg seg-block' },
          h('button', { type: 'button', class: state.version === 'published' ? 'is-on' : '', disabled: !meta?.url, title: meta?.url ? '' : 'This story has not been published yet', onclick: () => { state.version = 'published'; draw(); } }, 'Published version'),
          h('button', { type: 'button', class: state.version === 'draft' ? 'is-on' : '', onclick: () => { state.version = 'draft'; draw(); } }, 'Current draft'))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Include'),
        check('images', 'Copy images into the export', 'Uploaded images are always included. This also copies images linked from other sites, where they allow it.'),
        check('data', 'Save a copy of linked map data', 'Layers keep working even if the original data source changes or goes offline.'),
        check('vendor', 'Include the map library', 'About 800 KB. Without it, the export loads MapLibre from unpkg.com.')));
    foot.replaceChildren(h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: run }, icon('download', { size: 16 }), 'Download'));
  };

  const run = async () => {
    const steps = h('ol', { class: 'ex-steps' });
    let last = null;
    const step = (text) => {
      last?.classList.add('is-done');
      last = h('li', {}, h('span', { class: 'spinner' }), text);
      steps.append(last);
    };
    body.replaceChildren(h('p', { class: 'muted', style: 'margin:0 0 12px' }, 'Building your export…'), steps);
    foot.replaceChildren(h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn', disabled: true }, 'Working…'));
    try {
      let story = draft;
      if (state.version === 'draft' && flush) await flush();
      if (state.version === 'published') story = await api('GET', `/api/public/${encodeURIComponent(meta.slug)}`);
      // saved maps are copied in, so the exported site doesn't depend on this server
      story = await withMaps(story, (mid) => api('GET', `/api/maps/${encodeURIComponent(mid)}`).then((r) => r.map));
      const out = await buildExport(story, state, browserIO, BRAND, step);
      last?.classList.add('is-done');
      const url = URL.createObjectURL(out.blob);
      const a = h('a', { href: url, download: out.filename });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      const mb = (out.blob.size / 1048576).toFixed(out.blob.size > 1048576 * 10 ? 0 : 1);
      body.replaceChildren(...[
        h('div', { class: 'pub-hero' }, h('div', { class: 'pub-badge is-live' }, icon('check', { size: 26 })),
          h('h3', {}, 'Your export is ready'), h('p', {}, `${out.filename} · ${mb} MB · ${out.count} files. Check your downloads.`)),
        h('div', { class: 'ex-howto' }, ...(state.format === 'war'
          ? [h('strong', {}, 'To host it on Tomcat'), h('ol', {}, h('li', {}, 'Copy ', h('code', {}, out.filename), ' into Tomcat\'s ', h('code', {}, 'webapps/'), ' folder.'),
            h('li', {}, 'Open ', h('code', {}, `http://your-server:8080/${out.name}/`)), h('li', {}, 'Rename it to ', h('code', {}, 'ROOT.war'), ' to serve it at the site root.'))]
          : [h('strong', {}, 'To host it'), h('ol', {}, h('li', {}, 'Unzip it. You get a ', h('code', {}, `${out.name}/`), ' folder.'),
            h('li', {}, 'Upload that folder to any web server, or drop it into Tomcat\'s ', h('code', {}, 'webapps/'), '.'),
            h('li', {}, 'Or double-click ', h('code', {}, 'index.html'), ' to read it on your computer.'))])),
        out.warnings.length ? h('div', { class: 'ex-warn' }, h('strong', {}, 'Heads up'), h('ul', {}, out.warnings.map((w) => h('li', {}, w)))) : null].filter(Boolean));
      foot.replaceChildren(
        h('a', { class: 'btn btn-ghost', href: url, download: out.filename }, icon('download', { size: 16 }), 'Download again'),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done'));
    } catch (e) {
      toast(`Export failed: ${e.message}`, { tone: 'error', duration: 6000 });
      draw();
    }
  };
  draw();
}
