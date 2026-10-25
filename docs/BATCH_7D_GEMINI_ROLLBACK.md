# Batch 7D: local Gemini extraction and Firebase rollback

## Outcome

Firebase Google sign-in, Firebase Admin token verification, Firestore quota reservation, and their frontend configuration/build plumbing have been removed. Pasted-text and PDF extraction use the existing backend Gemini provider directly in local development. The existing extraction limits, evidence verification, structured output validation, explicit human review, and Batch 4A evaluation boundary remain in place. The simplified Batch 6C Analyze flow and rental/housing calculations are retained.

Render remains a production environment and `render.yaml` explicitly sets `NESTWISE_ENABLE_PUBLIC_GEMINI=false`. The production server therefore keeps extraction disabled. Do not add `GEMINI_API_KEY` to the Render service while that flag is false. Manual rental entry, offer evaluation/comparison, stress tests, and the Chicago explorer remain available.

## Local demo configuration

Put a server-side Gemini key in the ignored repository-root `.env` file. Do not paste it into source files, frontend environment variables, browser code, or screenshots. `GEMINI_MODEL` is optional and defaults to `gemini-3.5-flash-lite`. In local development, extraction is enabled when configured unless `NESTWISE_ENABLE_PUBLIC_GEMINI` is explicitly false. The production environment never loads the repository `.env` file.

Start the backend from the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001 --reload
```

In a second PowerShell terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. Use the synthetic lease example for a demo and review every extracted term before confirmation. Keep requests minimal; the existing limiter permits at most five submissions per minute per client. Missing key/provider availability returns a sanitized service error. Text and PDF content is sent to Google Gemini for extraction and is not persisted by this application.

## Production deployment and owner cleanup

After the owner reviews and deploys this repository through their normal process, keep `NESTWISE_ENV=production` and `NESTWISE_ENABLE_PUBLIC_GEMINI=false` in Render. Verify `/api/health`, `/api/lease/status`, and a synthetic extraction attempt: status should not report the service ready, extraction should return the disabled response, and non-AI endpoints should remain available. This rollback intentionally does not provide public Gemini access control; do not enable production extraction as part of this change.

After the new deployment is confirmed, the service owner can manually remove obsolete Render environment variables left from Batch 7C:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `NESTWISE_GEMINI_USER_DAILY_LIMIT`
- `NESTWISE_GEMINI_GLOBAL_DAILY_LIMIT`
- `NESTWISE_GEMINI_MAX_CONCURRENT`
- `NESTWISE_REQUIRE_FIREBASE_CONFIG`, if present

This repository change does not access the Render dashboard or delete any cloud resources. Keep the public Gemini flag false. If the deployment fails, use Render's dashboard rollback to return to the prior image and keep the feature flag false.

## Verification

On 2026-10-25, frontend checks completed after restoring the pre-Firebase dependency set:

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test -- --reporter=dot` | **69 passed** across 6 files |
| `npm run build` | Passed; Vite 6.4.5 production build |
| `git diff --check` | Passed |
| `.venv\Scripts\python.exe -m pytest -q` | Could not start: the launcher points to a missing Python 3.12 executable |

Backend suite results are not claimed. The existing lease extraction tests include mocked text and PDF requests without Firebase credentials; they could not be executed in this environment. No live Gemini request, Docker build, Render deployment, or external-service change was performed.

## Local timeout investigation

The provider request implementation, model setting, 30-second SDK timeout, and structured-output configuration are unchanged from Git revision `689cc56` (the last pre-Firebase revision whose Batch 5B.1 report records successful live extraction). The Batch 7D route rollback removed Firebase checks around the provider call but did not add a client or route timeout. The UI's “Gemini took too long” message corresponds to the backend returning 504; the backend emits that only for a provider timeout exception or provider HTTP 408/504. PDF signature/page checks occur before Gemini and return validation errors, while response parsing and Pydantic validation failures map to 502. Therefore the reported 504 points to the Gemini API call/transport, but without a fresh diagnostic log it does not identify the underlying network/provider cause.

The provider now emits opt-in local timing diagnostics for configuration, SDK import, client initialization, request construction, Gemini API call, response parsing, and Pydantic validation. Logs include only fixed stage/category names, exception class, status code, and elapsed milliseconds; they exclude request text, PDF contents, provider response bodies, and credential values. To collect one trace, stop the running local backend and restart it in PowerShell with diagnostics enabled for that process:

```powershell
$env:NESTWISE_GEMINI_DIAGNOSTICS = '1'
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001 --reload
```

Submit the existing synthetic PDF once. A timeout during `gemini_api_call` confirms the SDK/API transport is the slow stage; failures at `request_construction`, `response_parsing`, or `pydantic_validation` identify local request/schema or returned-output issues instead. Turn diagnostics back off by stopping that process or setting the variable to `0`. The timeout remains 30 seconds; it was not increased without timing evidence.

The new timing assertions are in the mocked provider diagnostics tests, but they could not be executed because Python is unavailable. They verify safe timing fields and absence of lease text in the diagnostic output. No new live Gemini verification is claimed.

## Scope and limitations

The process-local request limiter is not shared across Render instances and is not authentication or a hard spend cap. Production safety here depends on the explicit disabled feature flag. Local extraction requires a valid Gemini key and available provider quota. Submitted lease content is sent to Google; use synthetic or appropriately redacted material and review the applicable provider terms. No commit, push, deployment, account change, or billing change was performed.
