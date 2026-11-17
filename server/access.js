// Who can do what. Every story, map, layer and dashboard has one owner, and can be shared with people or groups
// as a viewer (open it) or an editor (change it). Only the owner can delete, publish or change sharing.
const { db } = require('./db');

const TABLES = { story: 'stories', map: 'maps', layer: 'layers', dashboard: 'dashboards', scenario: 'scenarios' };
const LABEL = { story: 'Story', map: 'Map', layer: 'Layer', dashboard: 'Dashboard', scenario: 'Scenario' };
const RANK = { viewer: 1, editor: 2, owner: 3 };

class AccessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// The shares that reach a user: given to them directly, or to a group they belong to.
const MINE = `(user_id = ? OR group_id IN (SELECT group_id FROM group_members WHERE user_id = ? UNION SELECT id FROM groups WHERE owner_id = ?))`;

/** 'owner' | 'editor' | 'viewer' | null */
function roleFor(user, type, row) {
  if (!user || !row) return null;
  if (row.owner_id === user.id) return 'owner';
  const roles = db.prepare(`SELECT role FROM shares WHERE item_type = ? AND item_id = ? AND ${MINE}`).all(type, row.id, user.id, user.id, user.id).map((r) => r.role);
  return roles.includes('editor') ? 'editor' : roles.length ? 'viewer' : null;
}

/** The item's row with `_role` set, or a 404 when the user may not see it (never reveals that it exists). */
function getItem(user, type, id, need = 'viewer') {
  const row = db.prepare(`SELECT * FROM ${TABLES[type]} WHERE id = ?`).get(id);
  const role = roleFor(user, type, row);
  if (!role) throw new AccessError(404, `${LABEL[type]} not found`);
  if (RANK[role] < RANK[need]) throw new AccessError(403, need === 'owner' ? `Only the owner can do that` : `You can view this ${LABEL[type].toLowerCase()} but not change it`);
  row._role = role;
  return row;
}

/** SQL condition + parameters for "items of this type the user owns or was given". */
const visible = (type, user) => ({
  where: `(owner_id = ? OR id IN (SELECT item_id FROM shares WHERE item_type = '${type}' AND ${MINE}))`,
  params: [user.id, user.id, user.id, user.id],
});

/** Adds role and owner name to list rows, so the home screen can label what was shared with you. */
function withRoles(user, type, rows) {
  const owners = new Map();
  return rows.map((r) => {
    if (r.owner_id === user.id) return { ...r, _role: 'owner' };
    if (!owners.has(r.owner_id)) owners.set(r.owner_id, db.prepare('SELECT name, email FROM users WHERE id = ?').get(r.owner_id));
    const o = owners.get(r.owner_id);
    return { ...r, _role: roleFor(user, type, r), _owner: o ? o.name || o.email : '' };
  });
}
const roleFields = (r) => (r._role && r._role !== 'owner' ? { role: r._role, owner: r._owner || '' } : r._role ? { role: 'owner' } : {});

// A map or layer is also readable through something that uses it: a story you can open brings its maps, a map its
// layers. That only counts when the owner of the story (or map) could open the thing themselves. Otherwise anyone
// could read your map just by putting its id in a story of their own.
function reachable(user, type, id) {
  if (!user || (type !== 'map' && type !== 'layer')) return false;
  const target = db.prepare(`SELECT id, owner_id FROM ${TABLES[type]} WHERE id = ?`).get(id);
  if (!target) return false;
  const ownerCan = (ownerId) => ownerId === target.owner_id || !!roleFor({ id: ownerId }, type, target);
  const s = visible('story', user);
  const d = visible('dashboard', user);
  const w = visible('scenario', user);
  const needles = type === 'map' ? [`"map":"${id}"`] : [`/api/layers/${id}`, `"hostedLayerId":"${id}"`];
  for (const n of needles) {
    if (db.prepare(`SELECT owner_id FROM stories WHERE ${s.where} AND instr(draft, ?) > 0`).all(...s.params, n).some((r) => ownerCan(r.owner_id))) return true;
    if (type === 'map' && db.prepare(`SELECT owner_id FROM dashboards WHERE ${d.where} AND instr(data, ?) > 0`).all(...d.params, n).some((r) => ownerCan(r.owner_id))) return true;
    if (type === 'map' && db.prepare(`SELECT owner_id FROM scenarios WHERE ${w.where} AND instr(data, ?) > 0`).all(...w.params, n).some((r) => ownerCan(r.owner_id))) return true;
    if (type === 'layer') {
      const maps = db.prepare('SELECT id, owner_id FROM maps WHERE instr(data, ?) > 0').all(n);
      if (maps.some((m) => ownerCan(m.owner_id) && (roleFor(user, 'map', m) || reachable(user, 'map', m.id)))) return true;
    }
  }
  return false;
}

/* ---------- Groups and sharing routes ---------- */

function register({ route, requireUser, readJson, HttpError, newId }) {
  const member = (g, user) => g.owner_id === user.id || !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(g.id, user.id);
  const admin = (g, user) => g.owner_id === user.id || !!db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? AND role = 'admin'").get(g.id, user.id);
  const groupOut = (g, user) => {
    const owner = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(g.owner_id);
    const members = db.prepare('SELECT u.id, u.name, u.email, m.role FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY u.name, u.email').all(g.id);
    return { id: g.id, name: g.name, createdAt: g.created_at, mine: g.owner_id === user.id, canManage: admin(g, user),
      members: [{ ...owner, role: 'owner' }, ...members.filter((m) => m.id !== g.owner_id)] };
  };
  const getGroup = (user, id, manage = false) => {
    const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
    if (!g || !member(g, user)) throw new HttpError(404, 'Group not found');
    if (manage && !admin(g, user)) throw new HttpError(403, 'Only the group\'s owner or an admin can do that');
    return g;
  };

  route('GET', '/api/groups', async (req) => {
    const user = requireUser(req);
    const rows = db.prepare('SELECT * FROM groups WHERE owner_id = ? OR id IN (SELECT group_id FROM group_members WHERE user_id = ?) ORDER BY name').all(user.id, user.id);
    return [200, { groups: rows.map((g) => groupOut(g, user)) }];
  });

  route('POST', '/api/groups', async (req) => {
    const user = requireUser(req);
    const { name } = await readJson(req);
    const clean = String(name || '').trim().slice(0, 80);
    if (!clean) throw new HttpError(400, 'Give the group a name');
    const id = newId();
    db.prepare('INSERT INTO groups (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, user.id, clean, Date.now());
    return [201, groupOut(db.prepare('SELECT * FROM groups WHERE id = ?').get(id), user)];
  });

  route('PUT', '/api/groups/:id', async (req, p) => {
    const user = requireUser(req);
    const g = getGroup(user, p.id, true);
    const { name } = await readJson(req);
    const clean = String(name || '').trim().slice(0, 80);
    if (!clean) throw new HttpError(400, 'Give the group a name');
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(clean, g.id);
    return [200, groupOut({ ...g, name: clean }, user)];
  });

  route('DELETE', '/api/groups/:id', async (req, p) => {
    const user = requireUser(req);
    const g = getGroup(user, p.id);
    if (g.owner_id !== user.id) throw new HttpError(403, 'Only the group\'s owner can delete it');
    db.prepare('DELETE FROM groups WHERE id = ?').run(g.id);
    return [200, { ok: true }];
  });

  // People are added by the email of their account. They need an account first, so nothing is shared with a stranger by typo.
  route('POST', '/api/groups/:id/members', async (req, p) => {
    const user = requireUser(req);
    const g = getGroup(user, p.id, true);
    const { email, role } = await readJson(req);
    const who = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email || '').trim());
    if (!who) throw new HttpError(404, 'No account uses that email yet. Ask them to sign up, then add them.');
    if (who.id !== g.owner_id) {
      db.prepare('INSERT INTO group_members (group_id, user_id, role, added_at) VALUES (?, ?, ?, ?) ON CONFLICT (group_id, user_id) DO UPDATE SET role = excluded.role')
        .run(g.id, who.id, role === 'admin' ? 'admin' : 'member', Date.now());
    }
    return [200, groupOut(g, user)];
  });

  route('DELETE', '/api/groups/:id/members/:userId', async (req, p) => {
    const user = requireUser(req);
    const g = getGroup(user, p.id, p.userId !== user.id); // anyone can leave; removing others needs an admin
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(g.id, p.userId);
    return [200, { ok: true }];
  });

  const typeOf = (t) => { if (!TABLES[t]) throw new HttpError(404, 'Not found'); return t; };
  const sharesOut = (type, id) => db.prepare(`SELECT s.role, s.group_id, s.user_id, g.name AS group_name, u.name AS user_name, u.email FROM shares s
      LEFT JOIN groups g ON g.id = s.group_id LEFT JOIN users u ON u.id = s.user_id WHERE s.item_type = ? AND s.item_id = ? ORDER BY g.name, u.email`).all(type, id)
    .map((r) => (r.group_id ? { kind: 'group', id: r.group_id, name: r.group_name, role: r.role } : { kind: 'user', id: r.user_id, name: r.user_name, email: r.email, role: r.role }));

  route('GET', '/api/share/:type/:id', async (req, p) => {
    const row = getItem(requireUser(req), typeOf(p.type), p.id, 'owner');
    return [200, { shares: sharesOut(p.type, row.id), link: p.type === 'story' ? !!row.published : !!row.shared, listed: !!row.listed }];
  });

  // Replaces who the item is shared with. `link` (maps, layers, dashboards) lets anyone with the link open it;
  // `listed` shows it on the owner's public page.
  route('PUT', '/api/share/:type/:id', async (req, p) => {
    const user = requireUser(req);
    const type = typeOf(p.type);
    const row = getItem(user, type, p.id, 'owner');
    const body = await readJson(req);
    if (Array.isArray(body.shares)) {
      const next = [];
      for (const s of body.shares.slice(0, 200)) {
        const role = s.role === 'editor' ? 'editor' : 'viewer';
        if (s.group) {
          getGroup(user, String(s.group)); // you can only share with groups you're in
          next.push({ group: String(s.group), user: null, role });
        } else {
          const who = s.id ? db.prepare('SELECT id FROM users WHERE id = ?').get(String(s.id)) : db.prepare('SELECT id FROM users WHERE email = ?').get(String(s.email || '').trim());
          if (!who) throw new HttpError(404, `No account uses ${s.email || 'that email'} yet. Ask them to sign up, then share.`);
          if (who.id !== row.owner_id) next.push({ group: null, user: who.id, role });
        }
      }
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM shares WHERE item_type = ? AND item_id = ?').run(type, row.id);
        const ins = db.prepare('INSERT INTO shares (item_type, item_id, group_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?)');
        const seen = new Set();
        for (const s of next) {
          const key = s.group ? `g${s.group}` : `u${s.user}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ins.run(type, row.id, s.group, s.user, s.role, Date.now());
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }
    if (type !== 'story' && body.link !== undefined) {
      db.prepare(`UPDATE ${TABLES[type]} SET shared = ? WHERE id = ?`).run(body.link ? 1 : 0, row.id);
      if (body.link) sharePublic(type === 'layer' ? '' : row.data, user);
    }
    if (type !== 'layer' && body.listed !== undefined) db.prepare(`UPDATE ${TABLES[type]} SET listed = ? WHERE id = ?`).run(body.listed ? 1 : 0, row.id);
    const fresh = db.prepare(`SELECT * FROM ${TABLES[type]} WHERE id = ?`).get(row.id);
    return [200, { shares: sharesOut(type, row.id), link: type === 'story' ? !!fresh.published : !!fresh.shared, listed: !!fresh.listed }];
  });
}

// Saved maps a story or dashboard uses: views reference them as "map": "<id>".
const mapIdsIn = (json) => [...new Set([...String(json).matchAll(/"map":"([\w-]{4,40})"/g)].map((m) => m[1]))];
// Hosted layers referenced by URL or hostedLayerId in a story or map JSON.
const layerIdsIn = (json) => [...new Set([
  ...[...String(json).matchAll(/\/api\/(?:public\/)?layers\/([\w-]{4,40})(?:\/geojson|\.geojson|\/tiles)/g)].map((m) => m[1]),
  ...[...String(json).matchAll(/"hostedLayerId":"([\w-]{4,40})"/g)].map((m) => m[1]),
])];

/** Makes the maps and hosted layers that a public story, map or dashboard uses readable by anyone, if `user` may read them. */
function sharePublic(json, user) {
  const can = (type, row) => row && (roleFor(user, type, row) || reachable(user, type, row.id));
  const layerIds = new Set(layerIdsIn(json));
  for (const id of mapIdsIn(json)) {
    const m = db.prepare('SELECT id, owner_id, data FROM maps WHERE id = ?').get(id);
    if (!can('map', m)) continue;
    db.prepare('UPDATE maps SET shared = 1 WHERE id = ?').run(m.id);
    layerIdsIn(m.data).forEach((l) => layerIds.add(l));
  }
  for (const id of layerIds) {
    const l = db.prepare('SELECT id, owner_id FROM layers WHERE id = ?').get(id);
    if (can('layer', l)) db.prepare('UPDATE layers SET shared = 1 WHERE id = ?').run(l.id);
  }
}

module.exports = { register, roleFor, getItem, visible, withRoles, roleFields, reachable, sharePublic, mapIdsIn, layerIdsIn, AccessError, TABLES };
