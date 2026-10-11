// Map helpers on top of MapLibre GL (global `maplibregl` loaded from CDN).
// A "view" is { center:[lng,lat], zoom, bearing, pitch, basemap, markers:[{lngLat,title,text}] }.

export const BASEMAPS = {
  streets: { label: 'Streets', style: 'https://tiles.openfreemap.org/styles/liberty' },
  bright: { label: 'Bright', style: 'https://tiles.openfreemap.org/styles/bright' },
  light: { label: 'Light gray', style: 'https://tiles.openfreemap.org/styles/positron' },
  dark: { label: 'Dark', style: 'https://tiles.openfreemap.org/styles/dark' },
};

export const DEFAULT_VIEW = { center: [-77.04, 38.85], zoom: 10, bearing: 0, pitch: 0, basemap: 'streets', markers: [] };

const styleUrl = (key) => (BASEMAPS[key] || BASEMAPS.streets).style;

export function createMap(container, view = DEFAULT_VIEW, { interactive = true } = {}) {
  const v = { ...DEFAULT_VIEW, ...view };
  const map = new maplibregl.Map({
    container,
    style: styleUrl(v.basemap),
    center: v.center,
    zoom: v.zoom,
    bearing: v.bearing,
    pitch: v.pitch,
    interactive,
    attributionControl: { compact: true },
  });
  if (interactive) map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.scrollZoom.disable(); // never hijack page scroll; ctrl/pinch still zooms via drag + buttons
  map._basemap = v.basemap;
  map._markers = [];
  setMarkers(map, v.markers);
  return map;
}

export function setMarkers(map, markers = []) {
  map._markers.forEach((m) => m.remove());
  map._markers = markers.map((mk, i) => {
    const el = document.createElement('div');
    el.className = 'sm-marker';
    el.textContent = mk.label ?? (markers.length > 1 ? String(i + 1) : '');
    const marker = new maplibregl.Marker({ element: el }).setLngLat(mk.lngLat);
    if (mk.title || mk.text) {
      const pop = document.createElement('div');
      if (mk.title) { const h = document.createElement('strong'); h.textContent = mk.title; pop.append(h); }
      if (mk.text) { const p = document.createElement('p'); p.textContent = mk.text; pop.append(p); }
      marker.setPopup(new maplibregl.Popup({ offset: 18, closeButton: false }).setDOMContent(pop));
    }
    return marker.addTo(map);
  });
}

export function applyView(map, view, { animate = true } = {}) {
  const v = { ...DEFAULT_VIEW, ...view };
  if (v.basemap !== map._basemap) {
    map.setStyle(styleUrl(v.basemap));
    map._basemap = v.basemap;
  }
  const cam = { center: v.center, zoom: v.zoom, bearing: v.bearing, pitch: v.pitch };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (animate && !reduce) map.flyTo({ ...cam, duration: 2200, essential: true });
  else map.jumpTo(cam);
  setMarkers(map, v.markers);
}

export function readView(map) {
  const c = map.getCenter();
  return {
    center: [round(c.lng, 5), round(c.lat, 5)],
    zoom: round(map.getZoom(), 2),
    bearing: round(map.getBearing(), 1),
    pitch: round(map.getPitch(), 1),
    basemap: map._basemap,
  };
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
