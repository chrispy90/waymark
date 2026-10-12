// Viewer entry. Sources, in order:
//   <meta name="sm-slug">  published story (server-rendered /s/<slug> page)
//   ?preview=1             builder preview; story arrives by postMessage
//   ?draft=<id>            owner's draft, via the API
//   ?story=stories/x.json  static sample file
import { renderStory } from './render.js';
import { api } from './api.js';

const root = document.getElementById('story');
const params = new URLSearchParams(location.search);
let destroy = null;
const show = (story) => { destroy?.(); destroy = renderStory(story, root); };
const fail = (msg) => {
  root.replaceChildren();
  const p = document.createElement('p');
  p.className = 'sm-narrow';
  p.style.paddingTop = '120px';
  p.textContent = msg;
  root.append(p);
};

const slug = document.querySelector('meta[name="sm-slug"]')?.content;

if (slug) {
  fetch(`/api/public/${encodeURIComponent(slug)}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(show)
    .catch(() => fail('This story is not available.'));
} else if (params.has('preview')) {
  // Builder preview: the story arrives by postMessage; clicks select blocks in the editor.
  let rendered = false;
  let selected = null;
  const markSelected = () => root.querySelectorAll('[data-block-index]').forEach((el) => el.classList.toggle('is-selected', +el.dataset.blockIndex === selected));
  addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    if (e.data?.type === 'story') {
      const y = scrollY;
      destroy?.();
      destroy = renderStory(e.data.story, root, { instant: rendered });
      root.classList.add('is-editing');
      rendered = true;
      markSelected();
      scrollTo(0, Math.min(y, document.documentElement.scrollHeight));
    }
    if (e.data?.type === 'select') {
      selected = e.data.index;
      markSelected();
      const el = root.querySelector(`[data-block-index="${selected}"]`);
      if (el && e.data.scroll) {
        const r = el.getBoundingClientRect();
        if (r.top < 60 || r.top > innerHeight * 0.6) scrollTo({ top: scrollY + r.top - 80, behavior: 'smooth' });
      }
    }
  });
  root.addEventListener('click', (e) => {
    const blockEl = e.target.closest('[data-block-index]');
    if (!blockEl || e.target.closest('a, button, .maplibregl-canvas, .sm-compare-handle, iframe, video')) return;
    parent.postMessage({ type: 'select', index: +blockEl.dataset.blockIndex }, location.origin);
  });
  parent.postMessage({ type: 'preview-ready' }, location.origin);
} else if (params.get('draft')) {
  api('GET', `/api/stories/${encodeURIComponent(params.get('draft'))}`)
    .then((r) => show(r.story))
    .catch((e) => fail(e.status === 401 ? 'Sign in to preview this draft.' : 'Draft not found.'));
} else {
  const src = params.get('story') || 'stories/potomac.json';
  if (!/^stories\/[\w-]+\.json$/.test(src)) fail('Invalid story path.');
  else fetch(`/${src}`).then((r) => (r.ok ? r.json() : Promise.reject())).then(show).catch(() => fail('Could not load story.'));
}
