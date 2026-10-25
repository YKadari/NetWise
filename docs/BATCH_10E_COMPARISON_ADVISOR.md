# Batch 10E: grounded rental comparison guidance

## Outcome

The existing Rental A/B comparison now displays a deterministic **Understanding the tradeoffs** section after a successful comparison. It uses the comparison engine's freshly computed known monthly amounts, move-in cash, lease expense, refundable cash, completeness flags, duration comparison, and unknown categories. It labels incomplete figures as subtotals and does not choose a winner.

When the existing local Gemini status is ready, the renter can explicitly request **Explain these tradeoffs with AI**. The backend recomputes the comparison from the validated two-offer request and optional shared profile, then asks Gemini to select one statement ID from a server-owned catalog for each explanation field. The response is rendered only from those catalog statements. No model-generated prose or monetary value is returned. The deterministic interpretation remains visible on AI failure.

## API and grounding

`POST /api/rental/compare` keeps the existing strict request and financial output, with an additive deterministic `interpretation` object. `POST /api/rental/comparison-explanation` accepts the same `{left_offer, right_offer, financial_profile?}` schema, rejects extra fields, calls `compare_rentals()` itself, and does not accept client-supplied evaluation totals.

The comparison catalog is built from server evaluation output. Its facts omit rental labels and other user-authored names. It discusses measured differences, duration mismatch, known subtotal completeness, and separately reported refundable cash. The guidance states that these numbers do not establish an overall best offer. The route uses the existing Gemini model, production feature gate, timeout, safe error mapping, and shared process-local request limiter. Public Gemini remains disabled by Render configuration. No calculations or financial formulas changed.

The frontend does not request AI automatically. Offer/profile changes abort old requests and clear old comparison output. The AI button appears only after a successful comparison and when the existing status endpoint reports service readiness.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test -- --reporter=dot` | Passed, **101 tests across 9 files** |
| `npm run build` | Passed; Vite 6.4.5, existing advisory for a 514.90 kB minified JS chunk |
| Backend pytest | Not run: `python` is not recognized in the current environment and `.venv` targets a missing Python 3.12 interpreter |
| Live Gemini | Not run; backend provider behavior is covered only by mocked tests |

Frontend tests cover deterministic guidance before AI, explicit AI invocation, response display, and discarding an AI response after either offer changes. Backend regression tests cover subtotal/duration language, omitted user labels in model facts, selection allowlisting, extra client totals, and the real deterministic comparison recomputation. They must be run with Python before release.

Commands for a working Python environment, from repository root:

```powershell
python -m pytest -q tests/test_clause_explainer.py tests/test_comparison_advisor.py
python -m pytest -q
git diff --check
```

## Files and limits

New: `backend/app/ai_explanations/comparison_advisor.py`, `backend/app/api/comparison_advisor_routes.py`, `tests/test_comparison_advisor.py`, and this report. Updated: `backend/app/api/rental_schemas.py`, `backend/app/api/rental_routes.py`, `backend/app/main.py`, `frontend/src/components/RentalComparison.tsx`, `frontend/src/components/RentalWorkspace.tsx`, `frontend/src/lib/rentalApi.ts`, `frontend/src/types/rental.ts`, and `frontend/src/test/batch5b.test.tsx`.

Comparison guidance is a summary of modeled terms, not legal or individualized financial advice. Missing, unmodeled, or future costs remain outside the comparison. No live Gemini call, deployment, commit, push, or external service change was performed.
