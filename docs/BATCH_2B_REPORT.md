# Batch 2B: sensitivity, comparisons, and FastAPI

## Implementation and files

Batch 2B adds deterministic constraint sensitivity, counterfactual and area comparisons, and a local API over the 64-row public Chicago dataset. Batch 1 processing and Batch 2A Pareto scoring remain intact. Before changes, the full suite passed with **51 tests**.

New files: `backend/app/optimization/sensitivity.py`, `backend/app/optimization/comparisons.py`, `backend/app/api/__init__.py`, `backend/app/api/schemas.py`, `backend/app/api/routes.py`, `backend/app/services/__init__.py`, `backend/app/services/maps.py`, `backend/app/main.py`, `tests/__init__.py`, `tests/test_sensitivity.py`, `tests/test_comparisons.py`, `tests/test_api.py`, `scripts/benchmark_api.py`, and this report. Updated files: `backend/requirements.txt`, `backend/app/optimization/models.py`, `backend/app/optimization/data_loader.py`, and `README.md`. The two existing model/loader edits retain workplace coordinates and nearest-station miles from the already processed public CSV, so area responses and Google Maps links use the source data. No raw or processed production data files were changed.

`create_app()` in `backend.app.main` uses FastAPI lifespan startup to load and validate the public CSV once into an immutable tuple. It also loads and validates the three small public GeoJSON files. Requests reuse this snapshot. Tests can create an app with controlled fixture areas and a custom data or GeoJSON path. Missing or invalid required public files fail startup clearly. Route handlers call the separate analysis functions; they do not implement optimization mathematics.

## API endpoints

| Method and path | Behavior |
|---|---|
| `GET /api/health` | Healthy status, loaded-area count, and source years; startup must have succeeded |
| `GET /api/areas` | Public area attributes, optional `bedrooms` and `max_rent`, `offset` pagination and `limit` 1-100 (default 50) |
| `GET /api/areas/{area_id}` | Public details for IDs such as `ZCTA:60601`, with an outbound Google Maps link; malformed ID 422, unknown ID 404 |
| `POST /api/optimize` | Calls the unchanged Batch 2A `optimize_housing` rules on preloaded areas |
| `POST /api/sensitivity` | Budget and optional workplace/station-limit variations, plus exact next-budget unlock |
| `POST /api/scenarios/compare` | Baseline versus modified eligibility, Pareto membership, and recommendation order |
| `POST /api/areas/compare` | Side-by-side attributes and numeric differences for 2-4 existing unique area IDs |
| `GET /api/geo/housing` | Simplified WGS84 ZCTA polygons as `application/geo+json` |
| `GET /api/geo/stations` | WGS84 CTA rail station points as `application/geo+json` |
| `GET /api/geo/housing-points` | WGS84 area representative points as `application/geo+json` |

The API reads `data/public/housing_transit_core.csv` and the three GeoJSON files under `data/public/`. It does not read original national files, the CTA ZIP, or the Git-ignored Zillow-enriched CSV on request. Public responses contain no Zillow fields or values.

## Request and response examples

Optimization request:

```json
{"monthly_budget":1900,"bedrooms":1,"annual_income":75000,"max_results":5}
```

The response preserves Batch 2A's four keys: `request_context`, `summary`, `recommendations`, and `diagnostics`. On the real public CSV, this request has **38 eligible** areas and **10 Pareto-efficient** areas; the first recommendation is `ZCTA:60653`. Its HUD one-bedroom benchmark is $1,340. The numeric fields are source-grounded HUD benchmarks and straight-line ZCTA-point distances, not listings or travel-time estimates.

Sensitivity request:

```json
{"preferences":{"monthly_budget":1600,"bedrooms":1},"alternative_budgets":[1500,1700]}
```

The real response has baseline eligibility **24**. At $1,500 it has **16** eligible areas; at $1,700 it has **30**. `next_budget_unlock` is `{"monthly_budget":1620,"increase_required":20,"newly_unlocked_area_ids":["ZCTA:60638"]}`. The response also reports excluded counts, Pareto counts, new and lost eligible IDs, frontier entries/exits, and count changes for each variation.

Counterfactual request:

```json
{"baseline_preferences":{"monthly_budget":1600,"bedrooms":1},"modified_preferences":{"monthly_budget":1900,"bedrooms":1}}
```

The real eligible count increases by **14**. Changing only display weights leaves both eligibility and Pareto membership unchanged; the displayed recommendation order may change. The comparison reports both profiles, counts, newly eligible/excluded IDs, frontier entries/exits, and deterministic explanatory text. Zero-eligible cases return valid empty comparisons.

Area comparison request:

```json
{"area_ids":["ZCTA:60601","ZCTA:60608"],"bedrooms":1}
```

The real HUD one-bedroom benchmarks are $2,670 and $1,530, respectively; the left-minus-right difference is $1,140. Each area includes all five HUD benchmarks, representative coordinates, Loop and CTA proximity, source metadata, measurement limitations, and an outbound directions link. Unknown IDs return 404; no fallback area is substituted.

## Sensitivity method and exact next unlock

Each variation calls the Batch 2A optimizer on the same in-memory 64-area snapshot, preserving all other preferences and hard limits. Explicit budget alternatives may contain up to eight unique finite values in `(0, 10,000,000]`. Workplace and station limits may each contain up to eight unique values in `[0, 1000]` km, with at most 16 total variations. If no budget list is supplied, the documented default probes budget offsets of -$200, -$100, +$100, and +$200, omitting nonpositive or out-of-range budgets. The baseline, each variation's counts, newly eligible/lost IDs, frontier changes, and count deltas are returned.

For a hard budget, the next-unlock calculation temporarily removes only the budget gate, keeps every other active hard constraint, and finds the lowest actual requested-bedroom HUD rent strictly above the current budget among otherwise eligible areas. The difference is the minimum positive required increase. At a $1,600 one-bedroom budget without distance maxima, that is $20 to unlock `ZCTA:60638` at $1,620. Adding an 8 km maximum Loop distance changes the baseline to **3 eligible**, and the next unlock becomes **$1,890** (a $290 increase) for `ZCTA:60612`; a $1,700 budget still has 3 eligible. With a soft budget, `next_budget_unlock` is null and budget changes do not alter rent-based eligibility. If no otherwise eligible higher-rent area exists, the unlock is also null with an explicit reason.

## Maps URLs and measurements

Area detail and area comparison responses include a Google Maps directions URL. It uses the area's real WGS84 representative coordinates as origin and the Clark/Lake Loop coordinates retained from the public CSV as destination. The default mode is `transit`; area detail also accepts `travel_mode=walking` or `driving`. The utility encodes `api=1`, origin, destination, and mode using the standard [Google Maps URLs format](https://developers.google.com/maps/documentation/urls/get-started). It makes no Google API request and needs no key. A link invites the user to inspect directions in Maps; NestWise has not verified route availability, walking distance, or commute minutes.

## Validation and security

Pydantic request models reject unknown body fields, numeric strings, booleans used as numbers, nonfinite numbers, negative or zero budgets, malformed area IDs, invalid bedrooms, and out-of-range result counts. Request bodies and personal income values are not logged by the app. Validation errors return 422 with only field location, message, and type; raw input values are omitted, including nonfinite numbers and income. Missing areas return 404. Startup fails if essential public CSV or map files are absent or invalid. GeoJSON startup checks feature structure, unique identifiers, valid/nonempty geometry, WGS84 coordinate ranges, and absence of Zillow fields. Normal responses do not expose local filesystem paths or stack traces.

CORS allows only `http://localhost:5173` by default. `NESTWISE_CORS_ORIGINS` can specify comma-separated explicit HTTP(S) origins; `*` is rejected. The app adds no authentication, payments, secret, geocoding, routing API, or AI integration. It does not modify or serve the local Zillow-enriched output.

## Tests, live server, and performance

The full pytest suite passed: **77 passed, 1 external deprecation warning** (51 baseline tests plus 26 Batch 2B tests). Tests cover startup with real and fixture data, missing/corrupt files, health, input validation including NaN/infinity, colon-bearing IDs, pagination and rent filtering, sensitivity increases/decreases and constrained thresholds, soft budgets, hard-constraint and weight-only counterfactuals, empty cases, 2-4 area comparison rules, all GeoJSON routes, CORS, Maps URL encoding, Zillow exclusion, strict JSON, and deterministic repeated responses. A failing NaN-validation test exposed a framework error-response serialization issue; the app now returns a safe 422 without echoing raw values. The remaining warning says Starlette's current `httpx` TestClient path is deprecated; all tests pass.

A real Uvicorn process was started locally on `127.0.0.1:8000`. Live HTTP requests returned **200** for `/api/health` (64 areas), `/docs`, `/api/optimize` (38 eligible with the $1,900 example), `/api/sensitivity` ($1,620 next unlock from $1,600), `/api/areas/compare` (two real areas), `/api/geo/housing` (64 features), and `/api/geo/stations` (143 features). The server was then stopped.

Performance was measured locally with `python -m scripts.benchmark_api`: FastAPI TestClient, the real public CSV loaded once during startup, five warmups, then 30 measured POST requests per endpoint using `time.perf_counter_ns()`. These are local request times, not network or browser latency:

| Request | Median | 95th percentile | Measured range |
|---|---:|---:|---:|
| Optimize ($1,900, 1BR) | 3.83 ms | 4.32 ms | 3.44-5.43 ms |
| Sensitivity (four variations) | 5.72 ms | 7.04 ms | 5.36-7.56 ms |
| Compare two areas | 1.80 ms | 3.65 ms | 1.63-16.60 ms |

## Run locally and prepare for Batch 3

From the repository root:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

Visit `http://127.0.0.1:8000/docs` or `http://127.0.0.1:8000/api/health`. To allow another local React origin, set `NESTWISE_CORS_ORIGINS` to its explicit HTTP(S) origin before starting the server.

Batch 3 can consume the listed JSON and GeoJSON endpoints directly, including stable `area_id` values and explicit source/measurement text. It should treat scores as relative display ordering, show distances as straight-line ZCTA proxies, and open directions links as external navigation. The current backend has no user workplace geocoding, actual journey times, listing availability, frontend, or Gemini integration. CTA feed data will require routine refreshing for deployment. No cloud deployment, commit, or push was performed.
