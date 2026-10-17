// Public data catalog: ready-to-use layers from government and open-data sources, plus ArcGIS Online search.
// Every source here was checked to work straight from a browser (CORS) with no API key.
import { h, icon, dialog, toast } from './ui.js';
import { SATELLITE_SENSORS } from './maps.js';
export { SATELLITE_SENSORS };

const uid = () => 'l' + Math.random().toString(36).slice(2, 8);

export const STATES = [['Alabama', '01'], ['Alaska', '02'], ['Arizona', '04'], ['Arkansas', '05'], ['California', '06'], ['Colorado', '08'], ['Connecticut', '09'],
  ['Delaware', '10'], ['District of Columbia', '11'], ['Florida', '12'], ['Georgia', '13'], ['Hawaii', '15'], ['Idaho', '16'], ['Illinois', '17'], ['Indiana', '18'],
  ['Iowa', '19'], ['Kansas', '20'], ['Kentucky', '21'], ['Louisiana', '22'], ['Maine', '23'], ['Maryland', '24'], ['Massachusetts', '25'], ['Michigan', '26'],
  ['Minnesota', '27'], ['Mississippi', '28'], ['Missouri', '29'], ['Montana', '30'], ['Nebraska', '31'], ['Nevada', '32'], ['New Hampshire', '33'], ['New Jersey', '34'],
  ['New Mexico', '35'], ['New York', '36'], ['North Carolina', '37'], ['North Dakota', '38'], ['Ohio', '39'], ['Oklahoma', '40'], ['Oregon', '41'], ['Pennsylvania', '42'],
  ['Rhode Island', '44'], ['South Carolina', '45'], ['South Dakota', '46'], ['Tennessee', '47'], ['Texas', '48'], ['Utah', '49'], ['Vermont', '50'], ['Virginia', '51'],
  ['Washington', '53'], ['West Virginia', '54'], ['Wisconsin', '55'], ['Wyoming', '56'], ['Puerto Rico', '72']];

const stateOpt = (valueIs = 'name') => ({ k: 'state', label: 'State', dflt: valueIs === 'name' ? 'Virginia' : '51', choices: STATES.map(([n, f]) => [valueIs === 'name' ? n : f, n]) });
const stateName = (fips) => STATES.find(([, f]) => f === fips)?.[0] || fips;
const NOAA_HAZ = 'https://gis.ngdc.noaa.gov/arcgis/rest/services/web_mercator/hazards/MapServer';
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

/* Each entry: provider, title, desc, kind (points | lines | areas | imagery), live?, options?, layer(opts) */
export const CATALOG = [
  // ---- USGS
  { id: 'usgs-quakes', provider: 'USGS', title: 'Earthquakes', kind: 'points', live: 'Updated every minute',
    desc: 'Every earthquake the USGS has located worldwide, with magnitude, depth and time.',
    options: [
      { k: 'period', label: 'From the past', dflt: 'week', choices: [['hour', 'Hour'], ['day', 'Day'], ['week', '7 days'], ['month', '30 days']] },
      { k: 'level', label: 'Magnitude', dflt: '2.5', choices: [['significant', 'Significant only'], ['4.5', '4.5 and up'], ['2.5', '2.5 and up'], ['1.0', '1.0 and up'], ['all', 'All']] }],
    layer: (o) => ({ name: `Earthquakes (past ${o.period === 'week' ? '7 days' : o.period === 'month' ? '30 days' : o.period})`,
      url: `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${o.level}_${o.period}.geojson`, transform: 'usgs-quakes',
      attribution: 'USGS Earthquake Hazards Program', style: { color: '#dc2626', mode: 'graduated', field: 'magnitude', radius: 5 },
      popup: { title: '{title}', fields: ['magnitude', 'when', 'depth_km', 'alert', 'tsunami', 'url'] } }) },
  { id: 'usgs-water', provider: 'USGS', title: 'Stream gauges', kind: 'points',
    desc: 'USGS stream monitoring locations in a state, linked to their live water data pages.', options: [stateOpt('name')],
    layer: (o) => ({ name: `USGS stream gauges (${o.state})`, transform: 'usgs-water',
      url: `https://api.waterdata.usgs.gov/ogcapi/v0/collections/monitoring-locations/items?f=json&limit=1000&site_type_code=ST&state_name=${encodeURIComponent(o.state)}`,
      attribution: 'USGS Water Data', style: { color: '#0891b2', radius: 4, display: 'clusters' },
      popup: { title: '{monitoring_location_name}', fields: ['site_type', 'county_name', 'drainage_area', 'data'] } }) },

  // ---- NOAA
  { id: 'nws-alerts', provider: 'NOAA', title: 'Weather warnings', kind: 'areas', live: 'Live',
    desc: 'Active National Weather Service warnings drawn as storm polygons (tornado, severe thunderstorm, flash flood and more).',
    layer: () => ({ name: 'Active weather warnings', url: 'https://api.weather.gov/alerts/active?status=actual', transform: 'nws-alerts',
      attribution: 'NOAA National Weather Service', style: { mode: 'categorical', field: 'severity', color: '#9ca3af', opacity: 0.4,
        colors: { Extreme: '#7f1d1d', Severe: '#dc2626', Moderate: '#f59e0b', Minor: '#facc15', Unknown: '#9ca3af' } },
      popup: { title: '{event}', fields: ['headline', 'severity', 'areaDesc', 'onset', 'expires'] } }) },
  { id: 'noaa-radar', provider: 'NOAA', title: 'Weather radar', kind: 'imagery', live: 'Updated every 5 minutes',
    desc: 'NEXRAD base reflectivity across the US (rain and snow), served by Iowa State University.',
    layer: () => ({ name: 'Weather radar', type: 'raster', tiles: 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png',
      maxzoom: 12, attribution: 'NOAA NEXRAD via Iowa Environmental Mesonet', style: { opacity: 0.7 } }) },
  { id: 'noaa-tides', provider: 'NOAA', title: 'Tide & water level stations', kind: 'points',
    desc: 'NOAA CO-OPS stations on the coasts and Great Lakes, linked to their tide charts.',
    layer: () => ({ name: 'NOAA tide stations', url: 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels', transform: 'coops-stations',
      attribution: 'NOAA Tides & Currents', style: { color: '#2563eb', radius: 5 }, popup: { title: '{name}', fields: ['state', 'station_id', 'great_lakes', 'data'] } }) },
  { id: 'noaa-tsunamis', provider: 'NOAA', title: 'Historical tsunamis', kind: 'points',
    desc: 'Tsunami source events from NOAA\'s global historical hazards database.',
    layer: () => ({ name: 'Tsunami events', url: `${NOAA_HAZ}/0`, attribution: 'NOAA NCEI Natural Hazards', style: { color: '#0e7490', radius: 5 }, popup: { title: '{LOCATION_NAME}' } }) },
  { id: 'noaa-quakes', provider: 'NOAA', title: 'Significant earthquakes in history', kind: 'points',
    desc: 'Damaging and deadly earthquakes from 2150 BC to today.',
    layer: () => ({ name: 'Significant historical earthquakes', url: `${NOAA_HAZ}/5`, attribution: 'NOAA NCEI Natural Hazards', style: { color: '#b45309', radius: 4, display: 'heatmap' }, popup: { title: '{LOCATION_NAME}' } }) },
  { id: 'noaa-volcanoes', provider: 'NOAA', title: 'Volcanoes', kind: 'points',
    desc: 'Volcano locations worldwide with type, elevation and last known eruption (Smithsonian data, via NOAA).',
    layer: () => ({ name: 'Volcanoes', url: `${NOAA_HAZ}/7`, attribution: 'NOAA NCEI / Smithsonian Global Volcanism Program', style: { color: '#b91c1c', radius: 5 },
      popup: { title: '{NAME}', fields: ['COUNTRY', 'LOCATION', 'MORPHOLOGY', 'ELEVATION', 'STATUS', 'TIME_ERUPT'] } }) },
  { id: 'noaa-eruptions', provider: 'NOAA', title: 'Significant volcanic eruptions', kind: 'points',
    desc: 'Eruptions that caused deaths, damage or tsunamis.',
    layer: () => ({ name: 'Significant eruptions', url: `${NOAA_HAZ}/6`, attribution: 'NOAA NCEI Natural Hazards', style: { color: '#ea580c', radius: 5 }, popup: { title: '{NAME}' } }) },
  { id: 'noaa-plates', provider: 'NOAA', title: 'Tectonic plate boundaries', kind: 'lines',
    desc: 'Where the Earth\'s plates meet: ridges, trenches and transform faults.',
    layer: () => ({ name: 'Plate boundaries', url: `${NOAA_HAZ}/12`, attribution: 'NOAA NCEI / UTIG PLATES', style: { color: '#ea580c', width: 2 }, popup: { title: '{geogdesc}', fields: ['type'] } }) },

  // ---- NASA & Remote Sensing
  { id: 'nasa-eonet', provider: 'NASA', title: 'Natural events happening now', kind: 'points', live: 'Updated daily',
    desc: 'Wildfires, storms, volcanoes, sea ice and more, tracked by NASA\'s Earth Observatory Natural Event Tracker.',
    options: [{ k: 'category', label: 'Type', dflt: '', choices: [['', 'All events'], ['wildfires', 'Wildfires'], ['severeStorms', 'Severe storms'], ['volcanoes', 'Volcanoes'],
      ['seaLakeIce', 'Sea and lake ice'], ['floods', 'Floods'], ['earthquakes', 'Earthquakes'], ['dustHaze', 'Dust and haze'], ['snow', 'Snow'], ['tempExtremes', 'Temperature extremes']] }],
    layer: (o) => ({ name: o.category ? `NASA events: ${o.category.replace(/([A-Z])/g, ' $1').toLowerCase()}` : 'NASA natural events',
      url: `https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&limit=1000${o.category ? `&category=${o.category}` : ''}`, transform: 'eonet',
      attribution: 'NASA EONET', style: { mode: 'categorical', field: 'category', radius: 6, color: '#64748b' }, popup: { title: '{title}', fields: ['category', 'date', 'magnitude', 'unit', 'link'] } }) },
  { id: 'nasa-modis', provider: 'NASA', title: 'Satellite image of the day', kind: 'imagery', live: 'New every day',
    desc: 'Yesterday\'s true-color view of the whole planet from the MODIS instrument on NASA\'s Terra satellite.',
    layer: () => ({ name: 'NASA satellite (MODIS true color)', type: 'raster', maxzoom: 9, style: { opacity: 1 },
      tiles: SATELLITE_SENSORS['modis-true'].tiles,
      attribution: SATELLITE_SENSORS['modis-true'].attribution }) },
  { id: 'nasa-ndvi', provider: 'NASA', title: 'NDVI Vegetation Health Index', kind: 'imagery', live: 'Updated every 8 days',
    desc: 'Normalized Difference Vegetation Index (NDVI) measuring crop vigor, forest density and drought stress from space.',
    layer: () => ({ name: 'NDVI Vegetation Health Index', type: 'raster', maxzoom: 9, date: '2024-07-12', style: { opacity: 0.85 },
      tiles: SATELLITE_SENSORS.ndvi.tiles,
      attribution: SATELLITE_SENSORS.ndvi.attribution }) },
  { id: 'nasa-false-ir', provider: 'NASA', title: 'False-Color Infrared (Bands 7-2-1)', kind: 'imagery', live: 'Daily',
    desc: 'Shortwave & near-infrared reflectance that cuts through smoke: active burn scars glow red, floodwaters appear dark blue, and vegetation is bright green.',
    layer: () => ({ name: 'False-Color Infrared (SWIR/NIR 7-2-1)', type: 'raster', maxzoom: 9, style: { opacity: 0.9 },
      tiles: SATELLITE_SENSORS['modis-false-ir'].tiles,
      attribution: SATELLITE_SENSORS['modis-false-ir'].attribution }) },
  { id: 'nasa-sst', provider: 'NASA', title: 'Sea Surface Temperature (Infrared)', kind: 'imagery', live: 'Daily',
    desc: 'Multi-scale Ultra-high Resolution (MUR) ocean thermal imagery showing currents, Gulf Stream eddies and marine heatwaves.',
    layer: () => ({ name: 'Sea Surface Temperature (GHRSST)', type: 'raster', maxzoom: 7, style: { opacity: 0.85 },
      tiles: SATELLITE_SENSORS.sst.tiles,
      attribution: SATELLITE_SENSORS.sst.attribution }) },
  { id: 'nasa-aerosol', provider: 'NASA', title: 'Smoke, Dust & Aerosol Plumes (AOD)', kind: 'imagery', live: 'Daily',
    desc: 'Aerosol Optical Depth tracking wildfire smoke plumes, desert dust storms and air pollution transport.',
    layer: () => ({ name: 'Aerosol Optical Depth (Smoke & Dust)', type: 'raster', maxzoom: 6, style: { opacity: 0.78 },
      tiles: SATELLITE_SENSORS.aerosol.tiles,
      attribution: SATELLITE_SENSORS.aerosol.attribution }) },
  { id: 'nasa-snow', provider: 'NASA', title: 'Snow & Ice Cover Index (NDSI)', kind: 'imagery', live: 'Daily',
    desc: 'Normalized Difference Snow Index showing mountain snowpack and cryosphere extent.',
    layer: () => ({ name: 'Snow Cover Index (NDSI)', type: 'raster', maxzoom: 8, style: { opacity: 0.85 },
      tiles: SATELLITE_SENSORS.snow.tiles,
      attribution: SATELLITE_SENSORS.snow.attribution }) },
  { id: 'nasa-night', provider: 'NASA', title: 'Earth at night', kind: 'imagery',
    desc: 'City lights from space: the VIIRS Black Marble night-lights mosaic.',
    layer: () => ({ name: 'Earth at night (Black Marble)', type: 'raster', maxzoom: 8, date: '2016-01-01', style: { opacity: 0.95 },
      tiles: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/{date}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png',
      attribution: 'NASA Earth Observatory / GIBS, VIIRS Black Marble' }) },
  { id: 'usgs-relief', provider: 'USGS', title: '3D LiDAR / DEM Shaded Relief', kind: 'imagery',
    desc: 'Bare-earth topographic hillshade from the USGS 3D Elevation Program (3DEP), revealing fault lines, ridges and river valleys.',
    layer: () => ({ name: 'USGS 3DEP Shaded Relief', type: 'raster', maxzoom: 16, style: { opacity: 0.75 },
      tiles: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}',
      attribution: 'USGS 3D Elevation Program (3DEP)' }) },
  { id: 'usgs-hydro', provider: 'USGS', title: 'National Hydrography (NHD)', kind: 'imagery',
    desc: 'Detailed rivers, intermittent streams, canals and watersheds across the United States.',
    layer: () => ({ name: 'USGS National Hydrography', type: 'raster', maxzoom: 16, style: { opacity: 0.85 },
      tiles: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}',
      attribution: 'USGS National Hydrography Dataset (NHD)' }) },

  // ---- Census
  { id: 'census-states', provider: 'Census', title: 'States', kind: 'areas',
    desc: 'US state boundaries with land and water area (TIGERweb, simplified for the web).',
    layer: () => ({ name: 'US states', url: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0',
      query: { outFields: 'NAME,STATE,AREALAND,AREAWATER', maxAllowableOffset: 0.02 }, attribution: 'US Census Bureau TIGERweb',
      style: { color: '#4f46e5', opacity: 0.08, width: 1.5 }, popup: { title: '{NAME}', fields: ['AREALAND', 'AREAWATER'] } }) },
  { id: 'census-counties', provider: 'Census', title: 'Counties', kind: 'areas', desc: 'County boundaries for one state.', options: [stateOpt('fips')],
    layer: (o) => ({ name: `Counties (${stateName(o.state)})`, url: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1',
      query: { where: `STATE='${o.state}'`, outFields: 'NAME,STATE,COUNTY,AREALAND,AREAWATER', maxAllowableOffset: 0.002 }, attribution: 'US Census Bureau TIGERweb',
      style: { color: '#4f46e5', opacity: 0.1, width: 1 }, popup: { title: '{NAME}', fields: ['AREALAND', 'AREAWATER'] } }) },

  // ---- Interior, Agriculture, EPA, wildfire
  { id: 'nps-parks', provider: 'Interior', title: 'National parks', kind: 'areas',
    desc: 'Boundaries of every National Park Service unit: parks, monuments, seashores and more.',
    layer: () => ({ name: 'National Park Service units', url: 'https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2',
      query: { outFields: 'UNIT_NAME,UNIT_TYPE,UNIT_CODE,STATE,REGION', maxAllowableOffset: 0.005 }, attribution: 'National Park Service',
      style: { color: '#15803d', opacity: 0.35 }, popup: { title: '{UNIT_NAME}', fields: ['UNIT_TYPE', 'STATE', 'REGION'] } }) },
  { id: 'usfs-forests', provider: 'Agriculture', title: 'National forests', kind: 'areas',
    desc: 'US Forest Service national forest and grassland boundaries.',
    layer: () => ({ name: 'National forests', url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/0',
      query: { outFields: 'forestname,region,gis_acres', maxAllowableOffset: 0.005 }, attribution: 'USDA Forest Service',
      style: { color: '#4d7c0f', opacity: 0.3 }, popup: { title: '{forestname}', fields: ['region', 'gis_acres'] } }) },
  { id: 'epa-superfund', provider: 'EPA', title: 'Superfund sites', kind: 'points',
    desc: 'National Priorities List hazardous waste sites with their cleanup status.',
    layer: () => ({ name: 'EPA Superfund sites', url: 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Superfund_National_Priorities_List_(NPL)_Sites_with_Status_Information/FeatureServer/0',
      query: { outFields: 'Site_Name,Site_Score,Status,City,County,State' }, attribution: 'US EPA', style: { color: '#7c3aed', radius: 5, mode: 'categorical', field: 'Status' },
      popup: { title: '{Site_Name}', fields: ['Status', 'Site_Score', 'City', 'State'] } }) },
  { id: 'nifc-fires', provider: 'Wildfire', title: 'Active wildfires', kind: 'points', live: 'Live',
    desc: 'Current wildfire incidents reported to the National Interagency Fire Center.',
    layer: () => ({ name: 'Active wildfires', url: 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0',
      attribution: 'National Interagency Fire Center', style: { color: '#ea580c', radius: 6, mode: 'graduated', field: 'IncidentSize' },
      popup: { title: '{IncidentName}', fields: ['IncidentSize', 'PercentContained', 'FireDiscoveryDateTime', 'POOState'] } }) },
  { id: 'nifc-perimeters', provider: 'Wildfire', title: 'Wildfire perimeters', kind: 'areas', live: 'Live',
    desc: 'The mapped edges of current wildfires.',
    layer: () => ({ name: 'Wildfire perimeters', url: 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0',
      query: { outFields: 'poly_IncidentName,poly_GISAcres,poly_DateCurrent', maxAllowableOffset: 0.0005 }, attribution: 'National Interagency Fire Center',
      style: { color: '#dc2626', opacity: 0.4, width: 1.5 }, popup: { title: '{poly_IncidentName}', fields: ['poly_GISAcres'] } }) },

  // ---- World (public domain)
  { id: 'ne-countries', provider: 'World', title: 'Countries', kind: 'areas',
    desc: 'Country outlines with population, continent and economy (Natural Earth, public domain).',
    layer: () => ({ name: 'Countries', url: `${NE}/ne_110m_admin_0_countries.geojson`, attribution: 'Natural Earth', style: { color: '#64748b', opacity: 0.08, width: 1 },
      popup: { title: '{NAME}', fields: ['CONTINENT', 'POP_EST', 'ECONOMY', 'INCOME_GRP'] } }) },
  { id: 'ne-cities', provider: 'World', title: 'Major cities', kind: 'points',
    desc: 'Populated places worldwide with population estimates (Natural Earth, public domain).',
    layer: () => ({ name: 'Major cities', url: `${NE}/ne_110m_populated_places_simple.geojson`, attribution: 'Natural Earth',
      style: { color: '#334155', radius: 4, label: 'name' }, popup: { title: '{name}', fields: ['adm0name', 'pop_max'] } }) },
  { id: 'ne-rivers', provider: 'World', title: 'Rivers & lakes', kind: 'lines',
    desc: 'Major rivers and lake centerlines (Natural Earth, public domain).',
    layer: () => ({ name: 'Rivers', url: `${NE}/ne_50m_rivers_lake_centerlines.geojson`, attribution: 'Natural Earth', style: { color: '#0284c7', width: 1.5 }, popup: { title: '{name}' } }) },
];

const PROVIDERS = ['All', 'NASA', 'USGS', 'NOAA', 'Wildfire', 'Census', 'Interior', 'Agriculture', 'EPA', 'World'];
const KIND_ICON = { points: 'pin', lines: 'line', areas: 'polygon', imagery: 'image' };
const KIND_LABEL = { points: 'Points', lines: 'Lines', areas: 'Areas', imagery: 'Imagery' };

/* ---------- STAC Satellite Scene Search (Copernicus Sentinel-2 L2A) ---------- */

export function stacItemsToGeoJSON(items = []) {
  return {
    type: 'FeatureCollection',
    metadata: { attribution: 'Copernicus Sentinel-2 L2A via Element84 Earth Search STAC' },
    features: items.filter((it) => it && it.geometry).map((it) => {
      const p = it.properties || {};
      return {
        type: 'Feature',
        geometry: it.geometry,
        properties: {
          scene_id: it.id || '',
          date: (p.datetime || '').slice(0, 10),
          datetime: p.datetime || '',
          cloud_cover_pct: p['eo:cloud_cover'] != null ? Math.round(p['eo:cloud_cover'] * 10) / 10 : null,
          platform: p.platform || 'sentinel-2',
          constellation: p.constellation || 'sentinel-2',
          mgrs_tile: [p['mgrs:utm_zone'], p['mgrs:latitude_band'], p['mgrs:grid_square']].filter(Boolean).join('') || '',
          sun_elevation: p['view:sun_elevation'] != null ? Math.round(p['view:sun_elevation'] * 10) / 10 : null,
          thumbnail_url: it.assets?.thumbnail?.href || '',
          visual_cog_url: it.assets?.visual?.href || '',
        },
      };
    }),
  };
}

async function searchStacScenes({ placeQuery = '', maxCloud = 20, days = 90 } = {}) {
  let bbox = [-77.25, 38.75, -76.85, 39.05];
  const liveMap = typeof document !== 'undefined' && document.querySelector('.maplibregl-map')?._smMap;
  if (liveMap?.getBounds) {
    const b = liveMap.getBounds();
    bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => +n.toFixed(4));
  }
  if (placeQuery.trim()) {
    const geo = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(placeQuery.trim())}`).then((r) => r.json()).catch(() => []);
    if (geo[0]?.boundingbox) {
      const [s, n, w, e] = geo[0].boundingbox.map(Number);
      bbox = [w, s, e, n];
    } else if (geo[0]) {
      const lon = +geo[0].lon;
      const lat = +geo[0].lat;
      bbox = [lon - 0.25, lat - 0.25, lon + 0.25, lat + 0.25];
    }
  }
  const end = new Date().toISOString();
  const start = new Date(Date.now() - days * 864e5).toISOString();
  const r = await fetch('https://earth-search.aws.element84.com/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collections: ['sentinel-2-l2a'],
      bbox,
      datetime: `${start}/${end}`,
      limit: 16,
      ...(maxCloud < 100 ? { query: { 'eo:cloud_cover': { lte: maxCloud } } } : {}),
    }),
  });
  if (!r.ok) throw new Error(`STAC search failed (HTTP ${r.status})`);
  const j = await r.json();
  return { features: j.features || [], bbox };
}

/* ---------- ArcGIS Online search ---------- */

async function searchArcGIS(q) {
  const query = `${q} type:"Feature Service" access:public`;
  const r = await fetch(`https://www.arcgis.com/sharing/rest/search?${new URLSearchParams({ q: query, num: '24', f: 'json', sortField: 'numviews', sortOrder: 'desc' })}`);
  if (!r.ok) throw new Error(`Search failed (HTTP ${r.status})`);
  return (await r.json()).results || [];
}

async function serviceLayers(url) {
  const base = url.replace(/\/+$/, '');
  if (/\/(FeatureServer|MapServer)\/\d+$/i.test(base)) return [{ url: base, name: '' }];
  const r = await fetch(`${base}?f=json`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'This service is not public');
  return (j.layers || []).filter((l) => !l.subLayerIds).map((l) => ({ url: `${base}/${l.id}`, name: l.name, geometryType: l.geometryType }));
}

/* ---------- Dialog ---------- */

/** onAdd(layer) is called for each layer added; the caller pushes it into the story. */
export function openCatalog({ onAdd }) {
  let provider = 'All';
  let query = '';
  let mode = 'featured';
  let stacCloud = 20;
  let stacDays = 90;
  const added = new Set();
  const body = h('div', { class: 'cat' });
  const dlg = dialog({ title: 'Public data & Earth Observation', cls: 'dlg-xl dlg-catalog', body,
    actions: [h('span', { class: 'muted', style: 'margin-right:auto;font-size:12.5px' }, 'Live layers refresh each time the story is opened. Exporting a story can save a snapshot.'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => dlg.close() }, 'Done')] });

  const add = (layer, key, btn) => {
    const full = { id: uid(), popup: {}, style: {}, ...layer };
    onAdd(full);
    added.add(key);
    if (btn) { btn.disabled = true; btn.replaceChildren(icon('check', { size: 14 }), 'Added'); }
    toast(`Added "${full.name}"`, { tone: 'ok', duration: 2200 });
  };

  const card = (entry) => {
    const opts = Object.fromEntries((entry.options || []).map((o) => [o.k, o.dflt]));
    const btn = h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => add({ ...entry.layer(opts), catalog: entry.id }, entry.id + JSON.stringify(opts), btn) }, icon('plus', { size: 14 }), 'Add');
    return h('article', { class: 'cat-card' },
      h('div', { class: 'cat-card-top' },
        h('span', { class: `cat-badge prov-${entry.provider.toLowerCase()}` }, entry.provider),
        h('span', { class: 'cat-kind' }, icon(KIND_ICON[entry.kind], { size: 13 }), KIND_LABEL[entry.kind]),
        entry.live ? h('span', { class: 'cat-live' }, entry.live) : null),
      h('h3', {}, entry.title),
      h('p', {}, entry.desc),
      (entry.options || []).map((o) => h('label', { class: 'cat-opt' }, h('span', {}, o.label),
        h('select', { onchange: (e) => { opts[o.k] = e.target.value; btn.disabled = false; btn.replaceChildren(icon('plus', { size: 14 }), 'Add'); } },
          o.choices.map(([v, l]) => h('option', { value: v, selected: v === o.dflt }, l))))),
      h('div', { class: 'cat-card-foot' }, btn));
  };

  const featured = () => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = CATALOG.filter((e) => (provider === 'All' || e.provider === provider)
      && words.every((w) => `${e.title} ${e.desc} ${e.provider} ${e.kind}`.toLowerCase().includes(w)));
    return list.length ? h('div', { class: 'cat-grid' }, list.map(card))
      : h('div', { class: 'cat-empty' }, h('p', {}, `Nothing in the featured list matches "${query}".`),
        h('button', { type: 'button', class: 'btn', onclick: () => { mode = 'search'; draw(); runSearch(query); } }, icon('search', { size: 15 }), `Search ArcGIS Online for "${query}"`));
  };

  const results = h('div', { class: 'cat-results' });
  const runSearch = async (q) => {
    if (!q.trim()) { results.replaceChildren(h('p', { class: 'muted' }, 'Try "flood zones", "hospitals", "bike lanes", "school districts" or a city name.')); return; }
    results.replaceChildren(h('p', { class: 'uploading' }, h('span', { class: 'spinner' }), 'Searching public layers…'));
    try {
      const items = await searchArcGIS(q);
      results.replaceChildren(...(items.length ? items.map((it) => {
        const pick = h('div', { class: 'cat-pick' });
        const choose = async (btn) => {
          btn.disabled = true;
          try {
            const layers = await serviceLayers(it.url);
            if (!layers.length) throw new Error('This service has no map layers');
            const make = (l) => ({ name: l.name && layers.length > 1 ? `${it.title}: ${l.name}` : it.title, url: l.url, attribution: it.owner ? `${it.owner} via ArcGIS Online` : 'ArcGIS Online', style: { color: '#2563eb' } });
            if (layers.length === 1) { add(make(layers[0]), it.id, btn); return; }
            pick.replaceChildren(h('span', { class: 'field-label' }, 'This service has several layers. Pick one:'),
              ...layers.map((l) => h('button', { type: 'button', class: 'btn btn-sm', onclick: (e) => add(make(l), l.url, e.currentTarget) }, icon('plus', { size: 13 }), l.name)));
            btn.replaceChildren('Choose a layer below');
          } catch (e) { toast(e.message, { tone: 'error' }); btn.disabled = false; }
        };
        const btn = h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: (e) => choose(e.currentTarget) }, icon('plus', { size: 14 }), 'Add');
        return h('article', { class: 'cat-row' },
          it.thumbnail ? h('img', { src: `https://www.arcgis.com/sharing/rest/content/items/${it.id}/info/${it.thumbnail}`, alt: '', loading: 'lazy' }) : h('span', { class: 'cat-thumb' }, icon('layers')),
          h('div', { class: 'cat-row-text' }, h('strong', {}, it.title), h('span', { class: 'muted' }, `${it.owner || 'Unknown owner'} · ${(it.numViews || 0).toLocaleString()} views`),
            it.snippet ? h('p', {}, it.snippet) : null, pick),
          btn);
      }) : [h('p', { class: 'muted' }, 'No public layers found. Try other words.')]));
    } catch (e) { results.replaceChildren(h('p', { class: 'form-error' }, e.message)); }
  };

  const stacResults = h('div', { class: 'cat-results' });
  const runStac = async () => {
    stacResults.replaceChildren(h('p', { class: 'uploading' }, h('span', { class: 'spinner' }), 'Querying Sentinel-2 L2A STAC catalog…'));
    try {
      const { features } = await searchStacScenes({ placeQuery: query, maxCloud: stacCloud, days: stacDays });
      if (!features.length) {
        stacResults.replaceChildren(h('p', { class: 'muted' }, 'No Sentinel-2 scenes matched that cloud cover and date window. Try raising Max Cloud Cover or searching another place.'));
        return;
      }
      const addAllBtn = h('button', {
        type: 'button',
        class: 'btn btn-sm',
        style: 'margin-bottom:10px',
        onclick: (e) => {
          const fc = stacItemsToGeoJSON(features);
          add({
            name: `Sentinel-2 Footprints (${query.trim() || 'Map extent'})`,
            data: fc,
            attribution: 'Copernicus Sentinel-2 L2A via Element84 Earth Search STAC',
            style: { color: '#0284c7', mode: 'graduated', field: 'cloud_cover_pct', opacity: 0.25 },
            popup: { title: '{scene_id}', fields: ['date', 'cloud_cover_pct', 'platform', 'mgrs_tile', 'sun_elevation'] },
          }, `stac-all-${Date.now()}`, e.currentTarget);
        },
      }, icon('layers', { size: 14 }), `Add all ${features.length} scene footprints as GeoJSON layer`);

      stacResults.replaceChildren(
        addAllBtn,
        ...features.map((it) => {
          const p = it.properties || {};
          const date = (p.datetime || '').slice(0, 10);
          const cloud = p['eo:cloud_cover'] != null ? `${Math.round(p['eo:cloud_cover'] * 10) / 10}% clouds` : '';
          const thumb = it.assets?.thumbnail?.href;
          const cog = it.assets?.visual?.href;
          const footBtn = h('button', {
            type: 'button',
            class: 'btn btn-sm',
            onclick: (e) => {
              const fc = stacItemsToGeoJSON([it]);
              add({
                name: `S2 Footprint ${date} (${it.id})`,
                data: fc,
                attribution: 'Copernicus Sentinel-2 L2A via Earth Search STAC',
                style: { color: '#0ea5e9', opacity: 0.22, width: 2 },
                popup: { title: '{scene_id}', fields: ['date', 'cloud_cover_pct', 'platform', 'mgrs_tile', 'sun_elevation'] },
              }, `stac-fp-${it.id}`, e.currentTarget);
            },
          }, icon('polygon', { size: 13 }), 'Footprint');
          const imgBtn = cog ? h('button', {
            type: 'button',
            class: 'btn btn-sm btn-primary',
            onclick: (e) => add({
              name: `Sentinel-2 10m (${date})`,
              type: 'raster',
              tiles: `https://titiler.xyz/cog/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png?url=${encodeURIComponent(cog)}`,
              maxzoom: 16,
              attribution: `Copernicus Sentinel-2 L2A (${date}, ${cloud})`,
              style: { opacity: 0.95 },
            }, `stac-cog-${it.id}`, e.currentTarget),
          }, icon('plus', { size: 13 }), '10m Imagery') : null;
          return h('article', { class: 'cat-row' },
            thumb ? h('img', { src: thumb, alt: it.id, loading: 'lazy' }) : h('span', { class: 'cat-thumb' }, icon('globe')),
            h('div', { class: 'cat-row-text' },
              h('strong', {}, `Sentinel-2 L2A · ${date}`),
              h('span', { class: 'muted' }, `${it.id} · ${cloud} · ${(p.platform || 'S2').toUpperCase()}`),
              h('p', {}, `MGRS tile ${[p['mgrs:utm_zone'], p['mgrs:latitude_band'], p['mgrs:grid_square']].filter(Boolean).join('')} · Sun elev ${Math.round(p['view:sun_elevation'] || 0)}°`)),
            h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, imgBtn, footBtn));
        }),
      );
    } catch (e) {
      stacResults.replaceChildren(h('p', { class: 'form-error' }, e.message));
    }
  };

  const searchInput = h('input', { type: 'search', placeholder: 'Search featured sources', 'aria-label': 'Search data', value: query,
    oninput: (e) => { query = e.target.value; if (mode === 'featured') redrawList(); },
    onkeydown: (e) => {
      if (e.key === 'Enter' && mode === 'search') runSearch(query);
      if (e.key === 'Enter' && mode === 'stac') runStac();
    } });
  const listBox = h('div', { class: 'cat-main' });
  const redrawList = () => {
    if (mode === 'featured') { listBox.replaceChildren(featured()); return; }
    if (mode === 'stac') {
      listBox.replaceChildren(h('div', {},
        h('p', { class: 'cat-note' }, 'Search live Copernicus Sentinel-2 L2A optical satellite scenes from the open Earth Search STAC API. Leave the search box blank to search the current map area, or type any place name and press Enter.'),
        stacResults));
      return;
    }
    listBox.replaceChildren(h('div', {},
      h('p', { class: 'cat-note' }, 'Search thousands of public layers published by government agencies, cities and universities on ArcGIS Online. Check who published a layer before relying on it.'),
      results));
  };

  const draw = () => {
    searchInput.placeholder = mode === 'featured'
      ? 'Search featured sources (NDVI, thermal, radar, earthquakes…)'
      : mode === 'stac'
        ? 'Place name (or leave blank for current map area) & press Enter'
        : 'Search ArcGIS Online and press Enter';
    body.replaceChildren(
      h('aside', { class: 'cat-side' },
        h('div', { class: 'seg seg-block', style: 'margin-bottom:14px' },
          h('button', { type: 'button', class: mode === 'featured' ? 'is-on' : '', onclick: () => { mode = 'featured'; draw(); } }, 'Featured'),
          h('button', { type: 'button', class: mode === 'stac' ? 'is-on' : '', onclick: () => { mode = 'stac'; draw(); runStac(); } }, 'STAC Scenes'),
          h('button', { type: 'button', class: mode === 'search' ? 'is-on' : '', onclick: () => { mode = 'search'; draw(); runSearch(query); } }, 'ArcGIS')),
        mode === 'featured' ? PROVIDERS.map((p) => h('button', { type: 'button', class: `cat-prov ${provider === p ? 'is-on' : ''}`, onclick: () => { provider = p; draw(); } },
          h('span', {}, p === 'Interior' ? 'Interior (NPS)' : p === 'Agriculture' ? 'Agriculture (USFS)' : p),
          h('span', { class: 'muted' }, p === 'All' ? CATALOG.length : CATALOG.filter((e) => e.provider === p).length)))
          : mode === 'stac' ? [
            h('label', { class: 'field' },
              h('span', { class: 'field-label' }, 'Max cloud cover'),
              h('select', { onchange: (e) => { stacCloud = +e.target.value; runStac(); } },
                [[5, '< 5% (Crystal clear)'], [15, '< 15% (Low cloud)'], [20, '< 20%'], [40, '< 40%'], [100, 'Any cloud cover']].map(([v, l]) => h('option', { value: v, selected: stacCloud === v }, l)))),
            h('label', { class: 'field', style: 'margin-top:8px' },
              h('span', { class: 'field-label' }, 'Time window'),
              h('select', { onchange: (e) => { stacDays = +e.target.value; runStac(); } },
                [[30, 'Past 30 days'], [90, 'Past 90 days'], [180, 'Past 6 months'], [365, 'Past 1 year']].map(([v, l]) => h('option', { value: v, selected: stacDays === v }, l)))),
            h('button', { type: 'button', class: 'btn btn-primary btn-block', style: 'margin-top:10px', onclick: runStac }, icon('search', { size: 15 }), 'Find satellite scenes'),
          ] : h('p', { class: 'field-hint', style: 'margin:0' }, 'Results come from ArcGIS Online\'s public catalog. Most US federal, state and city agencies publish there.')),
      h('div', { class: 'cat-body' }, h('label', { class: 'search cat-search' }, icon('search', { size: 16 }), searchInput), listBox));
    redrawList();
    searchInput.focus();
  };
  draw();
}
