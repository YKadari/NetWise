# Batch 10A: unified Analyze and rental decision brief

## Evaluator facts available to the brief

The existing `evaluate_rental` result is recomputed on the server from a validated `RentalOffer` and optional `FinancialProfile`. The brief uses these exact fields; the request does not accept totals.

| Meaning | Evaluator field | Brief treatment |
|---|---|---|
| Advertised monthly rent | `monthly_costs.base_rent_before_concessions` | Contract benchmark; gross household amount. |
| Known monthly housing | `monthly_costs.gross_known_monthly_housing_obligation` | Includes identified required recurring charges and estimated utilities; `monthly_costs_complete` controls subtotal wording. |
| Lease duration | `lease.term_months` | Whole months. |
| Known upfront cash | `upfront.upfront_cash_required` | Includes identified prepaid rent, fees, and refundable cash held; `upfront_cash_complete` controls subtotal wording. |
| Refundable cash held | `upfront.refundable_cash_held` | Kept separate from nonrefundable expense; refund never promised. |
| Known lease expense | `lease_totals.known_modeled_nonrefundable_lease_cost` | Gross household expense; `nonrefundable_cost_complete` controls subtotal wording. |
| Recurring fees and utilities | `monthly_costs.recurring_charges_known_subtotal`, `utilities_known_subtotal` | Utilities marked `estimated` in the validated offer are explicitly labeled estimates. |
| Unknowns | `unknown_cost_categories`, `upfront.unknown_upfront_terms` | Only fixed category IDs are used, with backend completeness flags. |
| Prepaid rent | `upfront.prepaid_rent_by_month` | Described as timing of rent already included in lease expense. |
| Roommate assumption | `monthly_costs.expected_roommate_contribution`, `total_contractual_liability_remains_gross` | Personal share depends on expected contribution; contractual total remains gross. |
| Optional readiness signals | `financial_profile.affordability_status`, `emergency_reserve_preserved` | Only these derived indicators enter the brief context; income, savings, names, and profile amounts do not. |

## Unified Analyze journey

Analyze now opens with one **Start rental analysis** button. **Try with example data** opens the same four-stage Guided Rental Advisor with explicitly synthetic answers. The separate AI lease-analysis card was removed from the landing screen. Existing text extraction, evidence review, and human confirmation remain in the application; a small optional link appears inside the guided entry view only when the backend reports AI ready. PDF upload remains hidden from this consumer flow, while its backend route remains intact.

The existing evaluator still provides the rental figures. The results screen begins with **Your rental overview**, which shows monthly, move-in, and lease figures using completeness-aware labels, important unknown categories, and a next action. It separates refundable cash held from lease expense. The existing metric cards, cost breakdown, optional profile, month-by-month chart, stress tests, and Rental A/B comparison remain available below. When utilities are estimated, the overview says so.

## API and explanation service

`POST /api/rental/decision-brief` accepts the existing `RentalEvaluateRequest` shape:

```json
{"offer": {"rental_label": "...", "monthly_base_rent": 1600, "lease_term_months": 12, "...": "validated RentalOffer fields"}, "financial_profile": null}
```

`financial_profile` is optional. Extra fields, including client-supplied totals, are rejected with 422. The route calls `evaluate_rental` again on the validated input. Its typed response returns `source: "gemini"`, `headline`, `overall_summary`, `important_findings` (array), `key_uncertainties` (array), `suggested_next_step`, and `fact_ids` only after a valid model selection. The `fact_ids` values identify selected server-owned statement entries; they are not free-form source citations or lease clauses. No brief is generated automatically; the renter explicitly selects **Generate AI insights**.

`backend/app/ai_explanations/decision_brief.py` builds a small context from the evaluator fields in the table above. It excludes rental labels, fee names, descriptions, raw lease text, income, savings amounts, and contact details. The optional profile contributes only derived affordability and reserve indicators. Current unknown-category IDs are allowlisted. A future unrecognized category becomes a generic “other unconfirmed term” signal; its raw content is not sent to Gemini.

`backend/app/ai_explanations/provider.py` makes one bounded `google-genai` request with the configured model and a 30-second SDK timeout. The provider receives numeric facts formatted from evaluator values, completeness flags, and **eligible statement IDs**. The system instruction tells it to select IDs only. The structured JSON schema constrains each field to those IDs. Pydantic and a server-side catalog membership check validate the returned selection. The server renders final sentences and all currency values from deterministic templates. Thus model-supplied prose or monetary claims cannot reach the displayed brief through this endpoint. AI provides prioritization and composition from grounded choices; it does not write unrestricted advice or calculate money. This trades some expressive range for stronger factual control.

The catalog distinguishes known subtotals from complete totals, labels estimated utilities, keeps refundable deposits separate from expense, describes prepaid rent as timing rather than an extra month, and treats roommate contributions as assumptions against gross household liability. It does not say a rental is definitively affordable. Incomplete categories must produce at least one uncertainty selection.

## Fallback, safety, and cost

**Your rental overview** is deterministic and shown with or without Gemini. When `/api/lease/status` reports AI unavailable, no brief button appears. A failed, limited, timed-out, or invalid AI request leaves the overview and financial results visible with a short safe message. Changing the offer or evaluation, or making a financial profile stale, hides and aborts the prior brief request. AI text is never shown as current for changed inputs. The browser does not call Gemini directly.

The endpoint uses the same `extraction_enabled()` production gate as text/PDF extraction. With `NESTWISE_ENV=production` and `NESTWISE_ENABLE_PUBLIC_GEMINI=false`, it returns 503 before a provider call. The existing process-local guard now covers both lease extraction and briefs: at most five Gemini submissions per minute per client address within one process. This is a local cost guard, not authentication, a distributed quota, or a hard spend cap. Public Gemini remains disabled in `render.yaml`; no cloud setting was changed. If public AI is considered later, shared abuse controls and provider quotas need review before changing that flag.

No brief, offer, profile, or model response is stored by this feature. The new provider does not log requests, generated content, or exception messages. API errors use fixed messages. Lease text extraction still has its existing separate privacy behavior. Only synthetic data was used for the live Batch 10A request.

## Verification on 2026-10-25

| Check | Result |
|---|---|
| Focused mocked brief tests | **17 passed**, one existing Starlette/TestClient deprecation warning |
| Full backend pytest | **201 passed**, one existing Starlette/TestClient deprecation warning |
| Frontend tests | **93 passed** across nine files |
| Frontend TypeScript typecheck | Passed |
| Frontend production build | Passed with Vite 6.4.5; one advisory for a 501 kB minified JavaScript chunk |
| `git diff --check` | Passed; Git printed line-ending notices only |
| Single live synthetic brief request | HTTP 200, `source=gemini`, 3 findings and 3 uncertainties, model `gemini-3.5-flash-lite` |

The live test used the synthetic $1,600 sample through the actual FastAPI endpoint and real provider exactly once. Its returned headline was “Look beyond the advertised rent.” The service rendered a valid grounded brief. No personal renter data was submitted. Mocked tests cover recomputation, rejection of client totals and invalid model IDs, malformed JSON, quota/provider/timeout categories, production gate, missing key, shared request limit, uncertainty, estimated utilities, deposits, prepaid rent, missing profile, data minimization, and SDK request shape. Frontend tests cover the unified landing, example path, deterministic overview, explicit AI action, safe failure, stale-result suppression, and existing comparison/stress access. The remaining live unverified cases include a complete offer with zero unknowns and actual quota/timeout events; their handling is covered by mocked tests. No fresh desktop/mobile browser visual pass was performed in this batch.

## Local review and deployment implications

1. Start the existing FastAPI and Vite servers as documented in [Batch 7D](BATCH_7D_GEMINI_ROLLBACK.md). Use synthetic rental terms.
2. Open Analyze, select **Try with example data**, finish the four stages, and check that the known subtotals remain labeled incomplete. If local AI is ready, select **Generate AI insights** once and verify the separate `AI rental insights` card.
3. Edit an answer and verify the previous AI card disappears. Test an offer without personal finances. Save an offer, compare it, and open a stress scenario.
4. Check the desktop and mobile layouts and keyboard focus. In production with the flag false, confirm the brief button is absent and a direct POST to `/api/rental/decision-brief` returns 503 while `/api/rental/evaluate` remains public.

The owner should not enable public AI merely because the local synthetic request succeeded. The existing process-local limit is insufficient for unauthenticated public Gemini access. `/api/lease/status` checks the key and feature gate, not provider connectivity or quota, so a ready status is not a live health guarantee. The production build reports a JavaScript chunk-size advisory; code splitting can be considered in a later performance pass. No deployment, commit, push, provider model change, financial-formula change, or cloud modification was made. Batch 10B features were not started.

## Files changed

Added `backend/app/ai_explanations/{__init__.py,decision_brief.py,provider.py}`, `backend/app/api/decision_brief_routes.py`, `tests/test_decision_brief.py`, `frontend/src/components/RentalOverview.tsx`, `frontend/src/test/batch10a.test.tsx`, and this report. Updated `backend/app/main.py`, `backend/app/api/lease_routes.py`, `frontend/src/components/RentalWorkspace.tsx`, `frontend/src/components/RentalResults.tsx`, `frontend/src/lib/rentalApi.ts`, `frontend/src/types/rental.ts`, and the existing frontend tests for the intentional landing change.
