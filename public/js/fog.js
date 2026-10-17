// Weather for the Fog look: fog banks drifting behind and in front of the story, a lantern that clears the fog
// around the pointer, gusts of wind, faint lightning inside the murk and a visibility readout in the top bar.
// The fog thins as readers get further into the story. story.css draws it all; this adds the layers and keeps
// the numbers moving. Returns a cleanup function.
import { reducedMotion } from './effects.js';

const between = (a, b) => a + Math.random() * (b - a);

export function fogWeather(root) {
  const still = reducedMotion();
  const layer = (cls) => Object.assign(document.createElement('div'), { className: cls, ariaHidden: 'true' });
  const far = layer('sm-fog sm-fog-far');
  const near = layer('sm-fog sm-fog-near');
  const flash = layer('sm-fog-flash');
  const gust = layer('sm-fog-gust');
  root.prepend(far);
  root.append(near, flash, gust);

  const readout = document.createElement('span');
  readout.className = 'sm-fog-vis';
  readout.setAttribute('aria-hidden', 'true');
  root.querySelector('.sm-topbar')?.append(readout);

  // Visibility runs from 40 m at the top of the story to 10 km at the end; wind gusts up now and then.
  let progress = 0;
  let wind = 18;
  const show = () => {
    const metres = 40 * Math.pow(250, progress);
    const vis = metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`;
    readout.textContent = `VIS ${vis} · WIND ${Math.round(wind)} KT`;
  };
  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const max = document.documentElement.scrollHeight - innerHeight;
      progress = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
      root.style.setProperty('--fog', (1 - progress * 0.75).toFixed(3));
      show();
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  onScroll();

  // The lantern trails the pointer a little, like something carried. With no pointer it rests mid-screen.
  let x = innerWidth / 2, y = innerHeight * 0.45, tx = x, ty = y, glide = 0;
  const place = () => { root.style.setProperty('--mx', `${x.toFixed(1)}px`); root.style.setProperty('--my', `${y.toFixed(1)}px`); };
  const step = () => {
    x += (tx - x) * 0.12; y += (ty - y) * 0.12;
    place();
    glide = Math.abs(tx - x) + Math.abs(ty - y) > 0.5 ? requestAnimationFrame(step) : 0;
  };
  const onPointer = (e) => {
    tx = e.clientX; ty = e.clientY;
    if (still) { x = tx; y = ty; place(); } else if (!glide) glide = requestAnimationFrame(step);
  };
  addEventListener('pointermove', onPointer, { passive: true });
  addEventListener('pointerdown', onPointer, { passive: true });
  place();

  // Gusts sweep wisps across the screen; lightning lights the fog from inside, somewhere off in the distance.
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
  const pulse = (el, ms, setup) => { setup?.(); el.classList.remove('is-on'); void el.offsetWidth; el.classList.add('is-on'); later(() => el.classList.remove('is-on'), ms); };
  const gustLoop = () => {
    pulse(gust, 3200, () => gust.style.setProperty('--gy', `${between(10, 70).toFixed(0)}vh`));
    wind = between(26, 38); show();
    later(() => { wind = between(14, 22); show(); }, 2600);
    later(gustLoop, between(7000, 16000));
  };
  const flashLoop = () => {
    pulse(flash, 1800, () => { flash.style.setProperty('--fx', `${between(10, 90).toFixed(0)}%`); flash.style.setProperty('--fy', `${between(5, 45).toFixed(0)}%`); });
    later(flashLoop, between(11000, 26000));
  };
  if (!still) { later(gustLoop, between(2500, 5000)); later(flashLoop, between(6000, 12000)); }

  // Headings come into focus out of the fog as they scroll into view.
  const focus = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('fog-clear'); focus.unobserve(e.target); }
  }), { rootMargin: '0px 0px -18% 0px' });
  root.querySelectorAll('.sm-cover h1, .sm-text h2, .sm-chapter h2, .sm-hg-intro h2, .sm-quote').forEach((el) => {
    if (still) el.classList.add('fog-clear'); else { el.classList.add('fog-blur'); focus.observe(el); }
  });

  return () => {
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
    removeEventListener('pointermove', onPointer);
    removeEventListener('pointerdown', onPointer);
    cancelAnimationFrame(raf); cancelAnimationFrame(glide);
    timers.forEach(clearTimeout);
    focus.disconnect();
    [far, near, flash, gust, readout].forEach((el) => el.remove());
    ['--fog', '--mx', '--my'].forEach((k) => root.style.removeProperty(k));
  };
}
