# Batch 6B: final UX polish and pre-deployment QA

## Outcome

The Analyze flow now makes it clearer what is entered, what is known, and which follow-up actions affect saved comparisons. New manual rentals start blank. Existing API routes and financial calculations are unchanged. The changes stay within the React client and its tests; no dependencies, provider integrations, or deployment configuration were added.

## Product changes

- New manual entry starts with empty rent, label, concessions, and extra-charge amounts. Deposit, fees, and utilities start as unknown until the user confirms an amount or confirms none. The default 12-month lease duration is labeled and editable.
- Advanced charges have an explicit completeness control so a known subtotal cannot be mistaken for a complete estimate. Beginning a new manual or lease entry clears unsaved sample/result state while preserving saved Rental A/B offers. Entry-method switching uses compact actions rather than repeating the full welcome cards.
- Results distinguish known-term monthly cash from a complete projection. Unknown fees/utilities are called “Not confirmed”; confirmed none is stated separately. Financial profile results explain the scope of inputs, prevent double-counting student loans, and identify roommate contributions as uncertain.
- Comparison actions have a dedicated section. Saving to an empty slot is direct; replacing a saved offer requires an explicit disclosure/action. The current offer source is identified as user-entered or extracted and reviewed.
- Lease review formats candidate values as readable terms, highlights required and uncertain items, and makes evidence verification state easier to scan. All-field review requirements remain in force.
- Early-departure results explain that moving out does not itself end a rent obligation. When the API marks consequences or future rent unknown, the interface displays “Unknown” instead of presenting a misleading $0 future-rent figure. Known one-time cash amounts and unresolved obligations remain distinct.
- Currency formatting is shared across the Analyze experience, uses grouping separators, preserves cents when present, and displays missing values as “Unknown.”

## Files

Files changed specifically for Batch 6B:

- `frontend/src/components/CashFlowChart.tsx`
- `frontend/src/components/FinancialProfileForm.tsx`
- `frontend/src/components/LeaseReview.tsx`
- `frontend/src/components/RentalInput.tsx`
- `frontend/src/components/RentalResults.tsx`
- `frontend/src/components/RentalStressPanel.tsx`
- `frontend/src/components/RentalWorkspace.tsx`
- `frontend/src/lib/rentalForms.ts`
- `frontend/src/test/batch5b.test.tsx`
- `docs/BATCH_6B_REPORT.md`

`README.md` already contains a Batch 6B summary and link in the shared working tree. It and several frontend files also contain earlier uncommitted Batch 6A work; this report does not attribute those pre-existing edits to Batch 6B. No backend algorithms or API contracts were edited.

## Verification

Frontend checks run from `frontend/` on 2026-10-25:

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test` | **54 passed** across 5 files |
| `npm run build` | Passed; Vite 6.4.5 production bundle |
| `git diff --check` | Passed; Git emitted only line-ending conversion notices |
| `.venv\Scripts\python.exe -m pytest -q` | Could not start: venv launcher points to missing Python 3.12 at `C:\Users\ykkad\AppData\Local\Programs\Python\Python312\python.exe` |

The frontend regression suite covers blank manual entry, preservation of saved offers, no duplicated entry cards, unknown versus confirmed-none charges, currency formats, readable/uncertain lease review, comparison actions, financial profile help, and unknown early-departure consequences. The full backend suite remains unverified because the configured interpreter is absent; no backend pass is claimed.

Local browser inspection at the available approximately 981px viewport confirmed the entry choices, blank manual form, lease-input switching, and manual evaluation against the local API. A synthetic manual offer displayed known amounts and explicitly unconfirmed fees/utilities. The early-departure view was checked against the API's unknown-consequences response and now avoids a false zero for unknown future rent. No Gemini request was made. The connected browser did not provide viewport resizing or a screenshot file export, so fresh visual checks at 1440, 1024, 768, and 390px, a final browser-console capture, and saved screenshot artifacts are not claimed. Those widths have automated responsive CSS coverage but still need a manual browser pass.

## Deployment readiness scan and remaining work

- `.env` is Git-ignored, and no frontend code contains `GEMINI_API_KEY`. The browser uses same-origin `/api` paths; Vite's configured API proxy is for local development. A production deployment needs a same-origin reverse proxy or equivalent backend routing.
- Backend CORS permits explicit HTTP(S) origins and rejects wildcard `*`. The default is local development origins.
- Lease extraction limits request sizes and applies a process-local request guard, but that guard is not distributed abuse protection or authentication. Do not expose the extraction endpoint publicly without a suitable shared rate limit and access/abuse controls.
- The full backend test suite must be run after restoring a Python 3.12 runtime. Then manually inspect the app at 1440, 1024, 768, and 390px and capture the browser console. The live synthetic Gemini path was already verified in the Batch 5B.1 report; no additional provider call was made for this polish pass.

No commit, push, deployment, or additional batch work was performed.
