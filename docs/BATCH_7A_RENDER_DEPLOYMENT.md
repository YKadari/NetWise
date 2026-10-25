# Batch 7A: single-service Render deployment preparation

## Files changed

Added `.dockerignore`, `Dockerfile`, `render.yaml`, `backend/requirements-dev.txt`, and this report. Updated `.env.example`, `README.md`, `backend/requirements.txt`, `backend/app/main.py`, `backend/app/lease_extraction/config.py`, `backend/app/api/lease_routes.py`, `frontend/src/components/LeaseInput.tsx`, `tests/test_api.py`, `tests/test_lease_extraction.py`, and the setup command references in `docs/BATCH_1A_REPORT.md`, `docs/BATCH_1B_REPORT.md`, and `docs/BATCH_2B_REPORT.md`.

## Scope and architecture

Batch 7A prepares one Docker-based Render Web Service. The image builds the Vite React app in a pinned Node stage, then installs only backend runtime packages in a Python 3.12 slim stage. FastAPI serves the static frontend and the existing API from the same origin. The final image runs as an unprivileged user, includes only the backend, built frontend, runtime packages, and six public Chicago data files, and has no writable data dependency. No Render service was created and no deployment, commit, or push was performed.

The runtime data loader resolves its default CSV from the Python source tree (`backend/app/optimization/data_loader.py`), which is `/app/data/public/housing_transit_core.csv` in the image. Map startup reads the three GeoJSON files from `/app/data/public/`. These are copied unchanged from `data/public/`; the Zillow-enriched `data/processed/` output and national/raw downloads are excluded. Housing/transit requests are read-only, and no database or persistent disk is configured.

`backend/requirements.txt` now contains only runtime packages. `backend/requirements-dev.txt` includes that runtime set plus data-pipeline and test packages (pandas, openpyxl, geopandas, pytest, and httpx). This keeps test/build tools out of the production image while retaining the project’s existing local workflows. The frontend uses `npm ci` from its lockfile and runs the existing production build. No key is made available to Vite.

## Request routing and server behavior

When `frontend/dist/index.html` exists, FastAPI mounts the built site after all API routers. The mount serves `/`, JS/CSS/images with Starlette MIME handling, and falls back to `index.html` for non-API client routes such as `/analyze`. Missing asset paths with file extensions remain 404. Unknown `/api` paths return JSON 404 and never fall back to the SPA. When built assets are absent (normal local backend development), no static mount is installed. Production CORS defaults to an empty allowlist because the frontend and API share an origin; local development retains `http://localhost:5173`. An explicit `NESTWISE_CORS_ORIGINS` remains validated and wildcard origins are rejected.

Container command:

```sh
uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1
```

It has no reload mode, listens on Render’s supplied port, and starts independently of Gemini configuration. Render’s documented web service contract requires binding to `0.0.0.0` and the provided port ([Render Web Services](https://render.com/docs/web-services)).

## Environment variables and Gemini protection

The image sets `NESTWISE_ENV=production` and `NESTWISE_GEMINI_DIAGNOSTICS=0`; Render config explicitly sets `NESTWISE_ENABLE_PUBLIC_GEMINI=false`. In production, Gemini extraction is disabled unless that flag is explicitly true. With it disabled, `/api/lease/status` reports not ready and text/PDF extraction return a sanitized 503; manual rental entry, evaluation, comparisons, stress analysis, and Explore remain independent. Local behavior remains unchanged: absent a flag, extraction can be used when locally configured. Production does not load a `.env` file. `.env.example` contains placeholders only.

Do not enable public Gemini solely by toggling the feature flag. The current five-per-minute limiter is process-local, is not shared across instances, and is not authentication or sufficient public abuse protection. Keep the endpoint disabled until shared request limits, access/abuse controls, and provider spend/quota limits are in place. Gemini key absence does not prevent startup. If later enabled, add `GEMINI_API_KEY` as a Render secret environment variable and optionally set `GEMINI_MODEL` to the already-supported model. Never add either value to `render.yaml`, Vite variables, or source control. This preparation does not enable billing or change provider quotas.

Other deployment environment:

| Variable | Render setting |
|---|---|
| `NESTWISE_ENV` | `production` (set in `render.yaml`) |
| `NESTWISE_ENABLE_PUBLIC_GEMINI` | `false` (set in `render.yaml`; keep off) |
| `NESTWISE_GEMINI_DIAGNOSTICS` | `0` (set in `render.yaml`) |
| `PORT` | Supplied by Render; do not set manually |
| `GEMINI_API_KEY` | Omit while Gemini is disabled; if later approved, add as a secret through the dashboard only |
| `GEMINI_MODEL` | Optional; default remains the current provider model |
| `NESTWISE_CORS_ORIGINS` | Omit for same-origin deployment; production default is empty |

The existing process-local extraction limiter and ephemeral upload handling are unchanged. No lease persistence, account system, or shared abuse controls are introduced. The endpoint also has no authentication. A public preview needs additional protection before extraction is enabled.

## Render configuration and manual setup

`render.yaml` declares exactly one service: `nestwise`, type `web`, runtime `docker`, `free` starting plan, Dockerfile `./Dockerfile`, repository-root context `.`, health path `/api/health`, and `autoDeploy: false`. It creates no database, worker, Redis, or disk. Render Blueprints support Docker services, Dockerfile/context settings, health checks, environment variables, and auto-deploy configuration ([Blueprint specification](https://render.com/docs/blueprint-spec)). The free plan is only a starting preview configuration: Render documents that free services can sleep after inactivity and advises against using them for production applications ([free instance limitations](https://render.com/docs/free)). Select a different plan only after reviewing current service needs; this file does not choose or purchase a paid plan.

Manual steps the owner must take:

1. Review the Docker build and this report, then push the reviewed repository through the owner’s normal Git process. This change does not push it.
2. In Render, choose **New > Blueprint** and connect the repository, or create one **Web Service** from that repository.
3. Choose the intended branch explicitly. Automatic deploys are disabled in the Blueprint; use the dashboard’s manual deploy action after review. Render’s deploy settings and logs are available in the service dashboard ([deploys](https://render.com/docs/deploys), [logs](https://render.com/docs/logging)).
4. Confirm the settings are one Docker Web Service, repository root `.`, `Dockerfile` path `./Dockerfile`, context `.`, and health check `/api/health`. Leave Gemini disabled and do not add a key.
5. Review the selected plan and current Render limits before creating the service. This task did not create a service, accept account terms, or change account settings.

## Checks and actual verification

Post-change checks:

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test -- --reporter=dot` | **69 passed** across 6 files |
| `npm run build` | Passed; Vite 6.4.5 production bundle |
| `.venv\Scripts\python.exe -m pytest -q` | **170 passed**, one existing Starlette/TestClient deprecation warning |
| Focused SPA routing regression | Passed: root, client route, JS MIME, missing asset 404, and unknown API JSON 404 |
| Docker CLI | Version 29.8.0 available |
| Docker daemon / image build | Not available: the `npipe:////./pipe/docker_engine` endpoint does not exist |

The Python launcher worked when run outside the restricted sandbox; no Python tests are claimed as blocked. The frontend commands similarly required execution outside the sandbox because Node initially failed with `EPERM` resolving `C:\Users\ykkad`. The new backend test covers the production-default Gemini gate and confirms status and extraction responses do not contain the synthetic API key. Existing backend tests cover health, public data routes, rental evaluation/comparison/stress, and lease behavior. No container-level smoke test was possible without the Docker daemon. A Render build, service health check, and browser check still require manual verification after service setup.

A production smoke test should verify `/`, a built JS/CSS asset, a refreshed client route, `/api/health`, `/api/areas`, `/api/geo/housing`, rental evaluate/compare/stress endpoints using synthetic values, disabled Gemini status and 503, an unknown `/api/...` JSON 404, and absence of key material in browser assets. Use synthetic data only.

Local build and run from repository root:

```powershell
docker build -t nestwise:batch-7a .
docker run --rm -p 10000:10000 -e NESTWISE_ENV=production -e NESTWISE_ENABLE_PUBLIC_GEMINI=false -e NESTWISE_GEMINI_DIAGNOSTICS=0 nestwise:batch-7a
```

Then, in another terminal, check `http://127.0.0.1:10000/`, `/api/health`, `/api/areas?limit=1`, `/api/geo/housing`, and a nonexistent `/api/...` route. For UI route refresh, directly open `/analyze` and reload. A production smoke test can post synthetic documented payloads to `/api/rental/evaluate`, `/api/rental/compare`, and `/api/rental/stress-test`; do not submit personal lease content.

## Rollback and remaining limitations

If a deployment fails, inspect the Render deploy and runtime logs, then use the service’s **Deploys** page to roll back to the last known-good deploy. Render notes that a dashboard rollback temporarily disables auto-deploys; the owner should confirm deployment settings afterward ([rollbacks](https://render.com/docs/rollbacks)). Since this Blueprint sets `autoDeploy: false`, a new reviewed deployment remains manual.

This is deployment preparation, not a security certification. The local Python runtime is missing, so backend regressions, post-change API checks, and local runtime-image checks remain unverified unless recorded after this report was drafted. Docker daemon access may also be unavailable. Render’s actual build, service limits, health check, and UI must be verified manually after the owner creates the service. Free-instance sleep/cold-start behavior and the in-memory limiter make this a preview configuration, not production-hardened operation. Live Gemini remains intentionally disabled.
