// Sharing: who can open or change a story, map, layer or dashboard; public links and embed codes; groups; and the
// settings for your public page.
import { api } from './api.js';
import { h, icon, dialog, toast, confirmDialog, copyText, fill } from './ui.js';

const NOUN = { story: 'story', map: 'map', layer: 'layer', dashboard: 'dashboard', scenario: 'scenario' };
const roleSelect = (value, onchange, opts = [['viewer', 'Can view'], ['editor', 'Can edit']]) =>
  h('select', { class: 'share-role', 'aria-label': 'Access', onchange: (e) => onchange(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: value === v }, l)));
const copyRow = (label, value) => {
  const input = h('input', { class: 'input', type: 'text', readonly: true, value, 'aria-label': label, onfocus: (e) => e.target.select() });
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label),
    h('span', { class: 'row' }, input, h('button', { type: 'button', class: 'btn', onclick: async () => { await copyText(value); toast('Copied', { tone: 'ok' }); } }, icon('copy', { size: 15 }), 'Copy')));
};
export const embedCode = (url, height = 600) => `<iframe src="${url}${url.includes('?') ? '&' : '?'}embed=1" width="100%" height="${height}" style="border:0" loading="lazy" allowfullscreen></iframe>`;

/**
 * item: { type: 'story' | 'map' | 'layer' | 'dashboard', id, title, url? (a story's public address when published) }
 */
export async function openShare(item, { onChange } = {}) {
  const noun = NOUN[item.type];
  const body = h('div', { class: 'share' }, h('p', { class: 'uploading' }, h('span', { class: 'spinner' }), 'Loading…'));
  const dlg = dialog({ title: `Share "${item.title || `Untitled ${noun}`}"`, body, actions: [h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done')], onClose: () => onChange?.() });
  let state;
  let groups = [];
  let me;
  try {
    [state, { groups }, { user: me }] = await Promise.all([api('GET', `/api/share/${item.type}/${item.id}`), api('GET', '/api/groups'), api('GET', '/api/me')]);
  } catch (e) { fill(body, h('p', { class: 'form-error' }, e.message)); return dlg; }

  const save = async (patch) => {
    try {
      state = await api('PUT', `/api/share/${item.type}/${item.id}`, patch);
      draw();
    } catch (e) { toast(e.message, { tone: 'error', duration: 6000 }); draw(); }
  };
  const asPatch = (list) => ({ shares: list.map((s) => (s.kind === 'group' ? { group: s.id, role: s.role } : { id: s.id, role: s.role })) });

  function draw() {
    const email = h('input', { class: 'input', type: 'email', placeholder: 'Email of someone with an account', 'aria-label': 'Email' });
    let role = 'viewer';
    const add = () => { const v = email.value.trim(); if (v) save({ shares: [...asPatch(state.shares).shares, { email: v, role }] }); };
    email.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    const free = groups.filter((g) => !state.shares.some((s) => s.kind === 'group' && s.id === g.id));
    const origin = location.origin;
    const publicUrl = item.type === 'story' ? (item.url ? origin + item.url : null) : item.type === 'map' ? `${origin}/m/${item.id}` : item.type === 'dashboard' ? `${origin}/d/${item.id}` : item.type === 'scenario' ? `${origin}/w/${item.id}` : `${origin}/api/public/layers/${item.id}.geojson`;

    fill(body,
      h('div', { class: 'rail-section-title', style: 'margin-top:0' }, 'People and groups'),
      state.shares.length ? h('div', { class: 'share-list' }, state.shares.map((s, i) => h('div', { class: 'share-row' },
        h('span', { class: 'share-who' }, icon(s.kind === 'group' ? 'layers' : 'file', { size: 16 }), h('span', {}, h('strong', {}, s.kind === 'group' ? s.name : s.name || s.email), h('span', { class: 'muted' }, s.kind === 'group' ? 'Group' : s.email))),
        roleSelect(s.role, (v) => save(asPatch(state.shares.map((x, j) => (j === i ? { ...x, role: v } : x))))),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Stop sharing with ${s.name || s.email}`, onclick: () => save(asPatch(state.shares.filter((_, j) => j !== i))) }, icon('x', { size: 15 })))))
        : h('p', { class: 'muted', style: 'margin:0 0 8px' }, `Only you can open this ${noun}.`),
      h('div', { class: 'row share-add' }, email, roleSelect(role, (v) => { role = v; }), h('button', { type: 'button', class: 'btn btn-primary', onclick: add }, 'Share')),
      free.length ? h('div', { class: 'row row-wrap', style: 'gap:6px;margin-top:8px' }, h('span', { class: 'muted', style: 'font-size:12.5px' }, 'Share with a group:'),
        free.map((g) => h('button', { type: 'button', class: 'btn btn-sm', onclick: () => save({ shares: [...asPatch(state.shares).shares, { group: g.id, role: 'viewer' }] }) }, icon('plus', { size: 13 }), g.name)))
        : groups.length ? null : h('p', { class: 'field-hint' }, 'Make a group on the Team tab to share with several people at once.'),
      h('p', { class: 'field-hint' }, `Viewers can open it. Editors can change it. Only you can delete it${item.type === 'story' ? ', publish it' : ''} or change who it's shared with.`),

      h('div', { class: 'rail-section-title' }, 'Public link'),
      item.type === 'story'
        ? (publicUrl ? [copyRow('Anyone with this link can read it', publicUrl), copyRow('Embed in a website', embedCode(publicUrl, 700))]
          : h('p', { class: 'muted', style: 'margin:0' }, 'This story isn\'t published. Publish it from the editor to get a public link.'))
        : [h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.link, onchange: (e) => save({ link: e.target.checked }) }),
          item.type === 'layer' ? 'Anyone with the link can load this layer\'s data' : `Anyone with the link can view this ${noun}`),
        state.link ? copyRow(item.type === 'layer' ? 'GeoJSON address' : 'Link', publicUrl) : null,
        state.link && item.type !== 'layer' ? copyRow('Embed in a website', embedCode(publicUrl)) : null,
        state.link && item.type !== 'layer' ? h('p', { class: 'field-hint' }, 'The layers it uses become readable too.') : null],
      item.type === 'layer' ? null : h('label', { class: 'check', style: 'margin-top:10px' },
        h('input', { type: 'checkbox', checked: state.listed, disabled: item.type === 'story' ? !publicUrl : !state.link, onchange: (e) => save({ listed: e.target.checked }) }),
        'Show it on my public page'),
      item.type === 'layer' ? null : h('p', { class: 'field-hint' }, me?.handle ? [`Your public page is `, h('a', { href: `/u/${me.handle}`, target: '_blank', rel: 'noopener' }, `${origin}/u/${me.handle}`), '.']
        : 'You don\'t have a public page yet. Set one up from the menu under your initial, top right.'));
  }
  draw();
  return dlg;
}

/* ---------- Groups (the Team tab) ---------- */

export async function renderTeam(container, { user }) {
  const { groups } = await api('GET', '/api/groups');
  const reload = () => renderTeam(container, { user });
  const create = () => {
    const name = h('input', { class: 'input', type: 'text', placeholder: 'e.g. Field team', maxlength: 80 });
    const go = async () => {
      if (!name.value.trim()) return;
      try { await api('POST', '/api/groups', { name: name.value }); dlg.close(); toast('Group made', { tone: 'ok' }); reload(); } catch (e) { toast(e.message, { tone: 'error' }); }
    };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const dlg = dialog({ title: 'New group', cls: 'dlg-sm', body: h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Group name'), name),
      actions: [h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'), h('button', { type: 'button', class: 'btn btn-primary', onclick: go }, 'Make group')] });
    setTimeout(() => name.focus(), 30);
  };
  const card = (g) => {
    const email = h('input', { class: 'input', type: 'email', placeholder: 'Add someone by the email of their account', 'aria-label': 'Email' });
    const add = async () => {
      if (!email.value.trim()) return;
      try { await api('POST', `/api/groups/${g.id}/members`, { email: email.value.trim() }); toast('Added to the group', { tone: 'ok' }); reload(); } catch (e) { toast(e.message, { tone: 'error', duration: 6000 }); }
    };
    email.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    return h('section', { class: 'team-card' },
      h('div', { class: 'row' }, h('h2', {}, g.name), h('span', { class: 'pill no-dot' }, `${g.members.length} ${g.members.length === 1 ? 'person' : 'people'}`), h('span', { class: 'spacer' }),
        g.mine ? h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => {
          if (!await confirmDialog({ title: `Delete "${g.name}"?`, danger: true, confirmLabel: 'Delete group', message: 'Everything shared with this group stops being shared with its members. Their own work is not touched.' })) return;
          await api('DELETE', `/api/groups/${g.id}`); toast('Group deleted'); reload();
        } }, icon('trash', { size: 14 }), 'Delete group')
          : h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => {
            if (!await confirmDialog({ title: `Leave "${g.name}"?`, confirmLabel: 'Leave group', message: 'You will lose access to what was shared with the group.' })) return;
            await api('DELETE', `/api/groups/${g.id}/members/${user.id}`); toast('You left the group'); reload();
          } }, 'Leave group')),
      h('div', { class: 'share-list' }, g.members.map((m) => h('div', { class: 'share-row' },
        h('span', { class: 'share-who' }, h('span', { class: 'team-avatar' }, (m.name || m.email)[0].toUpperCase()), h('span', {}, h('strong', {}, m.name || m.email), h('span', { class: 'muted' }, m.email))),
        m.role === 'owner' ? h('span', { class: 'pill no-dot' }, 'Owner')
          : g.canManage ? roleSelect(m.role, async (v) => { await api('POST', `/api/groups/${g.id}/members`, { email: m.email, role: v }); reload(); }, [['member', 'Member'], ['admin', 'Admin']])
            : h('span', { class: 'pill no-dot' }, m.role === 'admin' ? 'Admin' : 'Member'),
        g.canManage && m.role !== 'owner' ? h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${m.name || m.email}`, onclick: async () => { await api('DELETE', `/api/groups/${g.id}/members/${m.id}`); reload(); } }, icon('x', { size: 15 })) : h('span', { style: 'width:32px' })))),
      g.canManage ? h('div', { class: 'row share-add' }, email, h('button', { type: 'button', class: 'btn btn-primary', onclick: add }, 'Add')) : null);
  };
  fill(container,
    h('div', { class: 'gallery-head' },
      h('div', {}, h('h1', {}, 'Your team'), h('p', {}, 'Groups let you share stories, maps, layers and dashboards with several people at once. Admins can add and remove people.')),
      h('span', { class: 'spacer' }), h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: create }, icon('plus'), 'New group')),
    groups.length ? h('div', { class: 'team' }, groups.map(card))
      : h('section', { class: 'empty' }, icon('layers', { size: 40 }), h('h2', {}, 'Work on things together'),
        h('p', {}, 'Make a group, add people by the email of their account, then use Share on any story, map, layer or dashboard. People need to sign up before you can add them.'),
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: create }, icon('plus'), 'New group')));
}

/* ---------- Your public page ---------- */

export async function openProfile({ onChange } = {}) {
  const { user } = await api('GET', '/api/me');
  const name = h('input', { class: 'input', type: 'text', value: user.name || '', maxlength: 100 });
  const handle = h('input', { class: 'input', type: 'text', value: user.handle || '', placeholder: 'your-name', maxlength: 30, style: 'flex:1' });
  const bio = h('textarea', { class: 'input', rows: 3, maxlength: 500, placeholder: 'A line or two about you or your organization' }, user.bio || '');
  const err = h('p', { class: 'form-error', role: 'alert' });
  const link = h('p', { class: 'field-hint' });
  const showLink = () => fill(link, ...(handle.value.trim() ? ['Your page: ', h('a', { href: `/u/${handle.value.trim().toLowerCase()}`, target: '_blank', rel: 'noopener' }, `${location.origin}/u/${handle.value.trim().toLowerCase()}`)]
    : ['Leave the address blank to have no public page.']));
  handle.addEventListener('input', showLink);
  showLink();
  const save = async () => {
    try {
      await api('PUT', '/api/me', { name: name.value, handle: handle.value, bio: bio.value });
      dlg.close();
      toast('Saved', { tone: 'ok' });
      onChange?.();
    } catch (e) { err.textContent = e.message; }
  };
  const dlg = dialog({ title: 'Your public page', cls: 'dlg-sm', body: h('div', {},
    h('p', { class: 'field-hint', style: 'margin-top:0' }, 'A page that lists the stories, maps and dashboards you choose to show. Nothing appears on it until you tick "Show it on my public page" when sharing something.'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name shown'), name),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Page address'), h('span', { class: 'row' }, h('span', { class: 'muted' }, `${location.host}/u/`), handle)),
    link,
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'About'), bio),
    err),
  actions: [h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'), h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, 'Save')] });
  return dlg;
}
