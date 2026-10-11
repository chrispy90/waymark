# Story document format

A story is a single JSON document.

```jsonc
{
  "id": "potomac",
  "title": "Down the Potomac",
  "subtitle": "…",
  "author": "…",
  "date": "October 2026",
  "theme": "light",            // "light" | "dark"
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
  "analysis": { "tool": "buffer", "inputs": { "input": "trail" }, "params": { "distance": 1, "units": "kilometers" } },  // set on layers made by Analyze; lets the editor re-run them
  "popup": { "title": "{name}", "fields": ["category", "year"], "enabled": true }
}
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
| `sidecar` | `layout` (`docked` \| `floating`), `slides: [{ html, media, actions? }]`. `media` is `{ type: "map", view }` or `{ type: "image" \| "video" \| "embed", url, alt }`. `actions: [{ id, label, view }]` are triggered by `<a href="#action:<id>">` links in `html` |
| `tour` | `basemap`, `zoom`, `layers?`, `places: [{ title, lngLat, image?, html? }]` |
| `swipe` | `left`, `right` (basemap keys), `leftLayers?`, `rightLayers?`, `leftLabel?`, `rightLabel?`, `view`, `caption?` |
