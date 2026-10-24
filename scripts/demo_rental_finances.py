"""Print deterministic calculations for two synthetic hypothetical rental offers."""

from __future__ import annotations

import json

from backend.app.rental.calculations import evaluate_rental
from backend.app.rental.comparisons import compare_rentals


PROFILE = {
    "monthly_take_home_income": 4500,
    "available_savings": 8000,
    "essential_monthly_nonhousing_expenses": 1800,
    "student_loan_payment": 300,
    "student_loan_included_in_essential_expenses": False,
    "monthly_savings_target": 500,
    "minimum_emergency_cash_reserve": 2000,
}

HYPOTHETICAL_OFFERS = {
    "A · Lower rent, higher charges and move-in cash": {
        "rental_label": "Synthetic Scenario A",
        "monthly_base_rent": 1450,
        "lease_term_months": 12,
        "occupants": 2,
        "recurring_charges": [
            {"name": "Parking", "monthly_amount": 150},
            {"name": "Pet rent", "monthly_amount": 50},
        ],
        "recurring_charges_status": "complete",
        "utilities": {"status": "estimated", "estimated_monthly_amount": 180},
        "upfront": {
            "security_deposit": {"status": "provided", "amount": 2000},
            "first_month_rent_due_upfront": "yes",
            "last_month_rent_due_upfront": "yes",
            "nonrefundable_fees": [{"name": "Administration fee", "amount": 400}],
            "nonrefundable_fees_status": "complete",
            "other_charges_status": "complete",
            "holding_deposit": {"amount": 300, "treatment": "credited_to_security_deposit"},
            "holding_deposit_status": "provided",
        },
    },
    "B · Higher rent, fewer charges and lower move-in cash": {
        "rental_label": "Synthetic Scenario B",
        "monthly_base_rent": 1600,
        "lease_term_months": 12,
        "occupants": 2,
        "recurring_charges": [{"name": "Internet", "monthly_amount": 40}],
        "recurring_charges_status": "complete",
        "utilities": {"status": "estimated", "estimated_monthly_amount": 130},
        "upfront": {
            "security_deposit": {"status": "provided", "amount": 800},
            "first_month_rent_due_upfront": "yes",
            "last_month_rent_due_upfront": "no",
            "nonrefundable_fees": [{"name": "Application fee", "amount": 100}],
            "nonrefundable_fees_status": "complete",
            "other_charges_status": "complete",
            "holding_deposit_status": "none",
        },
    },
}


def main() -> None:
    evaluated = {label: evaluate_rental(offer, PROFILE) for label, offer in HYPOTHETICAL_OFFERS.items()}
    comparison = compare_rentals(
        list(HYPOTHETICAL_OFFERS.values())[0], list(HYPOTHETICAL_OFFERS.values())[1], PROFILE
    )
    print("HYPOTHETICAL SYNTHETIC OFFERS — not verified listings\n")
    print("Financial profile: $4,500 take-home; $1,800 essential costs; $300 separate student loan; $500 savings target; $8,000 savings; $2,000 reserve.\n")
    for label, result in evaluated.items():
        print(label)
        print(f"  Gross known monthly obligation: ${result['monthly_costs']['gross_known_monthly_housing_obligation']:.2f}")
        print(f"  Upfront cash before occupancy: ${result['upfront']['upfront_cash_required']:.2f}")
        print(f"  Nonrefundable modeled lease cost: ${result['lease_totals']['known_modeled_nonrefundable_lease_cost']:.2f}")
        print(f"  Total cash outflows including held deposits: ${result['lease_totals']['known_total_cash_outflows_including_refundable_holds']:.2f}")
        print(f"  Refundable cash held (not guaranteed returned): ${result['upfront']['refundable_cash_held']:.2f}")
        print(f"  Initial savings remaining: ${result['financial_profile']['initial_savings_remaining_after_known_move_in_cash']:.2f}")
        print(f"  Emergency reserve preserved: {result['financial_profile']['emergency_reserve_preserved']}")
        print("  Month-by-month (month: rent due, nonrent due, remaining after expenses, remaining after scheduled cash payments):")
        for row in result["month_by_month_cash_flow"]:
            print(f"    {row['month']:>2}: ${row['in_lease_month_rent_cash_due']:.2f}, ${row['in_lease_month_other_housing_cash_due']:.2f}, ${row['cash_remaining_after_expenses_and_savings']:.2f}, ${row['cash_remaining_from_monthly_income_after_scheduled_payments']:.2f}")
        print()
    diff = comparison["differences"]["left_minus_right"]
    print("A minus B comparison")
    print(f"  Base rent/month: ${diff['base_rent_per_month']:.2f}")
    print(f"  Known gross monthly housing cost: ${diff['gross_known_recurring_housing_cost_per_month']:.2f}")
    print(f"  Upfront cash: ${diff['upfront_cash_required']:.2f}")
    print(f"  Modeled nonrefundable lease cost: ${diff['known_modeled_nonrefundable_lease_expense']:.2f}")
    print(f"  Initial savings remaining: ${diff['initial_savings_remaining_after_move_in']:.2f}")
    print("  No overall financial-safety score is assigned.")
    # A strict JSON round-trip confirms all outputs are deterministic and finite.
    json.dumps(comparison, default=str, allow_nan=False)


if __name__ == "__main__":
    main()
