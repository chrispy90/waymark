// The "New story" wizard builds valid stories in every look, and the editor checklist tracks its prompts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = (name) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', name)).href);
const places = [{ name: 'Lisbon', lngLat: [-9.1393, 38.7223] }, { name: 'Porto', lngLat: [-8.6291, 41.1579] }];

test('every kind of story builds in every look', async () => {
  const { buildStory, KINDS, LOOKS } = await load('story-kit.js');
  const { normalizeStory } = await load('story-format.js');
  for (const kind of Object.keys(KINDS)) {
    for (const look of Object.keys(LOOKS)) {
      const story = normalizeStory(buildStory({ kind, look, title: 'My story', places, chapters: ['One', 'Two'], extras: ['statement', 'numbers', 'gallery', 'quote'] }));
      assert.equal(story.title, 'My story');
      assert.equal(story.theme, LOOKS[look].theme);
      assert.ok(story.blocks.length >= 1, `${kind}/${look} has blocks`);
      assert.ok(story.guide.prompts.length >= 1);
      for (const b of story.blocks) {
        if (b.type === 'chapter') assert.ok(LOOKS[look].chapters.some(([bg, fg]) => bg === b.bg && fg === b.fg), 'chapter uses the look colors');
        const views = [b.view, ...(b.slides || []).map((s) => s.media?.view)].filter(Boolean);
        views.forEach((v) => assert.equal(v.basemap, LOOKS[look].basemap));
      }
    }
  }
});

test('journeys get an overview slide plus one slide per place, and tours one stop per place', async () => {
  const { buildStory } = await load('story-kit.js');
  const journey = buildStory({ kind: 'journey', look: 'classic', title: 'Trip', places });
  const slides = journey.blocks.find((b) => b.type === 'scrollmap').slides;
  assert.equal(slides.length, 3);
  assert.deepEqual(slides[1].media.view.center, places[0].lngLat);
  assert.equal(slides[0].media.view.markers.length, 2);
  const tour = buildStory({ kind: 'tour', look: 'night', title: 'Walk', places });
  assert.deepEqual(tour.blocks.find((b) => b.type === 'stops').places.map((p) => p.title), ['Lisbon', 'Porto']);
});

test('place names are escaped in generated HTML', async () => {
  const { buildStory } = await load('story-kit.js');
  const story = buildStory({ kind: 'journey', look: 'classic', title: 'x', places: [{ name: '<img src=x onerror=alert(1)>', lngLat: [0, 0] }] });
  // HTML fields are escaped; titles (markers, stops) are rendered as plain text by the reader
  const html = story.blocks.flatMap((b) => [b.html, ...(b.slides || []).map((sl) => sl.html), ...(b.places || []).map((pl) => pl.html)]).filter(Boolean);
  assert.ok(html.length && html.every((x) => !x.includes('<img')));
});

test('the checklist counts prompts until they are rewritten', async () => {
  const { buildStory, openPrompts } = await load('story-kit.js');
  const story = buildStory({ kind: 'journey', look: 'classic', title: 'Trip', places });
  const before = openPrompts(story).length;
  assert.equal(before, story.guide.prompts.length);
  story.blocks[0].html = '<p>My own opening.</p>';
  assert.equal(openPrompts(story).length, before - 1);
});

test('applying a look restyles chapters and vector basemaps but keeps imagery', async () => {
  const { applyLook, LOOKS } = await load('story-kit.js');
  const story = { theme: 'light', blocks: [
    { type: 'chapter', bg: '#fff', fg: '#000' },
    { type: 'map', view: { basemap: 'streets' } },
    { type: 'map', view: { basemap: 'satellite' } },
    { type: 'scrollmap', slides: [{ media: { type: 'map', view: { basemap: 'light' } } }] },
  ] };
  const r = applyLook(story, 'night');
  assert.deepEqual(r, { chapters: 1, maps: 2 });
  assert.equal(story.theme, 'dark');
  assert.deepEqual([story.blocks[0].bg, story.blocks[0].fg], LOOKS.night.chapters[0]);
  assert.equal(story.blocks[2].view.basemap, 'satellite');
  assert.equal(story.blocks[3].slides[0].media.view.basemap, 'dark');
});
