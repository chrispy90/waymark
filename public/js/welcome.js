// Landing page for signed-out visitors. It is itself a Waymark story, so it shows off what the app does.
import { renderStory } from './render.js';
import { api } from './api.js';
import { h, logo, BRAND } from './ui.js';
import { track, exitProgress, reducedMotion } from './effects.js';
import { contours } from './auth-shell.js';

const { user, signupOpen, firstRun } = await api('GET', '/api/me');
if (user) location.replace('/');
if (firstRun) location.replace('/login.html');

const nav = document.getElementById('nav');
const cta = (cls) => signupOpen
  ? h('a', { class: `w-btn ${cls}`, href: '/login.html?signup=1' }, 'Get started')
  : h('a', { class: `w-btn ${cls}`, href: '/login.html' }, 'Sign in');
nav.append(
  h('a', { href: '/', class: 'w-logo', 'aria-label': BRAND.name }, logo({ size: 28 })),
  h('span', { class: 'w-spacer' }),
  signupOpen ? h('a', { class: 'w-link', href: '/login.html' }, 'Sign in') : null,
  cta('w-btn-primary'));
addEventListener('scroll', () => nav.classList.toggle('is-solid', scrollY > innerHeight * 0.6), { passive: true });

const story = await fetch('/stories/welcome.json').then((r) => r.json());
story.title = BRAND.name;
story.cover.kicker = BRAND.tagline;
const root = document.getElementById('story');
renderStory(story, root);
document.title = `${BRAND.name}: ${BRAND.tagline}`;

// Hero: generated contour-map art that drifts and zooms as you scroll away.
const cover = root.querySelector('.sm-cover');
const art = contours();
art.classList.add('w-hero-art');
cover.classList.add('w-hero');
cover.prepend(art);
const inner = cover.querySelector('.sm-cover-inner');
if (!reducedMotion()) track(cover, (r) => {
  const p = exitProgress(r);
  art.style.transform = `translate3d(0, ${p * 18}%, 0) scale(${1 + p * 0.35}) rotate(${p * 4}deg)`;
  inner.style.opacity = String(Math.max(0, 1 - p * 1.6));
  inner.style.transform = `translate3d(0, ${p * -90}px, 0)`;
});

// Call to action after the last chapter.
const last = [...root.querySelectorAll('.sm-chapter')].pop();
last?.querySelector('.sm-chapter-inner').append(h('div', { class: 'w-cta' }, cta('w-btn-light w-btn-lg')));
