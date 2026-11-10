// Zipped shapefiles are read in the browser; these check the zip, .shp, .dbf and .prj readers, and the route decoder.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const zlib = require('zlib');
const { pathToFileURL } = require('url');

const js = (name) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', name)).href);

// A .shp with one point and one square polygon that has a hole.
function shp() {
  const point = Buffer.alloc(20);
  point.writeUInt32LE(1, 0); point.writeDoubleLE(-77.03, 4); point.writeDoubleLE(38.9, 12);
  const outer = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]; // clockwise
  const hole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]; // counter-clockwise
  const poly = Buffer.alloc(4 + 32 + 8 + 8 + 16 * 10);
  poly.writeUInt32LE(5, 0);
  poly.writeUInt32LE(2, 36); poly.writeUInt32LE(10, 40);
  poly.writeUInt32LE(0, 44); poly.writeUInt32LE(5, 48);
  [...outer, ...hole].forEach(([x, y], i) => { poly.writeDoubleLE(x, 52 + i * 16); poly.writeDoubleLE(y, 60 + i * 16); });
  const record = (n, body) => { const head = Buffer.alloc(8); head.writeInt32BE(n, 0); head.writeInt32BE(body.length / 2, 4); return Buffer.concat([head, body]); };
  const header = Buffer.alloc(100);
  header.writeInt32BE(9994, 0);
  return Buffer.concat([header, record(1, point), record(2, poly)]);
}

function dbf(rows) {
  const fields = [['NAME', 'C', 12], ['POP', 'N', 8], ['OPEN', 'L', 1], ['SEEN', 'D', 8]];
  const headerLen = 32 + fields.length * 32 + 1;
  const recordLen = 1 + fields.reduce((n, f) => n + f[2], 0);
  const head = Buffer.alloc(headerLen);
  head[0] = 3; head.writeUInt32LE(rows.length, 4); head.writeUInt16LE(headerLen, 8); head.writeUInt16LE(recordLen, 10);
  fields.forEach(([name, type, len], i) => { head.write(name, 32 + i * 32, 'latin1'); head.write(type, 32 + i * 32 + 11, 'latin1'); head[32 + i * 32 + 16] = len; });
  head[headerLen - 1] = 0x0d;
  const recs = rows.map((r) => Buffer.from(` ${fields.map(([, type, len], i) => (type === 'N' ? String(r[i]).padStart(len) : String(r[i]).padEnd(len))).join('')}`, 'latin1'));
  return Buffer.concat([head, ...recs]);
}

// A zip with deflated entries, as most tools write them.
function zipOf(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of files) {
    const body = zlib.deflateRawSync(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.write(name, 30);
    const c = Buffer.alloc(46 + name.length);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42); c.write(name, 46);
    locals.push(local, body);
    central.push(c);
    offset += local.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

test('a zipped shapefile becomes GeoJSON with its attributes', async () => {
  const { readShapefileZip } = await js('shapefile.js');
  const zip = zipOf([['data/towns.shp', shp()], ['data/towns.dbf', dbf([['Testville', 1200, 'T', '20261102'], ['Squareton', 55, 'F', '']])], ['data/readme.txt', Buffer.from('hi')]]);
  const [set] = await readShapefileZip(new Uint8Array(zip));
  assert.equal(set.name, 'towns');
  const [pt, poly] = set.data.features;
  assert.deepEqual(pt.geometry, { type: 'Point', coordinates: [-77.03, 38.9] });
  assert.deepEqual(pt.properties, { NAME: 'Testville', POP: 1200, OPEN: true, SEEN: '2026-11-02' });
  assert.equal(poly.geometry.type, 'Polygon');
  assert.equal(poly.geometry.coordinates.length, 2, 'the hole stays inside its outline');
  assert.deepEqual(poly.properties, { NAME: 'Squareton', POP: 55, OPEN: false });
  await assert.rejects(readShapefileZip(new Uint8Array(zipOf([['notes.txt', Buffer.from('x')]]))), /No \.shp/);
  await assert.rejects(readShapefileZip(new Uint8Array(Buffer.from('not a zip at all, just some text'))), /isn't a zip/);
});

test('.prj files: degrees pass through, Web Mercator and UTM are converted, others are refused', async () => {
  const { projectionFromPrj, readShapefileZip } = await js('shapefile.js');
  assert.deepEqual(projectionFromPrj('')([1, 2]), [1, 2]);
  assert.deepEqual(projectionFromPrj('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]')([1, 2]), [1, 2]);
  const merc = projectionFromPrj('PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984"],PROJECTION["Mercator_Auxiliary_Sphere"]]')([1113194.9079, 2273030.927]);
  assert.ok(Math.abs(merc[0] - 10) < 1e-5 && Math.abs(merc[1] - 20) < 1e-5, String(merc));
  const utm = projectionFromPrj('PROJCS["WGS_1984_UTM_Zone_18N",GEOGCS["GCS_WGS_1984"],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-75.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]')([323394.3, 4307395.6]);
  assert.ok(Math.abs(utm[0] + 77.0365) < 0.0005 && Math.abs(utm[1] - 38.8977) < 0.0005, String(utm));
  assert.equal(projectionFromPrj('PROJCS["NAD_1983_StatePlane_New_York_Long_Island",PROJECTION["Lambert_Conformal_Conic"]]'), null);
  const zip = zipOf([['a.shp', shp()], ['a.prj', Buffer.from('PROJCS["x",PROJECTION["Lambert_Conformal_Conic"]]')]]);
  await assert.rejects(readShapefileZip(new Uint8Array(zip)), /coordinate system/);
});

test('routes from the routing service are decoded', async () => {
  globalThis.turf ||= {};
  const { decodePolyline6, TOOLS, TOOL_GROUPS } = await js('analysis.js');
  // encodes (38.5, -120.2), (40.7, -120.95), (43.252, -126.453) at six decimal places
  assert.deepEqual(decodePolyline6('_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI'), [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  for (const id of ['route', 'traveltime']) assert.ok(TOOL_GROUPS.includes(TOOLS[id].group), id);
  await assert.rejects(TOOLS.route.run({ input: { features: [{ geometry: { type: 'Point', coordinates: [0, 0] } }] } }, {}), /at least two points/);
});
