// A person's public page (/u/<handle>): the stories, maps and dashboards they chose to show.
import { h, icon, logo, coverGradient, setTitle, BRAND, fill } from './ui.js';

const handle = /^\/u\/([\w-]+)/.exec(location.pathname)?.[1] || '';
const root = document.getElementById('page');
const SAFE_IMG = /^(\/uploads\/|https?:\/\/)[^"'()\\\s]+$/;
const res = await fetch(`/api/public/users/${encodeURIComponent(handle)}`);
const p = res.ok ? await res.json() : null;

if (!p) {
  fill(root, h('main', { class: 'pv-missing' }, h('h1', {}, 'This page isn\'t available'), h('p', {}, 'Nobody uses that address.'), h('a', { class: 'btn btn-primary', href: '/' }, 'Go to Waymark')));
} else {
  setTitle(p.name);
  const date = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const card = (x, kind, img, sub, when) => h('a', { class: 'card', href: x.url },
    h('div', { class: 'card-cover', style: `background-image:${img && SAFE_IMG.test(img) ? `url("${img}")` : coverGradient(x.url + x.title)}` }, h('span', { class: 'card-cover-title' }, x.title || 'Untitled')),
    h('div', { class: 'card-body' }, sub ? h('p', { class: 'pp-sub' }, sub) : null, h('div', { class: 'card-meta' }, h('span', { class: 'pill no-dot' }, kind), h('span', { class: 'muted' }, date(when)))));
  const section = (title, items) => (items.length ? [h('h2', { class: 'pp-h' }, title), h('div', { class: 'cards' }, items)] : null);
  const empty = !p.stories.length && !p.maps.length && !p.dashboards.length;
  fill(root,
    h('header', { class: 'pp-head' }, h('a', { href: '/', class: 'pv-logo', 'aria-label': BRAND.name }, logo({ size: 26 }))),
    h('main', { class: 'pp' },
      h('div', { class: 'pp-who' }, h('span', { class: 'pp-avatar' }, (p.name || '?')[0].toUpperCase()), h('div', {}, h('h1', {}, p.name), p.bio ? h('p', {}, p.bio) : null)),
      empty ? h('section', { class: 'empty' }, icon('globe', { size: 36 }), h('h2', {}, 'Nothing here yet'), h('p', {}, `${p.name} hasn't put anything on this page.`)) : null,
      section('Stories', p.stories.map((s) => card(s, 'Story', s.cover, s.subtitle, s.publishedAt))),
      section('Maps', p.maps.map((m) => card(m, 'Map', m.thumbnail, m.summary, m.updatedAt))),
      section('Dashboards', p.dashboards.map((d) => card(d, 'Dashboard', null, '', d.updatedAt)))));
}
