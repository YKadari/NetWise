# NestWise data workspace

Batch 1A builds the Chicago core housing dataset from the HUD FY2027 SAFMR, 2020 Census ZCTA, and Zillow Research ZORI source files. Batch 1B adds CTA rail accessibility and a default Chicago Loop destination.

Keep the three Batch 1A source files in the repository root (their current location) or place them in `data/raw/`. Regenerate the local outputs with:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe scripts/build_housing_data.py
```

Build the complete four-source pipeline with:

```powershell
.\.venv\Scripts\python.exe scripts/build_final_data.py
```

This regenerates Batch 1A under `data/processed/`, then writes Zillow-free public core tables and map files to `data/public/`. The Zillow-enriched final CSV remains in the Git-ignored `data/processed/` directory. The CTA data terms and publication conditions are described in [the Batch 1B report](docs/BATCH_1B_REPORT.md).

The Batch 1A outputs are written to `data/processed/`. They are ignored by Git because the housing CSV includes Zillow values whose redistribution terms have not been established. See [the Batch 1A report](docs/BATCH_1A_REPORT.md) for scope, methodology, limitations, counts, and tests.

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
