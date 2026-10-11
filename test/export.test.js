// Export tests: builds .zip and .war archives from a sample story using the real exporter code.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const PUBLIC = path.join(__dirname, '..', 'public');
const brand = { name: 'Waymark', tagline: 'test' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const io = {
  text: async (p) => (p === '/js/brand.js' ? `export const BRAND = ${JSON.stringify(brand)};\n` : fs.promises.readFile(path.join(PUBLIC, p), 'utf8')),
  bytes: async (url) => { if (url === '/uploads/pic.png') return { data: new Uint8Array(PNG), type: 'image/png' }; throw new Error('offline'); },
  layerData: async (l) => JSON.parse(await fs.promises.readFile(path.join(PUBLIC, l.url), 'utf8')),
  remote: async () => { throw new Error('offline'); },
};

// Reads a stored (uncompressed) zip into { name: Buffer }.
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(local + 26);
    files[name] = buf.subarray(local + 30 + lNameLen, local + 30 + lNameLen + size);
    p += 46 + nameLen;
  }
  return files;
}

const story = {
  title: 'Export Test </script> Story', subtitle: 'Sub', cover: { image: '/uploads/pic.png' },
  layers: [{ id: 'lm', name: 'Landmarks', url: '/data/landmarks.geojson', style: {} }],
  blocks: [{ type: 'text', html: '<p>Hello</p>' }, { type: 'image', url: 'https://example.invalid/photo.jpg' }, { type: 'stats', items: [{ value: '42', label: 'x' }] }],
};

test('zip export: one folder, embedded story and data, bundled reader', async () => {
  const { buildExport } = await import(pathToFileURL(path.join(PUBLIC, 'js', 'export-core.js')).href);
  const out = await buildExport(story, { format: 'zip', images: true, data: true, vendor: true }, io, brand);
  assert.equal(out.filename, 'export-test-script-story.zip');
  const files = unzip(Buffer.from(await out.blob.arrayBuffer()));
  const names = Object.keys(files);
  assert.ok(names.every((n) => n.startsWith('export-test-script-story/')), 'everything inside one folder');
  const html = files['export-test-script-story/index.html'].toString();
  assert.ok(!html.includes('</script> Story'), 'title cannot break out of the inline JSON');
  const json = JSON.parse(/id="story-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(json.cover.image, 'assets/pic.png');
  assert.equal(json.layers[0].data.type, 'FeatureCollection');
  assert.equal(json.layers[0].url, undefined);
  assert.equal(json.blocks[1].url, 'https://example.invalid/photo.jpg', 'uncopyable remote image stays a link');
  assert.ok(files['export-test-script-story/assets/pic.png'].equals(PNG));
  assert.ok(html.includes('https://unpkg.com/maplibre-gl@'), 'falls back to the CDN when the library cannot be bundled');
  assert.ok(out.warnings.some((w) => /map library/.test(w)));
  const reader = files['export-test-script-story/js/waymark-story.js'].toString();
  assert.doesNotMatch(reader, /^\s*(import|export)\s/m);
  new vm.Script(reader); // must be valid classic-script JavaScript
});

test('war export: web.xml at the root, no wrapping folder', async () => {
  const { buildExport } = await import(pathToFileURL(path.join(PUBLIC, 'js', 'export-core.js')).href);
  const out = await buildExport(story, { format: 'war', images: false, data: false, vendor: false }, io, brand);
  assert.equal(out.filename, 'export-test-script-story.war');
  const files = unzip(Buffer.from(await out.blob.arrayBuffer()));
  assert.ok(files['index.html'] && files['WEB-INF/web.xml'] && files['META-INF/MANIFEST.MF']);
  assert.match(files['WEB-INF/web.xml'].toString(), /<welcome-file>index\.html<\/welcome-file>/);
  const json = JSON.parse(/id="story-data">([\s\S]*?)<\/script>/.exec(files['index.html'].toString())[1]);
  assert.equal(json.layers[0].data.type, 'FeatureCollection', 'local data is always packed, even with data copying off');
});
