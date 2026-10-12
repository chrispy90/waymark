# Changelog

All notable changes to Waymark are listed here. Versions follow [semantic versioning](https://semver.org): a **major** version can break existing stories or settings, a **minor** version adds features, and a **patch** fixes bugs.

## Unreleased

Nothing yet.

## 1.2.1 (2026-10-12)

### Changed
- **Map links are made right in the text.** Select words in a moving-map card and press **Map link** in the formatting bar; the map picker opens and the words are linked as soon as you choose the view. Click a map link in the text to change where the map goes, move it to other words, or remove it. Links are highlighted in the editor, and the list under the card shows each link's actual words, plus any view that's no longer attached to text. The separate "Add map link" and "Link selected words" steps are gone.

### Fixed
- Long card summaries no longer widen the editor panel and push buttons out of view.

## 1.2.0 (2026-10-12)

### Changed
- Data labels and text on dark and satellite basemaps are now light with a dark outline, instead of dark text with a white halo.
- Night's chapter colors are now plum, teal and ember, so it no longer looks like Classic.

### Added
- **New story wizard.** Pick the kind of story (journey, walking tour, illustrated essay, data story or blank), a look, a title and cover photo, then your places (search or click the map) or chapter titles and any extras. Waymark builds the story from your answers, with short prompts where your words go, so there's no demo content to delete. The finished examples are still there under **Explore an example**.
- **Looks:** Classic, Night, Brutalist, Atlas and Aurora, each with matching type, colors, chapter colors, map style and scroll animation. Pick one in the wizard or under Story → Look & feel, and restyle existing chapters and maps to match in one click.
- **"Finish your story" checklist** in the editor for stories made with the wizard: cover photo, replacing the prompts (with a live count), photos, data, map views, a phone check and publishing. Click a step to jump straight there.
- **Atlas look:** parchment and paper grain, engraved serif type with small caps and old-style figures, sepia-toned maps in a double neatline with a compass rose and vignette, chapters numbered as plates, and ornamental dividers.
- **Aurora look:** dark glass, slowly drifting aurora light and film grain, gradient display type, frosted cards, bento-style big numbers, and "firefly" maps where points and lines glow.
- Photo blocks and galleries without photos show a placeholder in the editor's preview and stay hidden from readers.

## 1.1.0 (2026-10-12)

### Added
- **Brutalist theme.** Raw monospace and heavy display type, hard black edges, offset shadows, acid-yellow highlights, a ticker headline, outlined statement words, auto-numbered chapters and slightly crooked photos. Pick it under Story → Look & feel.
- **Brutalist zine template:** a field guide to four brutalist buildings, with shapes drawn on its map.
- **A much richer Draw tool.** New shapes: freehand lines, boxes, circles and text labels, alongside points, lines and areas. Each shape has its own color, fill color and fill opacity, line width, opacity and style (solid, dashed or dotted), an optional arrowhead, marker size, text size, name and description. Select shapes to move, restyle, duplicate or delete them, trace over another layer, and reopen any saved drawing with **Edit shapes**.
- Layers honor per-feature styles in the simplestyle convention (`stroke`, `fill`, `marker-color` and so on), so styled GeoJSON from geojson.io keeps its colors. See docs/SCHEMA.md.

### Fixed
- Layers without a source credit (your own uploads and drawings) failed to appear on maps.

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
