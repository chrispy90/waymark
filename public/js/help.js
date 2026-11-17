// The help center (/help and /help/<page>). Pages are Markdown files in /help/, so the same guide reads on GitHub.
import { render, plainText } from './markdown.js';
import { h, icon, logo, fill, setTitle, BRAND } from './ui.js';

/** The guide's table of contents. Each page is /help/<slug>.md. */
export const GUIDE = [
  { title: 'Get started', pages: [['index', 'Welcome'], ['get-started', 'Quick start'], ['concepts', 'Key ideas and terms']] },
  { title: 'Stories', pages: [['stories', 'The story editor'], ['blocks', 'Blocks reference'], ['story-maps', 'Maps in stories'], ['publish', 'Publish and update']] },
  { title: 'Maps and data', pages: [['map-editor', 'The map editor'], ['add-data', 'Add data'], ['layer-settings', 'Style and configure layers'], ['hosted-layers', 'Hosted layers'], ['draw-measure', 'Draw and measure']] },
  { title: 'Analysis', pages: [['analysis', 'Analysis overview'], ['analysis-tools', 'Analysis tool reference']] },
  { title: 'Share and collaborate', pages: [['sharing', 'Sharing and teams'], ['dashboards', 'Dashboards'], ['scenarios', 'Scenarios'], ['scenario-rules', 'Terrain, supply and combat'], ['scenario-run', 'Running and reviewing a game'], ['forms', 'Forms'], ['export', 'Export and print']] },
  { title: 'Reference', pages: [['formats', 'Data formats and limits'], ['shortcuts', 'Keyboard shortcuts'], ['troubleshooting', 'Troubleshooting and FAQ'], ['admin', 'For administrators']] },
];
const PAGES = GUIDE.flatMap((s) => s.pages.map(([slug, title]) => ({ slug, title, section: s.title })));
const bySlug = new Map(PAGES.map((p) => [p.slug, p]));

const root = document.getElementById('page');
const cache = new Map();
const load = (slug) => {
  if (!cache.has(slug)) cache.set(slug, fetch(`/help/${slug}.md`).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))));
  return cache.get(slug);
};
const slugFromPath = () => /^\/help\/([\w-]+)\/?$/.exec(location.pathname)?.[1] || 'index';
// Links between pages are written as page.md#anchor (so they work on GitHub); here they become /help/page#anchor.
const linkOf = (href) => {
  const m = /^([\w-]+)\.md(#[\w-]+)?$/.exec(href);
  if (m) return `/help/${m[1] === 'index' ? '' : m[1]}${m[2] || ''}`.replace(/\/(#|$)/, '$1') || '/help';
  if (/^#/.test(href)) return href;
  return href;
};
const imageOf = (src) => (/^(https?:)?\//.test(src) ? src : `/help/${src}`);

/* ---------- layout ---------- */

const nav = h('nav', { class: 'hp-nav', 'aria-label': 'Help topics' });
const article = h('article', { class: 'hp-article' });
const toc = h('aside', { class: 'hp-toc', 'aria-label': 'On this page' });
const search = h('input', { type: 'search', class: 'hp-search-input', placeholder: 'Search the help', 'aria-label': 'Search the help', autocomplete: 'off' });
const results = h('div', { class: 'hp-results', hidden: true, role: 'listbox' });
const menuBtn = h('button', { type: 'button', class: 'icon-btn hp-menu', 'aria-label': 'Topics', onclick: () => document.body.classList.toggle('hp-nav-open') }, icon('list'));

fill(root,
  h('header', { class: 'hp-top' },
    menuBtn,
    h('a', { href: '/help', class: 'hp-brand', 'data-route': '' }, logo({ size: 26, withName: false }), h('span', {}, `${BRAND.name} Help`)),
    h('div', { class: 'hp-search' }, icon('search', { size: 16 }), search, results),
    h('a', { href: '/', class: 'btn hp-back' }, `Open ${BRAND.name}`)),
  h('div', { class: 'hp-body' }, nav, h('main', { class: 'hp-main' }, article), toc));

function drawNav(current) {
  fill(nav, GUIDE.map((s) => h('div', { class: 'hp-nav-group' },
    h('p', { class: 'hp-nav-title' }, s.title),
    h('ul', {}, s.pages.map(([slug, title]) => h('li', {}, h('a', { href: slug === 'index' ? '/help' : `/help/${slug}`, class: slug === current ? 'is-on' : '', 'aria-current': slug === current ? 'page' : null, 'data-route': '' }, title)))))));
}

async function show(slug, { hash = location.hash, push = false } = {}) {
  const page = bySlug.get(slug) || bySlug.get('index');
  if (push) history.pushState(null, '', `${page.slug === 'index' ? '/help' : `/help/${page.slug}`}${hash || ''}`);
  document.body.classList.remove('hp-nav-open');
  drawNav(page.slug);
  let md;
  try { md = await load(page.slug); } catch {
    fill(article, h('h1', {}, 'This page could not be loaded'), h('p', {}, 'Check your connection and try again.'));
    return;
  }
  const { html, headings } = render(md, { link: linkOf, image: imageOf });
  article.innerHTML = html; // our own Markdown, with all text escaped by the renderer
  const title = headings.find((x) => x.level === 1)?.text || page.title;
  setTitle(page.slug === 'index' ? 'Help' : `${title} · Help`);
  const at = PAGES.indexOf(page);
  const prev = PAGES[at - 1];
  const next = PAGES[at + 1];
  article.append(h('nav', { class: 'hp-pager', 'aria-label': 'Previous and next page' },
    prev ? h('a', { href: prev.slug === 'index' ? '/help' : `/help/${prev.slug}`, class: 'hp-prev', 'data-route': '' }, h('span', {}, 'Previous'), prev.title) : h('span'),
    next ? h('a', { href: `/help/${next.slug}`, class: 'hp-next', 'data-route': '' }, h('span', {}, 'Next'), next.title) : h('span')));
  const subs = headings.filter((x) => x.level === 2 || x.level === 3);
  fill(toc, subs.length > 2 ? [h('p', { class: 'hp-nav-title' }, 'On this page'), h('ul', {}, subs.map((x) => h('li', { class: `is-h${x.level}` }, h('a', { href: `#${x.id}` }, x.text))))] : null);
  const target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
  if (target) target.scrollIntoView(); else scrollTo(0, 0);
  if (target) target.classList.add('hp-flash');
}

// Same-site links move between pages without reloading.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || !/^\/help(\/|$)/.test(url.pathname) || /\.\w+$/.test(url.pathname)) return;
  e.preventDefault();
  const slug = /^\/help\/([\w-]+)/.exec(url.pathname)?.[1] || 'index';
  if (slug === slugFromPath() && url.hash) { history.pushState(null, '', url.hash); document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView({ behavior: 'smooth' }); return; }
  show(slug, { hash: url.hash, push: true });
  hideResults();
});
addEventListener('popstate', () => show(slugFromPath()));

/* ---------- search ---------- */

let index = null; // [{ slug, page, heading, id, text }]
async function buildIndex() {
  if (index) return index;
  const docs = await Promise.all(PAGES.map(async (p) => ({ p, md: await load(p.slug).catch(() => '') })));
  index = [];
  for (const { p, md } of docs) {
    const { headings } = render(md);
    const parts = md.split(/^(?=#{1,3}\s)/m);
    let hi = 0;
    for (const part of parts) {
      const head = /^#{1,3}\s+(.*?)\s*(?:\{#[\w-]+\})?\s*$/m.exec(part);
      const hd = head ? headings[hi++] : null;
      index.push({ slug: p.slug, page: p.title, heading: hd && hd.level > 1 ? hd.text : '', id: hd && hd.level > 1 ? hd.id : '', text: plainText(head ? part.replace(head[0], '') : part) });
    }
  }
  return index;
}
let active = 0;
let shown = [];
function hideResults() { results.hidden = true; }
function drawResults(q) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) { hideResults(); return; }
  shown = index.map((d) => {
    const hay = `${d.page} ${d.heading} ${d.text}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return null;
    const score = words.reduce((s, w) => s + (d.heading.toLowerCase().includes(w) ? 6 : 0) + (d.page.toLowerCase().includes(w) ? 4 : 0) + Math.min(3, hay.split(w).length - 1), 0);
    return { d, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 12).map((x) => x.d);
  active = 0;
  const snippet = (text) => {
    const low = text.toLowerCase();
    const at = Math.max(0, Math.min(...words.map((w) => { const k = low.indexOf(w); return k < 0 ? Infinity : k; })) - 50);
    const cut = text.slice(at, at + 160);
    const out = h('span', { class: 'hp-snip' });
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    cut.split(re).forEach((piece, k) => out.append(k % 2 ? h('mark', {}, piece) : document.createTextNode(piece)));
    if (at > 0) out.prepend('…');
    return out;
  };
  fill(results, shown.length ? shown.map((d, k) => h('a', { href: `/help/${d.slug === 'index' ? '' : d.slug}${d.id ? `#${d.id}` : ''}`.replace('/help/#', '/help#').replace(/\/$/, ''), class: `hp-result ${k === active ? 'is-on' : ''}`, role: 'option', 'data-route': '' },
    h('span', { class: 'hp-where' }, d.page, d.heading ? h('span', {}, ` › ${d.heading}`) : null), snippet(d.text)))
    : h('p', { class: 'hp-none' }, 'No matches. Try other words.'));
  results.hidden = false;
}
search.addEventListener('focus', () => { buildIndex(); });
search.addEventListener('input', async () => { await buildIndex(); drawResults(search.value); });
search.addEventListener('keydown', (e) => {
  const items = [...results.querySelectorAll('.hp-result')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
    items.forEach((el, k) => el.classList.toggle('is-on', k === active));
  } else if (e.key === 'Enter' && items[active]) { e.preventDefault(); items[active].click(); search.blur(); } else if (e.key === 'Escape') { hideResults(); search.blur(); }
});
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.hp-search')) hideResults(); });
addEventListener('keydown', (e) => { if (e.key === '/' && !e.target.closest('input, textarea')) { e.preventDefault(); search.focus(); } });

show(slugFromPath());
