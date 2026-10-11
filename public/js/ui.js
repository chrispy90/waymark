// Shared UI kit: element helper, icons, logo, toasts, menus, confirm dialogs.
import { BRAND } from './brand.js';

export { BRAND };

export const $ = (sel, el = document) => el.querySelector(sel);

export function h(tag, attrs = {}, ...kids) {
  const svg = tag === 'svg' || tag === 'path' || tag === 'circle' || tag === 'rect' || tag === 'ellipse';
  const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' && !svg) el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

/* ---------- Icons (24px grid, stroked) ---------- */

const P = {
  plus: 'M12 5v14M5 12h14',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M6 9l6 6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  text: 'M5 6h14M5 12h14M5 18h9',
  quote: 'M6 17c2 0 4-1.5 4-5V7H5v5h4M15 17c2 0 4-1.5 4-5V7h-5v5h4',
  separator: 'M4 12h3M10.5 12h3M17 12h3',
  image: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM21 15l-5-5-9 9M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  video: 'M5 6h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM16 10l5-3v10l-5-3',
  embed: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  map: 'M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5zM9 4v13.5M15 6.5V20',
  sidecar: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM11 4v16M6 8h2.5M6 11.5h2.5M6 15h2.5',
  tour: 'M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7',
  swipe: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM12 3v18M9 10l-2 2 2 2M15 10l2 2-2 2',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M10 8h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM15 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h4',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12M18 6L6 18',
  monitor: 'M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 20h8M12 16v4',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  logout: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 8l-4 4 4 4M6 12h10',
  key: 'M8 19a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11 12l8-8M16 7l3 3',
  file: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  italic: 'M15 5h-5M14 19H9M14 5l-4 14',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  heading: 'M6 4v16M18 4v16M6 12h12',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  hex: 'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  ruler: 'M3 16.5L16.5 3 21 7.5 7.5 21zM7.5 12l2 2M10.5 9l2 2M13.5 6l2 2',
  pen: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3',
  line: 'M4 18l5-7 5 4 6-9',
  polygon: 'M5 8.5L12 3l7 5.5-2.7 10H7.7z',
  command: 'M9 9h6v6H9zM9 9V6.5A2.5 2.5 0 1 0 6.5 9H9M15 9V6.5A2.5 2.5 0 1 1 17.5 9H15M9 15v2.5A2.5 2.5 0 1 1 6.5 15H9M15 15v2.5a2.5 2.5 0 1 0 2.5-2.5H15',
  keyboard: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM7 10h.01M11 10h.01M15 10h.01M17 10h.01M7 14h10',
  chart: 'M4 20V11M10 20V5M16 20v-6M3 20h18',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5M4 4v3.5h3.5M4 13a8 8 0 0 0 14.6 4.5M20 20v-3.5h-3.5',
};

export function icon(name, { size = 18, cls = '' } = {}) {
  return h('svg', { class: `i ${cls}`, width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': name === 'more' || name === 'grip' ? 3 : 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
  h('path', { d: P[name] || P.file }));
}

/** The Waymark mark: a trail blaze with a route ending at a waypoint. */
export function logo({ size = 28, withName = true } = {}) {
  const mark = h('svg', { class: 'logo-mark', width: size, height: size, viewBox: '0 0 32 32', 'aria-hidden': 'true' },
    h('rect', { width: 32, height: 32, rx: 9, fill: 'var(--brand)' }),
    h('path', { d: 'M8.5 23.5c4.5 0 4-7.5 8-7.5s3.5-6.5 7-7', fill: 'none', stroke: '#fff', 'stroke-width': 2.6, 'stroke-linecap': 'round' }),
    h('circle', { cx: 23.5, cy: 9, r: 2.8, fill: '#fff' }),
    h('circle', { cx: 8.5, cy: 23.5, r: 1.9, fill: '#fff', opacity: 0.65 }));
  return withName ? h('span', { class: 'logo' }, mark, h('span', { class: 'logo-name' }, BRAND.name)) : mark;
}

/* ---------- Toasts ---------- */

let toastHost;
export function toast(message, { tone = 'default', action, duration = 3800 } = {}) {
  toastHost ||= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const el = h('div', { class: `toast is-${tone}` },
    tone === 'ok' ? icon('check', { size: 16 }) : tone === 'error' ? icon('x', { size: 16 }) : null,
    h('span', {}, message),
    action ? h('button', { type: 'button', class: 'toast-action', onclick: () => { action.onClick(); dismiss(); } }, action.label) : null);
  const dismiss = () => { el.classList.add('is-out'); setTimeout(() => el.remove(), 250); };
  toastHost.append(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(dismiss, duration);
  return dismiss;
}

/* ---------- Popover menus ---------- */

let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }
addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
addEventListener('resize', closeMenu);

/** items: [{ label, icon, onClick, danger, disabled }] or 'sep' */
export function menu(anchor, items, { align = 'end' } = {}) {
  closeMenu();
  const el = h('div', { class: 'menu', role: 'menu' }, items.map((it) => it === 'sep' ? h('div', { class: 'menu-sep' }) :
    h('button', { type: 'button', role: 'menuitem', class: `menu-item ${it.danger ? 'is-danger' : ''}`, disabled: it.disabled,
      onclick: () => { closeMenu(); it.onClick(); } }, it.icon ? icon(it.icon, { size: 16 }) : h('span', { class: 'i' }), it.label)));
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const left = align === 'end' ? r.right - w : r.left;
  el.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`;
  const below = r.bottom + 6;
  el.style.top = `${below + el.offsetHeight > innerHeight - 8 ? Math.max(8, r.top - el.offsetHeight - 6) : below}px`;
  openMenu = el;
  el.querySelector('button:not([disabled])')?.focus();
  return el;
}

/* ---------- Dialogs ---------- */

export function dialog({ title, body, actions = [], cls = '', onClose } = {}) {
  const dlg = h('dialog', { class: `dlg ${cls}` },
    h('div', { class: 'dlg-head' }, h('h2', { class: 'dlg-title' }, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('x'))),
    h('div', { class: 'dlg-body' }, body),
    actions.length ? h('div', { class: 'dlg-foot' }, actions) : null);
  dlg.addEventListener('close', () => { onClose?.(); dlg.remove(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // backdrop click
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const dlg = dialog({
      title,
      body: h('p', { class: 'muted' }, message),
      cls: 'dlg-sm',
      onClose: () => resolve(result),
      actions: [
        h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
        h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => { result = true; dlg.close(); } }, confirmLabel),
      ],
    });
    dlg.querySelector('.dlg-foot .btn:last-child').focus();
  });
}

/* ---------- Misc ---------- */

export function relTime(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.round(hr / 24);
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

/** Deterministic pleasant gradient for stories without a cover image. */
export function coverGradient(seed = '') {
  let n = 0;
  for (const c of seed) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const hue = n % 360;
  return `linear-gradient(135deg, hsl(${hue} 45% 62%), hsl(${(hue + 40) % 360} 50% 42%))`;
}

export function setTitle(page) {
  document.title = page ? `${page} · ${BRAND.name}` : BRAND.name;
}
