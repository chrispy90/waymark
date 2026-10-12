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
    "display": "features",                    // points only: "features" | "heatmap" | "clusters"
    "weight": "visitors"                      // heatmap only: optional numeric field that weights each point
  },
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
