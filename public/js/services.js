// "Add from a map service": standard services other GIS servers publish. WMS and WMTS (pictures of a map), WFS
// (features), {z}/{x}/{y} tile addresses and PMTiles archives. Each becomes an ordinary Waymark layer.
import { h, icon, dialog, toast, fill } from './ui.js';
import { usePmtiles, isPmtiles } from './maps.js';

const uid = () => `l${Math.random().toString(36).slice(2, 8)}`;
const all = (el, name) => [...el.getElementsByTagNameNS('*', name)];
const kid = (el, name) => [...el.children].find((c) => c.localName === name);
const kids = (el, name) => [...el.children].filter((c) => c.localName === name);
const text = (el, name) => kid(el, name)?.textContent.trim() || '';
const clean = (url) => { const u = new URL(url); [...u.searchParams.keys()].forEach((k) => { if (/^(service|request|version)$/i.test(k)) u.searchParams.delete(k); }); return u; };
const withParams = (url, params) => { const u = clean(url); Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v)); return u.href.replace(/%7B/gi, '{').replace(/%7D/gi, '}'); };

/* ---------- reading service descriptions ("capabilities") ---------- */

/** What a capabilities document offers: { kind, title, layers: [{ name, title, layer() → layer definition }] }. */
export function describeService(xml, url) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (!root || root.localName === 'parsererror' || all(doc, 'parsererror').length) throw new Error('That address didn\'t return a service description');
  if (/ServiceException|ExceptionReport/.test(root.localName)) throw new Error(root.textContent.trim().slice(0, 200) || 'The service returned an error');
  const serviceTitle = text(kid(root, 'Service') || kid(root, 'ServiceIdentification') || root, 'Title');

  if (/^(WMS_Capabilities|WMT_MS_Capabilities)$/.test(root.localName)) {
    const version = root.getAttribute('version') || '1.1.1';
    const v13 = version.startsWith('1.3');
    const png = all(root, 'GetMap').flatMap((g) => kids(g, 'Format')).some((f) => /png/i.test(f.textContent));
    const layers = all(root, 'Layer').filter((l) => kid(l, 'Name')).map((l) => {
      const name = text(l, 'Name');
      const title = text(l, 'Title') || name;
      const credit = kid(l, 'Attribution') ? text(kid(l, 'Attribution'), 'Title') : '';
      return { name, title, layer: () => ({ id: uid(), type: 'raster', name: title, attribution: credit || serviceTitle,
        tiles: withParams(url, { service: 'WMS', version: v13 ? '1.3.0' : '1.1.1', request: 'GetMap', layers: name, styles: '', format: png ? 'image/png' : 'image/jpeg', transparent: 'true',
          [v13 ? 'crs' : 'srs']: 'EPSG:3857', width: '256', height: '256', bbox: '{bbox-epsg-3857}' }),
        style: { opacity: 0.85 }, service: 'wms' }) };
    });
    return { kind: 'wms', label: 'WMS', title: serviceTitle, layers };
  }

  if (root.localName === 'Capabilities' && all(root, 'TileMatrixSet').length) {
    const mercator = (id) => /GoogleMapsCompatible|3857|900913|WebMercator|PM$|GoogleCRS84Quad/i.test(id);
    const kvp = all(root, 'OperationsMetadata').flatMap((o) => all(o, 'Operation')).filter((o) => o.getAttribute('name') === 'GetTile').flatMap((o) => all(o, 'Get'))
      .map((g) => g.getAttribute('xlink:href') || g.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).find(Boolean);
    const layers = all(kid(root, 'Contents') || root, 'Layer').map((l) => {
      const name = text(l, 'Identifier');
      const title = text(l, 'Title') || name;
      const sets = kids(l, 'TileMatrixSetLink').map((s) => text(s, 'TileMatrixSet'));
      const set = sets.find(mercator);
      if (!name || !set) return null;
      const style = kids(l, 'Style').find((s) => s.getAttribute('isDefault') === 'true') || kid(l, 'Style');
      const styleId = style ? text(style, 'Identifier') : 'default';
      const formats = kids(l, 'Format').map((f) => f.textContent.trim());
      const format = formats.find((f) => /png/i.test(f)) || formats.find((f) => /jpe?g/i.test(f)) || formats[0] || 'image/png';
      const res = kids(l, 'ResourceURL').find((r) => r.getAttribute('resourceType') === 'tile');
      const time = kids(l, 'Dimension').find((d) => /^time$/i.test(text(d, 'Identifier')));
      let tiles;
      if (res) {
        tiles = res.getAttribute('template').replace(/\{style\}/i, styleId).replace(/\{TileMatrixSet\}/i, set).replace(/\{TileMatrix\}/i, '{z}').replace(/\{TileRow\}/i, '{y}').replace(/\{TileCol\}/i, '{x}')
          .replace(/\{time\}/i, time ? '{date}' : 'default');
      } else {
        tiles = withParams(kvp || url, { service: 'WMTS', request: 'GetTile', version: '1.0.0', layer: name, style: styleId, tilematrixset: set, format, tilematrix: '{z}', tilerow: '{y}', tilecol: '{x}' });
      }
      return { name, title, layer: () => ({ id: uid(), type: 'raster', name: title, attribution: serviceTitle, tiles, style: { opacity: 0.85 }, service: 'wmts' }) };
    }).filter(Boolean);
    return { kind: 'wmts', label: 'WMTS', title: serviceTitle, layers };
  }

  if (root.localName === 'WFS_Capabilities') {
    const version = root.getAttribute('version') || '2.0.0';
    const v2 = version.startsWith('2');
    const layers = all(root, 'FeatureType').map((t) => {
      const name = text(t, 'Name');
      const title = text(t, 'Title') || name;
      return name ? { name, title, layer: () => ({ id: uid(), name: title, attribution: serviceTitle,
        url: withParams(url, { service: 'WFS', version: v2 ? '2.0.0' : '1.1.0', request: 'GetFeature', [v2 ? 'typeNames' : 'typeName']: name, outputFormat: 'application/json', srsName: 'EPSG:4326', [v2 ? 'count' : 'maxFeatures']: '20000' }),
        style: { color: '#2563eb' }, popup: {}, service: 'wfs' }) } : null;
    }).filter(Boolean);
    return { kind: 'wfs', label: 'WFS', title: serviceTitle, layers };
  }
  throw new Error('That isn\'t a WMS, WMTS or WFS service description');
}

// Many servers don't allow other websites to read their description, so fall back to fetching it through our server.
async function fetchText(url) {
  try {
    const res = await fetch(url);
    if (res.ok) return await res.text();
  } catch { /* blocked by the other server's cross-site rules */ }
  const res = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Could not reach that address (${res.status})`);
  return res.text();
}

/** Works out what a pasted address is and what it offers. */
export async function inspectService(input) {
  const url = input.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('Paste a full address starting with https://');
  if (isPmtiles(url)) {
    const pm = await usePmtiles();
    const archive = new pm.PMTiles(url);
    const [header, meta] = await Promise.all([archive.getHeader(), archive.getMetadata().catch(() => ({}))]);
    const name = meta?.name || decodeURIComponent(url.split('/').pop().replace(/\.pmtiles.*$/i, '')).replace(/[_-]+/g, ' ');
    const bbox = [header.minLon, header.minLat, header.maxLon, header.maxLat].every(Number.isFinite) ? [header.minLon, header.minLat, header.maxLon, header.maxLat] : undefined;
    if (header.tileType !== 1) { // 1 = vector tiles; everything else is a picture
      return { kind: 'pmtiles', label: 'PMTiles (imagery)', title: name, layers: [{ name, title: name, layer: () => ({ id: uid(), type: 'raster', name, attribution: meta?.attribution || '', tiles: `pmtiles://${url}`, pmtiles: true, maxzoom: header.maxZoom, style: { opacity: 0.85 } }) }] };
    }
    const vls = meta?.vector_layers || [];
    if (!vls.length) throw new Error('That PMTiles file doesn\'t list its layers');
    return { kind: 'pmtiles', label: 'PMTiles (vector tiles)', title: name, layers: vls.map((vl) => ({ name: vl.id, title: vl.description || vl.id,
      layer: () => ({ id: uid(), type: 'vector', name: vls.length > 1 ? `${name}: ${vl.id}` : name, attribution: (meta?.attribution || '').replace(/<[^>]+>/g, ''), tiles: url, sourceLayer: vl.id, fields: Object.keys(vl.fields || {}), bbox, style: { color: '#2563eb' }, popup: {} }) })) };
  }
  if (/\{z\}/i.test(url) || /\{bbox-epsg-3857\}/i.test(url)) {
    const vector = /\.(pbf|mvt)(\?|$)/i.test(url);
    const name = new URL(url.replace(/[{}]/g, '')).hostname.replace(/^www\./, '');
    return { kind: 'xyz', label: vector ? 'Vector tiles' : 'Map tiles', title: name, needsSourceLayer: vector,
      layers: [{ name, title: name, layer: (sourceLayer) => (vector ? { id: uid(), type: 'vector', name, attribution: '', tiles: url, sourceLayer: sourceLayer || 'layer', style: { color: '#2563eb' }, popup: {} }
        : { id: uid(), type: 'raster', name, attribution: '', tiles: url, style: { opacity: 0.85 } }) }] };
  }
  // Otherwise ask the server what it is. Try the address as given, then as each kind of service.
  const tries = /request=GetCapabilities/i.test(url) || /\.xml(\?|$)/i.test(url) ? [url] : [
    withParams(url, { service: 'WMS', request: 'GetCapabilities' }),
    withParams(url, { service: 'WMTS', request: 'GetCapabilities' }),
    withParams(url, { service: 'WFS', request: 'GetCapabilities' }),
  ];
  const hinted = /wmts/i.test(url) ? 1 : /wfs/i.test(url) ? 2 : 0;
  let last;
  for (const t of [tries[hinted], ...tries.filter((_, i) => i !== hinted)].filter(Boolean)) {
    try {
      const found = describeService(await fetchText(t), url);
      if (found.layers.length) return found;
      last = new Error('That service doesn\'t list any layers Waymark can show');
    } catch (e) { last = e; }
  }
  throw last || new Error('Could not read that service');
}

/* ---------- dialog ---------- */

/** onAdd(layer) is called for each layer the person picks. */
export function openServices({ onAdd }) {
  const input = h('input', { class: 'input', type: 'url', placeholder: 'https://… WMS, WMTS or WFS address, a {z}/{x}/{y} tile address, or a .pmtiles file' });
  const out = h('div', { class: 'svc-out' });
  const go = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => find() }, 'Look up');
  const examples = [
    ['USGS topo (WMS)', 'https://basemap.nationalmap.gov/arcgis/services/USGSTopo/MapServer/WMSServer'],
    ['NASA GIBS (WMTS)', 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/wmts.cgi'],
    ['OpenStreetMap (tiles)', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
  ];
  async function find() {
    fill(out, h('p', { class: 'uploading' }, h('span', { class: 'spinner' }), 'Asking the server what it offers…'));
    go.disabled = true;
    try {
      const svc = await inspectService(input.value);
      let query = '';
      const sourceLayer = svc.needsSourceLayer ? h('input', { class: 'input', type: 'text', placeholder: 'Layer name inside the tiles, e.g. buildings' }) : null;
      const list = h('div', { class: 'sub-list svc-list' });
      const draw = () => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const shown = svc.layers.filter((l) => words.every((w) => `${l.title} ${l.name}`.toLowerCase().includes(w))).slice(0, 200);
        fill(list, ...(shown.length ? shown.map((l) => h('button', { type: 'button', class: 'pick', onclick: () => {
          if (sourceLayer && !sourceLayer.value.trim()) { toast('Type the name of the layer inside the tiles first.', { tone: 'error' }); sourceLayer.focus(); return; }
          onAdd(l.layer(sourceLayer?.value.trim()));
          toast(`Added "${l.title}"`, { tone: 'ok' });
        } }, h('span', { class: 'pick-icon' }, icon(svc.kind === 'wfs' || /vector/i.test(svc.label) ? 'layers' : 'image', { size: 18 })),
        h('span', {}, h('strong', {}, l.title), l.name !== l.title ? h('span', {}, l.name) : null))) : [h('p', { class: 'muted' }, 'No layers match.')]));
      };
      fill(out,
        h('div', { class: 'row', style: 'margin:4px 0 8px' }, h('span', { class: 'pill is-live' }, svc.label), h('strong', {}, svc.title || 'Service'), h('span', { class: 'spacer' }),
          h('span', { class: 'muted' }, `${svc.layers.length.toLocaleString()} ${svc.layers.length === 1 ? 'layer' : 'layers'}`)),
        svc.kind === 'wfs' ? h('p', { class: 'field-hint' }, 'WFS layers come in as features (up to 20,000), so you can style, filter and analyze them.') : null,
        sourceLayer ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Layer inside the tiles'), sourceLayer) : null,
        svc.layers.length > 8 ? h('input', { class: 'input', type: 'search', placeholder: 'Search these layers', style: 'margin-bottom:8px', oninput: (e) => { query = e.target.value; draw(); } }) : null,
        list);
      draw();
    } catch (e) {
      fill(out, h('p', { class: 'form-error' }, e.message));
    } finally { go.disabled = false; }
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') find(); });
  const dlg = dialog({
    title: 'Add from a map service',
    body: h('div', { class: 'svc' },
      h('p', { class: 'field-hint', style: 'margin-top:0' }, 'Paste the address of a WMS, WMTS or WFS service, a tile address with {z}/{x}/{y}, or a PMTiles file. Waymark asks the server what it offers and lets you pick layers.'),
      h('div', { class: 'row' }, input, go),
      h('div', { class: 'row row-wrap', style: 'gap:6px;margin:8px 0' }, h('span', { class: 'muted', style: 'font-size:12.5px' }, 'Try:'),
        examples.map(([label, url]) => h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { input.value = url; find(); } }, label))),
      out),
    actions: [h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Done')],
  });
  setTimeout(() => input.focus(), 30);
  return dlg;
}
