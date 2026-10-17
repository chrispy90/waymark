// Story renderer. Takes a story JSON document (see docs/SCHEMA.md) and builds the reading experience.
import { createMap, applyView, DEFAULT_VIEW, layerFeatures, PALETTE, SATELLITE_SENSORS } from './maps.js';
import { sanitize, safeUrl } from './sanitize.js';
import { track, reveal, countUp, viewProgress, pinProgress, exitProgress, reducedMotion } from './effects.js';
import { BRAND } from './brand.js';
import { normalizeStory } from './story-format.js';
import { fogWeather } from './fog.js';

const COLOR = /^#[0-9a-f]{3,8}$/i;
const NO_REVEAL = new Set(['scrollmap', 'statement', 'gallery', 'chapter']);
const SVG_TAGS = new Set(['svg', 'circle', 'path', 'rect', 'g', 'text']);

const h = (tag, attrs = {}, ...kids) => {
  const isSvg = SVG_TAGS.has(tag);
  const el = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'html' && !isSvg) el.innerHTML = sanitize(v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
};

/**
 * Renders `story` into `root`. Returns a destroy() function.
 * opts.instant: show everything immediately (used when the builder re-renders the preview).
 */
export const THEMES = ['light', 'dark', 'brutalist', 'atlas', 'aurora', 'editorial', 'blueprint', 'fog'];

export function renderStory(story, root, { instant = false, homeHref = '/' } = {}) {
  normalizeStory(story);
  const ctx = { maps: [], observers: [], cleanups: [], library: story.layers || [], instant };
  const motion = ['none', 'subtle', 'expressive'].includes(story.motion) ? story.motion : 'subtle';
  root.innerHTML = '';
  root.className = `sm-story motion-${motion}`;
  document.documentElement.dataset.theme = THEMES.includes(story.theme) ? story.theme : 'light';
  document.title = story.title || 'Untitled story';
  setPalette(null);

  root.append(renderHeader(story, root), renderCover(story, ctx));
  const body = h('main', { class: 'sm-body' });
  let palette = null; // chapters recolor the page from that point on
  (story.blocks || []).forEach((block, i) => {
    const r = BLOCKS[block.type];
    if (!r) return;
    const el = r(block, ctx);
    el.dataset.blockIndex = i;
    if (block.type === 'chapter') palette = COLOR.test(block.bg || '') ? { bg: block.bg, fg: COLOR.test(block.fg || '') ? block.fg : null } : null;
    el._palette = palette;
    if (motion !== 'none' && !NO_REVEAL.has(block.type)) ctx.cleanups.push(reveal(el, { instant }));
    body.append(el);
  });
  body.append(h('footer', { class: 'sm-credits' },
    story.credits ? h('div', { html: story.credits }) : null,
    h(homeHref ? 'a' : 'span', { class: 'sm-madewith', href: homeHref || null }, `Made with ${BRAND.name}`)));
  root.append(body);
  if (document.documentElement.dataset.theme === 'fog') ctx.cleanups.push(fogWeather(root));

  // Page colors follow whichever block crosses the middle of the screen (checked once per frame while scrolling).
  const hasChapters = (story.blocks || []).some((b) => b.type === 'chapter');
  const blockEls = [...body.children].filter((el) => el.dataset.blockIndex);
  let current;
  const updatePalette = () => {
    const mid = innerHeight / 2;
    const el = blockEls.find((x) => { const r = x.getBoundingClientRect(); return r.top <= mid && r.bottom > mid; });
    const p = el ? el._palette : null;
    if (p !== current) { current = p; setPalette(p); }
  };

  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const max = document.documentElement.scrollHeight - innerHeight;
      root.style.setProperty('--progress', max > 0 ? scrollY / max : 0);
      if (hasChapters) updatePalette();
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  return () => {
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
    cancelAnimationFrame(raf);
    ctx.observers.forEach((o) => o.disconnect());
    ctx.cleanups.forEach((fn) => fn());
    ctx.maps.forEach((m) => m.remove());
    setPalette(null);
    root.innerHTML = '';
  };
}

function setPalette(p) {
  const s = document.documentElement.style;
  if (!p) { ['--bg', '--fg', '--muted', '--card', '--line'].forEach((k) => s.removeProperty(k)); return; }
  const fg = p.fg || 'var(--fg)';
  s.setProperty('--bg', p.bg);
  if (p.fg) s.setProperty('--fg', p.fg);
  s.setProperty('--muted', `color-mix(in srgb, ${fg} 62%, ${p.bg})`);
  s.setProperty('--card', `color-mix(in srgb, ${p.bg} 90%, ${fg})`);
  s.setProperty('--line', `color-mix(in srgb, ${p.bg} 80%, ${fg})`);
}

function renderHeader(story, root) {
  // The brutalist theme runs the title as a ticker; its CSS shows two copies of this repeated string.
  const ticker = `${Array(6).fill(`\u2731  ${(story.title || '').toUpperCase()}`).join('      ')}      `;
  const chapters = [];
  (story.blocks || []).forEach((b, idx) => {
    if (b.type === 'chapter' && b.title) chapters.push({ idx, title: b.title });
  });
  const nav = chapters.length ? h('nav', { class: 'sm-topbar-chapters', 'aria-label': 'Story sections' },
    chapters.map((c) => h('button', {
      type: 'button',
      class: 'sm-chapter-pill',
      onclick: () => {
        const target = root.querySelector(`[data-block-index="${c.idx}"]`);
        target?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      },
    }, c.title))) : null;
  return h('header', { class: 'sm-topbar' },
    h('span', { class: 'sm-topbar-title', 'data-ticker': ticker }, story.title || ''),
    nav,
    h('div', { class: 'sm-progress', 'aria-hidden': 'true' }));
}

function renderCover(story, ctx) {
  const c = story.cover || {};
  const img = safeUrl(c.image);
  const effect = img ? (c.effect || 'parallax') : 'none';
  const bg = img ? h('div', { class: 'sm-cover-bg', style: `background-image:url("${img}")` }) : null;
  const inner = h('div', { class: 'sm-cover-inner' },
    c.kicker ? h('p', { class: 'sm-kicker' }, c.kicker) : null,
    h('h1', {}, story.title || 'Untitled story'),
    story.subtitle ? h('p', { class: 'sm-subtitle' }, story.subtitle) : null,
    h('p', { class: 'sm-byline' }, [story.author, story.date].filter(Boolean).join(' · ')));
  const el = h('section', { class: `sm-cover ${img ? 'has-image' : ''} cover-${effect}` }, bg, inner,
    h('div', { class: 'sm-scroll-cue', 'aria-hidden': 'true' }, h('span')));
  if (effect !== 'none' && !reducedMotion()) {
    ctx.cleanups.push(track(el, (r) => {
      const p = exitProgress(r);
      if (effect === 'parallax') bg.style.transform = `translate3d(0, ${p * 35}%, 0) scale(1.08)`;
      if (effect === 'zoom') bg.style.transform = `scale(${1.05 + p * 0.35})`;
      inner.style.opacity = String(Math.max(0, 1 - p * 1.6));
      inner.style.transform = `translate3d(0, ${p * -80}px, 0)`;
    }));
  }
  return el;
}

// Create a map only once its container approaches the viewport (WebGL contexts are limited).
function lazyMap(ctx, el, view, opts, onReady) {
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    const map = createMap(el, view, { ...opts, library: ctx.library });
    ctx.maps.push(map);
    onReady?.(map);
  }, { rootMargin: '200px' });
  io.observe(el);
  ctx.observers.push(io);
}

function caption(text) {
  return text ? h('figcaption', { class: 'sm-caption' }, text) : null;
}

// Scroll-linked image motion: parallax drift, slow zoom, or a wipe-in reveal.
function imageEffect(wrap, img, effect, ctx) {
  if (!effect || effect === 'none' || reducedMotion()) return;
  wrap.classList.add(`fx-${effect}`);
  if (effect === 'reveal') { ctx.cleanups.push(reveal(wrap, { instant: ctx.instant })); return; }
  ctx.cleanups.push(track(wrap, (r, vh) => {
    const p = viewProgress(r, vh);
    img.style.transform = effect === 'parallax' ? `translate3d(0, ${(p - 0.5) * -18}%, 0) scale(1.22)` : `scale(${1 + p * 0.22})`;
  }));
}

function mediaElement(media = {}) {
  switch (media.type) {
    case 'image':
      return h('img', { src: safeUrl(media.url), alt: media.alt || '', loading: 'lazy' });
    case 'video': {
      const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/.exec(media.url || '');
      const vimeo = /vimeo\.com\/(\d+)/.exec(media.url || '');
      if (yt) return iframe(`https://www.youtube-nocookie.com/embed/${yt[1]}`, media.alt);
      if (vimeo) return iframe(`https://player.vimeo.com/video/${vimeo[1]}`, media.alt);
      return h('video', { src: safeUrl(media.url), controls: true, playsinline: true, preload: 'metadata' });
    }
    case 'embed':
      return iframe(safeUrl(media.url), media.alt);
    default:
      return h('div', { class: 'sm-muted' }, 'Unsupported media');
  }
}

const iframe = (src, title = 'Embedded content') =>
  h('iframe', { src, title, loading: 'lazy', allowfullscreen: true, sandbox: 'allow-scripts allow-same-origin allow-popups allow-presentation' });

/* ---------------- Blocks ---------------- */

const BLOCKS = {
  text: (b) => h('section', { class: `sm-text sm-narrow ${b.style ? 'is-' + b.style : ''}`, html: b.html }),

  quote: (b) => h('blockquote', { class: 'sm-quote sm-narrow' },
    h('p', {}, b.text || ''), b.cite ? h('cite', {}, '— ' + b.cite) : null),

  separator: () => h('hr', { class: 'sm-separator' }),

  image: (b, ctx) => {
    // No photo yet: a placeholder that only shows in the editor's preview, never to readers.
    if (!b.url) return h('figure', { class: `sm-figure size-${b.size || 'wide'} sm-empty-media` }, h('div', { class: 'sm-empty-box' }, 'Click to add a photo'), caption(b.caption));
    const img = mediaElement({ ...b, type: 'image' });
    const wrap = h('div', { class: 'sm-img-wrap' }, img);
    imageEffect(wrap, img, b.effect, ctx);
    return h('figure', { class: `sm-figure size-${b.size || 'wide'}` }, wrap, caption(b.caption));
  },

  // Full-screen chapter title. Its colors become the page colors until the next chapter.
  chapter: (b, ctx) => {
    const img = safeUrl(b.image);
    const bg = img ? h('div', { class: 'sm-chapter-bg', style: `background-image:url("${img}")` }) : null;
    const inner = h('div', { class: 'sm-chapter-inner' },
      b.kicker ? h('p', { class: 'sm-kicker' }, b.kicker) : null,
      h('h2', {}, b.title || ''),
      b.text ? h('p', { class: 'sm-chapter-text' }, b.text) : null);
    const style = [COLOR.test(b.bg || '') ? `--chapter-bg:${b.bg}` : '', COLOR.test(b.fg || '') ? `--chapter-fg:${b.fg}` : ''].filter(Boolean).join(';');
    const el = h('section', { class: `sm-chapter align-${b.align || 'center'} ${img ? 'has-image' : ''}`, style: style || null }, bg, inner);
    if (ctx.instant || reducedMotion()) inner.classList.add('is-in');
    else ctx.cleanups.push(reveal(inner));
    if (bg && !reducedMotion()) ctx.cleanups.push(track(el, (r, vh) => { bg.style.transform = `translate3d(0, ${(viewProgress(r, vh) - 0.5) * 24}%, 0) scale(1.25)`; }));
    return el;
  },

  // Big statement whose words light up one by one as the reader scrolls.
  statement: (b, ctx) => {
    const words = String(b.text || '').split(/\s+/).filter(Boolean).map((w) => h('span', { class: 'sm-word' }, w + ' '));
    const el = h('section', { class: `sm-statement ${b.style ? 'is-' + b.style : ''}`, style: `--len:${words.length}` },
      h('div', { class: 'sm-statement-inner' },
        h('p', { class: 'sm-statement-text' }, words),
        b.cite ? h('p', { class: 'sm-statement-cite' }, b.cite) : null));
    if (reducedMotion()) { words.forEach((w) => w.classList.add('is-lit')); el.classList.add('is-static'); return el; }
    let lit = -1;
    ctx.cleanups.push(track(el, (r, vh) => {
      const n = Math.round(Math.min(1, pinProgress(r, vh) * 1.25) * words.length);
      if (n === lit) return;
      lit = n;
      words.forEach((w, i) => w.classList.toggle('is-lit', i < n));
    }));
    return el;
  },

  // Numbers that count up when they scroll into view.
  stats: (b, ctx) => h('section', { class: 'sm-stats' },
    h('div', { class: 'sm-stats-grid' }, (b.items || []).map((it) => {
      const num = h('div', { class: 'sm-stat-num' });
      ctx.cleanups.push(countUp(num, it.value ?? ''));
      return h('div', { class: 'sm-stat' }, num, h('div', { class: 'sm-stat-label' }, it.label || ''));
    })),
    caption(b.caption)),

  // Interactive Chart & Executive Data Table block (manual items or live layer aggregation).
  chart: (b, ctx) => {
    const wrap = h('section', { class: 'sm-chart' });
    const body = h('div', { class: 'sm-chart-body' });
    let activeView = ['bar', 'column', 'donut', 'table'].includes(b.chartType) ? b.chartType : 'bar';
    let sortKey = 'value';
    let sortDir = -1;
    let cachedFc = null;

    const fmtVal = (v) => {
      const pre = b.unitPrefix || '';
      const suf = b.unitSuffix || '';
      const numStr = typeof v === 'number' ? (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : String(Math.round(v * 100) / 100)) : String(v ?? '');
      return `${pre}${numStr}${suf}`;
    };

    const draw = () => {
      const { series, total, max } = computeChartSeries(b, cachedFc);
      if (!series.length) {
        body.replaceChildren(h('div', { class: 'sm-empty-box' }, 'No chart data yet — add items or connect a data layer'));
        return;
      }
      if (activeView === 'bar') {
        body.replaceChildren(h('div', { class: 'sm-chart-bars' }, series.map((it) => {
          const pct = Math.max(2, Math.round((Math.abs(it.value) / max) * 100));
          const share = total > 0 ? `${Math.round((Math.abs(it.value) / total) * 100)}%` : '';
          return h('div', { class: 'sm-bar-row' },
            h('div', { class: 'sm-bar-meta' },
              h('span', { class: 'sm-bar-label' }, it.label),
              h('span', { class: 'sm-bar-val' }, fmtVal(it.value), share ? h('small', { class: 'sm-bar-share' }, ` (${share})`) : null)),
            h('div', { class: 'sm-bar-track' },
              h('div', { class: 'sm-bar-fill', style: `width:${pct}%;background:${it.color}` })),
            it.note ? h('div', { class: 'sm-bar-note' }, it.note) : null);
        })));
        return;
      }
      if (activeView === 'column') {
        body.replaceChildren(h('div', { class: 'sm-chart-cols' }, series.map((it) => {
          const pct = Math.max(4, Math.round((Math.abs(it.value) / max) * 100));
          return h('div', { class: 'sm-col-item' },
            h('div', { class: 'sm-col-val' }, fmtVal(it.value)),
            h('div', { class: 'sm-col-well' },
              h('div', { class: 'sm-col-bar', style: `height:${pct}%;background:${it.color}` })),
            h('div', { class: 'sm-col-label', title: it.label }, it.label));
        })));
        return;
      }
      if (activeView === 'donut') {
        const r = 74;
        const c = 2 * Math.PI * r;
        let offset = 0;
        const arcs = series.map((it) => {
          const frac = total > 0 ? Math.max(0, it.value) / total : 0;
          const len = frac * c;
          const circle = h('circle', {
            cx: '105', cy: '105', r: String(r),
            fill: 'none', stroke: it.color, 'stroke-width': '26',
            'stroke-dasharray': `${len} ${c - len}`,
            'stroke-dashoffset': String(-offset),
          });
          offset += len;
          return circle;
        });
        const svg = h('svg', { class: 'sm-donut-svg', viewBox: '0 0 210 210' },
          h('circle', { cx: '105', cy: '105', r: String(r), fill: 'none', stroke: 'var(--line)', 'stroke-width': '26' }),
          h('g', { transform: 'rotate(-90 105 105)' }, arcs),
          h('text', { x: '105', y: '101', 'text-anchor': 'middle', class: 'sm-donut-total' }, fmtVal(Math.round(total * 100) / 100)),
          h('text', { x: '105', y: '121', 'text-anchor': 'middle', class: 'sm-donut-sub' }, b.stat === 'avg' ? 'Combined' : 'Total'));
        const legend = h('div', { class: 'sm-donut-legend' }, series.map((it) => {
          const share = total > 0 ? `${Math.round((Math.max(0, it.value) / total) * 100)}%` : '0%';
          return h('div', { class: 'sm-donut-item' },
            h('span', { class: 'sm-donut-dot', style: `background:${it.color}` }),
            h('span', { class: 'sm-donut-name' }, it.label),
            h('strong', { class: 'sm-donut-val' }, fmtVal(it.value)),
            h('span', { class: 'sm-donut-pct' }, share));
        }));
        body.replaceChildren(h('div', { class: 'sm-chart-donut' }, svg, legend));
        return;
      }
      // Executive Data Table view
      const sorted = [...series].sort((a, c) => (sortKey === 'label' ? a.label.localeCompare(c.label) : a.value - c.value) * sortDir);
      body.replaceChildren(h('div', { class: 'sm-chart-table-wrap' },
        h('table', { class: 'sm-chart-table' },
          h('thead', {}, h('tr', {},
            h('th', { style: 'width:42px' }, '#'),
            h('th', { onclick: () => { sortDir = sortKey === 'label' ? -sortDir : 1; sortKey = 'label'; draw(); }, style: 'cursor:pointer' },
              b.groupField || 'Category', sortKey === 'label' ? (sortDir > 0 ? ' ▲' : ' ▼') : ''),
            h('th', { onclick: () => { sortDir = sortKey === 'value' ? -sortDir : -1; sortKey = 'value'; draw(); }, style: 'cursor:pointer;text-align:right' },
              b.valueField || 'Value', sortKey === 'value' ? (sortDir > 0 ? ' ▲' : ' ▼') : ''),
            h('th', { style: 'width:32%' }, 'Share'))),
          h('tbody', {}, sorted.map((it, idx) => {
            const pct = Math.max(2, Math.round((Math.abs(it.value) / max) * 100));
            const share = total > 0 ? `${Math.round((Math.abs(it.value) / total) * 100)}%` : '—';
            return h('tr', {},
              h('td', { class: 'sm-td-rank' }, String(idx + 1)),
              h('td', {}, h('strong', {}, it.label), it.note ? h('div', { class: 'sm-bar-note' }, it.note) : null),
              h('td', { style: 'text-align:right;font-variant-numeric:tabular-nums' }, fmtVal(it.value)),
              h('td', {}, h('div', { class: 'sm-td-share' },
                h('div', { class: 'sm-td-bar', style: `width:${pct}%;background:${it.color}` }),
                h('span', {}, share))));
          })))));
    };

    const switcher = h('div', { class: 'sm-chart-switch', role: 'group', 'aria-label': 'View mode' },
      [['bar', 'Bars'], ['column', 'Columns'], ['donut', 'Donut'], ['table', 'Table']].map(([k, lbl]) =>
        h('button', {
          type: 'button',
          class: activeView === k ? 'is-on' : '',
          onclick: (e) => {
            activeView = k;
            switcher.querySelectorAll('button').forEach((btn) => btn.classList.toggle('is-on', btn === e.currentTarget));
            draw();
          },
        }, lbl)));

    const headEl = h('div', { class: 'sm-chart-head' },
      h('div', {},
        b.title ? h('h3', { class: 'sm-chart-title' }, b.title) : null,
        b.subtitle ? h('p', { class: 'sm-chart-subtitle' }, b.subtitle) : null),
      switcher);

    wrap.append(headEl, body, caption(b.caption));

    const layer = b.layer ? (ctx.library || []).find((l) => l.id === b.layer) : null;
    if (layer) {
      body.replaceChildren(h('div', { class: 'sm-empty-box' }, 'Loading layer metrics…'));
      layerFeatures(layer).then((fc) => { cachedFc = fc; draw(); }).catch(() => draw());
    } else {
      draw();
    }
    return wrap;
  },

  // Horizontal gallery driven by vertical scrolling.
  gallery: (b, ctx) => {
    const items = (b.images || []).filter((im) => im.url).map((im) => h('figure', { class: 'sm-hg-item' },
      h('img', { src: safeUrl(im.url), alt: im.alt || '', loading: 'lazy' }),
      im.caption ? h('figcaption', {}, im.caption) : null));
    const trackEl = h('div', { class: 'sm-hg-track' },
      b.title || b.text ? h('div', { class: 'sm-hg-intro' }, b.title ? h('h2', {}, b.title) : null, b.text ? h('p', {}, b.text) : null) : null,
      items.length ? items : [1, 2, 3].map(() => h('figure', { class: 'sm-hg-item sm-empty-media' }, h('div', { class: 'sm-empty-box' }, 'Click to add photos'))));
    const el = h('section', { class: `sm-hgallery${items.length ? '' : ' sm-empty-media'}`, style: `--n:${items.length}` }, h('div', { class: 'sm-hg-sticky' }, trackEl));
    if (reducedMotion() || !items.length) { el.classList.add('is-static'); return el; }
    ctx.cleanups.push(track(el, (r, vh) => {
      const dist = Math.max(0, trackEl.scrollWidth - innerWidth);
      trackEl.style.transform = `translate3d(${-pinProgress(r, vh) * dist}px, 0, 0)`;
    }));
    return el;
  },

  video: (b) => h('figure', { class: `sm-figure size-${b.size || 'wide'} sm-ratio` },
    mediaElement({ ...b, type: 'video' }), caption(b.caption)),

  embed: (b) => h('figure', { class: `sm-figure size-${b.size || 'wide'} sm-ratio` },
    mediaElement({ ...b, type: 'embed' }), caption(b.caption)),

  map: (b, ctx) => {
    const el = h('div', { class: 'sm-map', role: 'region', 'aria-label': b.alt || 'Map' });
    lazyMap(ctx, el, b.view, {});
    return h('figure', { class: `sm-figure size-${b.size || 'full'} sm-map-figure` }, el, caption(b.caption));
  },

  // Moving map: a sticky media panel that changes as story cards scroll past.
  scrollmap: (b, ctx) => {
    const slides = b.slides || [];
    const mapEl = h('div', { class: 'sm-map' });
    const stage = h('div', { class: 'sm-stage' });
    const mediaPane = h('div', { class: 'sm-scrollmap-media' }, mapEl, stage);
    const slideEls = slides.map((s, i) =>
      h('div', { class: 'sm-slide', 'data-i': i },
        h('div', { class: 'sm-slide-card', html: s.html, onclick: (e) => runAction(e, i) })));
    const section = h('section', { class: `sm-scrollmap layout-${b.layout || 'split'}` },
      mediaPane, h('div', { class: 'sm-scrollmap-slides' }, slideEls));

    const firstMap = slides.find((s) => (s.media?.type || 'map') === 'map');
    let map = null;
    let active = -1;
    let pending = null;

    const showView = (v, animate = true) => {
      if (map) applyView(map, v, { animate });
      else pending = v;
    };

    // Map links: links of the form #action:<id> swap the card's map view until clicked again.
    const runAction = (e, i) => {
      const link = e.target.closest('a[href^="#action:"]');
      if (!link) return;
      e.preventDefault();
      const action = (slides[i].actions || []).find((a) => a.id === link.getAttribute('href').slice(8));
      if (!action) return;
      if (i !== active) activate(i);
      const card = slideEls[i];
      const wasOn = link.classList.contains('is-on');
      card.querySelectorAll('a.is-on').forEach((a) => a.classList.remove('is-on'));
      section.classList.remove('show-stage');
      if (wasOn) showView(slides[i].media?.view);
      else { link.classList.add('is-on'); showView(action.view); }
    };

    const activate = (i) => {
      if (i === active) return;
      active = i;
      slideEls.forEach((el) => el.querySelectorAll('a.is-on').forEach((a) => a.classList.remove('is-on')));
      slideEls.forEach((el, j) => el.classList.toggle('is-active', j === i));
      const media = slides[i]?.media || { type: 'map', view: DEFAULT_VIEW };
      const isMap = (media.type || 'map') === 'map';
      section.classList.toggle('show-stage', !isMap);
      if (isMap) showView(media.view);
      else {
        const node = mediaElement(media);
        node.classList.add('sm-stage-item');
        stage.replaceChildren(node);
        requestAnimationFrame(() => node.classList.add('is-in'));
      }
    };

    if (firstMap) {
      lazyMap(ctx, mapEl, firstMap.view, {}, (m) => {
        map = m;
        if (pending) { applyView(map, pending, { animate: false }); pending = null; }
      });
    }

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.isIntersecting && activate(+e.target.dataset.i));
    }, { rootMargin: '-45% 0px -45% 0px' });
    slideEls.forEach((el) => io.observe(el));
    ctx.observers.push(io);
    if (slides.length) activate(0);
    return section;
  },

  // Stop by stop: numbered places on a map, with a panel to step through them.
  stops: (b, ctx) => {
    const places = b.places || [];
    let i = 0;
    let map = null;
    const panel = h('div', { class: 'sm-stops-panel', 'aria-live': 'polite' });
    const mapEl = h('div', { class: 'sm-map' });
    const markers = places.map((p, n) => ({ lngLat: p.lngLat, label: String(n + 1) }));

    const show = (n, animate = true) => {
      i = (n + places.length) % places.length;
      const p = places[i];
      panel.replaceChildren(
        p.image ? h('img', { src: safeUrl(p.image), alt: p.alt || p.title || '', loading: 'lazy' }) : null,
        h('div', { class: 'sm-stops-body' },
          h('p', { class: 'sm-stops-count' }, `${i + 1} / ${places.length}`),
          h('h3', {}, p.title || ''),
          h('div', { html: p.html || '' }),
          h('div', { class: 'sm-stops-nav' },
            h('button', { type: 'button', onclick: () => show(i - 1), 'aria-label': 'Previous place' }, '←'),
            h('button', { type: 'button', onclick: () => show(i + 1), 'aria-label': 'Next place' }, '→'))));
      if (map) {
        applyView(map, { basemap: b.basemap, center: p.lngLat, zoom: p.zoom ?? b.zoom ?? 14, pitch: b.pitch || 0, markers, layers: b.layers || [] }, { animate });
        map._markers.forEach((m, j) => {
          m.getElement().classList.toggle('is-active', j === i);
          m.getElement().onclick = () => show(j);
        });
      }
    };

    if (places.length) {
      lazyMap(ctx, mapEl, { basemap: b.basemap, center: places[0].lngLat, zoom: b.zoom ?? 14, markers, layers: b.layers || [] }, {}, (m) => {
        map = m;
        show(i, false);
      });
      show(0, false);
    }
    if (!places.length) return h('section', { class: 'sm-stops size-full sm-empty-media' }, h('div', { class: 'sm-empty-box' }, 'Click to add stops'));
    return h('section', { class: 'sm-stops size-full' }, h('div', { class: 'sm-stops-grid' }, panel, mapEl), caption(b.caption));
  },

  // Before & after: compare two basemaps, layer sets, or multi-date satellite imagery with a draggable divider.
  compare: (b, ctx) => {
    const leftEl = h('div', { class: 'sm-map' });
    const rightEl = h('div', { class: 'sm-map sm-compare-top' });
    const handle = h('div', { class: 'sm-compare-handle', role: 'slider', tabindex: 0, 'aria-label': 'Divider position', 'aria-valuemin': 0, 'aria-valuemax': 100 });
    const sensor = b.satSensor && SATELLITE_SENSORS[b.satSensor];
    const leftText = b.leftLabel || (sensor && b.leftDate ? b.leftDate : '');
    const rightText = b.rightLabel || (sensor && b.rightDate ? b.rightDate : '');
    const wrap = h('div', { class: 'sm-compare' }, leftEl, rightEl, handle,
      h('span', { class: 'sm-compare-label left' }, leftText),
      h('span', { class: 'sm-compare-label right' }, rightText));
    let pos = 50;
    const setPos = (p) => {
      pos = Math.max(0, Math.min(100, p));
      wrap.style.setProperty('--pos', pos + '%');
      handle.setAttribute('aria-valuenow', Math.round(pos));
    };
    handle.addEventListener('pointerdown', (e) => {
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => { const r = wrap.getBoundingClientRect(); setPos(((ev.clientX - r.left) / r.width) * 100); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', () => handle.removeEventListener('pointermove', move), { once: true });
    });
    handle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') setPos(pos - 5);
      if (e.key === 'ArrowRight') setPos(pos + 5);
    });
    setPos(50);

    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const view = b.view || DEFAULT_VIEW;
      let leftLayers = [...(b.leftLayers || [])];
      let rightLayers = [...(b.rightLayers || [])];
      const lib = [...(ctx.library || [])];
      if (sensor) {
        if (b.leftDate) {
          const lid = `_sat_l_${b.satSensor}_${b.leftDate}`;
          lib.push({
            id: lid,
            name: `${sensor.label} (${b.leftDate})`,
            type: 'raster',
            tiles: sensor.tiles.replace('{date}', b.leftDate),
            maxzoom: sensor.maxzoom,
            attribution: sensor.attribution,
            style: { opacity: 1 },
          });
          leftLayers = [lid, ...leftLayers];
        }
        if (b.rightDate) {
          const rid = `_sat_r_${b.satSensor}_${b.rightDate}`;
          lib.push({
            id: rid,
            name: `${sensor.label} (${b.rightDate})`,
            type: 'raster',
            tiles: sensor.tiles.replace('{date}', b.rightDate),
            maxzoom: sensor.maxzoom,
            attribution: sensor.attribution,
            style: { opacity: 1 },
          });
          rightLayers = [rid, ...rightLayers];
        }
      }
      const a = createMap(leftEl, { ...view, basemap: b.left || 'streets', layers: leftLayers }, { library: lib });
      const c = createMap(rightEl, { ...view, basemap: b.right || 'dark', layers: rightLayers, legend: false }, { interactive: false, library: lib });
      ctx.maps.push(a, c);
      a.on('move', () => c.jumpTo({ center: a.getCenter(), zoom: a.getZoom(), bearing: a.getBearing(), pitch: a.getPitch() }));
    }, { rootMargin: '200px' });
    io.observe(wrap);
    ctx.observers.push(io);
    return h('figure', { class: 'sm-figure size-full' }, wrap, caption(b.caption));
  },
};

export function computeChartSeries(b, fc) {
  let series = [];
  if (fc && Array.isArray(fc.features) && fc.features.length) {
    const gf = b.groupField || '';
    const vf = b.valueField || '';
    const stat = b.stat || (vf ? 'sum' : 'count');
    const groups = new Map();
    fc.features.forEach((f, idx) => {
      const p = f.properties || {};
      const key = gf ? String(p[gf] ?? 'Unspecified') : String(p.name || p.title || `#${idx + 1}`);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });
    for (const [label, rows] of groups.entries()) {
      let val = rows.length;
      if (stat !== 'count' && vf) {
        const nums = rows.map((r) => Number(String(r[vf] ?? '').replace(/[,$%\s]/g, ''))).filter((n) => Number.isFinite(n));
        if (!nums.length) val = 0;
        else if (stat === 'sum') val = nums.reduce((a, c) => a + c, 0);
        else if (stat === 'avg') val = nums.reduce((a, c) => a + c, 0) / nums.length;
        else if (stat === 'min') val = Math.min(...nums);
        else if (stat === 'max') val = Math.max(...nums);
      }
      series.push({ label, value: Math.round(val * 100) / 100, count: rows.length });
    }
    series.sort((a, c) => c.value - a.value);
    const lim = Math.max(1, +(b.limit || (b.chartType === 'table' ? 15 : 8)));
    series = series.slice(0, lim).map((it, idx) => ({ ...it, color: PALETTE[idx % PALETTE.length] }));
  } else if (Array.isArray(b.items)) {
    series = b.items.map((it, idx) => {
      const n = Number(String(it.value ?? 0).replace(/[,$%\s]/g, ''));
      return {
        label: String(it.label || `Item ${idx + 1}`),
        value: Number.isFinite(n) ? n : 0,
        color: COLOR.test(it.color || '') ? it.color : PALETTE[idx % PALETTE.length],
        note: it.note || '',
      };
    });
  }
  const total = series.reduce((s, it) => s + (it.value > 0 ? it.value : 0), 0);
  const max = series.length ? Math.max(...series.map((it) => Math.abs(it.value)), 1) : 1;
  return { series, total, max };
}

export const BLOCK_TYPES = Object.keys(BLOCKS);
