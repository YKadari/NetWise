"""Side-by-side comparison using identical financial assumptions."""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from .calculations import evaluate_rental
from .models import FinancialProfile, RentalOffer


def compare_rentals(
    left_offer: RentalOffer | dict[str, Any],
    right_offer: RentalOffer | dict[str, Any],
    profile: FinancialProfile | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Evaluate two offers and report measured differences without ranking them."""
    left_model = left_offer if isinstance(left_offer, RentalOffer) else RentalOffer.model_validate(left_offer)
    right_model = right_offer if isinstance(right_offer, RentalOffer) else RentalOffer.model_validate(right_offer)
    left = evaluate_rental(left_model, profile)
    right = evaluate_rental(right_model, profile)
    left_month = left["monthly_costs"]
    right_month = right["monthly_costs"]
    left_totals = left["lease_totals"]
    right_totals = right["lease_totals"]
    left_upfront = left["upfront"]
    right_upfront = right["upfront"]
    left_finances = left["financial_profile"]
    right_finances = right["financial_profile"]
    l_month_total = left_month["gross_known_monthly_housing_obligation"]
    r_month_total = right_month["gross_known_monthly_housing_obligation"]
    differences = {
        "left_minus_right": {
            "base_rent_per_month": left_model.monthly_base_rent - right_model.monthly_base_rent,
            "gross_known_recurring_housing_cost_per_month": l_month_total - r_month_total,
            "average_modeled_monthly_housing_cost_after_concessions": left_month["average_modeled_housing_obligation"] - right_month["average_modeled_housing_obligation"],
            "upfront_cash_required": left_upfront["upfront_cash_required"] - right_upfront["upfront_cash_required"],
            "known_modeled_nonrefundable_lease_expense": left_totals["known_modeled_nonrefundable_lease_cost"] - right_totals["known_modeled_nonrefundable_lease_cost"],
            "refundable_cash_held": left_upfront["refundable_cash_held"] - right_upfront["refundable_cash_held"],
            "monthly_cash_remaining_after_housing_and_savings": None if left_finances is None else (
                left_finances["known_monthly_cash_remaining_after_housing_and_savings"] -
                right_finances["known_monthly_cash_remaining_after_housing_and_savings"]
            ),
            "initial_savings_remaining_after_move_in": None if left_finances is None else (
                left_finances["initial_savings_remaining_after_known_move_in_cash"] -
                right_finances["initial_savings_remaining_after_known_move_in_cash"]
            ),
            "normalized_known_lease_expense_per_month": (
                (left_totals["known_modeled_nonrefundable_lease_cost"] / left_model.lease_term_months).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                - (right_totals["known_modeled_nonrefundable_lease_cost"] / right_model.lease_term_months).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            ),
        },
        "lease_terms_differ": left_model.lease_term_months != right_model.lease_term_months,
        "total_period_costs_directly_comparable": left_model.lease_term_months == right_model.lease_term_months,
        "unknown_cost_categories": {
            "left": left["unknown_cost_categories"],
            "right": right["unknown_cost_categories"],
        },
    }
    notes = []
    if differences["lease_terms_differ"]:
        notes.append("Lease durations differ. Total modeled spending covers different contractual periods; compare the normalized monthly figures as well.")
    if left["unknown_cost_categories"] or right["unknown_cost_categories"]:
        notes.append("One or both offers contain unknown cost categories. Reported totals are known subtotals, not complete price estimates.")
    if left_upfront["refundable_cash_held"] or right_upfront["refundable_cash_held"]:
        notes.append("Refundable deposits or other refundable upfront amounts affect move-in cash but are not treated as lease expenses; any refund is uncertain.")
    return {
        "left": left,
        "right": right,
        "differences": differences,
        "comparison_notes": notes,
        "method": "Both offers use the same profile, cent-based calculations, timing rules, and known-cost definitions; no overall financial-safety score is computed.",
    }
