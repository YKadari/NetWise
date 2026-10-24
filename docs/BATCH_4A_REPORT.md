# Batch 4A: rental commitment financial engine

## Scope and architecture

Batch 4A adds a deterministic, request-only rental financial calculator. The existing Chicago housing explorer, optimization math, public data, sensitivity, mapping, and area comparison endpoints remain in place. No AI, PDF extraction, external API, account, storage layer, or new dependency was added.

Files added:

- `backend/app/rental/models.py`: strict rental, payment, concession, provenance, and financial-profile models.
- `backend/app/rental/calculations.py`: cent-based lease schedule, upfront cash, total cost, cash flow, warnings, and affordability calculations.
- `backend/app/rental/comparisons.py`: same-profile offer evaluations and factual left-minus-right differences.
- `backend/app/api/rental_schemas.py` and `rental_routes.py`: validated request/response schemas and thin HTTP routes.
- `tests/test_rental_models.py`, `test_rental_calculations.py`, and `test_rental_api.py`.
- `scripts/demo_rental_finances.py`: two hypothetical synthetic offers and their month-by-month outputs.
- This report.

Updated `backend/app/main.py` to register the new router and `README.md` to reflect the rental-commitment product direction. `backend/requirements.txt` and housing datasets were unchanged.

## Input model

`POST /api/rental/evaluate` accepts `{ "offer": ..., "financial_profile": ... }`; the profile may be omitted. `POST /api/rental/compare` accepts `left_offer`, `right_offer`, and one optional shared profile. The full nested schema is published through `/openapi.json` and `/docs`.

The offer includes a label, positive monthly rent, 1–120 month term, optional start date and occupants, named recurring charges, utility responsibility, upfront terms, concessions, and expected roommate contribution. Completeness fields distinguish an empty but confirmed fee list from an unavailable list. For amount terms, `status` distinguishes `provided`, `none`, and `unknown`; unknown amounts remain unavailable in the result.

Utility status is `included_in_rent`, `estimated` with an amount, or `unknown`. Included utilities add no second cost. Unknown utilities are not interpreted as free. Recurring charges likewise have `complete` or `unknown` list status.

Upfront terms cover the refundable security deposit, whether first and last rent are due before occupancy, nonrefundable fees, other refundable or nonrefundable one-time charges, and holding deposits. A holding deposit must explicitly say whether it is credited to security deposit, first rent, last rent, nonrefundable fees, or remains uncredited and refundable/nonrefundable. The engine validates credit targets and prevents over-crediting them.

Concessions identify a lease month and kind: a free-rent month, rent credit, or promotional credit. Credits target base rent by default. A concession that targets a recurring charge must name that charge; utility credits must explicitly name utilities. Credits are capped at the eligible charge, with unused credit reported. They cannot reduce charges below zero.

Every extracted financial term can carry source type, source passage/page reference, confidence, and review state; term provenance is included in evaluation responses. A document-extracted term cannot be marked confirmed without user review; confidence alone never confirms it. User-entered is the default source. The profile accepts monthly take-home income, available savings, essential monthly nonhousing expenses, optional student loan payment, whether that loan is already included in essentials, a savings target, expected roommate contribution, and optional minimum emergency reserve.

## Calculation definitions

All money input is normalized to cents using decimal round-half-up; all arithmetic uses integer cents. The HTTP API emits JSON numbers, while direct Python calculations use `Decimal` monetary outputs.

For each lease month:

```text
net base rent = base rent - free-rent amount - explicitly eligible rent credits
net recurring charges = listed charges - credits explicitly assigned to each named charge
net estimated utilities = estimated utilities - credits explicitly assigned to utilities
known gross housing expense = net base rent + net recurring charges + net estimated utilities
modeled personal housing share = max(0, gross expense - expected roommate contribution)
```

The roommate amount changes the modeled personal share only. Gross household contractual expenses and cash requirements remain visible and are not described as legally limited by roommate contributions. If no contribution is provided, the model uses no offset. A profile contribution overrides an offer-level expected contribution for the personal-share estimate.

The maximum sustainable monthly housing amount is:

```text
take-home income
- essential nonhousing expenses
- separately reported student-loan payment (only if not already included above)
- monthly savings target
```

If no savings target is supplied, the calculation uses $0 and emits a warning. Monthly expense-based cash remaining uses the month’s expense allocation; a separate field reports cash remaining from monthly income after actual scheduled in-term housing payments, so prepaid rent timing is explicit.

Upfront known cash is the known security deposit, rent prepaid for its corresponding lease months, known one-time payments, and holding deposit paid, less valid holding-deposit credits. When a one-month lease marks both first and last month prepaid, that month is counted once. Unknown upfront terms are listed and the upfront amount is labeled incomplete; the displayed amount is only its known subtotal.

Prepaid rent is assigned to its lease month. It appears in `rent_prepayment_allocated`, is removed from that month’s later rent cash due, and is included once in total modeled lease rent. If first/last payment timing is unknown, the affected cash-flow rent due is `null`, the month is listed in `unknown_rent_payment_timing_months`, and no timing assumption is silently made. A refundable security deposit is upfront cash held, not a lease expense. Nonrefundable fees are expenses. Known total cash outflows equal known nonrefundable lease expense plus refundable amounts held; potential refunds are displayed separately and are never guaranteed or subtracted from costs.

Unknown recurring charges, unknown utilities, and unknown upfront fields do not silently become favorable values. Known totals are labeled incomplete lower bounds and warnings identify missing categories. Affordability is `exceeds_budget` when a known monthly personal share exceeds the available monthly amount, `unknown` when known costs fit but monthly terms are incomplete, or `within_budget` when reported monthly costs are complete and fit.

## Comparison method

Both offers are evaluated with the same provided financial profile and calculation rules. The response includes base rent, known gross monthly obligation before concessions, average modeled monthly obligation after concessions, upfront cash, known nonrefundable lease expense, refundable cash held, monthly cash remaining, initial savings remaining, and normalized known monthly lease expense differences, all as left minus right. Unknown cost categories are returned for each offer. Unequal lease lengths are flagged: full-period totals cover different durations, so the normalized monthly comparison is also shown. No overall risk or safety score or universal winner is produced.

## API examples

Evaluate an offer with unknown utilities clearly represented:

```json
{
  "offer": {
    "rental_label": "Offer A",
    "monthly_base_rent": 1500,
    "lease_term_months": 12,
    "recurring_charges": [{"name": "Parking", "monthly_amount": 100, "source_description": "Lease fee schedule"}],
    "recurring_charges_status": "complete",
    "utilities": {"status": "unknown"},
    "upfront": {
      "security_deposit": {"status": "provided", "amount": 900},
      "first_month_rent_due_upfront": "yes",
      "last_month_rent_due_upfront": "no",
      "nonrefundable_fees": [{"name": "Application", "amount": 50}],
      "nonrefundable_fees_status": "complete",
      "other_charges_status": "complete",
      "holding_deposit_status": "none"
    }
  },
  "financial_profile": {
    "monthly_take_home_income": 4200,
    "available_savings": 7000,
    "essential_monthly_nonhousing_expenses": 1600,
    "student_loan_payment": 250,
    "student_loan_included_in_essential_expenses": false,
    "monthly_savings_target": 400,
    "minimum_emergency_cash_reserve": 2000
  }
}
```

Compare requests use the same fields:

```json
{
  "left_offer": {"rental_label": "Offer A", "monthly_base_rent": 1500, "lease_term_months": 12},
  "right_offer": {"rental_label": "Offer B", "monthly_base_rent": 1600, "lease_term_months": 18},
  "financial_profile": {
    "monthly_take_home_income": 4200,
    "available_savings": 7000,
    "essential_monthly_nonhousing_expenses": 1600
  }
}
```

Malformed, nonfinite, negative, wrongly typed, or extra nested fields receive HTTP 422. The shared validation handler omits raw submitted values, so financial amounts and labels are not echoed in errors. Routes do not log or persist request bodies.

Run locally from the project root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
.\.venv\Scripts\python.exe -m scripts.demo_rental_finances
.\.venv\Scripts\python.exe -m pytest -q
```

## Hypothetical demo results

The demo scenarios are synthetic calculation fixtures, not verified listings. Both use the same profile: $4,500 monthly take-home, $1,800 essential nonhousing expenses, $300 separate student loan, $500 monthly savings target, $8,000 available savings, and a $2,000 emergency reserve. The profile leaves $1,900/month for housing and other savings goals under the stated formula.

| Measure | A: $1,450 base rent, more fees | B: $1,600 base rent, fewer fees |
|---|---:|---:|
| Recurring monthly charges | $200 | $40 |
| Estimated utilities | $180 | $130 |
| Gross known monthly housing obligation | $1,830 | $1,770 |
| Move-in cash before occupancy | $5,300 | $2,500 |
| Known nonrefundable lease expense | $22,360 | $21,340 |
| Total cash outflows including held refundable amounts | $24,360 | $22,140 |
| Refundable cash held | $2,000 | $800 |
| Initial savings after known move-in cash | $2,700 | $5,500 |
| Emergency reserve preserved | Yes | Yes |
| Monthly cash after expenses and savings target | $70 | $130 |

Scenario A prepays months 1 and 12 rent. Its schedule shows $0 rent cash due in those months, $1,450 due in months 2–11, and $380 monthly nonrent cash due in all 12 months. Expense-based cash remaining is $70 every month; actual monthly income cash remaining after scheduled housing payments is $1,520 in prepaid months and $70 in the others. Its move-in $5,300 contains $2,000 security deposit, $2,900 prepaid rent, $400 nonrefundable fee, and $300 holding deposit credited to security. The prepaid rent is included in modeled rent exactly once. Scenario B prepays month 1 only: $0 rent due in month 1, $1,600 in months 2–12, and $170 monthly nonrent cash due throughout. Its actual cash remaining after scheduled payments is $1,730 in month 1 and $130 in the others.

The factual A-minus-B differences are: base rent **−$150/month**, known gross monthly housing cost **+$60/month**, upfront cash **+$2,800**, nonrefundable lease expense **+$1,020**, refundable cash held **+$1,200**, monthly cash remaining **−$60**, and initial savings remaining **−$2,800**. The calculator does not declare either scenario safer.

## Tests and verification

Baseline before implementation: **77 backend tests passed**, with one existing Starlette/TestClient deprecation warning.

The new synthetic tests cover cents rounding, invalid inputs, unknown versus no-charge terms, extracted-term review state, charge and utility validation, rent and fee totals, included/unknown utilities, prepaid first/last rent, one-month double-count prevention, security deposits, refundable and nonrefundable charges, holding-deposit credit, free-rent months, eligible-category credits and unused over-credit, monthly cash flow, student-loan deduplication, savings goals, emergency reserve, roommate shares versus gross liability, equal/unequal term comparison, deterministic output, API schema validation, sanitized 422 responses, and both API routes.

Final full suite: **115 passed, 1 existing Starlette/TestClient deprecation warning**. Before implementation, the baseline was **77 passed** with the same warning. The 38 new Batch 4A tests cover strict model validation, cents rounding, unknown/no-charge distinction, extracted-term review, recurring fees, utility states, prepaid rent and one-month overlap, holding deposits, refundable versus nonrefundable amounts, concessions including over-credit, calendar-month labeling, unknown payment timing, month cash-flow reconciliation, affordability, debt deduplication, savings and reserve behavior, roommate shares, equal/unequal term comparison, deterministic results, sanitized API errors, and both new routes. Regression tests also exercise `GET /api/health`, `POST /api/optimize`, and all three existing geographic endpoints. The optimizer still returns 38 eligible areas for the $1,900 one-bedroom profile; housing polygons, rail stations, and representative-point endpoints return 64, 143, and 64 features.

A fresh Uvicorn process on temporary localhost port 8001 returned HTTP 200 for health, optimization, all three geographic endpoints, and both new rental endpoints. The synthetic two-month evaluation returned $1,300 upfront, $2,000 lease expense, and allocated the first $1,000 rent payment exactly once (`$0` later rent due in month 1). The live comparison returned a −$100 base-rent difference and $0 upfront difference. That temporary server was stopped after the smoke test. The pre-existing process on port 8000 was an older app instance and returned 404 for the new routes; restart the local backend to load Batch 4A there.

The hypothetical demo ran successfully. Scenario A reports $5,300 upfront, $22,360 known modeled nonrefundable lease expense, $24,360 known outflows including held refundable cash, $2,700 savings remaining, and $70 monthly cash after housing and the savings target. Scenario B reports $2,500 upfront, $21,340 expense, $22,140 outflows, $5,500 savings remaining, and $130 monthly remaining. Scenario A’s months 1 and 12 show $0 in-month rent cash due because $2,900 rent was prepaid and allocated to those months; months 2–11 show $1,450 rent due. Scenario B’s month 1 is prepaid; months 2–12 show $1,600 rent due. Adding upfront cash and scheduled in-lease cash payments reconciles to each reported total cash outflow; refundable deposits remain outside lease expense.

## Limitations and Batch 4B readiness

The engine models only supplied terms and gives known subtotals when data is incomplete. It does not estimate typical utilities, taxes, renter insurance, deposits, concessions, rent increases, late fees, lease termination penalties, or roommate reliability. A listed estimate remains an estimate. Payment timing is simplified to move-in for explicitly prepaid rent, deposits, listed one-time charges, and holding deposits; ordinary recurring charges are allocated to each lease month. Monthly cash remaining follows the supplied budget inputs and does not model pay dates or intra-month liquidity beyond upfront cash. No legal enforceability or risk opinion is produced.

Batch 4B can add a document extraction and review flow by populating the provenance fields. Extracted values should remain marked for review until a user confirms or corrects them. This batch adds no extraction provider, file upload, storage, or Gemini integration.
