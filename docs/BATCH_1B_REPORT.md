# Batch 1B: Chicago transit integration

## Inputs and inspected schemas

The complete pipeline uses the four supplied files: `FY27_safmrs.xlsx`, `cb_2020_us_zcta520_500k.zip`, `Zip_zori_uc_sfrcondomfr_sm_month.csv`, and `google_transit.zip`. They currently reside at the repository root; the Batch 1A reader also accepts `data/raw/`. The CTA ZIP is read directly without extracting files into the repository. Batch 1A's 64-row `housing_areas.csv` and 64-feature `housing_areas.geojson` are regenerated and preserved.

The CTA archive contains `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`, `transfers.txt`, `agency.txt`, `calendar.txt`, `calendar_dates.txt`, `frequencies.txt`, `shapes.txt`, and `developers_license_agreement.htm`. There is no `feed_info.txt`.

| GTFS file | Inspected identifiers and fields | Observed records |
|---|---|---:|
| `stops.txt` | `stop_id`, `stop_code`, `stop_name`, `stop_desc`, `stop_lat`, `stop_lon`, `location_type`, `parent_station`, `wheelchair_boarding` | 11,138 |
| `routes.txt` | `agency_id`, `route_id`, `route_short_name`, `route_long_name`, `route_type`, `route_url`, `route_color`, `route_text_color` | 132 (8 rail, 124 bus) |
| `trips.txt` | `route_id`, `service_id`, `trip_id`, `direction_id`, `block_id`, `shape_id`, `direction`, `wheelchair_accessible`, `schd_trip_id` | 96,025 (4,829 on rail routes) |
| `stop_times.txt` | `trip_id`, `arrival_time`, `departure_time`, `stop_id`, `stop_sequence`, `stop_headsign`, `pickup_type`, `shape_dist_traveled` | Streamed from archive |
| `calendar.txt` | `service_id`, weekday flags, `start_date`, `end_date` | Service window 2026-09-11 to 2026-11-30 |

The housing source schemas and filtering rules are in [the Batch 1A report](BATCH_1A_REPORT.md).

## Rail station identification

GTFS `route_type=1` identifies eight CTA rail routes: Red, Purple, Yellow, Blue, Pink, Green, Orange, and Brown. Only trips assigned to these route IDs are retained. `stop_times.txt` is scanned in chunks to find the stop IDs served by those trips. Each served boarding stop must have a `parent_station` whose record exists in `stops.txt` with `location_type=1`. All served platforms/directions are grouped under that parent `stop_id`; bus stops and unserved parent records do not become rail stations. Route names are deduplicated per station. Parent coordinates and identifiers are validated. No platform locations are substituted for missing parent coordinates.

The feed yielded 298 distinct rail-served boarding stop IDs and 143 verified parent rail stations. There were zero served stop IDs missing from `stops.txt`, zero without a parent, zero with an invalid parent, zero invalid station coordinates, and zero duplicate station IDs. The station dataset includes GTFS parent station ID, name, latitude, longitude, served rail route names, and CTA attribution.

## Distances and default workplace

Distances use the spherical Haversine formula with Earth radius 6,371.0088 km. For each 2020 ZCTA representative point, the pipeline measures distance to all verified station parent points, chooses the shortest, and counts stations within 2 km. Equal distances are resolved by ascending station ID. Miles equal kilometers divided by 1.609344. All coordinates and map outputs are WGS84, with GeoJSON positions ordered longitude then latitude.

The demo workplace destination is the CTA Clark/Lake parent station in the Chicago Loop at **41.885737, -87.630886**, sourced from this GTFS feed. It is labeled `Chicago Loop demo destination (Clark/Lake station)` and represents a common central destination, not a user's actual workplace. The distance function accepts arbitrary validated coordinates, so a later user-selected workplace point can replace it. Neither station nor workplace distance estimates a walk, rail journey, driving route, or commute time. ZCTA representative points are area-level proxies and can differ substantially from an individual address.

`transit_feed_date` is null because this archive lacks `feed_info.txt` and provides no authoritative publication date. The calendar service window is recorded separately; it does not establish the feed publication date.

## Final schema and outputs

The public core CSV has 25 fields: `area_id`, `zip_code`, `latitude`, `longitude`, `hud_studio_rent`, `hud_1br_rent`, `hud_2br_rent`, `hud_3br_rent`, `hud_4br_rent`, `hud_area_id`, `hud_area_name`, `hud_data_year`, `geography_source_year`, `source_attribution`, `nearest_cta_station_id`, `nearest_cta_station_name`, `nearest_cta_station_km`, `nearest_cta_station_miles`, `cta_stations_within_2km`, `workplace_name`, `workplace_latitude`, `workplace_longitude`, `workplace_distance_km`, `transit_feed_date`, and `distance_definition`. ZIPs and station IDs are strings; rents, counts, coordinates, and distances remain numeric; unavailable fields are null.

| Output | Purpose | Size |
|---|---|---:|
| `data/public/housing_transit_core.csv` | Public HUD/Census/CTA analysis table, no Zillow fields | 31,040 bytes |
| `data/public/housing_areas.geojson` | Simplified ZCTA polygons | 46,441 bytes |
| `data/public/housing_points.geojson` | Representative points with public core properties | 66,628 bytes |
| `data/public/cta_rail_stations.csv` | Verified rail parent stations and routes | 12,633 bytes |
| `data/public/cta_rail_stations.geojson` | Rail station points | 35,622 bytes |
| `data/public/batch_1b_summary.json` | Machine-readable validation counts and samples | 5,322 bytes |
| `data/processed/housing_transit_enriched.csv` | Local public core plus three optional Zillow fields | 35,578 bytes |

The earlier Batch 1A files stay in `data/processed/`. That directory is Git-ignored. The local enriched dataset has 28 fields: the 25 public fields plus `zillow_region_id`, `zillow_observed_rent`, and `zillow_observation_date`. The public core CSV, public point properties, polygon properties, station files, and public summary contain no Zillow-derived values.

## Verified data quality

The full pipeline preserved all **64 housing areas** and all five HUD rent benchmarks. All 64 received a valid nearest-station calculation. There are 143 verified rail stations, no duplicate housing or station identifiers, and no invalid output geometries. The three GeoJSON files load as EPSG:4326 with 64 polygons, 64 housing points, and 143 station points.

| Straight-line metric | Minimum | Median | Maximum |
|---|---:|---:|---:|
| Nearest CTA station, km | 0.062 | 1.151 | 10.976 |
| Default Loop workplace, km | 0.372 | 11.566 | 25.742 |

The one area more than 10 km from rail is `ZCTA:60803`: its representative point is 10.976 km from the 95th/Dan Ryan station (`40450`). This reflects the absence of nearby CTA rail in that area; it is retained, with zero invented stations or travel times. Across areas, the number of stations within 2 km ranges from 0 to 26. Sample core record `ZCTA:60601` retains HUD studio/1BR/2BR/3BR/4BR values 2520/2670/3020/3880/4440 and joins to Washington/Wabash (`41700`) at 0.286 km; its Loop destination distance is 0.622 km.

## Terms, attribution, and publication

- [HUD SAFMR data](https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html) supplies the rental benchmarks. [Census ZCTA boundaries](https://www2.census.gov/geo/tiger/GENZ2020/shp/) supply polygons; [Census citation guidance](https://www.census.gov/about/policies/citation.html) asks derived-data users to credit Census as the original source.
- [CTA's GTFS feed page](https://www.transitchicago.com/developers/gtfs/) links the feed and license. The archive includes the [CTA Developer License Agreement](https://www.transitchicago.com/downloads/sch_data/developers_license_agreement.htm). It permits processing and distribution of CTA data for assisting transit riders or promoting public transportation. It requires reasonable efforts to keep cached data current, prohibits implied CTA endorsement, and prohibits selling the data as a separate product. The optional credit line is represented by `Chicago Transit Authority GTFS` attribution. NestWise's CTA accessibility features are intended to help riders compare locations. Any public deployment or repository distribution must continue to satisfy these conditions and check for newer feed and license versions.
- [Zillow Research's Housing Data page](https://www.zillow.com/research/data/) describes ZORI and supports users' own analyses, but no clear permission was found for redistributing ZIP-level derived values as a public dataset. Zillow fields therefore remain only in Git-ignored local outputs. The public core is structurally free of Zillow data; do not publish the local enriched CSV without resolving its terms.

## Rebuild, tests, and readiness

From the repository root with the existing virtual environment:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe scripts/build_final_data.py
.\.venv\Scripts\python.exe -m pytest -q
```

The final script reruns Batch 1A from the three housing source files, then processes `google_transit.zip` and writes both output tiers. The full pytest suite passed: **12 tests passed**. Tests use small synthetic records for station classification, parent deduplication, coordinate validation, Haversine reference distance, equal-distance tie resolution, area preservation, Zillow exclusion, WGS84 point serialization, and reproducibility. Production records derive only from the four supplied source files.

The dataset is ready as an input for Batch 2 optimization experiments, with straight-line proximity measures and stable identifiers. It does not yet provide service frequency, routing, accessibility at individual addresses, or journey time. CTA service and station information should be refreshed from a current feed for deployment. Batch 2 implementation has not begun.
