# Story document format

A story is a single JSON document.

```jsonc
{
  "id": "potomac",
  "title": "Down the Potomac",
  "subtitle": "…",
  "author": "…",
  "date": "October 2026",
  "theme": "light",            // "light" | "dark" | "brutalist" | "atlas" | "aurora"
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
  "basemap": "streets",        // streets | bright | light | dark
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
  "url": "data/landmarks.geojson",            // GeoJSON URL, or …/FeatureServer/0, or …/MapServer/0
  "data": { "type": "FeatureCollection" },    // inline data (from an upload), used instead of url
  "style": {
    "mode": "single",                         // single | categorical | graduated
    "color": "#2563eb",                       // single color, fallback color, or the high end of a graduated ramp
    "field": "category",                      // used by categorical / graduated
    "colors": { "Park": "#16a34a" },          // optional fixed category colors
    "opacity": 0.45, "radius": 6, "width": 3, // polygon fill opacity, point radius, line width
    "label": "name",                          // optional label field
    "sizeField": "magnitude", "sizeMin": 4, "sizeMax": 28,  // proportional symbols: circle area (points, areas) or width (lines) by a number
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
| `gallery` | `title?`, `text?`, `images: [{ url, caption?, alt? }]`. Scrolling down moves the row of images sideways |
| `video` | `url` (YouTube, Vimeo or a video file), `caption?`, `size?` |
| `embed` | `url`, `caption?`, `size?` |
| `map` | `view`, `caption?`, `size?` |
| `scrollmap` | Moving map. `layout` (`overlay` \| `split`), `slides: [{ html, media, actions? }]`. `media` is `{ type: "map", view }` or `{ type: "image" \| "video" \| "embed", url, alt }`. `actions: [{ id, label, view }]` are map links, triggered by `<a href="#action:<id>">` links in `html`. `label` remembers the linked words; several links can share one action |
| `stops` | Stop by stop. `basemap`, `zoom`, `layers?`, `places: [{ title, lngLat, image?, html? }]` |
| `compare` | Before & after. `left`, `right` (basemap keys), `leftLayers?`, `rightLayers?`, `leftLabel?`, `rightLabel?`, `view`, `caption?` |

Stories saved by earlier versions used the block types `sidecar`, `tour` and `swipe` and the layouts `docked` and `floating`. They are converted automatically when a story is opened, displayed or exported (see `public/js/story-format.js`).
