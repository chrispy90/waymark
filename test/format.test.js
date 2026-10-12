// Stories saved with the earlier block names keep working.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

test('old block types and layouts are converted to the current names', async () => {
  const { normalizeStory } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'story-format.js')).href);
  const story = normalizeStory({ blocks: [
    { type: 'sidecar', layout: 'docked', slides: [] }, { type: 'sidecar', layout: 'floating', slides: [] },
    { type: 'tour', places: [] }, { type: 'swipe' }, { type: 'text', html: '' },
  ] });
  assert.deepEqual(story.blocks.map((b) => [b.type, b.layout]), [
    ['scrollmap', 'split'], ['scrollmap', 'overlay'], ['stops', undefined], ['compare', undefined], ['text', undefined]]);
});
