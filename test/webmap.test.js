// Saved maps are built into stories at display time: layers copied in under "<mapId>~<layerId>", views made plain.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'webmap.js')).href);
const map = {
  layers: [{ id: 'quakes', name: 'Quakes', url: 'q.geojson' }, { id: 'buf', name: 'Buffer', data: { type: 'FeatureCollection', features: [] }, analysis: { tool: 'buffer', inputs: { input: 'quakes' } } }],
  view: { center: [10, 20], zoom: 4, basemap: 'dark', layers: ['quakes'] },
  bookmarks: [{ id: 'b1', name: 'Close up', view: { center: [11, 21], zoom: 9, bearing: 15, pitch: 30 }, layers: ['quakes', 'buf'] }],
};

test('a view that uses a saved map becomes a plain view with the map\'s layers', async () => {
  const { bakeMaps } = await load();
  const story = { layers: [{ id: 'mine', name: 'Mine' }], blocks: [
    { type: 'map', view: { map: 'M1', center: [0, 0], zoom: 2, layers: ['mine'] } },
    { type: 'scrollmap', slides: [{ media: { type: 'map', view: { map: 'M1', bookmark: 'b1' } }, actions: [{ id: 'a', view: { map: 'M1', mapLayers: ['buf'], center: [5, 5], zoom: 6 } }] }] },
  ] };
  const baked = bakeMaps(story, { M1: map });
  assert.deepEqual(baked.layers.map((l) => l.id), ['mine', 'M1~quakes', 'M1~buf']);
  assert.equal(baked.layers[2].analysis, undefined);
  const [v1, v2, v3] = [baked.blocks[0].view, baked.blocks[1].slides[0].media.view, baked.blocks[1].slides[0].actions[0].view];
  assert.deepEqual([v1.center, v1.zoom, v1.basemap, v1.layers], [[0, 0], 2, 'dark', ['M1~quakes', 'mine']]);
  assert.deepEqual([v2.center, v2.zoom, v2.bearing, v2.pitch, v2.layers], [[11, 21], 9, 15, 30, ['M1~quakes', 'M1~buf']]);
  assert.deepEqual(v3.layers, ['M1~buf']);
  assert.ok(!('map' in v1) && !('bookmark' in v2));
  assert.equal(story.blocks[0].view.map, 'M1', 'the original story is not changed');
});

test('a view with no camera of its own starts where the map starts; a missing map leaves an empty view', async () => {
  const { concreteView } = await load();
  assert.deepEqual(concreteView({ map: 'M1' }, { M1: map }).center, [10, 20]);
  const gone = concreteView({ map: 'nope', center: [1, 2], zoom: 3, layers: ['mine'] }, {});
  assert.deepEqual([gone.center, gone.layers], [[1, 2], ['mine']]);
});

test('a moving map can be built from a saved map\'s bookmarks', async () => {
  const { cardsFromBookmarks, mapIdsIn } = await load();
  const cards = cardsFromBookmarks({ ...map, bookmarks: [...map.bookmarks, { id: 'b2', name: '<Wide>', view: { center: [0, 0], zoom: 1 } }] }, 'M1');
  assert.equal(cards.length, 2);
  assert.deepEqual([cards[0].media.view.map, cards[0].media.view.bookmark], ['M1', 'b1']);
  assert.ok(cards[1].html.includes('&lt;Wide&gt;'));
  assert.deepEqual(mapIdsIn({ blocks: [{ type: 'scrollmap', slides: cards }] }), ['M1']);
});

test("time settings: a bookmark brings its own (or none), other views fall back to the map's", async () => {
  const { concreteView } = await load();
  const timed = { ...map, view: { ...map.view, time: { at: 100, span: 10 } }, bookmarks: [{ id: 'b1', view: { center: [0, 0], zoom: 1 } }, { id: 'b2', view: { center: [0, 0], zoom: 1 }, time: { at: 50, span: 0 } }] };
  assert.equal(concreteView({ map: 'M1', bookmark: 'b1' }, { M1: timed }).time, undefined);
  assert.deepEqual(concreteView({ map: 'M1', bookmark: 'b2' }, { M1: timed }).time, { at: 50, span: 0 });
  assert.deepEqual(concreteView({ map: 'M1', center: [1, 1], zoom: 2 }, { M1: timed }).time, { at: 100, span: 10 });
});
