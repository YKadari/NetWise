# NestWise data workspace

Batch 1A builds the Chicago core housing dataset from the HUD FY2027 SAFMR, 2020 Census ZCTA, and Zillow Research ZORI source files. Batch 1B adds CTA rail accessibility and a default Chicago Loop destination.

Keep the three Batch 1A source files in the repository root (their current location) or place them in `data/raw/`. Regenerate the local outputs with:

```powershell
\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
.\.venv\Scripts\python.exe scripts/build_housing_data.py
```

Build the complete four-source pipeline with:

```powershell
.\.venv\Scripts\python.exe scripts/build_final_data.py
```

This regenerates Batch 1A under `data/processed/`, then writes Zillow-free public core tables and map files to `data/public/`. The Zillow-enriched final CSV remains in the Git-ignored `data/processed/` directory. The CTA data terms and publication conditions are described in [the Batch 1B report](docs/BATCH_1B_REPORT.md).

The Batch 1A outputs are written to `data/processed/`. They are ignored by Git because the housing CSV includes Zillow values whose redistribution terms have not been established. See [the Batch 1A report](docs/BATCH_1A_REPORT.md) for scope, methodology, limitations, counts, and tests.

For data pipeline development and tests, install the development set with `-r backend/requirements-dev.txt`. The production Docker image installs only `backend/requirements.txt`.

Run tests with:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Batch 2A optimizes the public core locally. Run the three real-data examples with:

```powershell
.\.venv\Scripts\python.exe -m scripts.demo_optimizer
```

The entry point is `backend.app.optimization.optimize_housing(preferences, areas=None)`. It returns a JSON-serializable result; with `areas=None`, it reads only `data/public/housing_transit_core.csv`. See [the Batch 2A report](docs/BATCH_2A_REPORT.md) for validation, ranking rules, and demonstration results.

Batch 2B provides a local FastAPI server over the public core. From the repository root:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open `http://127.0.0.1:8000/docs` for the API explorer or `http://127.0.0.1:8000/api/health` for the data health check. CORS permits `http://localhost:5173` by default; set `NESTWISE_CORS_ORIGINS` to a comma-separated list of explicit origins to change it. Run all tests with `.\.venv\Scripts\python.exe -m pytest -q`. See [the Batch 2B report](docs/BATCH_2B_REPORT.md) for endpoints, examples, performance, and limits.

## Batch 3A: Chicago housing explorer

Start the backend as above, then use a second terminal from the repository root:

```powershell
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. Vite proxies `/api` to the local backend at `127.0.0.1:8000`; the browser needs no API key. The explorer uses the public HUD/Census/CTA data and does not load the local Zillow-enriched output. It shows ZCTA boundaries, eligibility, shortlist recommendations, area details, and optional CTA stations. Rents are HUD benchmarks rather than available listings, and distances are straight-line proxies rather than travel times.

Frontend checks:

```powershell
cd frontend
npm run typecheck
npm test
npm run build
```

See [the Batch 3A report](docs/BATCH_3A_REPORT.md) for design, live verification, and limitations. Node 20.11.0 or a compatible newer release is required by this project's selected frontend dependencies.

Batch 3B adds exact budget sensitivity and a two-area comparison flow to the Chicago explorer. Nearby budget counts and the next threshold come from `POST /api/sensitivity`; area facts and measured differences come from `POST /api/areas/compare`. Run the same frontend commands above. See [the Batch 3B report](docs/BATCH_3B_REPORT.md) for responsive behavior, real-data verification, and current limits.

## Current product direction: rental commitments

The product direction has expanded from comparing Chicago areas to evaluating the financial commitments in a specific rental offer. The existing Chicago explorer remains available; rental-term calculations are a separate deterministic API and do not use housing-area benchmarks or persist renter data.

Batch 4A adds:

- `POST /api/rental/evaluate` to model known lease costs, payment timing, concessions, upfront cash, deposits, monthly cash flow, and affordability against user-supplied take-home finances.
- `POST /api/rental/compare` to evaluate two offers against one financial profile and return factual differences, including normalized monthly costs when lease terms differ.

Run the hypothetical synthetic examples with `.\.venv\Scripts\python.exe -m scripts.demo_rental_finances`. See [the Batch 4A report](docs/BATCH_4A_REPORT.md) for request examples, formulas, assumptions, test results, and limitations. All financial inputs are request-only: the API does not store or log offer or profile bodies. Unknown terms remain visible and are not filled with typical lease assumptions.
# Batch 4B lease extraction

The backend now exposes an optional Gemini-powered lease extraction and human confirmation workflow. Configure `GEMINI_API_KEY` in the ignored repository-root `.env` (never commit it); `GEMINI_MODEL` optionally selects another supported model. The default is `gemini-3.5-flash-lite`. Extraction accepts pasted text or a bounded PDF upload and returns candidate terms with evidence and uncertainty. The backend requires exactly one review decision for every draft term; the Analyze interface presents a concise summary and safely keeps unseen or unclear optional terms unknown. The service does not persist leases and sends submitted content to Google Gemini; use synthetic documents for demos. See [Batch 4B implementation notes](docs/BATCH_4B_REPORT.md) for endpoints, privacy, limits, and verification status.

Batch 5A adds deterministic rental stress testing for utility increases, roommate contribution loss, and early departure at `POST /api/rental/stress-test` (with optional independent `/batch` scenarios). It reuses the Batch 4A financial evaluator and keeps unknown obligations unresolved. Scenarios are hypothetical, not forecasts or legal advice. See [Batch 5A implementation notes](docs/BATCH_5A_REPORT.md) for accounting rules, examples, and verification status.

## Batch 5B: rental decision frontend

The React app now connects the Chicago **Explore** experience with **Analyze** for manual rental evaluation or lease extraction and human review, and **Compare** for two saved rental offers. Analysis uses the existing Batch 4A evaluate/compare endpoints and Batch 5A stress endpoint. A synthetic demo works without Gemini; submitted lease text or PDFs go through the backend to Gemini when configured. Offers and financial profiles stay in page memory and clear when refreshed. See [the Batch 5B report](docs/BATCH_5B_REPORT.md) for the workflow and limits, and [the Batch 5B.1 Gemini repair report](docs/BATCH_5B_GEMINI_REPAIR.md) for the verified live extraction fix.

Run FastAPI on port 8001 from the repository root, then start Vite in another PowerShell terminal from `frontend/`:

```powershell
# Repository root, terminal 1
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001 --reload

# frontend/, terminal 2
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. The Vite `/api` proxy defaults to port 8001; set `$env:NESTWISE_API_PROXY_TARGET = 'http://127.0.0.1:8000'` in the frontend terminal if the backend runs on port 8000 instead. Run `npm run typecheck`, `npm test`, and `npm run build` from `frontend/`.

Batch 6A makes Analyze start with three options: AI lease review, manual rental details, or an immediate synthetic result. Financial profile entry and stress scenarios are optional follow-ups on results; month-by-month detail is collapsed until requested. The sample comparison uses temporary data and does not replace saved Rental A/B offers. See [the Batch 6A UX report](docs/BATCH_6A_UX_REPORT.md) for the redesigned flow and verification outcomes.

Batch 6C simplifies AI lease review into essential details, move-in costs, monthly costs, and terms worth checking. Renters can correct important values, inspect source evidence on demand, and confirm the displayed summary once; all original draft terms still receive a backend decision, with unclear or unshown optional terms left unknown by default. See [the Batch 6C report](docs/BATCH_6C_REPORT.md) for safeguards and verification results.

Batch 6B polishes the Analyze entry and comparison actions, keeps new manual rentals blank, and makes incomplete cost terms visible as known subtotals. Batch 7A prepares a single Docker-based Render Web Service with FastAPI serving the built frontend; it keeps public Gemini extraction disabled by default in production. Batch 7C adds Firebase Google Sign-In and Firestore-backed per-user/global request limits for Gemini extraction. See the [Batch 6B QA report](docs/BATCH_6B_REPORT.md), [Batch 7A deployment guide](docs/BATCH_7A_RENDER_DEPLOYMENT.md), and [Batch 7C Firebase/Gemini guide](docs/BATCH_7C_FIREBASE_GEMINI.md).

## Production preview on Render

The root `render.yaml` defines one Docker Web Service, uses `/api/health`, and disables automatic deployment. Review the settings and choose the repository branch in Render before creating the service. Keep `NESTWISE_ENABLE_PUBLIC_GEMINI=false` until the owner has configured Firebase Authentication, Firestore, service credentials, model quota limits, and completed the documented smoke checks. The new controls bound requests but do not guarantee a hard provider spend ceiling. To build and run the same image locally:

```powershell
docker build -t nestwise:batch-7a .
docker run --rm -p 10000:10000 -e NESTWISE_ENV=production -e NESTWISE_ENABLE_PUBLIC_GEMINI=false -e NESTWISE_GEMINI_DIAGNOSTICS=0 nestwise:batch-7a
```

Open `http://127.0.0.1:10000/`. Full Render dashboard setup, environment variables, security limits, smoke checks, and rollback steps are in [the Batch 7A deployment guide](docs/BATCH_7A_RENDER_DEPLOYMENT.md). Firebase project setup, safe secret configuration, quota behavior, and the explicit Gemini enablement checklist are in [the Batch 7C guide](docs/BATCH_7C_FIREBASE_GEMINI.md). This repository preparation does not create or deploy a Render service.
