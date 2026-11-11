# Analysis tool reference

Every analysis tool, with its inputs, options and the fields it adds. For how to run a tool, see [Analysis overview](analysis.md).

Output fields are added to the copied features unless a tool says otherwise. Fields copied from a second layer get a prefix (such as `join_` or `overlay_`) so they don't overwrite the first layer's fields.

## Summarize

### Spatial density clusters
Finds natural groups of points that are close together, using the DBSCAN method. Points in sparse areas are labeled outliers.

| | |
| --- | --- |
| **Input** | A point layer. |
| **Options** | **Search radius** and units: how close points must be to count as neighbors. **Minimum points per cluster** (default 3). **Include unclustered outlier points**. |
| **Output** | The points, with `cluster_id` ("Cluster 1", "Cluster 2"… or "Outlier") and `cluster_size`, colored by cluster. |
| **Tip** | Start with a radius about the size of a neighborhood (1 to 2 km in a city). Too small and everything is an outlier; too big and everything is one cluster. |

### Hex bins
Groups points into a grid of equal hexagons and counts, sums or averages them. Good for showing density without the clutter of thousands of dots.

| | |
| --- | --- |
| **Input** | A point layer. |
| **Options** | **Hexagon size** in km (leave blank to choose automatically). **Value for each hexagon**: **Count**, **Sum** or **Average** of a field. **Keep empty hexagons**. |
| **Output** | Hexagons with `count`, plus `sum_<field>` or `mean_<field>` when summing or averaging, colored by value. |

### Count in areas
For each area, counts the points inside it, and optionally totals a field.

| | |
| --- | --- |
| **Input** | **Areas** (polygons) and **Points to count**. |
| **Options** | **Also total this field** (optional). |
| **Output** | The areas, with `count` and the total of the chosen field. |
| **Example** | Earthquakes per country; crimes per police district, with total property loss. |

### Dissolve
Merges areas into one shape, or one shape per value of a field.

| | |
| --- | --- |
| **Input** | An area layer. |
| **Options** | **One shape per value of** a field (optional), such as `state` to merge counties into states. |
| **Output** | Merged areas with the field's value, `parts` (how many areas were merged) and `area_km2`. |

### Hot-spot & outlier analysis
Finds where high or low values cluster more than chance would explain. Uses Getis-Ord Gi* (hot and cold spots, with confidence levels) and Local Moran's I (clusters and outliers).

| | |
| --- | --- |
| **Input** | Any layer (areas are analyzed at their centers). |
| **Options** | **Numeric value field** (leave as None to analyze how densely points are packed). **Spatial neighbors** (k-nearest, default 8). **Distance bandwidth** (0 = automatic). **Color layer by**: **Gi\* Hot / Cold Spot** or **Moran's I LISA Cluster**. |
| **Output** | `gi_zscore`, `gi_pvalue`, `gi_bin` (such as "Hot Spot (99% conf)", "Cold Spot (95% conf)", "Not Significant"), `moran_i`, `spatial_lag_z` and `lisa_cluster` ("High-High Hot Spot", "Low-Low Cold Spot", "High-Low Outlier", "Low-High Outlier", "Not Significant"). The note reports the global Moran's I. |
| **Tip** | Needs at least 30 or so features for meaningful results. A hot spot means high values surrounded by high values, not just a single high value. |

## Proximity

### Route along roads
The route through a layer's points, in their order, following roads or paths.

| | |
| --- | --- |
| **Input** | A point layer with 2 to 20 stops, in visiting order. |
| **Options** | **Travel**: **Car**, **Bike** or **Walking**. **Return to the first stop**. |
| **Output** | One line per leg, with `leg`, `from`, `to`, `km`, `miles`, `minutes` and `travel`. The note gives the total distance and time. |
| **Notes** | Uses a routing server and OpenStreetMap. Times assume typical conditions without live traffic. Stops are visited in the layer's order; reorder the features to change the route. |

### Travel-time areas
How far you can get from each point in a set number of minutes. Also called drive-time areas or isochrones.

| | |
| --- | --- |
| **Input** | A point layer with up to 10 points. |
| **Options** | **Minutes** (up to four, comma-separated, each up to 120), such as `5, 10, 15`. **Travel**: **Car**, **Bike** or **Walking**. |
| **Output** | One area per point and time, with `from`, `minutes`, `travel` and `label`, larger areas drawn underneath. |
| **Example** | Which neighborhoods are within a 10-minute walk of a library? Combine with [Count in areas](#count-in-areas) or [Clip](#clip). |

### Buffer
Draws a zone around every feature at a distance you choose.

| | |
| --- | --- |
| **Input** | Any layer (up to 5,000 features). |
| **Options** | **Distance** and units. **Merge overlapping zones into one**. |
| **Output** | Zones with `buffer` (such as "1 km"). Unmerged zones keep the original features' fields; a merged zone has `zones` (how many separate parts). |

### Multi-ring trade areas
Concentric distance bands around sites, for catchment analysis.

| | |
| --- | --- |
| **Input** | Sites (up to 1,000). |
| **Options** | **Ring distances** (comma-separated), such as `1, 3, 5`, and units. **Non-overlapping donut bands** hollows out inner rings so each band is separate. |
| **Output** | Rings with the site's fields plus `site_name`, `ring_distance`, `ring_band` and `area_km2`. |

### Hub & spoke desire lines
Connects every origin to its nearest hub with a straight line.

| | |
| --- | --- |
| **Input** | **Origins** (customers, incidents) and **Destination hubs** (stores, clinics, stations). |
| **Options** | Units. **Max connection distance** (0 = no limit). |
| **Output** | Lines with the origin's fields plus `origin_name`, `hub_name` and the distance. The note gives the average distance. |

### Distance to nearest
Measures how far each feature is from the closest feature in another layer.

| | |
| --- | --- |
| **Input** | **For each feature in** one layer, **Find the closest in** another. |
| **Options** | Units. |
| **Output** | The first layer's features with `nearest_km` (or `nearest_mi`, `nearest_m`) and `nearest` (the closest feature's name). |

### Within distance
Keeps only the features close to another layer.

| | |
| --- | --- |
| **Input** | **Keep features from** one layer **That are near** another. |
| **Options** | **Within** a distance, and units. |
| **Output** | The matching features, unchanged. |

### Voronoi areas
Splits the map into areas, each closest to one point. Also called Thiessen polygons.

| | |
| --- | --- |
| **Input** | A point layer (up to 20,000 points). |
| **Output** | One area per point, with the point's fields and `area_km2`. |
| **Example** | Approximate service areas for fire stations or polling places. |

### Gravity & Huff market share model
Models how demand divides between competing hubs, based on size and distance: the Huff probability that a customer picks each store, each area's primary hub, and accessibility (two-step floating catchment area, 2SFCA).

| | |
| --- | --- |
| **Input** | **Demand locations** (neighborhoods, tracts, customers) and **Supply hubs** (stores, hospitals, warehouses). |
| **Options** | **Hub attractiveness / capacity field** (such as floor area). **Demand population / spend weight**. **Distance decay exponent (β)** (default 2; higher means people travel less far). **Max catchment distance** (0 = unlimited) and units. **Output layer**: **Demand areas / points**, or **Origin–Destination flow lines**. |
| **Output (demand)** | `primary_hub`, `primary_prob_pct`, `market_dominance_pct`, `expected_flow`, `nearest_hub_km`, `accessibility_index` and `total_gravity_potential`. |
| **Output (flows)** | Lines with `origin_name`, `hub_name`, `probability_pct`, `flow_volume`, `distance_km` and `is_primary`, ready for Sankey and network charts. |

## Overlay

### Clip
Keeps only the parts of a layer that fall inside areas, like a cookie cutter. Lines and areas are cut at the edges.

| | |
| --- | --- |
| **Input** | **Clip this layer**, **To these areas**. |
| **Output** | The clipped features, with their own fields. |

### Erase
Cuts areas out of a layer and keeps what's left outside them. The opposite of Clip.

| | |
| --- | --- |
| **Input** | **Erase from this layer**, **Using these areas**. |
| **Output** | What's outside the areas. |

### Intersect
Keeps only where two layers overlap, with the attributes of both.

| | |
| --- | --- |
| **Input** | **Features**, **Overlap with areas**. |
| **Output** | The overlapping pieces, with their own fields plus the area's fields prefixed `overlay_`. |

### Join by location
Gives each feature the attributes of the area it falls in (a spatial join).

| | |
| --- | --- |
| **Input** | **Features to add attributes to**, **Take attributes from areas**. |
| **Options** | **Keep features that fall in no area**. |
| **Output** | The features with the area's fields prefixed `join_`. |
| **Example** | Tag each pothole report with its ward, then chart reports by ward. |

### Select by location
Keeps the features that touch, sit inside, contain, or stay clear of another layer.

| | |
| --- | --- |
| **Input** | **Keep features from** one layer, **Compared with** another. |
| **Options** | **That**: **Touch**, **Are inside**, **Contain** or **Stay clear**. |
| **Output** | The matching features, unchanged. |

### Merge
Combines two layers into one.

| | |
| --- | --- |
| **Input** | **First layer**, **Second layer**. |
| **Output** | All features from both, with `source_layer` naming where each came from. |

## Terrain

These tools use free global elevation data, so they work anywhere with no setup. Detail is about 30 m in most places.

### Elevation profile & slope
Lines become a profile of sample points with elevation, distance and grade. Points and areas get their elevation.

| | |
| --- | --- |
| **Input** | Routes, trails, sites or areas (up to 2,000 features). |
| **Options** | **Profile samples per line** (default 120). **DEM detail**: **~120 m**, **~30 m** or **~8 m**. |
| **Output (lines)** | Sample points with `line`, `sample`, `distance_km`, `elevation_m` and `grade_pct`. The note gives each line's length, total climb and descent, elevation range and steepest grade. |
| **Output (points, areas)** | The features with `elevation_m` and `elevation_ft`. |

### Cost surface & accessibility grid
Builds a grid of travel time from origins, accounting for terrain slope (Tobler's hiking function) and optional barriers or corridors.

| | |
| --- | --- |
| **Input** | **Origin sites or hubs**, and optional **Barriers or corridors**. |
| **Options** | **Grid resolution** (20×20, 28×28 or 40×40). **Study area buffer** in km. **Default barrier behavior**: **5× High friction**, **Impassable block** or **Corridor speed boost**. **Include DEM elevation slope friction**. |
| **Output** | Grid cells with `travel_time_min`, `cost_index`, `distance_km`, `unit_friction`, `barrier_multiplier`, `elevation_m`, `slope_pct`, `nearest_origin` and `passable`. |

### Least-cost path & corridor
Finds the easiest route from origins to destinations across terrain and barriers.

| | |
| --- | --- |
| **Input** | **Start origins**, **Target destinations**, and optional **Barriers or corridors**. |
| **Options** | **Routing grid detail**. **Default barrier behavior**. **Route around steep DEM terrain slopes**. **Smooth path geometry**. |
| **Output** | Paths with `origin`, `destination`, `travel_time_min`, `distance_km`, `straight_km`, `detour_ratio`, `elev_gain_m`, `elev_loss_m` and `max_slope_pct`. |
| **Note** | This follows terrain, not roads. For road routes, use [Route along roads](#route-along-roads). |

### 3D viewshed & line of sight
What can be seen from observer points, accounting for terrain and the earth's curvature.

| | |
| --- | --- |
| **Input** | **Observer viewpoints or towers**. |
| **Options** | **Viewing radius** and units. **Observer height above ground** (default 2 m). **Target height above ground**. **Angular detail** (24, 36 or 60 rays). **Output geometry**: **Viewshed sectors** or **Sightline rays**. |
| **Output** | Sectors or rays with `observer`, `bearing_deg`, `distance_km`, `visible`, `visibility_code`, `clearance_m` and `elevation_m`. The note gives the percentage visible. |
| **Note** | Buildings and trees aren't in the elevation data, so real visibility in towns and forests is lower. |

## Manage data

### Join attributes by field
Adds columns from another layer by matching a shared ID, code or name. Also called a table join.

| | |
| --- | --- |
| **Input** | **Target layer (keeps its shapes)** and **Join table layer (attributes to copy)**. |
| **Options** | **Key field in target layer**, **Matching key field in join layer**. **Keep target features with no match**. |
| **Output** | The target features with the join layer's fields prefixed `join_`. |
| **Tip** | Keys must match exactly. Codes like FIPS lose leading zeros if stored as numbers; keep them as text. |

### Center points
Turns areas and lines into a point at their center, keeping their fields.

### Outline
Draws one boundary around all the features (a convex hull), with `area_km2`.

### Filter
Keeps the features whose values match a rule: **Field**, a **Rule** (`=`, `≠`, `>`, `≥`, `<`, `≤`, contains, is empty, is not empty) and a **Value**. Unlike layer filters, this makes a separate layer you can keep.

### Simplify
Removes detail from lines and areas to make them lighter and faster. **How much**: **A little**, **Some** or **A lot**. The note reports how many points were removed.

### Add geometry attributes
Adds each feature's measurements as fields: `area_km2`, `area_mi2` and `perimeter_km` for areas, `length_km` and `length_mi` for lines, and `longitude` and `latitude` for points.
