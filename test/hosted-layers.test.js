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

test('Phase 1: Sankey & Network graph flow computation and map viewport bounds filtering', async () => {
  const { computeFlowGraph, filterFeaturesByBounds } = await load('render.js');

  const flowFc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-74.0, 40.7], [-75.1, 39.9]] }, properties: { origin_name: 'New York', hub_name: 'Philly Hub', sector: 'Retail', volume: 120 } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-74.0, 40.7], [-71.0, 42.3]] }, properties: { origin_name: 'New York', hub_name: 'Boston Hub', sector: 'Tech', volume: 80 } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-118.2, 34.0], [-122.4, 37.7]] }, properties: { origin_name: 'Los Angeles', hub_name: 'SF Hub', sector: 'Tech', volume: 200 } },
    ],
  };

  // 2-stage flow graph (Source -> Target)
  const g2 = computeFlowGraph({ groupField: 'origin_name', targetField: 'hub_name', stat: 'sum', valueField: 'volume' }, flowFc);
  assert.equal(g2.stages.length, 2);
  assert.equal(g2.links.length, 3);
  const nyNode = g2.nodes.find((n) => n.label === 'New York');
  assert.ok(nyNode);
  assert.equal(nyNode.value, 200);
  assert.equal(nyNode.degree, 2);
  assert.ok(Array.isArray(nyNode.lngLat) && nyNode.lngLat.length === 2);

  // 3-stage Sankey flow graph (Origin -> Sector -> Hub)
  const g3 = computeFlowGraph({ groupField: 'origin_name', midField: 'sector', targetField: 'hub_name', stat: 'sum', valueField: 'volume' }, flowFc);
  assert.equal(g3.stages.length, 3);
  assert.ok(g3.links.length >= 4);

  // Viewport bounds filtering for map-synced charts/graphs
  const eastCoastFc = filterFeaturesByBounds(flowFc, [-78, 38, -70, 44]);
  assert.equal(eastCoastFc.features.length, 2);
  const eastGraph = computeFlowGraph({ groupField: 'origin_name', targetField: 'hub_name', stat: 'sum', valueField: 'volume' }, eastCoastFc);
  assert.equal(eastGraph.links.length, 2);
});

test('Phase 2: Geospatial Cost Surface, Tobler slope friction & Least-Cost Path routing', async () => {
  const { toblerHikingKmh, buildCostSurface, traceLeastCostPaths } = await load('terrain.js');
  const { TOOLS } = await load('analysis.js');

  // Tobler hiking function peaks near -5% grade (~6 km/h) and slows down on steep ascents
  const flatSpeed = toblerHikingKmh(0);
  const slightDownSpeed = toblerHikingKmh(-5);
  const steepUpSpeed = toblerHikingKmh(30);
  assert.ok(slightDownSpeed > flatSpeed);
  assert.ok(flatSpeed > steepUpSpeed);

  const origins = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-105.3, 40.0] }, properties: { name: 'Basecamp' } }],
  };
  const destinations = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-105.1, 40.0] }, properties: { name: 'Summit Station' } }],
  };
  // Place a central high-friction barrier polygon between -105.22 and -105.18
  const barriers = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[-105.22, 39.97], [-105.18, 39.97], [-105.18, 40.03], [-105.22, 40.03], [-105.22, 39.97]]],
      },
      properties: { name: 'Canyon Wall', friction: 0 }, // impassable
    }],
  };

  // Synthetic DEM sampler with a ridge in the middle
  const mockElev = async (coords) => coords.map(([lng, lat]) => 1500 + Math.exp(-(((lng + 105.2) * 40) ** 2)) * 400 + (lat - 40) * 50);

  const surface = await buildCostSurface({
    origins,
    destinations,
    barriers,
    resolution: 18,
    padKm: 2,
    useTerrain: true,
    elevSampler: mockElev,
  });

  assert.ok(surface.grid.features.length >= 100);
  const impassableCells = surface.grid.features.filter((f) => f.properties.passable === false);
  assert.ok(impassableCells.length > 0, 'Barrier cells should be marked impassable');

  const paths = traceLeastCostPaths(surface, destinations, { smooth: true });
  assert.equal(paths.features.length, 1);
  const route = paths.features[0];
  assert.equal(route.properties.origin, 'Basecamp');
  assert.equal(route.properties.destination, 'Summit Station');
  assert.ok(route.properties.travel_time_min > 0);
  assert.ok(route.properties.distance_km >= route.properties.straight_km);
  assert.ok(route.properties.detour_ratio >= 1, 'Route should detour around impassable barrier');

  // Verify workbench TOOLS integration
  assert.ok(TOOLS.costSurface);
  assert.ok(TOOLS.leastCostPath);
});

test('Phase 3: 3D Viewshed line-of-sight analysis & Getis-Ord Gi* / Local Moran\'s I spatial hot spots', async () => {
  const { computeViewshed } = await load('terrain.js');
  const { computeHotspots, TOOLS } = await load('analysis.js');

  // 1. Test 3D Viewshed with a synthetic ridge blocking sightlines to the East (bearing ~90°)
  const observers = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-120.0, 38.0] }, properties: { name: 'Fire Lookout' } }],
  };
  const ridgeElevSampler = async (coords) => coords.map(([lng]) => {
    const dLng = lng - (-120.0);
    // Sharp 500m ridge located ~0.015 deg East, flat elsewhere
    if (dLng > 0.01 && dLng < 0.02) return 900;
    return 400;
  });

  const vsSectors = await computeViewshed({
    observers,
    radiusKm: 4,
    observerHeightM: 2,
    targetHeightM: 0,
    rays: 12,
    stepsPerRay: 8,
    outputMode: 'sectors',
    elevSampler: ridgeElevSampler,
  });
  assert.equal(vsSectors.data.features.length, 12 * 8);
  assert.ok(vsSectors.visiblePct > 0 && vsSectors.visiblePct < 100, 'Ridge should obstruct Eastern sectors behind it while leaving other directions visible');
  const obstructed = vsSectors.data.features.filter((f) => f.properties.visible === 'Obstructed');
  assert.ok(obstructed.length > 0);

  // 2. Test Getis-Ord Gi* and Local Moran's I (LISA) hot-spot & outlier detection
  const clusterPts = [];
  // High-value cluster around (-74.0, 40.7)
  for (let i = 0; i < 6; i++) {
    clusterPts.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-74.0 + i * 0.002, 40.7 + (i % 2) * 0.002] },
      properties: { name: `High-${i}`, sales: 950 + i * 20 },
    });
  }
  // Low-value cluster around (-73.5, 40.2)
  for (let i = 0; i < 6; i++) {
    clusterPts.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-73.5 + i * 0.002, 40.2 + (i % 2) * 0.002] },
      properties: { name: `Low-${i}`, sales: 40 + i * 5 },
    });
  }
  // Moderate background points
  for (let i = 0; i < 6; i++) {
    clusterPts.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-73.8 + i * 0.01, 40.45] },
      properties: { name: `Mid-${i}`, sales: 450 + i * 10 },
    });
  }

  const hs = computeHotspots({ type: 'FeatureCollection', features: clusterPts }, { field: 'sales', knn: 4 });
  assert.equal(hs.data.features.length, 18);
  assert.ok(hs.hotCount > 0, 'Should detect statistically significant Gi* hot spots');
  assert.ok(hs.coldCount > 0, 'Should detect statistically significant Gi* cold spots');
  assert.ok(hs.globalMoranI > 0.3, 'Clustered data should exhibit positive spatial autocorrelation (Moran\'s I)');
  const firstHot = hs.data.features[0].properties;
  assert.ok(firstHot.gi_zscore > 1.645);
  assert.equal(firstHot.lisa_cluster, 'High-High Hot Spot');

  assert.ok(TOOLS.viewshed);
  assert.ok(TOOLS.hotspot);
});

test('Phase 4: Gravity / Huff market share model, 2SFCA accessibility & curved O–D flow arcs', async () => {
  const { computeGravityModel, TOOLS } = await load('analysis.js');
  const { withCurvedArcs } = await load('maps.js');
  const { computeFlowGraph } = await load('render.js');

  const demand = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-74.01, 40.71] }, properties: { name: 'Lower Manhattan', pop: 5000 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-73.95, 40.80] }, properties: { name: 'Harlem', pop: 4000 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-73.98, 40.68] }, properties: { name: 'Brooklyn', pop: 6000 } },
    ],
  };
  const supply = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-74.00, 40.72] }, properties: { name: 'Downtown Flagship', sqft: 80000 } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-73.94, 40.81] }, properties: { name: 'Uptown Branch', sqft: 30000 } },
    ],
  };

  // 1. Demand mode: computes Huff probability, primary hub, and 2SFCA accessibility
  const demRes = computeGravityModel({
    demand,
    supply,
    attractField: 'sqft',
    demandField: 'pop',
    beta: 2,
    outputMode: 'demand',
  });
  assert.equal(demRes.data.features.length, 3);
  const lowerM = demRes.data.features[0].properties;
  assert.equal(lowerM.primary_hub, 'Downtown Flagship');
  assert.ok(lowerM.primary_prob_pct > 80);
  assert.ok(lowerM.accessibility_index > 0);

  // 2. Flows mode: produces O-D flow lines that feed directly into curved arcs and Sankey/Network charts
  const flowRes = computeGravityModel({
    demand,
    supply,
    attractField: 'sqft',
    demandField: 'pop',
    beta: 2,
    outputMode: 'flows',
  });
  assert.ok(flowRes.data.features.length >= 3);
  const curved = withCurvedArcs(flowRes.data, { curvature: 0.22, steps: 16 });
  assert.equal(curved.features[0].geometry.coordinates.length, 17);

  // Verify O-D gravity flows plug directly into Sankey/Network computeFlowGraph
  const graph = computeFlowGraph({ groupField: 'origin_name', targetField: 'hub_name', stat: 'sum', valueField: 'flow_volume' }, flowRes.data);
  assert.equal(graph.stages.length, 2);
  assert.ok(graph.links.length >= 3);

  assert.ok(TOOLS.gravity);
});



