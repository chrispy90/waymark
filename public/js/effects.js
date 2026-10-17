// Scroll-driven effects. One passive scroll listener + rAF; only on-screen elements are updated.
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));

const visible = new Set();
let frame = 0;
const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => {
  for (const e of entries) e.isIntersecting ? visible.add(e.target._fx) : visible.delete(e.target._fx);
  schedule();
}, { rootMargin: '25% 0px' }) : null;

function tick() {
  frame = 0;
  const vh = innerHeight;
  for (const item of visible) item.fn(item.el.getBoundingClientRect(), vh);
}
function schedule() { if (!frame) frame = requestAnimationFrame(tick); }
if (typeof addEventListener === 'function') {
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
}

/** Calls fn(rect, viewportHeight) on every frame the element is near the viewport. Returns an untrack function. */
export function track(el, fn) {
  const item = { el, fn };
  el._fx = item;
  io?.observe(el);
  schedule();
  return () => { io.unobserve(el); visible.delete(item); };
}

/** 0 when the element's top meets the bottom of the viewport, 1 when its bottom leaves the top. */
export const viewProgress = (r, vh) => clamp((vh - r.top) / (r.height + vh));
/** For tall "pinned" sections with a sticky child: 0 when pinning starts, 1 when it ends. */
export const pinProgress = (r, vh) => clamp(-r.top / Math.max(1, r.height - vh));
/** How far the element has scrolled up past the top of the viewport, relative to its height. */
export const exitProgress = (r) => clamp(-r.top / Math.max(1, r.height));

/** Adds .is-in once the element scrolls into view (CSS handles the animation). */
export function reveal(el, { instant = false } = {}) {
  el.classList.add('fx-reveal');
  if (instant || reducedMotion()) { el.classList.add('is-in'); return () => {}; }
  const obs = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { el.classList.add('is-in'); obs.disconnect(); }
  }, { rootMargin: '0px 0px -12% 0px' });
  obs.observe(el);
  return () => obs.disconnect();
}

/** Animates a number from 0 to its value (keeps prefix/suffix, decimals and thousands separators). */
export function countUp(el, raw, { duration = 1600 } = {}) {
  const m = /^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/.exec(String(raw).trim());
  if (!m) { el.textContent = raw; return () => {}; }
  const [, pre, num, post] = m;
  const target = parseFloat(num.replace(/,/g, ''));
  const decimals = (num.split('.')[1] || '').length;
  const commas = num.includes(',');
  const fmt = (v) => pre + (commas ? v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals)) + post;
  if (reducedMotion()) { el.textContent = fmt(target); return () => {}; }
  el.textContent = fmt(0);
  let raf = 0;
  const obs = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    obs.disconnect();
    const t0 = performance.now();
    const step = (t) => {
      const p = clamp((t - t0) / duration);
      el.textContent = fmt(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }, { rootMargin: '0px 0px -15% 0px' });
  obs.observe(el);
  return () => { obs.disconnect(); cancelAnimationFrame(raf); };
}
