# Batch 3A: interactive Chicago housing explorer

## Scope and architecture

Batch 3A adds a React 18, Vite 6, TypeScript, Tailwind CSS 3, React Leaflet 4, Leaflet 1.9, and Lucide frontend in `frontend/`. Node 20.11.0 and npm 10.2.4 were used. Vite proxies relative `/api` requests to the existing FastAPI server at `127.0.0.1:8000`. No backend algorithms, data pipeline, public data files, Gemini code, deployment setup, authentication, or advanced Batch 3B interfaces were added.

The typed API client in `src/lib/api.ts` calls only `/api/areas?limit=100`, `/api/areas/{area_id}`, `/api/optimize`, `/api/geo/housing`, and `/api/geo/stations`. It checks essential response structure and reports connection, HTTP validation, and incomplete-data errors. Initial requests load all public area attributes and both maps concurrently. Each optimization applies a validated preference profile through `POST /api/optimize`. `AbortController` cancels previous optimization and detail requests. The backend decides eligibility, Pareto membership, and recommendation order; React does not recalculate any of those.

## Files

Added `frontend/package.json`, `package-lock.json`, Vite/TypeScript/Tailwind/PostCSS/Vitest configs, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`, API types and client, preference helpers, `Header`, `PreferencesPanel`, `HousingMap`, `RecommendationsPanel`, `AreaDetails`, and three frontend test files. Added this report and updated `README.md`. Updated `.gitignore` to exclude TypeScript build metadata; it already excluded `node_modules/` and `dist/`. No source or processed housing data was modified.

## Design and interaction

The interface uses a warm off-white canvas, dark ink text, restrained forest and mint accents, serif display headings, clear borders, and system fallback fonts. Desktop widths at 1280px and above use preference, map, and result columns. Intermediate widths use two columns; smaller viewports stack preferences, a large map, and results. A 390px browser viewport was inspected. The UI uses real ZIP identifiers rather than invented neighborhood names or rental listings.

The preference form defaults to a $1,900 hard monthly budget, one bedroom, no income, balanced weights (0.34/0.33/0.33), and no distance maximum. Presets map to affordability (0.60/0.20/0.20) and access (0.10/0.45/0.45) weights. Budget is a precise numeric field; all changes require an explicit Apply action. Validation rejects nonpositive or nonfinite budgets, invalid income, and distance maxima outside 0–1,000 km. The income input is optional and is passed only when supplied.

The map renders all 64 public Census ZCTA polygons and fits their actual bounds. Eligibility controls green or muted polygon styling; a selected polygon has an amber fill and stronger outline. Hover tooltips show the ZIP and the selected bedroom's HUD benchmark. Polygon clicks and recommendation cards select the same `area_id` and focus that polygon. A labelled ZIP selector permits keyboard selection of any map area. The map also shows the source Loop workplace point and optionally all 143 public CTA station points. The key uses text as well as color. OpenStreetMap and Leaflet attribution remains visible; the standard OSM tile endpoint is used for a small local demo without bulk downloads or credentials.

The shortlist shows backend-provided counts and up to ten recommendations. Each card displays the selected bedroom's HUD benchmark, budget difference, straight-line Loop and rail distances, nearest CTA name, Pareto status, and a truncated backend explanation. Empty results suggest relaxing constraints. Selected-area details come from `GET /api/areas/{area_id}` and show all five HUD benchmark sizes, current affordability and eligibility, transit measures, source limitations, and the backend-provided Google Maps directions URL. The outbound link uses `target="_blank"` and `rel="noopener noreferrer"`; it does not claim a verified route or commute duration.

## Accessibility and failure handling

Inputs have labels; buttons, preset choices, cards, the CTA toggle, and the ZIP selector are keyboard operable with visible focus styling. Pending updates, loading, errors, and selection changes have textual states. Failed initial loading offers Retry and a local server hint. An outdated optimization response cannot replace a newer one. If changed constraints disqualify the selected area, the selection clears with an explanation. Reduced-motion preferences shorten animations. A browser map still relies primarily on pointer interaction for direct polygon selection; the ZIP selector supplies keyboard access.

## Checks and live integration

Before implementation, the backend baseline was **77 passed, 1 external Starlette/TestClient deprecation warning**. Final checks on 2026-10-24:

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm test` | 12 passed across 3 files |
| `npm run build` | Pass; Vite 6.4.5 production bundle |
| `python -m pytest -q` in `.venv` | 77 passed, same external warning |

Frontend tests cover defaults, all five bedroom mappings, USD formatting and missing values, presets, input validation, optional fields, API request construction, incomplete data and network failures, explicit Apply, empty recommendations, and selection of a card with backend-provided values.

The real FastAPI and Vite servers were started locally, and the app was opened in Chrome at `127.0.0.1:5173`. Browser observation showed 64 mapped ZCTAs and the default $1,900 one-bedroom result: **38 eligible, 10 Pareto-efficient, ZIP 60653 first**. Changing the budget to $1,600 produced **24 eligible, 8 Pareto-efficient**. Switching to two bedrooms at that budget produced **8 eligible, 4 Pareto-efficient** and changed ZIP 60653's selected benchmark to **$1,510**. At $1,900/one bedroom, the access-focused preset moved ZIP 60608 to first. The CTA toggle displayed station points: the live map had 65 interactive paths before the toggle (64 polygons plus the Loop point) and 208 afterward (143 additional station points). Clicking recommendation ZIP 60653 opened its detail data and selected polygon; clicking a different polygon opened ZIP 60609 detail and selected the corresponding card. The keyboard-accessible ZIP selector opened ZIP 60601 detail with a source-grounded directions link. Setting budget to $1,000 produced **0 eligible** and the empty state, and cleared the prior selection with feedback. The directions links used actual source area and Loop coordinates. Desktop 1440px and mobile 390px browser views were inspected. No Zillow data is fetched by the client; the frontend API paths are limited to the five public endpoints above.

Browser screenshots were inspected during testing but no image files were saved. Network failure recovery was covered by unit tests, not a live outage simulation. No ESLint configuration was added; TypeScript strict checking and Vitest were run instead.

## Run locally

From the repository root, in separate terminals:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
cd frontend
npm ci
npm run dev
```

Visit `http://127.0.0.1:5173/`. Run checks from `frontend/` with `npm run typecheck`, `npm test`, and `npm run build`; run backend tests from the repository root with `.\.venv\Scripts\python.exe -m pytest -q`.

## Limits and Batch 3B priorities

The map uses generalized 2020 Census ZCTAs, not exact current postal ZIP boundaries. HUD FY2027 rents are payment-standard benchmarks, not apartment availability or predicted prices. Rail and Loop distances are straight-line proxies from ZCTA representative points. The CTA feed publication date is absent in public data; deployment will require refresh and source review. The base map depends on OSM tile availability, and outbound Maps directions are not verified routes. Frontend logic does not persist user preferences across reloads.

For Batch 3B, first add richer sensitivity and scenario-comparison views using the existing API, then improve mobile navigation between map and results and run a full browser regression including keyboard interaction and error recovery. User-specific workplace routing, actual commute times, and Gemini remain outside this batch.
