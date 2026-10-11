import { api, requireUser, signOut } from './api.js';
import { listLocalStories, deleteLocalStory } from './store.js';

const user = await requireUser();
document.getElementById('who').textContent = user.name || user.email;
document.getElementById('btn-signout').addEventListener('click', signOut);

const grid = document.getElementById('grid');
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
};

const blank = () => ({ title: 'Untitled story', subtitle: '', author: user.name || '', date: '', theme: 'light', cover: { image: '' }, layers: [],
  blocks: [{ type: 'text', html: '<p>Write something…</p>' }], credits: '' });

async function create(story) {
  const s = await api('POST', '/api/stories', { story });
  location.href = `/builder.html?id=${s.id}`;
}

document.getElementById('btn-new').addEventListener('click', () => create(blank()));
document.getElementById('btn-sample').addEventListener('click', async () => {
  const sample = await fetch('/stories/potomac.json').then((r) => r.json());
  create({ ...sample, author: user.name || sample.author });
});

function badge(s) {
  if (!s.url) return h('span', { class: 'g-badge' }, 'Draft');
  if (s.hasUnpublishedChanges) return h('span', { class: 'g-badge is-warn' }, 'Published · unpublished changes');
  return h('span', { class: 'g-badge is-live' }, 'Published');
}

async function load() {
  const { stories } = await api('GET', '/api/stories');
  document.getElementById('empty').hidden = stories.length > 0;
  grid.replaceChildren(...stories.map((s) => h('div', { class: 'g-card' },
    h('h3', {}, s.title || 'Untitled'),
    badge(s),
    h('span', { class: 'b-muted' }, 'Edited ' + new Date(s.updatedAt).toLocaleString()),
    h('div', { class: 'b-row' },
      h('a', { class: 'b-btn', href: `/builder.html?id=${s.id}` }, 'Edit'),
      s.url ? h('a', { class: 'b-btn', href: s.url, target: '_blank', rel: 'noopener' }, 'View live ↗') : null,
      h('button', { class: 'b-btn', type: 'button', onclick: async () => {
        if (!confirm(`Delete “${s.title}”? ${s.url ? 'Its public link will stop working. ' : ''}This can't be undone.`)) return;
        await api('DELETE', `/api/stories/${s.id}`);
        load();
      } }, 'Delete')))));
}

// One-time import of drafts saved in this browser before the server existed.
function offerImport() {
  const local = listLocalStories();
  const banner = document.getElementById('import-banner');
  if (!local.length) return;
  banner.hidden = false;
  banner.replaceChildren(
    h('span', {}, `${local.length} draft${local.length > 1 ? 's are' : ' is'} saved only in this browser.`),
    h('button', { class: 'b-btn is-primary', type: 'button', onclick: async (e) => {
      e.target.disabled = true;
      for (const s of local) {
        const { id, updated, ...story } = s;
        await api('POST', '/api/stories', { story });
        deleteLocalStory(id);
      }
      banner.hidden = true;
      load();
    } }, 'Move them to your account'));
}

load();
offerImport();
