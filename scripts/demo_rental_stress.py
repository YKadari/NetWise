"""Run three independent synthetic rental stress scenarios (no provider/API calls)."""
from __future__ import annotations

import json

from backend.app.rental.stress_engine import stress_test_rental


OFFER = {
    "rental_label": "Synthetic Stress-Test Lease",
    "monthly_base_rent": 1600,
    "lease_term_months": 12,
    "recurring_charges": [{"name": "Internet", "monthly_amount": 40}],
    "recurring_charges_status": "complete",
    "utilities": {"status": "estimated", "estimated_monthly_amount": 130},
    "expected_roommate_contribution": {"status": "provided", "amount": 800},
    "upfront": {
        "security_deposit": {"status": "provided", "amount": 800},
        "first_month_rent_due_upfront": "yes",
        "last_month_rent_due_upfront": "no",
        "nonrefundable_fees_status": "complete",
        "other_charges_status": "complete",
        "holding_deposit_status": "none",
    },
}
PROFILE = {
    "monthly_take_home_income": 4500,
    "available_savings": 8000,
    "essential_monthly_nonhousing_expenses": 1800,
    "student_loan_payment": 300,
    "student_loan_included_in_essential_expenses": False,
    "monthly_savings_target": 500,
    "minimum_emergency_cash_reserve": 2000,
}
SCENARIOS = [
    {"type": "utility_increase", "additional_monthly_amount": 100, "first_affected_month": 4, "last_affected_month": 12},
    {"type": "roommate_contribution_loss", "monthly_contribution_lost": 800, "first_affected_month": 5, "last_affected_month": 7},
    {"type": "early_departure", "departure_month": 8, "treatment": "hypothetical_settlement", "termination_fee": 2000,
     "assumption_note": "Synthetic fee assumption only; future rent remains unresolved."},
    {"type": "early_departure", "departure_month": 8, "treatment": "continuing_lease_obligations",
     "remaining_rent_treatment": "specified", "continuing_rent_monthly_amount": 1600, "continuing_rent_months": 4,
     "assumption_note": "Separate alternative: user explicitly specifies four remaining rent payments."},
]


def main() -> None:
    results = [stress_test_rental(OFFER, PROFILE, scenario) for scenario in SCENARIOS]
    for result in results:
        print(result["scenario_type"], result["assumptions"])
        print("  known cost impact:", result["summary"].get("total_additional_personal_cash_burden", result["summary"].get("known_departure_cash_impact")))
        print("  unknown categories:", result["summary"]["unknown_cost_categories"])
    print("  utility additional gross cost:", results[0]["summary"]["total_additional_gross_household_cost"])
    print("  roommate personal burden increase:", results[1]["summary"]["total_additional_personal_cash_burden"])
    print("  hypothetical termination fee (no inferred remaining rent):", results[2]["stressed"]["termination_fee"])
    print("  alternative explicit continuing rent:", results[3]["stressed"]["specified_remaining_rent"])
    json.dumps(results, default=str, allow_nan=False)


if __name__ == "__main__":
    main()
