// Scenarios: the play screen. One person drives it on a shared screen while the room talks it through: place units,
// move them turn by turn, release injects, roll dice, take notes, branch to try an alternative, then turn the whole
// game into an after-action story. The rules and data handling are in scenario-core.js.
//   /scenario.html?id=<id>  the editor (owner and editors; viewers get it read-only)
//   /w/<id>                 the public, read-only replay (?embed=1 for websites)
import { api } from './api.js';
import { createMap, BASEMAPS } from './maps.js';
import { $, h, icon, logo, toast, dialog, confirmDialog, setTitle, fill, BRAND } from './ui.js';
import { openShare } from './share.js';
import { TOOLS } from './analysis.js';
import {
  KINDS, ECHELONS, STATUSES, statusLabel, sidcOf, distanceKm, circle, branchOf, turnOf, sideOf, lastTurn, turnLabel, moveAllowanceKm,
  addUnit, removeUnit, moveUnit, updateUnit, logEvent, fireInject, branchFrom, deleteBranch, rewind, sideSummary, compareBranches, branchLog, storyFromScenario, hoursLabel,
} from './scenario-core.js';
import * as R from './scenario-rules.js';
import { branchDiff } from './scenario-report.js';
import { createTools } from './scenario-tools.js';
import { createExtras } from './scenario-extras.js';

const params = new URLSearchParams(location.search);
const publicId = /^\/w\/([\w-]+)/.exec(location.pathname)?.[1];
const id = publicId || params.get('id');
const embed = params.has('embed');
const screenMode = params.has('screen'); // the second screen for a projector: follows the main window
document.documentElement.classList.toggle('is-embed', embed);
const root = $('#page');
const uid = (p) => p + Math.random().toString(36).slice(2, 8);
const km = (n) => (n < 10 ? `${Math.round(n * 10) / 10} km` : `${Math.round(n)} km`);
const lower = (label) => (/^(Setup|Turn )/.test(label) ? label.toLowerCase() : label); // "after turn 3", but "after H+01:30"
const typing = (e) => !!e.target.closest?.('input, textarea, select, [contenteditable="true"]');

let doc;
let meta = {};
let mapDoc = null;
let map;
let canEdit = false;
let branchId = 'main';
let turnIx = 0;
let selected = null; // unit id
let tool = 'units';
let viewAs = 'all';
let placing = null; // { what: 'unit', side, kind, echelon } | { what: 'inject', done(lngLat) }
let template = { side: 'blue', kind: 'infantry', echelon: '' };
let overlay = { type: 'FeatureCollection', features: [] }; // line of sight, reach
let wholeLog = false;
let lastRoll = null;
const markers = new Map(); // unit id → { marker, key }
const ghostMarkers = [];
const pins = [];
let ghostBranchId = null; // optional second branch overlaid as translucent ghosts on the map
let rev = 0; // bumped on every change, so worked-out facts (supply, control…) are recalculated only when needed
let drawing = null; // { mode: 'line' | 'polygon' | 'point', coords, cursor, snap, hint, done(coords) }
let factsCache = { key: '', v: null };
let reachCache = { key: '', features: [] };
let viewshedCache = { key: '', features: [] };

/* ---------- loading ---------- */

async function load() {
  if (publicId) {
    const res = await fetch(`/api/public/scenarios/${encodeURIComponent(id)}`);
    if (res.ok) { doc = await res.json(); return 'public'; }
  }
  const { user } = await api('GET', '/api/me');
  if (!user) { if (publicId) return null; location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`; return new Promise(() => {}); }
  try {
    const r = await api('GET', `/api/scenarios/${encodeURIComponent(id)}`);
    doc = r.scenario;
    const { scenario: _s, ...rest } = r;
    meta = rest;
    return rest.role === 'viewer' || publicId ? 'viewer' : 'editor';
  } catch { return null; }
}
async function loadMap(mode) {
  if (!doc.map) return null;
  if (mode === 'public') { const res = await fetch(`/api/public/maps/${encodeURIComponent(doc.map)}`); return res.ok ? res.json() : null; }
  try { return (await api('GET', `/api/maps/${encodeURIComponent(doc.map)}`)).map; } catch { return null; }
}

/* ---------- saving and undo ---------- */

let saveTimer;
let dirty = false;
const undoStack = [];
const setSave = (text) => { const el = $('#save-state'); if (el) el.textContent = text; };
function changed() {
  if (!canEdit) return;
  dirty = true;
  setSave('Editing…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
}
async function save() {
  if (!dirty) return;
  dirty = false;
  setSave('Saving…');
  try {
    const r = await api('PUT', `/api/scenarios/${meta.id}`, { scenario: doc, version: meta.version });
    meta = { ...meta, ...r };
    setSave(dirty ? 'Editing…' : 'Saved');
  } catch (e) {
    dirty = true;
    setSave('Not saved');
    if (e.status === 409) { if (await confirmDialog({ title: 'This scenario changed somewhere else', confirmLabel: 'Load latest version', message: 'It was edited in another tab or by someone else. Load the latest version (your last few changes here are discarded)?' })) location.reload(); } else saveTimer = setTimeout(save, 4000);
  }
}
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

/** Makes a change that can be undone, then saves and redraws. */
function mutate(fn, { redraw = true } = {}) {
  if (!canEdit) return undefined;
  undoStack.push(JSON.stringify({ doc, branchId, turnIx }));
  if (undoStack.length > 40) undoStack.shift();
  const out = fn();
  rev++;
  changed();
  if (redraw) render();
  return out;
}
function undo() {
  const last = undoStack.pop();
  if (!last) { toast('Nothing to undo'); return; }
  const s = JSON.parse(last);
  doc = s.doc;
  branchId = branchOf(doc, s.branchId).id;
  turnIx = Math.min(s.turnIx, lastTurn(doc, branchId));
  rev++;
  changed();
  render();
  toast('Undone');
}

/* ---------- where we are ---------- */

const branch = () => branchOf(doc, branchId);
const turn = () => turnOf(doc, branchId, turnIx);
const atLatest = () => turnIx === lastTurn(doc, branchId);
const live = () => canEdit && atLatest(); // moves and edits apply to the newest turn of a branch
const unitById = (uidOf) => turn().units.find((u) => u.id === uidOf);
const shown = (u) => viewAs === 'all' || u.side === viewAs || u.spotted || (facts().rules.autoSpot && facts().spotted.has(u.id));

/** What the rules work out for the turn on screen: terrain, supply, contact, lines cut, spotting, objectives. */
function facts() {
  const key = `${rev}|${branchId}|${turnIx}`;
  if (factsCache.key === key) return factsCache.v;
  const t = turn();
  const T = R.terrainOf(doc.terrain);
  const rules = R.rulesOf(doc);
  const v = { T, rules, supply: R.supplyStates(doc, t), command: R.commandStates(doc, t, turnIx), cuts: R.interdictions(doc, t),
    spotted: rules.autoSpot ? R.autoSpotted(doc, t, T, turnIx) : new Set(), control: R.controlAt(doc, branch(), turnIx), score: (doc.objectives || []).length ? R.scoreAt(doc, branch(), turnIx) : null };
  factsCache = { key, v };
  return v;
}

function goTo(b, n) {
  const forward = branchOf(doc, b).id === branchId && n === turnIx + 1;
  branchId = branchOf(doc, b).id;
  turnIx = Math.max(0, Math.min(lastTurn(doc, branchId), n));
  if (selected && !unitById(selected)) selected = null;
  clearOverlay(false);
  render();
  if (forward) animateMoves();
}

// Units glide along this turn's moves, so a step forward (or a replay) shows what happened.
function animateMoves() {
  const t = turn();
  const moving = t.units.filter((u) => u.from && markers.has(u.id) && distanceKm(u.from, u.lngLat) > 0.005).map((u) => {
    const path = u.path?.length > 1 ? u.path : [u.from, u.lngLat];
    const legs = path.slice(1).map((p, i) => distanceKm(path[i], p));
    return { m: markers.get(u.id).marker, path, legs, total: legs.reduce((a, b) => a + b, 0) || 1, end: u.lngLat };
  });
  if (!moving.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const start = performance.now();
  const at = (x, f) => { let run = f * x.total; for (let i = 0; i < x.legs.length; i++) { if (run <= x.legs[i] || i === x.legs.length - 1) { const k = x.legs[i] ? Math.min(1, run / x.legs[i]) : 1; return [x.path[i][0] + (x.path[i + 1][0] - x.path[i][0]) * k, x.path[i][1] + (x.path[i + 1][1] - x.path[i][1]) * k]; } run -= x.legs[i]; } return x.end; };
  const frame = (now) => {
    const f = Math.min(1, (now - start) / 900);
    const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
    for (const x of moving) x.m.setLngLat(f >= 1 ? x.end : at(x, e));
    if (f < 1) requestAnimationFrame(frame);
  };
  for (const x of moving) x.m.setLngLat(x.path[0]);
  requestAnimationFrame(frame);
}

/** On the second screen: show what the main window sends. */
function applyRemote(m) {
  if (m.type === 'camera') { map?.jumpTo({ center: m.center, zoom: m.zoom, bearing: m.bearing, pitch: m.pitch }); return; }
  if (m.type !== 'state') return;
  const prev = { branchId, turnIx };
  if (m.doc) { doc = m.doc; rev++; }
  branchId = branchOf(doc, m.branchId).id;
  turnIx = Math.max(0, Math.min(m.turnIx, lastTurn(doc, branchId)));
  viewAs = m.viewAs || 'all';
  selected = m.selected && unitById(m.selected) ? m.selected : null;
  overlay = m.overlay || empty();
  if (m.grid !== undefined && m.grid !== extras.gridOn) extras.setGrid(m.grid);
  render();
  if (prev.branchId === branchId && turnIx === prev.turnIx + 1) animateMoves();
  if (m.banner !== undefined) { if (m.banner) showInject(m.banner); else $('.wg-banner')?.remove(); }
}

/* ---------- unit symbols ---------- */

// Military kinds use standard symbols from the milsymbol library; if it didn't load, and for civil kinds, a plain badge.
function symbol(unit, size = 30) {
  const side = sideOf(doc, unit.side);
  const sidc = sidcOf(unit, side);
  const box = h('span', { class: 'wg-sym' });
  if (sidc && window.ms) {
    try {
      box.innerHTML = new window.ms.Symbol(sidc, { size, outlineWidth: 3, outlineColor: 'rgba(255,255,255,.9)' }).asSVG(); // drawn by the library from a code we built
      return box;
    } catch { /* fall through to a badge */ }
  }
  const k = KINDS[unit.kind] || KINDS.other;
  const text = k.badge || k.label.slice(0, 3).toUpperCase();
  const w = Math.round(size * 1.35);
  const s = Math.round(size * 1.05);
  box.append(h('svg', { width: w, height: s, viewBox: `0 0 ${w} ${s}` },
    h('rect', { x: 1.5, y: 1.5, width: w - 3, height: s - 3, rx: side.affiliation === 'H' ? 2 : 7, fill: side.color, stroke: '#fff', 'stroke-width': 2.5 })));
  box.append(h('b', { style: `font-size:${text.length > 2 ? Math.round(size * 0.36) : Math.round(size * 0.44)}px` }, text));
  box.classList.add('is-badge');
  return box;
}

function unitEl(u) {
  const el = h('div', { class: `wg-unit${u.id === selected ? ' is-sel' : ''}${u.status === 'destroyed' ? ' is-out' : ''} is-${u.status}`, title: `${u.name} · ${statusLabel(u.status)} · ${u.strength}%` },
    symbol(u),
    flagsEl(u),
    h('span', { class: 'wg-str' }, h('i', { style: `width:${u.strength}%;background:${u.strength > 60 ? '#16a34a' : u.strength > 30 ? '#d97706' : '#dc2626'}` })),
    h('span', { class: 'wg-name' }, u.name));
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (drawing) { addDrawPoint(u.lngLat); return; } // while drawing or measuring, a unit is just a point on the map
    if (placing) return;
    select(u.id);
  });
  return el;
}

function flagsEl(u) {
  const flags = tools.unitFlags(u, facts());
  return flags.length ? h('span', { class: 'wg-flags' }, flags.map(([k, l, title]) => h('b', { class: `is-${k}`, title }, l))) : null;
}

function select(uidOf, { fly = false } = {}) {
  if (uidOf && tools.onUnitClick(unitById(uidOf))) return;
  selected = uidOf;
  if (uidOf && !['units', 'combat'].includes(tool) && !root.classList.contains('is-present')) tool = 'units';
  const u = uidOf && unitById(uidOf);
  if (fly && u) map.easeTo({ center: u.lngLat, duration: 500 });
  render();
}

/* ---------- drawing on the map ---------- */

const empty = () => ({ type: 'FeatureCollection', features: [] });
function ensureLayers() {
  if (map.getSource('wg-moves')) return;
  extras.lightLayers(map);
  tools.layersBelow(map);
  map.addSource('wg-overlay', { type: 'geojson', data: empty() });
  map.addSource('wg-ghost', { type: 'geojson', data: empty() });
  map.addSource('wg-moves', { type: 'geojson', data: empty() });
  map.addLayer({ id: 'wg-overlay-fill', type: 'fill', source: 'wg-overlay', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': ['coalesce', ['get', 'color'], '#7c3aed'], 'fill-opacity': ['coalesce', ['get', 'opacity'], 0.2] } });
  map.addLayer({ id: 'wg-overlay-line', type: 'line', source: 'wg-overlay', paint: { 'line-color': ['coalesce', ['get', 'color'], '#7c3aed'], 'line-width': ['coalesce', ['get', 'width'], 1.5], 'line-opacity': 0.9, 'line-dasharray': [2, 1.5] } });
  map.addLayer({ id: 'wg-ghost-line', type: 'line', source: 'wg-ghost', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': ['coalesce', ['get', 'color'], '#64748b'], 'line-width': 2, 'line-opacity': 0.65, 'line-dasharray': [3, 2] } });
  map.addLayer({ id: 'wg-moves-line', type: 'line', source: 'wg-moves', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [1.5, 1.6] } });
  map.addLayer({ id: 'wg-moves-start', type: 'circle', source: 'wg-moves', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } });
  tools.layersAbove(map);
  extras.layers(map);
}

function drawMap() {
  if (!map?.isStyleLoaded()) { map?.once('idle', drawMap); return; }
  ensureLayers();
  const t = turn();
  const units = t.units.filter(shown);
  // markers
  const keep = new Set(units.map((u) => u.id));
  for (const [uidOf, m] of markers) if (!keep.has(uidOf)) { m.marker.remove(); markers.delete(uidOf); }
  for (const u of units) {
    const key = JSON.stringify([u.name, u.side, u.kind, u.echelon, u.strength, u.status, u.id === selected, live(), sideOf(doc, u.side).color, sideOf(doc, u.side).affiliation, tools.unitFlags(u, facts()).map((f) => f[0])]);
    let m = markers.get(u.id);
    if (!m || m.key !== key) {
      m?.marker.remove();
      const marker = new maplibregl.Marker({ element: unitEl(u), anchor: 'center', draggable: live() }).setLngLat(u.lngLat).addTo(map);
      marker.on('dragstart', () => { if (selected !== u.id) { selected = u.id; } });
      marker.on('dragend', () => dropUnit(u.id, marker));
      m = { marker, key };
      markers.set(u.id, m);
    } else m.marker.setLngLat(u.lngLat);
  }
  // this turn's moves
  const moves = [];
  for (const u of units) {
    if (!u.from || distanceKm(u.from, u.lngLat) < 0.005) continue;
    const color = sideOf(doc, u.side).color;
    moves.push({ type: 'Feature', properties: { color }, geometry: { type: 'LineString', coordinates: u.path?.length > 1 ? u.path : [u.from, u.lngLat] } }, { type: 'Feature', properties: { color }, geometry: { type: 'Point', coordinates: u.from } });
  }
  map.getSource('wg-moves').setData({ type: 'FeatureCollection', features: moves });
  // rings for the selected unit: its range, and how far it can move this turn
  const rings = [];
  const u = selected && unitById(selected);
  if (u && shown(u)) {
    const color = sideOf(doc, u.side).color;
    const F = facts();
    if (Number(u.rangeKm) > 0) rings.push({ type: 'Feature', properties: { color, opacity: 0.08, width: 2 }, geometry: { type: 'Polygon', coordinates: [R.rangeShape(u, Number(u.rangeKm))] } });
    const sensor = R.sensorRange(doc, turn(), turnIx, u);
    if (sensor > 0) {
      if (F.T) rings.push(...sensorViewshed(u, sensor, F));
      else rings.push({ type: 'Feature', properties: { color: '#0f766e', width: 1.3 }, geometry: { type: 'LineString', coordinates: R.rangeShape(u, sensor) } });
    }
    if (F.T && live()) rings.push(...reachOutline(u, F));
    else {
      const reach = moveAllowanceKm(doc, u);
      if (reach && live()) rings.push({ type: 'Feature', properties: { color: '#475569', width: 1.5 }, geometry: { type: 'LineString', coordinates: circle(u.from || u.lngLat, reach) } });
    }
  }
  map.getSource('wg-overlay').setData({ type: 'FeatureCollection', features: [...overlay.features, ...rings] });
  // ghost branch overlay: translucent unit positions + displacement vectors from another branch at this turn
  ghostMarkers.splice(0).forEach((m) => m.remove());
  if (ghostBranchId && ghostBranchId !== branchId && doc.branches.some((b) => b.id === ghostBranchId)) {
    const diff = branchDiff(doc, branchId, ghostBranchId, turnIx);
    map.getSource('wg-ghost').setData({ type: 'FeatureCollection', features: diff.features.filter((f) => f.geometry.type === 'LineString') });
    const gb = branchOf(doc, ghostBranchId);
    const gt = gb.turns[diff.branchB.turn];
    for (const gu of gt.units.filter(shown)) {
      const el = h('div', { class: 'wg-unit is-static', style: 'opacity:0.46;pointer-events:none;filter:saturate(0.75)', title: `${gu.name} (${gb.name} · ${gu.strength}%)` },
        symbol(gu, 24),
        h('span', { class: 'wg-name' }, `${gu.name} (${gb.name})`));
      ghostMarkers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(gu.lngLat).addTo(map));
    }
  } else {
    map.getSource('wg-ghost')?.setData(empty());
  }
  tools.draw(map, facts());
  extras.drawLight(map);
  // injects that have been released, where they were pinned
  pins.splice(0).forEach((p) => p.remove());
  for (const x of (doc.injects || []).filter((i) => t.fired.includes(i.id) && Array.isArray(i.lngLat))) {
    const el = h('div', { class: 'wg-pin', title: x.title }, icon('target', { size: 14 }), h('span', {}, x.title || 'Inject'));
    el.addEventListener('click', (e) => { e.stopPropagation(); showInject(x); });
    pins.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(x.lngLat).addTo(map));
  }
  map.getCanvas().style.cursor = placing || drawing ? 'crosshair' : '';
}

// Where the selected unit can get this turn over the terrain, as an outline of hexes.
function reachOutline(u, F) {
  const key = `${rev}|${branchId}|${turnIx}|${u.id}`;
  if (reachCache.key !== key) {
    const hours = (Number(doc.clock?.stepMinutes) || 60) / 60;
    const cells = R.reachCells(doc, turn(), turnIx, F.T, u, hours);
    reachCache = { key, features: cells.size > 1 ? [{ type: 'Feature', properties: { color: '#334155', width: 1.6 }, geometry: R.cellsOutline(F.T, cells) }] : [] };
  }
  return reachCache.features;
}

// Instant terrain-masked sensor viewshed polygon computed from the local hex terrain grid.
function sensorViewshed(u, sensorKm, F) {
  const key = `${rev}|${branchId}|${turnIx}|${u.id}|${sensorKm}`;
  if (viewshedCache.key !== key) {
    const vs = R.viewshedPolygon(F.T, u, sensorKm);
    viewshedCache = {
      key,
      features: vs.ring.length >= 4 ? [
        { type: 'Feature', properties: { color: '#0f766e', opacity: 0.14, width: 1.6 }, geometry: { type: 'Polygon', coordinates: [vs.ring] } },
      ] : [],
    };
  }
  return viewshedCache.features;
}

// Concentric 1-, 2-, and 3-turn terrain-adjusted reach isochrones for operational tempo planning.
function multiTurnIsochrones(u) {
  const F = facts();
  if (!F.T) { toast('Build the scenario terrain grid first to compute multi-turn terrain isochrones.', { tone: 'error' }); return; }
  const bands = R.multiTurnReach(doc, turn(), turnIx, F.T, u, { turns: 3 });
  if (!bands.length) { toast(`${u.name} cannot move over this terrain.`, { tone: 'error' }); return; }
  const colors = ['#059669', '#d97706', '#7c3aed'];
  const feats = bands.map((b, i) => ({
    type: 'Feature',
    properties: { color: colors[i] || '#475569', width: i === 0 ? 2.4 : 1.7 },
    geometry: b.outline,
  }));
  const summary = bands.map((b) => `T+${b.turn} (${b.hours}h)`).join(', ');
  setOverlay(feats, `${u.name} terrain reach isochrones: green = 1 turn, amber = 2 turns, purple = 3 turns (${summary}).`);
}

/** A unit dropped on the map: it moves along the quickest route over the terrain, or plans the move. */
function dropUnit(id, marker) {
  const u = unitById(id);
  if (!u || !live()) { render(); return; }
  const p = marker.getLngLat();
  const to = [p.lng, p.lat];
  const F = facts();
  let route = null;
  if (F.T) route = R.routeUnit(doc, turn(), turnIx, F.T, u, to, { costMult: F.rules.auto && F.supply.get(u.id)?.state === 'out' ? 2 : 1 });
  const blocked = route?.blocked;
  if (blocked) toast(`${route.reason} Moved straight there anyway.`, { duration: 7000, action: { label: 'Undo', onClick: undo } });
  const usable = route && !blocked ? route : null;
  if (F.rules.planning) {
    mutate(() => { unitById(id).plan = { to: [+to[0].toFixed(6), +to[1].toFixed(6)], ...(usable || {}) }; });
    if (!blocked) toast(`Move planned for ${u.name}${usable ? `: ${hoursLabel(usable.hours)}` : ''}. Reveal moves from the turn bar.`, { duration: 3500 });
    return;
  }
  const r = mutate(() => moveUnit(doc, turn(), id, to, usable));
  const left = Math.round((u.supply ?? 100) - (Number(unitById(id)?.used) || 0));
  if (r?.overHours) toast(`${u.name} needs ${hoursLabel(r.hours)} to get there: ${hoursLabel(r.overHours)} more than a turn.${left < 0 ? ' It also doesn\'t have the supply for it.' : ''}`, { duration: 7000, action: { label: 'Undo', onClick: undo } });
  else if (usable && left < 0) toast(`${u.name} doesn't have the supply for that move (it needs ${Math.round(usable.cost)}%).`, { duration: 7000, action: { label: 'Undo', onClick: undo } });
  else if (r?.overBy) toast(`${u.name} moved ${km(r.km)}: ${km(r.overBy)} more than it can cover in a turn (${km(r.allowance)}).`, { duration: 7000, action: { label: 'Undo', onClick: undo } });
}

/* ---------- drawing shapes on the map (lines, areas, points) ---------- */

function startDraw(opts) {
  placing = null;
  selected = null;
  drawing = { coords: [], cursor: null, ...opts };
  map.doubleClickZoom.disable();
  render();
}
function stopDraw() {
  drawing = null;
  map.doubleClickZoom.enable();
  render();
}
function addDrawPoint(p) {
  if (!drawing) return;
  if (drawing.mode === 'point') { const d = drawing; stopDraw(); d.done([[+p[0].toFixed(6), +p[1].toFixed(6)]]); return; }
  drawing.coords.push([...p]);
  drawMap();
  drawBar();
}
function finishDraw() {
  const d = drawing;
  if (!d) return;
  const coords = d.coords.filter((p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > 1e-7);
  const need = d.mode === 'polygon' ? 3 : 2;
  if (coords.length < need) { toast(d.mode === 'polygon' ? 'An area needs at least three corners.' : 'A line needs at least two points.', { tone: 'error' }); return; }
  stopDraw();
  d.done(coords.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]));
}
// Line ends snap to other lines' points and to depots, so a network joins up.
function snapPoint(ll) {
  const p = map.project(ll);
  let best = null;
  const pts = [...(doc.network?.links || []).flatMap((l) => l.coords || []), ...(doc.network?.nodes || []).map((x) => x.lngLat)];
  for (const q of pts) { const d = Math.hypot(map.project(q).x - p.x, map.project(q).y - p.y); if (d < 12 && (!best || d < best.d)) best = { d, q }; }
  return best ? [...best.q] : [ll.lng, ll.lat];
}
function drawBar() {
  const el = $('#wg-drawbar');
  if (!el) return;
  el.hidden = !drawing;
  if (!drawing) return;
  fill(el, h('span', {}, drawing.measure ? extras.measureText([...drawing.coords, ...(drawing.cursor ? [drawing.cursor] : [])]) : drawing.hint || 'Click the map.'),
    drawing.mode !== 'point' && drawing.coords.length ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { drawing.coords.pop(); drawMap(); drawBar(); } }, 'Undo point') : null,
    drawing.mode !== 'point' ? h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: finishDraw }, 'Finish') : null,
    h('button', { type: 'button', class: 'btn btn-sm', onclick: stopDraw }, 'Cancel'));
}

function clearOverlay(redraw = true) {
  const card = $('#wg-measure');
  if (card) card.hidden = true;
  overlay = empty();
  if (redraw) drawMap();
  $('#wg-clear')?.toggleAttribute('hidden', true);
}
function setOverlay(features, note) {
  overlay = { type: 'FeatureCollection', features };
  drawMap();
  $('#wg-clear')?.removeAttribute('hidden');
  if (note) toast(note, { duration: 6000 });
}

/* ---------- planning aids ---------- */

async function lineOfSight(u) {
  const busy = toast('Working out what can be seen from here…', { duration: 60000 });
  try {
    const radius = Number(u.rangeKm) > 0 ? Math.min(40, Number(u.rangeKm)) : 5;
    const r = await TOOLS.viewshed.run({ observers: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: u.name }, geometry: { type: 'Point', coordinates: u.lngLat } }] } },
      { radius, units: 'kilometers', observerHeight: 2, targetHeight: 0, rays: '36', outputMode: 'sectors' });
    setOverlay(r.data.features.map((f) => ({ ...f, properties: { ...f.properties, color: f.properties.visibility_code ? '#16a34a' : '#dc2626', opacity: f.properties.visibility_code ? 0.28 : 0.12, width: 0.5 } })),
      `Line of sight within ${km(radius)}: green can be seen, red is hidden by terrain. ${r.note || ''}`);
  } catch (e) { toast(e.message, { tone: 'error', duration: 7000 }); } finally { busy?.(); }
}

async function reach(u, mode) {
  const minutes = Math.max(1, Math.min(120, Math.round(Number(doc.clock?.stepMinutes) || 15)));
  const busy = toast('Working out how far it can get…', { duration: 60000 });
  try {
    const r = await TOOLS.traveltime.run({ input: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: u.name }, geometry: { type: 'Point', coordinates: u.lngLat } }] } }, { minutes: String(minutes), mode });
    setOverlay(r.data.features.map((f) => ({ ...f, properties: { ...f.properties, color: '#7c3aed', opacity: 0.2, width: 2 } })), `Where ${u.name} can get in ${minutes} minutes ${mode === 'pedestrian' ? 'on foot' : 'by road'}, in typical conditions.`);
  } catch (e) { toast(e.message, { tone: 'error', duration: 7000 }); } finally { busy?.(); }
}

/* ---------- injects ---------- */

function showInject(x) {
  $('.wg-banner')?.remove();
  const el = h('div', { class: 'wg-banner', role: 'alertdialog', 'aria-label': 'Inject' },
    h('p', { class: 'wg-banner-kicker' }, icon('target', { size: 15 }), 'Inject'),
    h('h2', {}, x.title || 'Untitled'),
    x.text ? h('p', { class: 'wg-banner-text' }, x.text) : null,
    h('div', { class: 'row' },
      Array.isArray(x.lngLat) ? h('button', { type: 'button', class: 'btn', onclick: () => { map.easeTo({ center: x.lngLat, zoom: Math.max(map.getZoom(), 11), duration: 700 }); } }, icon('pin', { size: 15 }), 'Show on the map') : null,
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { el.remove(); if (!screenMode) extras.sync({ banner: null }); } }, 'Continue')));
  $('.wg-stage').append(el);
  if (screenMode) return;
  extras.sync({ banner: x });
  el.querySelector('.btn-primary').focus();
}

function release(x) {
  const fired = mutate(() => fireInject(doc, turn(), x.id));
  if (fired) showInject(fired);
}

function editInject(existing) {
  const x = existing ? { ...existing } : { id: uid('i'), title: '', text: '', turn: null };
  const title = h('input', { class: 'input', type: 'text', value: x.title, placeholder: 'e.g. Bridge destroyed', maxlength: 120 });
  const text = h('textarea', { class: 'input', rows: 3, placeholder: 'What the facilitator reads out', maxlength: 1200 }, x.text || '');
  const last = lastTurn(doc, branchId);
  const when = h('select', {}, h('option', { value: '' }, 'When I release it'), Array.from({ length: Math.max(12, last + 8) }, (_, i) => i + 1).map((n) => h('option', { value: n, selected: Number(x.turn) === n }, `At the start of ${lower(turnLabel(doc, n)) === 'setup' ? 'setup' : turnLabel(doc, n)}`)));
  const [effectField, readEffects] = tools.injectEffectField(x);
  const where = h('span', { class: 'muted' }, Array.isArray(x.lngLat) ? `Pinned at ${x.lngLat[1].toFixed(4)}, ${x.lngLat[0].toFixed(4)}` : 'Not on the map');
  const done = () => {
    if (!title.value.trim()) { toast('Give the inject a title.', { tone: 'error' }); return false; }
    Object.assign(x, { title: title.value.trim(), text: text.value.trim(), turn: when.value ? Number(when.value) : null, effects: readEffects() });
    if (!x.effects) delete x.effects;
    mutate(() => { doc.injects ||= []; const i = doc.injects.findIndex((y) => y.id === x.id); if (i >= 0) doc.injects[i] = x; else doc.injects.push(x); });
    return true;
  };
  const dlg = dialog({ title: existing ? 'Edit inject' : 'New inject', cls: 'dlg-sm', body: h('div', {},
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Title'), title),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Details'), text),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Release'), when),
    effectField,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Place'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => {
        if (!done()) return;
        dlg.close();
        placing = { what: 'inject', done: (ll) => mutate(() => { const y = doc.injects.find((z) => z.id === x.id); if (y) y.lngLat = ll; }) };
        toast('Click the map where this inject happens.', { duration: 5000 });
        render();
      } }, icon('pin', { size: 14 }), Array.isArray(x.lngLat) ? 'Move the pin' : 'Pin to the map'),
      Array.isArray(x.lngLat) ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { delete x.lngLat; where.textContent = 'Not on the map'; } }, 'Remove pin') : null, where))),
  actions: [h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { if (done()) dlg.close(); } }, existing ? 'Save' : 'Add inject')] });
  setTimeout(() => title.focus(), 30);
}

/* ---------- turns and branches ---------- */

function advance() {
  if (!live()) return;
  const r = mutate(() => R.startTurn(doc, branchId), { redraw: false });
  turnIx = r.index;
  clearOverlay(false);
  render();
  if (r.injects.length) showInject(r.injects[0]);
  r.injects.slice(1).forEach((x) => toast(`Inject: ${x.title}`, { duration: 8000 }));
}

function branchHere() {
  const name = h('input', { class: 'input', type: 'text', placeholder: 'e.g. Go north instead', maxlength: 80 });
  const go = () => {
    const b = mutate(() => branchFrom(doc, branchId, turnIx, name.value), { redraw: false });
    dlg.close();
    goTo(b.id, lastTurn(doc, b.id));
    toast(`Now playing "${b.name}". The other branches are untouched.`, { tone: 'ok', duration: 5000 });
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const dlg = dialog({ title: `Branch from ${lower(turnLabel(doc, turnIx))}`, cls: 'dlg-sm', body: h('div', {},
    h('p', { class: 'field-hint', style: 'margin-top:0' }, `Makes a copy of the game up to ${lower(turnLabel(doc, turnIx))} so you can play out a different choice from there. Switch between branches at any time, and compare how they ended.`),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name this alternative'), name)),
  actions: [h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'), h('button', { type: 'button', class: 'btn btn-primary', onclick: go }, 'Branch')] });
  setTimeout(() => name.focus(), 30);
}

async function replayFromHere() {
  const later = lastTurn(doc, branchId) - turnIx;
  if (!await confirmDialog({ title: `Replay from ${lower(turnLabel(doc, turnIx))}?`, danger: true, confirmLabel: `Discard ${later} later ${later === 1 ? 'turn' : 'turns'}`,
    message: `The ${later === 1 ? 'turn' : 'turns'} after this one in "${branch().name}" will be removed. To keep them, branch from here instead. You can undo this.` })) return;
  mutate(() => rewind(doc, branchId, turnIx));
}

function openCompare() {
  if (doc.branches.length < 2) { toast('Make a second branch first: go to a turn and choose "Branch from this turn".', { duration: 6000 }); return; }
  let [a, b] = [branchId, doc.branches.find((x) => x.id !== branchId).id];
  const maps = [];
  const body = h('div', { class: 'wg-compare' });
  const draw = () => {
    maps.splice(0).forEach((m) => m.remove());
    const cmp = compareBranches(doc, a, b);
    const col = (which, c, other) => {
      const extra = tools.compareExtras(c.id);
      const hasScore = (doc.objectives || []).length > 0;
      const el = h('div', { class: 'wg-cmp-map' });
      const t = branchOf(doc, c.id).turns.at(-1);
      setTimeout(() => {
        const m = createMap(el, { ...doc.view, basemap: mapDoc?.view?.basemap || doc.view.basemap, markers: [], layers: mapDoc?.view?.layers || [], legend: false }, { interactive: false, library: mapDoc?.layers || [] });
        maps.push(m);
        const pts = t.units.map((u) => u.lngLat);
        if (pts.length) { const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]); m.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 13, duration: 0 }); }
        t.units.forEach((u) => new maplibregl.Marker({ element: h('div', { class: `wg-unit is-static${u.status === 'destroyed' ? ' is-out' : ''}` }, symbol(u, 24), h('span', { class: 'wg-name' }, u.name)), anchor: 'center' }).setLngLat(u.lngLat).addTo(m));
      }, 30);
      return h('div', { class: 'wg-cmp-col' },
        h('select', { 'aria-label': `Branch ${which}`, onchange: (e) => { if (which === 'A') a = e.target.value; else b = e.target.value; draw(); } }, doc.branches.map((x) => h('option', { value: x.id, selected: x.id === c.id, disabled: x.id === other }, x.name))),
        h('p', { class: 'muted' }, `Ended at ${lower(c.label)}`), el,
        h('table', { class: 'wg-cmp-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Side'), h('th', {}, 'In action'), h('th', {}, 'Lost'), h('th', {}, 'Strength'), h('th', {}, 'In supply'), hasScore ? h('th', {}, 'Score') : null)),
          h('tbody', {}, c.sides.map((s) => h('tr', {}, h('td', {}, h('i', { style: `background:${s.color}` }), s.name), h('td', {}, `${s.active} of ${s.units}`), h('td', {}, String(s.lost)), h('td', {}, `${s.strength}%`),
            h('td', {}, extra[s.id]?.supply || '—'), hasScore ? h('td', {}, extra[s.id]?.score ?? '—') : null)))));
    };
    fill(body, col('A', cmp.a, b), col('B', cmp.b, a));
  };
  const dlg = dialog({ title: 'Compare branches', cls: 'dlg-xl', body, onClose: () => maps.forEach((m) => m.remove()), actions: [h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done')] });
  draw();
}

/* ---------- after-action story ---------- */

function writeUp() {
  const picks = new Set(doc.branches.map((x) => x.id));
  const dlg = dialog({ title: 'Write up the game', cls: 'dlg-sm', body: h('div', {},
    h('p', { class: 'field-hint', style: 'margin-top:0' }, 'Makes a story that replays the game: a moving map with one card per turn showing what happened and the notes you took, and how each branch ended. You can edit it like any story, then publish or share it.'),
    doc.branches.length > 1 ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Branches to include'),
      doc.branches.map((x) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { if (e.target.checked) picks.add(x.id); else picks.delete(x.id); } }), `${x.name} (${x.turns.length - 1} ${x.turns.length - 1 === 1 ? 'turn' : 'turns'})`))) : null),
  actions: [h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
      if (!picks.size) { toast('Choose at least one branch.', { tone: 'error' }); return; }
      const win = window.open('', '_blank'); // opened now, while the click still counts, so it isn't blocked
      try {
        await save();
        const extra = await extras.hotwashBlocks();
        const r = await api('POST', '/api/stories', { story: storyFromScenario(doc, { branches: doc.branches.filter((x) => picks.has(x.id)).map((x) => x.id), decorate: (b, n) => R.storyFeatures(doc, b, n), extra }) });
        dlg.close();
        if (win) win.location = `/builder.html?id=${r.id}&new=1`; else location.href = `/builder.html?id=${r.id}&new=1`;
        toast('Story created', { tone: 'ok' });
      } catch (e) { win?.close(); toast(e.message, { tone: 'error', duration: 7000 }); }
    } }, icon('sparkle', { size: 15 }), 'Create the story')] });
}

/* ---------- panels ---------- */

const head = (title, hint) => [h('h2', { class: 'me-h' }, title), hint ? h('p', { class: 'me-hint' }, hint) : null];
const seg = (opts, value, set, cls = '') => h('div', { class: `seg seg-block ${cls}`, role: 'group' }, opts.map(([v, l]) => h('button', { type: 'button', class: String(value) === String(v) ? 'is-on' : '', disabled: !live(), onclick: () => set(v) }, l)));
const kindSelect = (value, set, disabled) => h('select', { disabled, onchange: (e) => set(e.target.value) },
  [...new Set(Object.values(KINDS).map((k) => k.group))].map((g) => h('optgroup', { label: g }, Object.entries(KINDS).filter(([, k]) => k.group === g).map(([key, k]) => h('option', { value: key, selected: value === key }, k.label)))));
const sideSeg = (value, set) => h('div', { class: 'seg seg-block wg-sides' }, doc.sides.map((s) => h('button', { type: 'button', class: value === s.id ? 'is-on' : '', onclick: () => set(s.id) }, h('i', { style: `background:${s.color}` }), s.name)));

function unitEditor(u) {
  const ro = !live();
  const set = (patch, redraw = true) => mutate(() => updateUnit(turn(), u.id, patch), { redraw });
  const reachKm = moveAllowanceKm(doc, u);
  const foes = turn().units.filter((x) => x.side !== u.side && sideOf(doc, x.side).affiliation !== 'N' && x.status !== 'destroyed' && shown(x)).map((x) => ({ x, d: distanceKm(u.lngLat, x.lngLat) })).sort((p, q) => p.d - q.d).slice(0, 3);
  const moved = u.from ? distanceKm(u.from, u.lngLat) : 0;
  return h('div', { class: 'wg-editor' },
    h('div', { class: 'row' }, symbol(u, 26), h('input', { class: 'input', type: 'text', value: u.name, disabled: ro, 'aria-label': 'Unit name', onchange: (e) => set({ name: e.target.value.trim() || u.name }) }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => select(null) }, icon('x', { size: 16 }))),
    ro ? h('p', { class: 'field-hint' }, canEdit ? 'This is an earlier turn, so it can\'t be changed. Go to the latest turn, or branch from here.' : 'You can look, but not change this scenario.') : null,
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Side'), h('div', { class: 'seg seg-block wg-sides' }, doc.sides.map((s) => h('button', { type: 'button', class: u.side === s.id ? 'is-on' : '', disabled: ro, onclick: () => set({ side: s.id }) }, h('i', { style: `background:${s.color}` }), s.name)))),
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Kind'), kindSelect(u.kind, (v) => set({ kind: v }), ro)),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Size'), h('select', { disabled: ro || !KINDS[u.kind]?.fn, onchange: (e) => set({ echelon: e.target.value }) }, ECHELONS.map(([v, l]) => h('option', { value: v, selected: (u.echelon || '') === v }, l))))),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Status'), seg(STATUSES, u.status, (v) => set({ status: v }), 'wg-status')),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, h('span', {}, 'Strength'), h('span', { class: 'muted' }, `${u.strength}%`)),
      h('input', { type: 'range', min: 0, max: 100, step: 5, value: u.strength, disabled: ro, oninput: (e) => { e.target.closest('.field').querySelector('.muted').textContent = `${e.target.value}%`; }, onchange: (e) => set({ strength: +e.target.value }) })),
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Range (km)'), h('input', { class: 'input', type: 'number', min: 0, step: 'any', value: u.rangeKm || '', placeholder: 'None', disabled: ro, onchange: (e) => set({ rangeKm: Math.max(0, +e.target.value || 0) }) })),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Speed (km/h)'), h('input', { class: 'input', type: 'number', min: 0, step: 'any', value: u.speedKmh || '', placeholder: facts().T ? `Usual: ${R.typicalSpeed(u)}` : 'Any distance', disabled: ro, onchange: (e) => set({ speedKmh: Math.max(0, +e.target.value || 0) }) }))),
    h('p', { class: 'field-hint', style: 'margin-top:-4px' }, [Number(u.rangeKm) > 0 ? `The solid ring is its ${km(Number(u.rangeKm))} range.` : null, facts().T ? `The outline shows where it can get this turn over the ground.` : reachKm ? `The dashed ring is how far it can move this turn (${km(reachKm)}).` : null,
      moved > 0.005 ? `Moved ${km(moved)} this turn.` : null].filter(Boolean).join(' ') || 'Give it a range to draw a range ring, and a speed to check its moves against the clock.'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!u.spotted, disabled: ro, onchange: (e) => set({ spotted: e.target.checked }) }), 'Seen by the other sides'),
    facts().rules.autoSpot && facts().spotted.has(u.id) && !u.spotted ? h('p', { class: 'field-hint', style: 'margin-top:-6px' }, 'Spotted by an opposing unit\'s sensors this turn.') : null,
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Notes'), h('textarea', { class: 'input', rows: 2, disabled: ro, placeholder: 'Orders, condition, anything worth remembering', onchange: (e) => set({ notes: e.target.value }, false) }, u.notes || '')),
    foes.length ? h('div', { class: 'wg-near' }, h('span', { class: 'field-label' }, 'Nearest opposing units'),
      foes.map(({ x, d }) => h('button', { type: 'button', class: 'wg-near-row', onclick: () => select(x.id, { fly: true }) }, h('i', { style: `background:${sideOf(doc, x.side).color}` }), h('span', {}, x.name),
        h('b', { class: Number(u.rangeKm) > 0 && d <= Number(u.rangeKm) ? 'is-in' : '' }, `${km(d)}${Number(u.rangeKm) > 0 && d <= Number(u.rangeKm) ? ' · in range' : ''}`)))) : null,
    h('div', { class: 'row row-wrap wg-aids' },
      h('button', { type: 'button', class: 'btn btn-sm', title: 'What this unit can see, given the terrain', onclick: () => lineOfSight(u) }, icon('eye', { size: 14 }), 'Line of sight'),
      facts().T ? h('button', { type: 'button', class: 'btn btn-sm', title: 'Terrain-adjusted 1, 2, and 3-turn movement isochrones', onclick: () => multiTurnIsochrones(u) }, icon('target', { size: 14 }), '3-turn reach') : null,
      h('button', { type: 'button', class: 'btn btn-sm', title: 'How far it can get by road in one turn', onclick: () => reach(u, 'auto') }, icon('route', { size: 14 }), 'Reach by road'),
      h('button', { type: 'button', class: 'btn btn-sm', title: 'How far it can get on foot in one turn', onclick: () => reach(u, 'pedestrian') }, icon('route', { size: 14 }), 'On foot')),
    tools.unitSection(u, facts()),
    canEdit ? extras.withdrawField(u) : null,
    ro ? null : h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { const c = mutate(() => addUnit(doc, turn(), { ...u, id: undefined, name: `${u.name} (copy)`, lngLat: [u.lngLat[0] + 0.01, u.lngLat[1] - 0.01] }), { redraw: false }); select(c.id); } }, icon('copy', { size: 14 }), 'Duplicate'),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { mutate(() => removeUnit(turn(), u.id), { redraw: false }); select(null); toast(`${u.name} removed`, { action: { label: 'Undo', onClick: undo } }); } }, icon('trash', { size: 14 }), 'Remove')));
}

function unitsPanel() {
  const t = turn();
  const u = selected && unitById(selected);
  const isPlacing = placing?.what === 'unit';
  if (!doc.sides.some((s) => s.id === template.side)) template.side = doc.sides[0].id;
  return [
    ...head('Units', t.units.length ? null : live() ? 'Choose a side and a kind, then click the map to place units. Drag a unit to move it.' : 'No units on this turn.'),
    u ? unitEditor(u) : null,
    live() && !u ? h('div', { class: 'wg-add' },
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Add units for'), sideSeg(template.side, (v) => { template.side = v; if (isPlacing) placing = { what: 'unit', ...template }; render(); })),
      h('div', { class: 'grid-2' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Kind'), kindSelect(template.kind, (v) => { template.kind = v; if (isPlacing) placing = { what: 'unit', ...template }; render(); })),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Size'), h('select', { disabled: !KINDS[template.kind]?.fn, onchange: (e) => { template.echelon = e.target.value; if (isPlacing) placing = { what: 'unit', ...template }; } }, ECHELONS.map(([v, l]) => h('option', { value: v, selected: template.echelon === v }, l))))),
      h('button', { type: 'button', class: `btn btn-block ${isPlacing ? '' : 'btn-primary'}`, onclick: () => { placing = isPlacing ? null : { what: 'unit', ...template }; render(); } },
        isPlacing ? [icon('check', { size: 15 }), 'Done placing'] : [icon('plus', { size: 15 }), 'Place on the map']),
      isPlacing ? h('p', { class: 'field-hint' }, 'Click the map to place a unit. Keep clicking to place more.') : null,
      h('div', { class: 'row wg-import' }, h('button', { type: 'button', class: 'link-btn', onclick: tools.importUnits }, icon('upload', { size: 14 }), 'Import from a spreadsheet'), h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'link-btn', onclick: tools.templates.units }, 'Template'))) : null,
    u ? null : extras.arrivalsSection(),
    doc.sides.map((s) => {
      const list = t.units.filter((x) => x.side === s.id && shown(x));
      if (!list.length) return null;
      return [h('div', { class: 'rail-section-title wg-side-title' }, h('i', { style: `background:${s.color}` }), `${s.name} · ${list.filter((x) => x.status !== 'destroyed').length} of ${list.length} in action`),
        h('div', { class: 'wg-list' }, list.map((x) => h('button', { type: 'button', class: `wg-row${x.id === selected ? ' is-on' : ''}${x.status === 'destroyed' ? ' is-out' : ''}`, onclick: () => select(x.id, { fly: true }) },
          symbol(x, 20), h('span', { class: 'wg-row-name' }, x.name), flagsEl(x), x.status !== 'ready' ? h('span', { class: `pill no-dot ${x.status === 'destroyed' ? 'is-error' : 'is-warn'}` }, statusLabel(x.status)) : null, h('span', { class: 'muted' }, `${x.strength}%`))))];
    }),
  ];
}

function injectsPanel() {
  const t = turn();
  const firedAt = (x) => branch().turns.findIndex((tt) => tt.fired.includes(x.id));
  return [
    ...head('Injects', 'Events you spring on the room: a bridge is destroyed, a storm arrives, a rumor spreads. Schedule one for a turn, or release it when the moment is right.'),
    h('button', { type: 'button', class: 'btn btn-sm', style: 'margin-bottom:10px', onclick: () => extras.openTimeline() }, icon('clock', { size: 14 }), 'Timeline of the game'),
    (doc.injects || []).length ? h('div', { class: 'wg-list' }, doc.injects.map((x) => {
      const at = firedAt(x);
      const done = at >= 0 && at <= turnIx;
      return h('div', { class: `wg-inject${done ? ' is-done' : ''}` },
        h('div', { class: 'wg-inject-head' }, h('strong', {}, x.title || 'Untitled'),
          h('span', { class: `pill no-dot ${done ? 'is-live' : ''}` }, done ? `Released, ${lower(turnLabel(doc, at))}` : x.turn ? `Due ${lower(turnLabel(doc, Number(x.turn)))}` : 'On demand')),
        x.text ? h('p', {}, x.text) : null,
        h('div', { class: 'row' },
          done ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => showInject(x) }, 'Show again')
            : live() ? h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => release(x) }, 'Release now') : null,
          h('span', { class: 'spacer' }),
          canEdit ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => editInject(x) }, 'Edit') : null,
          canEdit ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Delete ${x.title}`, onclick: () => mutate(() => { doc.injects = doc.injects.filter((y) => y.id !== x.id); doc.branches.forEach((b) => b.turns.forEach((tt) => { tt.fired = tt.fired.filter((f) => f !== x.id); })); }) }, icon('trash', { size: 15 })) : null));
    })) : h('p', { class: 'muted' }, 'No injects yet.'),
    canEdit ? h('button', { type: 'button', class: 'btn btn-primary btn-block', style: 'margin-top:12px', onclick: () => editInject(null) }, icon('plus', { size: 15 }), 'New inject') : null,
    canEdit ? h('div', { class: 'row wg-import' }, h('button', { type: 'button', class: 'link-btn', onclick: tools.importInjects }, icon('upload', { size: 14 }), 'Import from a spreadsheet'), h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'link-btn', onclick: tools.templates.injects }, 'Template')) : null,
    t.fired.length ? null : null,
  ];
}

function logPanel() {
  const t = turn();
  const events = wholeLog ? branchLog(doc, branchId).filter((e) => e.turn <= turnIx) : t.events.map((e) => ({ ...e, turn: turnIx, label: turnLabel(doc, turnIx) }));
  const ICON = { move: 'route', inject: 'target', roll: 'hex', status: 'sliders', strength: 'chart', add: 'plus', remove: 'trash', note: 'text', combat: 'swords', contact: 'target', supply: 'database', command: 'link', link: 'line' };
  let lastLabel = null;
  return [
    ...head('Log and notes', `What happened on ${lower(turnLabel(doc, turnIx))}, and the decisions the room made. Notes go into the after-action story.`),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, `Notes for ${lower(turnLabel(doc, turnIx))}`),
      h('textarea', { class: 'input', rows: 5, disabled: !canEdit, placeholder: 'Decisions, reasoning, what people argued about', onchange: (e) => mutate(() => { turn().notes = e.target.value; }, { redraw: false }) }, t.notes || '')),
    h('div', { class: 'row', style: 'margin:14px 0 6px' }, h('span', { class: 'rail-section-title', style: 'margin:0' }, wholeLog ? 'The whole game so far' : 'This turn'), h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'link-btn', onclick: () => { wholeLog = !wholeLog; render(); } }, wholeLog ? 'Just this turn' : 'Show the whole game')),
    events.length ? h('ol', { class: 'wg-log' }, events.map((e) => {
      const hd = wholeLog && e.label !== lastLabel ? h('li', { class: 'wg-log-turn' }, e.label) : null;
      lastLabel = e.label;
      return [hd, h('li', { class: `is-${e.type}` }, icon(ICON[e.type] || 'file', { size: 14 }), h('span', {}, e.text))];
    })) : h('p', { class: 'muted' }, 'Nothing logged yet.'),
  ];
}

function rollDice(count, sides, labelText) {
  const buf = new Uint32Array(count);
  crypto.getRandomValues(buf);
  const rolls = [...buf].map((v) => (v % sides) + 1);
  const total = rolls.reduce((a, b) => a + b, 0);
  lastRoll = { title: `${count > 1 ? count : ''}d${sides}`, value: String(total), detail: count > 1 ? rolls.join(' + ') : '', label: labelText };
  if (live()) mutate(() => logEvent(turn(), { type: 'roll', text: `Rolled ${lastRoll.title}: ${total}${count > 1 ? ` (${rolls.join(' + ')})` : ''}${labelText ? ` for ${labelText}` : ''}` }), { redraw: false });
  render();
}
function rollChance(pct, labelText) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const roll = (buf[0] % 100) + 1;
  const ok = roll <= pct;
  lastRoll = { title: `${pct}% chance`, value: ok ? 'Success' : 'Failure', detail: `rolled ${roll}, needed ${pct} or less`, label: labelText, tone: ok ? 'ok' : 'bad' };
  if (live()) mutate(() => logEvent(turn(), { type: 'roll', text: `${labelText || 'Chance roll'}: ${ok ? 'success' : 'failure'} (${pct}% chance, rolled ${roll})` }), { redraw: false });
  render();
}
let rollLabel = '';
let chance = 50;
function dicePanel() {
  return [
    ...head('Dice', 'Settle an outcome with a roll. Say what it\'s for and it goes in the log.'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'What is this roll for?'), h('input', { class: 'input', type: 'text', value: rollLabel, placeholder: 'e.g. Does the bridge hold?', oninput: (e) => { rollLabel = e.target.value; } })),
    h('div', { class: `wg-roll${lastRoll?.tone ? ` is-${lastRoll.tone}` : ''}`, 'aria-live': 'polite' }, lastRoll ? [h('span', {}, lastRoll.title), h('strong', {}, lastRoll.value), lastRoll.detail ? h('em', {}, lastRoll.detail) : null] : h('span', {}, 'Roll to see a result')),
    h('div', { class: 'wg-dice' }, [[1, 6], [2, 6], [1, 10], [1, 20], [1, 100]].map(([n, s]) => h('button', { type: 'button', class: 'btn', onclick: () => rollDice(n, s, rollLabel.trim()) }, `${n > 1 ? n : ''}d${s}`))),
    h('div', { class: 'rail-section-title' }, 'Chance of success'),
    h('div', { class: 'row' }, h('input', { class: 'input', type: 'number', min: 1, max: 99, value: chance, style: 'width:86px', 'aria-label': 'Chance of success, percent', oninput: (e) => { chance = Math.max(1, Math.min(99, +e.target.value || 50)); } }), h('span', { class: 'muted' }, '%'),
      h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => rollChance(chance, rollLabel.trim()) }, 'Roll')),
    h('p', { class: 'field-hint' }, live() ? 'Rolls are added to this turn\'s log.' : 'Rolls on an earlier turn aren\'t logged.'),
    ...extras.tablesSection(),
    ...extras.matrixSection(),
  ];
}

function branchesPanel() {
  return [
    ...head('Branches', 'A branch plays out a different choice from some point in the game, without changing what you already played. Use them to answer "what if?".'),
    h('div', { class: 'wg-list' }, doc.branches.map((b) => {
      const parent = b.parent && doc.branches.find((x) => x.id === b.parent);
      const end = sideSummary(doc, b.turns.at(-1));
      return h('div', { class: `wg-branch${b.id === branchId ? ' is-on' : ''}` },
        h('div', { class: 'row' },
          canEdit ? h('input', { class: 'input', type: 'text', value: b.name, 'aria-label': 'Branch name', onchange: (e) => mutate(() => { b.name = e.target.value.trim() || b.name; }) }) : h('strong', {}, b.name),
          b.id === branchId ? h('span', { class: 'pill is-live' }, 'Playing') : h('button', { type: 'button', class: 'btn btn-sm', onclick: () => goTo(b.id, lastTurn(doc, b.id)) }, 'Open')),
        h('p', { class: 'muted' }, `${b.turns.length - 1} ${b.turns.length - 1 === 1 ? 'turn' : 'turns'}${parent ? ` · branched from ${parent.name} after ${lower(turnLabel(doc, b.forkTurn))}` : ''}`),
        end.length ? h('p', { class: 'wg-branch-end' }, end.map((s) => h('span', {}, h('i', { style: `background:${s.color}` }), `${s.active}/${s.units}`))) : null,
        canEdit && doc.branches.length > 1 ? h('button', { type: 'button', class: 'link-btn', onclick: async () => {
          if (!await confirmDialog({ title: `Delete the branch "${b.name}"?`, danger: true, confirmLabel: 'Delete branch', message: 'Its turns and notes are removed. Other branches are not affected. You can undo this.' })) return;
          mutate(() => { deleteBranch(doc, b.id); if (branchId === b.id) { branchId = doc.branches[0].id; turnIx = lastTurn(doc, branchId); } });
        } }, 'Delete') : null);
    })),
    canEdit ? h('button', { type: 'button', class: 'btn btn-primary btn-block', style: 'margin-top:12px', onclick: branchHere }, icon('copy', { size: 15 }), `Branch from ${lower(turnLabel(doc, turnIx))}`) : null,
    doc.branches.length > 1 ? h('label', { class: 'field', style: 'margin-top:12px' },
      h('span', { class: 'field-label' }, 'Ghost branch overlay on map'),
      h('select', { onchange: (e) => { ghostBranchId = e.target.value || null; render(); } },
        h('option', { value: '', selected: !ghostBranchId }, 'None (off)'),
        doc.branches.filter((b) => b.id !== branchId).map((b) => h('option', { value: b.id, selected: ghostBranchId === b.id }, b.name))),
      h('span', { class: 'field-hint' }, 'Shows another branch\'s unit positions and displacement vectors at this turn as translucent ghosts.')) : null,
    h('button', { type: 'button', class: 'btn btn-block', style: 'margin-top:8px', onclick: openCompare }, icon('compare', { size: 15 }), 'Compare branches'),
    h('button', { type: 'button', class: 'btn btn-block', style: 'margin-top:8px', onclick: () => extras.openAnalysis() }, icon('chart', { size: 15 }), 'Charts, heat map and hotwash'),
  ];
}

function setupPanel() {
  const ro = !canEdit;
  const c = doc.clock ||= { mode: 'turns', stepMinutes: 60, start: '' };
  return [
    ...head('Setup', 'The scenario\'s description, sides, clock and rules.'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'What this scenario tests'), h('textarea', { class: 'input', rows: 3, disabled: ro, placeholder: 'The question the room is here to answer', onchange: (e) => mutate(() => { doc.summary = e.target.value; }, { redraw: false }) }, doc.summary || '')),
    h('div', { class: 'rail-section-title' }, 'Sides'),
    h('div', { class: 'wg-list' }, doc.sides.map((s, i) => h('div', { class: 'row wg-side-row' },
      h('input', { type: 'color', value: s.color, disabled: ro, 'aria-label': `${s.name} color`, onchange: (e) => mutate(() => { s.color = e.target.value; }) }),
      h('input', { class: 'input', type: 'text', value: s.name, disabled: ro, 'aria-label': 'Side name', onchange: (e) => mutate(() => { s.name = e.target.value.trim() || s.name; }) }),
      h('select', { disabled: ro, 'aria-label': 'Symbol frame', title: 'The frame used for this side\'s military symbols', onchange: (e) => mutate(() => { s.affiliation = e.target.value; }) },
        [['F', 'Friendly'], ['H', 'Hostile'], ['N', 'Neutral'], ['U', 'Unknown']].map(([v, l]) => h('option', { value: v, selected: s.affiliation === v }, l))),
      !ro && doc.sides.length > 1 ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${s.name}`, onclick: () => {
        if (doc.branches.some((b) => b.turns.some((t) => t.units.some((u) => u.side === s.id)))) { toast(`${s.name} still has units. Move them to another side or remove them first.`, { tone: 'error', duration: 6000 }); return; }
        mutate(() => { doc.sides.splice(i, 1); });
      } }, icon('x', { size: 15 })) : null))),
    ro ? null : h('button', { type: 'button', class: 'btn btn-sm', style: 'margin-top:8px', onclick: () => mutate(() => { doc.sides.push({ id: uid('s'), name: `Side ${doc.sides.length + 1}`, color: '#7c3aed', affiliation: 'U' }); }) }, icon('plus', { size: 14 }), 'Add a side'),
    h('div', { class: 'rail-section-title' }, 'Clock'),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Turns are shown as'), h('div', { class: 'seg seg-block' }, [['turns', 'Turn numbers'], ['elapsed', 'Hours elapsed'], ['time', 'Date and time']].map(([v, l]) => h('button', { type: 'button', class: c.mode === v ? 'is-on' : '', disabled: ro, onclick: () => mutate(() => { c.mode = v; }) }, l)))),
    h('div', { class: 'grid-2' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Minutes per turn'), h('input', { class: 'input', type: 'number', min: 1, step: 1, value: c.stepMinutes || 60, disabled: ro, onchange: (e) => mutate(() => { c.stepMinutes = Math.max(1, Math.round(+e.target.value || 60)); }) })),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, c.mode === 'time' ? 'Game starts' : 'Game starts (for daylight)'), h('input', { class: 'input', type: 'datetime-local', value: c.start || '', disabled: ro, onchange: (e) => mutate(() => { c.start = e.target.value; }) }))),
    h('p', { class: 'field-hint', style: 'margin-top:-4px' }, 'Minutes per turn sets how far a unit with a speed can move in a turn, and the size of "reach" areas.'),
    ...tools.rulesSection(),
    ...extras.weatherSection(),
    h('div', { class: 'rail-section-title' }, 'Map'),
    mapDoc ? h('p', { class: 'muted' }, 'Played on your saved map ', h('a', { href: `/map.html?id=${doc.map}`, target: '_blank', rel: 'noopener' }, mapDoc.title || 'Untitled map'), '. Edit the map to change its layers and basemap.')
      : h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Basemap'), h('select', { disabled: ro, onchange: (e) => { mutate(() => { doc.view.basemap = e.target.value; }, { redraw: false }); location.reload(); } }, Object.entries(BASEMAPS).map(([k, b]) => h('option', { value: k, selected: (doc.view.basemap || 'light') === k }, b.label)))),
    ro ? null : h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { const ctr = map.getCenter(); mutate(() => { Object.assign(doc.view, { center: [+ctr.lng.toFixed(5), +ctr.lat.toFixed(5)], zoom: +map.getZoom().toFixed(2), bearing: +map.getBearing().toFixed(1), pitch: +map.getPitch().toFixed(1) }); }, { redraw: false }); toast('The scenario now opens on this view', { tone: 'ok' }); } }, icon('target', { size: 14 }), 'Open on this view'),
  ];
}

const ctx = {
  get doc() { return doc; }, get map() { return map; }, get canEdit() { return canEdit; }, get branchId() { return branchId; }, get turnIx() { return turnIx; },
  get viewAs() { return viewAs; }, get tool() { return tool; }, get rev() { return rev; },
  turn, branch, live, mutate, render, select, unitById, symbol, shown, facts, startDraw,
  drawing: () => drawing,
  setTool: (k) => { tool = k; render(); },
  get scenarioId() { return meta.id || id; }, get selected() { return selected; }, get overlay() { return overlay; }, get template() { return template; },
  setOverlay: (features) => setOverlay(features), clearOverlay: () => clearOverlay(), goTo: (b, n) => goTo(b, n), lastTurn: () => lastTurn(doc, branchId),
};
const tools = createTools(ctx);
const extras = createExtras(ctx);
const TOOLBAR = [['units', 'Units', 'pin'], ['combat', 'Combat', 'swords'], ['lines', 'Lines', 'line'], ['terrain', 'Terrain', 'mountain'], ['objectives', 'Objectives', 'flag'], ['draw', 'Draw', 'pen'],
  ['injects', 'Injects', 'target'], ['log', 'Log', 'text'], ['dice', 'Dice', 'hex'], ['branches', 'Branches', 'copy'], ['setup', 'Setup', 'sliders']];
const PANELS = { units: unitsPanel, injects: injectsPanel, log: logPanel, dice: dicePanel, branches: branchesPanel, setup: setupPanel, ...tools.panels };

/* ---------- the turn bar ---------- */

function turnBar() {
  const b = branch();
  const last = b.turns.length - 1;
  const summary = sideSummary(doc, turn());
  const planned = turn().units.filter((u) => u.plan);
  return [
    h('select', { class: 'wg-branch-pick', 'aria-label': 'Branch', title: 'Branch', onchange: (e) => goTo(e.target.value, lastTurn(doc, e.target.value)) }, doc.branches.map((x) => h('option', { value: x.id, selected: x.id === branchId }, x.name))),
    h('div', { class: 'wg-steps' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'First turn', disabled: turnIx === 0, onclick: () => goTo(branchId, 0) }, icon('back', { size: 16 }), icon('back', { size: 16, cls: 'wg-dbl' })),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous turn', disabled: turnIx === 0, onclick: () => goTo(branchId, turnIx - 1) }, icon('back', { size: 18 })),
      h('div', { class: 'wg-now', 'aria-live': 'polite' }, h('strong', {}, turnLabel(doc, turnIx)), h('span', {}, last ? `${turnIx} of ${last}` : 'before the first turn')),
      h('button', { type: 'button', class: 'icon-btn wg-fwd', 'aria-label': 'Next turn played', disabled: turnIx === last, onclick: () => goTo(branchId, turnIx + 1) }, icon('back', { size: 18 })),
      h('button', { type: 'button', class: 'icon-btn wg-fwd', 'aria-label': 'Latest turn', disabled: turnIx === last, onclick: () => goTo(branchId, last) }, icon('back', { size: 16 }), icon('back', { size: 16, cls: 'wg-dbl' }))),
    screenMode ? null : extras.playControls(),
    h('div', { class: 'wg-dots', role: 'group', 'aria-label': 'Turns' }, b.turns.map((_, n) => h('button', { type: 'button', class: `${n === turnIx ? 'is-on' : ''}${n === b.forkTurn && b.parent ? ' is-fork' : ''}`, title: turnLabel(doc, n), 'aria-label': turnLabel(doc, n), onclick: () => goTo(branchId, n) }))),
    h('div', { class: 'wg-tally' }, summary.map((s) => h('span', { title: `${s.name}: ${s.active} of ${s.units} in action, ${s.strength}% strength` }, h('i', { style: `background:${s.color}` }), `${s.active}/${s.units}`))),
    scoreChips(),
    extras.conditionsChip(),
    h('span', { class: 'spacer' }),
    extras.screenOn && !screenMode ? h('span', { class: 'pill is-live', title: 'A second screen is following this window' }, 'Second screen') : null,
    canEdit && atLatest() && planned.length ? h('button', { type: 'button', class: 'btn wg-reveal', title: 'Reveal every planned move and move the units at once', onclick: revealMoves }, icon('eye', { size: 15 }), `Reveal ${planned.length} ${planned.length === 1 ? 'move' : 'moves'}`) : null,
    !canEdit ? null
      : atLatest() ? h('button', { type: 'button', class: 'btn btn-primary wg-next', title: 'Start the next turn (N)', onclick: advance }, turnIx === 0 ? 'Start turn 1' : 'Next turn', icon('back', { size: 16, cls: 'wg-flip' }))
        : [h('span', { class: 'wg-past' }, 'An earlier turn'),
          h('button', { type: 'button', class: 'btn', onclick: branchHere }, icon('copy', { size: 15 }), 'Branch from here'),
          h('button', { type: 'button', class: 'btn', onclick: replayFromHere }, 'Replay from here')],
  ];
}

function scoreChips() {
  const sc = facts().score;
  if (!sc) return null;
  const mode = doc.victory?.mode === 'total' ? sc.total : sc.held;
  return h('div', { class: 'wg-score-chips', title: 'Objective points', onclick: () => { tool = 'objectives'; render(); } }, icon('flag', { size: 14 }),
    doc.sides.filter((s) => s.affiliation !== 'N').map((s) => h('span', { class: sc.winner === s.id ? 'is-win' : '' }, h('i', { style: `background:${s.color}` }), String(mode[s.id] || 0))));
}

function revealMoves() {
  const r = mutate(() => R.executePlans(doc, turn()));
  toast(`${r.moved.length} ${r.moved.length === 1 ? 'unit' : 'units'} moved${r.contacts.length ? `, ${r.contacts.length} ${r.contacts.length === 1 ? 'contact' : 'contacts'}` : ''}.`, { duration: 6000, ...(r.contacts.length ? { action: { label: 'Fight', onClick: () => { tool = 'combat'; render(); } } } : {}) });
}

/* ---------- drawing everything ---------- */

function render() {
  if (!doc) return;
  const panel = $('#wg-panel');
  if (panel) { const y = panel.scrollTop; fill(panel, PANELS[tool]()); panel.scrollTop = y; }
  const tools = $('#wg-tools');
  if (tools) fill(tools, TOOLBAR.map(([k, l, ic]) => h('button', { type: 'button', class: tool === k ? 'is-on' : '', 'aria-pressed': tool === k ? 'true' : 'false', title: l, onclick: () => { tool = k; render(); } }, icon(ic, { size: 20 }), l)));
  fill($('#wg-bar'), turnBar());
  const card = $('#wg-card');
  const u = selected && unitById(selected);
  if (card) fill(card, u && root.classList.contains('is-present') ? [symbol(u, 26), h('div', {}, h('strong', {}, u.name), h('span', {}, [`${sideOf(doc, u.side).name} · ${KINDS[u.kind]?.label || ''} · ${statusLabel(u.status)} · ${u.strength}%`, ...tools.unitFlags(u, facts()).map((f) => ` · ${f[2]}`)].join('')))] : null);
  if (card) card.hidden = !(u && root.classList.contains('is-present'));
  root.classList.toggle('is-placing', !!placing || !!drawing);
  drawBar();
  drawMap();
  if (!screenMode) extras.sync();
}

addEventListener('keydown', (e) => {
  if (!doc || screenMode || document.querySelector('dialog[open]')) return;
  if (drawing && !typing(e)) {
    if (e.key === 'Escape') { e.preventDefault(); stopDraw(); return; }
    if (e.key === 'Enter') { e.preventDefault(); finishDraw(); return; }
    if (e.key === 'Backspace' && drawing.coords.length) { e.preventDefault(); drawing.coords.pop(); drawMap(); drawBar(); return; }
  }
  if (e.key === 'Escape') {
    if ($('.wg-banner')) { $('.wg-banner').remove(); extras.sync({ banner: null }); return; }
    if (placing) { placing = null; render(); return; }
    if (root.classList.contains('is-present') && !document.fullscreenElement) { present(false); return; }
    if (selected) { select(null); }
    return;
  }
  if (typing(e)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (canEdit) undo(); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(branchId, turnIx - 1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); goTo(branchId, turnIx + 1); }
  if (e.key.toLowerCase() === 'n' && live()) { e.preventDefault(); advance(); }
});

function present(on) {
  root.classList.toggle('is-present', on);
  if (on) root.requestFullscreen?.().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen?.();
  setTimeout(() => { map.resize(); render(); }, 120);
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && root.classList.contains('is-present')) present(false); });

/* ---------- page ---------- */

const mode = await load();
if (!mode || !doc) {
  fill(root, h('main', { class: 'pv-missing' }, h('h1', {}, 'This scenario isn\'t available'), h('p', {}, 'It may have been deleted, or it isn\'t shared with you.'), h('a', { class: 'btn btn-primary', href: '/?tab=scenarios' }, 'Go to Waymark')));
} else {
  canEdit = mode === 'editor' && !screenMode;
  doc.injects ||= [];
  branchId = doc.branches[0].id;
  turnIx = canEdit ? lastTurn(doc, branchId) : 0;
  setTitle(doc.title || 'Scenario');
  mapDoc = await loadMap(mode);
  if (!canEdit) tool = 'log';
  const mapEl = h('div', { class: 'wg-map' });
  const title = canEdit ? h('input', { class: 'bld-title', 'aria-label': 'Scenario title', value: doc.title || '', placeholder: 'Untitled scenario', oninput: (e) => { doc.title = e.target.value; setTitle(doc.title || 'Scenario'); changed(); } })
    : h('h1', { class: 'db-title' }, doc.title || 'Untitled scenario');
  const viewPick = h('select', { class: 'wg-viewas', 'aria-label': 'Show the map as', title: 'Hide units the chosen side hasn\'t seen', onchange: (e) => { viewAs = e.target.value; if (selected && !shown(unitById(selected) || {})) selected = null; render(); } },
    h('option', { value: 'all' }, 'Show everything'), doc.sides.map((s) => h('option', { value: s.id }, `${s.name}'s view`)));
  fill(root,
    embed ? null : h('header', { class: 'bld-top wg-top' },
      mode === 'public' ? h('a', { href: '/', class: 'pv-logo', 'aria-label': BRAND.name }, logo({ size: 26, withName: false }))
        : [h('a', { href: '/?tab=scenarios', class: 'icon-btn', title: 'All scenarios', 'aria-label': 'All scenarios' }, icon('back')), logo({ size: 26, withName: false }), h('span', { class: 'bld-sep', 'aria-hidden': 'true' })],
      title,
      canEdit ? h('span', { id: 'save-state', class: 'save-state', 'aria-live': 'polite' }, 'Saved') : h('span', { class: 'pill no-dot' }, 'View only'),
      h('span', { class: 'spacer' }),
      viewPick,
      canEdit ? h('button', { type: 'button', class: 'icon-btn', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: undo }, icon('undo')) : null,
      mode === 'public' ? null : h('a', { class: 'icon-btn', href: '/help/scenarios', target: '_blank', rel: 'noopener', title: 'Help', 'aria-label': 'Help' }, icon('help')),
      h('button', { type: 'button', class: 'icon-btn', title: 'Second screen, timeline, analysis, files', 'aria-label': 'More', onclick: (e) => extras.moreMenu(e.currentTarget) }, icon('more')),
      canEdit && meta.role === 'owner' ? h('button', { type: 'button', class: 'btn', onclick: () => openShare({ type: 'scenario', id: meta.id, title: doc.title }) }, icon('link', { size: 15 }), 'Share') : null,
      canEdit ? h('button', { type: 'button', class: 'btn', onclick: writeUp }, icon('scrollmap', { size: 15 }), 'Write it up') : null,
      h('button', { type: 'button', class: 'btn btn-primary', title: 'Full screen, with the panels hidden', onclick: () => present(true) }, icon('monitor', { size: 15 }), 'Present')),
    h('nav', { class: 'me-tools wg-tools', id: 'wg-tools', 'aria-label': 'Scenario tools' }),
    h('aside', { class: 'me-panel wg-panel', id: 'wg-panel' }),
    h('main', { class: 'wg-stage' }, mapEl,
      h('button', { type: 'button', class: 'btn btn-sm wg-clear', id: 'wg-clear', hidden: true, onclick: () => clearOverlay() }, icon('x', { size: 14 }), 'Clear the overlay'),
      h('button', { type: 'button', class: 'btn btn-sm wg-exit', onclick: () => present(false) }, icon('x', { size: 14 }), 'Exit'),
      h('div', { class: 'wg-card', id: 'wg-card', hidden: true }),
      h('div', { class: 'wg-drawbar', id: 'wg-drawbar', hidden: true, role: 'status' }),
      h('div', { class: 'wg-measure', id: 'wg-measure', hidden: true })),
    h('footer', { class: 'wg-bar', id: 'wg-bar' }));

  const base = mapDoc?.view || {};
  map = createMap(mapEl, { ...base, ...doc.view, basemap: mapDoc ? base.basemap : doc.view.basemap, markers: [], layers: base.layers || [], legend: !!mapDoc && base.legend !== false }, { library: mapDoc?.layers || [] });
  if (!embed) map.scrollZoom.enable();
  map.on('style.load', () => { markers.forEach((m) => m.marker.remove()); markers.clear(); drawMap(); extras.drawGrid(); });
  if (!embed) extras.mapControls(map, $('.wg-stage'));
  if (screenMode) { root.classList.add('is-present', 'is-screen'); setTitle(`${doc.title || 'Scenario'} · second screen`); extras.follow(applyRemote); } else extras.listen();
  map.on('click', (e) => {
    if (drawing) { addDrawPoint(drawing.snap ? snapPoint(e.lngLat) : [e.lngLat.lng, e.lngLat.lat]); return; }
    if (placing?.what === 'unit' && live()) {
      const u = mutate(() => addUnit(doc, turn(), { side: placing.side, kind: placing.kind, echelon: KINDS[placing.kind]?.fn ? placing.echelon : '', lngLat: [e.lngLat.lng, e.lngLat.lat] }));
      toast(`${u.name} placed`, { duration: 1800 });
      return;
    }
    if (placing?.what === 'inject') { const done = placing.done; placing = null; done([+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)]); toast('Inject pinned', { tone: 'ok' }); render(); return; }
    if (selected) select(null);
  });
  map.on('dblclick', (e) => { if (drawing) { e.preventDefault(); finishDraw(); } });
  let moveFrame = 0;
  map.on('mousemove', (e) => {
    if (!drawing || drawing.mode === 'point' || !drawing.coords.length) return;
    drawing.cursor = drawing.snap ? snapPoint(e.lngLat) : [e.lngLat.lng, e.lngLat.lat];
    if (!moveFrame) moveFrame = requestAnimationFrame(() => { moveFrame = 0; if (drawing) { tools.draw(map, facts()); if (drawing.measure) drawBar(); } });
  });
  render();
  if (canEdit && params.has('new') && !turn().units.length) { placing = { what: 'unit', ...template }; render(); }
}
