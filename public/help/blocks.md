# Blocks reference

A story is a column of blocks. This page lists every block, what it's for, and its settings. To add a block, select **+** between blocks or press <kbd>/</kbd>. See [The story editor](stories.md#add-move-and-remove-blocks).

Many blocks have a **Width** setting:

| Width | Result |
| --- | --- |
| **Text width** | As wide as the text column. |
| **Wide** | Wider than the text, with margins. |
| **Full bleed** | Edge to edge of the screen. |

## Write

### Text
Paragraphs, headings, lists and links. Use it for most of your writing.

| Setting | What it does |
| --- | --- |
| Text | The rich text editor. See [Write and format text](stories.md#write-and-format-text). |
| **Style** | **Normal**, or **Big intro** for a larger opening paragraph. |

### Quote
A pull quote that stands out from the text.

| Setting | What it does |
| --- | --- |
| **Quote** | The words. |
| **Who said it** | The name shown under the quote. |

### Divider
A quiet break between sections. It has no settings.

## Media

### Image
A photo with a caption and optional scroll motion.

| Setting | What it does |
| --- | --- |
| **Image** | Upload a photo (JPEG, PNG, WebP or GIF), paste a link, or pick from your **Library**. Photos are resized and their location data is removed before upload. |
| **Caption** | Shown under the image. |
| **Alt text** | Describes the image for people who use screen readers. Always fill this in. |
| **Width** | Text width, Wide or Full bleed. |
| **Scroll motion** | **None**, **Parallax** (moves slower than the page), **Zoom** (slowly zooms in) or **Reveal** (wipes into view). |

### Video
A YouTube or Vimeo video, or a link to a video file.

| Setting | What it does |
| --- | --- |
| **Video link** | A YouTube, Vimeo or video file address. |
| **Caption**, **Width** | As for images. |

### Embed
Any web page that allows embedding: a chart, a survey, another dashboard, a Waymark map.

| Setting | What it does |
| --- | --- |
| **Page link** | The address of the page. |
| **Caption**, **Width** | As for images. |

> [!NOTE]
> Some websites refuse to be shown inside other pages. If an embed stays blank, the site doesn't allow it; link to it from a Text block instead.

## Maps

These blocks are covered in depth in [Maps in stories](story-maps.md).

### Map
An interactive map with markers and data.

| Setting | What it does |
| --- | --- |
| **Map** | Select **Edit map** to frame the view, drop markers and pick layers, or **Draw** to sketch on this map. See [Set a map view](story-maps.md#set-a-map-view). |
| **Caption**, **Width** | As for images. |

### Moving map
Story cards scroll past while the map glides to a new view for each card.

| Setting | What it does |
| --- | --- |
| **Layout** | **Cards over the map** (cards float over a full-screen map) or **Side by side** (text column beside the map). |
| **Cards** | One card per step. Each card has text and, under **Beside this card, show**, a **Map** (with its own view), an **Image**, a **Video** or an **Embed**. |
| **Add cards from a saved map's bookmarks** | Adds one card per bookmark of a saved map, in order. See [Walk readers through a saved map](story-maps.md#walk-readers-through-a-saved-map). |

### Stop by stop
Readers step through numbered places, each with a photo, a title and a few lines.

| Setting | What it does |
| --- | --- |
| **Stops** | Opens the tour builder: drop photos, search for places, drag to reorder. See [Build a tour](story-maps.md#build-a-tour). |
| **Basemap** | The map style. |
| **Zoom level at each place** | How close the map goes for each stop (each stop can override it). |
| **Data layers** | Story layers to show on the tour map. |

### Before & after
Two maps in one frame with a divider readers drag to compare.

| Setting | What it does |
| --- | --- |
| **Map** | The shared view (center and zoom). |
| **Left label**, **Right label** | Shown on each side, such as "2010" and "2024". |
| **Left basemap**, **Right basemap** | A different basemap on each side. |
| **Satellite Time-Travel sensor** | Optional: compare daily satellite imagery from two dates. See [Compare two dates](story-maps.md#compare-two-dates-from-space). |
| **Left date**, **Right date** | The imagery dates when a sensor is chosen. |
| **Left data layers**, **Right data layers** | Different layers on each side. |
| **Caption** | Shown under the comparison. |

### Chart, Sankey & network
An interactive chart: bars, columns, a donut, a Sankey flow diagram, a network graph or a table.

| Setting | What it does |
| --- | --- |
| **Chart title**, **Subtitle** | Shown above the chart. |
| **Display as** | **Bars**, **Columns**, **Donut**, **Sankey**, **Network** or **Table**. |
| **Data source** | **Custom rows** you type in, or a layer in the story. |
| **Group by category field** | For a layer: one bar, slice or row per value of this field. Sankey and network charts use **Source node field** and **Target node field** (and an optional **Middle stage field** for a three-column Sankey). |
| **Statistic** | **Count**, **Sum**, **Average**, **Max** or **Min**, with a **Numeric field to measure**. |
| **Max categories to show** | Keeps long lists readable. |
| **Default network layout** | **Force-directed**, or **Geo-pinned** (nodes at their map positions). |
| **Filter chart dynamically as reader pans & zooms the map** | The chart recounts using only the features in view on the story's map. |
| **Prefix**, **Suffix** | Units such as `$` or `%`. |
| **Width**, **Caption** | As for images. |

> [!TIP]
> From a layer's **Insights** in the Data tab, **Add chart to story** makes a chart of that layer in one step.

## Scroll effects

### Statement
Huge text that lights up word by word as readers scroll.

| Setting | What it does |
| --- | --- |
| **Statement** | One sentence works best. |
| **Small caption** | Optional source or name under it. |
| **Typeface** | **Serif** or **Sans**. |

### Chapter
A full-screen title that recolors the page from this point on, until the next chapter.

| Setting | What it does |
| --- | --- |
| **Small label** | Such as "Chapter 2". |
| **Title**, **Intro line** | The chapter's heading and an optional line under it. |
| **Page color**, **Text color** | The colors for this chapter and the blocks after it. Readers see the page fade between colors. |
| **Alignment** | **Center** or **Left**. |
| **Background image** | Optional photo behind the title. |

When a story has chapters, readers get chapter buttons in the top bar to jump between them.

### Big numbers
Two to four figures that count up when they scroll into view.

| Setting | What it does |
| --- | --- |
| **Numbers** | Each has a **Number** (such as `3.4M`, `98%`, `$120`) and **What it means**. Prefixes, suffixes, decimals and thousands separators are kept. |
| **Caption** | Where the numbers come from. |

### Scroll gallery
A row of photos that slides sideways as readers scroll down.

| Setting | What it does |
| --- | --- |
| **Title**, **Short intro** | Shown before the photos. |
| **Photos** | Each with a **Caption** and **Alt text**. |

> [!NOTE]
> All motion turns off for readers who ask their device to reduce motion. Their page still shows every word and photo.
