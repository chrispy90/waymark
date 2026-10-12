// Starting points for new stories. Placeholder text tells people what to do next.
const v = (center, zoom, extra = {}) => ({ center, zoom, bearing: 0, pitch: 0, basemap: 'streets', markers: [], layers: [], ...extra });
// Hand-picked placeholder photos (fixed picsum.photos IDs, so every install gets the same pictures).
const pic = (id, w = 1600, h = 1000) => `https://picsum.photos/id/${id}/${w}/${h}`;
// Drawn shapes for the brutalist template, in the same per-feature style a drawing saves.
const feat = (geometry, properties) => ({ type: 'Feature', properties, geometry });
const boxAt = ([w, s], [e, n]) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
const ring = ([lng, lat], km, steps = 48) => {
  const dy = km / 110.57;
  const dx = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const pts = Array.from({ length: steps }, (_, i) => [+(lng + dx * Math.cos((2 * Math.PI * i) / steps)).toFixed(6), +(lat + dy * Math.sin((2 * Math.PI * i) / steps)).toFixed(6)]);
  return { type: 'Polygon', coordinates: [[...pts, pts[0]]] };
};
const ink = { stroke: '#2121ff', 'stroke-width': 4, 'stroke-opacity': 1, 'stroke-dash': 'solid', fill: '#2121ff', 'fill-opacity': 0.12 };
const label = (text, at, size = 22) => feat({ type: 'Point', coordinates: at }, { text, 'text-size': size, stroke: '#0b0b0b' });

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
    id: 'brutalist',
    name: 'Brutalist zine',
    description: 'Raw type, hard edges, loud color. A field guide with shapes drawn right on the map.',
    icon: 'square',
    art: 'repeating-linear-gradient(-45deg, #0b0b0b 0 14px, #dcff1e 14px 28px)',
    make: (author) => ({
      title: 'Raw concrete', subtitle: 'A field guide to four brutalist buildings, and why people still fight about them.', author, theme: 'brutalist', motion: 'expressive',
      cover: { image: pic(1054, 1920, 1200), effect: 'zoom', kicker: 'Field guide no. 1' },
      layers: [{ id: 'lbrut', name: 'Field notes', drawn: true, style: { color: '#2121ff', width: 4, radius: 8, opacity: 0.12 }, popup: { title: '{name}' },
        data: { type: 'FeatureCollection', features: [
          feat(boxAt([-0.0985, 51.5182], [-0.089, 51.5226]), { ...ink, name: 'Barbican Estate', description: 'Built 1965 to 1976 on land bombed in the Blitz.' }),
          feat({ type: 'LineString', coordinates: [[-0.0984, 51.5138], [-0.0978, 51.5158], [-0.0962, 51.5176]] }, { stroke: '#ff4a1c', 'stroke-width': 5, 'stroke-dash': 'dashed', arrow: true, name: "From St Paul's" }),
          label('BARBICAN', [-0.0937, 51.5236], 26),
          feat(ring([-73.5435, 45.4997], 0.22), { ...ink, 'stroke-dash': 'dotted', name: 'Habitat 67', description: '354 concrete boxes, stacked for Expo 67.' }),
          label('HABITAT 67', [-73.5435, 45.5024]),
          feat({ type: 'Point', coordinates: [5.3963, 43.2614] }, { 'marker-color': '#2121ff', 'marker-size': 'large', name: "Unité d'Habitation" }),
          label('UNITÉ', [5.3963, 43.2632]),
          feat(boxAt([-71.0592, 42.3597], [-71.0569, 42.3611]), { ...ink, stroke: '#ff4a1c', fill: '#ff4a1c', 'stroke-dash': 'dashed', name: 'Boston City Hall' }),
          label('CITY HALL', [-71.058, 42.3621]),
        ] } }],
      blocks: [
        { type: 'text', style: 'large', html: '<p>Brutalism takes its name from <em>béton brut</em>, French for raw concrete. No paint, no cladding, no apology: the marks of the wooden molds stay on the walls for good.</p>' },
        { type: 'statement', text: 'Honest materials. Heavy shapes. Nothing hidden, nothing pretty, nothing to apologize for.', cite: 'The idea, in one line' },
        { type: 'chapter', kicker: 'The idea', title: 'Build it raw', text: 'After the war, cities needed housing, schools and town halls fast. Concrete was cheap, strong and honest about what it was.', bg: '#dcff1e', fg: '#0b0b0b', align: 'left' },
        { type: 'stats', items: [{ value: '1952', label: "Le Corbusier's Unité d'Habitation opens in Marseille" }, { value: '354', label: 'concrete boxes stacked into Habitat 67' }, { value: '1968', label: 'Boston City Hall is finished' }],
          caption: 'Every block in this story is editable. Click one in the editor to change it.' },
        { type: 'chapter', kicker: 'Where to see it', title: 'Four buildings', text: 'Scroll on. The outlines, arrows and labels on this map were drawn with Data → Draw.', bg: '#0b0b0b', fg: '#efede6', align: 'left' },
        { type: 'scrollmap', layout: 'overlay', slides: [
          { html: "<h3>Unité d'Habitation, Marseille</h3><p>Le Corbusier's “vertical village”: 337 apartments, a shopping street halfway up and a running track on the roof.</p>",
            media: { type: 'map', view: v([5.3963, 43.2614], 15.2, { basemap: 'light', pitch: 50, bearing: -20, layers: ['lbrut'] }) } },
          { html: "<h3>Barbican Estate, London</h3><p>Three towers and a ring of terraces around a lake, built on land bombed in the Blitz. The dashed arrow walks you up from St Paul's.</p>",
            media: { type: 'map', view: v([-0.0945, 51.5185], 14.6, { basemap: 'light', pitch: 45, bearing: 15, layers: ['lbrut'] }) } },
          { html: "<h3>Habitat 67, Montreal</h3><p>Moshe Safdie's student thesis, built for Expo 67. Every home gets a garden on a neighbor's roof.</p>",
            media: { type: 'map', view: v([-73.5435, 45.5005], 15, { basemap: 'light', pitch: 40, layers: ['lbrut'] }) } },
          { html: '<h3>Boston City Hall</h3><p>An upside-down ziggurat over a brick plaza. Regularly called one of the ugliest buildings in America, and fiercely defended by the people who love it.</p>',
            media: { type: 'map', view: v([-71.058, 42.3605], 16, { basemap: 'light', pitch: 55, bearing: 30, layers: ['lbrut'] }) } },
        ] },
        { type: 'gallery', title: 'Texture study', text: 'Scroll down; the wall of photos slides past.', images: [
          { url: pic(101, 1400, 950), caption: 'Mass' }, { url: pic(1076, 1400, 950), caption: 'Angle' },
          { url: pic(1078, 1400, 950), caption: 'Repetition' }, { url: pic(1033, 1400, 950), caption: 'Circulation' } ] },
        { type: 'quote', text: 'Ugly is a matter of time.', cite: 'Field note' },
        { type: 'image', url: pic(1048, 1800, 1100), caption: 'Look up.', size: 'full', effect: 'parallax' },
        { type: 'separator' },
        { type: 'text', html: '<h2>Make it yours</h2><p>This look is the <strong>Brutalist</strong> theme. Switch any story to it under Story → Look &amp; feel. Swap the buildings for your own, and draw on the map with Data → Draw.</p>' },
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
