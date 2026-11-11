# Draw and measure

Draw your own points, routes, areas and labels on a map, style each one, and save them as a layer. Measure distances and areas as you go.

## Open the drawing tools

| From | Result |
| --- | --- |
| **Draw** next to **Edit map** on any map in the story editor | Draws on exactly that map, over its other layers. **Add to this map** saves the drawing and switches it on for that map. |
| **Draw** in the story editor's **Data** tab | A drawing you can turn on in any map of the story. |
| **Draw** in the map editor's tool rail | A drawing saved as a layer of the saved map. |
| **Edit shapes** in a layer's settings | Reopens an existing drawing, hosted layer or small layer so you can change its shapes. |

## Drawing tools

| Tool | How to use it |
| --- | --- |
| **Select** | Click a shape to select it. Drag a selected shape to move it. |
| **Point** | Click the map to drop a point. |
| **Line** | Click to add corners. Double-click or press <kbd>Enter</kbd> to finish. |
| **Freehand** | Press and drag to draw. Let go to finish. |
| **Area** | Click to add corners. Double-click or press <kbd>Enter</kbd> to close the area. |
| **Box** | Press and drag from one corner to the other. |
| **Circle** | Press at the center and drag out to the edge. |
| **Text** | Click where the text goes, then type it in the panel. |

While drawing a line or area, **Undo corner** (or <kbd>Backspace</kbd>) removes the last corner and **Finish shape** (or <kbd>Enter</kbd>) completes it. Lengths and areas are shown as you draw.

## Style a shape

Select a shape (or set the style before drawing) and change:

| Setting | Applies to |
| --- | --- |
| **Name** | Shown in the legend and, with **Show shape names on the map**, on the map. |
| **Description** | Shown when readers click the shape. |
| **Color** / **Outline color** | All shapes. |
| **Fill color** and fill opacity | Areas, boxes and circles. **Same as the outline**, or any color. |
| **Line width**, **Line opacity** | Lines and outlines. |
| **Line style** | **Solid**, **Dashed** or **Dotted**. |
| **Arrowhead at the end** | Lines: an arrow pointing the way the line was drawn. |
| **Size** | Points: **Small**, **Medium** or **Large**. |
| **Text size** | Text labels. |

Select a shape to **Duplicate** or **Delete** it. The **Shapes** list shows everything in the drawing; click one to select it.

## Trace over another layer

Turn on **Show another layer to trace over** and pick a layer to see it under your drawing, so you can follow a road, a boundary or a set of points exactly.

## Save the drawing

- **Add to this map** (when drawing on a story map) saves the drawing and switches it on for that map.
- **Save as a layer** saves it as a layer you can turn on in any map. Give it a **Layer name**.
- When editing a hosted layer, **Save changes** updates the hosted layer on the server, and the change is added to its [version history](hosted-layers.md#version-history).

Closing without saving asks first, so you don't lose your work.

Drawings use per-feature styles, so each shape keeps its own colors in every map, in exports and in other GIS software. See [Per-feature styles](layer-settings.md#per-feature-styles).

## Measure

In the map editor, select **Measure** in the tool rail, choose **Distance** or **Area**, and click points on the map. The panel shows the distance, or the area and its perimeter, in metric and imperial units. **Undo point** removes the last point and **Clear** starts again. Nothing is saved; use Draw to keep a shape.

The drawing tools also show measurements: each line's length and each area's size, as you draw.
