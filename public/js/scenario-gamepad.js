// Xbox / Standard Gamepad support for Scenarios (Web Gamepad API, zero dependencies).
// Console RTS / tactical wargame control scheme with seamless MAP <-> MENU <-> DIALOG focus switching,
// Hold-X 6-slice Tactical Radial Command Wheel, smart side-grouped unit cycling, LT/RT fast menu paging,
// and simultaneous-plan-aware Turn Advance.
import { h, toast, dialog } from './ui.js';
import { distanceKm, sideOf, statusLabel } from './scenario-core.js';

export const XBOX = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  VIEW: 8,
  MENU: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
};

export const RADIAL_ITEMS = [
  { id: 'place', label: 'Place Unit', sub: 'Drop at reticle' },
  { id: 'combat', label: 'Combat', sub: 'Open engagement' },
  { id: 'reach', label: 'Reach Rings', sub: '1-3 turn terrain' },
  { id: 'dice', label: 'Dice & Odds', sub: 'Roll / matrix' },
  { id: 'grid', label: 'MGRS Grid', sub: 'Toggle overlay' },
  { id: 'view', label: 'Fog View', sub: 'All / Blue / Red' },
];

export const XBOX_BINDINGS = [
  ['Y', 'Jump between MAP and LEFT MENU anytime'],
  ['Hold X + LS', 'Open 6-Slice Tactical Radial Wheel (release X to run)'],
  ['Tap X', 'Undo last action'],
  ['Left Stick', 'Map: Pan under reticle · Menu: Navigate controls'],
  ['Right Stick', 'Map: 3D Orbit & Pitch · Menu: Scroll panel'],
  ['LT / RT', 'Map: Smooth Zoom Out/In · Menu: Fast Page Up/Down (5 items)'],
  ['A', 'Map: Select / Move / Engage · Menu: Click / Toggle'],
  ['B', 'Map: Deselect / Cancel · Menu: Back to Map / Close Dialog'],
  ['LB / RB', 'Map: Cycle active units (grouped by side) · Menu: Switch tabs'],
  ['D-Pad ◀ / ▶', 'Map: Step turns · Menu: Adjust slider / Cycle dropdown'],
  ['D-Pad ▲ / ▼', 'Map: Fog View (▲) / Reach Rings (▼) · Menu: Move focus'],
  ['L3 / R3', 'Reset camera (L3) · Toggle 3D tactical tilt 0°/52° (R3)'],
  ['Menu / View', 'Reveal Moves / Next Turn (Menu) · Fullscreen Present (View)'],
];

const PREFS_KEY = 'wm.scenario.gamepad';
const FOCUS_SELECTOR = 'summary, button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href]';

/** Radial deadzone with smooth rescaling from [deadzone..1] to [0..1]. */
export function applyDeadzone(x, y, deadzone = 0.16) {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone) return [0, 0];
  const scaled = Math.min(1, (mag - deadzone) / (1 - deadzone));
  const curved = scaled * scaled * (0.45 + 0.55 * scaled);
  return [(x / mag) * curved, (y / mag) * curved];
}

/** 1D trigger/axis curve with deadzone. */
export function stickCurve(v, deadzone = 0.08) {
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  const s = Math.min(1, (a - deadzone) / (1 - deadzone));
  return Math.sign(v) * s * s;
}

/** Map stick (lx, ly) to radial slice index [0..count-1] starting at 12 o'clock clockwise, or -1 in deadzone. */
export function pickRadialSlice(lx, ly, count = 6, deadzone = 0.28) {
  if (Math.hypot(lx, ly) < deadzone) return -1;
  // Angle clockwise from straight up (0, -1)
  const rad = Math.atan2(lx, -ly);
  const deg = (rad * 180 / Math.PI + 360) % 360;
  const slice = 360 / count;
  return Math.floor(((deg + slice / 2) % 360) / slice);
}

/** Find the closest projected unit within `snapPx` of screen center `(cx, cy)`. */
export function pickReticleTarget(units, projectFn, cx, cy, snapPx = 44) {
  let best = null;
  let bestD = snapPx;
  for (const u of units) {
    const pt = projectFn(u.lngLat);
    if (!pt) continue;
    const d = Math.hypot(pt.x - cx, pt.y - cy);
    if (d < bestD) { bestD = d; best = u; }
  }
  return best;
}

/** Cycle a <select>-like element's selectedIndex by `dir` (-1 or +1). Returns true if changed. */
export function stepSelectOption(el, dir) {
  const opts = el?.options;
  if (!opts || !opts.length) return false;
  const next = (el.selectedIndex + dir + opts.length) % opts.length;
  if (next === el.selectedIndex) return false;
  el.selectedIndex = next;
  el.dispatchEvent?.(new Event('change', { bubbles: true }));
  return true;
}

/** Nudge a range input by `dir` (-1 or +1) using its step (or 5% of range). Returns true if changed. */
export function stepRangeInput(el, dir) {
  if (!el) return false;
  const min = Number.isFinite(Number(el.min)) && el.min !== '' ? Number(el.min) : 0;
  const max = Number.isFinite(Number(el.max)) && el.max !== '' ? Number(el.max) : 100;
  const rawStep = Number(el.step);
  const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : Math.max(1, Math.round((max - min) / 20));
  const cur = Number(el.value);
  const next = Math.max(min, Math.min(max, (Number.isFinite(cur) ? cur : min) + dir * step));
  if (next === cur) return false;
  el.value = String(next);
  el.dispatchEvent?.(new Event('input', { bubbles: true }));
  el.dispatchEvent?.(new Event('change', { bubbles: true }));
  return true;
}

/** Collect visible focusable controls inside a container element. */
export function getFocusableControls(container) {
  if (!container) return [];
  return [...container.querySelectorAll(FOCUS_SELECTOR)].filter((el) => {
    if (el.hidden || el.closest('[hidden]')) return false;
    const rect = el.getBoundingClientRect?.();
    return !rect || (rect.width > 0 && rect.height > 0);
  });
}

function loadPrefs() {
  try {
    return {
      rumble: true,
      invertY: false,
      sensitivity: 1.0,
      ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'),
    };
  } catch {
    return { rumble: true, invertY: false, sensitivity: 1.0 };
  }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

const kmFmt = (n) => (n < 10 ? `${Math.round(n * 10) / 10} km` : `${Math.round(n)} km`);

export function createGamepad(ctx) {
  const prefs = loadPrefs();
  let enabled = false;
  let connected = false;
  let padName = '';
  let focusZone = 'map'; // 'map' | 'menu'
  let focusedEl = null;
  let focusIndex = 0;
  let rafId = 0;
  let lastTs = 0;
  let prevButtons = [];
  let navRepeatAt = 0;
  let pageRepeatAt = 0;
  let xDownAt = 0;
  let radialOpen = false;
  let radialSlice = -1;
  let hoveredUnit = null;
  let lastHoverId = null;
  let velX = 0;
  let velY = 0;
  let headerBtn = null;
  let stageEl = null;
  let reticleEl = null;
  let radialEl = null;
  let hudEl = null;
  let previewLayerReady = false;

  const hasApi = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';

  function getActivePad() {
    if (!hasApi) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  function rumble(strong = 0.35, weak = 0.25, duration = 70) {
    if (!prefs.rumble) return;
    const pad = getActivePad();
    const act = pad?.vibrationActuator;
    if (!act || typeof act.playEffect !== 'function') return;
    try {
      act.playEffect('dual-rumble', {
        startDelay: 0,
        duration,
        weakMagnitude: Math.max(0, Math.min(1, weak)),
        strongMagnitude: Math.max(0, Math.min(1, strong)),
      }).catch(() => {});
    } catch { /* unsupported */ }
  }

  function activeDialog() {
    const dlgs = document.querySelectorAll('dialog[open]');
    return dlgs.length ? dlgs[dlgs.length - 1] : null;
  }

  function activeMenuContainer() {
    return activeDialog() || document.getElementById('wg-panel');
  }

  function clearFocusHighlight() {
    if (focusedEl) {
      focusedEl.classList.remove('is-gp-focus');
      focusedEl = null;
    }
  }

  function syncMenuFocus(preferredIndex = null) {
    const container = activeMenuContainer();
    const items = getFocusableControls(container);
    if (!items.length) { clearFocusHighlight(); return null; }

    let idx = preferredIndex !== null ? preferredIndex : (focusedEl ? items.indexOf(focusedEl) : focusIndex);
    if (idx < 0) idx = Math.min(focusIndex, items.length - 1);
    idx = Math.max(0, Math.min(items.length - 1, idx));
    focusIndex = idx;

    clearFocusHighlight();
    focusedEl = items[idx];
    focusedEl.classList.add('is-gp-focus');
    focusedEl.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    return focusedEl;
  }

  function setFocusZone(zone, { silent = false } = {}) {
    if (zone === 'menu' && ctx.isPresent()) ctx.present(false);
    closeRadial();
    focusZone = zone;
    const panel = document.getElementById('wg-panel');
    const rail = document.getElementById('wg-tools');
    panel?.classList.toggle('is-gp-menu-active', enabled && focusZone === 'menu');
    rail?.classList.toggle('is-gp-menu-active', enabled && focusZone === 'menu');
    if (focusZone === 'menu') {
      focusIndex = 0;
      syncMenuFocus(0);
    } else {
      clearFocusHighlight();
    }
    updateReticleAndHud();
    if (!silent) rumble(0.14, 0.22, 35);
  }

  function moveMenuFocus(delta) {
    const container = activeMenuContainer();
    const items = getFocusableControls(container);
    if (!items.length) return;
    const cur = focusedEl ? items.indexOf(focusedEl) : focusIndex;
    const next = cur < 0 ? 0 : (cur + delta + items.length * 4) % items.length;
    syncMenuFocus(next);
    rumble(0.06, 0.14, 22);
  }

  function adjustFocusedControl(dir) {
    const el = syncMenuFocus();
    if (!el) return;
    if (el.tagName === 'SELECT') {
      if (stepSelectOption(el, dir)) rumble(0.12, 0.2, 30);
      return;
    }
    if (el.tagName === 'INPUT' && el.type === 'range') {
      if (stepRangeInput(el, dir)) rumble(0.08, 0.16, 22);
      return;
    }
    moveMenuFocus(dir);
  }

  function activateFocusedControl() {
    const el = syncMenuFocus();
    if (!el) return;
    const wasPlacing = !!ctx.placing;
    const wasDrawing = !!ctx.drawing?.();
    if (el.tagName === 'SELECT') {
      stepSelectOption(el, 1);
      rumble(0.16, 0.24, 38);
      return;
    }
    if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'search' || el.type === 'number' || el.type === 'textarea')) {
      el.focus();
      rumble(0.14, 0.2, 35);
      return;
    }
    el.click();
    rumble(0.24, 0.28, 50);

    setTimeout(() => {
      if (!activeDialog() && ((!wasPlacing && ctx.placing) || (!wasDrawing && ctx.drawing?.()))) {
        setFocusZone('map', { silent: true });
        toast('Aim reticle & press A to place', { duration: 2200 });
        return;
      }
      if (focusZone === 'menu' || activeDialog()) syncMenuFocus();
    }, 35);
  }

  /* ---------- 6-Slice Tactical Radial Command Wheel (Hold X) ---------- */

  function openRadial() {
    if (radialOpen || !radialEl) return;
    radialOpen = true;
    radialSlice = -1;
    radialEl.hidden = false;
    radialEl.classList.add('is-open');
    updateRadialVisual();
    rumble(0.12, 0.22, 35);
  }

  function closeRadial() {
    if (!radialOpen || !radialEl) return;
    radialOpen = false;
    radialSlice = -1;
    radialEl.classList.remove('is-open');
    radialEl.hidden = true;
  }

  function updateRadialVisual() {
    if (!radialEl) return;
    const nodes = radialEl.querySelectorAll('.wg-rad-item');
    nodes.forEach((n, idx) => n.classList.toggle('is-hot', idx === radialSlice));
    const centerLbl = radialEl.querySelector('.wg-rad-center');
    if (centerLbl) {
      const item = RADIAL_ITEMS[radialSlice];
      centerLbl.textContent = item ? item.label : 'Flick Stick';
    }
  }

  function runRadialAction(idx) {
    const item = RADIAL_ITEMS[idx];
    if (!item) return;
    rumble(0.26, 0.3, 55);
    if (item.id === 'place') ctx.startPlacingUnit();
    else if (item.id === 'combat') { ctx.setTool('combat'); setFocusZone('menu', { silent: true }); }
    else if (item.id === 'reach') ctx.showReachIsochrones();
    else if (item.id === 'dice') { ctx.setTool('dice'); setFocusZone('menu', { silent: true }); }
    else if (item.id === 'grid') ctx.toggleGrid();
    else if (item.id === 'view') ctx.cycleView();
  }

  function ensurePreviewLayer() {
    const map = ctx.map;
    if (!map || !map.isStyleLoaded()) return false;
    if (map.getSource('wg-gp-preview')) { previewLayerReady = true; return true; }
    try {
      map.addSource('wg-gp-preview', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'wg-gp-preview-line',
        type: 'line',
        source: 'wg-gp-preview',
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#38bdf8'],
          'line-width': 3,
          'line-opacity': 0.9,
          'line-dasharray': [2, 1.5],
        },
      });
      previewLayerReady = true;
      return true;
    } catch {
      return false;
    }
  }

  function clearPreviewLine() {
    const map = ctx.map;
    if (map && previewLayerReady && map.getSource('wg-gp-preview')) {
      map.getSource('wg-gp-preview').setData({ type: 'FeatureCollection', features: [] });
    }
  }

  function updateHeaderBtn() {
    if (!headerBtn) return;
    headerBtn.classList.toggle('is-gp-on', enabled);
    headerBtn.classList.toggle('is-gp-ready', connected && !enabled);
    headerBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    headerBtn.title = enabled
      ? `Xbox Controller Mode ON${padName ? ` (${padName})` : ''} — click for controls or to turn off`
      : connected
        ? `Xbox Controller detected (${padName || 'Gamepad'}) — click to enable Controller Mode`
        : 'Xbox Controller Mode (connect an Xbox controller or click to view controls)';
  }

  function updateReticleAndHud() {
    if (!reticleEl || !hudEl) return;
    const inDialog = !!activeDialog();
    const inMenu = focusZone === 'menu' || inDialog;

    reticleEl.hidden = !enabled;
    hudEl.hidden = !enabled;
    if (!enabled) { clearPreviewLine(); return; }

    reticleEl.classList.toggle('is-dimmed', inMenu || radialOpen);

    const map = ctx.map;
    const center = map ? map.getCenter() : null;
    const selUnit = ctx.selected ? ctx.unitById(ctx.selected) : null;
    const target = hoveredUnit;

    const isEnemy = !!(selUnit && target && target.id !== selUnit.id && target.side !== selUnit.side);
    const color = target ? sideOf(ctx.doc, target.side).color : (selUnit ? sideOf(ctx.doc, selUnit.side).color : '#38bdf8');
    reticleEl.style.setProperty('--gp-color', color);
    reticleEl.classList.toggle('is-locked', !inMenu && !radialOpen && !!target);
    reticleEl.classList.toggle('is-hostile', !inMenu && !radialOpen && isEnemy);
    reticleEl.classList.toggle('is-moving', !inMenu && !radialOpen && !!(selUnit && !target && ctx.live()));

    const badge = reticleEl.querySelector('.wg-reticle-tag');
    let distKm = 0;
    if (selUnit && center) distKm = distanceKm(selUnit.lngLat, [center.lng, center.lat]);

    if (inMenu || radialOpen) {
      badge.hidden = true;
    } else if (target) {
      badge.hidden = false;
      badge.textContent = `${target.name} · ${target.strength}% · ${statusLabel(target.status)}`;
    } else if (selUnit && ctx.live() && distKm >= 0.05) {
      badge.hidden = false;
      badge.textContent = `Move ${selUnit.name} · ${kmFmt(distKm)}`;
    } else if (ctx.placing?.what === 'unit') {
      badge.hidden = false;
      badge.textContent = 'Press A to place unit here';
    } else {
      badge.hidden = true;
    }

    if (!inMenu && !radialOpen && selUnit && center && ctx.live() && distKm >= 0.05 && !isEnemy && ensurePreviewLayer()) {
      map.getSource('wg-gp-preview').setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { color: sideOf(ctx.doc, selUnit.side).color },
          geometry: { type: 'LineString', coordinates: [selUnit.lngLat, [center.lng, center.lat]] },
        }],
      });
    } else {
      clearPreviewLine();
    }

    const modePill = hudEl.querySelector('.wg-gp-mode');
    if (modePill) {
      modePill.textContent = radialOpen ? 'WHEEL' : inDialog ? 'DIALOG' : inMenu ? 'MENU' : 'MAP';
      modePill.classList.toggle('is-menu', inMenu || radialOpen);
    }

    const setLbl = (k, text) => {
      const el = hudEl.querySelector(`[data-gp="${k}"]`);
      if (el) el.textContent = text;
    };

    const planned = ctx.live() && ctx.hasPlannedMoves?.();
    setLbl('menu', planned ? 'Reveal Moves' : 'Next Turn');

    if (inMenu) {
      const el = focusedEl;
      const aLbl = el?.tagName === 'SELECT' ? 'Cycle' : el?.type === 'checkbox' ? 'Toggle' : 'Select';
      setLbl('a', aLbl);
      setLbl('b', inDialog ? 'Close' : 'To Map');
      setLbl('x', 'Undo');
      setLbl('y', 'Map');
      setLbl('lb', 'Tabs');
      setLbl('lt', 'Page');
    } else {
      let aLabel = 'Select';
      if (ctx.placing?.what === 'unit' && ctx.live()) aLabel = 'Place Unit';
      else if (isEnemy) aLabel = 'Engage';
      else if (target && target.id !== selUnit?.id) aLabel = 'Select Unit';
      else if (selUnit && ctx.live() && distKm >= 0.05) aLabel = `Move (${kmFmt(distKm)})`;
      else if (selUnit) aLabel = 'Selected';
      setLbl('a', aLabel);
      setLbl('b', 'Cancel');
      setLbl('x', 'Hold: Wheel');
      setLbl('y', 'Menu');
      setLbl('lb', 'Units');
      setLbl('lt', 'Zoom');
    }

    const statusDot = hudEl.querySelector('.wg-gp-dot');
    if (statusDot) statusDot.classList.toggle('is-live', connected);
  }

  /** Smart unit cycling: skips destroyed units and groups by side (current viewAs side first). */
  function cycleUnit(dir) {
    const sideOrder = ctx.doc.sides.map((s) => s.id);
    if (ctx.viewAs !== 'all') {
      const i = sideOrder.indexOf(ctx.viewAs);
      if (i > 0) sideOrder.unshift(...sideOrder.splice(i, 1));
    }
    const units = ctx.turn().units
      .filter((u) => ctx.shown(u) && u.status !== 'destroyed')
      .sort((a, b) => sideOrder.indexOf(a.side) - sideOrder.indexOf(b.side) || a.name.localeCompare(b.name));
    if (!units.length) { toast('No active units on the map'); return; }
    const idx = units.findIndex((u) => u.id === ctx.selected);
    const nextIdx = (idx + dir + units.length) % units.length;
    const next = units[nextIdx];
    ctx.select(next.id, { fly: true });
    toast(`${next.name} (${nextIdx + 1}/${units.length} · ${sideOf(ctx.doc, next.side).name})`, { duration: 1300 });
    rumble(0.15, 0.25, 40);
  }

  function advanceOrReveal() {
    if (!ctx.live()) { toast('Jump to the latest turn to advance', { duration: 2200 }); return; }
    if (ctx.hasPlannedMoves?.()) {
      ctx.revealMoves();
      rumble(0.55, 0.4, 130);
    } else {
      ctx.advance();
      rumble(0.7, 0.45, 160);
    }
  }

  function handleButtonPress(btnIdx) {
    const openDlg = activeDialog();

    if (openDlg) {
      if (btnIdx === XBOX.B) { openDlg.close(); clearFocusHighlight(); rumble(0.15, 0.15, 35); }
      else if (btnIdx === XBOX.A) activateFocusedControl();
      else if (btnIdx === XBOX.DPAD_UP) moveMenuFocus(-1);
      else if (btnIdx === XBOX.DPAD_DOWN) moveMenuFocus(1);
      else if (btnIdx === XBOX.DPAD_LEFT) adjustFocusedControl(-1);
      else if (btnIdx === XBOX.DPAD_RIGHT) adjustFocusedControl(1);
      return;
    }

    if (focusZone === 'menu') {
      if (btnIdx === XBOX.B || btnIdx === XBOX.Y) { setFocusZone('map'); return; }
      if (btnIdx === XBOX.A) { activateFocusedControl(); return; }
      if (btnIdx === XBOX.DPAD_UP) { moveMenuFocus(-1); return; }
      if (btnIdx === XBOX.DPAD_DOWN) { moveMenuFocus(1); return; }
      if (btnIdx === XBOX.DPAD_LEFT) { adjustFocusedControl(-1); return; }
      if (btnIdx === XBOX.DPAD_RIGHT) { adjustFocusedControl(1); return; }
      if (btnIdx === XBOX.LB) {
        ctx.cycleTool(-1);
        focusIndex = 0;
        setTimeout(() => syncMenuFocus(0), 20);
        rumble(0.14, 0.2, 32);
        return;
      }
      if (btnIdx === XBOX.RB) {
        ctx.cycleTool(1);
        focusIndex = 0;
        setTimeout(() => syncMenuFocus(0), 20);
        rumble(0.14, 0.2, 32);
        return;
      }
      if (btnIdx === XBOX.X && ctx.canEdit) { ctx.undo(); rumble(0.25, 0.2, 55); return; }
      if (btnIdx === XBOX.MENU) { advanceOrReveal(); return; }
      return;
    }

    // --- MAP MODE ---
    const map = ctx.map;
    if (!map) return;

    if (btnIdx === XBOX.Y) { setFocusZone('menu'); return; }
    if (btnIdx === XBOX.A) {
      const center = map.getCenter();
      const lngLat = [+center.lng.toFixed(6), +center.lat.toFixed(6)];
      const selUnit = ctx.selected ? ctx.unitById(ctx.selected) : null;
      const target = hoveredUnit;

      if (ctx.placing?.what === 'unit' && ctx.live()) {
        ctx.placeUnitAt(lngLat);
        rumble(0.45, 0.3, 85);
        return;
      }
      if (selUnit && target && target.id !== selUnit.id && target.side !== selUnit.side) {
        ctx.setTool('combat');
        setFocusZone('menu', { silent: true });
        toast(`Combat ready: ${selUnit.name} vs ${target.name}`, { duration: 3000 });
        rumble(0.65, 0.45, 130);
        return;
      }
      if (target && target.id !== selUnit?.id) {
        ctx.select(target.id);
        rumble(0.2, 0.3, 45);
        return;
      }
      if (selUnit && ctx.live()) {
        const dist = distanceKm(selUnit.lngLat, lngLat);
        if (dist >= 0.04) {
          ctx.moveUnitTo(selUnit.id, lngLat);
          rumble(0.45, 0.28, 95);
        }
        return;
      }
    } else if (btnIdx === XBOX.B) {
      if (ctx.placing) { ctx.cancelPlacing(); rumble(0.15, 0.15, 35); return; }
      if (ctx.selected) { ctx.select(null); rumble(0.15, 0.15, 35); return; }
      if (ctx.isPresent()) { ctx.present(false); rumble(0.15, 0.15, 35); }
    } else if (btnIdx === XBOX.LB) {
      cycleUnit(-1);
    } else if (btnIdx === XBOX.RB) {
      cycleUnit(1);
    } else if (btnIdx === XBOX.DPAD_LEFT) {
      ctx.goTo(ctx.branchId, Math.max(0, ctx.turnIx - 1));
      rumble(0.18, 0.2, 40);
    } else if (btnIdx === XBOX.DPAD_RIGHT) {
      ctx.goTo(ctx.branchId, Math.min(ctx.lastTurn(), ctx.turnIx + 1));
      rumble(0.18, 0.2, 40);
    } else if (btnIdx === XBOX.DPAD_UP) {
      ctx.cycleView();
      rumble(0.16, 0.22, 40);
    } else if (btnIdx === XBOX.DPAD_DOWN) {
      ctx.showReachIsochrones();
      rumble(0.16, 0.22, 40);
    } else if (btnIdx === XBOX.L3) {
      const units = ctx.turn().units.filter(ctx.shown);
      if (units.length) {
        const lngs = units.map((u) => u.lngLat[0]);
        const lats = units.map((u) => u.lngLat[1]);
        map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 90, maxZoom: 13, pitch: 0, bearing: 0, duration: 550 });
      } else {
        map.easeTo({ bearing: 0, pitch: 0, duration: 450 });
      }
      rumble(0.2, 0.25, 50);
    } else if (btnIdx === XBOX.R3) {
      const nextPitch = map.getPitch() > 20 ? 0 : 52;
      map.easeTo({ pitch: nextPitch, duration: 480 });
      toast(nextPitch ? '3D Tactical Camera (52°)' : 'Top-Down Map Camera', { duration: 1600 });
      rumble(0.2, 0.25, 45);
    } else if (btnIdx === XBOX.MENU) {
      advanceOrReveal();
    } else if (btnIdx === XBOX.VIEW) {
      ctx.present(!ctx.isPresent());
      rumble(0.25, 0.25, 55);
    }
  }

  function tick(ts) {
    rafId = requestAnimationFrame(tick);
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;

    const pad = getActivePad();
    if (pad && !connected) {
      connected = true;
      padName = (pad.id || 'Xbox Controller').replace(/\s*\(STANDARD GAMEPAD.*\)/i, '').trim();
      updateHeaderBtn();
    } else if (!pad && connected) {
      connected = false;
      padName = '';
      updateHeaderBtn();
    }

    if (pad && !enabled) {
      const anyBtn = pad.buttons.some((b) => b.pressed);
      const anyAxis = pad.axes.some((a) => Math.abs(a) > 0.45);
      if (anyBtn || anyAxis) {
        setEnabled(true, { silent: false });
        prevButtons = pad.buttons.map((b) => b.pressed);
        return;
      }
    }

    if (!enabled) return;

    const inDialog = !!activeDialog();
    const inMenu = focusZone === 'menu' || inDialog;

    if (inMenu && (!focusedEl || !focusedEl.isConnected)) syncMenuFocus();

    const map = ctx.map;
    if (pad) {
      const sens = prefs.sensitivity || 1.0;

      // Handle Hold-X Radial Command Wheel in MAP mode (tap X = Undo, hold X >= 220ms = Wheel)
      const xNow = !!pad.buttons[XBOX.X]?.pressed;
      const xWas = !!prevButtons[XBOX.X];
      if (!inMenu) {
        if (xNow && !xWas) {
          xDownAt = ts;
        } else if (xNow && xDownAt && !radialOpen && ts - xDownAt >= 220) {
          openRadial();
        } else if (!xNow && xWas) {
          if (radialOpen) {
            const chosen = radialSlice;
            closeRadial();
            if (chosen >= 0) runRadialAction(chosen);
          } else if (ctx.canEdit) {
            ctx.undo();
            rumble(0.25, 0.2, 55);
          }
          xDownAt = 0;
        }
      }

      if (radialOpen) {
        const nextSlice = pickRadialSlice(pad.axes[0] || 0, pad.axes[1] || 0, RADIAL_ITEMS.length, 0.28);
        if (nextSlice !== radialSlice) {
          radialSlice = nextSlice;
          updateRadialVisual();
          if (radialSlice >= 0) rumble(0.08, 0.18, 24);
        }
        // Keep prevButtons synced while wheel is open
        for (let i = 0; i < pad.buttons.length; i++) prevButtons[i] = !!pad.buttons[i]?.pressed;
        updateReticleAndHud();
        return;
      }

      if (inMenu) {
        const lx = pad.axes[0] || 0;
        const ly = pad.axes[1] || 0;
        if (ts >= navRepeatAt) {
          if (Math.abs(ly) > 0.55 && Math.abs(ly) >= Math.abs(lx)) {
            moveMenuFocus(ly > 0 ? 1 : -1);
            navRepeatAt = ts + 185;
          } else if (Math.abs(lx) > 0.55) {
            adjustFocusedControl(lx > 0 ? 1 : -1);
            navRepeatAt = ts + 185;
          }
        }
        // LT / RT fast page-jump (5 controls at a time!)
        const ltVal = pad.buttons[XBOX.LT]?.value || 0;
        const rtVal = pad.buttons[XBOX.RT]?.value || 0;
        if (ts >= pageRepeatAt) {
          if (rtVal > 0.55) { moveMenuFocus(5); pageRepeatAt = ts + 240; }
          else if (ltVal > 0.55) { moveMenuFocus(-5); pageRepeatAt = ts + 240; }
        }
        // Right stick scrolls panel smoothly
        const ry = stickCurve(pad.axes[3] || 0, 0.16);
        const container = activeMenuContainer();
        if (container && Math.abs(ry) > 0.01) container.scrollTop += ry * 620 * sens * dt;
      } else if (map) {
        const [lx, ly] = applyDeadzone(pad.axes[0] || 0, pad.axes[1] || 0, 0.16);
        const maxSpeedPx = 680 * sens;
        const damp = 1 - Math.exp(-14 * dt);
        velX += (lx * maxSpeedPx - velX) * damp;
        velY += (ly * maxSpeedPx - velY) * damp;
        if (Math.hypot(velX, velY) > 0.4) map.panBy([velX * dt, velY * dt], { animate: false });
        else { velX = 0; velY = 0; }

        const [rx, ry] = applyDeadzone(pad.axes[2] || 0, pad.axes[3] || 0, 0.18);
        if (Math.abs(rx) > 0.001) map.setBearing(map.getBearing() + rx * 95 * sens * dt);
        if (Math.abs(ry) > 0.001) {
          const yDir = prefs.invertY ? 1 : -1;
          map.setPitch(Math.max(0, Math.min(70, map.getPitch() + ry * yDir * 55 * sens * dt)));
        }

        const lt = stickCurve(pad.buttons[XBOX.LT]?.value || 0, 0.06);
        const rt = stickCurve(pad.buttons[XBOX.RT]?.value || 0, 0.06);
        const zoomDelta = (rt - lt) * 2.4 * sens * dt;
        if (Math.abs(zoomDelta) > 0.0005) map.setZoom(Math.max(1.5, Math.min(18, map.getZoom() + zoomDelta)));
      }

      for (let i = 0; i < pad.buttons.length; i++) {
        const pressed = !!pad.buttons[i]?.pressed;
        // Skip X in MAP mode since Hold-X / Tap-X is handled above
        if (pressed && !prevButtons[i] && !(i === XBOX.X && !inMenu)) handleButtonPress(i);
        prevButtons[i] = pressed;
      }
    }

    if (map && stageEl) {
      if (!inMenu && !radialOpen) {
        const rect = map.getContainer().getBoundingClientRect();
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const units = ctx.turn().units.filter(ctx.shown);
        hoveredUnit = pickReticleTarget(units, (ll) => map.project(ll), cx, cy, 44);
        if (hoveredUnit?.id !== lastHoverId) {
          if (hoveredUnit) rumble(0.08, 0.16, 28);
          lastHoverId = hoveredUnit?.id || null;
        }
      }
      updateReticleAndHud();
    }
  }

  function setEnabled(on, { silent = false } = {}) {
    enabled = !!on;
    document.documentElement.classList.toggle('is-gamepad', enabled);
    if (!enabled) {
      closeRadial();
      focusZone = 'map';
      clearFocusHighlight();
      document.getElementById('wg-panel')?.classList.remove('is-gp-menu-active');
      document.getElementById('wg-tools')?.classList.remove('is-gp-menu-active');
    }
    updateHeaderBtn();
    updateReticleAndHud();
    if (!silent) {
      toast(enabled
        ? 'Xbox Controller Mode enabled · Y = Menus · Hold X = Command Wheel'
        : 'Xbox Controller Mode off', { duration: 3000 });
    }
    if (enabled) rumble(0.25, 0.35, 75);
  }

  function openControlsDialog() {
    const body = h('div', { class: 'wg-gp-dlg' },
      h('div', { class: 'wg-gp-status' },
        h('span', { class: `wg-gp-dot${connected ? ' is-live' : ''}` }),
        h('strong', {}, connected ? `Connected: ${padName || 'Xbox Controller'}` : 'No controller detected yet'),
        h('span', { class: 'muted' }, connected ? 'Y jumps between Map & Menus · Hold X opens the Radial Wheel' : 'Connect an Xbox controller via USB or Bluetooth and press any button')),
      h('div', { class: 'wg-gp-toggles' },
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: enabled, onchange: (e) => setEnabled(e.target.checked, { silent: true }) }),
          'Enable Controller Mode (reticle + radial wheel + menu navigation)'),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: prefs.rumble, onchange: (e) => { prefs.rumble = e.target.checked; savePrefs(prefs); if (prefs.rumble) rumble(0.3, 0.3, 60); } }),
          'Haptic rumble feedback'),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: prefs.invertY, onchange: (e) => { prefs.invertY = e.target.checked; savePrefs(prefs); } }),
          'Invert right-stick 3D pitch'),
        h('label', { class: 'wg-gp-sens' },
          h('span', {}, 'Stick sensitivity'),
          h('input', { type: 'range', min: '0.5', max: '2', step: '0.1', value: String(prefs.sensitivity), oninput: (e) => { prefs.sensitivity = Number(e.target.value); savePrefs(prefs); } }))),
      h('table', { class: 'wg-gp-map' },
        XBOX_BINDINGS.map(([btn, desc]) => h('tr', {}, h('th', {}, h('kbd', {}, btn)), h('td', {}, desc)))));

    dialog({
      title: 'Xbox Controller Mode',
      body,
      actions: [
        { label: enabled ? 'Turn off' : 'Enable now', cls: enabled ? 'btn' : 'btn btn-primary', onClick: () => setEnabled(!enabled) },
        { label: 'Done', cls: 'btn' },
      ],
    });
  }

  function mount(stage, btn) {
    stageEl = stage;
    headerBtn = btn;
    reticleEl = h('div', { class: 'wg-reticle', hidden: true, 'aria-hidden': 'true' },
      h('div', { class: 'wg-reticle-ring' }),
      h('div', { class: 'wg-reticle-dot' }),
      h('div', { class: 'wg-reticle-tag', hidden: true }));

    // 6-slice Tactical Radial Command Wheel around screen center
    radialEl = h('div', { class: 'wg-radial', hidden: true, role: 'menu', 'aria-label': 'Tactical Command Wheel' },
      h('div', { class: 'wg-rad-ring' }),
      h('div', { class: 'wg-rad-center' }, 'Flick Stick'),
      ...RADIAL_ITEMS.map((item, i) => {
        const ang = (i * 60 - 90) * (Math.PI / 180);
        const r = 112;
        const x = Math.round(Math.cos(ang) * r);
        const y = Math.round(Math.sin(ang) * r);
        return h('div', { class: 'wg-rad-item', style: `--rx:${x}px;--ry:${y}px` },
          h('strong', {}, item.label),
          h('span', {}, item.sub));
      }));

    hudEl = h('div', { class: 'wg-gp-hud', hidden: true, role: 'status', 'aria-live': 'polite' },
      h('span', { class: 'wg-gp-dot' }),
      h('span', { class: 'wg-gp-mode' }, 'MAP'),
      h('span', { class: 'wg-gp-item' }, h('b', { class: 'xb xb-a' }, 'A'), h('span', { 'data-gp': 'a' }, 'Select')),
      h('span', { class: 'wg-gp-item' }, h('b', { class: 'xb xb-b' }, 'B'), h('span', { 'data-gp': 'b' }, 'Cancel')),
      h('span', { class: 'wg-gp-item' }, h('b', { class: 'xb xb-x' }, 'X'), h('span', { 'data-gp': 'x' }, 'Hold: Wheel')),
      h('span', { class: 'wg-gp-item' }, h('b', { class: 'xb xb-y' }, 'Y'), h('span', { 'data-gp': 'y' }, 'Menu')),
      h('span', { class: 'wg-gp-item' }, h('b', { class: 'xb xb-s' }, 'LB/RB'), h('span', { 'data-gp': 'lb' }, 'Units')),
      h('span', { class: 'wg-gp-item' }, h('b', { class: 'xb xb-s' }, 'LT/RT'), h('span', { 'data-gp': 'lt' }, 'Zoom')),
      h('span', { class: 'wg-gp-item' }, h('b', { class: 'xb xb-s' }, 'Menu'), h('span', { 'data-gp': 'menu' }, 'Next Turn')),
      h('button', { type: 'button', class: 'wg-gp-help', title: 'Xbox controller settings & map', onclick: openControlsDialog }, '?'));

    stageEl.append(reticleEl, radialEl, hudEl);
    updateHeaderBtn();

    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => {
        connected = true;
        padName = (e.gamepad?.id || 'Xbox Controller').replace(/\s*\(STANDARD GAMEPAD.*\)/i, '').trim();
        updateHeaderBtn();
        if (!enabled) setEnabled(true);
      });
      window.addEventListener('gamepaddisconnected', () => {
        if (!getActivePad()) {
          connected = false;
          padName = '';
          updateHeaderBtn();
          if (enabled) toast('Xbox controller disconnected', { duration: 2500 });
        }
      });
    }

    if (hasApi && !rafId) rafId = requestAnimationFrame(tick);
  }

  return {
    mount,
    openControlsDialog,
    setEnabled,
    setFocusZone,
    getFocusZone: () => focusZone,
    isEnabled: () => enabled,
    rumble,
    onRender: () => { if (enabled && (focusZone === 'menu' || activeDialog())) syncMenuFocus(); },
    onStyleLoad: () => { previewLayerReady = false; if (enabled) updateReticleAndHud(); },
    destroy: () => { if (rafId) cancelAnimationFrame(rafId); rafId = 0; closeRadial(); clearFocusHighlight(); },
  };
}
