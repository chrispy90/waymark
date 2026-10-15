// Reads where and when a photo was taken from its EXIF data (JPEG only), so dropped photos can become tour stops.
// Runs on the original file, before upload: uploads are re-encoded, which strips EXIF (and with it the location).
// No DOM here, so it can be tested in Node.

/** Returns { lngLat: [lng, lat] | null, takenAt: ms | null } for a JPEG's bytes. Never throws. */
export function readPhotoMeta(buffer) {
  try {
    const v = new DataView(buffer);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return empty();
    let off = 2;
    while (off + 4 <= v.byteLength) {
      const marker = v.getUint16(off);
      const size = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10); // "Exif\0\0"
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break; // start of image data: no EXIF
      off += 2 + size;
    }
  } catch { /* malformed EXIF is treated as missing */ }
  return empty();
}

const empty = () => ({ lngLat: null, takenAt: null });

function parseTiff(v, start) {
  const little = v.getUint16(start) === 0x4949; // "II" = Intel byte order
  const u16 = (o) => v.getUint16(start + o, little);
  const u32 = (o) => v.getUint32(start + o, little);
  if (u16(2) !== 42) return empty();
  // Reads one IFD into { tag: { type, count, valueOffset } }; offsets are relative to the TIFF header.
  const ifd = (at) => {
    const tags = {};
    const n = u16(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      tags[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 };
    }
    return tags;
  };
  const ptr = (t) => u32(t.at);
  const ascii = (t) => {
    const at = t.count > 4 ? ptr(t) : t.at;
    let s = '';
    for (let i = 0; i < t.count - 1; i++) s += String.fromCharCode(v.getUint8(start + at + i));
    return s;
  };
  const rationals = (t) => {
    const at = ptr(t);
    return Array.from({ length: t.count }, (_, i) => { const d = u32(at + i * 8 + 4); return d ? u32(at + i * 8) / d : 0; });
  };
  const ifd0 = ifd(u32(4));
  let lngLat = null;
  let takenAt = null;
  if (ifd0[0x8825]) { // GPS IFD
    const g = ifd(ptr(ifd0[0x8825]));
    if (g[2] && g[4]) {
      const dms = ([d, m, s]) => d + m / 60 + s / 3600;
      let lat = dms(rationals(g[2]));
      let lng = dms(rationals(g[4]));
      if (g[1] && ascii(g[1]).toUpperCase() === 'S') lat = -lat;
      if (g[3] && ascii(g[3]).toUpperCase() === 'W') lng = -lng;
      // 0,0 is what some cameras write when they had no fix
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) lngLat = [+lng.toFixed(6), +lat.toFixed(6)];
    }
  }
  if (ifd0[0x8769]) { // Exif sub-IFD: DateTimeOriginal, "YYYY:MM:DD HH:MM:SS"
    const x = ifd(ptr(ifd0[0x8769]));
    const t = x[0x9003] || x[0x9004];
    const m = t && /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(ascii(t));
    if (m) takenAt = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }
  return { lngLat, takenAt };
}

/** "IMG_2041 - Belém tower.jpg" → "Belém tower"; camera-style names become "". */
export function titleFromFilename(name) {
  const base = String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim();
  const cleaned = base.replace(/^(img|dsc|dscn|pxl|photo|image|mvimg)[\s-]*\d+[\s-]*/i, '').replace(/^\d{8}[\s_-]?\d{6}\s*/, '').replace(/^[-\s]+/, '').trim();
  return /^\d*$/.test(cleaned) ? '' : cleaned;
}
