// Starting points for new stories. Placeholder text tells people what to do next.
const v = (center, zoom, extra = {}) => ({ center, zoom, bearing: 0, pitch: 0, basemap: 'streets', markers: [], layers: [], ...extra });
// Hand-picked placeholder photos (fixed picsum.photos IDs, so every install gets the same pictures).
const pic = (id, w = 1600, h = 1000) => `https://picsum.photos/id/${id}/${w}/${h}`;

export const TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank story',
    description: 'A title and an empty page. Add blocks as you go.',
    icon: 'file',
    art: 'linear-gradient(135deg, #9aa3ad, #5e6873)',
    make: (author) => ({
      title: 'Untitled story', subtitle: '', author, theme: 'light', motion: 'subtle', cover: { image: '' }, layers: [],
      blocks: [{ type: 'text', html: '<p>Start writing here…</p>' }],
    }),
  },
  {
    id: 'movingmap',
    name: 'Moving map story',
    description: 'The map stays put and flies to a new place as each card scrolls by.',
    icon: 'scrollmap',
    art: 'linear-gradient(135deg, #2f855a, #1a4d6b)',
    make: (author) => ({
      title: 'A journey in three stops', subtitle: 'Replace this with a one-line summary of your story.', author, theme: 'light', motion: 'subtle',
      cover: { image: pic(1016, 1920, 1080), effect: 'parallax' }, layers: [],
      blocks: [
        { type: 'text', style: 'large', html: '<p>Introduce your story here. Then scroll down: the map moves with each card. Click a card in the editor to change its text and where the map goes.</p>' },
        { type: 'scrollmap', layout: 'overlay', slides: [
          { html: '<h3>Start wide</h3><p>Open with the big picture so readers know where they are.</p>', media: { type: 'map', view: v([10, 30], 1.6, { basemap: 'light' }) } },
          { html: '<h3>First stop</h3><p>Zoom in on a place. Use "Set map view" to choose it and drop a marker.</p>', media: { type: 'map', view: v([2.3488, 48.8534], 12.5, { pitch: 40, markers: [{ lngLat: [2.2945, 48.8584], title: 'Eiffel Tower' }] }) } },
          { html: '<h3>Next stop</h3><p>The map flies here as this card scrolls into view.</p>', media: { type: 'map', view: v([139.7671, 35.6812], 11.5, { pitch: 45, bearing: -20 }) } },
        ] },
        { type: 'text', html: '<h2>Wrap up</h2><p>End with what it all means.</p>' },
      ],
    }),
  },
  {
    id: 'walk',
    name: 'Stop-by-stop walk',
    description: 'Numbered places with photos. Readers step through them in order.',
    icon: 'route',
    art: 'linear-gradient(135deg, #e4572e, #b8336a)',
    make: (author) => ({
      title: 'A walk through Rome', subtitle: 'Swap these places for your own.', author, theme: 'light', motion: 'subtle',
      cover: { image: pic(195, 1920, 1080), effect: 'zoom' }, layers: [],
      blocks: [
        { type: 'text', html: '<p>A short introduction to the tour. Each stop below has a photo, a short description, and a spot on the map.</p>' },
        { type: 'stops', basemap: 'streets', zoom: 15.5, places: [
          { title: 'The Colosseum', lngLat: [12.4922, 41.8902], image: pic(142, 900, 600), html: '<p>Describe the first stop.</p>' },
          { title: 'The Pantheon', lngLat: [12.4768, 41.8986], image: pic(164, 900, 600), html: '<p>Describe the second stop.</p>' },
          { title: 'Trevi Fountain', lngLat: [12.4833, 41.9009], image: pic(1047, 900, 600), html: '<p>Describe the third stop.</p>' },
        ] },
      ],
    }),
  },
  {
    id: 'essay',
    name: 'Chaptered essay',
    description: 'Chapters that recolor the page, words that light up, numbers that count.',
    icon: 'sparkle',
    art: 'linear-gradient(135deg, #1b1a17, #6b3fa0 60%, #e4572e)',
    make: (author) => ({
      title: 'The shape of a river', subtitle: 'An essay in chapters. Every effect here is a block you can edit.', author, theme: 'light', motion: 'expressive',
      cover: { image: pic(1050, 1920, 1200), effect: 'zoom', kicker: 'A Waymark story' }, layers: [],
      blocks: [
        { type: 'text', style: 'large', html: '<p>Open with a paragraph that sets the scene. As readers scroll, blocks rise into view. Change that under Story → Scroll effects.</p>' },
        { type: 'chapter', kicker: 'Chapter one', title: 'Where it begins', text: 'Chapters fill the screen and change the colors of everything after them.', bg: '#13233a', fg: '#f3efe6', align: 'center' },
        { type: 'statement', text: 'Big ideas deserve big type. Each word lights up as the reader scrolls past it.', cite: 'A statement block' },
        { type: 'stats', items: [{ value: '405', label: 'miles from source to sea' }, { value: '14,670', label: 'square miles of watershed' }, { value: '6.1M', label: 'people living alongside it' }], caption: 'Numbers count up when they scroll into view.' },
        { type: 'chapter', kicker: 'Chapter two', title: 'A gallery that moves sideways', bg: '#f1e7d6', fg: '#2a1d10', align: 'left' },
        { type: 'gallery', title: 'Scroll down to move sideways', text: 'Vertical scrolling drives this row of photos.', images: [
          { url: pic(1043, 1400, 950), caption: 'First photo' }, { url: pic(1044, 1400, 950), caption: 'Second photo' },
          { url: pic(11, 1400, 950), caption: 'Third photo' }, { url: pic(1051, 1400, 950), caption: 'Fourth photo' } ] },
        { type: 'image', url: pic(1019, 1800, 1100), caption: 'Images can drift (parallax), slowly zoom, or wipe into view.', size: 'full', effect: 'parallax' },
        { type: 'text', html: '<h2>The end</h2><p>Close the essay here.</p>' },
      ],
    }),
  },
  {
    id: 'sample',
    name: 'Sample: Down the Potomac',
    description: 'A finished story with data layers, map links and every map block.',
    icon: 'map',
    art: 'linear-gradient(135deg, #0e7490, #84a98c)',
    make: async (author) => {
      const s = await fetch('/stories/potomac.json').then((r) => r.json());
      return { ...s, author: author || s.author };
    },
  },
];
