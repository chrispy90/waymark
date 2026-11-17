# Key ideas and terms

This page explains the building blocks of Waymark and how they fit together. The rest of the guide uses these words.

## How the pieces fit together

```text
Hosted layer ──┐
Public data ───┼──► Layer ──► Saved map ──► Story
Your files ────┘               (bookmarks)    Dashboard
                                              Public map page
Form ─────────► adds points to a hosted layer
```

Data comes in as **layers**. Layers go on **maps**. A map can live inside one story, or be a **saved map** that many stories and dashboards use. **Hosted layers** live on the server, so one layer can feed many maps, and forms and scheduled refreshes can update it.

## Glossary

### Story
A scrolling web page made of [blocks](#block). It has a draft that you edit and, once you publish, a public copy at `/s/your-link`. See [The story editor](stories.md).

### Block
One section of a story: a paragraph, a photo, a map, a chapter title, a gallery. Blocks are added with **+** or <kbd>/</kbd> and reordered by dragging. See the [Blocks reference](blocks.md).

### Look
A named design (Classic, Night, Brutalist, Atlas, Aurora, Editorial, Blueprint, Fog) that sets a story's typefaces, colors, chapter colors, map style and scroll animation. See [Looks](stories.md#looks).

### Layer
A set of map features, such as earthquakes, parks or your own drawing, with a style, labels, popups and optional filters. A layer can come from a file, a link, the public data catalog, a map service, a hosted layer, an analysis or drawing. See [Add data](add-data.md).

### Feature
One thing on the map: a point, line or area, plus its attributes (fields and values), such as a park with a name and an area.

### Attribute, field
A named value that every feature in a layer can have, such as `magnitude` or `name`. Fields have a type: text, number, yes/no or date. Fields drive colors, sizes, labels, popups, filters, charts and analysis.

### Imagery layer
A picture of the map rather than individual features: satellite images, weather radar, WMS and WMTS services. You can show it and set its opacity, but you can't filter, style by field or analyze it.

### Hosted layer
A layer stored on your Waymark server. It has an editable attribute table and schema, keeps a version history, can be shared, can be refreshed from a URL on a schedule, and can collect points through a form. Very large hosted layers are drawn from vector tiles. See [Hosted layers](hosted-layers.md).

### Vector tiles
Map data cut into small square pieces at each zoom level. The browser only downloads the pieces on screen, so a layer with millions of features stays fast. Waymark makes tiles automatically for hosted layers with more than 20,000 features.

### View
Where a map looks (center, zoom, rotation, tilt), its basemap, which layers are visible, its markers and, optionally, 3D terrain and a time setting. Every map in a story has a view.

### Basemap
The background map under your data: Streets, Bright, Light gray, Dark, Satellite, USGS imagery or USGS topo. See [Basemaps](layer-settings.md#basemaps).

### Saved map
A map you build once in the [map editor](map-editor.md), with its own layers, starting view and bookmarks, and use in any number of stories and dashboards. Edit it once and everything that uses it updates.

### Bookmark
A named view in a saved map that also remembers which layers are on and the time slider's setting, with a note. A story can show any bookmark, and one click turns a map's bookmarks into moving-map cards.

### Moving map
A story block where cards scroll past while the map moves to a different view for each card. Words in a card can be **map links** that send the map somewhere else. See [Maps in stories](story-maps.md).

### Analysis result
A new layer made by an analysis tool, such as a buffer or hex bins. It remembers the tool, inputs and settings, so you can run it again on fresh data. See [Analysis overview](analysis.md).

### Dashboard
A saved map beside numbers and charts that filter each other. See [Dashboards](dashboards.md).

### Scenario
A tabletop exercise played on a map, turn by turn, with units for each side. See [Scenarios](scenarios.md).

### Form
A public page that adds a point to a hosted layer for each submission. See [Forms](forms.md).

### Group
A set of accounts you can share with at once. Made on the **Team** tab. See [Sharing and teams](sharing.md).

### Owner, editor, viewer
Everything has one **owner**, the person who made it. The owner can share it with people or groups as an **editor** (can change it) or a **viewer** (can open it). Only the owner can delete, publish or change sharing. See [Who can do what](sharing.md#who-can-do-what).

### Public link
An address anyone can open without signing in: a published story (`/s/…`), a map shared by link (`/m/…`), a dashboard shared by link (`/d/…`), a form (`/f/…`) or your public page (`/u/…`).

### Draft and published copy
A story has a **draft** that saves as you edit, and a **published copy** that readers see. Publishing copies the draft over the published copy. See [Publish and update](publish.md).
