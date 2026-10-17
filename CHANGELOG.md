# Changelog

All notable changes to Waymark are listed here. Versions follow [semantic versioning](https://semver.org): a **major** version can break existing stories or settings, a **minor** version adds features, and a **patch** fixes bugs.

## Unreleased

### Added
- **Fog look.** A thick fog storm. Fog drifts behind and in front of the story, with gusts and faint lightning in the murk. The pointer carries a lantern that clears the fog around it. Headings, photos and statement words come into focus as they scroll in, and map markers glow like lanterns. A weather readout in the top bar counts visibility up as the fog lifts toward the end of the story. Motion and flashes switch off for readers who ask for reduced motion.

## 1.4.0 (2026-10-17)

### Added
- **Hosted feature layers.** Server-backed layers you can reuse across maps and stories, made from the **Layers** tab or by promoting any drawn, uploaded or analysis layer. Each has a live GeoJSON endpoint and its own source credit.
- **Editable attribute tables.** Edit cells inline; add, rename and delete columns; add and delete rows; see column statistics; and fill columns with a **field calculator** (math, geometry measures such as `$AREA_KM2` and `$LEN_KM`, ranks, text templates and `$ELEVATION_M`). Export any table as GeoJSON or CSV.
- **Chart & table block:** bars, columns, donuts or sortable tables, built from a layer or from your own rows.
- **3D:** one-click terrain with hillshade, exaggeration and sky; 3D city buildings; a tilt readout; and polygons or hex bins extruded by a number field.
- **Bivariate maps:** a 3×3 choropleth of two number fields, with a matrix legend.
- **Remote sensing:** spectral overlays (NDVI, false-color infrared, sea surface temperature, aerosols, snow cover, shaded relief, hydrography), a Sentinel-2 scene finder with cloud-cover filtering, and before-and-after satellite comparisons.
- **More file types:** KML and KMZ, GPX (with distance and elevation stats) and geotagged photos.
- **Editorial** and **Blueprint** looks.
- **Proportional symbols.** Size points, areas or lines by a number field ("Size by number"): circle area grows with the value, areas get a circle at their center, lines get wider, and big circles draw under small ones. The legend shows the sizes, and it works together with color by category or number.
- **Time slider.** Pick a time field on a layer and every map showing it gets a time slider with play. Show everything up to a moment, or a trailing day, week or 30 days. It works in the map editor, in stories (readers can scrub and play) and in exported sites, and bookmarks and story cards remember the setting.
- **More analysis tools**, grouped into Summarize, Proximity, Overlay, Terrain and Manage data. New ones include multi-ring trade areas, hub & spoke lines, density clusters (DBSCAN), joins by field, an elevation profile and slope tool, **Clip**, **Erase**, **Intersect**, **Join by location** (spatial join), **Select by location** (touch, inside, contain, stay clear), **Merge**, **Dissolve** (optionally by a field), **Voronoi areas** (Thiessen polygons), **Simplify** and **Add geometry attributes** (area, perimeter, length, coordinates).

### Fixed
- The legend and other bottom-left map controls move up out of the way of the time slider.

## 1.3.0 (2026-10-15)

### Added
- **Saved maps.** Build a map once in a full-screen map editor and use it in any number of stories; edit it and every story updates, published ones included (readers load maps live; exports get a copy).
  - **Layers:** add from the public data catalog, files, links or drawing; reorder by dragging; show/hide; zoom to; duplicate; remove.
  - **Layer settings:** style, labels, popups, filters, insights and a new visible zoom range, plus an **attribute table** (sort, search, click a row to zoom to the feature).
  - **Tools:** analysis, drawing, measuring (distance and area), place search, a basemap gallery and the legend. **Map details** has the title, summary, thumbnail, starting view, the stories that use the map, save a copy and delete.
  - **Bookmarks:** named views that remember which layers are on, with a note each.
- **Walk readers through a map.** "Add cards from a saved map's bookmarks" turns each bookmark into a moving-map card, and "Use in a new story" starts a story that way. Any map in a story can **use a saved map** and show a bookmark or a custom view and set of layers.
- **Maps** tab on the home screen, with new, duplicate, delete (warning when stories use the map) and "New story with this map".

### Changed
- **Tour builder for Stop by stop.** Stops are edited in one workspace: every stop numbered on a big map, a list with photo thumbnails, and the selected stop's photo, name and text side by side.
  - **Add photos:** drop a batch of photos and each becomes a stop where it was taken (from the photo's GPS data), in the order it was taken, named after the file. Photos without a location are flagged, and one click on the map places each.
  - Add stops by searching for a place or by pressing **Add stop** and clicking the map. Drag a marker to move a stop, drag the list to reorder, and set a zoom per stop.
  - A new Stop by stop block opens the tour builder straight away, and the editor panel shows the tour at a glance with **Edit stops** and **Add photos** buttons.

## 1.2.2 (2026-10-12)

### Changed
- **Draw right on a map.** Every map in the editor (map blocks, moving-map cards, before & after) has a **Draw** button next to **Edit map**. The drawing tools open on exactly that map, over its other layers, and **Add to this map** switches the drawing on there. Press **Draw** again to keep drawing on it or start a new drawing. Data → Draw still works for drawings you want to use on several maps.

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
