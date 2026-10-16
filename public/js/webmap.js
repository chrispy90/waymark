// Saved maps ("web maps"): layers, basemap, a starting view and bookmarks, made once and reused in many stories.
// A story view that uses one says { map: "<id>", bookmark?: "<id>", ... }. Before a story is shown, bakeMaps()
// copies the maps' layers into it (ids prefixed "<mapId>~") and turns those views into ordinary views, so the
// reader, the editor preview and exported sites all render them with no special cases. No DOM here.

export const SEP = '~';
export const layerKey = (mapId, layerId) => `${mapId}${SEP}${layerId}`;

/** A new, empty saved map. */
export function newMap(title = 'Untitled map') {
  return {
    title, summary: '', layers: [], bookmarks: [],
    view: { center: [-98.5, 39.5], zoom: 3.3, bearing: 0, pitch: 0, basemap: 'streets', layers: [], legend: true },
  };
}

// Every map view in a story, wherever it lives (map blocks, moving-map cards, map links, before & after).
export function* storyViews(story) {
  for (const b of story?.blocks || []) {
    if (b.view) yield b.view;
    for (const s of b.slides || []) {
      if (s.media?.view) yield s.media.view;
      for (const a of s.actions || []) if (a.view) yield a.view;
    }
  }
}

/** Ids of the saved maps a story uses. */
export const mapIdsIn = (story) => [...new Set([...storyViews(story)].map((v) => v.map).filter(Boolean))];

/**
 * The plain view a saved-map view stands for. The camera comes from the bookmark if one is chosen, otherwise from
 * the view itself; visible layers from the view's own choice, else the bookmark, else the map's defaults.
 */
export function concreteView(view, maps) {
  if (!view?.map) return view;
  const m = maps?.[view.map];
  const { map: id, bookmark, mapLayers, ...own } = view;
  if (!m) return { ...own, layers: own.layers || [] }; // the map was deleted or can't be loaded: show what's left
  const bm = bookmark ? (m.bookmarks || []).find((b) => b.id === bookmark) : null;
  const cam = bm?.view || (own.center ? own : m.view || {});
  const visible = mapLayers ?? bm?.layers ?? m.view?.layers ?? m.layers.map((l) => l.id);
  return {
    ...own,
    center: cam.center, zoom: cam.zoom, bearing: cam.bearing ?? 0, pitch: cam.pitch ?? 0,
    basemap: m.view?.basemap || own.basemap || 'streets',
    legend: own.legend ?? m.view?.legend ?? true,
    // a bookmark brings its own time setting (none = all dates); otherwise the view's, else the map's
    ...((bm ? bm.time : own.time ?? m.view?.time) ? { time: bm ? bm.time : own.time ?? m.view?.time } : {}),
    layers: [...visible.filter((lid) => m.layers.some((l) => l.id === lid)).map((lid) => layerKey(id, lid)), ...(own.layers || [])],
  };
}

/** A copy of the story with its saved maps built in: their layers added to story.layers and every view made plain. */
export function bakeMaps(story, maps) {
  const ids = mapIdsIn(story);
  if (!ids.length) return story;
  const copy = structuredClone(story);
  const known = new Set((copy.layers || []).map((l) => l.id));
  copy.layers = [...(copy.layers || [])];
  for (const id of ids) {
    for (const l of maps?.[id]?.layers || []) {
      const key = layerKey(id, l.id);
      if (known.has(key)) continue;
      known.add(key);
      const { analysis, ...rest } = l; // analysis inputs point at the map's own layer ids; readers don't need them
      copy.layers.push({ ...rest, id: key });
    }
  }
  for (const v of storyViews(copy)) {
    if (!v.map) continue;
    const plain = concreteView(v, maps);
    for (const k of Object.keys(v)) delete v[k];
    Object.assign(v, plain);
  }
  return copy;
}

/** Moving-map cards that walk readers through a saved map's bookmarks, one card per bookmark. */
export function cardsFromBookmarks(map, mapId) {
  return (map.bookmarks || []).map((b) => ({
    html: `<h3>${escapeHtml(b.name || 'Untitled view')}</h3><p>${escapeHtml(b.note || 'Explain what readers see on the map here.')}</p>`,
    media: { type: 'map', view: { map: mapId, bookmark: b.id, ...b.view, markers: [], layers: [] } },
  }));
}
/** Loads the saved maps a story uses with `getMap(id)` and builds them in. Maps that fail to load just show nothing. */
export async function withMaps(story, getMap) {
  const ids = mapIdsIn(story);
  if (!ids.length) return story;
  const maps = {};
  await Promise.all(ids.map(async (id) => { try { maps[id] = await getMap(id); } catch { /* deleted or not shared */ } }));
  return bakeMaps(story, maps);
}

/** A new story built on a saved map: a moving map through its bookmarks if it has any, otherwise one big map. */
export function storyFromMap(map, mapId) {
  const camera = { center: map.view?.center, zoom: map.view?.zoom, bearing: map.view?.bearing || 0, pitch: map.view?.pitch || 0 };
  const blocks = [{ type: 'text', style: 'large', html: '<p>Introduce the map: what it shows and why it matters.</p>' }];
  if ((map.bookmarks || []).length) blocks.push({ type: 'scrollmap', layout: 'overlay', slides: cardsFromBookmarks(map, mapId) });
  else blocks.push({ type: 'map', size: 'full', caption: map.summary || '', view: { map: mapId, ...camera, markers: [], layers: [] } });
  blocks.push({ type: 'text', html: '<h2>What it means</h2><p>Wrap up here.</p>' });
  return { title: map.title || 'Untitled story', subtitle: map.summary || '', theme: 'light', motion: 'subtle', cover: { image: map.thumbnail || '' }, layers: [], blocks };
}
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
