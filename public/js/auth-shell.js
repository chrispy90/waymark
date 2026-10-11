// Shared layout for sign-in, reset and setup pages: generated contour-map art beside the form.
import { h, logo, BRAND, setTitle } from './ui.js';

export function contours() {
  const svg = h('svg', { class: 'contours', viewBox: '0 0 800 1000', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' });
  const peaks = [[260, 330, 1.0], [600, 760, 0.8], [690, 180, 0.45]];
  peaks.forEach(([cx, cy, s], p) => {
    for (let ring = 1; ring <= 16; ring++) {
      const r = ring * 26 * s + 8;
      let d = '';
      for (let a = 0; a <= 360; a += 6) {
        const t = (a * Math.PI) / 180;
        const wobble = 1 + 0.09 * Math.sin(t * 3 + ring * 0.6 + p) + 0.05 * Math.cos(t * 5 - ring * 0.4);
        const x = cx + Math.cos(t) * r * wobble * 1.15;
        const y = cy + Math.sin(t) * r * wobble;
        d += `${a ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      const hot = ring % 5 === 0;
      svg.append(h('path', { d: d + 'Z', fill: 'none', stroke: hot ? '#e4572e' : 'rgba(255,255,255,.22)', 'stroke-width': hot ? 1.6 : 1 }));
    }
  });
  // a route between the peaks, ending at a waypoint
  svg.append(h('path', { d: 'M120 900 C 260 760, 220 560, 330 470 S 520 300, 640 230', fill: 'none', stroke: '#fff', 'stroke-width': 2.4, 'stroke-dasharray': '2 9', 'stroke-linecap': 'round' }));
  svg.append(h('circle', { cx: 640, cy: 230, r: 9, fill: '#e4572e', stroke: '#fff', 'stroke-width': 3 }));
  return svg;
}

export function mountAuthShell(pageTitle) {
  setTitle(pageTitle);
  const card = document.getElementById('card');
  const art = h('aside', { class: 'auth-art' },
    contours(),
    h('a', { href: '/', class: 'logo', 'aria-label': `${BRAND.name} home` }, [...logo({ size: 30 }).childNodes]),
    h('div', { class: 'auth-art-copy' },
      h('h2', {}, BRAND.tagline),
      h('p', {}, 'Write scroll-driven stories with maps, photos and data. Publish them to a link anyone can open.')));
  card.prepend(h('a', { href: '/', class: 'auth-mobile-logo logo' }, [...logo({ size: 28 }).childNodes]));
  const shell = h('div', { class: 'auth' }, art, h('main', { class: 'auth-main' }, card));
  document.body.prepend(shell);
}
