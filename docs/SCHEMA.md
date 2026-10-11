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
  "cover": { "image": "https://…" },
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
  "markers": [{ "lngLat": [-77.05, 38.88], "title": "…", "text": "…" }]
}
```

## Blocks

Every block has a `type`. Rich-text fields (`html`) are sanitized at render time. The allowed tags are p, br, b/strong, i/em, u, a, ul/ol/li, h2–h4, blockquote, code, span and small.

| type | fields |
|---|---|
| `text` | `html`, `style?` (`"large"`) |
| `quote` | `text`, `cite?` |
| `separator` | none |
| `image` | `url`, `alt`, `caption?`, `size?` (`small` \| `standard` \| `wide` \| `full`) |
| `video` | `url` (YouTube, Vimeo or a video file), `caption?`, `size?` |
| `embed` | `url`, `caption?`, `size?` |
| `map` | `view`, `caption?`, `size?` |
| `sidecar` | `layout` (`docked` \| `floating`), `slides: [{ html, media }]`. `media` is `{ type: "map", view }` or `{ type: "image" \| "video" \| "embed", url, alt }` |
| `tour` | `basemap`, `zoom`, `places: [{ title, lngLat, image?, html? }]` |
| `swipe` | `left`, `right` (basemap keys), `leftLabel?`, `rightLabel?`, `view`, `caption?` |
