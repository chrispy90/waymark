// Tests for Hosted Feature Layers attribute table operations, chart aggregation, new themes, and business GIS tools.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = (name) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', name)).href);

test('attribute table schema management, inline edits, field calculator, and CSV export', async () => {
  const {
    isHostedLayer, hostedLayerIdOf, getLayerSchema, coerceValue,
    addSchemaField, renameSchemaField, deleteSchemaField,
    addFeatureRow, deleteFeatureRow, calculateField, columnStats, featuresToCSV,
  } = await load('table.js');

  assert.equal(isHostedLayer({ hostedLayerId: 'abc123' }), true);
  assert.equal(isHostedLayer({ url: '/api/layers/xyz987/geojson' }), true);
  assert.equal(hostedLayerIdOf({ url: '/api/public/layers/pub456.geojson' }), 'pub456');

  const fc = {
    type: 'FeatureCollection',
    metadata: { attribution: 'Census 2026', fields: [{ name: 'site', type: 'string', alias: 'Site' }, { name: 'revenue', type: 'number', alias: 'Revenue' }] },
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-73.985, 40.748] }, properties: { site: 'Midtown', revenue: 1200 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-74.006, 40.712] }, properties: { site: 'Downtown', revenue: 800 } },
    ],
  };

  assert.equal(getLayerSchema(fc).length, 2);
  assert.equal(coerceValue('42.5', 'number'), 42.5);
  assert.equal(coerceValue('true', 'boolean'), true);

  // Add field
  addSchemaField(fc, { name: 'tax_revenue', type: 'number', defaultValue: 0 });
  assert.equal(getLayerSchema(fc).length, 3);
  assert.equal(fc.features[0].properties.tax_revenue, 0);

  // Field calculator: math mode + formula mode + spatial coordinate helper
  calculateField(fc, 'tax_revenue', { mode: 'math', fieldA: 'revenue', op: '*', fieldB: '1.1' });
  assert.equal(fc.features[0].properties.tax_revenue, 1320);
  assert.equal(fc.features[1].properties.tax_revenue, 880);

  addSchemaField(fc, { name: 'lon', type: 'number' });
  calculateField(fc, 'lon', '$LON');
  assert.equal(fc.features[0].properties.lon, -73.985);

  // Rename field
  renameSchemaField(fc, 'tax_revenue', 'gross_rev');
  assert.equal(fc.features[0].properties.gross_rev, 1320);
  assert.equal('tax_revenue' in fc.features[0].properties, false);

  // Add and delete feature rows
  addFeatureRow(fc, { center: [-73.95, 40.8] });
  assert.equal(fc.features.length, 3);
  deleteFeatureRow(fc, 2);
  assert.equal(fc.features.length, 2);

  // Column stats
  const stats = columnStats(fc, 'revenue');
  assert.equal(stats.kind, 'number');
  assert.equal(stats.sum, 2000);
  assert.equal(stats.avg, 1000);

  // Delete field
  deleteSchemaField(fc, 'lon');
  assert.equal('lon' in fc.features[0].properties, false);

  // CSV export includes lon, lat and attributes
  const csv = featuresToCSV(fc);
  assert.match(csv, /site,revenue,gross_rev,longitude,latitude/);
  assert.match(csv, /Midtown,1200,1320,-73\.985,40\.748/);
});

test('chart block series computation for manual rows and live layer aggregation', async () => {
  const { computeChartSeries } = await load('render.js');

  const manual = computeChartSeries({
    items: [{ label: 'Retail', value: 60 }, { label: 'Industrial', value: 40 }],
  });
  assert.equal(manual.total, 100);
  assert.equal(manual.series[0].value, 60);

  const fc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: null, properties: { region: 'East', sales: 150 } },
      { type: 'Feature', geometry: null, properties: { region: 'East', sales: 250 } },
      { type: 'Feature', geometry: null, properties: { region: 'West', sales: 180 } },
    ],
  };
  const liveSum = computeChartSeries({ layer: 'l1', groupField: 'region', valueField: 'sales', stat: 'sum' }, fc);
  assert.equal(liveSum.series.length, 2);
  assert.deepEqual([liveSum.series[0].label, liveSum.series[0].value], ['East', 400]);
  assert.deepEqual([liveSum.series[1].label, liveSum.series[1].value], ['West', 180]);
});

test('multi-ring trade areas, hub-and-spoke spider lines, spatial clusters, and attribute table join', async () => {
  const { TOOLS } = await load('analysis.js');

  const sites = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-74.0, 40.7] }, properties: { id: 'S1', name: 'Store A' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-74.002, 40.701] }, properties: { id: 'S2', name: 'Store B' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-74.001, 40.7005] }, properties: { id: 'S3', name: 'Store C' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-118.25, 34.05] }, properties: { id: 'S4', name: 'Outlier LA' } },
    ],
  };
  const hubs = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-74.05, 40.72] }, properties: { name: 'NJ Depot' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-118.2, 34.0] }, properties: { name: 'CA Depot' } },
    ],
  };

  // 1. Multi-ring trade areas
  const ringsRes = TOOLS.rings.run({ input: { type: 'FeatureCollection', features: [sites.features[0]] } }, { radii: '1, 3, 5', units: 'kilometers', donuts: true });
  assert.equal(ringsRes.data.features.length, 3);
  assert.equal(ringsRes.data.features[0].geometry.coordinates.length, 2, 'outer ring has inner donut hole');
  assert.equal(ringsRes.data.features[2].geometry.coordinates.length, 1, 'innermost disk has single ring');

  // 2. Hub & spoke desire lines
  const spiderRes = TOOLS.spider.run({ origins: sites, hubs }, { units: 'kilometers', maxDist: 0 });
  assert.equal(spiderRes.data.features.length, 4);
  assert.equal(spiderRes.data.features[0].geometry.type, 'LineString');
  assert.equal(spiderRes.data.features[0].properties.hub_name, 'NJ Depot');
  assert.equal(spiderRes.data.features[3].properties.hub_name, 'CA Depot');
  assert.ok(spiderRes.data.features[0].properties.distance_km > 0);

  // 3. Spatial density clusters (DBSCAN)
  const clusterRes = TOOLS.clusters.run({ input: sites }, { distance: 2, units: 'kilometers', minPoints: 3, keepNoise: false });
  assert.equal(clusterRes.data.features.length, 3, '3 NY stores form Cluster 1, LA outlier excluded');
  assert.equal(clusterRes.data.features[0].properties.cluster_id, 'Cluster 1');
  assert.equal(clusterRes.data.features[0].properties.cluster_size, 3);

  // 4. Join attributes by field
  const metrics = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: null, properties: { store_code: 'S1', annual_sales: 950000 } },
      { type: 'Feature', geometry: null, properties: { store_code: 'S2', annual_sales: 720000 } },
    ],
  };
  const joinRes = TOOLS.tablejoin.run({ input: sites, join: metrics }, { targetField: 'id', joinField: 'store_code', keepUnmatched: false });
  assert.equal(joinRes.data.features.length, 2);
  assert.equal(joinRes.data.features[0].properties.join_annual_sales, 950000);
});

test('bivariate 3x3 choropleth colorRamp computes quantile breaks and matrix expression', async () => {
  const { colorRamp, BIVARIATE_SCHEMES } = await import('../public/js/maps.js');
  const fc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { income: 30, risk: 10 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { income: 60, risk: 50 }, geometry: { type: 'Point', coordinates: [1, 1] } },
      { type: 'Feature', properties: { income: 90, risk: 90 }, geometry: { type: 'Point', coordinates: [2, 2] } },
    ],
  };
  const layer = { style: { mode: 'bivariate', field: 'income', field2: 'risk', bivariatePalette: 'blue-orange' } };
  const { expr, legend } = colorRamp(layer, fc);
  assert.equal(legend.type, 'bivariate');
  assert.equal(legend.fieldA, 'income');
  assert.equal(legend.fieldB, 'risk');
  assert.deepEqual(legend.grid, BIVARIATE_SCHEMES['blue-orange'].grid);
  assert.equal(expr[0], 'case');
});

test('remote sensing: satellite sensors catalog and STAC scene conversion', async () => {
  const { SATELLITE_SENSORS } = await load('maps.js');
  const keys = Object.keys(SATELLITE_SENSORS);
  assert.ok(keys.length >= 7);
  for (const k of keys) {
    const s = SATELLITE_SENSORS[k];
    assert.ok(s.label && s.attribution, `${k} needs label and attribution`);
    assert.match(s.tiles, /\{date\}/, `${k} tiles must be date-templated for time travel`);
    assert.match(s.tiles, /\{z\}.*\{y\}.*\{x\}/);
    assert.ok(Number.isFinite(s.maxzoom));
  }

  const { stacItemsToGeoJSON } = await load('catalog.js');
  const fc = stacItemsToGeoJSON([
    {
      id: 'S2B_18SUJ_20240801_0_L2A',
      geometry: { type: 'Polygon', coordinates: [[[-77, 38], [-76, 38], [-76, 39], [-77, 39], [-77, 38]]] },
      properties: { datetime: '2024-08-01T15:59:12Z', 'eo:cloud_cover': 3.456, platform: 'sentinel-2b', 'mgrs:utm_zone': 18, 'mgrs:latitude_band': 'S', 'mgrs:grid_square': 'UJ', 'view:sun_elevation': 61.23 },
      assets: { thumbnail: { href: 'https://example.com/thumb.jpg' }, visual: { href: 'https://example.com/visual.tif' } },
    },
    { id: 'no-geometry', properties: {} },
  ]);
  assert.equal(fc.type, 'FeatureCollection');
  assert.equal(fc.features.length, 1);
  const p = fc.features[0].properties;
  assert.equal(p.scene_id, 'S2B_18SUJ_20240801_0_L2A');
  assert.equal(p.date, '2024-08-01');
  assert.equal(p.cloud_cover_pct, 3.5);
  assert.equal(p.mgrs_tile, '18SUJ');
  assert.equal(p.sun_elevation, 61.2);
  assert.equal(p.visual_cog_url, 'https://example.com/visual.tif');
  assert.match(fc.metadata.attribution, /Sentinel-2/);
});

test('universal GIS file ingest: KML and GPX parsing into GeoJSON FeatureCollections', async () => {
  const { parseKML, parseGPX, fileKind } = await load('gisfiles.js');

  assert.equal(fileKind('trail.kml'), 'kml');
  assert.equal(fileKind('hike.gpx'), 'gpx');
  assert.equal(fileKind('photo.jpg'), 'photo');
  assert.equal(fileKind('points.geojson'), 'geojson');
  assert.equal(fileKind('data.csv'), 'csv');

  // KML parsing test
  const sampleKml = `<?xml version="1.0" encoding="UTF-8"?>
  <kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>
      <Placemark>
        <name>Summit Station</name>
        <description>High altitude sensor</description>
        <ExtendedData>
          <Data name="temp_c"><value>14.5</value></Data>
        </ExtendedData>
        <Point><coordinates>-105.2705,40.0150,2100</coordinates></Point>
      </Placemark>
      <Placemark>
        <name>Ridge Trail</name>
        <LineString>
          <coordinates>-105.27,40.01 -105.28,40.02 -105.29,40.03</coordinates>
        </LineString>
      </Placemark>
    </Document>
  </kml>`;

  const kmlFc = parseKML(sampleKml);
  assert.equal(kmlFc.type, 'FeatureCollection');
  assert.equal(kmlFc.features.length, 2);
  assert.equal(kmlFc.features[0].geometry.type, 'Point');
  assert.deepEqual(kmlFc.features[0].geometry.coordinates, [-105.2705, 40.015, 2100]);
  assert.equal(kmlFc.features[0].properties.name, 'Summit Station');
  assert.equal(kmlFc.features[0].properties.temp_c, 14.5);
  assert.equal(kmlFc.features[1].geometry.type, 'LineString');
  assert.equal(kmlFc.features[1].geometry.coordinates.length, 3);

  // GPX parsing test
  const sampleGpx = `<?xml version="1.0" encoding="UTF-8"?>
  <gpx version="1.1" creator="Waymark Test" xmlns="http://www.topografix.com/GPX/1/1">
    <wpt lat="37.7749" lon="-122.4194">
      <ele>15.2</ele>
      <name>San Francisco Start</name>
    </wpt>
    <trk>
      <name>Pacific Ridge Route</name>
      <trkseg>
        <trkpt lat="37.77" lon="-122.42"><ele>10.0</ele></trkpt>
        <trkpt lat="37.78" lon="-122.43"><ele>50.0</ele></trkpt>
        <trkpt lat="37.79" lon="-122.44"><ele>30.0</ele></trkpt>
      </trkseg>
    </trk>
  </gpx>`;

  const gpxFc = parseGPX(sampleGpx);
  assert.equal(gpxFc.type, 'FeatureCollection');
  assert.equal(gpxFc.features.length, 2);
  assert.equal(gpxFc.features[0].geometry.type, 'Point');
  assert.equal(gpxFc.features[0].properties.name, 'San Francisco Start');
  assert.equal(gpxFc.features[0].properties.elevation_m, 15.2);
  assert.equal(gpxFc.features[1].geometry.type, 'LineString');
  assert.equal(gpxFc.features[1].properties.name, 'Pacific Ridge Route');
  assert.ok(gpxFc.features[1].properties.length_km > 0);
  assert.equal(gpxFc.features[1].properties.elev_gain_m, 40);
  assert.equal(gpxFc.features[1].properties.elev_loss_m, 20);
});

test('terrain DEM decoder, line densification, profile stats, and field calculator elevation', async () => {
  const { decodeTerrarium, lngLatToTilePixel, densifyLine, profileStats } = await load('terrain.js');
  const { calculateField } = await load('table.js');

  // Terrarium elevation decode: R*256 + G + B/256 - 32768
  // e.g. R=128, G=0, B=0 -> 128*256 - 32768 = 0 meters (sea level)
  assert.equal(decodeTerrarium(128, 0, 0), 0);
  // e.g. Mt Everest ~8848m -> R=162, G=176, B=0 -> 162*256 + 176 - 32768 = 41648 - 32768 = 8880
  const everestSample = decodeTerrarium(162, 176, 0);
  assert.ok(everestSample > 8800 && everestSample < 8900);

  // Web mercator tile math
  const tile = lngLatToTilePixel([-105.27, 40.01], 12);
  assert.ok(Number.isInteger(tile.tx));
  assert.ok(Number.isInteger(tile.ty));
  assert.ok(tile.px >= 0 && tile.px < 256);
  assert.ok(tile.py >= 0 && tile.py < 256);

  // Line densification along coordinates
  const line = [[-105.27, 40.01], [-105.28, 40.02]];
  const samples = densifyLine(line, 10);
  assert.equal(samples.length, 10);
  assert.equal(samples[0].km, 0);
  assert.ok(samples[9].km > 0);

  // Elevation profile stats calculation
  const profile = [
    { km: 0.0, elev: 100 },
    { km: 1.0, elev: 200 },
    { km: 2.0, elev: 150 },
    { km: 3.0, elev: 300 },
  ];
  const stats = profileStats(profile);
  assert.equal(stats.gain_m, 250);
  assert.equal(stats.loss_m, 50);
  assert.equal(stats.min_m, 100);
  assert.equal(stats.max_m, 300);
  assert.equal(stats.length_km, 3.0);
  assert.ok(stats.max_grade_pct > 0);

  // Field calculator elevation metrics
  const fc = {
    type: 'FeatureCollection',
    metadata: { fields: [] },
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-105, 40, 1850] }, properties: {} },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-105, 40] }, properties: { elevation_m: 2200 } },
    ],
  };

  calculateField(fc, 'elev_calc', { mode: 'geometry', metric: 'elevation_m' });
  assert.equal(fc.features[0].properties.elev_calc, 1850);
  assert.equal(fc.features[1].properties.elev_calc, 2200);

  calculateField(fc, 'elev_formula', { mode: 'formula', expression: '$ELEVATION_M + 100' });
  assert.equal(fc.features[0].properties.elev_formula, 1950);
  assert.equal(fc.features[1].properties.elev_formula, 2300);
});
