# Changelog

All notable changes to Waymark are listed here. Versions follow [semantic versioning](https://semver.org): a **major** version can break existing stories or settings, a **minor** version adds features, and a **patch** fixes bugs.

## Unreleased

Nothing yet.

## 1.0.0 (2026-10-12)

The first public release.

### Stories
- Blocks: cover and byline, text, quote, divider, image, video, embed, map, moving map, stop by stop, before & after.
- Scroll effects: chapters that recolor the page, statements that light up word by word, big numbers that count up, sideways scroll galleries, parallax/zoom/reveal images and covers, and a story-wide scroll animation setting. All of them turn off for readers who ask for reduced motion.
- Templates: moving map story, stop-by-stop walk, chaptered essay, blank story, and the *Down the Potomac* sample.

### Maps and data
- MapLibre maps with streets, bright, light, dark, Sentinel-2 satellite, USGS imagery and USGS topo basemaps.
- Data layers from GeoJSON, CSV, or public ArcGIS layers, styled by color, category or value, with labels, popups, legends, heatmaps and clusters.
- A public data catalog with live and reference layers from USGS, NOAA, NASA, the Census Bureau, NPS, USFS, EPA, NIFC and Natural Earth, plus ArcGIS Online search.
- Per-layer filters, insights, draw and measure, and analysis tools: buffer, hex bins, count in areas, distance to nearest, within distance, center points, outline and filter.

### Editor and publishing
- Click-to-edit preview, drag to reorder, undo and redo, command palette, keyboard shortcuts, phone preview and autosave.
- Accounts, image uploads, draft and published copies, custom links, and password reset by email or the command line.
- Export a story as a static website (.zip) or a Tomcat web app (.war), from the editor or with `node server.js export`.
- Runs with `npm start` or Docker, with no dependencies.
