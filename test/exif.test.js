// Dropped photos become tour stops at the place they were taken, in the order they were taken.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'exif.js')).href);

// Builds a minimal JPEG whose EXIF holds a GPS position and a DateTimeOriginal, in either byte order.
function jpegWithExif({ lat, lng, when, little = false }) {
  const tiff = [];
  const w16 = (o, n) => { const b = Buffer.alloc(2); little ? b.writeUInt16LE(n) : b.writeUInt16BE(n); b.copy(tiffBuf, o); };
  const w32 = (o, n) => { const b = Buffer.alloc(4); little ? b.writeUInt32LE(n) : b.writeUInt32BE(n); b.copy(tiffBuf, o); };
  const tiffBuf = Buffer.alloc(400);
  tiffBuf.write(little ? 'II' : 'MM', 0, 'ascii');
  w16(2, 42); w32(4, 8);
  // IFD0 at 8: GPS pointer + Exif pointer
  w16(8, 2);
  w16(10, 0x8825); w16(12, 4); w32(14, 1); w32(18, 60);
  w16(22, 0x8769); w16(24, 4); w32(26, 1); w32(30, 200);
  w32(34, 0);
  // GPS IFD at 60: LatRef, Lat, LngRef, Lng
  const dms = (x) => { const a = Math.abs(x); const d = Math.floor(a); const m = Math.floor((a - d) * 60); const s = ((a - d) * 60 - m) * 60; return [[d, 1], [m, 1], [Math.round(s * 1000), 1000]]; };
  w16(60, 4);
  const entry = (at, tag, type, count, value) => { w16(at, tag); w16(at + 2, type); w32(at + 4, count); w32(at + 8, value); };
  entry(62, 1, 2, 2, 0); tiffBuf.write(lat < 0 ? 'S' : 'N', 70, 'ascii');
  entry(74, 2, 5, 3, 120);
  entry(86, 3, 2, 2, 0); tiffBuf.write(lng < 0 ? 'W' : 'E', 94, 'ascii');
  entry(98, 4, 5, 3, 150);
  w32(110, 0);
  dms(lat).forEach(([n, d], i) => { w32(120 + i * 8, n); w32(124 + i * 8, d); });
  dms(lng).forEach(([n, d], i) => { w32(150 + i * 8, n); w32(154 + i * 8, d); });
  // Exif IFD at 200: DateTimeOriginal
  w16(200, 1); entry(202, 0x9003, 2, 20, 220); w32(214, 0);
  tiffBuf.write(`${when}\0`, 220, 'ascii');
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiffBuf]);
  const head = Buffer.from([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff]);
  const b = Buffer.concat([head, app1, Buffer.from([0xff, 0xd9])]);
  void tiff;
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}

test('reads GPS position and time taken, in both byte orders', async () => {
  const { readPhotoMeta } = await load();
  for (const little of [false, true]) {
    const m = readPhotoMeta(jpegWithExif({ lat: 38.6916, lng: -9.2160, when: '2026:06:14 09:30:05', little }));
    assert.ok(Math.abs(m.lngLat[0] - -9.2160) < 1e-4 && Math.abs(m.lngLat[1] - 38.6916) < 1e-4, JSON.stringify(m));
    assert.equal(m.takenAt, Date.UTC(2026, 5, 14, 9, 30, 5));
  }
  const south = readPhotoMeta(jpegWithExif({ lat: -33.8568, lng: 151.2153, when: '2025:01:02 03:04:05' }));
  assert.ok(south.lngLat[1] < 0 && south.lngLat[0] > 0);
});

test('photos without EXIF, and non-JPEGs, simply have no location', async () => {
  const { readPhotoMeta } = await load();
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).buffer;
  assert.deepEqual(readPhotoMeta(png), { lngLat: null, takenAt: null });
  const bare = Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]).buffer;
  assert.deepEqual(readPhotoMeta(bare), { lngLat: null, takenAt: null });
  assert.deepEqual(readPhotoMeta(new ArrayBuffer(0)), { lngLat: null, takenAt: null });
});

test('file names become stop titles, camera names become blank', async () => {
  const { titleFromFilename } = await load();
  assert.equal(titleFromFilename('IMG_2041 - Belém tower.jpg'), 'Belém tower');
  assert.equal(titleFromFilename('Old_town_square.JPG'), 'Old town square');
  assert.equal(titleFromFilename('IMG_2041.jpg'), '');
  assert.equal(titleFromFilename('PXL_20260614_093005123.jpg'), '');
  assert.equal(titleFromFilename('20260614_093005.jpg'), '');
});
