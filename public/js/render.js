// Story renderer. Takes a story JSON document (see docs/SCHEMA.md) and builds the reading experience.
import { createMap, applyView, DEFAULT_VIEW, layerFeatures, highlightMapFeatures, PALETTE, SATELLITE_SENSORS } from './maps.js';
import { sanitize, safeUrl } from './sanitize.js';
import { track, reveal, countUp, viewProgress, pinProgress, exitProgress, reducedMotion } from './effects.js';
import { BRAND } from './brand.js';
import { normalizeStory } from './story-format.js';
import { fogWeather } from './fog.js';

const COLOR = /^#[0-9a-f]{3,8}$/i;
const NO_REVEAL = new Set(['scrollmap', 'statement', 'gallery', 'chapter']);
const SVG_TAGS = new Set(['svg', 'circle', 'path', 'rect', 'g', 'text', 'line', 'defs', 'linearGradient', 'stop', 'title', 'polygon']);

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

  // Interactive Chart, Sankey Flow, Network Graph & Executive Data Table block (with bi-directional Map brushing).
  chart: (b, ctx) => {
    const wrap = h('section', { class: `sm-chart size-${b.size || 'wide'}` });
    const body = h('div', { class: 'sm-chart-body' });
    const statusStrip = h('div', { class: 'sm-chart-status', hidden: true });
    const VALID_VIEWS = ['bar', 'column', 'donut', 'sankey', 'network', 'table'];
    let activeView = VALID_VIEWS.includes(b.chartType) ? b.chartType : 'bar';
    let sortKey = 'value';
    let sortDir = -1;
    let cachedFc = null;
    let viewportBounds = null;
    let syncViewport = !!b.syncBounds;
    let activeSelection = null; // { type: 'node' | 'link' | 'category', id, label, source, target, features }
    let networkMode = b.networkLayout === 'geo' ? 'geo' : 'force';
    const nodeOffsets = new Map(); // id -> { dx, dy } or { x, y }

    const fmtVal = (v) => {
      const pre = b.unitPrefix || '';
      const suf = b.unitSuffix || '';
      const numStr = typeof v === 'number' ? (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : String(Math.round(v * 100) / 100)) : String(v ?? '');
      return `${pre}${numStr}${suf}`;
    };

    const getActiveFc = () => (syncViewport && viewportBounds && cachedFc ? filterFeaturesByBounds(cachedFc, viewportBounds) : cachedFc);

    const broadcastToMaps = (features, fly = true) => {
      (ctx.maps || []).forEach((m) => highlightMapFeatures(m, features || [], { fly }));
    };

    const clearSelection = () => {
      activeSelection = null;
      broadcastToMaps([], false);
      draw();
    };

    const selectEntity = (sel, fly = true) => {
      if (activeSelection && activeSelection.id === sel.id) {
        clearSelection();
        return;
      }
      activeSelection = sel;
      if (sel.features?.length) broadcastToMaps(sel.features, fly);
      draw();
    };

    const updateStatusStrip = (activeFc) => {
      const pills = [];
      if (b.layer) {
        pills.push(h('button', {
          type: 'button',
          class: `sm-chart-pill${syncViewport ? ' is-on' : ''}`,
          title: 'Recalculate chart/graph as you pan and zoom the map',
          onclick: () => {
            syncViewport = !syncViewport;
            if (syncViewport && !viewportBounds && ctx.maps?.[0]?.getBounds) {
              const mb = ctx.maps[0].getBounds();
              viewportBounds = [mb.getWest(), mb.getSouth(), mb.getEast(), mb.getNorth()];
            }
            draw();
          },
        }, syncViewport ? '✓ Synced to map view' : 'Sync with map view'));
      }
      if (syncViewport && cachedFc && activeFc) {
        pills.push(h('span', { class: 'sm-chart-pill is-info' }, `${activeFc.features.length} of ${cachedFc.features.length} features in view`));
      }
      if (activeSelection) {
        pills.push(h('button', {
          type: 'button',
          class: 'sm-chart-pill is-active',
          onclick: clearSelection,
        }, `Selected: ${activeSelection.label} ×`));
      } else if (b.layer) {
        pills.push(h('span', { class: 'sm-chart-hint' }, 'Tip: click any map feature or chart node to isolate & locate it'));
      }
      statusStrip.hidden = !pills.length;
      statusStrip.replaceChildren(...pills);
    };

    const drawSankey = (activeFc) => {
      const graph = computeFlowGraph(b, activeFc);
      if (!graph.links.length) {
        body.replaceChildren(h('div', { class: 'sm-empty-box' }, 'No flow connections yet — choose Source & Target fields or add flow rows'));
        return;
      }
      const W = 760;
      const H = Math.max(340, Math.min(540, graph.maxStageNodes * 52 + 60));
      const padX = 24;
      const padY = 28;
      const nodeW = 18;
      const stages = graph.stages;
      const numStages = Math.max(2, stages.length);
      const colSpan = (W - padX * 2 - nodeW) / (numStages - 1);

      // Position nodes within each stage column
      stages.forEach((stageNodes, sIdx) => {
        const x = padX + sIdx * colSpan;
        const availH = H - padY * 2 - Math.max(0, stageNodes.length - 1) * 12;
        const stageTotal = stageNodes.reduce((s, n) => s + Math.max(n.value, 0.001), 0) || 1;
        let yCursor = padY;
        stageNodes.forEach((n) => {
          n.x = x;
          n.w = nodeW;
          n.h = Math.max(14, (Math.max(n.value, 0.001) / stageTotal) * availH);
          const customY = nodeOffsets.get(`sankey:${n.id}`);
          n.y = customY != null ? Math.max(8, Math.min(H - n.h - 8, customY)) : yCursor;
          yCursor += n.h + 12;
        });
      });

      const computeRibbonPaths = () => {
        stages.forEach((st) => st.forEach((n) => { n._outY = n.y; n._inY = n.y; }));
        // Sort links by target y to minimize crossings
        const orderedLinks = [...graph.links].sort((a, c) => (a.sourceNode.y - c.sourceNode.y) || (a.targetNode.y - c.targetNode.y));
        orderedLinks.forEach((lk) => {
          const s = lk.sourceNode;
          const t = lk.targetNode;
          const sThick = Math.max(2, (lk.value / Math.max(s.value, 1e-6)) * s.h);
          const tThick = Math.max(2, (lk.value / Math.max(t.value, 1e-6)) * t.h);
          const thick = (sThick + tThick) / 2;
          const y0 = s._outY + sThick / 2;
          const y1 = t._inY + tThick / 2;
          s._outY += sThick;
          t._inY += tThick;
          const x0 = s.x + s.w;
          const x1 = t.x;
          const cx = (x0 + x1) / 2;
          lk._d = `M ${x0} ${y0} C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`;
          lk._thick = Math.max(2.5, thick);
        });
      };
      computeRibbonPaths();

      const isLinkLit = (lk) => {
        if (!activeSelection) return true;
        if (activeSelection.type === 'link') return activeSelection.id === lk.id;
        if (activeSelection.type === 'node') return lk.source === activeSelection.id || lk.target === activeSelection.id;
        return lk.sourceLabel === activeSelection.label || lk.targetLabel === activeSelection.label;
      };
      const isNodeLit = (n) => {
        if (!activeSelection) return true;
        if (activeSelection.type === 'node') {
          if (activeSelection.id === n.id) return true;
          return graph.links.some((lk) => (lk.source === activeSelection.id && lk.target === n.id) || (lk.target === activeSelection.id && lk.source === n.id));
        }
        if (activeSelection.type === 'link') return n.id === activeSelection.source || n.id === activeSelection.target;
        return n.label === activeSelection.label;
      };

      const linkEls = graph.links.map((lk) => {
        const lit = isLinkLit(lk);
        const pathEl = h('path', {
          class: `sm-sankey-link${lit ? '' : ' is-dim'}${activeSelection?.id === lk.id ? ' is-selected' : ''}`,
          d: lk._d,
          fill: 'none',
          stroke: lk.color,
          'stroke-width': String(lk._thick),
          'stroke-opacity': activeSelection ? (lit ? '0.78' : '0.1') : '0.52',
          onclick: (e) => {
            e.stopPropagation();
            selectEntity({ type: 'link', id: lk.id, label: `${lk.sourceLabel} → ${lk.targetLabel} (${fmtVal(lk.value)})`, source: lk.source, target: lk.target, features: lk.features });
          },
        }, h('title', {}, `${lk.sourceLabel} → ${lk.targetLabel}: ${fmtVal(lk.value)}`));
        lk._el = pathEl;
        return pathEl;
      });

      const svg = h('svg', { class: 'sm-sankey-svg', viewBox: `0 0 ${W} ${H}` });
      const nodeEls = graph.nodes.map((n) => {
        const lit = isNodeLit(n);
        const isRight = n.stage === numStages - 1 && numStages > 1;
        const rectEl = h('rect', { x: String(n.x), y: String(n.y), width: String(n.w), height: String(n.h), rx: '4', fill: n.color, class: 'sm-sankey-rect' });
        const labelEl = h('text', {
          x: String(isRight ? n.x - 8 : n.x + n.w + 8),
          y: String(n.y + n.h / 2),
          'text-anchor': isRight ? 'end' : 'start',
          'dominant-baseline': 'middle',
          class: 'sm-sankey-label',
        }, `${n.label} (${fmtVal(n.value)})`);
        const gEl = h('g', {
          class: `sm-sankey-node${lit ? '' : ' is-dim'}${activeSelection?.id === n.id ? ' is-selected' : ''}`,
          style: 'cursor:grab',
        }, rectEl, labelEl, h('title', {}, `${n.label}: ${fmtVal(n.value)} (drag to reorder, click to filter map)`));

        // Drag vertically to untangle ribbons, or click to select & filter map
        let moved = false;
        let startY = 0;
        let origY = 0;
        gEl.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          moved = false;
          startY = e.clientY;
          origY = n.y;
          gEl.setPointerCapture(e.pointerId);
          const onMove = (ev) => {
            const dy = ev.clientY - startY;
            if (Math.abs(dy) > 3) moved = true;
            if (!moved) return;
            const rect = svg.getBoundingClientRect();
            const scaleY = H / (rect.height || H);
            n.y = Math.max(8, Math.min(H - n.h - 8, origY + dy * scaleY));
            nodeOffsets.set(`sankey:${n.id}`, n.y);
            rectEl.setAttribute('y', String(n.y));
            labelEl.setAttribute('y', String(n.y + n.h / 2));
            computeRibbonPaths();
            graph.links.forEach((lk) => lk._el?.setAttribute('d', lk._d));
          };
          const onUp = () => {
            gEl.removeEventListener('pointermove', onMove);
            if (!moved) selectEntity({ type: 'node', id: n.id, label: n.label, features: n.features });
          };
          gEl.addEventListener('pointermove', onMove);
          gEl.addEventListener('pointerup', onUp, { once: true });
        });
        return gEl;
      });

      svg.append(h('g', { class: 'sm-sankey-links' }, linkEls), h('g', { class: 'sm-sankey-nodes' }, nodeEls));
      body.replaceChildren(h('div', { class: 'sm-sankey-wrap' }, svg));
    };

    const drawNetwork = (activeFc) => {
      const graph = computeFlowGraph(b, activeFc);
      if (!graph.nodes.length) {
        body.replaceChildren(h('div', { class: 'sm-empty-box' }, 'No network nodes yet — choose Source & Target fields or add flow rows'));
        return;
      }
      const W = 760;
      const H = 430;
      const hasGeo = graph.nodes.filter((n) => Array.isArray(n.lngLat)).length >= 2;
      const mode = hasGeo && networkMode === 'geo' ? 'geo' : 'force';

      // Position nodes via Geo-Pinned bounds or Force-Directed spring layout
      if (mode === 'geo') {
        const geoNodes = graph.nodes.filter((n) => Array.isArray(n.lngLat));
        const lngs = geoNodes.map((n) => n.lngLat[0]);
        const lats = geoNodes.map((n) => n.lngLat[1]);
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const dLng = Math.max(1e-4, maxLng - minLng);
        const dLat = Math.max(1e-4, maxLat - minLat);
        const pad = 64;
        graph.nodes.forEach((n, idx) => {
          if (Array.isArray(n.lngLat)) {
            n.x = pad + ((n.lngLat[0] - minLng) / dLng) * (W - pad * 2);
            n.y = H - pad - ((n.lngLat[1] - minLat) / dLat) * (H - pad * 2);
          } else {
            const angle = (2 * Math.PI * idx) / graph.nodes.length;
            n.x = W / 2 + Math.cos(angle) * 140;
            n.y = H / 2 + Math.sin(angle) * 110;
          }
        });
      } else {
        // Deterministic circular seed followed by 80 iterations of Fruchterman-Reingold spring-charge layout
        const N = graph.nodes.length;
        graph.nodes.forEach((n, idx) => {
          const angle = (2 * Math.PI * idx) / N - Math.PI / 2;
          const rad = N <= 1 ? 0 : Math.min(W, H) * 0.34;
          n.x = W / 2 + Math.cos(angle) * rad + (n.stage - 0.5) * 35;
          n.y = H / 2 + Math.sin(angle) * rad;
        });
        const k = Math.sqrt((W * H) / Math.max(1, N)) * 0.65;
        for (let iter = 0; iter < 75; iter++) {
          const temp = (1 - iter / 75) * 28;
          const disp = graph.nodes.map(() => [0, 0]);
          for (let i = 0; i < N; i++) {
            for (let j = i + 1; j < N; j++) {
              const dx = graph.nodes[i].x - graph.nodes[j].x || 0.01;
              const dy = graph.nodes[i].y - graph.nodes[j].y || 0.01;
              const dist = Math.hypot(dx, dy) || 0.01;
              const rep = (k * k) / dist;
              const fx = (dx / dist) * rep;
              const fy = (dy / dist) * rep;
              disp[i][0] += fx; disp[i][1] += fy;
              disp[j][0] -= fx; disp[j][1] -= fy;
            }
          }
          graph.links.forEach((lk) => {
            const u = graph.nodes.indexOf(lk.sourceNode);
            const v = graph.nodes.indexOf(lk.targetNode);
            if (u < 0 || v < 0 || u === v) return;
            const dx = graph.nodes[u].x - graph.nodes[v].x;
            const dy = graph.nodes[u].y - graph.nodes[v].y;
            const dist = Math.hypot(dx, dy) || 0.01;
            const att = (dist * dist) / k;
            const fx = (dx / dist) * att * 0.5;
            const fy = (dy / dist) * att * 0.5;
            disp[u][0] -= fx; disp[u][1] -= fy;
            disp[v][0] += fx; disp[v][1] += fy;
          });
          for (let i = 0; i < N; i++) {
            // Subtle gravity toward center
            disp[i][0] += (W / 2 - graph.nodes[i].x) * 0.08;
            disp[i][1] += (H / 2 - graph.nodes[i].y) * 0.1;
            const d = Math.hypot(disp[i][0], disp[i][1]) || 1;
            graph.nodes[i].x = Math.max(54, Math.min(W - 54, graph.nodes[i].x + (disp[i][0] / d) * Math.min(d, temp)));
            graph.nodes[i].y = Math.max(40, Math.min(H - 40, graph.nodes[i].y + (disp[i][1] / d) * Math.min(d, temp)));
          }
        }
      }

      // Apply user-dragged node positions if any
      graph.nodes.forEach((n) => {
        const saved = nodeOffsets.get(`net:${mode}:${n.id}`);
        if (saved) { n.x = saved.x; n.y = saved.y; }
      });

      const maxNodeVal = Math.max(...graph.nodes.map((n) => n.value), 1);
      const maxLinkVal = Math.max(...graph.links.map((l) => l.value), 1);
      graph.nodes.forEach((n) => {
        n.r = 9 + Math.sqrt(Math.max(0, n.value) / maxNodeVal) * 18;
      });

      const edgePath = (lk) => {
        const s = lk.sourceNode, t = lk.targetNode;
        const dx = t.x - s.x, dy = t.y - s.y;
        const dist = Math.hypot(dx, dy) || 1;
        const nx = -dy / dist, ny = dx / dist;
        const curve = Math.min(34, dist * 0.16);
        const cx = (s.x + t.x) / 2 + nx * curve;
        const cy = (s.y + t.y) / 2 + ny * curve;
        return `M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`;
      };

      const isLinkLit = (lk) => {
        if (!activeSelection) return true;
        if (activeSelection.type === 'link') return activeSelection.id === lk.id;
        if (activeSelection.type === 'node') return lk.source === activeSelection.id || lk.target === activeSelection.id;
        return lk.sourceLabel === activeSelection.label || lk.targetLabel === activeSelection.label;
      };
      const isNodeLit = (n) => {
        if (!activeSelection) return true;
        if (activeSelection.type === 'node') {
          if (activeSelection.id === n.id) return true;
          return graph.links.some((lk) => (lk.source === activeSelection.id && lk.target === n.id) || (lk.target === activeSelection.id && lk.source === n.id));
        }
        if (activeSelection.type === 'link') return n.id === activeSelection.source || n.id === activeSelection.target;
        return n.label === activeSelection.label;
      };

      const svg = h('svg', { class: 'sm-network-svg', viewBox: `0 0 ${W} ${H}` });
      const edgeEls = graph.links.map((lk) => {
        const lit = isLinkLit(lk);
        const w = 1.5 + (lk.value / maxLinkVal) * 6.5;
        const pEl = h('path', {
          class: `sm-net-edge${lit ? '' : ' is-dim'}${activeSelection?.id === lk.id ? ' is-selected' : ''}`,
          d: edgePath(lk),
          fill: 'none',
          stroke: lk.color,
          'stroke-width': String(w),
          'stroke-opacity': activeSelection ? (lit ? '0.85' : '0.1') : '0.55',
          'stroke-linecap': 'round',
          onclick: (e) => {
            e.stopPropagation();
            selectEntity({ type: 'link', id: lk.id, label: `${lk.sourceLabel} → ${lk.targetLabel} (${fmtVal(lk.value)})`, source: lk.source, target: lk.target, features: lk.features });
          },
        }, h('title', {}, `${lk.sourceLabel} → ${lk.targetLabel}: ${fmtVal(lk.value)}`));
        lk._el = pEl;
        return pEl;
      });

      const nodeEls = graph.nodes.map((n) => {
        const lit = isNodeLit(n);
        const circleEl = h('circle', {
          cx: String(n.x), cy: String(n.y), r: String(n.r),
          fill: n.color, stroke: 'var(--card)', 'stroke-width': '2.5',
          class: 'sm-net-circle',
        });
        const textEl = h('text', {
          x: String(n.x), y: String(n.y - n.r - 6),
          'text-anchor': 'middle', class: 'sm-net-label',
        }, n.label);
        const gEl = h('g', {
          class: `sm-net-node${lit ? '' : ' is-dim'}${activeSelection?.id === n.id ? ' is-selected' : ''}`,
          style: 'cursor:grab',
        }, circleEl, textEl, h('title', {}, `${n.label}: ${fmtVal(n.value)} · ${n.degree} connection${n.degree === 1 ? '' : 's'} (drag to move, click to isolate on map)`));

        let moved = false;
        let startX = 0, startY = 0, origX = 0, origY = 0;
        gEl.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          moved = false;
          startX = e.clientX; startY = e.clientY;
          origX = n.x; origY = n.y;
          gEl.setPointerCapture(e.pointerId);
          const onMove = (ev) => {
            const dx = ev.clientX - startX, dy = ev.clientY - startY;
            if (Math.hypot(dx, dy) > 3) moved = true;
            if (!moved) return;
            const rect = svg.getBoundingClientRect();
            n.x = Math.max(28, Math.min(W - 28, origX + dx * (W / (rect.width || W))));
            n.y = Math.max(28, Math.min(H - 28, origY + dy * (H / (rect.height || H))));
            nodeOffsets.set(`net:${mode}:${n.id}`, { x: n.x, y: n.y });
            circleEl.setAttribute('cx', String(n.x));
            circleEl.setAttribute('cy', String(n.y));
            textEl.setAttribute('x', String(n.x));
            textEl.setAttribute('y', String(n.y - n.r - 6));
            graph.links.forEach((lk) => {
              if (lk.sourceNode === n || lk.targetNode === n) lk._el?.setAttribute('d', edgePath(lk));
            });
          };
          const onUp = () => {
            gEl.removeEventListener('pointermove', onMove);
            if (!moved) selectEntity({ type: 'node', id: n.id, label: n.label, features: n.features });
          };
          gEl.addEventListener('pointermove', onMove);
          gEl.addEventListener('pointerup', onUp, { once: true });
        });
        return gEl;
      });

      svg.append(h('g', { class: 'sm-net-edges' }, edgeEls), h('g', { class: 'sm-net-nodes' }, nodeEls));

      const netToolbar = h('div', { class: 'sm-net-bar' },
        hasGeo ? h('div', { class: 'sm-chart-switch' },
          [['force', 'Force-directed'], ['geo', 'Geo-pinned']].map(([k, lbl]) =>
            h('button', { type: 'button', class: mode === k ? 'is-on' : '', onclick: () => { networkMode = k; draw(); } }, lbl))) : null,
        h('span', { class: 'sm-chart-hint' }, `${graph.nodes.length} nodes · ${graph.links.length} flows · drag nodes to rearrange`),
        nodeOffsets.size ? h('button', { type: 'button', class: 'sm-chart-pill', onclick: () => { nodeOffsets.clear(); draw(); } }, 'Reset positions') : null,
      );

      body.replaceChildren(h('div', { class: 'sm-network-wrap' }, netToolbar, svg));
    };

    const draw = () => {
      const activeFc = getActiveFc();
      updateStatusStrip(activeFc);
      if (activeView === 'sankey') { drawSankey(activeFc); return; }
      if (activeView === 'network') { drawNetwork(activeFc); return; }

      const { series, total, max } = computeChartSeries(b, activeFc);
      if (!series.length) {
        body.replaceChildren(h('div', { class: 'sm-empty-box' }, 'No chart data yet — add items or connect a data layer'));
        return;
      }
      if (activeView === 'bar') {
        body.replaceChildren(h('div', { class: 'sm-chart-bars' }, series.map((it) => {
          const pct = Math.max(2, Math.round((Math.abs(it.value) / max) * 100));
          const share = total > 0 ? `${Math.round((Math.abs(it.value) / total) * 100)}%` : '';
          const dim = activeSelection && activeSelection.label !== it.label;
          return h('div', {
            class: `sm-bar-row${dim ? ' is-dim' : ''}`,
            style: 'cursor:pointer',
            onclick: () => selectEntity({ type: 'category', id: `cat:${it.label}`, label: it.label, features: it.features }),
          },
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
          const dim = activeSelection && activeSelection.label !== it.label;
          return h('div', {
            class: `sm-col-item${dim ? ' is-dim' : ''}`,
            style: 'cursor:pointer',
            onclick: () => selectEntity({ type: 'category', id: `cat:${it.label}`, label: it.label, features: it.features }),
          },
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
            style: 'cursor:pointer',
            onclick: () => selectEntity({ type: 'category', id: `cat:${it.label}`, label: it.label, features: it.features }),
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
          const dim = activeSelection && activeSelection.label !== it.label;
          return h('div', {
            class: `sm-donut-item${dim ? ' is-dim' : ''}`,
            style: 'cursor:pointer',
            onclick: () => selectEntity({ type: 'category', id: `cat:${it.label}`, label: it.label, features: it.features }),
          },
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
            const dim = activeSelection && activeSelection.label !== it.label;
            return h('tr', {
              class: dim ? 'is-dim' : '',
              style: 'cursor:pointer',
              onclick: () => selectEntity({ type: 'category', id: `cat:${it.label}`, label: it.label, features: it.features }),
            },
              h('td', { class: 'sm-td-rank' }, String(idx + 1)),
              h('td', {}, h('strong', {}, it.label), it.note ? h('div', { class: 'sm-bar-note' }, it.note) : null),
              h('td', { style: 'text-align:right;font-variant-numeric:tabular-nums' }, fmtVal(it.value)),
              h('td', {}, h('div', { class: 'sm-td-share' },
                h('div', { class: 'sm-td-bar', style: `width:${pct}%;background:${it.color}` }),
                h('span', {}, share))));
          })))));
    };

    const switcher = h('div', { class: 'sm-chart-switch', role: 'group', 'aria-label': 'View mode' },
      [['bar', 'Bars'], ['column', 'Columns'], ['donut', 'Donut'], ['sankey', 'Sankey'], ['network', 'Network'], ['table', 'Table']].map(([k, lbl]) =>
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

    wrap.append(headEl, statusStrip, body, caption(b.caption));

    // Listen to map feature clicks & map viewport moves for bi-directional manipulation
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const onMapClick = (ev) => {
        const d = ev.detail || {};
        if (!d.properties) {
          if (activeSelection) { activeSelection = null; draw(); }
          return;
        }
        if (b.layer && d.layerId && d.layerId !== b.layer) return;
        const p = d.properties;
        const candidateKeys = [b.groupField, b.sourceField, b.targetField, b.midField, 'origin_name', 'hub_name', 'name', 'title', 'category', 'cluster_id'].filter(Boolean);
        let matchedVal = null;
        for (const k of candidateKeys) {
          if (p[k] != null && p[k] !== '') { matchedVal = String(p[k]); break; }
        }
        if (!matchedVal) return;
        const graph = computeFlowGraph(b, getActiveFc());
        const hitNode = graph.nodes.find((n) => n.label === matchedVal);
        if (hitNode) {
          activeSelection = { type: 'node', id: hitNode.id, label: hitNode.label, features: hitNode.features };
        } else {
          activeSelection = { type: 'category', id: `cat:${matchedVal}`, label: matchedVal, features: d.feature ? [d.feature] : [] };
        }
        draw();
      };
      const onMapMove = (ev) => {
        if (!syncViewport) return;
        viewportBounds = ev.detail?.bounds || null;
        draw();
      };
      window.addEventListener('wm:map-feature-click', onMapClick);
      window.addEventListener('wm:map-moveend', onMapMove);
      ctx.cleanups.push(() => {
        window.removeEventListener('wm:map-feature-click', onMapClick);
        window.removeEventListener('wm:map-moveend', onMapMove);
      });
    }

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

function featureCenter(f) {
  const g = f?.geometry;
  if (!g || !g.coordinates) return null;
  if (g.type === 'Point') return [g.coordinates[0], g.coordinates[1]];
  const pts = [];
  const walk = (c) => (typeof c?.[0] === 'number' ? pts.push(c) : Array.isArray(c) && c.forEach(walk));
  walk(g.coordinates);
  if (!pts.length) return null;
  return [pts.reduce((s, c) => s + c[0], 0) / pts.length, pts.reduce((s, c) => s + c[1], 0) / pts.length];
}

export function filterFeaturesByBounds(fc, bounds) {
  if (!fc || !Array.isArray(fc.features) || !Array.isArray(bounds) || bounds.length < 4) return fc;
  const [west, south, east, north] = bounds;
  return {
    type: 'FeatureCollection',
    ...(fc.metadata ? { metadata: fc.metadata } : {}),
    features: fc.features.filter((f) => {
      const c = featureCenter(f);
      return c && c[0] >= west && c[0] <= east && c[1] >= south && c[1] <= north;
    }),
  };
}

export function computeChartSeries(b, fc) {
  let series = [];
  if (fc && Array.isArray(fc.features) && fc.features.length) {
    const gf = b.groupField || b.sourceField || '';
    const vf = b.valueField || '';
    const stat = b.stat || (vf ? 'sum' : 'count');
    const groups = new Map();
    fc.features.forEach((f, idx) => {
      const p = f.properties || {};
      const key = gf ? String(p[gf] ?? 'Unspecified') : String(p.name || p.title || `#${idx + 1}`);
      if (!groups.has(key)) groups.set(key, { rows: [], features: [] });
      const entry = groups.get(key);
      entry.rows.push(p);
      entry.features.push(f);
    });
    for (const [label, { rows, features }] of groups.entries()) {
      let val = rows.length;
      if (stat !== 'count' && vf) {
        const nums = rows.map((r) => Number(String(r[vf] ?? '').replace(/[,$%\s]/g, ''))).filter((n) => Number.isFinite(n));
        if (!nums.length) val = 0;
        else if (stat === 'sum') val = nums.reduce((a, c) => a + c, 0);
        else if (stat === 'avg') val = nums.reduce((a, c) => a + c, 0) / nums.length;
        else if (stat === 'min') val = Math.min(...nums);
        else if (stat === 'max') val = Math.max(...nums);
      }
      series.push({ label, value: Math.round(val * 100) / 100, count: rows.length, features });
    }
    series.sort((a, c) => c.value - a.value);
    const lim = Math.max(1, +(b.limit || (b.chartType === 'table' ? 15 : 8)));
    series = series.slice(0, lim).map((it, idx) => ({ ...it, color: PALETTE[idx % PALETTE.length] }));
  } else if (Array.isArray(b.items)) {
    series = b.items.map((it, idx) => {
      const n = Number(String(it.value ?? 0).replace(/[,$%\s]/g, ''));
      return {
        label: String(it.label || `Item ${idx + 1}`),
        target: it.target ? String(it.target) : '',
        value: Number.isFinite(n) ? n : 0,
        color: COLOR.test(it.color || '') ? it.color : PALETTE[idx % PALETTE.length],
        note: it.note || '',
        features: [],
      };
    });
  }
  const total = series.reduce((s, it) => s + (it.value > 0 ? it.value : 0), 0);
  const max = series.length ? Math.max(...series.map((it) => Math.abs(it.value)), 1) : 1;
  return { series, total, max };
}

/**
 * Builds a multi-stage flow / network graph { nodes, links, stages, maxStageNodes }
 * from either a GeoJSON FeatureCollection or manual b.items rows.
 */
export function computeFlowGraph(b, fc) {
  const nodesMap = new Map(); // id -> node
  const linksMap = new Map(); // id -> link
  const lim = Math.max(2, +(b.limit || 18));

  const getNode = (stage, label, colorHint) => {
    const clean = String(label || 'Unspecified').trim() || 'Unspecified';
    const id = `s${stage}:${clean}`;
    if (!nodesMap.has(id)) {
      const idx = nodesMap.size;
      nodesMap.set(id, {
        id,
        label: clean,
        stage,
        value: 0,
        inValue: 0,
        outValue: 0,
        degree: 0,
        color: colorHint || PALETTE[idx % PALETTE.length],
        coords: [],
        features: [],
        lngLat: null,
      });
    }
    return nodesMap.get(id);
  };

  const addFlow = (sStage, sLabel, tStage, tLabel, weight, feat, colorHint) => {
    const val = Number.isFinite(weight) && weight > 0 ? weight : 0;
    if (val <= 0) return;
    const sn = getNode(sStage, sLabel, colorHint);
    const tn = getNode(tStage, tLabel);
    if (sn.id === tn.id) return;
    if (feat) {
      sn.features.push(feat);
      tn.features.push(feat);
      const g = feat.geometry;
      if (g?.type === 'LineString' && g.coordinates?.length >= 2) {
        sn.coords.push(g.coordinates[0]);
        tn.coords.push(g.coordinates[g.coordinates.length - 1]);
      } else {
        const c = featureCenter(feat);
        if (c) { sn.coords.push(c); tn.coords.push(c); }
      }
    }
    const lid = `${sn.id}->${tn.id}`;
    if (!linksMap.has(lid)) {
      linksMap.set(lid, {
        id: lid,
        source: sn.id,
        target: tn.id,
        sourceLabel: sn.label,
        targetLabel: tn.label,
        sourceNode: sn,
        targetNode: tn,
        value: 0,
        color: sn.color,
        features: [],
      });
    }
    const lk = linksMap.get(lid);
    lk.value = Math.round((lk.value + val) * 100) / 100;
    if (feat) lk.features.push(feat);
  };

  if (fc && Array.isArray(fc.features) && fc.features.length) {
    const sampleProps = fc.features[0]?.properties || {};
    const keys = Object.keys(sampleProps);
    const sf = b.sourceField || b.groupField || keys.find((k) => /^(origin_name|source|origin|from|region|state|category|cluster_id)$/i.test(k)) || keys[0] || '';
    const tf = b.targetField || keys.find((k) => k !== sf && /^(hub_name|target|destination|to|type|status|subregion|county)$/i.test(k)) || keys.find((k) => k !== sf && typeof sampleProps[k] === 'string') || '';
    const mf = b.midField && b.midField !== sf && b.midField !== tf ? b.midField : '';
    const vf = b.valueField || '';
    const stat = b.stat || (vf ? 'sum' : 'count');

    const measure = (f) => {
      if (stat === 'count' || !vf) return 1;
      const n = Number(String(f.properties?.[vf] ?? '').replace(/[,$%\s]/g, ''));
      return Number.isFinite(n) && n > 0 ? n : 0;
    };

    fc.features.forEach((f, idx) => {
      const p = f.properties || {};
      const sVal = sf ? String(p[sf] ?? 'Unspecified') : String(p.name || p.title || `Node ${idx + 1}`);
      const tVal = tf ? String(p[tf] ?? 'Destination') : 'Total Flow';
      const w = measure(f);
      if (mf && p[mf] != null && p[mf] !== '') {
        const mVal = String(p[mf]);
        addFlow(0, sVal, 1, mVal, w, f);
        addFlow(1, mVal, 2, tVal, w, f);
      } else {
        addFlow(0, sVal, 1, tVal, w, f);
      }
    });
  } else if (Array.isArray(b.items) && b.items.length) {
    b.items.forEach((it, idx) => {
      const val = Number(String(it.value ?? 0).replace(/[,$%\s]/g, ''));
      const sLabel = String(it.label || `Source ${idx + 1}`);
      const tLabel = String(it.target || (idx % 2 === 0 ? 'Core Hub' : 'Regional Hub'));
      const cHint = COLOR.test(it.color || '') ? it.color : PALETTE[idx % PALETTE.length];
      if (it.mid) {
        addFlow(0, sLabel, 1, String(it.mid), val, null, cHint);
        addFlow(1, String(it.mid), 2, tLabel, val, null, cHint);
      } else {
        addFlow(0, sLabel, 1, tLabel, val, null, cHint);
      }
    });
  }

  // Keep top links by value to stay crisp
  const allLinks = [...linksMap.values()].sort((a, c) => c.value - a.value).slice(0, lim * 2);
  const activeNodeIds = new Set();
  allLinks.forEach((lk) => { activeNodeIds.add(lk.source); activeNodeIds.add(lk.target); });

  const nodes = [...nodesMap.values()].filter((n) => activeNodeIds.has(n.id));
  nodes.forEach((n) => { n.inValue = 0; n.outValue = 0; n.degree = 0; });
  allLinks.forEach((lk) => {
    lk.sourceNode.outValue += lk.value;
    lk.targetNode.inValue += lk.value;
    lk.sourceNode.degree++;
    lk.targetNode.degree++;
  });
  nodes.forEach((n) => {
    n.value = Math.round(Math.max(n.inValue, n.outValue, 1) * 100) / 100;
    if (n.coords.length) {
      n.lngLat = [
        n.coords.reduce((s, c) => s + c[0], 0) / n.coords.length,
        n.coords.reduce((s, c) => s + c[1], 0) / n.coords.length,
      ];
    }
  });

  const maxStage = nodes.reduce((m, n) => Math.max(m, n.stage), 1);
  const stages = Array.from({ length: maxStage + 1 }, (_, s) =>
    nodes.filter((n) => n.stage === s).sort((a, c) => c.value - a.value));
  const maxStageNodes = Math.max(1, ...stages.map((st) => st.length));

  return { nodes, links: allLinks, stages, maxStageNodes };
}

export const BLOCK_TYPES = Object.keys(BLOCKS);
