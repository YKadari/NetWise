# Batch 7C: Firebase sign-in and protected Gemini extraction

## Outcome and scope

Gemini text/PDF extraction now requires a verified Firebase Google identity and a Firestore reservation before a provider request. The existing short-window process limiter remains as an additional guard. Manual rental entry, the deterministic financial evaluator, comparisons, stress tests, and the Chicago explorer remain available without Firebase or Gemini. Production extraction remains disabled by default in `render.yaml`; this change does not enable it.

No Firebase project, Firestore database, Google Cloud setting, Render service, or provider billing setting was created or changed. No commit, push, or deployment was made. Batch 7B files were not reintroduced.

## Authentication and request flow

The browser uses Firebase's modular web SDK for Google sign-in. Authentication state and Firebase persistence use in-memory persistence; an ID token is obtained just in time for each extraction request and sent as a bearer token. The browser does not write lease contents or tokens to local/session storage. A short session-storage marker preserves only the intended `analyze` view across a popup-to-redirect fallback.

The backend verifies the token with Firebase Admin, including revocation, project audience/issuer, expiry, UID/subject consistency, and Google sign-in provider. The backend derives the user identity only from verified claims; any user identifier in a request body is ignored. Missing/invalid credentials produce sanitized 401 responses. Firebase verification or quota-store outages fail closed with sanitized 503 responses.

Both text and PDF extraction routes require authentication and quota reservation. Confirmation and the non-Gemini financial routes keep their existing behavior. The authenticated user can still use manual rental entry and synthetic samples when Gemini is disabled or unavailable.

## Quotas and data stored

Before calling Gemini, an atomic Firestore transaction reserves one daily attempt for the authenticated user, one global daily attempt, and one shared in-flight slot. Configured limits are bounded by validation to:

| Limit | Supported configuration |
|---|---:|
| Requests per user per UTC day | 1–3 (`NESTWISE_GEMINI_USER_DAILY_LIMIT`) |
| Requests globally per UTC day | 1–60 (`NESTWISE_GEMINI_GLOBAL_DAILY_LIMIT`) |
| Concurrent provider calls | 1–2 (`NESTWISE_GEMINI_MAX_CONCURRENT`, default 2) |

The global limit has no default and must be set deliberately at or below the actual Gemini model/account quota. Failed provider calls consume daily attempts; retries are not refunded. In-flight reservations expire after three minutes if a process exits unexpectedly. A successful or failed request releases the in-flight slot when possible.

Firestore stores daily counters, short-lived concurrency reservation IDs/timestamps, 30-day expiration timestamps, and per-user counters under a SHA-256 hash of the Firebase UID. It does not store the raw UID, email, ID token, lease text/PDF, Gemini response, or rental profile. **Firestore TTL is not enabled/configured for this deployment.** That does not prevent quota enforcement: requests use the current UTC date document and atomic transactions; expiration timestamps are only for eventual cleanup. Without TTL, old daily and per-user counter documents remain stored and storage can grow over time. If TTL is enabled later, configure the `expire_at` field for both collection groups, `nestwise_gemini_daily` and `users` (the nested per-user documents use the generic `users` collection group). TTL deletion is asynchronous, so 30 days is a retention target rather than an exact deletion time. See [Firestore TTL documentation](https://firebase.google.com/docs/firestore/ttl).

These controls reduce accidental use and bound daily attempts. They are not a hard monetary spend cap: multiple accounts, configuration mistakes, provider-side pricing/limits, other API clients, and outages remain relevant. Keep Google's account/model quota controls in place and set the global application limit conservatively. The service fails closed if Firestore cannot enforce a reservation.

## Local configuration

Install backend requirements and configure the ignored root `.env` using `.env.example` as a guide. Configure only your own Firebase project. The Firebase Admin service-account JSON is a server-side secret and must never be pasted into frontend variables, committed, or printed in logs. The frontend Firebase web configuration is public client configuration, not an authorization secret; Firebase Authentication and backend token verification provide the security boundary.

Required backend settings for extraction:

```dotenv
GEMINI_API_KEY=<server-side Gemini API key>
FIREBASE_PROJECT_ID=<Firebase project ID>
FIREBASE_SERVICE_ACCOUNT_JSON=<single-line service-account JSON>
NESTWISE_GEMINI_USER_DAILY_LIMIT=3
NESTWISE_GEMINI_GLOBAL_DAILY_LIMIT=<no greater than your actual model quota>
NESTWISE_GEMINI_MAX_CONCURRENT=2
```

Required frontend build-time settings (local values belong in ignored `frontend/.env.local`; `frontend/.env.example` contains placeholders):

```dotenv
VITE_FIREBASE_API_KEY=<Firebase web app API key>
VITE_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=<same Firebase project ID>
VITE_FIREBASE_APP_ID=<Firebase web app ID>
```

Start FastAPI and Vite using the existing Batch 5B commands. Check `/api/lease/status` for readiness; it returns only non-secret configuration status and project ID, never credentials. Do not share shell output containing environment variables.

## Owner setup required before any public enablement

The following actions require the project owner in Firebase/Google Cloud/Render; this repository change does not perform them:

1. Create or select a Firebase project, add a web app, enable Google as a Firebase Authentication provider, and add the local and intended Render hostnames to authorized domains. Firebase sign-in follows the documented popup/redirect flow and authentication-state listener.
2. Create the Firestore database in the same project and configure the server service account with only the access needed for token verification and Firestore transactions. Provide the service-account JSON to the backend through the local ignored `.env` or Render secret settings. Do not grant broad project-owner permissions to the runtime service account.
3. Verify the service account can execute transactions. TTL is optional for enforcement and is currently not enabled. If enabling cleanup later, configure `expire_at` TTL for both `nestwise_gemini_daily` and `users` collection groups, considering whether other project data uses a collection group named `users`.
4. Confirm the Gemini model and account quota in Google's console/documentation. Set `NESTWISE_GEMINI_GLOBAL_DAILY_LIMIT` no higher than the verified applicable free-tier daily quota; this code does not assume a quota value and does not change billing.
5. Set the four `VITE_FIREBASE_*` public build variables in the Render service environment so Docker's frontend build can compile the Firebase client configuration. Keep all Gemini and service-account values server-side.
6. Keep `NESTWISE_ENABLE_PUBLIC_GEMINI=false` while configuring and testing. Verify sign-in, invalid-token rejection, user/global limits, concurrency limits, and Firestore failure behavior with synthetic content on a private/local instance.
7. Only after reviewing current provider terms/privacy, Firebase/Firestore access, abuse controls, quotas, and the live smoke test should the owner explicitly set `NESTWISE_ENABLE_PUBLIC_GEMINI=true` in Render and manually deploy. This repository does not set that flag true. To disable immediately, set it false and restart/redeploy the service.

## Privacy and responsible AI

The UI warns users to use a redacted or synthetic lease and not submit names, signatures, account numbers, or other unnecessary private information. The backend does not persist uploaded documents, but submitted lease content is transmitted to Google Gemini when extraction is enabled; the application cannot promise that content is private from the provider. Review the terms and data handling that apply to the configured account before use. Gemini candidates can be wrong or incomplete. Evidence excerpts and verification flags help review a source but do not establish legal meaning. A person must review every draft term and confirm the offer before the deterministic evaluator runs.

The frontend does not expose the Gemini API key and the browser never calls Gemini directly. No personal lease was used for implementation verification.

## Files changed

Batch 7C changes Firebase token verification, quota reservation, extraction route protection, provider readiness, frontend sign-in and bearer-token handling, environment examples, the Docker frontend build arguments, dependency declarations, tests, README guidance, and this report. The extraction algorithms, financial formulas, housing optimization, and Render's default disabled flag were not changed.

## Verification status

Frontend verification completed on 2026-10-25:

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test -- --reporter=dot` | **73 passed** across 7 files |
| `npm run build` | Passed; Vite 6.4.5 production build, with the large JavaScript chunk advisory (631.60 kB minified) |
| `git diff --check` | Passed; Git reported line-ending conversion notices only |

The new frontend Firebase tests cover initialization/configuration, auth state, token acquisition, and sign-in behavior with mocked Firebase boundaries. In this task's earlier focused backend run, `tests/test_firebase_security.py` and `tests/test_lease_extraction.py` passed: **35 passed, 1 existing Starlette/TestClient deprecation warning**. That focused run uses mocked Firebase/Firestore and does not prove access to a real project. A fresh full backend suite could not start in the current environment: `.venv\Scripts\python.exe` points to a missing Python 3.12 executable, and `py -0p` reports no installed Python runtimes. Therefore no fresh full-suite result is claimed.

No live Firebase sign-in, Firestore transaction, or Gemini request was performed. These steps require the owner's Firebase web config, server credential, Firestore database/IAM, Gemini API key, and confirmed provider quota. No cloud project or resource was changed. A live sign-in and Gemini smoke test requires the owner's Firebase project, web config, service credential, Firestore, Gemini key, and a verified quota.

For the deployment-readiness code review, the Dockerfile declares only the four public `VITE_FIREBASE_*` values as build arguments. It does not declare or reference `GEMINI_API_KEY` or `FIREBASE_SERVICE_ACCOUNT_JSON`; the Docker build copies only the frontend, backend, and public data directories, while `.dockerignore` excludes `.env` files. An image-layer scan/build could not be completed because the local Docker daemon is unavailable. The browser build output was scanned for secret-looking credential patterns and contained no matches. `render.yaml` explicitly sets `NESTWISE_ENABLE_PUBLIC_GEMINI=false`; Render's Blueprint documentation states omitted dashboard environment variables are preserved and listed variables can be modified by the Blueprint. The app calls `firestore.client(app=...)` without a database ID, which selects the Firebase Admin SDK's default database. Production GET checks to the supplied Render URL were attempted but could not connect from this environment, so deployed runtime state is not verified here.

Commands:

```powershell
# Repository root (after installing/repairing the Python 3.12 environment)
.\.venv\Scripts\python.exe -m pytest -q

# frontend/
npm run typecheck
npm test -- --reporter=dot
npm run build
```

For live smoke testing, use only a short synthetic, redacted lease. Sign in, submit extraction once, inspect the returned draft, explicitly review all fields, confirm it, and evaluate the confirmed offer. Stop if status is not ready, Firestore reports unavailable, a quota is unclear, or the provider returns an error; avoid repeated requests that consume quota.

## References

- [Firebase Google sign-in for web](https://firebase.google.com/docs/auth/web/google-signin)
- [Firebase Auth state persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence)
- [Firebase Auth state observation](https://firebase.google.com/docs/auth/web/start)
- [Firebase Admin ID token verification](https://firebase.google.com/docs/reference/admin/python/firebase_admin.auth)
- [Firebase Admin SDK setup](https://firebase.google.com/docs/admin/setup)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Firestore TTL](https://firebase.google.com/docs/firestore/ttl)
- [Render Docker environment variables](https://render.com/docs/docker)
- [Render Blueprint environment variables](https://render.com/docs/blueprint-spec)
