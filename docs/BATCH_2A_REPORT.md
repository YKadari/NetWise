# Batch 2A: deterministic housing optimization engine

## Scope and implementation

Batch 2A adds a local Python optimizer over `data/public/housing_transit_core.csv`. The committed Batch 1 pipeline, raw sources, and locally enriched Zillow data were not changed. The baseline Batch 1 test suite passed before implementation: **12 passed**. The public core was inspected directly: 64 rows, 25 fields, five numeric HUD rent columns, numeric Loop and nearest-CTA distances, five-character ZIP identifiers, and no Zillow fields. All 64 `transit_feed_date` values are null, as described in [Batch 1B](BATCH_1B_REPORT.md).

Files added: `backend/__init__.py`, `backend/app/__init__.py`, `backend/app/optimization/__init__.py`, `models.py`, `data_loader.py`, `pareto.py`, `engine.py`, `scripts/demo_optimizer.py`, `tests/test_optimization.py`, `tests/test_pareto.py`, and this report. `README.md` was updated. Existing dependencies suffice; `backend/requirements.txt` was unchanged.

`models.py` validates preferences and stores immutable area records. `data_loader.py` reads the small public CSV once per optimization call and checks types, identifiers, coordinates, missing values, and nonnegative rents/distances. It rejects a file with Zillow columns. `engine.py` applies hard constraints, calculates affordability, ranks eligible areas, and returns plain dictionaries. `pareto.py` implements strict three-objective dominance. No source workbook, national geometry file, transit archive, database, AI service, or external API is read during optimization.

## Preference schema and affordability

`Preferences` accepts:

| Field | Rule and default |
|---|---|
| `monthly_budget` | Required positive finite USD/month |
| `bedrooms` | Required integer 0, 1, 2, 3, or 4 |
| `annual_income` | Optional positive finite USD/year |
| `budget_is_hard_constraint` | Boolean; default `true` |
| `max_workplace_distance_km` | Optional nonnegative finite limit |
| `max_station_distance_km` | Optional nonnegative finite limit |
| `rent_weight`, `workplace_weight`, `station_weight` | Nonnegative finite weights; each defaults to 1, making the default normalized weights one-third each |
| `max_results` | Integer 1 through 100; default 10 |

All three weights cannot be zero. Income is optional context and never replaces the budget. For the chosen bedroom count, `hud_monthly_rent` is its HUD benchmark, `budget_difference = monthly_budget - hud_monthly_rent`, and `within_budget` is the inclusive comparison. If income is supplied, `rent_burden_pct = hud_monthly_rent / (annual_income / 12) * 100`. This is a gross-income ratio based on a HUD benchmark, not an estimate of available listings or total household affordability.

## Eligibility and missing data

A candidate is excluded when the requested bedroom benchmark is unavailable. With a hard budget, a rent above the budget is excluded; a soft budget permits it and records a negative budget difference. Optional distance maxima are inclusive. If a specified maximum has no corresponding distance, the candidate is excluded. Each excluded area has all applicable reasons: `rent_unavailable`, `over_budget`, `workplace_too_far`, `station_too_far`, `workplace_distance_unavailable`, and/or `station_distance_unavailable`. Reason counts can sum above the number of excluded areas because one area may fail several rules.

If no maxima are specified, an area with a missing distance can remain eligible, but it is explicitly unranked and omitted from recommendations because the three-objective comparison would be incomplete. Its ID appears in `eligible_unranked_missing_objectives_area_ids`; nothing is imputed. A zero-eligible result returns empty recommendations, an empty Pareto frontier, and valid JSON.

The workplace distance is the precomputed straight-line distance to the Clark/Lake Chicago Loop demo destination. Batch 2A does not accept arbitrary user workplace coordinates. The station distance is straight-line from a ZCTA representative point, not walking distance or transit time.

## Pareto and display ranking

Pareto analysis runs **after** eligibility filtering, using only eligible areas with all three measurements. The minimized objectives are: bedroom-specific HUD rent in USD/month, Loop destination distance in km, and nearest CTA rail station distance in km. Area A dominates B exactly when every A objective is no greater than B's and at least one is strictly less. Identical objective vectors do not dominate each other. The frontier and one deterministic dominating-area example for each dominated record are returned by area ID.

Preference weights affect display order only. Divide each weight by their sum. For each objective over the eligible **complete** candidate set, compute `(value - minimum) / (maximum - minimum)`. A zero-range objective contributes 0. The `normalized_preference_score` is the weighted sum of these normalized values, with lower preferred. This score depends on the current eligible candidate set and does not predict neighborhood quality or happiness; actual USD and km values remain in every recommendation.

Recommendations prioritize Pareto-efficient candidates, then sort by score, actual `(rent, workplace km, station km)` tuple, and `area_id`. If the requested list is longer than the frontier, complete dominated candidates fill the remaining slots. Eligible candidates lacking distances remain unranked. All ordering is deterministic, including ties.

## Result shape and integration entry point

Call `optimize_housing(preferences, areas=None)` with a validated `Preferences` instance or a mapping. `areas=None` loads the public CSV. Tests can pass a controlled iterable of area mappings or immutable `HousingArea` records. The result has four top-level keys:

- `request_context`: validated preferences, dataset years and source attribution, workplace and distance definition, and objective definitions.
- `summary`: evaluated, eligible, excluded, Pareto-evaluable, Pareto-efficient, and eligible-unranked counts plus exclusion-reason counts.
- `recommendations`: up to `max_results` entries with IDs, ZIP, coordinates, bedroom count, HUD benchmark, budget difference, budget flag, optional income burden, workplace and nearest station measurements, 2-km station count, Pareto flag, relative score, deterministic explanation, and measurement limitations.
- `diagnostics`: all eligible candidate summaries, excluded IDs with reasons, frontier IDs, dominating examples, unranked eligible IDs, and ranking formula metadata.

Results pass strict `json.dumps(..., allow_nan=False)` serialization. The API layer in Batch 2B can validate an incoming mapping, call the entry point, and return this structure without moving the calculation into route handlers. It should surface input `ValueError`s as request validation errors and maintain the public-core-only data source. No FastAPI endpoint has been added in this batch.

## Real-data demonstration

Executed `python -m scripts.demo_optimizer` against the actual 64-area public CSV. All scenarios use one bedroom and a hard monthly budget. The five shown recommendations in each scenario are Pareto-efficient. Distances below are straight-line kilometers from each area's ZCTA representative point.

| Scenario | Budget | Income | Normalized rent/work/station weights | Eligible | Excluded | Pareto-efficient |
|---|---:|---:|---|---:|---:|---:|
| A: budget-conscious | $1,600 | $65,000 | 0.60 / 0.20 / 0.20 | 24 | 40 | 8 |
| B: balanced | $1,900 | $75,000 | 0.34 / 0.33 / 0.33 | 38 | 26 | 10 |
| C: accessibility-focused | $2,400 | Not supplied | 0.10 / 0.45 / 0.45 | 47 | 17 | 14 |

| Scenario / rank | Area | HUD 1BR benchmark | Loop km | Nearest CTA km |
|---|---|---:|---:|---:|
| A1 | 60653 | $1,340 | 7.532 | 0.818 |
| A2 | 60609 | $1,330 | 8.294 | 2.083 |
| A3 | 60632 | $1,330 | 10.597 | 1.317 |
| A4 | 60621 | $1,350 | 12.286 | 0.536 |
| A5 | 60644 | $1,450 | 10.500 | 0.785 |
| B1 | 60653 | $1,340 | 7.532 | 0.818 |
| B2 | 60609 | $1,330 | 8.294 | 2.083 |
| B3 | 60632 | $1,330 | 10.597 | 1.317 |
| B4 | 60621 | $1,350 | 12.286 | 0.536 |
| B5 | 60608 | $1,530 | 5.153 | 0.700 |
| C1 | 60608 | $1,530 | 5.153 | 0.700 |
| C2 | 60616 | $2,010 | 4.146 | 0.505 |
| C3 | 60612 | $1,890 | 4.634 | 0.623 |
| C4 | 60653 | $1,340 | 7.532 | 0.818 |
| C5 | 60624 | $1,520 | 7.676 | 0.638 |

The top area changes from 60653 to 60608 as distance weights increase. Area 60653 ranks above the cheapest $1,330 areas in A/B because its closer CTA access improves the stated weighted tradeoff. Central ZIP 60601 is excluded from C because its one-bedroom HUD benchmark is $2,670, above C's $2,400 hard budget. No excluded area appears among recommendations. Tests independently recompute pairwise dominance over each scenario's eligible set and confirm every frontier label.

## Tests, usage, and limitations

Final full suite: **51 passed** (12 existing Batch 1 tests plus 39 Batch 2A tests). Coverage includes all five bedrooms, exact thresholds, income burden, hard/soft budget, missing rent and distances, multiple exclusion reasons, empty results, strict Pareto ties and three-way tradeoffs, dominated fill, zero-range scoring, weight normalization, stable tie ordering, real public data loading, source immutability, repeated deterministic results, strict JSON, and real-scenario eligibility/frontier checks.

From the repository root:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m scripts.demo_optimizer
```

Example library use:

```python
from backend.app.optimization import optimize_housing

result = optimize_housing({"monthly_budget": 1900, "bedrooms": 1})
```

The model compares HUD benchmarks, not listed apartments. CTA station and Loop distances are geographic proxies without route availability, accessibility at a specific address, or travel time. Scoring depends on the eligible candidate set. Feed publication date is unavailable in the underlying public data; service data will need routine refresh. Future user-selected workplace coordinates require a separately tested recalculation step. Batch 2B can integrate this output into an API; Batch 2B code has not been started.
