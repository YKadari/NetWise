# Batch 5B: rental decision frontend

## Product workflow

The frontend now offers three connected areas: **Explore** retains the Chicago housing map and optimizer, **Analyze** accepts manual rental terms or a lease for extraction and review, and **Compare** evaluates two saved rental offers. The existing warm, dark green visual system, Tailwind setup, and React architecture remain in use. The header now uses the product promise “Find your place. Know what you're signing.”

Analyze follows a three-step path: provide terms, review extracted terms when applicable, and inspect the calculated cash flow. Manual entry works without Gemini and distinguishes unknown, confirmed none, and provided amounts. Less common charges, concessions, and roommate assumptions are in a disclosure section. A financial profile is optional for basic offer calculations and is required for personalized cash-flow and savings projections. Profile inputs stay in React memory and are not written to browser storage.

Text and PDF extraction run through the backend. The review screen displays candidate values, excerpt and page evidence, backend verification state, ambiguity, and field-specific decisions. The user must submit a decision for every draft term; required terms can be corrected explicitly. Only the backend-confirmed offer is sent to the Batch 4A evaluator. Confirmed extracted offers are not silently flattened into the smaller manual form: starting a manual replacement begins a new offer and leaves the existing saved comparison slot intact until replacement.

Evaluation prioritizes monthly obligation, move-in cash, modeled lease expense, refundable cash held, and profile-based monthly cash. Unknown categories remain visible as incomplete known subtotals. Month-by-month cash flow is available as a table with a chart view. Stress tests call the Batch 5A endpoint for utility increases, roommate contribution loss, and early departure. Every stress result is presented against its baseline with the assumptions and unknown consequences returned by the API. The comparison screen reports measured differences under one shared profile and warns when lease durations differ; it does not select a winner.

## Components and files

Added `ProductNavigation`, `RentalWorkspace`, `RentalInput`, `LeaseInput`, `LeaseReview`, `FinancialProfileForm`, `RentalResults`, `CashFlowChart`, `RentalStressPanel`, and `RentalComparison`, together with typed rental API helpers, request/result types, form builders, synthetic examples, tests, and this report. Updated `App.tsx`, `Header.tsx`, `HousingMap.tsx`, and Vite proxy configuration. README documents the two-server workflow. No frontend dependencies were added, and no backend engine or housing data was changed in Batch 5B.

The frontend API client calls the existing lease status/extract/confirm routes and the Batch 4A evaluate/compare and Batch 5A stress-test routes. It maps documented HTTP failures to actionable messages and does not contain a Gemini key or call Gemini from the browser. The backend serializes confirmed Decimal values as JSON strings while Batch 4A expects numeric JSON request values; the frontend converts only confirmed monetary offer fields to finite numbers at that API boundary.

Vite defaults its `/api` proxy to `http://127.0.0.1:8001`, matching the current local backend port, and accepts a local `NESTWISE_API_PROXY_TARGET` override. The target must be an HTTP loopback URL; no dependency or secret is added for proxying.

## Synthetic demo

“Try a synthetic demo” loads two clearly labeled examples and a sample financial profile. Scenario A has lower base rent, higher recurring charges, and higher upfront cash; Scenario B has higher base rent, fewer recurring charges, and lower upfront cash. The user can evaluate Scenario A, compare both offers under the same profile, and run a utility or roommate stress test. Demo numbers are hypothetical and are based on the existing Batch 4A sample values. A separate “Use synthetic AI demo text” action submits explicitly synthetic text to the real extraction service; the app does not fabricate a Gemini response.

## Verification

Final local checks on 2026-10-24:

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test` | **36 passed** across 5 files |
| `npm run build` | Passed; Vite 6.4.5 production bundle |
| `.venv\Scripts\python.exe -m pytest -q` | **166 passed**, one existing Starlette/TestClient deprecation warning |

Frontend coverage includes product navigation, manual entry, unknown versus none, PDF validation, provider status errors, field-level review and correction, Decimal normalization, a mocked review-to-evaluation workflow, known subtotal labels, financial profile checks, stress submission, comparisons, different term lengths, and stale comparison response suppression. Backend regression covers the existing housing, Batch 4A, Batch 4B, and Batch 5A features; no backend files were changed as part of Batch 5B.

Browser checks used the live local app at 1440, 1024, 768, and 390 CSS pixels. The document width matched its viewport at each width (the browser reported a 375-pixel content viewport for the 390-pixel override); no horizontal overflow was found. The comparison table scrolls within its own container on mobile. The Chicago map rendered its 64 ZCTA polygons and 143 CTA points when enabled in the earlier Explore check. Live manual evaluation returned the expected sample values. The demo evaluated successfully; a utility stress request displayed all 12 monthly rows; the two-offer comparison returned backend differences for both synthetic offers.

During initial Batch 5B QA, a synthetic live extraction returned a sanitized HTTP 502. The issue was diagnosed and repaired in [Batch 5B.1](BATCH_5B_GEMINI_REPAIR.md). The follow-up verified a valid draft from the actual endpoint, completed explicit review, and received HTTP 200 from the Batch 4A evaluator. The automated frontend test also covers the mocked extraction/review/confirm/evaluate path and asserts that pasted source text is not included in the confirmation request. No personal lease or profile was submitted to Gemini. The browser console review was interrupted before a final log capture, so this report does not claim a clean console log.

## Running locally

In one PowerShell terminal from the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001 --reload
```

In a second terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/`. If FastAPI is running on another port, set the Vite proxy before starting the dev server, for example:

```powershell
$env:NESTWISE_API_PROXY_TARGET = 'http://127.0.0.1:8000'
npm run dev
```

Run frontend checks from `frontend/` with `npm run typecheck`, `npm test`, and `npm run build`. Run backend regression from the repository root with `.\.venv\Scripts\python.exe -m pytest -q`.

## Limits and manual steps

The live Gemini 502 needs investigation in the local backend/provider configuration before demonstrating genuine extraction. Keep using the synthetic deterministic demo while it is unavailable. PDF upload and file restrictions are covered by the frontend tests; the live browser test used pasted synthetic text. No personal data or lease document is persisted in frontend storage, but extraction content is sent through the backend to Google Gemini when the service is available. Follow the current provider terms before submitting a real lease.

The frontend keeps offers and financial profile only in React state; refreshing the page clears them. A manual holding-deposit amount is not represented in the simplified entry form (unknown and confirmed-none are supported); extracted confirmed offers retain their backend fields until manually replaced. Use the API or a future UI addition for that uncommon term. The interface remains a local development build, with no deployment, account system, database, or persistent storage configured.
