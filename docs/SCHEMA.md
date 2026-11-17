# Story document format

A story is a single JSON document.

```jsonc
{
  "id": "potomac",
  "title": "Down the Potomac",
  "subtitle": "…",
  "author": "…",
  "date": "October 2026",
  "theme": "light",            // "light" | "dark" | "brutalist" | "atlas" | "aurora" | "editorial" | "blueprint" | "fog"
  "guide": { "kind": "journey", "look": "classic", "prompts": ["…"] },  // stories made with the New story wizard: drives the editor checklist; delete it to hide the checklist
  "motion": "subtle",          // scroll animations: "none" | "subtle" | "expressive"
  "cover": { "image": "https://…", "effect": "parallax", "kicker": "Small label" },  // effect: "none" | "parallax" | "zoom"
  "layers": [ /* Layer[]: data layer library shared by all maps */ ],
  "blocks": [ /* Block[] */ ],
  "credits": "<p>HTML</p>"
}
```

## View

The camera and markers used by maps.

```jsonc
{
  "center": [-77.04, 38.89],   // [lng, lat]
  "zoom": 12, "bearing": 0, "pitch": 0,
  "basemap": "streets",        // streets | bright | light | dark | satellite | usgs-imagery | usgs-topo
  "terrain": true,             // 3D DEM terrain with hillshading and atmospheric sky
  "terrainExaggeration": 1.5,  // 1.0 to 3.0 vertical exaggeration multiplier
  "buildings3d": true,         // extruded 3D vector city buildings with height scaling
  "markers": [{ "lngLat": [-77.05, 38.88], "title": "…", "text": "…" }],
  "layers": ["parks", "trail"],  // ids from story.layers that are visible in this view, drawn in library order
  "legend": true                 // default true
}
```

Any view can also carry `"time": { "at": <ms>, "span": <ms> }`: show features from layers with a time field up to `at`,
and when `span` is more than 0 only the span before it. Leave it out to show all dates.

## Layer

```jsonc
{
  "id": "landmarks",
  "name": "Landmarks",                        // legend title
  "url": "data/landmarks.geojson",            // GeoJSON URL, or /api/public/layers/<id>/geojson, or …/FeatureServer/0
  "hostedLayerId": "Lyr_abc123",              // set when pointing at a Waymark Hosted Feature Layer
  "data": { "type": "FeatureCollection" },    // inline data (from an upload), used instead of url
  "style": {
    "mode": "single",                         // single | categorical | graduated | bivariate
    "color": "#2563eb",                       // single color, fallback color, or the high end of a graduated ramp
    "field": "category",                      // used by categorical / graduated / bivariate
    "field2": "risk_score",                   // used by bivariate 3x3 choropleths
    "bivariatePalette": "blue-orange",        // blue-orange | purple-green | teal-red | blue-pink
    "extrudeField": "total_height",           // 3D polygon & hexbin extrusion field
    "extrudeScale": 1.0,                      // height multiplier for 3D extrusions
    "colors": { "Park": "#16a34a" },          // optional fixed category colors
    "opacity": 0.45, "radius": 6, "width": 3, // polygon fill opacity, point radius, line width
    "label": "name",                          // optional label field
    "sizeField": "magnitude", "sizeMin": 4, "sizeMax": 28,  // proportional symbols: circle area (points, areas) or width (lines) by a number
    "curveLines": true,                       // lines only: renders 2-point origin-destination lines as curved quadratic flow arcs
    "minzoom": 5, "maxzoom": 18,              // optional visible zoom range
    "display": "features",                    // points only: "features" | "heatmap" | "clusters"
    "weight": "visitors"                      // heatmap only: optional numeric field that weights each point
  },
  "time": { "field": "time" },               // a date or time field: maps showing the layer get a time slider
  "filters": [{ "field": "magnitude", "op": "≥", "value": "5" }, { "field": "time", "op": "in the last (days)", "value": "7" }],
  "filterMatch": "all",                       // "all" | "any"
  "query": { "where": "STATE='51'", "outFields": "NAME", "maxAllowableOffset": 0.002 },  // ArcGIS layers: passed to the server
  "transform": "usgs-quakes",                 // converter for non-standard feeds: usgs-quakes | eonet | nws-alerts | coops-stations | usgs-water
  "attribution": "USGS Earthquake Hazards Program",
  "catalog": "usgs-quakes",                   // set on layers added from the public data catalog
  "analysis": { "tool": "buffer", "inputs": { "input": "trail" }, "params": { "distance": 1, "units": "kilometers" } },  // set on layers made by Analyze; lets the editor re-run them
  "drawn": true,                              // made with Draw: the legend lists its shapes, popups show only name and description
  "popup": { "title": "{name}", "fields": ["category", "year"], "enabled": true }
}
```

### Per-feature styles

In a single-color layer, each feature can carry its own look in its `properties`. Waymark reads the
[simplestyle](https://github.com/mapbox/simplestyle-spec) keys, which geojson.io and many other tools write, plus a few of its own.
Anything a feature doesn't set falls back to the layer's `style`. Draw saves shapes this way.

| Property | For | Value |
|---|---|---|
| `stroke`, `stroke-width`, `stroke-opacity` | lines, area outlines, text color | `#rrggbb`, pixels, 0–1 |
| `fill`, `fill-opacity` | areas | `#rrggbb` (defaults to `stroke`), 0–1 |
| `marker-color`, `marker-size` | points | `#rrggbb`, `small` \| `medium` \| `large` |
| `stroke-dash` | lines, area outlines | `solid` \| `dashed` \| `dotted` (Waymark) |
| `arrow` | lines | `true` draws an arrowhead at the end (Waymark) |
| `text`, `text-size` | points | draws the point as a text label instead of a dot (Waymark) |
| `name`, `description` | anything | popup title and text |

### Imagery layers

```jsonc
{ "id": "radar", "name": "Weather radar", "type": "raster",
  "tiles": "https://…/{z}/{x}/{y}.png",     // {date} is replaced with yesterday (or "date") for daily imagery
  "date": "2016-01-01", "maxzoom": 12, "attribution": "…", "style": { "opacity": 0.7 } }
```

### Layers drawn from vector tiles

```jsonc
{ "id": "parcels", "name": "Parcels", "type": "vector",
  "tiles": "/api/layers/<id>/tiles/{z}/{x}/{y}.mvt",   // or https://…/{z}/{x}/{y}.pbf, or a .pmtiles file
  "sourceLayer": "layer",                              // the layer inside the tiles ("layer" for hosted layers)
  "sampleUrl": "/api/layers/<id>/sample",              // hosted layers: attributes of up to 5,000 features, for colors and legends
  "url": "/api/layers/<id>/geojson", "hostedLayerId": "<id>",   // hosted layers keep these, so exports can embed the features
  "bbox": [-124, 26, -67, 48], "style": { /* color, mode, field, sizeField, label, opacity, minzoom, maxzoom */ }, "filters": [] }
```

Hosted layers with more than 20,000 features are added this way automatically. Style, filters, labels, popups and
heatmaps work; clusters, the time slider, drawing, the attribute table and analysis need a layer that is loaded whole.
Map services are ordinary layers too: WMS and WMTS become imagery layers (`type: "raster"`, with `{bbox-epsg-3857}`
in a WMS address), and WFS becomes a layer with a `url`.

## Saved maps

A saved map is its own document, made in the map editor (`/map.html?id=…`) and stored apart from stories:

```jsonc
{
  "title": "Earthquake watch", "summary": "…", "thumbnail": "/uploads/….png",
  "layers": [ /* Layer[], exactly as in a story */ ],
  "view": { "center": [150, 20], "zoom": 1.6, "bearing": 0, "pitch": 0, "basemap": "dark", "layers": ["quakes"], "legend": true },  // starting view and visible layers
  "bookmarks": [{ "id": "b1", "name": "Where they cluster", "note": "…", "view": { "center": [138, 36], "zoom": 4.2 }, "layers": ["quakes", "hex"],
                  "time": { "at": 1791748579015, "span": 86400000 } }]  // optional: the time slider's setting for this bookmark
}
```

Any view in a story can use a saved map instead of listing layers itself:

```jsonc
{ "map": "<map id>", "bookmark": "b1",            // show a bookmark: its camera and its layers
  "center": [138, 36], "zoom": 4.2,               // or, with no bookmark, this camera with the map's visible layers
  "mapLayers": ["quakes"],                        // optional: which of the map's layers to show instead
  "layers": ["mine"], "markers": [] }             // the story's own layers and markers still work on top
```

The story keeps only the reference. Before a story is shown, previewed or exported, the map is loaded and built in: its
layers are copied into `layers` with ids `<map id>~<layer id>`, and the view becomes an ordinary one. Published stories load
their maps live from `GET /api/public/maps/:id`, so edits to a map reach readers without republishing. A map becomes readable
there once a published story of the same owner uses it. Exported websites get a copy and don't depend on the server.

## Dashboards

```jsonc
{
  "title": "Service requests", "map": "<map id>",
  "extentFilter": false,                 // true: charts count only the features inside the map's current view
  "widgets": [
    { "id": "w1", "type": "number", "title": "Open requests", "layer": "<layer id in the map>", "stat": "count" },
    { "id": "w2", "type": "number", "layer": "…", "stat": "sum", "field": "cost", "prefix": "$", "suffix": "" },   // stat: count | sum | avg | min | max
    { "id": "w3", "type": "bars",   "layer": "…", "group": "kind", "stat": "count", "limit": 8 },                  // one bar per value of "group"
    { "id": "w4", "type": "donut",  "layer": "…", "group": "ward", "stat": "sum", "field": "cost" },
    { "id": "w5", "type": "table",  "layer": "…", "fields": ["kind", "ward"], "field": "days_open", "limit": 25 }  // "field": biggest first
  ]
}
```

## Scenarios

A scenario keeps every turn of every branch as a full snapshot, so any turn can be shown, branched from or compared without replaying moves.

```jsonc
{
  "title": "Potomac crossing", "summary": "What the scenario tests",
  "map": "<map id>" | null,                // the saved map it is played on, or null for a plain basemap
  "view": { "center": [-77.05, 38.88], "zoom": 11, "bearing": 0, "pitch": 0, "basemap": "light" },
  "sides": [{ "id": "blue", "name": "Blue", "color": "#2563eb", "affiliation": "F" }],   // affiliation: F friendly | H hostile | N neutral | U unknown
  "clock": { "mode": "turns", "stepMinutes": 60, "start": "" },                          // mode: turns | elapsed | time ("start" is a local date-time)
  "injects": [{ "id": "i1", "title": "Bridge destroyed", "text": "…", "turn": 2, "lngLat": [-77.07, 38.90] }],  // turn: null = released by hand
  "branches": [{
    "id": "main", "name": "Main line", "parent": null, "forkTurn": null,                 // a branch copies its parent's turns 0..forkTurn
    "turns": [{                                                                           // turns[0] is setup
      "units": [{ "id": "u1", "name": "1st Battalion", "side": "blue", "kind": "infantry", "echelon": "F",
                  "strength": 100, "status": "ready",                                     // status: ready | engaged | degraded | destroyed
                  "rangeKm": 3, "speedKmh": 12, "spotted": false, "notes": "",
                  "lngLat": [-77.045, 38.887], "from": [-77.05, 38.88] }],                // "from": where it started this turn, if it moved
      "events": [{ "type": "move", "text": "…" }],                                        // type: move | inject | roll | status | strength | add | remove | note
      "notes": "", "fired": ["i1"]                                                        // ids of the injects released on this turn
    }]
  }]
}
```

Optional rules add more to the document (see `public/js/scenario-rules.js` for the full list and defaults):

```jsonc
{
  "terrain": { "origin": [-77.2, 38.8], "size": 0.144, "cols": 90, "rows": 60, "kx": 86.7, "cellKm": 0.25,
               "cover": "<one base64 character per hex: ground 0–4 | road level << 3 | river << 5>",
               "elev": "<base64 of an Int16Array, metres per hex, −32768 = unknown>", "built": "2026-11-16T…", "partial": "map features" },
  "zones": [{ "id": "z1", "name": "Minefield", "coords": [[x, y], …], "effect": "slow", "factor": 0.5, "costMult": 2,   // effect: slow | block | cost | jam
              "mobility": ["tracked", "wheeled"] | null, "from": 0, "until": null, "inject": null }],
  "movement": { "tracked": { "forest": 0.2 } },                    // overrides of the movement table
  "network": {
    "nodes": [{ "id": "n1", "name": "Main depot", "type": "depot", "side": "blue", "lngLat": [x, y] }],          // depot | port | airfield | relay
    "links": [{ "id": "l1", "name": "MSR", "type": "road", "side": "blue" | null, "coords": [[x, y], …] }]      // road | rail | bridge | river | sea | air | pipeline | signal
  },
  "objectives": [{ "id": "o1", "name": "Bridge", "lngLat": [x, y], "radiusKm": 1, "points": 10, "holder": null }],
  "victory": { "text": "…", "target": 30, "mode": "held" },        // mode: held | total
  "combat": { "columns": ["1:3", …], "rows": [["A50 AR", …], …] },  // 6 rows, one per die roll
  "rules": { "planning": false, "autoSpot": false, "auto": false, "lossPct": 10, "resupply": 50, "reachKm": 5, "radioKm": 25, "interdictKm": 2 }
}
```

Each turn may also have `links` (`{ "<link or node id>": "open" | "degraded" | "cut" }`, carried to the next turn) and `graphics`
(`[{ id, type: phase | boundary | arrow | area | label, side, label, coords }]`). Units may have `mobility`, `sensorKm`, `power`,
`parent` (a headquarters unit id), `supply` (0–100 at the start of the turn), `used`, `path` and `hours` (this turn's move over terrain),
and `plan` (a planned move: `{ to, path?, km?, hours?, cost? }`). Injects may have `effects: [{ target: "<link or node id>", status }]`.

Unit kinds and sizes are listed in `public/js/scenario-core.js` (`KINDS`, `ECHELONS`). Military kinds are drawn with [milsymbol](https://github.com/spatialillusions/milsymbol); civil kinds are drawn as a badge.

## Blocks

Every block has a `type`. Rich-text fields (`html`) are sanitized at render time. The allowed tags are p, br, b/strong, i/em, u, a, ul/ol/li, h2–h4, blockquote, code, span and small.

| type | fields |
|---|---|
| `text` | `html`, `style?` (`"large"`) |
| `quote` | `text`, `cite?` |
| `separator` | none |
| `image` | `url`, `alt`, `caption?`, `size?` (`small` \| `standard` \| `wide` \| `full`), `effect?` (`none` \| `parallax` \| `zoom` \| `reveal`) |
| `chapter` | `title`, `kicker?`, `text?`, `bg`, `fg` (hex colors), `align?` (`center` \| `left`), `image?`. A full-screen title. The page takes on `bg`/`fg` from here until the next chapter |
| `statement` | `text`, `cite?`, `style?` (`sans`). Large text whose words light up as the reader scrolls |
| `stats` | `items: [{ value, label }]`, `caption?`. `value` can include a prefix or suffix (`$3.4M`, `98%`, `1,200`) and counts up when it appears |
| `chart` | `chartType` (`bar` \| `column` \| `donut` \| `table` \| `sankey` \| `network`), `title?`, `subtitle?`, `caption?`, `color?`, `prefix?`, `suffix?`, `size?`, `sourceType?` (`manual` \| `layer`), `layerId?`, `groupField?`, `midField?`, `targetField?`, `stat?`, `valueField?`, `networkLayout?` (`force` \| `geo`), `syncBounds?` (`boolean`), `items: [{ label, target?, value, color?, note? }]` |
| `gallery` | `title?`, `text?`, `images: [{ url, caption?, alt? }]`. Scrolling down moves the row of images sideways |
| `video` | `url` (YouTube, Vimeo or a video file), `caption?`, `size?` |
| `embed` | `url`, `caption?`, `size?` |
| `map` | `view`, `caption?`, `size?` |
| `scrollmap` | Moving map. `layout` (`overlay` \| `split`), `slides: [{ html, media, actions? }]`. `media` is `{ type: "map", view }` or `{ type: "image" \| "video" \| "embed", url, alt }`. `actions: [{ id, label, view }]` are map links, triggered by `<a href="#action:<id>">` links in `html`. `label` remembers the linked words; several links can share one action |
| `stops` | Stop by stop. `basemap`, `zoom`, `layers?`, `places: [{ title, lngLat, image?, html? }]` |
| `compare` | Before & after. `left`, `right` (basemap keys), `leftLayers?`, `rightLayers?`, `leftLabel?`, `rightLabel?`, `view`, `caption?` |

Stories saved by earlier versions used the block types `sidecar`, `tour` and `swipe` and the layouts `docked` and `floating`. They are converted automatically when a story is opened, displayed or exported (see `public/js/story-format.js`).
