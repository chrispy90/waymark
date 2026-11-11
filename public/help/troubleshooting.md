# Troubleshooting and FAQ

## Signing in

**I forgot my password.**
On the sign-in page, select **Forgot?**, enter your email, and follow the link in the email (it works once, for 60 minutes). If no email arrives, your administrator can give you a reset link. See [Accounts](admin.md#accounts).

**It says sign-ups are closed.**
Your administrator has turned off new accounts. Ask them to create one for you.

**I can't share with a colleague: "No account uses that email yet."**
They need a Waymark account on the same server first, with exactly that email. Ask them to sign up, then share again.

## Maps and data

**A layer says "Could not load".**
- The source may be offline or have moved. Open the link in a browser tab to check.
- The source may not allow other websites to read it (CORS). Download the file and upload it instead, or make a hosted layer that [follows the URL](hosted-layers.md#keep-a-layer-in-sync-with-a-url), which is fetched by your server.
- For ArcGIS layers, make sure the address ends in `/FeatureServer/0` or `/MapServer/0` (with the right layer number) and that the service is public.

**My layer is in the wrong place, or off the coast of Africa.**
The coordinates are in a system Waymark didn't recognize, or latitude and longitude are swapped. For CSV files, check the column names (see [Files](add-data.md#files)). For other files, re-save them as WGS 84 (EPSG:4326). Data near 0°, 0° almost always means projected coordinates were read as degrees.

**"That file uses a coordinate system Waymark can't convert."**
Re-save it as WGS 84 (EPSG:4326) in QGIS, ArcGIS Pro or mapshaper. See [Coordinate systems](formats.md#coordinate-systems).

**My map is slow.**
- Big files stored inside a story or map make it slow; upload them as [hosted layers](hosted-layers.md) instead (Waymark does this automatically for new files over 3 MB).
- Lots of points: use **Clusters** or **Heatmap** display, or summarize with [Hex bins](analysis-tools.md#hex-bins).
- Detailed outlines: run [Simplify](analysis-tools.md#simplify).
- Set a **Visible from zoom** so detailed layers only show when zoomed in.

**The attribute table, clusters or the time slider aren't available for a layer.**
The layer is drawn from vector tiles because it has more than 20,000 features. See [Big layers](hosted-layers.md#big-layers).

**I can't filter or style an imagery layer by field.**
Imagery layers are pictures, not features. Only opacity and date can be changed.

**3D buildings don't appear.**
Zoom in to street level (zoom 14 or closer) and tilt the map.

**Satellite comparison shows clouds or blank areas.**
Daily imagery shows the weather on that day. Try a nearby date, or the 8-day NDVI product.

## Analysis

**"That's too much for the browser."**
The input has more features than the tool can handle in a browser. Filter the layer, clip it to a smaller area, or simplify it first. See [Where analysis runs](analysis.md#where-analysis-runs).

**My layer isn't listed as an input.**
The tool needs a particular kind of feature (points, or areas) and the layer doesn't have any, or the layer is imagery or drawn from tiles.

**"The routing service is busy" or "could not be reached."**
Route and travel-time tools use a shared routing server. Wait a minute and run again. If it happens often, ask your administrator to set up a routing server for your organization. See [Routing](admin.md#routing).

**The join found no matches.**
For [Join attributes by field](analysis-tools.md#join-attributes-by-field), the key values must match exactly, including leading zeros and capitalization. Codes stored as numbers in one layer and as text in the other often differ.

## Stories and publishing

**Readers don't see my changes.**
Select **Publish** → **Publish changes**. Readers see the published copy until you do. Saved maps are the exception: map edits show immediately.

**My embedded web page stays blank.**
That site doesn't allow being shown inside other pages. Link to it instead.

**A video doesn't play.**
Use the normal YouTube or Vimeo page link. Private videos can't be embedded.

**The story says it changed somewhere else.**
It was saved in another tab, or by a co-editor. Load the latest version; your last few edits in this tab are discarded, so copy anything you need first.

**My photo is sideways or too big.**
Photos are rotated using their camera information and resized automatically when uploaded. If one is still wrong, open it in a photo editor, save it, and upload it again.

## Forms and dashboards

**People get "Too many submissions".**
Each internet address can submit up to 30 times in 10 minutes. A whole team on one office network shares one address; wait a few minutes.

**Form submissions don't appear on my map.**
Reload the map. Check that the map uses the same hosted layer the form belongs to, and that the layer has no filter hiding the new points.

**A dashboard chart says its layer is no longer on the map.**
The layer was removed from the saved map. Edit the chart and choose another layer, or add the layer back to the map.

## Getting more help

If something isn't covered here, contact the person who runs your Waymark server. For problems with Waymark itself, you can report them on the project's GitHub page.
