# Data formats and limits

This page collects the file formats, services, coordinate systems and size limits Waymark supports. Your administrator can change some limits; the values here are the defaults.

## File formats

| Format | Extensions | Read as | Notes |
| --- | --- | --- | --- |
| GeoJSON | `.geojson`, `.json` | Features | Also accepts one feature per line (newline-delimited GeoJSON) when uploaded as a hosted layer. |
| Shapefile | `.zip` | Features | Zip the `.shp`, `.dbf`, `.prj` (and `.cpg` for the text encoding) together. Points, multipoints, lines and polygons, including Z and M variants (heights and measures are dropped). |
| GeoPackage | `.gpkg` | Features | Every feature table becomes a hosted layer (up to 12 per file). |
| KML | `.kml` | Features | Placemarks, lines, polygons, folders and extended data. Zipped KMZ isn't read directly; unzip it first. |
| GPX | `.gpx` | Features | Waypoints, tracks and routes, with distance and elevation statistics. |
| CSV | `.csv` | Points | Needs latitude and longitude columns. See [Files](add-data.md#files). |
| JPEG photos | `.jpg`, `.jpeg` | Points | Photos with GPS location in their EXIF data. |
| Story file | `.waymark.json` | A story | Made with **Download story file**. |

Images for stories can be JPEG, PNG, WebP or GIF. They're resized to at most 2,400 pixels on the long side and re-saved, which also removes location and camera data.

## Web data and services

| Source | Read as | Limit |
| --- | --- | --- |
| GeoJSON link | Features | OGC API Features paging is followed up to 20,000 features. |
| ArcGIS feature layer (`…/FeatureServer/n`, `…/MapServer/n`) | Features | Up to 20,000 features. |
| WMS 1.1.1 and 1.3.0 | Imagery | Drawn in Web Mercator (EPSG:3857). |
| WMTS 1.0.0 | Imagery | Web Mercator tile sets only. |
| WFS 1.1.0 and 2.0.0 | Features | Up to 20,000 features, requested as GeoJSON in WGS 84. The server must support GeoJSON output. |
| `{z}/{x}/{y}` tiles | Imagery, or vector tiles for `.pbf`/`.mvt` | |
| PMTiles | Vector tiles or imagery | Read in place with range requests. |

Links and services are read by the reader's browser, so the source must allow other websites to read it (CORS). Service descriptions are an exception: if a browser can't read one, Waymark fetches it through your server.

## Coordinate systems

Waymark shows everything in Web Mercator and stores data in WGS 84 longitude and latitude (EPSG:4326). Files in these systems are converted automatically:

| System | GeoPackage (by EPSG code) | Shapefile (by `.prj`) |
| --- | --- | --- |
| WGS 84, NAD83, ETRS89, GDA94 (longitude/latitude) | ✓ | ✓ |
| Web Mercator (EPSG:3857 and equivalents) | ✓ | ✓ |
| UTM zones on WGS 84 (EPSG:326xx, 327xx) | ✓ | ✓ |
| UTM zones on NAD83 (EPSG:269xx) and ETRS89 (EPSG:258xx) | ✓ | ✓ |
| Other Transverse Mercator systems (including Transverse Mercator State Plane zones) | | ✓ |
| Lambert, Albers and other projections | | |

Files in unsupported systems are refused with a message naming the problem. Re-save them as WGS 84 (EPSG:4326) in QGIS, ArcGIS Pro or mapshaper first. Other datums are treated as WGS 84, which can shift data by up to a few hundred metres for old datums such as NAD27.

## Size limits

| What | Limit |
| --- | --- |
| Hosted layer upload or edit | 256 MB |
| Layers stored inside a story or map | Files over 3 MB or 20,000 features are stored as hosted layers instead. |
| Hosted layers drawn from vector tiles | More than 20,000 features. |
| A story or saved map document | 8 MB |
| An uploaded story image | 12 MB before resizing |
| A form photo | 8 MB |
| Form text answers | 4,000 characters |
| Hosted layer history | The newest 25 versions |
| Scheduled refresh | Every 5 minutes at most often |
| Analysis | Depends on the tool. See [Where analysis runs](analysis.md#where-analysis-runs). |

## Basemaps

| Basemap | Source |
| --- | --- |
| Streets, Bright, Light gray, Dark | OpenFreeMap, from OpenStreetMap data |
| Satellite | Sentinel-2 cloudless by EOX (Copernicus data) |
| USGS imagery, USGS topo | The National Map, U.S. Geological Survey |
| 3D terrain | Mapzen Terrarium elevation tiles, AWS Open Data |

## Units

Distances can be entered in kilometres, miles or metres, and results show both metric and imperial units. Areas are stored in square kilometres (`area_km2`) and shown in square kilometres, square miles, square metres or acres as appropriate. Elevations are in metres, with feet added where useful.

## Browsers

Waymark works in current versions of Chrome, Edge, Firefox and Safari on desktop, and Safari and Chrome on phones and tablets. Maps need WebGL, which all of these support.
