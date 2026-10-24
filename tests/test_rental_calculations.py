import json

from backend.app.rental.calculations import evaluate_rental
from backend.app.rental.comparisons import compare_rentals
from tests.test_rental_models import complete_offer


def profile(**changes):
    result = {
        "monthly_take_home_income": 4000,
        "available_savings": 5000,
        "essential_monthly_nonhousing_expenses": 1500,
        "student_loan_payment": 200,
        "student_loan_included_in_essential_expenses": False,
        "monthly_savings_target": 300,
        "minimum_emergency_cash_reserve": 1000,
    }
    result.update(changes)
    return result


def test_monthly_costs_and_known_recurring_charges_are_summed():
    offer = complete_offer(
        recurring_charges=[{"name": "Parking", "monthly_amount": 100}, {"name": "Internet", "monthly_amount": 50}],
        utilities={"status": "estimated", "estimated_monthly_amount": 125},
    )
    result = evaluate_rental(offer)
    assert result["monthly_costs"]["gross_known_monthly_housing_obligation"] == 1275
    assert result["lease_totals"]["known_modeled_nonrefundable_lease_cost"] == 3825


def test_unknown_utilities_and_unknown_fee_list_are_not_zero_or_complete():
    result = evaluate_rental({"rental_label": "Unknown terms", "monthly_base_rent": 1000, "lease_term_months": 2})
    assert result["monthly_costs"]["utilities_known_subtotal"] == 0
    assert result["monthly_costs"]["monthly_costs_complete"] is False
    assert {"utilities", "recurring_charges"}.issubset(result["unknown_cost_categories"])
    assert {"utilities_unknown", "recurring_charges_unknown"}.issubset({warning["code"] for warning in result["warnings"]})


def test_included_utilities_are_not_counted_twice():
    offer = complete_offer(utilities={"status": "included_in_rent"})
    result = evaluate_rental(offer)
    assert result["monthly_costs"]["utilities_known_subtotal"] == 0
    assert result["monthly_costs"]["gross_known_monthly_housing_obligation"] == 1000


def test_prepaid_first_and_last_month_rent_are_allocated_once_and_deposit_is_not_expense():
    offer = complete_offer(
        lease_term_months=3,
        upfront={
            "security_deposit": {"status": "provided", "amount": 500},
            "first_month_rent_due_upfront": "yes", "last_month_rent_due_upfront": "yes",
            "nonrefundable_fees_status": "complete", "other_charges_status": "complete", "holding_deposit_status": "none",
        },
    )
    result = evaluate_rental(offer)
    assert result["upfront"]["upfront_cash_required"] == 2500
    assert result["upfront"]["refundable_cash_held"] == 500
    assert result["lease_totals"]["known_modeled_nonrefundable_lease_cost"] == 3000
    assert result["lease_totals"]["known_total_cash_outflows_including_refundable_holds"] == 3500
    flows = result["month_by_month_cash_flow"]
    assert [row["rent_cash_due_this_month"] for row in flows] == [0, 1000, 0]
    assert [row["rent_prepayment_allocated"] for row in flows] == [1000, 0, 1000]
    assert sum(row["in_lease_month_rent_cash_due"] for row in flows) + result["upfront"]["upfront_cash_required"] == 3500


def test_one_month_term_with_first_and_last_prepaid_does_not_double_count_rent():
    offer = complete_offer(lease_term_months=1, upfront={
        "security_deposit": {"status": "none"}, "first_month_rent_due_upfront": "yes", "last_month_rent_due_upfront": "yes",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete", "holding_deposit_status": "none",
    })
    result = evaluate_rental(offer)
    assert result["upfront"]["upfront_cash_required"] == 1000
    assert result["lease_totals"]["known_modeled_nonrefundable_lease_cost"] == 1000
    assert result["month_by_month_cash_flow"][0]["rent_prepayment_allocated"] == 1000


def test_unknown_rent_payment_timing_remains_unknown_in_cash_flow():
    offer = complete_offer(upfront={
        "security_deposit": {"status": "none"}, "first_month_rent_due_upfront": "unknown", "last_month_rent_due_upfront": "no",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete", "holding_deposit_status": "none",
    })
    result = evaluate_rental(offer, profile())
    assert result["upfront"]["unknown_rent_payment_timing_months"] == [1]
    assert result["month_by_month_cash_flow"][0]["rent_cash_due_this_month"] is None
    assert result["month_by_month_cash_flow"][0]["cash_remaining_from_monthly_income_after_scheduled_payments"] is None
    assert "rent_payment_timing_unknown" in {warning["code"] for warning in result["warnings"]}


def test_fees_and_other_charges_separate_nonrefundable_expense_from_refundable_cash():
    offer = complete_offer(upfront={
        "security_deposit": {"status": "provided", "amount": 600},
        "first_month_rent_due_upfront": "yes", "last_month_rent_due_upfront": "no",
        "nonrefundable_fees": [{"name": "Application", "amount": 75}], "nonrefundable_fees_status": "complete",
        "other_charges": [{"name": "Pet deposit", "amount": 200, "refundable": True}], "other_charges_status": "complete",
        "holding_deposit_status": "none",
    })
    result = evaluate_rental(offer)
    assert result["upfront"]["nonrefundable_upfront_expenses"] == 75
    assert result["upfront"]["refundable_cash_held"] == 800
    assert result["lease_totals"]["known_modeled_nonrefundable_lease_cost"] == 3075
    assert result["lease_totals"]["known_total_cash_outflows_including_refundable_holds"] == 3875


def test_holding_deposit_credit_is_counted_once_toward_first_rent():
    offer = complete_offer(upfront={
        "security_deposit": {"status": "none"}, "first_month_rent_due_upfront": "no", "last_month_rent_due_upfront": "no",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete",
        "holding_deposit": {"amount": 200, "treatment": "credited_to_first_month_rent"}, "holding_deposit_status": "provided",
    })
    result = evaluate_rental(offer)
    assert result["upfront"]["upfront_cash_required"] == 1000
    assert result["upfront"]["prepaid_rent_by_month"] == {"1": 1000}
    assert result["lease_totals"]["known_modeled_nonrefundable_lease_cost"] == 3000


def test_holding_deposit_uncredited_refundable_or_nonrefundable_is_classified():
    base = complete_offer(upfront={
        "security_deposit": {"status": "none"}, "first_month_rent_due_upfront": "no", "last_month_rent_due_upfront": "no",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete",
        "holding_deposit": {"amount": 100, "treatment": "not_credited_refundable"}, "holding_deposit_status": "provided",
    })
    refundable = evaluate_rental(base)
    assert refundable["upfront"]["refundable_cash_held"] == 100
    assert refundable["lease_totals"]["known_modeled_nonrefundable_lease_cost"] == 3000
    base["upfront"]["holding_deposit"]["treatment"] = "not_credited_nonrefundable"
    nonrefundable = evaluate_rental(base)
    assert nonrefundable["upfront"]["refundable_cash_held"] == 0
    assert nonrefundable["lease_totals"]["known_modeled_nonrefundable_lease_cost"] == 3100


def test_month_specific_free_rent_and_credits_never_offset_other_categories_implicitly():
    offer = complete_offer(
        recurring_charges=[{"name": "Parking", "monthly_amount": 100}],
        recurring_charges_status="complete", utilities={"status": "estimated", "estimated_monthly_amount": 80},
        concessions=[
            {"kind": "free_rent_month", "month": 1},
            {"kind": "rent_credit", "month": 2, "amount": 1200},
        ],
    )
    result = evaluate_rental(offer)
    flows = result["month_by_month_cash_flow"]
    assert flows[0]["base_rent_after_concessions"] == 0
    assert flows[0]["recurring_charges_after_concessions"] == 100
    assert flows[0]["estimated_utilities_after_concessions"] == 80
    assert flows[1]["base_rent_after_concessions"] == 0
    assert flows[1]["recurring_charges_after_concessions"] == 100
    assert flows[1]["estimated_utilities_after_concessions"] == 80
    assert result["lease_totals"]["unused_concession_credit"] == 200
    assert all(row["gross_contractual_housing_expense"] >= 0 for row in flows)


def test_concession_can_target_utility_only_when_explicitly_named():
    offer = complete_offer(utilities={"status": "estimated", "estimated_monthly_amount": 80}, concessions=[
        {"kind": "promotional_credit", "month": 1, "amount": 30, "eligible_category": "utilities"},
    ])
    result = evaluate_rental(offer)
    assert result["month_by_month_cash_flow"][0]["estimated_utilities_after_concessions"] == 50


def test_recurring_charge_credit_names_target_and_does_not_offset_other_fees():
    offer = complete_offer(
        recurring_charges=[{"name": "Parking", "monthly_amount": 100}, {"name": "Internet", "monthly_amount": 60}],
        concessions=[{"kind": "promotional_credit", "month": 1, "amount": 25, "eligible_category": "recurring_charge", "eligible_charge_name": "Parking"}],
    )
    row = evaluate_rental(offer)["month_by_month_cash_flow"][0]
    assert row["recurring_charges_after_concessions"] == 135


def test_cash_remaining_loan_dedup_savings_target_and_emergency_reserve():
    offer = complete_offer(monthly_base_rent=1100)
    result = evaluate_rental(offer, profile())
    finances = result["financial_profile"]
    assert finances["maximum_sustainable_monthly_housing_amount"] == 2000
    assert finances["known_monthly_cash_remaining_after_housing_and_savings"] == 900
    assert finances["emergency_reserve_preserved"] is True
    included = evaluate_rental(offer, profile(student_loan_included_in_essential_expenses=True))
    assert included["financial_profile"]["maximum_sustainable_monthly_housing_amount"] == 2200


def test_upfront_savings_emergency_and_monthly_affordability_warnings_are_neutral():
    offer = complete_offer(monthly_base_rent=2500, upfront={
        "security_deposit": {"status": "provided", "amount": 2000},
        "first_month_rent_due_upfront": "yes", "last_month_rent_due_upfront": "no",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete", "holding_deposit_status": "none",
    })
    result = evaluate_rental(offer, profile(available_savings=3000, minimum_emergency_cash_reserve=1000))
    codes = {warning["code"] for warning in result["warnings"]}
    assert "upfront_exceeds_savings" in codes
    assert "emergency_reserve_breached" in codes
    assert "monthly_housing_budget_exceeded" in codes


def test_roommate_contribution_changes_modeled_share_not_contractual_obligation():
    offer = complete_offer(monthly_base_rent=1800, expected_roommate_contribution={"status": "provided", "amount": 600})
    result = evaluate_rental(offer, profile())
    assert result["monthly_costs"]["gross_known_monthly_housing_obligation"] == 1800
    assert result["monthly_costs"]["total_contractual_liability_remains_gross"] is True
    assert result["monthly_costs"]["expected_personal_monthly_share"] == 1200
    assert "roommate_contribution_assumed" in {warning["code"] for warning in result["warnings"]}


def test_profile_roommate_contribution_overrides_offer_expectation():
    offer = complete_offer(expected_roommate_contribution={"status": "provided", "amount": 600})
    result = evaluate_rental(offer, profile(expected_roommate_contribution=250))
    assert result["monthly_costs"]["expected_personal_monthly_share"] == 750
    assert result["financial_profile"]["roommate_contribution_source"] == "profile"


def test_comparison_uses_consistent_profile_reports_unknowns_and_normalizes_durations():
    left = complete_offer(rental_label="A", monthly_base_rent=1000, lease_term_months=6)
    right = complete_offer(rental_label="B", monthly_base_rent=1200, lease_term_months=12, utilities={"status": "unknown"})
    result = compare_rentals(left, right, profile())
    assert result["differences"]["left_minus_right"]["base_rent_per_month"] == -200
    assert result["differences"]["lease_terms_differ"] is True
    assert result["differences"]["total_period_costs_directly_comparable"] is False
    assert result["differences"]["left_minus_right"]["normalized_known_lease_expense_per_month"] == -200
    assert "utilities" in result["differences"]["unknown_cost_categories"]["right"]
    assert result["comparison_notes"]


def test_equal_duration_comparison_reports_measured_deltas_without_overall_ranking():
    left = complete_offer(rental_label="A", monthly_base_rent=1000)
    right = complete_offer(rental_label="B", monthly_base_rent=1050)
    result = compare_rentals(left, right, profile())
    assert result["differences"]["lease_terms_differ"] is False
    assert result["differences"]["total_period_costs_directly_comparable"] is True
    assert result["differences"]["left_minus_right"]["upfront_cash_required"] == 0
    assert "no overall financial-safety score" in result["method"]


def test_comparison_reports_upfront_refundable_cash_monthly_cash_and_savings_differences():
    left = complete_offer(rental_label="A", monthly_base_rent=1000, upfront={
        "security_deposit": {"status": "provided", "amount": 100},
        "first_month_rent_due_upfront": "no", "last_month_rent_due_upfront": "no",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete", "holding_deposit_status": "none",
    })
    right = complete_offer(rental_label="B", monthly_base_rent=900, upfront={
        "security_deposit": {"status": "provided", "amount": 400},
        "first_month_rent_due_upfront": "yes", "last_month_rent_due_upfront": "no",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete", "holding_deposit_status": "none",
    })
    delta = compare_rentals(left, right, profile())["differences"]["left_minus_right"]
    assert delta["upfront_cash_required"] == -1200
    assert delta["refundable_cash_held"] == -300
    assert delta["monthly_cash_remaining_after_housing_and_savings"] == -100
    assert delta["initial_savings_remaining_after_move_in"] == 1200
    assert delta["average_modeled_monthly_housing_cost_after_concessions"] == 100


def test_lease_start_date_adds_calendar_month_without_external_date_dependency():
    result = evaluate_rental(complete_offer(lease_start_date="2026-11-01"))
    assert [row["calendar_month"] for row in result["month_by_month_cash_flow"]] == ["2026-11", "2026-12", "2027-01"]


def test_repeated_evaluation_is_deterministic_and_strict_json_serializable():
    offer = complete_offer(monthly_base_rent=900.01, concessions=[{"kind": "rent_credit", "month": 2, "amount": 5.01}])
    first = evaluate_rental(offer, profile())
    second = evaluate_rental(offer, profile())
    assert first == second
    json.dumps(first, default=str, allow_nan=False)


def test_unreviewed_document_extraction_is_provisional_not_confirmed():
    offer = complete_offer(base_rent_provenance={
        "source_type": "document_extracted", "source_reference": "page 2, paragraph 1",
        "confidence": 0.99, "review_state": "needs_review",
    })
    result = evaluate_rental(offer, profile())
    assert result["term_provenance"]["unreviewed_extracted_terms"] == ["base_rent"]
    assert result["lease_totals"]["nonrefundable_cost_complete"] is False
    assert result["financial_profile"]["affordability_status"] == "unknown"
    assert "extracted_terms_need_review" in {warning["code"] for warning in result["warnings"]}
