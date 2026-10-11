# StoryMaps

A clean-room, open-source rebuild of the core ArcGIS StoryMaps experience: scroll-driven map stories with a visual builder.

No Esri code, SDK, or API key. Maps use [MapLibre GL JS](https://maplibre.org/) with free [OpenFreeMap](https://openfreemap.org/) vector basemaps (OpenStreetMap data).

## Run

```bash
node server.js
```

Then open http://localhost:5180. There are no dependencies to install.

| Page | What it does |
|---|---|
| `index.html` | Gallery: the sample story plus drafts saved in this browser |
| `builder.html` | Editor with a live preview. `?id=<draft>` or `?from=stories/<file>.json` |
| `viewer.html` | Reader. `?story=stories/<file>.json` (published file) or `?local=<draft id>` |

## Feature map vs. ArcGIS StoryMaps

| ArcGIS StoryMaps | Here | Status |
|---|---|---|
| Cover, title, byline | Story `cover` and header | Done |
| Text, quote, separator, image, video, embed | Blocks of the same names | Done |
| Express or web map in the story | `map` block (view + markers) | Done |
| Sidecar (docked / floating), the Map Journal and Cascade scroll pattern | `sidecar` block; each slide sets its own map view or media and the map flies between them | Done |
| Guided tour (Map Tour) | `tour` block: numbered places, step through them or click a marker | Done |
| Swipe | `swipe` block: compare two basemaps with a draggable divider | Done |
| Map actions (inline links that change the map) | | Next |
| Feature layers / GeoJSON overlays, legends, popups from data | | Next |
| Satellite imagery basemap | Needs a licensed imagery provider (e.g. MapTiler or Esri with a key) | Next |
| Collections, themes, publishing, sharing, accounts | Drafts live in `localStorage` only; export and import JSON | Needs a backend |
| Image upload | URLs only | Needs a backend |

## Layout

```
server.js              zero-dependency static server
public/
  js/render.js         story JSON -> DOM; all block renderers
  js/maps.js           MapLibre helpers: basemaps, views, markers, flyTo
  js/builder.js        editor UI, map-view picker, import/export
  js/store.js          localStorage drafts (swap for an API later)
  js/sanitize.js       allow-list HTML sanitizer for author text
  stories/potomac.json sample story
docs/SCHEMA.md         story document format
_reference/            cloned open-source projects (git-ignored, read-only reference)
```

## References

`_reference/` holds shallow clones used only to study data models and UX patterns. No code was copied from them.

- `Esri/storymap-journal`, `Esri/storymap-series`: Esri's classic templates, Apache-2.0
- `mapbox/storytelling`: BSD-3-Clause

The current ArcGIS StoryMaps product is closed source and was not used.
