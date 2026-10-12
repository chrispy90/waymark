// Builds a new story from the answers in the "New story" wizard, and restyles stories with a look.
// No DOM here, so it can be tested in Node. Prompts (placeholder text that tells people what to write)
// are recorded in story.guide so the editor's checklist can tell which ones are still unchanged.

/** Looks bundle a theme with matching scroll motion, map style and chapter colors. */
export const LOOKS = {
  classic: {
    name: 'Classic', desc: 'Warm paper and elegant serif type. The original Waymark look.',
    theme: 'light', motion: 'subtle', basemap: 'streets', cover: 'parallax',
    chapters: [['#13233a', '#f3efe6'], ['#f1e7d6', '#2a1d10'], ['#2f4a3a', '#f2efe4']],
  },
  night: {
    name: 'Night', desc: 'Dark and cinematic, so photos and maps glow.',
    theme: 'dark', motion: 'subtle', basemap: 'dark', cover: 'zoom',
    chapters: [['#0e2233', '#e6f0f7'], ['#2b1630', '#f6e9f2'], ['#1c2a1f', '#e9f3ea']],
  },
  brutalist: {
    name: 'Brutalist', desc: 'Raw type, hard edges and loud color.',
    theme: 'brutalist', motion: 'expressive', basemap: 'light', cover: 'zoom',
    chapters: [['#dcff1e', '#0b0b0b'], ['#0b0b0b', '#efede6'], ['#2121ff', '#ffffff']],
  },
};

/** The kinds of story the wizard can set up. `places`: 'many' | 'one' | false. */
export const KINDS = {
  journey: { name: 'A journey', desc: 'The map glides from place to place as readers scroll.', icon: 'scrollmap', places: 'many' },
  tour: { name: 'A walking tour', desc: 'Numbered stops that readers step through, each with a photo.', icon: 'route', places: 'many' },
  essay: { name: 'An illustrated essay', desc: 'Full-screen chapters, big type and photos. Maps are optional.', icon: 'sparkle', places: false, chapters: true },
  data: { name: 'A data story', desc: 'One big map of live or uploaded data, with numbers and context.', icon: 'chart', places: 'one' },
  blank: { name: 'Start from scratch', desc: 'Just a title and an empty page.', icon: 'file', places: false },
};

/** Optional extra sections. */
export const EXTRAS = {
  statement: { name: 'A big statement', desc: 'One sentence in huge type that lights up as readers scroll.' },
  numbers: { name: 'Big numbers', desc: 'Two or three figures that count up.' },
  gallery: { name: 'A photo gallery', desc: 'A row of photos that slides sideways.' },
  quote: { name: 'A quote', desc: 'A line from someone in the story.' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const view = (center, zoom, look, extra = {}) => ({ center, zoom, bearing: 0, pitch: 0, basemap: look.basemap, markers: [], layers: [], ...extra });

// A view that fits every place: center of the bounding box, zoomed so the widest side fits.
export function fitView(places, look) {
  const lngs = places.map((p) => p.lngLat[0]);
  const lats = places.map((p) => p.lngLat[1]);
  const [w, e, s, n] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
  const span = Math.max(e - w, (n - s) * 1.6, 0.01);
  const zoom = Math.max(1, Math.min(13, Math.log2(360 / span) - 0.6));
  return view([+((w + e) / 2).toFixed(5), +((s + n) / 2).toFixed(5)], +zoom.toFixed(2), look,
    { markers: places.map((p) => ({ lngLat: p.lngLat, title: p.name })) });
}

/**
 * answers: { kind, look, title, subtitle, author, cover, places: [{ name, lngLat }], chapters: [title],
 *            extras: [key], guide: true }
 */
export function buildStory(answers) {
  const look = LOOKS[answers.look] || LOOKS.classic;
  const kind = KINDS[answers.kind] ? answers.kind : 'blank';
  const places = (answers.places || []).filter((p) => Array.isArray(p.lngLat) && p.lngLat.length === 2).slice(0, 20);
  const extras = new Set(kind === 'blank' ? [] : answers.extras || []);
  const prompts = [];
  const ask = (text) => { prompts.push(text); return text; };
  const para = (text) => `<p>${esc(ask(text))}</p>`;
  let chapterNo = 0;
  const chapter = (title, text) => {
    const [bg, fg] = look.chapters[chapterNo % look.chapters.length];
    chapterNo += 1;
    return { type: 'chapter', kicker: `Chapter ${chapterNo}`, title, text: text ? ask(text) : '', bg, fg, align: look.theme === 'brutalist' ? 'left' : 'center' };
  };
  const blocks = [];
  const add = (...b) => blocks.push(...b);

  if (kind === 'blank') {
    add({ type: 'text', html: para('Start writing here. Press / to add maps, photos and scroll effects.') });
  } else {
    add({ type: 'text', style: 'large', html: para('Open with a sentence or two that makes people want to keep reading.') });
  }
  if (extras.has('statement') && kind !== 'essay') add({ type: 'statement', text: ask('Put the one idea readers should remember here, in a single sentence.'), cite: '' });

  if (kind === 'journey') {
    const slides = places.length ? [
      ...(places.length > 1 ? [{ html: `<h3>${esc(ask('Where this story happens'))}</h3>${para('Give readers the big picture before you zoom in.')}`,
        media: { type: 'map', view: fitView(places, look) } }] : []),
      ...places.map((p) => ({ html: `<h3>${esc(p.name)}</h3>${para(`Write about ${p.name}: what happened here, and why it matters.`)}`,
        media: { type: 'map', view: view(p.lngLat, 13, look, { pitch: 40, markers: [{ lngLat: p.lngLat, title: p.name }] }) } })),
    ] : [1, 2].map((n) => ({ html: `<h3>Place ${n}</h3>${para(`Write about place ${n}. Then click "Set map view" to choose where the map goes.`)}`,
      media: { type: 'map', view: view([0, 20], 1.5, look) } }));
    add({ type: 'scrollmap', layout: 'overlay', slides });
  }

  if (kind === 'tour') {
    const stops = places.length ? places : [{ name: 'First stop', lngLat: [-77.0365, 38.8977] }];
    add({ type: 'stops', basemap: look.basemap, zoom: 15, places: stops.map((p) => ({ title: p.name, lngLat: p.lngLat, image: '',
      html: para(`Describe ${p.name}. Add a photo of it too.`) })) });
  }

  if (kind === 'essay') {
    const titles = (answers.chapters || []).map((t) => String(t).trim()).filter(Boolean);
    (titles.length ? titles : ['The beginning', 'The turn', 'What it means']).slice(0, 12).forEach((t, i) => {
      add(chapter(t, 'One line that sets up this chapter.'), { type: 'text', html: para(`Write chapter ${i + 1} here.`) });
      if (i === 0 && extras.has('statement')) add({ type: 'statement', text: ask('Put the one idea readers should remember here, in a single sentence.'), cite: '' });
      if (i === 0) add({ type: 'image', url: '', caption: ask('Add a photo, then write its caption here.'), size: 'full', effect: 'parallax' });
    });
  }

  if (kind === 'data') {
    const center = places[0]?.lngLat;
    add({ type: 'map', size: 'full', caption: ask('Say what the map shows and where the data comes from.'),
      view: center ? view(center, 9, look, { legend: true }) : view([-98.5, 39.5], 3.3, look, { legend: true }) });
    add({ type: 'text', html: `<h2>${esc(ask('What the map shows'))}</h2>${para('Explain the pattern readers should notice. Add data from Data → Browse public data, or upload your own.')}` });
    extras.add('numbers');
  }

  if (extras.has('numbers')) {
    add({ type: 'stats', items: [{ value: '100', label: ask('what the first number means') }, { value: '25%', label: ask('what the second number means') }],
      caption: ask('Where these numbers come from.') });
  }
  if (extras.has('gallery')) {
    add({ type: 'gallery', title: ask('A title for your photos'), text: '', images: [{ url: '', caption: '' }, { url: '', caption: '' }, { url: '', caption: '' }] });
  }
  if (extras.has('quote')) add({ type: 'quote', text: ask('A line someone said that captures the story.'), cite: '' });
  if (kind !== 'blank') add({ type: 'text', html: `<h2>${esc(ask('Wrap up'))}</h2>${para('End with what it all means, or what readers can do next.')}` });

  const story = {
    title: String(answers.title || '').trim() || 'Untitled story',
    subtitle: String(answers.subtitle || '').trim(),
    author: String(answers.author || '').trim(),
    theme: look.theme, motion: look.motion,
    cover: { image: answers.cover || '', effect: look.cover },
    layers: [], blocks,
  };
  if (answers.guide !== false) story.guide = { kind, look: answers.look in LOOKS ? answers.look : 'classic', prompts };
  return story;
}

/** Prompts the author hasn't replaced yet. */
export function openPrompts(story) {
  const text = JSON.stringify([story.blocks, story.credits]);
  return (story.guide?.prompts || []).filter((p) => text.includes(JSON.stringify(p).slice(1, -1)) || text.includes(esc(p)));
}

/** Restyles a story with a look: theme, motion, chapter colors and every map's basemap. Returns what changed. */
export function applyLook(story, key) {
  const look = LOOKS[key];
  if (!look) return { chapters: 0, maps: 0 };
  story.theme = look.theme;
  story.motion = look.motion;
  let chapters = 0;
  let maps = 0;
  const vectorBasemaps = new Set(['streets', 'bright', 'light', 'dark']); // imagery basemaps are kept on purpose
  const restyle = (v) => { if (v && (!v.basemap || vectorBasemaps.has(v.basemap)) && v.basemap !== look.basemap) { v.basemap = look.basemap; maps += 1; } };
  (story.blocks || []).forEach((b) => {
    if (b.type === 'chapter') {
      const [bg, fg] = look.chapters[chapters % look.chapters.length];
      Object.assign(b, { bg, fg });
      chapters += 1;
    }
    restyle(b.view);
    (b.slides || []).forEach((s) => restyle(s.media?.view));
    if (b.type === 'stops' && vectorBasemaps.has(b.basemap || 'streets') && b.basemap !== look.basemap) { b.basemap = look.basemap; maps += 1; }
  });
  if (story.guide) story.guide.look = key;
  return { chapters, maps };
}

/** The look a story most resembles, for preselecting it in the editor. */
export const lookOf = (story) => story.guide?.look || Object.keys(LOOKS).find((k) => LOOKS[k].theme === story.theme) || 'classic';
