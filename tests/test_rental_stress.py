from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from backend.app.rental.stress_engine import stress_test_rental
from backend.app.rental.stress_models import EarlyDeparture, RoommateContributionLoss, UtilityIncrease
from backend.app.rental.models import TermProvenance
from tests.test_rental_models import complete_offer


def profile(**changes):
    values = {
        "monthly_take_home_income": 4000,
        "available_savings": 6000,
        "essential_monthly_nonhousing_expenses": 1500,
        "student_loan_payment": 0,
        "student_loan_included_in_essential_expenses": False,
        "monthly_savings_target": 300,
        "minimum_emergency_cash_reserve": 1000,
    }
    values.update(changes)
    return values


def complete_twelve_month_offer(**changes):
    values = {"lease_term_months": 12, "utilities": {"status": "estimated", "estimated_monthly_amount": 130}}
    values.update(changes)
    return complete_offer(**values)


def test_utility_increase_nine_months_reconciles_to_900_and_reduces_cash_remaining():
    result = stress_test_rental(complete_twelve_month_offer(), profile(), UtilityIncrease(
        type="utility_increase", additional_monthly_amount=100, first_affected_month=4, last_affected_month=12,
    ))
    assert result["summary"]["total_additional_gross_household_cost"] == 900
    assert result["summary"]["total_additional_personal_cash_burden"] == 900
    rows = result["stressed"]["month_by_month"]
    assert sum(row["additional_gross_household_cost"] for row in rows) == 900
    assert rows[3]["stressed_cash_remaining_after_expenses_and_savings"] == rows[3]["baseline_cash_remaining_after_expenses_and_savings"] - 100
    assert sum(row["additional_gross_household_cost"] for row in rows if not row["affected"]) == 0


def test_utility_increase_is_additive_with_concessions_and_does_not_rewrite_baseline():
    offer = complete_twelve_month_offer(concessions=[{"kind": "rent_credit", "month": 4, "amount": 400, "eligible_category": "utilities"}])
    baseline = stress_test_rental(offer, None, UtilityIncrease(type="utility_increase", additional_monthly_amount=50, first_affected_month=4, last_affected_month=4))["baseline"]
    result = stress_test_rental(offer, None, UtilityIncrease(type="utility_increase", additional_monthly_amount=50, first_affected_month=4, last_affected_month=4))
    assert result["summary"]["total_additional_gross_household_cost"] == 50
    assert result["baseline"]["month_by_month_cash_flow"][3]["estimated_utilities_after_concessions"] == baseline["month_by_month_cash_flow"][3]["estimated_utilities_after_concessions"]


def test_utility_scenario_flags_included_and_unknown_baselines_without_reinterpreting_offer():
    included = complete_twelve_month_offer(utilities={"status": "included_in_rent"})
    result = stress_test_rental(included, None, UtilityIncrease(type="utility_increase", additional_monthly_amount=75, first_affected_month=1, last_affected_month=2))
    assert result["summary"]["total_additional_gross_household_cost"] == 150
    assert "utility_increase_overrides_included_terms" in {item["code"] for item in result["warnings"]}
    assert result["baseline"]["lease"]["term_months"] == 12
    unknown = complete_twelve_month_offer(utilities={"status": "unknown"})
    partial = stress_test_rental(unknown, None, UtilityIncrease(type="utility_increase", additional_monthly_amount=20, first_affected_month=1, last_affected_month=1))
    assert "utilities" in partial["summary"]["unknown_cost_categories"]
    assert partial["summary"]["cost_result_complete"] is False
    assert partial["summary"]["total_additional_gross_household_cost"] == 20


def test_roommate_loss_changes_personal_burden_but_keeps_gross_unchanged():
    offer = complete_twelve_month_offer(expected_roommate_contribution={"status": "provided", "amount": 800})
    result = stress_test_rental(offer, profile(), RoommateContributionLoss(
        type="roommate_contribution_loss", monthly_contribution_lost=800, first_affected_month=5, last_affected_month=7,
    ))
    rows = result["stressed"]["month_by_month"]
    assert result["summary"]["total_additional_personal_cash_burden"] == 2400
    assert result["summary"]["total_additional_gross_household_cost"] == 0
    assert all(row["baseline_gross_household_obligation"] == row["stressed_gross_household_obligation"] for row in rows)
    assert all(row["additional_personal_cash_burden"] == 800 for row in rows[4:7])


def test_partial_roommate_loss_and_profile_override_use_effective_expected_contribution():
    offer = complete_twelve_month_offer(expected_roommate_contribution={"status": "provided", "amount": 800})
    result = stress_test_rental(offer, profile(expected_roommate_contribution=600), RoommateContributionLoss(
        type="roommate_contribution_loss", monthly_contribution_lost=250, first_affected_month=2, last_affected_month=2,
    ))
    assert result["summary"]["total_additional_personal_cash_burden"] == 250
    assert result["assumptions"]["baseline_expected_monthly_contribution"] == 600


@pytest.mark.parametrize("offer,loss", [
    (complete_twelve_month_offer(), 100),
    (complete_twelve_month_offer(expected_roommate_contribution={"status": "provided", "amount": 50}), 51),
])
def test_roommate_loss_rejects_phantom_or_excessive_contribution(offer, loss):
    scenario = RoommateContributionLoss(type="roommate_contribution_loss", monthly_contribution_lost=loss, first_affected_month=1, last_affected_month=1)
    with pytest.raises(ValueError):
        stress_test_rental(offer, profile(), scenario)


def test_no_profile_returns_cost_impact_without_inventing_resilience():
    result = stress_test_rental(complete_twelve_month_offer(), None, UtilityIncrease(
        type="utility_increase", additional_monthly_amount=10, first_affected_month=1, last_affected_month=1,
    ))
    summary = result["summary"]["stressed"]
    assert summary["available_monthly_housing_budget"] is None
    assert summary["savings_trajectory"] is None
    assert result["summary"]["total_additional_personal_cash_burden"] == 10


@pytest.mark.parametrize("unknown_terms", [
    {"utilities": {"status": "unknown"}},
    {"recurring_charges_status": "unknown"},
])
def test_unknown_monthly_costs_make_savings_trajectory_an_upper_bound(unknown_terms):
    offer = complete_twelve_month_offer(**unknown_terms)
    result = stress_test_rental(offer, profile(), UtilityIncrease(type="utility_increase", additional_monthly_amount=25, first_affected_month=1, last_affected_month=1))
    trajectory = result["summary"]["stressed"]["savings_trajectory"]
    assert trajectory[0]["status"] == "known_costs_only_upper_bound"
    assert result["summary"]["stressed"]["savings_trajectory_complete"] is False
    assert result["summary"]["stressed"]["personal_housing_burden_complete"] is False
    assert result["summary"]["stressed"]["cash_shortfall_result_complete"] is False


def test_unknown_monthly_rent_cash_timing_keeps_known_subtotals_but_marks_projection_incomplete():
    offer = complete_twelve_month_offer(upfront={
        "first_month_rent_due_upfront": "unknown",
        "last_month_rent_due_upfront": "no",
        "nonrefundable_fees_status": "complete",
        "other_charges_status": "complete",
        "holding_deposit_status": "none",
    })
    result = stress_test_rental(offer, profile(), UtilityIncrease(
        type="utility_increase", additional_monthly_amount=25, first_affected_month=1, last_affected_month=1,
    ))
    resilience = result["summary"]["stressed"]
    assert resilience["monthly_cash_remaining"][0] is not None
    assert resilience["cash_shortfall_result_complete"] is False
    assert resilience["savings_trajectory_complete"] is False
    assert resilience["savings_trajectory"][1]["ending_savings"] is None


def test_early_departure_fee_does_not_auto_add_remaining_rent_or_claim_it_is_resolved():
    offer = complete_twelve_month_offer()
    result = stress_test_rental(offer, profile(), EarlyDeparture(
        type="early_departure", departure_month=8, treatment="hypothetical_settlement",
        termination_fee=2000, assumption_note="Synthetic example: hypothetical fee only.",
    ))
    assert result["stressed"]["termination_fee"] == 2000
    assert result["stressed"]["specified_remaining_rent"] == 0
    assert result["summary"]["uncovered_future_months"] == 4
    assert "remaining_rent_obligation" in result["summary"]["unknown_cost_categories"]
    assert all(row["stressed_total_housing_obligation"] is None for row in result["stressed"]["month_by_month"][8:])
    assert all(row["stressed_rent_cash_due"] is None for row in result["stressed"]["month_by_month"][8:])
    assert all(row["stressed_departure_event_cash_flow"] is None for row in result["stressed"]["month_by_month"][8:])


def test_early_departure_continuing_rent_is_explicit_and_not_combined_with_fee():
    scenario = EarlyDeparture(type="early_departure", departure_month=8, treatment="continuing_lease_obligations",
                              remaining_rent_treatment="specified", continuing_rent_monthly_amount=1500,
                              continuing_rent_months=4, assumption_note="User-specified hypothetical remaining rent.")
    result = stress_test_rental(complete_twelve_month_offer(), profile(), scenario)
    assert result["stressed"]["termination_fee"] == 0
    assert result["stressed"]["specified_remaining_rent"] == 6000
    assert result["stressed"]["month_by_month"][8]["stressed_known_rent_obligation"] == 1500
    assert result["summary"]["uncovered_future_months"] == 0


def test_explicit_no_remaining_rent_requires_user_selected_treatment_and_is_not_inferred():
    scenario = EarlyDeparture(type="early_departure", departure_month=8, treatment="hypothetical_settlement",
                              termination_fee=2000, assumption_note="Synthetic agreed settlement and no later rent.",
                              remaining_rent_treatment="none_confirmed")
    result = stress_test_rental(complete_twelve_month_offer(), None, scenario)
    assert result["summary"]["uncovered_future_months"] == 0
    assert "remaining_rent_obligation" not in result["summary"]["unknown_cost_categories"]


def test_known_contract_fee_requires_reviewed_source_provenance():
    with pytest.raises(ValidationError):
        EarlyDeparture(type="early_departure", departure_month=8, treatment="known_contractual_termination",
                       termination_fee=2000, termination_fee_source="Lease paragraph 12")
    scenario = EarlyDeparture(type="early_departure", departure_month=8, treatment="known_contractual_termination",
                              termination_fee=2000, termination_fee_source="Lease paragraph 12",
                              termination_fee_provenance=TermProvenance(source_type="document_extracted",
                                                                         source_reference="Lease paragraph 12",
                                                                         review_state="confirmed", reviewed_by_user=True))
    result = stress_test_rental(complete_twelve_month_offer(), None, scenario)
    assert result["stressed"]["termination_fee"] == 2000
    assert "remaining_rent_obligation" in result["summary"]["unknown_cost_categories"]
    assert result["assumptions"]["termination_fee_source_provided"] is True
    encoded = json.dumps(result, default=str)
    assert "Lease paragraph 12" not in encoded
    assert '"source_reference":' not in encoded


def test_explicit_departure_charge_and_withheld_deposit_are_separate_cash_effects():
    scenario = EarlyDeparture(type="early_departure", departure_month=8, treatment="hypothetical_settlement",
                              termination_fee=2000, assumption_note="Synthetic assumption.",
                              other_departure_charges=[{"name": "Moving fee", "amount": 300}],
                              deposit_treatment="withheld", deposit_treatment_note="Assume full withholding.")
    result = stress_test_rental(complete_twelve_month_offer(upfront={
        "security_deposit": {"status": "provided", "amount": 700},
        "first_month_rent_due_upfront": "no", "last_month_rent_due_upfront": "no",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete", "holding_deposit_status": "none",
    }), profile(), scenario)
    assert result["stressed"]["termination_fee"] == 2000
    assert result["stressed"]["other_departure_charges"] == 300
    assert result["stressed"]["deposit_cash_effect"] == 700
    assert result["stressed"]["known_departure_cash_impact"] == 3000


def test_cash_shortfalls_and_emergency_reserve_are_reported_without_target_double_count():
    scenario = UtilityIncrease(type="utility_increase", additional_monthly_amount=100,
                               first_affected_month=1, last_affected_month=2)
    result = stress_test_rental(complete_twelve_month_offer(), profile(
        monthly_take_home_income=1500, essential_monthly_nonhousing_expenses=1000,
        available_savings=1000, monthly_savings_target=100, minimum_emergency_cash_reserve=100,
    ), scenario)
    stressed = result["summary"]["stressed"]
    assert stressed["months_with_modeled_cash_shortfall"] >= 2
    assert stressed["first_month_with_modeled_cash_shortfall"] == 1
    assert stressed["emergency_reserve_breached"] is True
    assert "planned savings target is not subtracted again" in stressed["savings_accounting"]


def test_early_departure_deposit_and_prepaid_last_month_are_explicit_and_counted_once():
    offer = complete_twelve_month_offer(upfront={
        "security_deposit": {"status": "provided", "amount": 700},
        "first_month_rent_due_upfront": "no", "last_month_rent_due_upfront": "yes",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete", "holding_deposit_status": "none",
    })
    scenario = EarlyDeparture(type="early_departure", departure_month=8, treatment="hypothetical_settlement",
                              termination_fee=2000, assumption_note="Synthetic.", remaining_rent_treatment="none_confirmed",
                              deposit_treatment="refunded", deposit_treatment_note="Assume full refund.",
                              prepaid_rent_treatment="refunded")
    result = stress_test_rental(offer, profile(), scenario)
    assert result["stressed"]["prepaid_rent_refund_assumed"] == 1000
    assert result["stressed"]["deposit_cash_effect"] == -700
    assert result["stressed"]["known_departure_cash_impact"] == 300


def test_continuing_rent_does_not_charge_prepaid_last_month_twice():
    offer = complete_twelve_month_offer(monthly_base_rent=1000, upfront={
        "security_deposit": {"status": "none"},
        "first_month_rent_due_upfront": "no", "last_month_rent_due_upfront": "yes",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete", "holding_deposit_status": "none",
    })
    scenario = EarlyDeparture(type="early_departure", departure_month=8, treatment="continuing_lease_obligations",
                              remaining_rent_treatment="specified", continuing_rent_monthly_amount=1600,
                              continuing_rent_months=4, assumption_note="Explicit four-month rent assumption.",
                              prepaid_rent_treatment="retained")
    result = stress_test_rental(offer, profile(), scenario)
    assert result["summary"]["specified_remaining_rent_obligation"] == 6400
    assert result["stressed"]["prepaid_rent_credit_applied"] == 1000
    assert result["stressed"]["continuing_rent_cash_due_after_prepaid_credit"] == 5400
    assert result["stressed"]["month_by_month"][11]["prepaid_rent_credit_applied"] == 1000
    assert result["stressed"]["month_by_month"][11]["stressed_rent_cash_due"] == 600
    assert all(set(row) == set(result["stressed"]["month_by_month"][0]) for row in result["stressed"]["month_by_month"])
    assert all(row["prepaid_rent_credit_applied"] == 0 for row in result["stressed"]["month_by_month"][:11])
    assert sum(row["prepaid_rent_credit_applied"] or 0 for row in result["stressed"]["month_by_month"]) == 1000


def test_prepaid_rent_equal_to_continuing_rent_is_credited_once():
    offer = complete_twelve_month_offer(monthly_base_rent=1600, upfront={
        "security_deposit": {"status": "none"},
        "first_month_rent_due_upfront": "no", "last_month_rent_due_upfront": "yes",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete", "holding_deposit_status": "none",
    })
    scenario = EarlyDeparture(type="early_departure", departure_month=8, treatment="continuing_lease_obligations",
                              remaining_rent_treatment="specified", continuing_rent_monthly_amount=1600,
                              continuing_rent_months=4, assumption_note="Explicit four-month rent assumption.",
                              prepaid_rent_treatment="retained")
    result = stress_test_rental(offer, profile(), scenario)
    assert result["summary"]["specified_remaining_rent_obligation"] == 6400
    assert result["summary"]["prepaid_rent_credit_applied"] == 1600
    assert result["stressed"]["continuing_rent_cash_due_after_prepaid_credit"] == 4800
    assert result["stressed"]["month_by_month"][11]["prepaid_rent_credit_applied"] == 1600
    assert result["stressed"]["month_by_month"][11]["stressed_rent_cash_due"] == 0
    assert sum(row["prepaid_rent_credit_applied"] or 0 for row in result["stressed"]["month_by_month"]) == 1600


def test_early_departure_monthly_schema_preserves_unknown_cash_amounts():
    offer = complete_twelve_month_offer(utilities={"status": "unknown"}, upfront={
        "security_deposit": {"status": "none"},
        "first_month_rent_due_upfront": "unknown", "last_month_rent_due_upfront": "no",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete", "holding_deposit_status": "none",
    })
    scenario = EarlyDeparture(type="early_departure", departure_month=8, treatment="unknown_consequences")
    rows = stress_test_rental(offer, None, scenario)["stressed"]["month_by_month"]
    assert all(set(row) == set(rows[0]) for row in rows)
    assert rows[0]["prepaid_rent_credit_applied"] == 0
    assert rows[0]["stressed_rent_cash_due"] is None
    assert rows[0]["stressed_total_housing_obligation"] is None
    assert rows[8]["prepaid_rent_credit_applied"] == 0
    assert rows[8]["stressed_rent_cash_due"] is None
    assert rows[8]["stressed_departure_event_cash_flow"] is None


@pytest.mark.parametrize("data", [
    {"type": "utility_increase", "additional_monthly_amount": -1, "first_affected_month": 1, "last_affected_month": 2},
    {"type": "utility_increase", "additional_monthly_amount": 10, "first_affected_month": 3, "last_affected_month": 2},
    {"type": "unknown", "first_affected_month": 1, "last_affected_month": 2},
])
def test_invalid_scenarios_are_rejected(data):
    with pytest.raises(ValidationError):
        from backend.app.rental.stress_models import StressScenario
        from pydantic import TypeAdapter
        TypeAdapter(StressScenario).validate_python(data)


def test_unreviewed_extracted_terms_are_not_implicitly_confirmed():
    offer = complete_twelve_month_offer(base_rent_provenance={
        "source_type": "document_extracted", "review_state": "needs_review", "confidence": 0.99,
    })
    result = stress_test_rental(offer, profile(), UtilityIncrease(type="utility_increase", additional_monthly_amount=10, first_affected_month=1, last_affected_month=1))
    assert "unreviewed_extracted_terms" in result["summary"]["unknown_cost_categories"]


def test_stress_results_are_deterministic_json_serializable_and_have_no_scores():
    offer = complete_twelve_month_offer()
    scenario = UtilityIncrease(type="utility_increase", additional_monthly_amount=10.01, first_affected_month=1, last_affected_month=2)
    first = stress_test_rental(offer, profile(), scenario)
    second = stress_test_rental(offer, profile(), scenario)
    assert first == second
    assert str(first["summary"]["total_additional_gross_household_cost"]) == "20.02"
    json.dumps(first, default=str, allow_nan=False)
    assert not any("score" in key.casefold() for key in first["summary"])
