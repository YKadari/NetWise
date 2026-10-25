# Batch 5A: deterministic rental financial stress testing

## Summary and architecture

Batch 5A adds deterministic, request-only stress scenarios on top of the Batch 4A `RentalOffer`, `FinancialProfile`, and `evaluate_rental` schedule. It does not call Gemini or modify the housing optimizer, rental baseline formulas, lease extraction, frontend, or datasets. All calculation money uses Batch 4A decimal-to-integer-cent helpers. Results are hypothetical scenario arithmetic, not forecasts, legal advice, enforceability determinations, or guarantees.

Added `backend/app/rental/stress_models.py`, `backend/app/rental/stress_engine.py`, `backend/app/api/stress_schemas.py`, `backend/app/api/stress_routes.py`, `tests/test_rental_stress.py`, `tests/test_rental_stress_api.py`, `scripts/demo_rental_stress.py`, and this report. Updated `backend/app/main.py` to register the router and `README.md` with Batch 5A documentation.

The primary endpoint is `POST /api/rental/stress-test`. The optional `POST /api/rental/stress-test/batch` accepts up to ten independently evaluated scenarios; each is compared with the original offer and profile. No scenario is compounded with another. The existing manual and confirmed document offer models are validated on input. Unreviewed extracted terms remain provisional in the reused Batch 4A evaluation.

## Input schemas and scenarios

Requests contain `offer`, optional `financial_profile`, and a discriminated `scenario` with `type` equal to `utility_increase`, `roommate_contribution_loss`, or `early_departure`. Extra fields, arbitrary formulas/code, booleans in monetary positions, invalid months, negative amounts, and unreviewed known-contract fees are rejected. Month ranges must fit the rental term.

### Utility increase

`additional_monthly_amount`, `first_affected_month`, and `last_affected_month` define a hypothetical extra out-of-pocket charge. It is added after the Batch 4A schedule, so it does not alter or replace lease utility terms or concessions. If utilities are included, the response calls out that this is an extra assumed obligation. If baseline utilities are unknown, the charge amount is known but the total remains incomplete.

### Roommate contribution loss

`monthly_contribution_lost` and an affected month range reduce the expected contribution from the profile (when provided) or otherwise the offer. A missing/zero contribution or loss above the expected amount is rejected. Personal burden changes according to the baseline contribution cap and monthly gross expense. Gross household obligations do not change; contribution sharing does not reduce stated contractual liability.

### Early departure

`departure_month` means the last month of planned occupancy and must be before lease end. `treatment` is one of `known_contractual_termination`, `hypothetical_settlement`, `continuing_lease_obligations`, or `unknown_consequences`.

- Known contractual termination requires a fee, source, and reviewed provenance. Extracted provenance must have `reviewed_by_user=true` and cannot be `needs_review`.
- Hypothetical settlement requires an explicit fee and assumption note.
- Continuing obligations requires explicit remaining monthly rent and number of months; it cannot include a termination fee. The stated month count cannot exceed the remaining term.
- Unknown consequences accepts no modeled fee or obligation amounts.

Remaining rent defaults to `unknown`. Users can mark it `specified` with amounts/months, or explicitly select `none_confirmed` when that treatment is supported by a reviewed source or hypothesis. A termination fee never implies that remaining rent is waived. Explicit ongoing rent is reported separately from departure fees and is not added a second time as an assumed fee. Other post-departure recurring obligations remain unknown. Deposit disposition and prepaid future rent recovery default to unknown; refund/withholding is included only when explicitly selected. Prepaid rent already paid is not charged again. Future concessions are not clawed back without a supplied amount; possible conditional reversals are flagged.

## Financial results and accounting

The response includes the Batch 4A baseline calculations, affected months, stressed month rows, assumptions, unknown categories, warnings, an explanation, and the `result_is_hypothetical_not_a_forecast` marker. Provider/document source excerpts are not echoed; provenance retains only a `source_reference_provided` indicator. Utility and roommate scenarios report monthly baseline/stressed gross obligations, contributions, personal burdens, cash remaining, and differences. Early departure separates one-time event cash impact, explicit continuing rent, deposit cash effects, and prepaid-rent refunds; post-departure total housing obligations remain null where expenses are unresolved.

With a profile, available monthly housing budget reuses Batch 4A's definition: take-home less essential expenses, separately due loans, and the desired savings target. Monthly cash remaining after expenses also uses the Batch 4A target. The savings trajectory starts at available savings minus known upfront cash, then adds take-home less essential expenses, separate loan payments, and actual scheduled personal housing cash. Prepaid rent is already reflected in upfront cash and excluded from its later scheduled payment. The savings trajectory does **not** subtract the planned savings target again; it tracks retained cash. Where cost or payment timing is unknown, it is labeled an upper bound or becomes unknown. Emergency-reserve results are only asserted when the known trajectory supports that conclusion. Without a profile, cost comparisons still return, but income, shortfall, savings, and reserve fields are null.

The savings trajectory assumes residual monthly cash is retained. This is a cash-accounting scenario, not a prediction of actual savings behavior.

## API examples

Utility increase of $100 during months 4–12:

```json
{
  "offer": {"rental_label":"Synthetic lease","monthly_base_rent":1600,"lease_term_months":12},
  "financial_profile": {"monthly_take_home_income":4500,"available_savings":8000,"essential_monthly_nonhousing_expenses":1800},
  "scenario": {"type":"utility_increase","additional_monthly_amount":100,"first_affected_month":4,"last_affected_month":12}
}
```

Hypothetical $2,000 fee after occupancy through month 8; remaining rent deliberately unresolved:

```json
{
  "offer": {"rental_label":"Synthetic lease","monthly_base_rent":1600,"lease_term_months":12},
  "scenario": {"type":"early_departure","departure_month":8,"treatment":"hypothetical_settlement","termination_fee":2000,"assumption_note":"Synthetic fee assumption only."}
}
```

## Synthetic demo arithmetic

`python -m scripts.demo_rental_stress` defines four independent cases over one explicitly synthetic, fully costed lease/profile:

- Utility increase: $100 × 9 affected months = **$900** additional gross expense; personal burden can be lower only where a roommate contribution is still applied by the baseline rules.
- Roommate contribution stops: $800 × 3 months = **$2,400** personal burden under the synthetic offer; gross household obligation is unchanged.
- Month 8 hypothetical departure: **$2,000** explicit fee, with remaining rent left unresolved; no four months are automatically added or waived.
- Alternative continuing-rent case: $1,600 × 4 explicitly specified months = **$6,400** stated rent obligation, with no termination fee. It is an alternative to the fee case.

These values follow the scenario parameters. The demo script was added but could not be executed in this Codex environment (see verification below); the figures above are arithmetic expectations, not a claimed execution result.

## Tests and verification

Added unit/API coverage for cent-based utility totals, concessions, included/unknown utilities, roommate full/partial/excess/no-contribution behavior, invariant gross obligation, early-departure fee versus continuing-rent alternatives, unknown consequences, reviewed contract provenance, deposits and prepaid last rent, reserve/shortfall outcomes, no-profile outputs, deterministic JSON, strict validation, API status codes, independent batch behavior, and existing endpoint availability.

**Verification status after the resilience completeness fix:** The preceding local run was reported as 149 passed, 13 failed, and one warning; those failures were not independently reproduced here. `_resilience()` now initializes the unknown recurring-cost set before deriving completeness, and separately marks cash/savings projections incomplete when a scheduled cash obligation or rent payment timing is unknown. Regression assertions preserve the known cash subtotal while checking that unknown utilities, unknown recurring charges, and unknown payment timing do not become complete projections. This keeps modeled renter burden completeness separate from cash-payment timing completeness.

I attempted the focused Batch 5A tests with both ` .\.venv\Scripts\python.exe -m pytest tests/test_rental_stress.py tests/test_rental_stress_api.py -q` and `py -3.12 -m pytest tests/test_rental_stress.py tests/test_rental_stress_api.py -q`. The virtual-environment interpreter reports `No Python at '"C:\Users\ykkad\AppData\Local\Programs\Python\Python312\python.exe'`; the launcher reports `No installed Python found!`. I also attempted the full suite with `py -3.12 -m pytest -q`; Python again stopped before startup with `No installed Python found!`. Therefore neither focused tests nor the full suite could run in this environment; no passing result is claimed. The demo is also unverified. `git diff --check` completed for tracked changes without whitespace errors (line-ending warnings only).

**Prepaid-rent reconciliation (2026-10-24):** Batch 4A allocates last-month prepaid rent using the original lease's final-month base rent after concessions. In the differing-amount regression, the original rent/prepayment is $1,000 while the continuing-rent assumption is $1,600 for four months: the gross specified obligation is $6,400, only $1,000 is applicable prepaid credit, and the remaining cash due is $5,400. The prior $4,800 expectation incorrectly credited $1,600. A matched-$1,600 regression confirms a $6,400 gross obligation, $1,600 one-time credit, and $4,800 remaining cash due. Per-month rows and aggregate fields now distinguish gross obligation, applied credit, and cash due; credits are capped by actual prepayment and that month's specified obligation.

The user reported **163 passed, 1 failed, 1 warning** before this correction. I attempted the focused Batch 5A tests and full suite after the change using `.venv\Scripts\python.exe`; both stopped before Python started because the configured Python 3.12 executable is missing. `py -3.12 -m pytest -q` also stopped with `No installed Python found!`. The new and existing test results are unverified here; no passing result is claimed.

**Monthly response schema correction (2026-10-24):** The user reported 163 passed, 2 failed, and one warning after the prepaid reconciliation. Both remaining failures came from early-departure months through departure omitting `prepaid_rent_credit_applied`. Every early-departure month now carries the same financial keys. A month with no scenario prepaid credit has `0`; unknown rent cash due, unknown future event cash, and unresolved total housing obligation remain `null`. Through-departure rent cash due comes from the Batch 4A schedule, and the modeled total is shown only when monthly cost terms are complete. The existing $1,000 and $1,600 prepaid-credit assertions remain in place, with added schema and unknown-value regression checks.

After this correction I attempted `\.venv\Scripts\python.exe -m pytest tests/test_rental_stress.py -q` and `\.venv\Scripts\python.exe -m pytest -q`. Both stopped before pytest because the virtual environment points to a missing Python 3.12 executable. `py -3.12 -m pytest -q` also stopped with `No installed Python found!`. No updated test count is available from this environment.

Run from the repository root in the working local environment:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_rental_stress.py tests/test_rental_stress_api.py -q
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m scripts.demo_rental_stress
```

## Limitations and Batch 5B readiness

The API uses hypothetical, user-supplied assumptions, not event probabilities. It does not predict utilities, roommate reliability, landlord action, legal outcomes, mitigation, deposit refunds, or concession clawbacks. Gross household liability remains separate from a renter's modeled share. Early-departure results are intentionally partial when future rent or non-rent obligations are unspecified. The API is backend-ready for a Batch 5B review interface after the full test suite and demo run succeed in a working Python environment; no frontend or next batch has been started.
