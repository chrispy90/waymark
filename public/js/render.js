// Story renderer. Takes a story JSON document (see docs/SCHEMA.md) and builds the reading experience.
import { createMap, applyView, DEFAULT_VIEW } from './maps.js';
import { sanitize, safeUrl } from './sanitize.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = sanitize(v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
};

/** Renders `story` into `root`. Returns a destroy() function. */
export function renderStory(story, root) {
  const ctx = { maps: [], observers: [], library: story.layers || [] };
  root.innerHTML = '';
  root.className = 'sm-story';
  document.documentElement.dataset.theme = story.theme === 'dark' ? 'dark' : 'light';
  document.title = story.title || 'Untitled story';

  root.append(renderHeader(story), renderCover(story));
  const body = h('main', { class: 'sm-body' });
  (story.blocks || []).forEach((block, i) => {
    const r = BLOCKS[block.type];
    if (!r) return;
    const el = r(block, ctx);
    el.dataset.blockIndex = i;
    body.append(el);
  });
  body.append(h('footer', { class: 'sm-credits' },
    story.credits ? h('div', { html: story.credits }) : null,
    h('p', { class: 'sm-muted' }, 'Built with StoryMaps')));
  root.append(body);

  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    root.style.setProperty('--progress', max > 0 ? scrollY / max : 0);
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  return () => {
    removeEventListener('scroll', onScroll);
    ctx.observers.forEach((o) => o.disconnect());
    ctx.maps.forEach((m) => m.remove());
    root.innerHTML = '';
  };
}

function renderHeader(story) {
  return h('header', { class: 'sm-topbar' },
    h('span', { class: 'sm-topbar-title' }, story.title || ''),
    h('div', { class: 'sm-progress', 'aria-hidden': 'true' }));
}

function renderCover(story) {
  const c = story.cover || {};
  const img = safeUrl(c.image);
  return h('section', { class: `sm-cover ${img ? 'has-image' : ''}`, style: img ? `--cover:url("${img}")` : null },
    h('div', { class: 'sm-cover-inner' },
      h('h1', {}, story.title || 'Untitled story'),
      story.subtitle ? h('p', { class: 'sm-subtitle' }, story.subtitle) : null,
      h('p', { class: 'sm-byline' }, [story.author, story.date].filter(Boolean).join(' · '))),
    h('div', { class: 'sm-scroll-cue', 'aria-hidden': 'true' }, '↓'));
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

  image: (b) => h('figure', { class: `sm-figure size-${b.size || 'wide'}` },
    mediaElement({ ...b, type: 'image' }), caption(b.caption)),

  video: (b) => h('figure', { class: `sm-figure size-${b.size || 'wide'} sm-ratio` },
    mediaElement({ ...b, type: 'video' }), caption(b.caption)),

  embed: (b) => h('figure', { class: `sm-figure size-${b.size || 'wide'} sm-ratio` },
    mediaElement({ ...b, type: 'embed' }), caption(b.caption)),

  map: (b, ctx) => {
    const el = h('div', { class: 'sm-map', role: 'region', 'aria-label': b.alt || 'Map' });
    lazyMap(ctx, el, b.view, {});
    return h('figure', { class: `sm-figure size-${b.size || 'full'} sm-map-figure` }, el, caption(b.caption));
  },

  // Scroll-driven "sidecar": a sticky media panel that changes as narrative slides scroll past.
  sidecar: (b, ctx) => {
    const slides = b.slides || [];
    const mapEl = h('div', { class: 'sm-map' });
    const stage = h('div', { class: 'sm-stage' });
    const mediaPane = h('div', { class: 'sm-sidecar-media' }, mapEl, stage);
    const slideEls = slides.map((s, i) =>
      h('div', { class: 'sm-slide', 'data-i': i },
        h('div', { class: 'sm-slide-card', html: s.html, onclick: (e) => runAction(e, i) })));
    const section = h('section', { class: `sm-sidecar layout-${b.layout || 'docked'}` },
      mediaPane, h('div', { class: 'sm-sidecar-slides' }, slideEls));

    const firstMap = slides.find((s) => (s.media?.type || 'map') === 'map');
    let map = null;
    let active = -1;
    let pending = null;

    const showView = (v, animate = true) => {
      if (map) applyView(map, v, { animate });
      else pending = v;
    };

    // Map actions: links of the form #action:<id> swap the slide's map view until clicked again.
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

  // Guided tour: numbered places on a map, with a panel to step through them.
  tour: (b, ctx) => {
    const places = b.places || [];
    let i = 0;
    let map = null;
    const panel = h('div', { class: 'sm-tour-panel', 'aria-live': 'polite' });
    const mapEl = h('div', { class: 'sm-map' });
    const markers = places.map((p, n) => ({ lngLat: p.lngLat, label: String(n + 1) }));

    const show = (n, animate = true) => {
      i = (n + places.length) % places.length;
      const p = places[i];
      panel.replaceChildren(
        p.image ? h('img', { src: safeUrl(p.image), alt: p.alt || p.title || '', loading: 'lazy' }) : null,
        h('div', { class: 'sm-tour-body' },
          h('p', { class: 'sm-tour-count' }, `${i + 1} / ${places.length}`),
          h('h3', {}, p.title || ''),
          h('div', { html: p.html || '' }),
          h('div', { class: 'sm-tour-nav' },
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
    return h('section', { class: 'sm-tour size-full' }, h('div', { class: 'sm-tour-grid' }, panel, mapEl), caption(b.caption));
  },

  // Swipe: compare two basemaps / views with a draggable divider.
  swipe: (b, ctx) => {
    const leftEl = h('div', { class: 'sm-map' });
    const rightEl = h('div', { class: 'sm-map sm-swipe-top' });
    const handle = h('div', { class: 'sm-swipe-handle', role: 'slider', tabindex: 0, 'aria-label': 'Swipe position', 'aria-valuemin': 0, 'aria-valuemax': 100 });
    const wrap = h('div', { class: 'sm-swipe' }, leftEl, rightEl, handle,
      h('span', { class: 'sm-swipe-label left' }, b.leftLabel || ''),
      h('span', { class: 'sm-swipe-label right' }, b.rightLabel || ''));
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
      const a = createMap(leftEl, { ...view, basemap: b.left || 'streets', layers: b.leftLayers || [] }, { library: ctx.library });
      const c = createMap(rightEl, { ...view, basemap: b.right || 'dark', layers: b.rightLayers || [], legend: false }, { interactive: false, library: ctx.library });
      ctx.maps.push(a, c);
      a.on('move', () => c.jumpTo({ center: a.getCenter(), zoom: a.getZoom(), bearing: a.getBearing(), pitch: a.getPitch() }));
    }, { rootMargin: '200px' });
    io.observe(wrap);
    ctx.observers.push(io);
    return h('figure', { class: 'sm-figure size-full' }, wrap, caption(b.caption));
  },
};

export const BLOCK_TYPES = Object.keys(BLOCKS);
