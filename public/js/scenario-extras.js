// Scenario tools for running the room and reviewing the game: a second screen for the projector, the map grid and
// measuring, reinforcements and the timeline, outcome tables and matrix arguments, the analysis (charts, heat map,
// hotwash questionnaire), playback, weather and daylight, and scenario files and templates. scenario.js owns the page
// and passes a context (ctx); this file adds the pieces.
import { h, icon, toast, dialog, confirmDialog, menu } from './ui.js';
import { api } from './api.js';
import { createMap } from './maps.js';
import { sideOf, turnLabel, KINDS, ECHELONS, logEvent } from './scenario-core.js';
import * as R from './scenario-rules.js';
import * as X from './scenario-report.js';
import { toMgrs, bearing, toMils, gridLines, gridSpacing } from './mgrs.js';

const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const km = (n) => (n < 1 ? `${Math.round(n * 1000)} m` : n < 10 ? `${Math.round(n * 100) / 100} km` : `${Math.round(n * 10) / 10} km`);
const pct = (p) => `${Math.round(p * 100)}%`;
const field = (label, control, hint) => h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
const head = (title, hint) => [h('h2', { class: 'me-h' }, title), hint ? h('p', { class: 'me-hint' }, hint) : null];
const lower = (label) => (/^(Setup|Turn )/.test(label) ? label.toLowerCase() : label);
const distanceKm = (a, b) => { const R0 = 6371.0088; const r = Math.PI / 180; const dLat = (b[1] - a[1]) * r; const dLng = (b[0] - a[0]) * r; const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2; return 2 * R0 * Math.asin(Math.sqrt(s)); };

export function createExtras(ctx) {
  const doc = () => ctx.doc;
  const live = () => ctx.live();

  /* ---------- the second screen ---------- */

  let channel = null;
  let screenOn = false;
  let sentRev = -1;
  let camFrame = 0;
  const channelName = () => `waymark-scenario-${ctx.scenarioId}`;
  const post = (msg) => { try { channel?.postMessage(msg); } catch { /* the other window is gone */ } };

  /** On the main window: listen for a second screen saying hello, and keep it in step. */
  function listen() {
    if (channel || typeof BroadcastChannel === 'undefined') return;
    channel = new BroadcastChannel(channelName());
    channel.onmessage = (e) => {
      if (e.data?.type === 'hello') { screenOn = true; sentRev = -1; sync(); post({ type: 'camera', ...camera() }); ctx.render(); }
      if (e.data?.type === 'bye') { screenOn = false; ctx.render(); }
    };
    ctx.map.on('move', () => { if (screenOn && !camFrame) camFrame = requestAnimationFrame(() => { camFrame = 0; post({ type: 'camera', ...camera() }); }); });
    addEventListener('beforeunload', () => post({ type: 'main-closed' }));
  }
  const camera = () => { const m = ctx.map; const c = m.getCenter(); return { center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() }; };
  /** Sends what the screen should show; the whole scenario only when it changed. */
  function sync(extra = {}) {
    if (!screenOn) return;
    const full = ctx.rev !== sentRev;
    post({ type: 'state', ...(full ? { doc: ctx.doc } : {}), rev: ctx.rev, branchId: ctx.branchId, turnIx: ctx.turnIx, viewAs: ctx.viewAs, selected: ctx.selected, overlay: ctx.overlay, grid: gridOn, ...extra });
    sentRev = ctx.rev;
  }
  function openScreen() {
    listen();
    const w = window.open(`/scenario.html?id=${encodeURIComponent(ctx.scenarioId)}&screen=1`, `waymark-screen-${ctx.scenarioId}`, 'popup,width=1280,height=760');
    if (!w) { toast('The browser blocked the new window. Allow pop-ups for this site and try again.', { tone: 'error', duration: 8000 }); return; }
    toast('Drag the new window to the projector and press F11 for full screen. It follows this window: the map, the turn, injects and the view.', { duration: 10000 });
  }
  /** On the second screen: say hello and follow the main window. */
  function follow(apply) {
    channel = new BroadcastChannel(channelName());
    channel.onmessage = (e) => apply(e.data || {});
    channel.postMessage({ type: 'hello' });
    addEventListener('beforeunload', () => channel.postMessage({ type: 'bye' }));
  }

  /* ---------- the map grid, coordinates and measuring ---------- */

  let gridOn = false;
  const gridMarkers = [];
  function layers(map) {
    map.addSource('wg-grid', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'wg-grid-line', type: 'line', source: 'wg-grid', paint: { 'line-color': '#0f172a', 'line-width': ['case', ['get', 'major'], 1.4, 0.8], 'line-opacity': 0.5 } });
  }
  function drawGrid() {
    const map = ctx.map;
    gridMarkers.splice(0).forEach((m) => m.remove());
    if (!map?.getSource('wg-grid')) return;
    if (!gridOn) { map.getSource('wg-grid').setData({ type: 'FeatureCollection', features: [] }); return; }
    const b = map.getBounds();
    const bounds = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const widthKm = distanceKm([bounds[0], (bounds[1] + bounds[3]) / 2], [bounds[2], (bounds[1] + bounds[3]) / 2]);
    const g = gridLines(bounds, gridSpacing(widthKm));
    map.getSource('wg-grid').setData({ type: 'FeatureCollection', features: g.lines.map((l) => ({ type: 'Feature', properties: { major: l.value % (g.spacing * 10) === 0 }, geometry: { type: 'LineString', coordinates: l.coords } })) });
    const top = map.unproject([0, 8]).lat;
    const left = map.unproject([8, 0]).lng;
    for (const l of g.lines) {
      const inside = l.coords.filter((p) => p[0] >= bounds[0] && p[0] <= bounds[2] && p[1] >= bounds[1] && p[1] <= bounds[3]);
      if (!inside.length) continue;
      const at = l.kind === 'e' ? inside.reduce((a, p) => (p[1] > a[1] ? p : a)) : inside.reduce((a, p) => (p[0] < a[0] ? p : a));
      const ll = l.kind === 'e' ? [at[0], Math.min(at[1], top)] : [Math.max(at[0], left), at[1]];
      gridMarkers.push(new maplibregl.Marker({ element: h('div', { class: 'wg-grid-label' }, l.label), anchor: l.kind === 'e' ? 'top' : 'left' }).setLngLat(ll).addTo(map));
    }
    const zone = h('div', { class: 'wg-grid-label is-zone' }, `UTM ${g.zone} · ${g.spacing >= 1000 ? `${g.spacing / 1000} km` : `${g.spacing} m`} grid`);
    gridMarkers.push(new maplibregl.Marker({ element: zone, anchor: 'bottom-right' }).setLngLat(map.unproject([map.getContainer().clientWidth - 46, map.getContainer().clientHeight - 30])).addTo(map));
  }
  function setGrid(on) { gridOn = on; drawGrid(); ctx.render(); }

  /** Buttons on the map for the grid and the measuring tool, and the coordinates under the pointer. */
  function mapControls(map, stage) {
    const gridBtn = h('button', { type: 'button', class: 'wg-ctl', title: 'Military grid (MGRS)', 'aria-label': 'Military grid', 'aria-pressed': 'false', onclick: () => { setGrid(!gridOn); gridBtn.setAttribute('aria-pressed', String(gridOn)); } }, icon('grid', { size: 17 }));
    const measureBtn = h('button', { type: 'button', class: 'wg-ctl', title: 'Measure distance and bearing', 'aria-label': 'Measure', onclick: () => measure() }, icon('ruler', { size: 17 }));
    map.addControl({ onAdd: () => h('div', { class: 'maplibregl-ctrl maplibregl-ctrl-group' }, gridBtn, measureBtn), onRemove: () => {} }, 'top-right');
    const coords = h('div', { class: 'wg-coords', hidden: true, 'aria-live': 'off' });
    stage.append(coords);
    let frame = 0;
    map.on('mousemove', (e) => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; const p = [e.lngLat.lng, e.lngLat.lat]; coords.hidden = false; coords.textContent = `${toMgrs(p, 5) || '—'}  ·  ${p[1].toFixed(5)}, ${p[0].toFixed(5)}`; });
    });
    map.getCanvas().addEventListener('mouseleave', () => { coords.hidden = true; });
    map.on('moveend', () => { if (gridOn) drawGrid(); });
  }

  function legs(pts) {
    return pts.slice(1).map((p, i) => ({ km: distanceKm(pts[i], p), deg: bearing(pts[i], p) }));
  }
  /** Live text while measuring: the leg being drawn and the total so far. */
  function measureText(pts) {
    if (pts.length < 2) return 'Click points to measure. Double-click or press Enter to finish.';
    const ls = legs(pts);
    const last = ls.at(-1);
    const total = ls.reduce((s, l) => s + l.km, 0);
    return `${km(last.km)} at ${Math.round(last.deg)}° (${toMils(last.deg)} mils)${ls.length > 1 ? ` · total ${km(total)}` : ''}`;
  }
  function measure() {
    ctx.startDraw({ mode: 'line', measure: true, hint: 'Click points to measure. Double-click or press Enter to finish.', done: (pts) => {
      const ls = legs(pts);
      const total = ls.reduce((s, l) => s + l.km, 0);
      ctx.setOverlay([{ type: 'Feature', properties: { color: '#0f172a', width: 2.5 }, geometry: { type: 'LineString', coordinates: pts } }]);
      const card = document.getElementById('wg-measure');
      if (card) {
        card.hidden = false;
        card.replaceChildren(h('div', { class: 'row' }, h('strong', {}, `Total ${km(total)}`), h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => ctx.clearOverlay() }, icon('x', { size: 15 }))),
          h('ol', {}, ls.map((l) => h('li', {}, `${km(l.km)} at ${Math.round(l.deg)}° true · ${toMils(l.deg)} mils`))),
          h('p', { class: 'muted' }, `From ${toMgrs(pts[0], 4)} to ${toMgrs(pts.at(-1), 4)}`));
      }
    } });
  }

  /* ---------- reinforcements and withdrawals ---------- */

  const schedule = () => (doc().schedule ||= []);
  function arrivalsSection() {
    const d = doc();
    const items = (d.schedule || []).filter((s) => s.type === 'arrive').sort((a, b) => a.turn - b.turn);
    const leaving = (d.schedule || []).filter((s) => s.type === 'withdraw').sort((a, b) => a.turn - b.turn);
    if (!ctx.canEdit && !items.length && !leaving.length) return null;
    return [
      h('div', { class: 'rail-section-title' }, 'Reinforcements and withdrawals'),
      items.length || leaving.length ? h('div', { class: 'wg-list' },
        items.map((s) => h('div', { class: 'wg-item' }, h('i', { class: 'wg-dot', style: `background:${sideOf(d, s.unit?.side).color}` }),
          h('div', { class: 'wg-item-main' }, h('strong', {}, s.unit?.name || 'Unit'), h('span', { class: 'muted' }, `Arrives ${lower(turnLabel(d, s.turn))}`)),
          ctx.canEdit ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => editArrival(s) }, 'Edit') : null)),
        leaving.map((s) => h('div', { class: 'wg-item' }, icon('logout', { size: 15 }),
          h('div', { class: 'wg-item-main' }, h('strong', {}, s.name || 'Unit'), h('span', { class: 'muted' }, `Withdraws ${lower(turnLabel(d, s.turn))}`)),
          ctx.canEdit ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Cancel ${s.name}'s withdrawal`, onclick: () => ctx.mutate(() => { d.schedule = d.schedule.filter((x) => x.id !== s.id); }) }, icon('trash', { size: 15 })) : null))) : null,
      ctx.canEdit ? h('button', { type: 'button', class: 'btn btn-block', style: 'margin-top:8px', onclick: () => editArrival(null) }, icon('plus', { size: 15 }), 'Schedule a reinforcement') : null,
    ];
  }

  function editArrival(existing) {
    const d = doc();
    const tpl = ctx.template;
    const s = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid('s'), type: 'arrive', turn: Math.max(1, ctx.turnIx + 1), unit: { side: tpl.side, kind: tpl.kind, echelon: tpl.echelon, name: '' } };
    const name = h('input', { class: 'input', type: 'text', value: s.unit.name || '', placeholder: 'e.g. 2nd Brigade', maxlength: 80 });
    const side = h('select', {}, d.sides.map((x) => h('option', { value: x.id, selected: s.unit.side === x.id }, x.name)));
    const kind = h('select', {}, Object.entries(KINDS).map(([k, v]) => h('option', { value: k, selected: s.unit.kind === k }, v.label)));
    const size = h('select', {}, ECHELONS.map(([v, l]) => h('option', { value: v, selected: (s.unit.echelon || '') === v }, l)));
    const turn = h('input', { class: 'input', type: 'number', min: 1, step: 1, value: s.turn });
    const speed = h('input', { class: 'input', type: 'number', min: 0, step: 'any', value: s.unit.speedKmh || '', placeholder: 'Usual' });
    const collect = () => ({ ...s, turn: Math.max(1, Math.round(+turn.value || 1)), unit: { ...s.unit, name: name.value.trim() || `${sideOf(d, side.value).name} ${KINDS[kind.value].label}`, side: side.value, kind: kind.value, echelon: KINDS[kind.value]?.fn ? size.value : '', speedKmh: Math.max(0, +speed.value || 0) } });
    const save = (item) => ctx.mutate(() => { const list = schedule(); const i = list.findIndex((x) => x.id === item.id); if (i >= 0) list[i] = item; else list.push(item); });
    const place = (item) => ctx.startDraw({ mode: 'point', hint: `Click where ${item.unit.name} comes onto the map.`, done: ([p]) => save({ ...item, lngLat: p }) });
    const dlg = dialog({ title: existing ? 'Edit reinforcement' : 'Schedule a reinforcement', cls: 'dlg-sm', body: h('div', {},
      field('Name', name), h('div', { class: 'grid-2' }, field('Side', side), field('Arrives on turn', turn)),
      h('div', { class: 'grid-2' }, field('Kind', kind), field('Size', size)), field('Speed (km/h)', speed),
      h('p', { class: 'field-hint' }, 'It appears at its entry point when that turn starts, on every branch that gets there.')),
    actions: [
      existing ? h('button', { type: 'button', class: 'btn', onclick: () => { dlg.close(); ctx.mutate(() => { d.schedule = d.schedule.filter((x) => x.id !== s.id); }); } }, icon('trash', { size: 14 }), 'Delete') : null,
      existing ? h('button', { type: 'button', class: 'btn', onclick: () => { const item = collect(); dlg.close(); place(item); } }, 'Move entry point') : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { const item = collect(); dlg.close(); if (existing) save(item); else place(item); } }, existing ? 'Save' : 'Choose entry point')] });
    setTimeout(() => name.focus(), 30);
  }

  /** For the unit panel: when the unit leaves the game. */
  function withdrawField(u) {
    const d = doc();
    const item = (d.schedule || []).find((s) => s.type === 'withdraw' && s.unitId === u.id);
    return field('Withdraws on turn', h('input', { class: 'input', type: 'number', min: 1, step: 1, value: item?.turn ?? '', placeholder: 'Stays', disabled: !ctx.canEdit,
      onchange: (e) => ctx.mutate(() => {
        d.schedule = (d.schedule || []).filter((s) => !(s.type === 'withdraw' && s.unitId === u.id));
        const n = Math.round(+e.target.value);
        if (n > 0) d.schedule.push({ id: uid('s'), type: 'withdraw', turn: n, unitId: u.id, name: u.name });
      }) }), 'It leaves the map when that turn starts.');
  }

  /* ---------- the timeline ---------- */

  function openTimeline() {
    const d = doc();
    const tl = X.timeline(d, ctx.branchId);
    const KIND = { inject: ['Injects', 'target'], arrive: ['Reinforcements', 'plus'], withdraw: ['Withdrawals', 'logout'], weather: ['Weather', 'clock'], zone: ['Areas', 'polygon'] };
    const cols = Array.from({ length: tl.turns + 1 }, (_, n) => n);
    const groups = Object.keys(KIND).map((k) => [k, tl.rows.filter((r) => r.kind === k)]).filter(([, rows]) => rows.length);
    const cell = (r, n) => {
      const on = r.kind === 'zone' ? r.turn != null && n >= r.turn && (r.until == null || n <= r.until) : r.turn === n;
      return h('td', { class: `${n <= tl.played ? 'is-played' : ''}${n === ctx.turnIx ? ' is-now' : ''}` }, on ? h('span', { class: `wg-tl-mark is-${r.kind}${r.done && r.kind === 'inject' ? ' is-done' : ''}`, title: `${r.label}: ${turnLabel(d, n)}` }) : null);
    };
    const body = h('div', {},
      h('p', { class: 'field-hint', style: 'margin-top:0' }, `Everything scripted to happen, turn by turn, on "${ctx.branch().name}". Shaded columns have been played. Injects you release by hand appear once released.`),
      groups.length ? h('div', { class: 'wg-table-wrap' }, h('table', { class: 'wg-timeline' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), cols.map((n) => h('th', { class: n === ctx.turnIx ? 'is-now' : '' }, n === 0 ? 'Setup' : String(n))))),
        h('tbody', {}, groups.flatMap(([k, rows]) => [
          h('tr', { class: 'wg-tl-group' }, h('th', { colspan: cols.length + 1 }, icon(KIND[k][1], { size: 13 }), KIND[k][0])),
          ...rows.map((r) => h('tr', {}, h('th', { title: r.after ? `Starts after "${r.after}"` : r.onDemand && !r.done ? 'Released by hand, not yet' : '' }, r.label, r.onDemand && !r.done ? h('span', { class: 'muted' }, ' · on demand') : null), cols.map((n) => cell(r, n)))),
        ])))) : h('p', { class: 'muted' }, 'Nothing is scripted yet. Add injects, reinforcements, withdrawals, weather changes or timed areas.'),
      h('p', { class: 'field-hint' }, d.clock?.mode === 'turns' ? '' : `Turn 1 is ${turnLabel(d, 1)}; each turn is ${d.clock?.stepMinutes || 60} minutes.`));
    const dlg = dialog({ title: 'Timeline', cls: 'dlg-xl', body, actions: [h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done')] });
  }

  /* ---------- weather and daylight ---------- */

  /** The weather and light chip for the turn bar; on the latest turn it changes the weather. */
  function conditionsChip() {
    const d = doc();
    const t = ctx.turn();
    const c = R.conditions(d, t, ctx.turnIx);
    const w = R.WEATHER[c.weather];
    const l = c.light ? R.LIGHT[c.light] : null;
    if (!l && c.weather === 'clear' && !live()) return null;
    const effects = [w.sensor * (l?.sensor ?? 1) < 1 ? `sensors ${pct(c.sensor)}` : null, c.offroad < 1 ? `off-road speed ${pct(c.offroad)}` : null, !c.air ? 'aircraft grounded' : null].filter(Boolean).join(', ');
    return h('button', { type: 'button', class: 'wg-cond', title: `${l ? `${l.label} (sun ${c.alt}°). ` : ''}${w.label}.${effects ? ` ${effects[0].toUpperCase()}${effects.slice(1)}.` : ''}${live() ? ' Click to change the weather.' : ''}`,
      onclick: (e) => { if (!live()) return; menu(e.currentTarget, Object.entries(R.WEATHER).map(([k, v]) => ({ label: `${v.icon} ${v.label}${k === c.weather ? ' ✓' : ''}`, onClick: () => setWeather(k) })), { align: 'start' }); } },
      l ? h('span', { 'aria-label': l.label }, l.icon) : null, h('span', {}, `${w.icon} ${l && c.weather === 'clear' ? l.label : w.label}`));
  }
  function setWeather(k) {
    ctx.mutate(() => {
      const t = ctx.turn();
      if (k === 'clear') delete t.weather; else t.weather = k;
      t.events = t.events.filter((e) => e.type !== 'weather');
      logEvent(t, { type: 'weather', text: `Weather: ${R.WEATHER[k].label}` });
    });
  }
  /** Setup: the time zone, and weather changes scheduled for later turns. */
  function weatherSection() {
    const d = doc();
    const ro = !ctx.canEdit;
    const list = (d.schedule || []).filter((s) => s.type === 'weather').sort((a, b) => a.turn - b.turn);
    let nextTurn = Math.max(1, ctx.turnIx + 1);
    let nextKind = 'rain';
    return [
      h('div', { class: 'rail-section-title' }, 'Weather and daylight'),
      h('p', { class: 'field-hint', style: 'margin-top:0' }, 'With a start time in Clock, each turn is day, twilight or night at the play area. Night and bad weather shorten sensor ranges and slow units off-road; fog, heavy rain and high winds ground aircraft. Change the weather for the current turn from the turn bar.'),
      field('Time zone (hours from UTC)', h('input', { class: 'input', type: 'number', step: 0.5, min: -12, max: 14, disabled: ro, value: d.clock?.utcOffset ?? '', placeholder: `Guessed: ${Math.round((d.view?.center?.[0] ?? 0) / 15)}`,
        onchange: (e) => ctx.mutate(() => { d.clock ||= {}; if (e.target.value === '') delete d.clock.utcOffset; else d.clock.utcOffset = +e.target.value; }) }), 'For the play area, so daylight is right. Include daylight saving.'),
      list.length ? h('div', { class: 'wg-list' }, list.map((s) => h('div', { class: 'wg-item' }, h('span', {}, R.WEATHER[s.weather]?.icon || ''),
        h('div', { class: 'wg-item-main' }, h('strong', {}, R.WEATHER[s.weather]?.label || s.weather), h('span', { class: 'muted' }, `From ${lower(turnLabel(d, s.turn))}`)),
        ro ? null : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Delete', onclick: () => ctx.mutate(() => { d.schedule = d.schedule.filter((x) => x.id !== s.id); }) }, icon('trash', { size: 15 }))))) : null,
      ro ? null : h('div', { class: 'row wg-weather-add' },
        h('select', { 'aria-label': 'Weather', onchange: (e) => { nextKind = e.target.value; } }, Object.entries(R.WEATHER).map(([k, v]) => h('option', { value: k, selected: k === nextKind }, `${v.icon} ${v.label}`))),
        h('span', { class: 'muted' }, 'from turn'),
        h('input', { class: 'input input-sm', type: 'number', min: 1, step: 1, value: nextTurn, 'aria-label': 'Turn', style: 'max-width:70px', onchange: (e) => { nextTurn = Math.max(1, Math.round(+e.target.value || 1)); } }),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => ctx.mutate(() => { schedule().push({ id: uid('s'), type: 'weather', turn: nextTurn, weather: nextKind }); }) }, 'Schedule')),
    ];
  }
  /** The night shade over the basemap (below units and lines). */
  function drawLight(map) {
    if (!map.getLayer('wg-night')) return;
    const l = R.lightAt(doc(), ctx.turnIx)?.state;
    map.setPaintProperty('wg-night', 'fill-opacity', l === 'night' ? 0.34 : l === 'twilight' ? 0.16 : 0);
    const w = R.weatherOf(ctx.turn());
    map.setPaintProperty('wg-weather', 'fill-opacity', w === 'fog' ? 0.32 : w === 'storm' || w === 'snow' ? 0.14 : w === 'rain' ? 0.08 : 0);
    map.setPaintProperty('wg-weather', 'fill-color', w === 'snow' || w === 'fog' ? '#f8fafc' : '#475569');
  }
  function lightLayers(map) {
    const world = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } };
    map.addSource('wg-sky', { type: 'geojson', data: world });
    map.addLayer({ id: 'wg-weather', type: 'fill', source: 'wg-sky', paint: { 'fill-color': '#475569', 'fill-opacity': 0 } });
    map.addLayer({ id: 'wg-night', type: 'fill', source: 'wg-sky', paint: { 'fill-color': '#0b1630', 'fill-opacity': 0 } });
  }

  /* ---------- outcome tables and matrix arguments (Dice panel) ---------- */

  let tableId = null;
  let picked = new Set();
  let tableRoll = null;
  let mx = { side: '', action: '', pros: '', cons: '', mod: 0, roll: null };
  const chanceBars = (list) => h('ul', { class: 'wg-chances' }, list.map((c) => h('li', {}, h('span', {}, c.result), h('i', { style: `--w:${Math.round(c.p * 100)}%` }), h('b', {}, pct(c.p)))));

  function tablesSection() {
    const d = doc();
    const tables = d.tables || [];
    const t = tables.find((x) => x.id === tableId) || tables[0];
    if (t && tableId !== t.id) { tableId = t.id; picked = new Set(); tableRoll = null; }
    const mod = t ? t.modifiers.filter((m, i) => picked.has(i)).reduce((s, m) => s + (Number(m.value) || 0), 0) : 0;
    const roll = (total, faces) => {
      const row = X.tableRow(t, total + mod);
      tableRoll = { total, faces, mod, result: row?.result || '—' };
      if (live()) ctx.mutate(() => logEvent(ctx.turn(), { type: 'roll', text: `${t.name}: ${row?.result || '—'} (${t.die}${mod ? ` ${mod > 0 ? '+' : ''}${mod}` : ''}, rolled ${total}${mod ? `, ${total + mod} in all` : ''})` }), { redraw: false });
      ctx.render();
    };
    return [
      h('div', { class: 'rail-section-title' }, 'Outcome tables'),
      tables.length ? [
        tables.length > 1 ? field('Table', h('select', { onchange: (e) => { tableId = e.target.value; ctx.render(); } }, tables.map((x) => h('option', { value: x.id, selected: x.id === t.id }, x.name)))) : h('p', { class: 'wg-table-name' }, h('strong', {}, t.name), h('span', { class: 'muted' }, ` · ${t.die}`)),
        t.modifiers.length ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'What applies'), t.modifiers.map((m, i) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: picked.has(i), onchange: (e) => { if (e.target.checked) picked.add(i); else picked.delete(i); tableRoll = null; ctx.render(); } }), `${m.label} (${m.value > 0 ? '+' : ''}${m.value})`))) : null,
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, `Chances${mod ? ` (${mod > 0 ? '+' : ''}${mod})` : ''}`), chanceBars(X.tableChances(t, mod))),
        tableRoll ? h('div', { class: 'wg-roll is-table' }, h('span', {}, `Rolled ${tableRoll.total}${tableRoll.faces?.length > 1 ? ` (${tableRoll.faces.join(' + ')})` : ''}${tableRoll.mod ? `, ${tableRoll.total + tableRoll.mod} with modifiers` : ''}`), h('strong', {}, tableRoll.result)) : null,
        h('div', { class: 'row row-wrap' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { const r = X.rollDice(t.die, () => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] / 2 ** 32; }); roll(r.total, r.faces); } }, icon('hex', { size: 15 }), 'Roll'),
          h('span', { class: 'muted' }, 'or we rolled'),
          h('input', { class: 'input input-sm', type: 'number', min: 1, max: 100, 'aria-label': 'The total you rolled', style: 'max-width:76px', onchange: (e) => { const v = Math.round(+e.target.value); if (v > 0) roll(v, null); } }),
          h('span', { class: 'spacer' }),
          ctx.canEdit ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => editTable(t) }, 'Edit') : null)] : h('p', { class: 'field-hint', style: 'margin-top:0' }, 'Make a table for any question the room needs settled, such as "Does the bridge hold?" or "Is the attack detected?", with modifiers for what helps or hurts.'),
      ctx.canEdit ? h('button', { type: 'button', class: 'btn btn-block', style: 'margin-top:8px', onclick: () => editTable(null) }, icon('plus', { size: 15 }), 'New outcome table') : null,
    ];
  }

  function editTable(existing) {
    const t = existing ? JSON.parse(JSON.stringify(existing)) : X.EXAMPLE_TABLE();
    const name = h('input', { class: 'input', type: 'text', value: t.name, maxlength: 100 });
    const die = h('select', {}, Object.keys(X.DICE).map((k) => h('option', { value: k, selected: t.die === k }, k)));
    const rowsBox = h('div', { class: 'wg-rows' });
    const modsBox = h('div', { class: 'wg-rows' });
    const rowEl = (r = { min: '', max: '', result: '' }) => h('div', { class: 'row wg-row-edit' },
      h('input', { class: 'input input-sm', type: 'number', value: r.min, placeholder: 'From', 'aria-label': 'From', style: 'max-width:70px' }),
      h('input', { class: 'input input-sm', type: 'number', value: r.max, placeholder: 'To', 'aria-label': 'To', style: 'max-width:70px' }),
      h('input', { class: 'input input-sm', type: 'text', value: r.result, placeholder: 'Result', 'aria-label': 'Result' }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove', onclick: (e) => e.currentTarget.parentElement.remove() }, icon('x', { size: 14 })));
    const modEl = (m = { label: '', value: '' }) => h('div', { class: 'row wg-row-edit' },
      h('input', { class: 'input input-sm', type: 'text', value: m.label, placeholder: 'What applies', 'aria-label': 'Modifier' }),
      h('input', { class: 'input input-sm', type: 'number', value: m.value, placeholder: '±', 'aria-label': 'Value', style: 'max-width:70px' }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove', onclick: (e) => e.currentTarget.parentElement.remove() }, icon('x', { size: 14 })));
    t.rows.forEach((r) => rowsBox.append(rowEl(r)));
    t.modifiers.forEach((m) => modsBox.append(modEl(m)));
    const dlg = dialog({ title: existing ? 'Edit outcome table' : 'New outcome table', cls: 'dlg-sm', body: h('div', {},
      h('div', { class: 'grid-2' }, field('Question', name), field('Dice', die)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Results'), rowsBox, h('button', { type: 'button', class: 'link-btn', onclick: () => rowsBox.append(rowEl()) }, 'Add a result')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Modifiers'), modsBox, h('button', { type: 'button', class: 'link-btn', onclick: () => modsBox.append(modEl()) }, 'Add a modifier')),
      h('p', { class: 'field-hint' }, 'Totals beyond the table use its first or last result.')),
    actions: [
      existing ? h('button', { type: 'button', class: 'btn', onclick: () => { dlg.close(); ctx.mutate(() => { doc().tables = doc().tables.filter((x) => x.id !== t.id); }); } }, icon('trash', { size: 14 }), 'Delete') : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
        const rows = [...rowsBox.children].map((el) => { const [a, b, c] = el.querySelectorAll('input'); return { min: Math.round(+a.value), max: Math.round(+b.value), result: c.value.trim() }; }).filter((r) => r.result && Number.isFinite(r.min) && Number.isFinite(r.max) && r.max >= r.min);
        if (!rows.length) { toast('Add at least one result with a range, like 2 to 5.', { tone: 'error' }); return; }
        const modifiers = [...modsBox.children].map((el) => { const [a, b] = el.querySelectorAll('input'); return { label: a.value.trim(), value: Math.round(+b.value) || 0 }; }).filter((m) => m.label && m.value);
        const next = { ...t, name: name.value.trim() || 'Outcome table', die: die.value, rows, modifiers };
        dlg.close();
        tableId = next.id;
        ctx.mutate(() => { const list = (doc().tables ||= []); const i = list.findIndex((x) => x.id === next.id); if (i >= 0) list[i] = next; else list.push(next); });
      } }, 'Save')] });
  }

  function matrixSection() {
    const d = doc();
    if (!d.sides.some((s) => s.id === mx.side)) mx.side = d.sides[0].id;
    const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
    const net = lines(mx.pros).length - lines(mx.cons).length + (Number(mx.mod) || 0);
    const chance = X.matrixChance(net);
    const update = (k) => (e) => { mx[k] = e.target.value; mx.roll = null; const el = document.getElementById('wg-mx-odds'); if (el) { const n = lines(mx.pros).length - lines(mx.cons).length + (Number(mx.mod) || 0); el.textContent = `Net ${n > 0 ? '+' : ''}${n} · succeeds on 7 or more on two dice: ${pct(X.matrixChance(n))} chance`; } };
    const roll = () => {
      const r = X.rollDice('2d6', () => { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] / 2 ** 32; });
      const ok = r.total + net >= 7;
      mx.roll = { ...r, ok };
      if (live()) ctx.mutate(() => logEvent(ctx.turn(), { type: 'roll', text: `Matrix: ${sideOf(d, mx.side).name} – ${mx.action.trim() || 'an action'}: ${ok ? 'succeeds' : 'fails'} (net ${net > 0 ? '+' : ''}${net}, rolled ${r.total})` }), { redraw: false });
      ctx.render();
    };
    return [
      h('div', { class: 'rail-section-title' }, 'Matrix argument'),
      h('p', { class: 'field-hint', style: 'margin-top:0' }, 'For moves no table covers: a side says what it does and why it should work, the room argues back, then roll two dice. Each reason for adds one, each against takes one away, and 7 or more succeeds.'),
      h('div', { class: 'grid-2' }, field('Side', h('select', { onchange: update('side') }, d.sides.map((s) => h('option', { value: s.id, selected: s.id === mx.side }, s.name)))),
        field('Facilitator', h('input', { class: 'input', type: 'number', step: 1, min: -3, max: 3, value: mx.mod, onchange: (e) => { mx.mod = Math.round(+e.target.value || 0); mx.roll = null; ctx.render(); } }), '−3 to +3')),
      field('The action', h('input', { class: 'input', type: 'text', value: mx.action, placeholder: 'e.g. Persuade the mayor to open the shelters', oninput: update('action') })),
      h('div', { class: 'grid-2' },
        field('Reasons for', h('textarea', { class: 'input', rows: 3, placeholder: 'One per line', oninput: update('pros'), onchange: () => ctx.render() }, mx.pros)),
        field('Reasons against', h('textarea', { class: 'input', rows: 3, placeholder: 'One per line', oninput: update('cons'), onchange: () => ctx.render() }, mx.cons))),
      h('p', { class: 'wg-mx-odds', id: 'wg-mx-odds' }, `Net ${net > 0 ? '+' : ''}${net} · succeeds on 7 or more on two dice: ${pct(chance)} chance`),
      mx.roll ? h('div', { class: `wg-roll ${mx.roll.ok ? 'is-ok' : 'is-bad'}` }, h('span', {}, `Rolled ${mx.roll.total} (${mx.roll.faces.join(' + ')}), ${mx.roll.total + net} with arguments`), h('strong', {}, mx.roll.ok ? 'Succeeds' : 'Fails')) : null,
      h('button', { type: 'button', class: 'btn btn-primary', onclick: roll }, icon('hex', { size: 15 }), 'Roll two dice'),
    ];
  }

  /* ---------- analysis: charts, heat map, hotwash ---------- */

  const SHAPES = ['circle', 'square', 'triangle', 'diamond'];
  function markerPath(shape, x, y, r = 4.5) {
    if (shape === 'square') return `M${x - r} ${y - r}h${2 * r}v${2 * r}h${-2 * r}z`;
    if (shape === 'triangle') return `M${x} ${y - r * 1.2}L${x + r * 1.15} ${y + r * 0.9}L${x - r * 1.15} ${y + r * 0.9}z`;
    if (shape === 'diamond') return `M${x} ${y - r * 1.3}L${x + r * 1.3} ${y}L${x} ${y + r * 1.3}L${x - r * 1.3} ${y}z`;
    return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  }
  const svg = (tag, attrs, ...kids) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v); kids.flat(Infinity).filter(Boolean).forEach((k) => el.append(k)); return el; };

  /** A line chart over turns: one line per side, marker shapes and end labels as well as color, hover to read values. */
  function lineChart({ title, series, labels, max, fmt = (v) => String(v) }) {
    const W = 560; const H = 210; const L = 38; const Rr = 92; const T = 14; const B = 26;
    const n = labels.length;
    const top = Math.max(1, max ?? Math.max(1, ...series.flatMap((s) => s.values.filter((v) => v != null))));
    const niceTop = top <= 10 ? Math.ceil(top / 2) * 2 : top <= 100 ? Math.ceil(top / 10) * 10 : Math.ceil(top / 50) * 50;
    const x = (i) => L + (n > 1 ? ((W - L - Rr) * i) / (n - 1) : (W - L - Rr) / 2);
    const y = (v) => T + (H - T - B) * (1 - v / niceTop);
    const ticks = [0, 0.5, 1].map((f) => Math.round(niceTop * f));
    const every = Math.max(1, Math.ceil(n / 8));
    const plot = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'wg-chart-svg', role: 'img', 'aria-label': title },
      ticks.map((v) => [svg('line', { x1: L, x2: W - Rr, y1: y(v), y2: y(v), class: 'wg-grid' }), svg('text', { x: L - 6, y: y(v) + 4, class: 'wg-tick', 'text-anchor': 'end' }, fmt(v))]),
      labels.map((lab, i) => (i % every === 0 || i === n - 1 ? svg('text', { x: x(i), y: H - 8, class: 'wg-tick', 'text-anchor': 'middle' }, i === 0 ? 'Setup' : String(i)) : null)),
      series.map((s, si) => {
        const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)]));
        const d = pts.reduce((acc, p, i) => (p ? `${acc}${acc && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}` : acc), '');
        return [svg('path', { d, class: 'wg-line', stroke: s.color }),
          pts.map((p) => (p ? svg('path', { d: markerPath(SHAPES[si % 4], p[0], p[1]), fill: s.color, class: 'wg-mark' }) : null)),
        ];
      }),
      endLabels(series.map((s) => { const i = s.values.map((v, k) => (v == null ? -1 : k)).filter((k) => k >= 0).at(-1); return i == null ? null : { x: x(i) + 10, y: y(s.values[i]) + 4, text: `${s.name} ${fmt(s.values[i])}` }; }).filter(Boolean)));
    const cross = svg('line', { y1: T, y2: H - B, class: 'wg-cross', visibility: 'hidden' });
    plot.append(cross);
    const tip = h('div', { class: 'wg-tip', hidden: true });
    const hit = svg('rect', { x: L - 10, y: 0, width: W - L - Rr + 20, height: H, fill: 'transparent' });
    plot.append(hit);
    const showAt = (clientX) => {
      const box = plot.getBoundingClientRect();
      const px = ((clientX - box.left) / box.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(n > 1 ? ((px - L) / (W - L - Rr)) * (n - 1) : 0)));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.replaceChildren(h('strong', {}, labels[i]), ...series.map((s, si) => h('div', { class: 'row' }, h('span', { class: 'wg-tip-key', html: '' }, svgKey(si, s.color)), h('span', {}, s.name), h('b', {}, s.values[i] == null ? '—' : fmt(s.values[i])))));
      const left = (x(i) / W) * box.width;
      tip.style.left = `${Math.min(box.width - 170, Math.max(0, left + 12))}px`;
    };
    hit.addEventListener('mousemove', (e) => showAt(e.clientX));
    hit.addEventListener('mouseleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
    return h('figure', { class: 'wg-chart' }, h('figcaption', {}, title),
      series.length > 1 ? h('div', { class: 'wg-chart-legend' }, series.map((s, si) => h('span', {}, svgKey(si, s.color), s.name))) : null,
      h('div', { class: 'wg-chart-plot' }, plot, tip));
  }
  // Direct labels at the ends of the lines, nudged apart so they never overlap.
  function endLabels(list) {
    list.sort((a, b) => a.y - b.y);
    for (let i = 1; i < list.length; i++) if (list[i].y - list[i - 1].y < 14) list[i].y = list[i - 1].y + 14;
    return list.map((l) => svg('text', { x: l.x, y: l.y, class: 'wg-end' }, l.text));
  }
  const svgKey = (si, color) => svg('svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' }, svg('path', { d: markerPath(SHAPES[si % 4], 7, 7, 4.5), fill: color }));

  async function openAnalysis(startTab = 'charts') {
    const d = doc();
    let branchId = ctx.branchId;
    let tab = typeof startTab === 'string' ? startTab : 'charts';
    let showTable = false;
    let heatMap = null;
    const body = h('div', { class: 'wg-analysis' });
    const draw = async () => {
      heatMap?.remove(); heatMap = null;
      const s = X.seriesFor(d, branchId);
      const labels = s.turns.map((t) => t.label);
      const per = (k) => s.sides.map((side) => ({ name: side.name, color: side.color, values: s.turns.map((t) => t.sides[side.id][k]) }));
      const tabs = h('div', { class: 'seg', role: 'tablist' }, [['charts', 'Charts'], ['synch', 'Synch matrix'], ['heat', 'Heat map'], ['hotwash', 'Hotwash']].map(([k, l]) => h('button', { type: 'button', role: 'tab', class: tab === k ? 'is-on' : '', 'aria-selected': String(tab === k), onclick: () => { tab = k; draw(); } }, l)));
      const pick = d.branches.length > 1 ? h('select', { class: 'wg-branch-pick', 'aria-label': 'Branch', onchange: (e) => { branchId = e.target.value; draw(); } }, d.branches.map((b) => h('option', { value: b.id, selected: b.id === branchId }, b.name))) : null;
      let content;
      if (tab === 'charts') {
        const charts = [
          { title: 'Units in action', series: per('active') },
          { title: 'Average strength', series: per('strength'), max: 100, fmt: (v) => `${v}%` },
          s.turns.some((t) => Object.values(t.sides).some((v) => v.supplied != null)) ? { title: 'Units in supply', series: per('supplied') } : null,
          s.scoring ? { title: d.victory?.mode === 'total' ? 'Score, added up' : 'Score, points held', series: per(d.victory?.mode === 'total' ? 'total' : 'held') } : null,
        ].filter(Boolean);
        const moved = X.distanceMoved(d, branchId);
        const b = d.branches.find((x) => x.id === branchId);
        const fights = b.turns.reduce((n, t) => n + t.events.filter((e) => e.type === 'combat').length, 0);
        content = [
          h('div', { class: 'wg-stats' },
            h('div', {}, h('strong', {}, String(b.turns.length - 1)), h('span', {}, 'turns played')),
            h('div', {}, h('strong', {}, String(fights)), h('span', {}, fights === 1 ? 'fight' : 'fights')),
            s.sides.map((side) => h('div', {}, h('strong', {}, km(moved[side.id] || 0)), h('span', {}, `moved by ${side.name}`)))),
          showTable ? charts.map((c) => h('div', { class: 'wg-table-wrap' }, h('table', { class: 'wg-cmp-table' }, h('caption', {}, c.title),
            h('thead', {}, h('tr', {}, h('th', {}, 'Turn'), c.series.map((x) => h('th', {}, x.name)))),
            h('tbody', {}, labels.map((lab, i) => h('tr', {}, h('td', {}, lab), c.series.map((x) => h('td', {}, x.values[i] == null ? '—' : (c.fmt || String)(x.values[i]))))))))) : h('div', { class: 'wg-charts' }, charts.map((c) => lineChart({ ...c, labels }))),
          h('button', { type: 'button', class: 'link-btn', onclick: () => { showTable = !showTable; draw(); } }, showTable ? 'Show as charts' : 'Show as tables'),
        ];
      } else if (tab === 'synch') {
        const mx = X.synchMatrix(d, branchId);
        content = [
          h('div', { class: 'row', style: 'margin-bottom:10px' },
            h('p', { class: 'field-hint', style: 'margin:0' }, 'Warfighting functions across turns (played turns and scheduled future events).'),
            h('span', { class: 'spacer' }),
            h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
              const csv = X.synchMatrixCsv(mx);
              const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `${(d.title || 'scenario').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'scenario'}-synch-matrix.csv` });
              document.body.append(a); a.click(); a.remove();
            } }, icon('download', { size: 14 }), 'Download CSV')),
          h('div', { class: 'wg-table-wrap' },
            h('table', { class: 'wg-cmp-table' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Function'), mx.turns.map((t) => h('th', { style: t.future ? 'opacity:0.65;font-style:italic' : '' }, t.label)))),
              h('tbody', {}, mx.rows.map((r) => h('tr', {},
                h('th', { style: 'white-space:nowrap;text-align:left' }, r.label),
                r.cells.map((items, ti) => h('td', { style: `vertical-align:top;min-width:120px;font-size:12px${mx.turns[ti]?.future ? ';opacity:0.7' : ''}` },
                  items.length ? h('ul', { style: 'margin:0;padding-left:14px' }, items.slice(0, 6).map((txt) => h('li', {}, txt)), items.length > 6 ? h('li', { class: 'muted' }, `+${items.length - 6} more`) : null) : h('span', { class: 'muted' }, '—')))))))),
        ];
      } else if (tab === 'heat') {
        const el = h('div', { class: 'wg-heat-map' });
        const pts = X.heatPoints(d, branchId);
        content = [h('p', { class: 'field-hint', style: 'margin-top:0' }, 'Where units spent the game (warmer is more unit-turns), with fights in red and contacts in amber.'), el];
        setTimeout(() => {
          heatMap = createMap(el, { ...d.view, basemap: d.view.basemap || 'light', markers: [], layers: [], legend: false }, { interactive: true });
          heatMap.on('load', () => {
            heatMap.addSource('heat', { type: 'geojson', data: pts });
            heatMap.addLayer({ id: 'heat', type: 'heatmap', source: 'heat', filter: ['==', ['get', 'kind'], 'unit'], paint: { 'heatmap-weight': 0.5, 'heatmap-radius': 26, 'heatmap-opacity': 0.75 } });
            heatMap.addLayer({ id: 'events', type: 'circle', source: 'heat', filter: ['!=', ['get', 'kind'], 'unit'], paint: { 'circle-radius': ['case', ['==', ['get', 'kind'], 'combat'], 7, 5], 'circle-color': ['case', ['==', ['get', 'kind'], 'combat'], '#dc2626', '#d97706'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
            const xs = pts.features.map((f) => f.geometry.coordinates);
            if (xs.length) heatMap.fitBounds([[Math.min(...xs.map((p) => p[0])), Math.min(...xs.map((p) => p[1]))], [Math.max(...xs.map((p) => p[0])), Math.max(...xs.map((p) => p[1]))]], { padding: 50, maxZoom: 13, duration: 0 });
          });
        }, 30);
      } else content = await hotwashTab();
      body.replaceChildren(h('div', { class: 'row wg-analysis-head' }, tabs, h('span', { class: 'spacer' }), pick), h('div', {}, content));
    };
    const dlg = dialog({ title: 'Analysis', cls: 'dlg-xl', body, onClose: () => heatMap?.remove(), actions: [h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done')] });
    draw();
  }

  async function hotwashAnswers() {
    const hw = doc().hotwash;
    if (!hw?.layer) return null;
    try { return (await api('GET', `/api/layers/${encodeURIComponent(hw.layer)}`)).data.features || []; } catch { return null; }
  }
  async function hotwashTab() {
    const d = doc();
    const hw = d.hotwash;
    if (!hw?.form) {
      return [h('p', {}, 'A short questionnaire for everyone who took part: their role, what went well, what to do differently and what surprised them. Share the link at the end of the meeting; answers come back here and into the after-action story.'),
        ctx.canEdit ? h('button', { type: 'button', class: 'btn btn-primary', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const spec = X.hotwashSpec(d);
            const layer = await api('POST', '/api/layers', spec.layer);
            const lid = layer.layer?.id || layer.id;
            const form = await api('POST', `/api/layers/${encodeURIComponent(lid)}/forms`, spec.form);
            ctx.mutate(() => { doc().hotwash = { layer: lid, form: form.id }; });
            toast('Questionnaire ready. Share its link with the room.', { tone: 'ok' });
            document.querySelector('dialog[open]')?.close();
            openAnalysis('hotwash');
          } catch (err) { toast(err.message, { tone: 'error', duration: 7000 }); e.currentTarget.disabled = false; }
        } }, icon('plus', { size: 15 }), 'Create the questionnaire') : h('p', { class: 'muted' }, 'There\'s no questionnaire for this scenario yet.')];
    }
    const url = `${location.origin}/f/${hw.form}`;
    const answers = await hotwashAnswers();
    let open = true;
    try { open = (await api('GET', `/api/layers/${encodeURIComponent(hw.layer)}/forms`)).forms.find((x) => x.id === hw.form)?.open !== false; } catch { /* keep the default */ }
    const sum = answers ? X.summariseHotwash(answers) : null;
    const quotes = (title, list) => (list.length ? h('div', { class: 'wg-quotes' }, h('h3', {}, title), h('ul', {}, list.slice(0, 40).map((q) => h('li', {}, q)))) : null);
    return [
      h('div', { class: 'wg-share-row' }, h('input', { class: 'input', type: 'text', readonly: true, value: url, 'aria-label': 'Questionnaire link', onclick: (e) => e.target.select() }),
        h('button', { type: 'button', class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied', { tone: 'ok' }); } catch { toast(url); } } }, icon('copy', { size: 14 }), 'Copy link'),
        h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, icon('external', { size: 14 }), 'Open')),
      ctx.canEdit ? h('label', { class: 'check', style: 'margin:10px 0' }, h('input', { type: 'checkbox', checked: open, onchange: async (e) => { try { await api('PUT', `/api/forms/${encodeURIComponent(hw.form)}`, { open: e.target.checked }); toast(e.target.checked ? 'Questionnaire open' : 'Questionnaire closed'); } catch (err) { toast(err.message, { tone: 'error' }); } } }), 'Accepting answers') : null,
      !sum ? h('p', { class: 'muted' }, 'Couldn\'t load the answers.') : !sum.count ? h('p', { class: 'muted' }, 'No answers yet.') : [
        h('div', { class: 'wg-stats' }, h('div', {}, h('strong', {}, String(sum.count)), h('span', {}, sum.count === 1 ? 'answer' : 'answers')),
          sum.useful != null ? h('div', {}, h('strong', {}, `${sum.useful} / 5`), h('span', {}, 'how useful')) : null,
          Object.entries(sum.roles).map(([role, n]) => h('div', {}, h('strong', {}, String(n)), h('span', {}, role)))),
        quotes('What went well', sum.wentWell), quotes('What to do differently', sum.improve), quotes('What surprised people', sum.surprise)],
    ];
  }

  /** Blocks for the after-action story from the hotwash answers, if there are any. */
  async function hotwashBlocks() {
    const answers = await hotwashAnswers();
    if (!answers?.length) return [];
    const s = X.summariseHotwash(answers);
    const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const list = (title, items) => (items.length ? `<h3>${title}</h3><ul>${items.slice(0, 12).map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : '');
    return [{ type: 'text', html: `<h2>What participants said</h2><p>${s.count} ${s.count === 1 ? 'person' : 'people'} answered the hotwash questionnaire${s.useful != null ? `, rating the exercise ${s.useful} out of 5 for usefulness` : ''}.</p>${list('What went well', s.wentWell)}${list('What to do differently', s.improve)}${list('What surprised people', s.surprise)}` }];
  }

  /* ---------- playback ---------- */

  let playTimer = null;
  let speed = 2;
  const playing = () => !!playTimer;
  function play() {
    if (playTimer) { stop(); return; }
    if (ctx.turnIx >= ctx.lastTurn()) ctx.goTo(ctx.branchId, 0);
    const step = () => {
      if (ctx.turnIx >= ctx.lastTurn()) { stop(); return; }
      ctx.goTo(ctx.branchId, ctx.turnIx + 1, { animate: true });
      playTimer = setTimeout(step, speed * 1000);
    };
    playTimer = setTimeout(step, 600);
    ctx.render();
  }
  function stop() { clearTimeout(playTimer); playTimer = null; ctx.render(); }
  function playControls() {
    if (ctx.lastTurn() < 1) return null;
    return h('div', { class: 'wg-play' },
      h('button', { type: 'button', class: 'icon-btn', title: playTimer ? 'Pause the replay' : 'Replay the game turn by turn', 'aria-label': playTimer ? 'Pause' : 'Replay', onclick: play }, icon(playTimer ? 'pause' : 'play', { size: 16 })),
      h('select', { 'aria-label': 'Replay speed', title: 'Seconds per turn', onchange: (e) => { speed = +e.target.value; } }, [1, 2, 4].map((s) => h('option', { value: s, selected: s === speed }, `${s}s`))));
  }

  /* ---------- scenario files and templates ---------- */

  function downloadFile() {
    const d = doc();
    const blob = new Blob([JSON.stringify(X.packScenario(d))], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${(d.title || 'scenario').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'scenario'}.waymark.json` });
    document.body.append(a);
    a.click();
    a.remove();
    toast('Scenario file downloaded. Import it on any Waymark server from New scenario.', { duration: 6000 });
  }
  async function saveTemplate() {
    if (!await confirmDialog({ title: 'Save as a template?', confirmLabel: 'Save template', message: 'Makes a new template from this scenario\'s setup: its sides, units in their starting positions, lines, terrain, objectives, injects, tables and rules. Played turns, branches and notes are left out. Start new scenarios from it on the home screen.' })) return;
    try {
      await api('POST', '/api/scenarios', { scenario: X.toTemplate(doc()) });
      toast('Template saved. Find it under New scenario on the home screen.', { tone: 'ok', duration: 6000 });
    } catch (e) { toast(e.message, { tone: 'error', duration: 7000 }); }
  }

  /** The ⋯ menu in the top bar. */
  function moreMenu(anchor) {
    menu(anchor, [
      { label: screenOn ? 'Second screen (connected)' : 'Open a second screen', icon: 'monitor', onClick: openScreen },
      { label: 'Timeline', icon: 'clock', onClick: openTimeline },
      { label: 'Synch matrix', icon: 'list', onClick: () => openAnalysis('synch') },
      { label: 'Analysis', icon: 'chart', onClick: () => openAnalysis() },
      'sep',
      { label: 'Download scenario file', icon: 'download', onClick: downloadFile },
      ctx.canEdit ? { label: 'Save as template', icon: 'copy', onClick: saveTemplate } : null,
    ].filter(Boolean));
  }

  return {
    listen, sync, follow, openScreen, get screenOn() { return screenOn; },
    layers, lightLayers, drawGrid, setGrid, get gridOn() { return gridOn; }, mapControls, measureText,
    arrivalsSection, withdrawField, openTimeline,
    conditionsChip, weatherSection, drawLight,
    tablesSection, matrixSection,
    openAnalysis, hotwashBlocks,
    playControls, playing, stop,
    moreMenu, downloadFile, saveTemplate,
  };
}
