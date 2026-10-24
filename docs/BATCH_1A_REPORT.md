# Batch 1A: Chicago housing data engineering

## Inputs and sources

The local source files are `FY27_safmrs.xlsx`, `cb_2020_us_zcta520_500k.zip`, and `Zip_zori_uc_sfrcondomfr_sm_month.csv`. They currently sit at the repository root; the pipeline also searches `data/raw/`. The CTA file `google_transit.zip` is intentionally not read in Batch 1A.

- HUD FY2027 Small Area Fair Market Rents: [HUD SAFMR data set](https://www.huduser.gov/portal/datasets/fmr/smallarea/index.html). The input workbook has one worksheet, `SAFMRs`, 51,871 data rows, and 18 columns. Its ZIP field is `ZIP\nCode`; it provides the HUD area code/name and 0BR through 4BR rent columns. HUD defines SAFMRs as ZIP-level fair market rents for Housing Choice Voucher payment standards.
- U.S. Census Bureau 2020 cartographic ZCTA boundaries at 1:500,000: [download directory](https://www2.census.gov/geo/tiger/GENZ2020/shp/) and [ZCTA explanation](https://www.census.gov/programs-surveys/geography/guidance/geo-areas/zctas.html). The input archive has 33,791 features, source CRS EPSG:4269, and geographic key `ZCTA5CE20`.
- Zillow Research ZORI: [Housing Data download page](https://www.zillow.com/research/data/). The input has 8,340 rows and 150 columns: nine region metadata fields and monthly values from 2015-01-31 through 2026-09-30. ZIP is `RegionName`, region ID is `RegionID`, and Chicago metadata fields include `City`, `Metro`, `StateName`, and `CountyName`.

HUD and Census are U.S. government sources. Zillow describes downloadable research data as available for users' own analyses, but the reviewed source page does not clearly grant public redistribution rights for derived ZIP-level values. The pipeline therefore retains transformation logic and attribution, writes Zillow-enriched outputs only under the locally ignored `data/processed/` directory, and does not assume those values may be committed or published. Regenerate locally from the supplied Zillow CSV. Before public distribution, review the applicable Zillow terms or obtain permission.

## Geographic scope and transformations

The HUD workbook was inspected before filtering. The metropolitan area is selected using the source's HUD area name containing both "Chicago" and "IL"; the HUD area code must therefore identify the Chicago metro. Within that area, this initial release includes ZIP groups 606xx, 607xx, and 608xx. This two-part rule reproduces the 84-record Chicago core slice and does not select records by ZIP prefix alone. The full HUD Chicago metropolitan area has 370 rows; the 84-row slice is used for the requested initial city-focused release.

ZIP identifiers are normalized to five-character strings, retaining leading zeroes. HUD 0BR-4BR rents are parsed as numeric values and remain separate from ZORI. Duplicate selected HUD ZIPs, duplicate Zillow ZIPs, negative rents, invalid coordinates, and invalid or empty matched ZCTA geometries cause the build to fail. Missing source observations remain null.

The Census archive is read directly. HUD records are inner-joined to Census polygons by normalized ZIP/ZCTA identifier; unmatched HUD ZIPs are recorded and excluded from geographic output. Census polygons use EPSG:4269. Representative points and geometry simplification are calculated in UTM zone 16N (EPSG:26916), then coordinates and simplified map shapes are converted to WGS84 (EPSG:4326). Geometry is simplified with topology preserved and 100-meter tolerance. ZCTAs are Census statistical approximations, not USPS ZIP delivery boundaries; the Census notes that some valid ZIP codes have no ZCTA.

ZORI rows are filtered to `RegionType=zip` and must have unique normalized ZIPs. The latest available monthly column is selected from the input itself (2026-09-30 for this snapshot). The indicator is a smoothed, housing-stock-weighted measure of typical observed market rent, not the exact asking rent for an available apartment. It is left-joined and never fills or averages HUD rent fields.

## Output schema

`housing_areas.csv` has one row per matched ZCTA and these fields: `area_id`, `zip_code`, `latitude`, `longitude`, `hud_studio_rent`, `hud_1br_rent`, `hud_2br_rent`, `hud_3br_rent`, `hud_4br_rent`, `hud_area_id`, `hud_area_name`, `zillow_region_id`, `zillow_observed_rent`, `zillow_observation_date`, `hud_data_year`, `geography_source_year`, and `source_attribution`. Rent fields and coordinates are numeric; identifiers are strings; absent Zillow values serialize as empty CSV cells (nulls when read as data). `area_id` is `ZCTA:<five-digit-code>`.

`housing_areas.geojson` contains the corresponding simplified WGS84 ZCTA geometry, with `area_id` and `zip_code` properties. The CSV contains the rent and point data. `batch_1a_summary.json` records counts, missing values, rent distributions, sample records, and output sizes. All three outputs are generated under `data/processed/`, which is Git-ignored due to the unresolved Zillow redistribution terms.

## Verified results

Executed against the supplied files on 2026-10-24:

| Measure | Result |
|---|---:|
| National HUD workbook rows | 51,871 |
| Chicago HUD metropolitan area rows, all ZIPs | 370 |
| Selected Chicago core HUD rows (606xx/607xx/608xx) | 84 |
| Matched Census ZCTAs | 64 |
| Unmatched selected HUD ZIPs | 20 |
| Matched records complete for all five HUD rent fields | 64 |
| Zillow ZIP overlap / recent non-null values | 62 / 62 |
| Output rows | 64 |
| Duplicate `area_id` / ZIP values | 0 / 0 |
| CSV / GeoJSON size | 17,852 / 46,441 bytes |

Unmatched selected HUD ZIPs: `60666`, `60669`, `60670`, `60673`, `60674`, `60675`, `60678`, `60682`, `60685`, `60686`, `60687`, `60688`, `60689`, `60690`, `60693`, `60694`, `60695`, `60697`, `60699`, `60701`.

Missing output values are zero for every field except `zillow_region_id` and `zillow_observed_rent`, which each have two missing records. No duplicate identifiers were found. HUD FY2027 rent distributions, in dollars per month:

| Bedroom category | Minimum | Median | Maximum |
|---|---:|---:|---:|
| Studio (0BR) | 1,250 | 1,640 | 2,520 |
| 1BR | 1,330 | 1,735 | 2,670 |
| 2BR | 1,500 | 1,965 | 3,020 |
| 3BR | 1,930 | 2,525 | 3,880 |
| 4BR | 2,200 | 2,885 | 4,440 |

The feasibility counts of 84, 64, and 62 are reproduced. The selected HUD records use the single area identifier `METRO16980M16980`, named `Chicago-Joliet-Naperville, IL HUD Metro FMR Area`. The first CSV rows were inspected: for example, ZIP `60601` has HUD rents 2520/2670/3020/3880/4440, representative point 41.884813/-87.623481, and a Zillow value of 3042.2766 dated 2026-09-30. GeoJSON contains 64 valid non-empty geometries keyed to the same ZCTA identifiers.

## Limitations

HUD SAFMR values are program payment-standard benchmarks, not guaranteed available rents. Zillow ZORI is an area-level index and the latest month may differ in timing or method from HUD. Census ZCTAs are generalized representations of ZIP-code geography, are based on 2020 Census tabulation blocks, and are not identical to current postal ZIP boundaries. The source geometry is a generalized 1:500,000 cartographic product and is suitable for display rather than precise distance or legal boundary work.

## Regeneration and tests

From the repository root, install the declared packages and run:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe scripts/build_housing_data.py
.\.venv\Scripts\python.exe -m pytest -q
```

The pipeline also accepts `--input-dir` and `--output-dir`. Unit tests use synthetic values for identifier, numeric/null, duplicate, join, and coordinate behavior; production outputs are generated only from the supplied source files. Two consecutive production builds produced byte-identical CSV and GeoJSON files. CTA/GTFS remains for Batch 1B. The local tabular and map outputs are ready to be used in later transit integration after the Zillow redistribution decision is resolved for any public deployment.
