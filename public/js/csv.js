// Minimal RFC 4180 CSV parser + point conversion for spreadsheets with lat/long columns.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const LAT = /^(lat|latitude|y|lat_dd)$/i;
const LON = /^(lon|lng|long|longitude|x|lon_dd)$/i;

export function csvToGeoJSON(text) {
  const [header, ...rows] = parseCsv(text.replace(/^﻿/, ''));
  if (!header) throw new Error('Empty CSV');
  const names = header.map((h) => h.trim());
  const lat = names.findIndex((n) => LAT.test(n));
  const lon = names.findIndex((n) => LON.test(n));
  if (lat < 0 || lon < 0) throw new Error('CSV needs latitude and longitude columns (e.g. "lat" and "lon")');
  const features = [];
  rows.forEach((r) => {
    const y = parseFloat(r[lat]);
    const x = parseFloat(r[lon]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const properties = {};
    names.forEach((n, i) => {
      if (i === lat || i === lon) return;
      const v = r[i]?.trim() ?? '';
      properties[n] = v !== '' && Number.isFinite(+v) ? +v : v;
    });
    features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [x, y] } });
  });
  return { type: 'FeatureCollection', features };
}
