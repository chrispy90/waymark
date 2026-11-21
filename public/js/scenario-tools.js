// Scenario tools beyond the basics: terrain and the movement table, lines of communication, combat, objectives,
// planning graphics, the rules, and spreadsheet import. scenario.js owns the page and passes a context (ctx) with the
// game state and the actions every tool needs; this file adds the panels, what they draw on the map, and the unit
// details that go with them.
import { h, icon, toast, dialog, confirmDialog } from './ui.js';
import { KINDS, sideOf, distanceKm, circle, turnLabel, hoursLabel, addUnit } from './scenario-core.js';
import * as R from './scenario-rules.js';
import { buildTerrain, suggestCellKm, CELL_SIZES, MAX_CELLS, TERRAIN_CREDIT } from './scenario-terrain.js';
import { crtChances, monteCarloCombat } from './scenario-report.js';
import { toMgrs } from './mgrs.js';

const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const km = (n) => (n < 10 ? `${Math.round(n * 10) / 10} km` : `${Math.round(n)} km`);
const ZONE_COLORS = { slow: '#d97706', block: '#dc2626', cost: '#7c3aed', jam: '#db2777' };
const head = (title, hint) => [h('h2', { class: 'me-h' }, title), hint ? h('p', { class: 'me-hint' }, hint) : null];
const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };

export function createTools(ctx) {
  const doc = () => ctx.doc;
  const live = () => ctx.live();
  let terrainView = 'off'; // 'off' | 'cover' | a mobility key ("how fast can a tracked unit go here")
  let linkTpl = { type: 'road', side: '', name: '' };
  let nodeTpl = { type: 'depot', side: '', name: '' };
  let gfxTpl = { type: 'phase', side: '', label: '' };
  let combat = { defender: null, attackers: null, outcome: null, mc: null };
  let terrainFC = { key: '', data: null };
  const htmlMarkers = [];

  /* ---------- small shared controls ---------- */

  const sideSelect = (value, set, { any = 'Any side', disabled = false } = {}) => h('select', { disabled, onchange: (e) => set(e.target.value) },
    any ? h('option', { value: '', selected: !value }, any) : null, doc().sides.map((s) => h('option', { value: s.id, selected: value === s.id }, s.name)));
  const dot = (color) => h('i', { class: 'wg-dot', style: `background:${color}` });
  const field = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
  const numberInput = (value, set, { min = 0, max, step = 'any', placeholder = '', disabled = false } = {}) =>
    h('input', { class: 'input', type: 'number', min, max, step, value: value ?? '', placeholder, disabled, onchange: (e) => set(e.target.value === '' ? '' : num(e.target.value)) });
  const linkName = (id) => (doc().network?.links || []).find((l) => l.id === id)?.name || (doc().network?.nodes || []).find((x) => x.id === id)?.name || 'Unknown';

  /* ---------- map layers ---------- */

  const empty = () => ({ type: 'FeatureCollection', features: [] });
  const by = (name) => ['==', ['get', 'layer'], name];
  function layersBelow(map) {
    terrainFC = { key: '', data: null }; // a new map style starts with empty sources
    map.addSource('wg-terrain', { type: 'geojson', data: empty() });
    map.addSource('wg-below', { type: 'geojson', data: empty() });
    map.addLayer({ id: 'wg-terrain-fill', type: 'fill', source: 'wg-terrain', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.5, 'fill-outline-color': 'rgba(0,0,0,0)' } });
    map.addLayer({ id: 'wg-zone-fill', type: 'fill', source: 'wg-below', filter: by('zone'), paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] } });
    map.addLayer({ id: 'wg-zone-line', type: 'line', source: 'wg-below', filter: by('zone'), paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'wg-obj-fill', type: 'fill', source: 'wg-below', filter: by('objective'), paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.1 } });
    map.addLayer({ id: 'wg-obj-line', type: 'line', source: 'wg-below', filter: by('objective'), paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [1, 1.5] } });
  }
  function layersAbove(map) {
    map.addSource('wg-extra', { type: 'geojson', data: empty() });
    const line = (id, layer, paint, layout = {}) => map.addLayer({ id, type: 'line', source: 'wg-extra', filter: by(layer), layout: { 'line-cap': 'round', 'line-join': 'round', ...layout }, paint });
    const fillL = (id, layer, paint) => map.addLayer({ id, type: 'fill', source: 'wg-extra', filter: by(layer), paint });
    line('wg-interdict', 'interdict', { 'line-color': '#dc2626', 'line-width': 12, 'line-opacity': 0.22 });
    line('wg-link-casing', 'link-casing', { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.85 });
    line('wg-link-open', 'link-open', { 'line-color': ['get', 'color'], 'line-width': 3.5 });
    line('wg-link-degraded', 'link-degraded', { 'line-color': '#d97706', 'line-width': 3.5, 'line-dasharray': [2, 1.6] }, { 'line-cap': 'butt' });
    line('wg-link-cut', 'link-cut', { 'line-color': '#dc2626', 'line-width': 3, 'line-dasharray': [1, 2.2], 'line-opacity': 0.85 }, { 'line-cap': 'butt' });
    line('wg-link-signal', 'link-signal', { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [0.6, 1.8] });
    fillL('wg-gfx-fill', 'gfx-area', { 'fill-color': ['get', 'color'], 'fill-opacity': 0.08 });
    line('wg-gfx-dash', 'gfx-dash', { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [4, 2.5] }, { 'line-cap': 'butt' });
    line('wg-gfx-solid', 'gfx-solid', { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] });
    fillL('wg-gfx-head', 'gfx-head', { 'fill-color': ['get', 'color'] });
    line('wg-plan-line', 'plan', { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [2, 1.4], 'line-opacity': 0.9 }, { 'line-cap': 'butt' });
    fillL('wg-plan-head', 'plan-head', { 'fill-color': ['get', 'color'], 'fill-opacity': 0.9 });
    fillL('wg-draft-fill', 'draft-area', { 'fill-color': '#0ea5e9', 'fill-opacity': 0.12 });
    line('wg-draft-line', 'draft-line', { 'line-color': '#0284c7', 'line-width': 2.5, 'line-dasharray': [2, 1.5] }, { 'line-cap': 'butt' });
    map.addLayer({ id: 'wg-draft-pt', type: 'circle', source: 'wg-extra', filter: by('draft-pt'), paint: { 'circle-radius': 4.5, 'circle-color': '#fff', 'circle-stroke-color': '#0284c7', 'circle-stroke-width': 2 } });
  }

  const goingColor = (f) => (f <= 0 ? '#7f1d1d' : f < 0.25 ? '#dc2626' : f < 0.5 ? '#f59e0b' : f < 0.8 ? '#facc15' : '#22c55e');
  function terrainFeatures(T) {
    const key = terrainView === 'off' || !T ? 'off' : terrainView === 'cover' ? `cover|${T.n}|${doc().terrain.built}` : `${terrainView}|${ctx.rev}|${ctx.branchId}|${ctx.turnIx}`;
    if (terrainFC.key === key) return null;
    let features = [];
    if (key !== 'off') {
      const field = terrainView === 'cover' ? null : R.movementField(doc(), ctx.turn(), ctx.turnIx, T, terrainView);
      features = new Array(T.n);
      for (let i = 0; i < T.n; i++) {
        let color;
        if (field) color = goingColor(field.speed[i]);
        else color = T.roadOf(i) === 2 ? '#78716c' : T.roadOf(i) === 1 ? '#a8a29e' : T.riverOf(i) ? '#60a5fa' : R.COVER[T.coverOf(i)].color;
        features[i] = { type: 'Feature', properties: { color }, geometry: { type: 'Polygon', coordinates: [T.ring(i)] } };
      }
    }
    terrainFC = { key, data: { type: 'FeatureCollection', features } };
    return terrainFC.data;
  }

  const marker = (map, el, ll, anchor = 'center') => { htmlMarkers.push(new maplibregl.Marker({ element: el, anchor }).setLngLat(ll).addTo(map)); };
  const visibleTo = (side) => !side || ctx.viewAs === 'all' || ctx.viewAs === side;

  /** Draws terrain, zones, lines, objectives, graphics, planned moves and the shape being drawn. */
  function draw(map, F) {
    if (!map.getSource('wg-extra')) return;
    htmlMarkers.splice(0).forEach((m) => m.remove());
    const d = doc();
    const t = ctx.turn();
    const tf = terrainFeatures(F.T);
    if (tf) map.getSource('wg-terrain').setData(tf);

    const below = [];
    for (const z of d.zones || []) {
      if (!(z.coords?.length > 2)) continue;
      const on = R.zoneActive(z, t, ctx.turnIx);
      below.push({ type: 'Feature', properties: { layer: 'zone', color: ZONE_COLORS[z.effect] || '#64748b', opacity: on ? 0.16 : 0.04 }, geometry: { type: 'Polygon', coordinates: [[...z.coords, z.coords[0]]] } });
      if (on) marker(map, h('div', { class: 'wg-tag', style: `--c:${ZONE_COLORS[z.effect]}` }, z.name || R.ZONE_EFFECTS[z.effect]), centroid(z.coords));
    }
    for (const o of d.objectives || []) {
      const holder = F.control[o.id];
      const color = holder && holder !== 'contested' ? sideOf(d, holder).color : holder === 'contested' ? '#d97706' : '#6b7280';
      below.push({ type: 'Feature', properties: { layer: 'objective', color }, geometry: { type: 'Polygon', coordinates: [circle(o.lngLat, Number(o.radiusKm) || 1, 48)] } });
      marker(map, h('div', { class: 'wg-obj', style: `--c:${color}`, title: `${o.name}: ${o.points || 0} points${holder === 'contested' ? ', contested' : holder ? `, held by ${sideOf(d, holder).name}` : ', not held'}` },
        icon('flag', { size: 13 }), h('span', {}, o.name || 'Objective'), o.points ? h('b', {}, String(o.points)) : null), o.lngLat);
    }
    map.getSource('wg-below').setData({ type: 'FeatureCollection', features: below });

    const fs = [];
    for (const c of F.cuts) if (c.coords && visibleTo((d.network.links.find((l) => l.id === c.link) || {}).side)) fs.push({ type: 'Feature', properties: { layer: 'interdict' }, geometry: { type: 'LineString', coordinates: c.coords } });
    for (const link of d.network?.links || []) {
      if (!(link.coords?.length > 1) || !visibleTo(link.side)) continue;
      const st = R.statusOf(t, link.id);
      const color = link.side ? sideOf(d, link.side).color : R.LINK_TYPES[link.type]?.color || '#57534e';
      const geometry = { type: 'LineString', coordinates: link.coords };
      if (link.type !== 'signal') fs.push({ type: 'Feature', properties: { layer: 'link-casing' }, geometry });
      fs.push({ type: 'Feature', properties: { layer: st === 'cut' ? 'link-cut' : link.type === 'signal' ? 'link-signal' : st === 'degraded' ? 'link-degraded' : 'link-open', color }, geometry });
      const threatened = F.cuts.some((c) => c.link === link.id);
      if (st === 'cut' || threatened) marker(map, h('div', { class: `wg-cutmark${st === 'cut' ? '' : ' is-threat'}`, title: `${link.name || 'Line'}: ${st === 'cut' ? 'cut' : 'cut by enemy units'}` }, '✕'), st === 'cut' ? R.midpoint(link.coords) : R.midpoint(F.cuts.find((c) => c.link === link.id).coords));
    }
    for (const node of d.network?.nodes || []) {
      if (!visibleTo(node.side)) continue;
      const lost = R.statusOf(t, node.id) === 'cut' || F.cuts.some((c) => c.node === node.id);
      marker(map, h('div', { class: `wg-node${lost ? ' is-lost' : ''}`, style: `--c:${node.side ? sideOf(d, node.side).color : '#57534e'}`, title: `${node.name || R.NODE_TYPES[node.type]}${lost ? ' (lost)' : ''}` },
        h('b', {}, { depot: 'D', port: 'P', airfield: 'A', relay: 'R' }[node.type] || '•'), h('span', {}, node.name || R.NODE_TYPES[node.type])), node.lngLat);
    }
    for (const g of t.graphics || []) {
      if (!visibleTo(g.side)) continue;
      const color = g.type === 'obstacle' ? '#d97706' : g.type === 'ea' ? '#dc2626' : g.side ? sideOf(d, g.side).color : '#111827';
      if (g.type === 'label') { marker(map, h('div', { class: 'wg-gfx-label', style: `--c:${color}` }, g.label || 'Label'), g.coords[0]); continue; }
      if (!(g.coords?.length > 1)) continue;
      const isPoly = g.type === 'area' || g.type === 'ea' || g.type === 'nai';
      if (isPoly) {
        fs.push({ type: 'Feature', properties: { layer: 'gfx-area', color }, geometry: { type: 'Polygon', coordinates: [[...g.coords, g.coords[0]]] } });
        fs.push({ type: 'Feature', properties: { layer: g.type === 'ea' ? 'gfx-solid' : 'gfx-dash', color, width: g.type === 'ea' ? 2.5 : 2 }, geometry: { type: 'LineString', coordinates: [...g.coords, g.coords[0]] } });
      } else {
        fs.push({ type: 'Feature', properties: { layer: g.type === 'phase' || g.type === 'obstacle' ? 'gfx-dash' : 'gfx-solid', color, width: g.type === 'arrow' || g.type === 'flot' ? 5 : 3 }, geometry: { type: 'LineString', coordinates: g.coords } });
        if (g.type === 'arrow') { const head = R.arrowHead(g.coords, arrowKm(g.coords)); if (head) fs.push({ type: 'Feature', properties: { layer: 'gfx-head', color }, geometry: { type: 'Polygon', coordinates: [head] } }); }
      }
      if (g.label) {
        const ends = g.type === 'phase' || g.type === 'boundary' || g.type === 'flot';
        if (ends) { marker(map, h('div', { class: 'wg-gfx-label', style: `--c:${color}` }, g.label), g.coords[0], 'right'); marker(map, h('div', { class: 'wg-gfx-label', style: `--c:${color}` }, g.label), g.coords.at(-1), 'left'); }
        else marker(map, h('div', { class: 'wg-gfx-label', style: `--c:${color}` }, g.label), isPoly ? centroid(g.coords) : R.midpoint(g.coords));
      }
    }
    for (const u of t.units) {
      if (!ctx.shown(u) || !visibleTo(u.side)) continue;
      if (u.plan?.to) {
        const coords = u.plan.path?.length > 1 ? u.plan.path : [u.lngLat, u.plan.to];
        const color = sideOf(d, u.side).color;
        fs.push({ type: 'Feature', properties: { layer: 'plan', color }, geometry: { type: 'LineString', coordinates: coords } });
        const head = R.arrowHead(coords, arrowKm(coords));
        if (head) fs.push({ type: 'Feature', properties: { layer: 'plan-head', color }, geometry: { type: 'Polygon', coordinates: [head] } });
      }
      if (u.delayedPlan?.to) {
        const coords = u.delayedPlan.path?.length > 1 ? u.delayedPlan.path : [u.lngLat, u.delayedPlan.to];
        fs.push({ type: 'Feature', properties: { layer: 'plan', color: '#d97706' }, geometry: { type: 'LineString', coordinates: coords } });
        const head = R.arrowHead(coords, arrowKm(coords));
        if (head) fs.push({ type: 'Feature', properties: { layer: 'plan-head', color: '#d97706' }, geometry: { type: 'Polygon', coordinates: [head] } });
      }
    }
    const dr = ctx.drawing();
    if (dr) {
      const pts = [...dr.coords, ...(dr.cursor ? [dr.cursor] : [])];
      if (dr.mode === 'polygon' && pts.length > 2) fs.push({ type: 'Feature', properties: { layer: 'draft-area' }, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } });
      if (pts.length > 1) fs.push({ type: 'Feature', properties: { layer: 'draft-line' }, geometry: { type: 'LineString', coordinates: dr.mode === 'polygon' && pts.length > 2 ? [...pts, pts[0]] : pts } });
      dr.coords.forEach((p) => fs.push({ type: 'Feature', properties: { layer: 'draft-pt' }, geometry: { type: 'Point', coordinates: p } }));
    }
    map.getSource('wg-extra').setData({ type: 'FeatureCollection', features: fs });
  }
  const arrowKm = (coords) => Math.max(0.08, Math.min(3, coords.slice(1).reduce((s, p, i) => s + distanceKm(coords[i], p), 0) * 0.12));
  const centroid = (coords) => [coords.reduce((s, p) => s + p[0], 0) / coords.length, coords.reduce((s, p) => s + p[1], 0) / coords.length];

  /* ---------- unit details ---------- */

  /** Little flags on a unit's map symbol and list row: supply, contact, planned move. */
  function unitFlags(u, F) {
    const out = [];
    const sup = F.supply.get(u.id)?.state;
    if (u.status !== 'destroyed') {
      if (sup === 'out') out.push(['out', 'S', 'Out of supply']);
      else if (sup === 'strained') out.push(['strained', 'S', 'Supply strained']);
      if (F.command.get(u.id)?.state === 'out') out.push(['nocomms', 'C', `Out of contact: ${F.command.get(u.id).why}`]);
      if (Number(u.ammoMax) > 0 && Number(u.ammo ?? 0) <= 0) out.push(['out', 'A', 'Out of munitions / sorties']);
    }
    if (u.plan && visibleTo(u.side)) out.push(['plan', 'P', 'Move planned']);
    if (u.delayedPlan && visibleTo(u.side)) out.push(['strained', 'D', 'C2 delayed move queued for next turn']);
    return out;
  }

  /** The extra parts of the unit panel: movement and supply, headquarters, sensors and combat value. */
  function unitSection(u, F) {
    const ro = !live();
    const d = doc();
    const set = (patch) => ctx.mutate(() => Object.assign(ctx.turn().units.find((x) => x.id === u.id), patch));
    const m = R.mobilityOf(u);
    const sup = F.supply.get(u.id);
    const cmd = F.command.get(u.id);
    const tracked = !!F.T || (d.network?.nodes || []).length > 0;
    const level = Math.max(0, Math.round((u.supply ?? 100) - (Number(u.used) || 0)));
    const outTurns = sup?.state === 'out' ? R.turnsOutOfSupply(d, ctx.branch(), ctx.turnIx, u.id) : 0;
    const descendants = new Set([u.id]);
    let grew = true;
    while (grew) { grew = false; for (const x of ctx.turn().units) if (x.parent && descendants.has(x.parent) && !descendants.has(x.id)) { descendants.add(x.id); grew = true; } }
    const hqs = ctx.turn().units.filter((x) => x.side === u.side && !descendants.has(x.id));
    const power = R.unitPower(d, ctx.turn(), ctx.turnIx, F.T, u, 'attack', F);
    const foes = ctx.turn().units.some((x) => R.isOpposed(d, x.side, u.side) && x.status !== 'destroyed');
    const sensorNow = R.sensorRange(d, ctx.turn(), ctx.turnIx, u);
    return h('div', { class: 'wg-more' },
      h('p', { class: 'wg-gridref', title: 'Military grid reference (MGRS)' }, icon('grid', { size: 13 }), toMgrs(u.lngLat, 5) || `${u.lngLat[1].toFixed(5)}, ${u.lngLat[0].toFixed(5)}`),
      h('div', { class: 'rail-section-title' }, 'Movement and supply'),
      h('div', { class: 'grid-2' },
        field('Moves', h('select', { disabled: ro, onchange: (e) => set({ mobility: e.target.value || undefined }) },
          h('option', { value: '', selected: !u.mobility }, `Usual (${R.MOBILITY[R.mobilityOf({ kind: u.kind })].label.toLowerCase()})`),
          Object.entries(R.MOBILITY).map(([k, v]) => h('option', { value: k, selected: u.mobility === k }, v.label)))),
        tracked ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, h('span', {}, 'Supply'), h('span', { class: 'muted' }, `${level}%`)),
          h('span', { class: 'wg-supply' }, h('i', { style: `width:${level}%;background:${level > 50 ? '#16a34a' : level > 20 ? '#d97706' : '#dc2626'}` })),
          u.used ? h('span', { class: 'field-hint' }, `This turn's move used ${Math.round(u.used)}%.`) : null) : h('span')),
      sup && sup.state !== 'none' ? h('p', { class: `wg-state is-${sup.state}` }, dot(sup.state === 'in' ? '#16a34a' : sup.state === 'strained' ? '#d97706' : '#dc2626'),
        sup.state === 'in' ? `In supply through ${sup.via}${sup.km != null ? `, ${km(sup.km)} from a depot` : ''}`
          : sup.state === 'strained' ? `Supply strained: only through ${sup.via}` : `Out of supply${outTurns > 1 ? ` for ${outTurns} turns` : ''}. ${F.rules.auto ? `Loses ${F.rules.lossPct}% strength each turn and moves cost double.` : ''}`) : null,
      F.T ? h('p', { class: 'field-hint' }, m === 'fixed' ? 'This unit doesn\'t move.' : `Over this terrain it moves at up to ${R.speedOf(u)} km/h on main roads, slower off them.`) : null,
      h('div', { class: 'rail-section-title' }, 'Command and sensors'),
      field('Reports to', h('select', { disabled: ro, onchange: (e) => set({ parent: e.target.value || undefined }) },
        h('option', { value: '', selected: !u.parent }, 'No one (not tracked)'), hqs.map((x) => h('option', { value: x.id, selected: u.parent === x.id }, x.name)))),
      cmd ? h('p', { class: `wg-state is-${cmd.state === 'ok' ? 'in' : 'out'}` }, dot(cmd.state === 'ok' ? '#16a34a' : '#dc2626'), cmd.state === 'ok' ? `In contact: ${cmd.why}` : `Out of contact: ${cmd.why}`) : null,
      h('div', { class: 'grid-2' },
        field('Sensor range (km)', numberInput(u.sensorKm || '', (v) => set({ sensorKm: v || 0 }), { placeholder: 'None', disabled: ro }), Number(u.sensorKm) > 0 && sensorNow < Number(u.sensorKm) ? `${sensorNow} km now, with the weather and light` : null),
        field('Combat value', numberInput(u.power ?? '', (v) => set({ power: v === '' ? undefined : v }), { placeholder: `Worked out: ${power.value}`, disabled: ro }))),
      h('div', { class: 'grid-2' },
        field('Facing (°)', numberInput(u.fanDir ?? '', (v) => set({ fanDir: v === '' ? undefined : ((Math.round(v) % 360) + 360) % 360 }), { min: 0, max: 359, placeholder: 'North 0, east 90', disabled: ro })),
        field('Arc (°)', numberInput(u.fanArc ?? '', (v) => set({ fanArc: v === '' || v >= 360 ? undefined : Math.max(10, Math.round(v)) }), { min: 10, max: 360, placeholder: 'All round', disabled: ro }))),
      Number(u.fanArc) > 0 && Number(u.fanArc) < 360 ? h('p', { class: 'field-hint', style: 'margin-top:-4px' }, `Its range, sensors and contact only cover ${u.fanArc}° centred on ${u.fanDir || 0}°.`) : null,
      h('div', { class: 'grid-2' },
        field('Munitions / sorties', numberInput(u.ammo ?? '', (v) => set({ ammo: v === '' ? undefined : Math.max(0, Math.round(v)), ...(u.ammoMax ? {} : v !== '' ? { ammoMax: Math.max(1, Math.round(v)) } : {}) }), { min: 0, step: 1, placeholder: 'Unlimited', disabled: ro })),
        field('Max load', numberInput(u.ammoMax ?? '', (v) => set({ ammoMax: v === '' ? undefined : Math.max(0, Math.round(v)), ...(v !== '' && u.ammo == null ? { ammo: Math.max(0, Math.round(v)) } : {}) }), { min: 0, step: 1, placeholder: 'Unlimited', disabled: ro }))),
      Number(u.ammoMax) > 0 && !ro ? h('div', { class: 'row', style: 'margin:-4px 0 8px;gap:6px' },
        h('span', { class: 'muted', style: 'font-size:12px' }, `${u.ammo ?? 0} of ${u.ammoMax} remaining`),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-sm', disabled: (u.ammo ?? 0) <= 0, onclick: () => set({ ammo: Math.max(0, (u.ammo ?? 0) - 1) }) }, '−1 Spend'),
        h('button', { type: 'button', class: 'btn btn-sm', disabled: (u.ammo ?? 0) >= u.ammoMax, onclick: () => set({ ammo: Math.min(u.ammoMax, (u.ammo ?? 0) + 1) }) }, '+1 Reload')) : null,
      h('div', { class: 'row row-wrap wg-aids' },
        foes && live() && ctx.shown(u) ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => attack(u) }, icon('swords', { size: 14 }), 'Attack this unit') : null,
        u.plan && live() ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => ctx.mutate(() => { delete ctx.turn().units.find((x) => x.id === u.id).plan; }) }, icon('x', { size: 14 }), 'Cancel planned move') : null,
        u.delayedPlan && live() ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => ctx.mutate(() => { delete ctx.turn().units.find((x) => x.id === u.id).delayedPlan; }) }, icon('x', { size: 14 }), 'Cancel delayed order') : null));
  }

  /* ---------- rules (in Setup) ---------- */

  function rulesSection() {
    const ro = !ctx.canEdit;
    const r = R.rulesOf(doc());
    const set = (patch) => ctx.mutate(() => { doc().rules = { ...(doc().rules || {}), ...patch }; });
    const check = (k, label, hint) => h('label', { class: 'check wg-rule' }, h('input', { type: 'checkbox', checked: !!r[k], disabled: ro, onchange: (e) => set({ [k]: e.target.checked }) }), h('span', {}, h('strong', {}, label), h('span', { class: 'muted' }, hint)));
    return [
      h('div', { class: 'rail-section-title' }, 'Rules'),
      check('planning', 'Plan moves, then reveal', 'Dragging a unit plans its move. Reveal and move them all at once from the turn bar.'),
      check('autoSpot', 'Spot units automatically', 'Units with a sensor range see opposing units in range and in line of sight.'),
      check('auto', 'Apply supply effects', 'Units out of supply lose strength each turn, and their moves use twice the supply.'),
      check('c2Delay', 'C2 order latency (1-turn delay)', 'Units outside HQ radio range or in a jammed zone execute move orders on the next turn.'),
      h('div', { class: 'grid-2' },
        field('Strength lost per turn (%)', numberInput(r.lossPct, (v) => set({ lossPct: Math.max(0, Math.min(100, v || 0)) }), { disabled: ro || !r.auto })),
        field('Resupply per turn (%)', numberInput(r.resupply, (v) => set({ resupply: Math.max(0, Math.min(100, v || 0)) }), { disabled: ro }))),
      h('div', { class: 'grid-2' },
        field('Supply reach (km)', numberInput(r.reachKm, (v) => set({ reachKm: Math.max(0, v || 0) }), { disabled: ro }), 'From a line or depot'),
        field('Radio range (km)', numberInput(r.radioKm, (v) => set({ radioKm: Math.max(0, v || 0) }), { disabled: ro }), 'To a unit\'s headquarters')),
      field('Enemy units cut lines within (km)', numberInput(r.interdictKm, (v) => set({ interdictKm: Math.max(0, v || 0) }), { disabled: ro }), '0 turns this off. Only lines that belong to a side are cut this way.'),
      h('div', { class: 'row row-wrap' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: editCrt }, icon('swords', { size: 14 }), 'Combat table…'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: editMovement }, icon('mountain', { size: 14 }), 'Movement table…')),
    ];
  }

  /* ---------- terrain ---------- */

  function terrainPanel() {
    const d = doc();
    const F = ctx.facts();
    const T = F.T;
    const out = [...head('Terrain', 'A grid of hexes that records the ground, roads, rivers and height. Units then move along the quickest route, and rough ground slows them and uses more supply.')];
    if (!T) {
      const b = ctx.map.getBounds();
      const bounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
      let cell = suggestCellKm(bounds);
      const widthKm = distanceKm([bounds[0], (bounds[1] + bounds[3]) / 2], [bounds[2], (bounds[1] + bounds[3]) / 2]);
      out.push(h('div', { class: 'wg-add' },
        h('p', { class: 'field-hint', style: 'margin-top:0' }, `Covers the map as it is now, about ${km(widthKm)} across. Pan and zoom to the play area first.`),
        field('Cell size', h('select', { disabled: !ctx.canEdit, onchange: (e) => { cell = +e.target.value; } }, CELL_SIZES.map((k) => {
          const n = R.gridSize(bounds, k).cells;
          return h('option', { value: k, selected: k === cell, disabled: n > MAX_CELLS }, `${k < 1 ? `${k * 1000} m` : `${k} km`} · ${n.toLocaleString()} cells${n > MAX_CELLS ? ' (too many)' : ''}`);
        })), 'Smaller cells follow roads and rivers more closely. About 100 cells across the area works well.'),
        ctx.canEdit ? h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => build(bounds, cell) }, icon('mountain', { size: 15 }), 'Build the terrain') : h('p', { class: 'muted' }, 'No terrain yet.'),
        h('p', { class: 'field-hint' }, 'Needs an internet connection once, to read elevation and OpenStreetMap. The result is saved with the scenario.')));
    } else {
      const st = R.terrainStats(T);
      const grid = d.terrain;
      out.push(h('div', { class: 'wg-terrain-sum' },
        h('p', { class: 'muted' }, `${st.cells.toLocaleString()} cells, ${grid.cellKm ? (grid.cellKm < 1 ? `${grid.cellKm * 1000} m` : `${grid.cellKm} km`) : km(T.step)} apart · built ${new Date(grid.built || Date.now()).toLocaleDateString()}`),
        grid.partial ? h('p', { class: 'wg-state is-strained' }, dot('#d97706'), `Couldn't get the ${grid.partial}, so the terrain is incomplete. Rebuild it to try again.`) : null,
        h('ul', { class: 'wg-legend' }, st.cover.filter((c) => c.cells).map((c) => h('li', {}, h('i', { style: `background:${c.color}` }), c.label, h('span', { class: 'muted' }, `${c.pct}%`))),
          st.road ? h('li', {}, h('i', { style: 'background:#78716c' }), 'Main roads', h('span', { class: 'muted' }, `${st.road} cells`)) : null,
          st.minor ? h('li', {}, h('i', { style: 'background:#a8a29e' }), 'Minor roads', h('span', { class: 'muted' }, `${st.minor} cells`)) : null,
          st.river ? h('li', {}, h('i', { style: 'background:#60a5fa' }), 'Rivers', h('span', { class: 'muted' }, `${st.river} cells`)) : null)),
      field('Show on the map', h('select', { onchange: (e) => { terrainView = e.target.value; ctx.render(); } },
        h('option', { value: 'off', selected: terrainView === 'off' }, 'Nothing'), h('option', { value: 'cover', selected: terrainView === 'cover' }, 'Ground, roads and rivers'),
        Object.entries(R.MOBILITY).filter(([k]) => k !== 'fixed').map(([k, v]) => h('option', { value: k, selected: terrainView === k }, `How fast: ${v.label.toLowerCase()}`))),
      terrainView !== 'off' && terrainView !== 'cover' ? 'Green is full speed, yellow and orange slower, red very slow, dark red impassable.' : null),
      ctx.canEdit ? h('div', { class: 'row row-wrap' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { const b = ctx.map.getBounds(); build([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], grid.cellKm || suggestCellKm(T.bounds())); } }, icon('refresh', { size: 14 }), 'Rebuild for this view'),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: editMovement }, 'Movement table…'),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { if (await confirmDialog({ title: 'Remove the terrain?', danger: true, confirmLabel: 'Remove', message: 'Units go back to moving in straight lines. You can undo this.' })) ctx.mutate(() => { delete doc().terrain; }); } }, icon('trash', { size: 14 }), 'Remove')) : null,
      h('p', { class: 'field-hint' }, TERRAIN_CREDIT));
    }
    out.push(h('div', { class: 'rail-section-title' }, 'Areas'),
      h('p', { class: 'field-hint', style: 'margin-top:0' }, 'Mark ground that slows, blocks or wears units down (a minefield, flooding, contamination), or where radios are jammed. Each can start on a turn, or when an inject is released.'),
      (d.zones || []).length ? h('div', { class: 'wg-list' }, d.zones.map((z) => h('div', { class: 'wg-item' },
        dot(ZONE_COLORS[z.effect]), h('div', { class: 'wg-item-main' }, h('strong', {}, z.name || R.ZONE_EFFECTS[z.effect]), h('span', { class: 'muted' }, zoneSummary(z))),
        ctx.canEdit ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => editZone(z) }, 'Edit') : null))) : null,
      ctx.canEdit ? h('button', { type: 'button', class: 'btn btn-block', style: 'margin-top:8px', onclick: () => editZone(null) }, icon('polygon', { size: 15 }), 'Draw an area') : null);
    return out;
  }

  async function build(bounds, cellKm) {
    let note = toast('Building the terrain…', { duration: 600000 });
    try {
      const grid = await buildTerrain(bounds, cellKm, { onProgress: (text) => { note?.(); note = toast(text, { duration: 600000 }); } });
      ctx.mutate(() => { doc().terrain = grid; });
      terrainView = terrainView === 'off' ? 'cover' : terrainView;
      ctx.render();
      toast(grid.partial ? `Terrain built, but without ${grid.partial}. Try rebuilding later.` : 'Terrain built. Units now follow the ground.', { tone: grid.partial ? 'default' : 'ok', duration: 6000 });
    } catch (e) { toast(e.message, { tone: 'error', duration: 8000 }); } finally { note?.(); }
  }

  const zoneSummary = (z) => [
    z.effect === 'slow' ? `Speed ×${z.factor ?? 0.5}` : z.effect === 'cost' ? `Supply ×${z.costMult ?? 2}` : R.ZONE_EFFECTS[z.effect],
    z.mobility?.length ? z.mobility.map((m) => R.MOBILITY[m]?.label.toLowerCase()).join(', ') : z.effect === 'jam' ? null : 'all units',
    z.inject ? `after "${(doc().injects || []).find((x) => x.id === z.inject)?.title || 'an inject'}"` : Number(z.from) > 0 ? `from ${turnLabel(doc(), Number(z.from)).toLowerCase()}` : null,
    z.until != null && z.until !== '' ? `until ${turnLabel(doc(), Number(z.until)).toLowerCase()}` : null,
  ].filter(Boolean).join(' · ');

  function editZone(existing) {
    const z = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid('z'), name: '', effect: 'slow', factor: 0.5, costMult: 2, mobility: null, from: 0, until: null, inject: null };
    const name = h('input', { class: 'input', type: 'text', value: z.name, placeholder: 'e.g. Minefield', maxlength: 80 });
    const effect = h('select', {}, Object.entries(R.ZONE_EFFECTS).map(([k, l]) => h('option', { value: k, selected: z.effect === k }, l)));
    const factor = h('input', { class: 'input', type: 'number', min: 0.05, max: 1, step: 0.05, value: z.factor ?? 0.5 });
    const cost = h('input', { class: 'input', type: 'number', min: 1, max: 10, step: 0.5, value: z.costMult ?? 2 });
    const mobs = Object.entries(R.MOBILITY).filter(([k]) => k !== 'fixed').map(([k, v]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: k, checked: !z.mobility?.length || z.mobility.includes(k) }), v.label));
    const from = h('input', { class: 'input', type: 'number', min: 0, step: 1, value: z.from ?? 0 });
    const until = h('input', { class: 'input', type: 'number', min: 0, step: 1, value: z.until ?? '', placeholder: 'Never' });
    const inject = h('select', {}, h('option', { value: '' }, 'Don\'t wait for an inject'), (doc().injects || []).map((x) => h('option', { value: x.id, selected: z.inject === x.id }, `After "${x.title}"`)));
    const sync = () => { factor.closest('.field').hidden = effect.value !== 'slow'; cost.closest('.field').hidden = effect.value !== 'cost'; mobBox.hidden = effect.value === 'jam'; };
    effect.addEventListener('change', sync);
    const mobBox = h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Affects'), h('div', { class: 'wg-checks' }, mobs));
    const collect = () => {
      const picked = mobs.map((l) => l.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
      return { ...z, name: name.value.trim(), effect: effect.value, factor: Math.max(0.05, Math.min(1, +factor.value || 0.5)), costMult: Math.max(1, +cost.value || 2),
        mobility: picked.length === mobs.length ? null : picked, from: Math.max(0, Math.round(+from.value || 0)), until: until.value === '' ? null : Math.max(0, Math.round(+until.value)), inject: inject.value || null };
    };
    const dlg = dialog({ title: existing ? 'Edit area' : 'New area', cls: 'dlg-sm', body: h('div', {},
      field('Name', name), field('Effect', effect),
      field('Speed multiplier', factor, '0.5 halves speed in the area.'), field('Supply multiplier', cost, '2 means moves there use twice the supply.'),
      mobBox,
      h('div', { class: 'grid-2' }, field('Starts on turn', from), field('Ends after turn', until)),
      field('Or starts when', inject)),
    actions: [
      existing ? h('button', { type: 'button', class: 'btn', onclick: () => { dlg.close(); ctx.mutate(() => { doc().zones = doc().zones.filter((x) => x.id !== z.id); }); } }, icon('trash', { size: 14 }), 'Delete') : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
      existing ? h('button', { type: 'button', class: 'btn', onclick: () => { const next = collect(); dlg.close(); ctx.startDraw({ mode: 'polygon', hint: 'Click the corners of the area. Double-click or press Enter to finish.', done: (coords) => ctx.mutate(() => { Object.assign(doc().zones.find((x) => x.id === z.id), next, { coords }); }) }); } }, 'Redraw') : null,
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
        const next = collect();
        dlg.close();
        if (existing) ctx.mutate(() => { Object.assign(doc().zones.find((x) => x.id === z.id), next); });
        else ctx.startDraw({ mode: 'polygon', hint: 'Click the corners of the area. Double-click or press Enter to finish.', done: (coords) => ctx.mutate(() => { (doc().zones ||= []).push({ ...next, coords }); }) });
      } }, existing ? 'Save' : 'Draw it')] });
    sync();
  }

  function editMovement() {
    const ro = !ctx.canEdit;
    const mobs = Object.keys(R.MOBILITY).filter((k) => k !== 'fixed');
    const inputs = {};
    const body = h('div', {},
      h('p', { class: 'field-hint', style: 'margin-top:0' }, 'The share of top speed each kind of unit keeps on each kind of ground: 1 is full speed, 0.5 half, 0 can\'t go there. A road through a cell counts instead of its ground, so a road over a river is a bridge. Rough ground also uses more supply: half speed, twice the supply.'),
      h('div', { class: 'wg-table-wrap' }, h('table', { class: 'wg-edit-table' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), mobs.map((m) => h('th', {}, R.MOBILITY[m].label)))),
        h('tbody', {}, R.TERRAIN_KEYS.map((t) => h('tr', {}, h('th', {}, R.TERRAIN_LABELS[t]), mobs.map((m) => {
          const el = h('input', { type: 'number', min: 0, max: 1, step: 0.05, value: R.factorsFor(doc(), m)[t], disabled: ro, 'aria-label': `${R.MOBILITY[m].label} on ${R.TERRAIN_LABELS[t]}` });
          (inputs[m] ||= {})[t] = el;
          return h('td', {}, el);
        })))))),
      h('p', { class: 'field-hint' }, 'Off-road, slopes slow units too: steeper than about 35% stops wheels, 60% stops tracks.'));
    const dlg = dialog({ title: 'Movement table', cls: 'dlg-lg', body, actions: ro ? [h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done')] : [
      h('button', { type: 'button', class: 'btn', onclick: () => { dlg.close(); ctx.mutate(() => { delete doc().movement; }); toast('Movement table reset'); } }, 'Reset to standard'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
        const movement = {};
        for (const m of mobs) for (const t of R.TERRAIN_KEYS) {
          const v = Math.max(0, Math.min(1, +inputs[m][t].value || 0));
          if (v !== R.FACTORS[m][t]) (movement[m] ||= {})[t] = v;
        }
        dlg.close();
        ctx.mutate(() => { if (Object.keys(movement).length) doc().movement = movement; else delete doc().movement; });
      } }, 'Save')] });
  }

  /* ---------- lines of communication ---------- */

  function linesPanel() {
    const d = doc();
    const F = ctx.facts();
    const t = ctx.turn();
    const links = d.network?.links || [];
    const nodes = d.network?.nodes || [];
    if (!d.sides.some((s) => s.id === nodeTpl.side)) nodeTpl.side = d.sides[0].id;
    const sums = d.sides.map((s) => {
      const units = t.units.filter((u) => u.side === s.id && u.status !== 'destroyed');
      const c = (pred) => units.filter(pred).length;
      return { s, units: units.length, in: c((u) => F.supply.get(u.id)?.state === 'in'), strained: c((u) => F.supply.get(u.id)?.state === 'strained'), out: c((u) => F.supply.get(u.id)?.state === 'out'),
        tracked: c((u) => F.supply.get(u.id) && F.supply.get(u.id).state !== 'none'), nocomms: c((u) => F.command.get(u.id)?.state === 'out') };
    }).filter((x) => x.units && (x.tracked || x.nocomms));
    const statusSeg = (id, opts) => h('div', { class: 'seg wg-seg-sm', role: 'group' }, opts.map(([v, l]) => h('button', { type: 'button', class: R.statusOf(t, id) === v ? 'is-on' : '', disabled: !live(), onclick: () => ctx.mutate(() => R.setLinkStatus(d, ctx.turn(), id, v)) }, l)));
    const del = (kind, item) => async () => {
      if (!await confirmDialog({ title: `Delete "${item.name || 'this line'}"?`, danger: true, confirmLabel: 'Delete', message: 'It\'s removed from every turn and branch. You can undo this.' })) return;
      ctx.mutate(() => { d.network[kind] = d.network[kind].filter((x) => x.id !== item.id); });
    };
    return [
      ...head('Lines of communication', 'Supply routes, rail, bridges, ports and signal links. Units near an open line back to one of their side\'s depots are in supply; units with a headquarters need radio range or a signal link to it.'),
      sums.length ? h('div', { class: 'wg-list' }, sums.map((x) => h('div', { class: 'wg-sum' }, dot(x.s.color), h('strong', {}, x.s.name),
        h('span', {}, x.tracked ? [`${x.in} in supply`, x.strained ? ` · ${x.strained} strained` : '', x.out ? h('b', { class: 'is-bad' }, ` · ${x.out} out`) : ''] : 'Supply not tracked'),
        x.nocomms ? h('span', { class: 'is-bad' }, `${x.nocomms} out of contact`) : null))) : null,
      ctx.canEdit ? h('div', { class: 'wg-add' },
        h('div', { class: 'grid-2' },
          field('Line', h('select', { onchange: (e) => { linkTpl.type = e.target.value; } }, Object.entries(R.LINK_TYPES).map(([k, v]) => h('option', { value: k, selected: linkTpl.type === k }, v.label)))),
          field('Belongs to', sideSelect(linkTpl.side, (v) => { linkTpl.side = v; }, { any: 'Shared' }))),
        field('Name', h('input', { class: 'input', type: 'text', value: linkTpl.name, placeholder: 'e.g. Route 50 supply route', oninput: (e) => { linkTpl.name = e.target.value; } })),
        h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => ctx.startDraw({ mode: 'line', snap: true, hint: 'Click along the line. Ends snap to other lines and depots. Double-click or press Enter to finish.',
          done: (coords) => { const link = { id: uid('l'), name: linkTpl.name.trim() || `${R.LINK_TYPES[linkTpl.type].label} ${links.length + 1}`, type: linkTpl.type, side: linkTpl.side || null, coords }; ctx.mutate(() => { d.network ||= { links: [], nodes: [] }; (d.network.links ||= []).push(link); }); linkTpl.name = ''; } }) },
        icon('line', { size: 15 }), 'Draw the line')) : null,
      links.length ? [h('div', { class: 'rail-section-title' }, 'Lines'), h('div', { class: 'wg-list' }, links.map((l) => {
        const threat = F.cuts.find((c) => c.link === l.id);
        return h('div', { class: 'wg-item wg-item-col' },
          h('div', { class: 'row' }, dot(l.side ? sideOf(d, l.side).color : R.LINK_TYPES[l.type]?.color),
            ctx.canEdit ? h('input', { class: 'input input-sm', type: 'text', value: l.name, 'aria-label': 'Line name', onchange: (e) => ctx.mutate(() => { l.name = e.target.value.trim() || l.name; }) }) : h('strong', {}, l.name),
            ctx.canEdit ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Delete ${l.name}`, onclick: del('links', l) }, icon('trash', { size: 15 })) : null),
          h('div', { class: 'row' }, h('span', { class: 'muted' }, `${R.LINK_TYPES[l.type]?.label || 'Line'}${l.side ? ` · ${sideOf(d, l.side).name}` : ' · shared'}`), h('span', { class: 'spacer' }), statusSeg(l.id, R.LINK_STATUSES)),
          threat ? h('p', { class: 'wg-state is-out' }, dot('#dc2626'), `Cut by ${t.units.find((u) => u.id === threat.by)?.name || 'an enemy unit'}`) : null);
      }))] : null,
      ctx.canEdit ? h('div', { class: 'wg-add', style: 'margin-top:14px' },
        h('div', { class: 'grid-2' },
          field('Place', h('select', { onchange: (e) => { nodeTpl.type = e.target.value; } }, Object.entries(R.NODE_TYPES).map(([k, v]) => h('option', { value: k, selected: nodeTpl.type === k }, v)))),
          field('Belongs to', sideSelect(nodeTpl.side, (v) => { nodeTpl.side = v; }, { any: null }))),
        field('Name', h('input', { class: 'input', type: 'text', value: nodeTpl.name, placeholder: 'e.g. Fort Belvoir depot', oninput: (e) => { nodeTpl.name = e.target.value; } })),
        h('button', { type: 'button', class: 'btn btn-block', onclick: () => ctx.startDraw({ mode: 'point', hint: 'Click where it is.',
          done: ([p]) => { const node = { id: uid('n'), name: nodeTpl.name.trim() || R.NODE_TYPES[nodeTpl.type], type: nodeTpl.type, side: nodeTpl.side || null, lngLat: p }; ctx.mutate(() => { d.network ||= { links: [], nodes: [] }; (d.network.nodes ||= []).push(node); }); nodeTpl.name = ''; } }) },
        icon('pin', { size: 15 }), 'Place a depot, port, airfield or relay')) : null,
      nodes.length ? [h('div', { class: 'rail-section-title' }, 'Depots, ports, airfields and relays'), h('div', { class: 'wg-list' }, nodes.map((x) => h('div', { class: 'wg-item wg-item-col' },
        h('div', { class: 'row' }, dot(x.side ? sideOf(d, x.side).color : '#57534e'),
          ctx.canEdit ? h('input', { class: 'input input-sm', type: 'text', value: x.name, 'aria-label': 'Name', onchange: (e) => ctx.mutate(() => { x.name = e.target.value.trim() || x.name; }) }) : h('strong', {}, x.name),
          ctx.canEdit ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Delete ${x.name}`, onclick: del('nodes', x) }, icon('trash', { size: 15 })) : null),
        h('div', { class: 'row' }, h('span', { class: 'muted' }, `${R.NODE_TYPES[x.type]}${x.side ? ` · ${sideOf(d, x.side).name}` : ''}`), h('span', { class: 'spacer' }), statusSeg(x.id, [['open', 'Open'], ['cut', 'Lost']])),
        F.cuts.some((c) => c.node === x.id) ? h('p', { class: 'wg-state is-out' }, dot('#dc2626'), 'Enemy units are on it') : null)))] : null,
      !links.length && !nodes.length ? h('p', { class: 'field-hint' }, 'Start with a depot for each side, then draw the routes from it to the front. Without depots, a side\'s supply isn\'t tracked.') : null,
    ];
  }

  /* ---------- combat ---------- */

  function attack(defender) {
    combat = { defender: defender.id, attackers: null, outcome: null };
    ctx.setTool('combat');
  }

  /** In the combat panel, clicking a unit picks the defender, then toggles attackers. Returns true when handled. */
  function onUnitClick(u) {
    if (ctx.tool !== 'combat' || !live()) return false;
    const def = combat.defender && ctx.unitById(combat.defender);
    if (!def) { combat = { defender: u.id, attackers: null, outcome: null }; ctx.render(); return true; }
    if (R.isOpposed(doc(), u.side, def.side)) {
      const set = combat.attackers || new Set(candidates(def).filter((x) => x.contact).map((x) => x.u.id));
      if (set.has(u.id)) set.delete(u.id); else set.add(u.id);
      combat = { ...combat, attackers: set, outcome: null };
    } else combat = { defender: u.id, attackers: null, outcome: null };
    ctx.render();
    return true;
  }

  function candidates(def) {
    return ctx.turn().units.filter((x) => x.status !== 'destroyed' && R.isOpposed(doc(), x.side, def.side) && ctx.shown(x))
      .map((u) => { const dk = distanceKm(u.lngLat, def.lngLat); return { u, d: dk, contact: dk <= Math.max(Number(u.rangeKm) || 0, 1) }; })
      .sort((a, b) => a.d - b.d);
  }

  function combatPanel() {
    const d = doc();
    const F = ctx.facts();
    const def = combat.defender && ctx.unitById(combat.defender);
    const crt = R.crtOf(d);
    const out = [...head('Combat', 'Work out a fight with the combat table: Waymark adds up each side\'s combat value, finds the odds, and you roll.')];
    if (!def || def.status === 'destroyed') {
      const contacts = R.findContacts(d, ctx.turn()).filter((c) => ctx.shown(ctx.unitById(c.a)) && ctx.shown(ctx.unitById(c.b)));
      out.push(h('p', { class: 'field-hint', style: 'margin-top:0' }, live() ? 'Click the unit under attack on the map, or pick one below.' : ctx.canEdit ? 'Combat can only be fought on the latest turn.' : 'Fights are worked out by the people running the game. The results are in the log.'),
        contacts.length ? [h('div', { class: 'rail-section-title' }, 'Units in contact'), h('div', { class: 'wg-list' }, contacts.map((c) => {
          const [a, b] = [ctx.unitById(c.a), ctx.unitById(c.b)];
          return h('div', { class: 'wg-item' }, h('div', { class: 'wg-item-main' }, h('strong', {}, `${a.name} and ${b.name}`), h('span', { class: 'muted' }, `${c.km} km apart`)),
            live() ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => attack(b) }, `Attack ${b.name}`) : null,
            live() ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => attack(a) }, `Attack ${a.name}`) : null);
        }))] : h('p', { class: 'muted' }, 'No opposing units are in contact. Units are in contact within the longer of their ranges, or 1 km.'),
        h('button', { type: 'button', class: 'btn btn-sm', style: 'margin-top:12px', onclick: editCrt }, icon('swords', { size: 14 }), 'Combat table…'));
      return out;
    }
    const cands = candidates(def);
    const atk = combat.attackers || new Set(cands.filter((x) => x.contact).map((x) => x.u.id));
    combat.attackers = atk;
    const chosen = cands.filter((x) => atk.has(x.u.id)).map((x) => x.u);
    const o = chosen.length ? R.resolveCombat(d, ctx.turn(), ctx.turnIx, F.T, chosen, [def], combat.outcome?.roll || 1, F) : null;
    const parts = (list) => h('ul', { class: 'wg-parts' }, list.map(([label, v]) => h('li', {}, h('span', {}, label), h('b', {}, String(v)))));
    const roll = (n) => { combat = { ...combat, outcome: { roll: n } }; ctx.render(); };
    out.push(
      h('div', { class: 'wg-fight-side' }, h('div', { class: 'rail-section-title' }, 'Defending'),
        h('div', { class: 'row' }, ctx.symbol(def, 24), h('strong', {}, def.name), h('span', { class: 'spacer' }), h('b', {}, o ? String(o.def[0].value) : '')),
        o ? parts(o.def[0].parts) : null,
        o?.height ? h('p', { class: 'field-hint' }, `Holds higher ground (${o.height} m above the attackers): defense ×1.25.`) : null),
      h('div', { class: 'wg-fight-side' }, h('div', { class: 'rail-section-title' }, 'Attacking'),
        cands.length ? h('div', { class: 'wg-list' }, cands.map((x) => h('label', { class: 'check wg-atk' }, h('input', { type: 'checkbox', checked: atk.has(x.u.id), disabled: !live(), onchange: (e) => { if (e.target.checked) atk.add(x.u.id); else atk.delete(x.u.id); combat.outcome = null; ctx.render(); } }),
          ctx.symbol(x.u, 18), h('span', {}, x.u.name), h('span', { class: 'muted' }, km(x.d)), h('b', {}, String(R.unitPower(d, ctx.turn(), ctx.turnIx, F.T, x.u, 'attack', F).value))))) : h('p', { class: 'muted' }, 'No opposing units to attack with.'),
        h('p', { class: 'field-hint' }, 'Units in contact are ticked. Tick others to add support, such as artillery in range. Click units on the map to add or remove them.')),
      o ? h('div', { class: 'wg-odds' }, h('span', {}, `${o.attack} against ${o.defense}`), h('strong', {}, o.column), h('span', { class: 'muted' }, o.below ? 'Worse than the table goes, so the first column' : `Odds ${o.ratio}:1`)) : null,
      o ? (() => { const c = crtChances(d, o.column); return c ? h('p', { class: 'wg-chance-line' }, `At ${o.column}, before rolling: the defenders fall back ${Math.round(c.defenderFallsBack * 6)} times in 6 and lose ${c.defenderLoss}% on average; the attackers lose ${c.attackerLoss}%${c.attackerFallsBack ? ` and fall back ${Math.round(c.attackerFallsBack * 6)} times in 6` : ''}.`) : null; })() : null,
      o ? h('div', { style: 'margin:8px 0' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
          const avgAtk = chosen.length ? chosen.reduce((s, u) => s + (Number(u.strength) || 0), 0) / chosen.length : 100;
          combat.mc = monteCarloCombat(d, { column: o.column, attackerStrength: avgAtk, defenderStrength: Number(def.strength) || 100, trials: 1000 });
          ctx.render();
        } }, icon('sparkle', { size: 14 }), 'Run 1,000-trial Monte Carlo'),
        combat.mc && combat.mc.column === o.column ? h('div', { class: 'wg-roll', style: 'margin-top:8px;text-align:left' },
          h('div', { class: 'row' }, h('strong', {}, `Monte Carlo (${combat.mc.trials.toLocaleString()} trials at ${combat.mc.column})`), h('span', { class: 'spacer' }),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Hide simulation', onclick: () => { combat.mc = null; ctx.render(); } }, icon('x', { size: 13 }))),
          h('p', { class: 'muted', style: 'margin:4px 0' }, `Defender remaining: avg ${combat.mc.defender.mean}% (p10–p90: ${combat.mc.defender.p10}%–${combat.mc.defender.p90}%) · falls back ${combat.mc.defender.fallbackPct}%${combat.mc.defender.destroyedPct ? ` · destroyed ${combat.mc.defender.destroyedPct}%` : ''}`),
          h('p', { class: 'muted', style: 'margin:4px 0' }, `Attacker remaining: avg ${combat.mc.attacker.mean}% (p10–p90: ${combat.mc.attacker.p10}%–${combat.mc.attacker.p90}%) · falls back ${combat.mc.attacker.fallbackPct}%`),
          h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px' }, combat.mc.outcomes.slice(0, 5).map((r) => h('span', { class: 'pill no-dot' }, `${r.result}: ${r.pct}%`)))) : null) : null,
      o && live() ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Roll one die'),
        h('div', { class: 'row row-wrap' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { const b = new Uint32Array(1); crypto.getRandomValues(b); roll((b[0] % 6) + 1); } }, icon('hex', { size: 15 }), 'Roll'),
          h('span', { class: 'muted' }, 'or we rolled'),
          [1, 2, 3, 4, 5, 6].map((n) => h('button', { type: 'button', class: `btn btn-sm wg-die${combat.outcome?.roll === n ? ' is-on' : ''}`, onclick: () => roll(n) }, String(n))))) : null,
      o && combat.outcome ? h('div', { class: 'wg-roll wg-result' }, h('span', {}, `Rolled ${o.roll} at ${o.column}`), h('strong', {}, o.result || '—'), h('em', {}, R.describeResult(o.result)),
        o.effects.ar || o.effects.dr ? h('p', { class: 'field-hint' }, `Move the ${[o.effects.ar ? 'attackers' : null, o.effects.dr ? 'defender' : null].filter(Boolean).join(' and ')} back by dragging.`) : null,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { const text = ctx.mutate(() => R.applyCombat(d, ctx.turn(), o)); combat = { defender: null, attackers: null, outcome: null }; ctx.render(); toast(text, { duration: 7000 }); } }, 'Apply to the units'),
          h('button', { type: 'button', class: 'btn', onclick: () => { combat.outcome = null; ctx.render(); } }, 'Roll again'))) : null,
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { combat = { defender: null, attackers: null, outcome: null }; ctx.render(); } }, 'Choose another fight'),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: editCrt }, 'Combat table…')),
      h('p', { class: 'field-hint' }, `Results read A for attackers and D for defenders, with the strength each loses; AR and DR mean they fall back. ${crt === R.DEFAULT_CRT ? 'This is the standard table.' : 'This scenario uses its own table.'}`));
    return out;
  }

  function editCrt() {
    const ro = !ctx.canEdit;
    const crt = R.crtOf(doc());
    const cols = crt.columns.map((c) => h('input', { type: 'text', value: c, disabled: ro, 'aria-label': 'Odds', class: 'wg-col-in' }));
    const cells = crt.rows.map((row, r) => row.map((code, i) => h('input', { type: 'text', value: code, disabled: ro, 'aria-label': `Roll ${r + 1}, ${crt.columns[i]}` })));
    const dlg = dialog({ title: 'Combat table', cls: 'dlg-lg', body: h('div', {},
      h('p', { class: 'field-hint', style: 'margin-top:0' }, 'Columns are the odds (attack ÷ defense); rows are the roll of one die. In each result, A20 means the attackers lose 20% strength, D10 the defenders 10%, and AR or DR that they fall back. Leave a cell empty for no effect.'),
      h('div', { class: 'wg-table-wrap' }, h('table', { class: 'wg-edit-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Roll'), cols.map((c) => h('th', {}, c)))),
        h('tbody', {}, cells.map((row, r) => h('tr', {}, h('th', {}, String(r + 1)), row.map((c) => h('td', {}, c)))))))),
    actions: ro ? [h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done')] : [
      h('button', { type: 'button', class: 'btn', onclick: () => { dlg.close(); ctx.mutate(() => { delete doc().combat; }); toast('Back to the standard combat table'); } }, 'Reset to standard'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
        const columns = cols.map((c) => c.value.trim());
        if (columns.some((c) => !/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(c))) { toast('Write each column as odds, like 2:1.', { tone: 'error' }); return; }
        dlg.close();
        ctx.mutate(() => { doc().combat = { columns, rows: cells.map((row) => row.map((c) => c.value.trim().toUpperCase())) }; });
      } }, 'Save')] });
  }

  /* ---------- objectives ---------- */

  function objectivesPanel() {
    const d = doc();
    const F = ctx.facts();
    const v = d.victory || {};
    const score = F.score;
    const ro = !ctx.canEdit;
    const setV = (patch) => ctx.mutate(() => { d.victory = { ...(d.victory || {}), ...patch }; });
    return [
      ...head('Objectives', 'Places that matter, worth points to whoever holds them. A side takes an objective when it has units in action there and no other side does, and keeps it until someone else takes it.'),
      score ? h('table', { class: 'wg-cmp-table wg-score' }, h('thead', {}, h('tr', {}, h('th', {}, 'Side'), h('th', {}, 'Holding now'), h('th', {}, 'Added up'))),
        h('tbody', {}, d.sides.filter((s) => s.affiliation !== 'N').map((s) => h('tr', { class: score.winner === s.id ? 'is-win' : '' }, h('td', {}, h('i', { style: `background:${s.color}` }), s.name), h('td', {}, String(score.held[s.id] || 0)), h('td', {}, String(score.total[s.id] || 0)))))) : null,
      score?.winner ? h('p', { class: 'wg-state is-in' }, dot(sideOf(d, score.winner).color), `${sideOf(d, score.winner).name} has met the victory condition.`) : null,
      (d.objectives || []).length ? h('div', { class: 'wg-list', style: 'margin-top:10px' }, d.objectives.map((o) => {
        const holder = F.control[o.id];
        return h('div', { class: 'wg-item' }, icon('flag', { size: 16 }),
          h('button', { type: 'button', class: 'wg-item-main link-btn', onclick: () => ctx.map.easeTo({ center: o.lngLat, duration: 500 }) }, h('strong', {}, o.name), h('span', { class: 'muted' }, `${o.points || 0} points · ${km(Number(o.radiusKm) || 1)} radius`)),
          h('span', { class: `pill no-dot${holder === 'contested' ? ' is-warn' : ''}`, style: holder && holder !== 'contested' ? `background:${sideOf(d, holder).color};color:#fff` : '' }, holder === 'contested' ? 'Contested' : holder ? sideOf(d, holder).name : 'Not held'),
          ro ? null : h('button', { type: 'button', class: 'btn btn-sm', onclick: () => editObjective(o) }, 'Edit'));
      })) : h('p', { class: 'muted' }, 'No objectives yet.'),
      ro ? null : h('button', { type: 'button', class: 'btn btn-primary btn-block', style: 'margin-top:10px', onclick: () => ctx.startDraw({ mode: 'point', hint: 'Click the objective.', done: ([p]) => editObjective(null, p) }) }, icon('flag', { size: 15 }), 'Add an objective'),
      h('div', { class: 'rail-section-title' }, 'Victory condition'),
      field('What each side is trying to do', h('textarea', { class: 'input', rows: 2, disabled: ro, placeholder: 'e.g. Blue wins by holding both bridges at the end of turn 8', onchange: (e) => setV({ text: e.target.value }) }, v.text || '')),
      h('div', { class: 'grid-2' },
        field('Points to win', numberInput(v.target || '', (x) => setV({ target: x || 0 }), { placeholder: 'No target', disabled: ro })),
        field('Counting', h('select', { disabled: ro, onchange: (e) => setV({ mode: e.target.value }) }, h('option', { value: 'held', selected: v.mode !== 'total' }, 'Points held now'), h('option', { value: 'total', selected: v.mode === 'total' }, 'Points added up each turn')))),
    ];
  }

  function editObjective(existing, at) {
    const o = existing ? { ...existing } : { id: uid('o'), name: '', lngLat: at, radiusKm: 1, points: 10, holder: null };
    const name = h('input', { class: 'input', type: 'text', value: o.name, placeholder: 'e.g. Memorial Bridge', maxlength: 80 });
    const points = h('input', { class: 'input', type: 'number', min: 0, step: 1, value: o.points ?? 10 });
    const radius = h('input', { class: 'input', type: 'number', min: 0.05, step: 'any', value: o.radiusKm ?? 1 });
    const holder = h('select', {}, h('option', { value: '' }, 'No one'), doc().sides.filter((s) => s.affiliation !== 'N').map((s) => h('option', { value: s.id, selected: o.holder === s.id }, s.name)));
    const dlg = dialog({ title: existing ? 'Edit objective' : 'New objective', cls: 'dlg-sm', body: h('div', {},
      field('Name', name), h('div', { class: 'grid-2' }, field('Points', points), field('Radius (km)', radius, 'Units this close hold it')), field('Held at the start by', holder)),
    actions: [
      existing ? h('button', { type: 'button', class: 'btn', onclick: () => { dlg.close(); ctx.mutate(() => { doc().objectives = doc().objectives.filter((x) => x.id !== o.id); }); } }, icon('trash', { size: 14 }), 'Delete') : null,
      existing ? h('button', { type: 'button', class: 'btn', onclick: () => { dlg.close(); ctx.startDraw({ mode: 'point', hint: 'Click the new place.', done: ([p]) => ctx.mutate(() => { doc().objectives.find((x) => x.id === o.id).lngLat = p; }) }); } }, 'Move') : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
        const next = { ...o, name: name.value.trim() || 'Objective', points: Math.max(0, Math.round(+points.value || 0)), radiusKm: Math.max(0.05, +radius.value || 1), holder: holder.value || null };
        dlg.close();
        ctx.mutate(() => { const list = (doc().objectives ||= []); const i = list.findIndex((x) => x.id === o.id); if (i >= 0) list[i] = next; else list.push(next); });
      } }, existing ? 'Save' : 'Add objective')] });
    setTimeout(() => name.focus(), 30);
  }

  /* ---------- planning graphics ---------- */

  const GFX = {
    phase: ['Phase line (PL)', 'line'],
    flot: ['FLOT (frontline)', 'line'],
    boundary: ['Boundary', 'line'],
    arrow: ['Axis of advance', 'line'],
    ea: ['Engagement area (EA)', 'polygon'],
    nai: ['Named area of interest (NAI)', 'polygon'],
    obstacle: ['Obstacle / minefield', 'line'],
    area: ['Area', 'polygon'],
    label: ['Label', 'point'],
  };
  function drawPanel() {
    const d = doc();
    const t = ctx.turn();
    const list = (t.graphics || []).filter((g) => visibleTo(g.side));
    return [
      ...head('Draw', 'Phase lines, boundaries, axes of advance, areas and labels. They carry over to later turns, so each turn shows the plan as it stood.'),
      live() ? h('div', { class: 'wg-add' },
        field('Draw a', h('select', { onchange: (e) => { gfxTpl.type = e.target.value; } }, Object.entries(GFX).map(([k, [l]]) => h('option', { value: k, selected: gfxTpl.type === k }, l)))),
        h('div', { class: 'grid-2' },
          field('Label', h('input', { class: 'input', type: 'text', value: gfxTpl.label, placeholder: 'e.g. PL Blue', maxlength: 60, oninput: (e) => { gfxTpl.label = e.target.value; } })),
          field('Side', sideSelect(gfxTpl.side, (v) => { gfxTpl.side = v; }, { any: 'Everyone' }))),
        h('button', { type: 'button', class: 'btn btn-primary btn-block', onclick: () => {
          const [label, mode] = GFX[gfxTpl.type];
          ctx.startDraw({ mode, hint: mode === 'point' ? 'Click where the label goes.' : `Click along the ${label.toLowerCase()}. Double-click or press Enter to finish.`,
            done: (coords) => { ctx.mutate(() => { (ctx.turn().graphics ||= []).push({ id: uid('g'), type: gfxTpl.type, side: gfxTpl.side || null, label: gfxTpl.label.trim() || (mode === 'point' ? 'Label' : ''), coords }); }); gfxTpl.label = ''; } });
        } }, icon('pen', { size: 15 }), 'Draw on the map'),
        gfxTpl.side ? h('p', { class: 'field-hint' }, 'Only shown in that side\'s view and in Show everything.') : null) : h('p', { class: 'field-hint', style: 'margin-top:0' }, ctx.canEdit ? 'Graphics can be changed on the latest turn.' : ''),
      list.length ? h('div', { class: 'wg-list', style: 'margin-top:10px' }, list.map((g) => h('div', { class: 'wg-item' }, dot(g.side ? sideOf(d, g.side).color : '#111827'),
        live() ? h('input', { class: 'input input-sm', type: 'text', value: g.label, placeholder: GFX[g.type]?.[0], 'aria-label': 'Label', onchange: (e) => ctx.mutate(() => { ctx.turn().graphics.find((x) => x.id === g.id).label = e.target.value.trim(); }) })
          : h('div', { class: 'wg-item-main' }, h('strong', {}, g.label || GFX[g.type]?.[0])),
        h('span', { class: 'muted' }, GFX[g.type]?.[0]),
        live() ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete', onclick: () => ctx.mutate(() => { ctx.turn().graphics = ctx.turn().graphics.filter((x) => x.id !== g.id); }) }, icon('trash', { size: 15 })) : null))) : h('p', { class: 'muted' }, 'Nothing drawn on this turn.'),
    ];
  }

  /* ---------- spreadsheets ---------- */

  const pickFile = () => new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: () => { resolve(input.files[0] || null); input.remove(); } });
    document.body.append(input);
    input.click();
  });
  const download = (name, text) => { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name }); document.body.append(a); a.click(); a.remove(); };

  async function importUnits() {
    const file = await pickFile();
    if (!file) return;
    let res;
    try { const c = ctx.map.getCenter(); res = R.unitsFromCsv(doc(), await file.text(), [c.lng, c.lat]); } catch (e) { toast(e.message, { tone: 'error', duration: 7000 }); return; }
    if (!res.units.length) { toast('No units found in that file.', { tone: 'error' }); return; }
    const per = {};
    res.units.forEach((u) => { per[u.side] = (per[u.side] || 0) + 1; });
    const sideName = (id) => [...doc().sides, ...res.sides].find((s) => s.id === id)?.name || id;
    const dlg = dialog({ title: `Add ${res.units.length} units?`, cls: 'dlg-sm', body: h('div', {},
      h('ul', { class: 'wg-legend' }, Object.entries(per).map(([s, n]) => h('li', {}, `${sideName(s)}: ${n} ${n === 1 ? 'unit' : 'units'}`))),
      res.sides.length ? h('p', { class: 'field-hint' }, `New ${res.sides.length === 1 ? 'side' : 'sides'}: ${res.sides.map((s) => s.name).join(', ')}.`) : null,
      res.warnings.length ? h('ul', { class: 'wg-warn' }, res.warnings.slice(0, 8).map((w) => h('li', {}, w))) : null),
    actions: [h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
      dlg.close();
      ctx.mutate(() => {
        const t = ctx.turn();
        doc().sides.push(...res.sides);
        const before = t.events.length;
        const added = res.units.map(({ _parent, ...u }) => ({ unit: addUnit(doc(), t, u), _parent }));
        t.events.splice(before);
        for (const { unit, _parent } of added) {
          if (!_parent) continue;
          const hq = t.units.find((x) => x.id !== unit.id && x.side === unit.side && x.name.toLowerCase() === _parent.toLowerCase());
          if (hq) unit.parent = hq.id;
        }
        t.events.push({ type: 'add', text: `${added.length} units imported` });
      });
      const pts = res.units.map((u) => u.lngLat);
      if (pts.length > 1) ctx.map.fitBounds([[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]], { padding: 80, maxZoom: 13 });
      toast(`${res.units.length} units added`, { tone: 'ok' });
    } }, 'Add units')] });
  }

  async function importInjects() {
    const file = await pickFile();
    if (!file) return;
    try {
      const list = R.injectsFromCsv(await file.text());
      if (!list.length) { toast('No injects found in that file.', { tone: 'error' }); return; }
      ctx.mutate(() => { (doc().injects ||= []).push(...list); });
      toast(`${list.length} ${list.length === 1 ? 'inject' : 'injects'} added`, { tone: 'ok' });
    } catch (e) { toast(e.message, { tone: 'error', duration: 7000 }); }
  }

  /** For the inject dialog: what releasing it does to a line or depot. Returns [the field, read()]. */
  function injectEffectField(x) {
    const targets = [...(doc().network?.links || []), ...(doc().network?.nodes || [])];
    const e = x.effects?.[0] || {};
    const isWeather = e.target === 'weather';
    const target = h('select', {}, h('option', { value: '' }, 'Nothing'),
      h('option', { value: 'weather', selected: isWeather }, 'The weather'),
      targets.length ? h('optgroup', { label: 'Lines and depots' }, targets.map((l) => h('option', { value: l.id, selected: e.target === l.id }, l.name || 'Unnamed'))) : null);
    const status = h('select', {}, R.LINK_STATUSES.map(([v, l]) => h('option', { value: v, selected: !isWeather && (e.status || 'cut') === v }, l === 'Open' ? 'Opens it again' : l === 'Cut' ? 'Cuts it' : 'Degrades it')));
    const weather = h('select', {}, Object.entries(R.WEATHER).map(([k, w]) => h('option', { value: k, selected: isWeather && e.status === k }, `To ${w.label.toLowerCase()}`)));
    const sync = () => { status.hidden = target.value === 'weather' || !target.value; weather.hidden = target.value !== 'weather'; };
    target.addEventListener('change', sync);
    sync();
    const el = h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'When released, it changes'), h('div', { class: 'grid-2' }, target, h('div', {}, status, weather)));
    return [el, () => (!target.value ? undefined : target.value === 'weather' ? [{ target: 'weather', status: weather.value }] : [{ target: target.value, status: status.value }])];
  }

  /** Extra rows for comparing branches: supply and score at the end of each. */
  function compareExtras(branchId) {
    const d = doc();
    const b = d.branches.find((x) => x.id === branchId);
    const t = b.turns.at(-1);
    const supply = R.supplyStates(d, t);
    const score = (d.objectives || []).length ? R.scoreAt(d, b, b.turns.length - 1) : null;
    return Object.fromEntries(d.sides.map((s) => {
      const units = t.units.filter((u) => u.side === s.id && u.status !== 'destroyed');
      const tracked = units.filter((u) => supply.get(u.id) && supply.get(u.id).state !== 'none');
      return [s.id, { supply: tracked.length ? `${tracked.filter((u) => supply.get(u.id).state === 'in').length} of ${tracked.length}` : '—', score: score ? String(d.victory?.mode === 'total' ? score.total[s.id] : score.held[s.id]) : null }];
    }));
  }

  return {
    panels: { terrain: terrainPanel, lines: linesPanel, combat: combatPanel, objectives: objectivesPanel, draw: drawPanel },
    layersBelow, layersAbove, draw, unitFlags, unitSection, rulesSection, onUnitClick, attack, importUnits, importInjects, injectEffectField, compareExtras,
    templates: { units: () => download('waymark-units.csv', R.ORBAT_TEMPLATE), injects: () => download('waymark-injects.csv', R.INJECTS_TEMPLATE) },
    get combatDefender() { return combat.defender; },
    get combatAttackers() { return combat.attackers; },
  };
}
