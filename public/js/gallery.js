// "Your stories": the home screen after signing in. Logged-out visitors see the welcome page.
import { api, signOut } from './api.js';
import { listLocalStories, deleteLocalStory } from './store.js';
import { $, h, icon, logo, toast, menu, dialog, confirmDialog, copyText, relTime, coverGradient, setTitle } from './ui.js';
import { openWizard } from './wizard.js';
import { newMap, storyFromMap } from './webmap.js';
import { openExport } from './export.js';
import { openNewHostedLayerDialog, openAttributeTableDialog } from './table.js';

// "Your stories", "Your maps", and "Your layers" share the home screen. (Declared before start() runs, which uses it.)
const urlTab = new URLSearchParams(location.search).get('tab');
let tab = urlTab === 'maps' ? 'maps' : urlTab === 'layers' ? 'layers' : 'stories';
const { user, firstRun } = await api('GET', '/api/me');
if (!user) location.replace(firstRun ? '/login.html' : '/welcome.html');
else start();

function start() {
  setTitle('Your stories');
  $('#home-logo').append(logo());
  const avatar = $('#avatar');
  avatar.hidden = false;
  avatar.textContent = (user.name || user.email).trim()[0].toUpperCase();
  avatar.addEventListener('click', () => menu(avatar, [
    { label: user.email, icon: 'file', disabled: true, onClick: () => {} },
    'sep',
    { label: 'Change password', icon: 'key', onClick: changePassword },
    { label: 'Sign out', icon: 'logout', onClick: signOut },
  ]));
  addEventListener('scroll', () => $('#head').classList.toggle('is-scrolled', scrollY > 4), { passive: true });
  skeleton();
  load();
}

const SAFE_IMG = /^(\/uploads\/|https?:\/\/)[^"'()\\\s]+$/;
let query = '';
const tabs = () => h('div', { class: 'seg gallery-tabs', role: 'tablist' }, [['stories', 'Stories'], ['maps', 'Maps'], ['layers', 'Layers']].map(([k, l]) => h('button', { type: 'button', role: 'tab',
  class: tab === k ? 'is-on' : '', 'aria-selected': tab === k ? 'true' : 'false', onclick: () => { tab = k; history.replaceState(null, '', k === 'stories' ? '/' : `?tab=${k}`); skeleton(); load(); } }, l)));
let sort = (() => { try { return localStorage.getItem('wm.sort') || 'edited'; } catch { return 'edited'; } })();

function skeleton() {
  $('#gallery').replaceChildren(
    h('div', { class: 'gallery-head' }, h('div', {}, h('div', { class: 'skel', style: 'width:220px;height:34px' }), h('div', { class: 'skel', style: 'width:140px;height:14px;margin-top:10px' }))),
    h('div', { class: 'cards' }, [0, 1, 2].map((i) => h('div', { class: 'card is-skel', style: `--i:${i}` },
      h('div', { class: 'card-cover skel', style: 'border-radius:0' }),
      h('div', { class: 'card-body' }, h('div', { class: 'card-meta' }, h('div', { class: 'skel', style: 'width:64px;height:20px' }), h('div', { class: 'skel', style: 'width:110px;height:12px' })))))));
}

const sorters = {
  edited: (a, b) => b.updatedAt - a.updatedAt,
  title: (a, b) => (a.title || '').localeCompare(b.title || ''),
  live: (a, b) => (!!b.url - !!a.url) || b.updatedAt - a.updatedAt,
};

async function load() {
  if (tab === 'maps') return loadMaps();
  if (tab === 'layers') return loadLayers();
  const { stories } = await api('GET', '/api/stories');
  const main = $('#gallery');
  main.removeAttribute('aria-busy');
  const firstName = (user.name || '').split(' ')[0];
  if (!stories.length) {
    main.replaceChildren(...[tabs(), importBanner(), h('section', { class: 'empty' },
      logo({ size: 56, withName: false }),
      h('h2', {}, firstName ? `Welcome, ${firstName}. Let's make your first story.` : "Let's make your first story."),
      h('p', {}, 'A few quick questions and your story is ready to fill in. Everything can be changed, and nothing is public until you publish.'),
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: newStoryDialog }, icon('sparkle'), 'Create your first story'))].filter(Boolean));
    if (!sessionStorage.getItem('wm.wizardShown')) { sessionStorage.setItem('wm.wizardShown', '1'); newStoryDialog(); }
    return;
  }
  const grid = h('div', { class: 'cards' });
  const drawCards = () => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = stories.filter((s) => words.every((w) => (s.title || 'untitled').toLowerCase().includes(w) || (w === 'live' && s.url) || (w === 'draft' && !s.url))).sort(sorters[sort]);
    grid.replaceChildren(...(list.length ? list.map((s, i) => storyCard(s, i)) : [h('p', { class: 'no-results' }, `No stories match "${query}".`)]),
      ...(query ? [] : [h('button', { type: 'button', class: 'card card-new', style: `--i:${list.length}`, onclick: newStoryDialog }, h('span', { class: 'plus' }, icon('plus')), 'New story')]));
  };
  const search = h('input', { type: 'search', placeholder: 'Search your stories', 'aria-label': 'Search your stories', value: query, oninput: (e) => { query = e.target.value; drawCards(); } });
  const sortSel = h('select', { 'aria-label': 'Sort stories', onchange: (e) => { sort = e.target.value; try { localStorage.setItem('wm.sort', sort); } catch { /* ignore */ } drawCards(); } },
    [['edited', 'Last edited'], ['title', 'Title A–Z'], ['live', 'Published first']].map(([v, l]) => h('option', { value: v, selected: sort === v }, l)));
  const live = stories.filter((s) => s.url).length;
  main.replaceChildren(...[
    tabs(),
    h('div', { class: 'gallery-head' },
      h('div', {}, h('h1', {}, 'Your stories'), h('p', {}, `${stories.length} ${stories.length === 1 ? 'story' : 'stories'} · ${live} published`)),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: newStoryDialog }, icon('plus'), 'New story')),
    importBanner(),
    stories.length > 3 ? h('div', { class: 'gallery-tools' }, h('label', { class: 'search' }, icon('search', { size: 16 }), search), sortSel) : null,
    grid].filter(Boolean));
  drawCards();
}

addEventListener('keydown', (e) => {
  const search = document.querySelector('.search input');
  if (search && e.key === '/' && !e.target.closest('input, textarea') && !document.querySelector('dialog[open]')) { e.preventDefault(); search.focus(); }
});

function badge(s) {
  if (!s.url) return h('span', { class: 'pill' }, 'Draft');
  if (s.hasUnpublishedChanges) return h('span', { class: 'pill is-warn' }, 'Unpublished edits');
  return h('span', { class: 'pill is-live' }, 'Live');
}

function storyCard(s, i) {
  const more = h('button', { type: 'button', class: 'icon-btn card-more', 'aria-label': `Options for ${s.title}`, onclick: (e) => {
    e.preventDefault();
    e.stopPropagation();
    const btn = e.currentTarget;
    btn.setAttribute('aria-expanded', 'true');
    menu(btn, [
      { label: 'Edit', icon: 'text', onClick: () => { location.href = `/builder.html?id=${s.id}`; } },
      s.url ? { label: 'Open live story', icon: 'external', onClick: () => window.open(s.url, '_blank', 'noopener') } : { label: 'Preview draft', icon: 'eye', onClick: () => window.open(`/viewer.html?draft=${s.id}`, '_blank', 'noopener') },
      s.url ? { label: 'Copy link', icon: 'link', onClick: async () => { await copyText(location.origin + s.url); toast('Link copied', { tone: 'ok' }); } } : null,
      { label: 'Duplicate', icon: 'copy', onClick: () => duplicate(s) },
      { label: 'Export as a website…', icon: 'globe', onClick: () => openExport({ id: s.id }).catch((err) => toast(err.message, { tone: 'error' })) },
      'sep',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => remove(s) },
    ].filter(Boolean));
    const obs = new MutationObserver(() => { if (!document.querySelector('.menu')) { btn.removeAttribute('aria-expanded'); obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
  } }, icon('more'));
  return h('a', { class: 'card', href: `/builder.html?id=${s.id}`, 'data-story': s.id, style: `--i:${i}` },
    h('div', { class: 'card-cover', style: `background-image:${s.cover && SAFE_IMG.test(s.cover) ? `url("${s.cover}")` : coverGradient(s.id + s.title)}` }, h('span', { class: 'card-cover-title' }, s.title || 'Untitled story')),
    more,
    h('div', { class: 'card-body' }, h('div', { class: 'card-meta' }, badge(s), h('span', { class: 'muted' }, `Edited ${relTime(s.updatedAt)}${s.blocks ? ` · ${s.blocks} blocks` : ''}`))));
}

async function duplicate(s) {
  const { story } = await api('GET', `/api/stories/${s.id}`);
  const { id, ...copy } = story;
  await api('POST', '/api/stories', { story: { ...copy, title: `${story.title || 'Untitled'} (copy)` } });
  toast('Story duplicated', { tone: 'ok' });
  load();
}

async function remove(s) {
  const ok = await confirmDialog({ title: `Delete "${s.title || 'Untitled story'}"?`, danger: true, confirmLabel: 'Delete story',
    message: s.url ? 'Its public link will stop working. This can\'t be undone.' : 'This can\'t be undone.' });
  if (!ok) return;
  await api('DELETE', `/api/stories/${s.id}`);
  toast('Story deleted');
  load();
}

/* ---------- Saved maps ---------- */

async function loadMaps() {
  const { maps } = await api('GET', '/api/maps');
  const main = $('#gallery');
  main.removeAttribute('aria-busy');
  const create = h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: createMap }, icon('plus'), 'New map');
  main.replaceChildren(
    tabs(),
    h('div', { class: 'gallery-head' },
      h('div', {}, h('h1', {}, 'Your maps'), h('p', {}, maps.length ? `${maps.length} ${maps.length === 1 ? 'map' : 'maps'} · make a map once, use it in any number of stories` : 'Make a map once, use it in any number of stories.')),
      h('span', { class: 'spacer' }), create),
    maps.length ? h('div', { class: 'cards' }, maps.map((m, i) => mapCard(m, i)),
      h('button', { type: 'button', class: 'card card-new', style: `--i:${maps.length}`, onclick: createMap }, h('span', { class: 'plus' }, icon('plus')), 'New map'))
      : h('section', { class: 'empty' }, icon('layers', { size: 40 }), h('h2', {}, 'Build a map you can reuse'),
        h('p', {}, 'Add live public data or your own, style it, run analysis, and save bookmarks. Then use the map in any story; edit it once and every story updates.'),
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: createMap }, icon('plus'), 'New map')));
}

async function createMap() {
  const r = await api('POST', '/api/maps', { map: newMap() });
  location.href = `/map.html?id=${r.id}&new=1`;
}

function mapCard(m, i) {
  const more = h('button', { type: 'button', class: 'icon-btn card-more', 'aria-label': `Options for ${m.title}`, onclick: (e) => {
    e.preventDefault();
    e.stopPropagation();
    menu(e.currentTarget, [
      { label: 'Edit map', icon: 'map', onClick: () => { location.href = `/map.html?id=${m.id}`; } },
      { label: 'New story with this map', icon: 'scrollmap', onClick: async () => {
        const { map } = await api('GET', `/api/maps/${m.id}`);
        const s = await api('POST', '/api/stories', { story: storyFromMap(map, m.id) });
        location.href = `/builder.html?id=${s.id}&new=1`;
      } },
      { label: 'Duplicate', icon: 'copy', onClick: async () => {
        const { map } = await api('GET', `/api/maps/${m.id}`);
        const { id, ...copy } = map;
        await api('POST', '/api/maps', { map: { ...copy, title: `${map.title || 'Untitled map'} (copy)` } });
        toast('Map duplicated', { tone: 'ok' });
        load();
      } },
      'sep',
      { label: 'Delete', icon: 'trash', danger: true, onClick: async () => {
        const { stories } = await api('GET', `/api/maps/${m.id}/usage`);
        const ok = await confirmDialog({ title: `Delete "${m.title || 'Untitled map'}"?`, danger: true, confirmLabel: 'Delete map',
          message: stories.length ? `${stories.length} ${stories.length === 1 ? 'story uses' : 'stories use'} it (${stories.map((s) => s.title).join(', ')}). Those maps will go blank. This can't be undone.` : "This can't be undone." });
        if (!ok) return;
        await api('DELETE', `/api/maps/${m.id}`);
        toast('Map deleted');
        load();
      } },
    ]);
  } }, icon('more'));
  return h('a', { class: 'card', href: `/map.html?id=${m.id}`, style: `--i:${i}` },
    h('div', { class: 'card-cover', style: `background-image:${m.thumbnail && SAFE_IMG.test(m.thumbnail) ? `url("${m.thumbnail}")` : coverGradient(m.id + m.title)}` }, h('span', { class: 'card-cover-title' }, m.title || 'Untitled map')),
    more,
    h('div', { class: 'card-body' }, h('div', { class: 'card-meta' },
      m.shared ? h('span', { class: 'pill is-live' }, 'In a live story') : h('span', { class: 'pill no-dot' }, 'Map'),
      h('span', { class: 'muted' }, `${m.layers} ${m.layers === 1 ? 'layer' : 'layers'} · ${m.bookmarks} ${m.bookmarks === 1 ? 'bookmark' : 'bookmarks'} · edited ${relTime(m.updatedAt)}`))));
}

/* ---------- Hosted Feature Layers ---------- */

async function loadLayers() {
  const { layers } = await api('GET', '/api/layers');
  const main = $('#gallery');
  main.removeAttribute('aria-busy');
  const create = () => openNewHostedLayerDialog({
    onCreated: (r) => {
      load();
      openAttributeTableDialog({ id: r.id, hostedLayerId: r.id, name: r.title, url: r.url, attribution: r.attribution }, { onChange: () => load() });
    },
  });
  main.replaceChildren(
    tabs(),
    h('div', { class: 'gallery-head' },
      h('div', {}, h('h1', {}, 'Your hosted layers'), h('p', {}, layers.length
        ? `${layers.length} hosted GeoJSON ${layers.length === 1 ? 'layer' : 'layers'} · edit attributes, schema fields, and source attribution in one place`
        : 'Create ArcGIS Online-style hosted GeoJSON layers with editable attribute tables and source attribution.')),
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: create }, icon('plus'), 'New hosted layer')),
    layers.length ? h('div', { class: 'cards' }, layers.map((l, i) => layerCard(l, i)),
      h('button', { type: 'button', class: 'card card-new', style: `--i:${layers.length}`, onclick: create }, h('span', { class: 'plus' }, icon('plus')), 'New hosted layer'))
      : h('section', { class: 'empty' }, icon('database', { size: 40 }), h('h2', {}, 'Create a hosted feature layer'),
        h('p', {}, 'Store GeoJSON feature layers on your server with custom attribute schemas, field calculations, inline table editing, and source attribution. Use them across any map or story.'),
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: create }, icon('plus'), 'New hosted layer')));
}

function layerCard(l, i) {
  const openStudio = () => {
    const dlg = openAttributeTableDialog({ id: l.id, hostedLayerId: l.id, name: l.title, url: l.url, attribution: l.attribution, style: l.style, popup: l.popup }, { onChange: () => load() });
    dlg.addEventListener('close', () => load());
  };
  const openInNewMap = async () => {
    const m = newMap();
    m.title = `${l.title} Map`;
    const lid = `l${Math.random().toString(36).slice(2, 8)}`;
    m.layers.push({ id: lid, hostedLayerId: l.id, name: l.title, url: l.url, attribution: l.attribution || '', style: l.style?.color ? l.style : { color: '#2563eb' }, popup: l.popup || {} });
    m.view.layers.push(lid);
    const r = await api('POST', '/api/maps', { map: m });
    location.href = `/map.html?id=${r.id}`;
  };
  const more = h('button', { type: 'button', class: 'icon-btn card-more', 'aria-label': `Options for ${l.title}`, onclick: (e) => {
    e.preventDefault();
    e.stopPropagation();
    menu(e.currentTarget, [
      { label: 'Edit attribute table & schema', icon: 'list', onClick: openStudio },
      { label: 'Open in a new map', icon: 'map', onClick: openInNewMap },
      { label: 'Copy GeoJSON service URL', icon: 'link', onClick: async () => { await copyText(location.origin + l.url); toast('GeoJSON service URL copied', { tone: 'ok' }); } },
      { label: 'Duplicate layer', icon: 'copy', onClick: async () => {
        const full = await api('GET', `/api/layers/${l.id}`);
        await api('POST', '/api/layers', { title: `${l.title} (copy)`, summary: l.summary, attribution: l.attribution, geomType: l.geomType, fields: l.fields, style: l.style, popup: l.popup, data: full.data });
        toast('Hosted layer duplicated', { tone: 'ok' });
        load();
      } },
      'sep',
      { label: 'Delete layer', icon: 'trash', danger: true, onClick: async () => {
        const { stories, maps } = await api('GET', `/api/layers/${l.id}/usage`);
        const usedCount = (stories?.length || 0) + (maps?.length || 0);
        const ok = await confirmDialog({
          title: `Delete "${l.title || 'Untitled layer'}"?`,
          danger: true,
          confirmLabel: 'Delete layer',
          message: usedCount ? `Used in ${stories.length} stories and ${maps.length} maps. Deleting it will remove its GeoJSON data. This can't be undone.` : "This can't be undone.",
        });
        if (!ok) return;
        await api('DELETE', `/api/layers/${l.id}`);
        toast('Hosted layer deleted');
        load();
      } },
    ]);
  } }, icon('more'));

  return h('div', { class: 'card', role: 'button', tabindex: '0', style: `--i:${i};cursor:pointer`, onclick: openStudio, onkeydown: (e) => { if (e.key === 'Enter') openStudio(); } },
    h('div', { class: 'card-cover', style: `background-image:${coverGradient('layer-' + l.id + l.title)}` },
      h('span', { class: 'card-cover-title' }, l.title || 'Untitled layer')),
    more,
    h('div', { class: 'card-body' },
      h('div', { class: 'card-meta' },
        l.shared ? h('span', { class: 'pill is-live' }, 'Public GeoJSON') : h('span', { class: 'pill no-dot' }, l.geomType || 'GeoJSON'),
        h('span', { class: 'muted' }, `${(l.featureCount || 0).toLocaleString()} features · ${(l.fields || []).length} fields · edited ${relTime(l.updatedAt)}`)),
      l.attribution ? h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, `Attribution: ${l.attribution}`) : null));
}

function newStoryDialog() {
  return openWizard({ user });
}

function changePassword() {
  const form = h('form', { novalidate: true },
    h('input', { type: 'text', name: 'username', autocomplete: 'username', value: user.email, hidden: true }),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Current password'), h('input', { type: 'password', name: 'current', autocomplete: 'current-password', required: true })),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'New password'), h('input', { type: 'password', name: 'password', autocomplete: 'new-password', minlength: 8, required: true })),
    h('p', { class: 'field-hint' }, 'At least 8 characters. Your other devices will be signed out.'),
    h('p', { class: 'form-error', role: 'alert' }));
  const submit = async (e) => {
    e?.preventDefault();
    const err = form.querySelector('.form-error');
    if (form.elements.password.value.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
    try {
      await api('POST', '/api/auth/password', { current: form.elements.current.value, password: form.elements.password.value });
      dlg.close();
      toast('Password changed', { tone: 'ok' });
    } catch (ex) { err.textContent = ex.message; }
  };
  form.addEventListener('submit', submit);
  const dlg = dialog({ title: 'Change password', cls: 'dlg-sm', body: form, actions: [
    h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: submit }, 'Change password')] });
  form.elements.current.focus();
}

// One-time import of drafts saved in this browser before accounts existed.
function importBanner() {
  const local = listLocalStories();
  if (!local.length) return null;
  const banner = h('div', { class: 'banner' },
    icon('download'),
    h('span', { style: 'flex:1' }, `${local.length} draft${local.length > 1 ? 's are' : ' is'} saved only in this browser.`),
    h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: async (e) => {
      e.currentTarget.disabled = true;
      for (const s of local) {
        const { id, updated, ...story } = s;
        await api('POST', '/api/stories', { story });
        deleteLocalStory(id);
      }
      toast('Drafts moved to your account', { tone: 'ok' });
      load();
    } }, 'Move to my account'));
  return banner;
}
