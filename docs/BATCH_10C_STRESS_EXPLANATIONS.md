# Batch 10C: grounded financial stress-test explanations

## Outcome

The existing rental stress scenarios now include a short deterministic interpretation in their response and results UI. When local Gemini is available, a separate explicit action can ask it to prioritize approved statements for that same scenario. The deterministic engine remains the sole source of calculations; AI does not calculate, alter, or restate user-supplied totals. No stress formula, provider model, production feature gate, Gemini limit, comparison behavior, or financial evaluator was changed.

## Supported scenarios and calculation source

The current engine supports three scenario types:

- **Utility increase:** applies the explicitly entered monthly amount to the selected months. The result reports total additional personal cash burden, gross household cost change, completeness, and profile-based baseline/stressed resilience when a profile is supplied. Estimated or unknown baseline utilities remain qualified.
- **Roommate contribution loss:** lowers the modeled contribution for selected months. The result reports additional personal cash burden; gross contractual household obligations remain unchanged. This is a contribution assumption, not a finding about lease liability.
- **Early departure:** uses the selected departure month and only explicitly entered termination fee, remaining rent, deposit, and prepaid-rent assumptions. Known cash impact can be incomplete. Unknown rent, deposit outcomes, post-departure charges, and other consequences remain unknown.

`stress_test_rental()` recomputes the baseline through the existing evaluator and computes each hypothetical result. The single-scenario response adds a `deterministic` `interpretation` object without changing the existing numeric fields. The batch stress route retains its existing shape and calculation behavior. No new stress scenarios were added.

## API

`POST /api/rental/stress-test` accepts the existing strict request:

```json
{"offer": {"rental_label": "Example", "monthly_base_rent": 1600, "lease_term_months": 12}, "financial_profile": null, "scenario": {"type": "utility_increase", "additional_monthly_amount": 40, "first_affected_month": 2, "last_affected_month": 4}}
```

It continues returning the deterministic baseline, stressed result, affected months, summary, warnings, and hypothetical flag, with an additive `interpretation` object containing `source`, `headline`, `what_changed`, `main_consequence`, `why_it_matters`, `what_to_watch`, and `what_to_consider`. Example wording: “The scenario adds $40 per month in months 2 through 4; this is an assumption, not a prediction.” Exact calculated burden is rendered from the stress result on the server.

`POST /api/rental/stress-explanation` accepts the same strict `{offer, financial_profile?, scenario}` body. It does not accept client totals, a baseline evaluation, or a stressed result. The route is gated by the existing `extraction_enabled()` production control and shared process-local Gemini limiter, then calls the same stress engine afresh. It returns `source: "gemini"`, the same six interpretation fields, and selected `statement_ids`. Invalid model selections are rejected and rendered as a sanitized 502.

## Explanation selection and grounding

The server builds a small scenario fact set from the validated offer/profile and freshly computed stress output. It includes scenario type, affected period/amounts, result completeness and fixed unknown-category IDs, plus derived shortfall/reserve indicators when available. It omits rental labels, names, fee descriptions, source references, raw lease text, raw income, and savings balances.

The statement catalog is server-owned. It contains scenario-specific approved text and, where supported by computed outputs, actual amounts formatted by backend templates. Gemini receives only the minimized facts and eligible IDs, then selects one ID for each interpretation field. Strict Pydantic validation, catalog membership, and duplicate checks run before returning anything. The server renders all final text from the selected templates; model-generated prose, monetary claims, and legal conclusions are never displayed.

Deterministic interpretations are always shown after the existing stress request succeeds. They are labelled deterministic and hypothetical. Gemini is only called after the renter selects **Explain this scenario with AI**. A small ten-entry in-memory browser cache reuses completed explanations for identical offer/profile/scenario values in the current page session. It is not persisted. Changing the scenario form clears its displayed result; changing the offer/profile or scenario request key aborts any old AI request and clears the old interpretation. AI failures leave deterministic output intact.

## Privacy, limits, and fallback

The AI explanation endpoint reuses the existing Gemini SDK/model, timeout, safe provider error mapping, production feature gate, and five-per-minute per-client process limiter shared with other AI explanation/extraction requests. The response statuses follow the existing conventions: 422 for invalid scenario input, 429 for quota/rate limits, 502 for invalid/provider output, 503 when disabled or unavailable, and 504 for timeouts. Raw provider errors and user data are not returned in error messages.

The process-local limit is not distributed protection or a hard spend cap. Production remains disabled by the existing Render configuration. No key, service, billing, or external account was changed. No live Gemini request was made for this batch. The AI result can only prioritize the fixed catalog; it does not verify that a scenario will occur or that a landlord's terms have a particular legal effect.

## Files changed

Batch 10C adds `backend/app/ai_explanations/stress_explanations.py`, `tests/test_stress_explanations.py`, and this report. It updates `backend/app/ai_explanations/provider.py`, `backend/app/api/stress_routes.py`, `backend/app/api/stress_schemas.py`, `tests/test_rental_stress_api.py`, `frontend/src/types/rental.ts`, `frontend/src/lib/rentalApi.ts`, `frontend/src/components/RentalStressPanel.tsx`, `frontend/src/components/RentalWorkspace.tsx`, and `frontend/src/test/batch5b.test.tsx`. These files already contain some uncommitted Batch 10A/10B changes; only the Batch 10C additions are attributed here.

## Verification status

Frontend checks run during this task:

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test -- --reporter=dot` | **98 passed** across 9 files |
| `npm run build` | Passed with Vite 6.4.5; existing chunk-size advisory (508.94 kB minified) |
| Backend targeted/full pytest | Could not run: `python` is not on PATH, `py -0p` reports no installed Python runtimes, and `.venv\Scripts\python.exe` points to a missing Python 3.12 executable |
| Live Gemini | Not run; no provider verification is claimed |

Backend tests were added for deterministic output across all three scenario kinds, deterministic behavior while AI is gated off, grounded actual utility deltas, selection allowlisting, rejection of extra client totals, sanitized quota/configuration/timeout/provider failures, and the shared rate limiter. They require execution in a working Python environment before release.

Run verification after restoring Python 3.12 from the repository root:

```powershell
python -m pytest -q tests/test_rental_stress_api.py tests/test_rental_stress.py tests/test_decision_brief.py
python -m pytest -q
git diff --check
```

From `frontend/`:

```powershell
npm run typecheck
npm test -- --reporter=dot
npm run build
```

For manual review, use a synthetic offer and run each of the three scenario types, including an early-departure case with unknown consequences. Confirm the deterministic interpretation matches the displayed server values and preserves unknown terms. In local development only, when `/api/lease/status` reports AI ready, select the AI action once and confirm the returned text is selected from approved statements. No live provider call or fresh browser screenshot review was performed.

## Known limitations

The utility and roommate scenarios are hypothetical and limited to selected months; they do not forecast bills or roommate behavior. Stress-test outcomes depend on the structured terms supplied by the renter. Early-departure scenarios cannot determine contract meaning, liability, or legal rights. Unmodeled charges remain outside the calculation. A successful selection is not a professional financial or legal recommendation. The decision support improves review by connecting a renter's explicit scenario to calculated changes, profile-derived indicators when supplied, and concrete checks, without claiming outcome or impact metrics.
