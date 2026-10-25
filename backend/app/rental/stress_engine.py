"""Deterministic, non-predictive stress comparisons over Batch 4A evaluations."""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
from typing import Any
from pydantic import TypeAdapter

from .calculations import _cents, _dollars, evaluate_rental
from .models import FinancialProfile, RentalOffer
from .stress_models import EarlyDeparture, RoommateContributionLoss, StressScenario, UtilityIncrease


def _effective_contribution(offer: RentalOffer, profile: FinancialProfile | None) -> int:
    if profile and profile.expected_roommate_contribution is not None:
        return _cents(profile.expected_roommate_contribution)
    if offer.expected_roommate_contribution.status == "provided":
        return _cents(offer.expected_roommate_contribution.amount)
    return 0


def _available_housing(profile: FinancialProfile | None) -> int | None:
    if profile is None:
        return None
    loan = 0 if profile.student_loan_included_in_essential_expenses else _cents(profile.student_loan_payment)
    return (_cents(profile.monthly_take_home_income) - _cents(profile.essential_monthly_nonhousing_expenses)
            - loan - _cents(profile.monthly_savings_target))


def _public_evaluation(evaluation: dict[str, Any]) -> dict[str, Any]:
    """Keep Batch 4A results while avoiding echoing document excerpt references."""
    result = deepcopy(evaluation)

    def redact(value: Any) -> None:
        if isinstance(value, dict):
            if "source_reference" in value:
                reference = value.pop("source_reference")
                value["source_reference_provided"] = bool(reference)
            for child in value.values():
                redact(child)
        elif isinstance(value, list):
            for child in value:
                redact(child)

    redact(result)
    return result


def _resilience(schedule: list[dict[str, Any]], evaluation: dict[str, Any], profile: FinancialProfile | None) -> dict[str, Any]:
    if profile is None:
        return {
            "available_monthly_housing_budget": None,
            "total_modeled_personal_housing_burden": None,
            "monthly_cash_remaining": None,
            "months_with_modeled_cash_shortfall": None,
            "first_month_with_modeled_cash_shortfall": None,
            "savings_trajectory": None,
            "minimum_modeled_savings": None,
            "emergency_reserve_breached": None,
            "savings_trajectory_complete": False,
        }
    unknown_monthly = {"utilities", "recurring_charges", "unreviewed_extracted_terms"}.intersection(evaluation["unknown_cost_categories"])
    unknown_monthly_cash_obligations = any(
        row.get("rent_cash_due_this_month") is None
        or row.get("monthly_nonrent_cash_due") is None
        or row.get("additional_cash_flow_due", 0) is None
        for row in schedule
    )
    budget = _available_housing(profile)
    burden = sum(_cents(row.get("modeled_renter_housing_share")) for row in schedule)
    burden_complete = not unknown_monthly and all(row.get("modeled_renter_housing_share") is not None for row in schedule)
    cash_after_target = [row.get("cash_remaining_after_expenses_and_savings") for row in schedule]
    shortfall = [row["month"] for row in schedule if row.get("cash_remaining_after_expenses_and_savings") is not None and _cents(row["cash_remaining_after_expenses_and_savings"]) < 0]
    upfront = evaluation["upfront"]
    running: int | None = _cents(profile.available_savings) - _cents(upfront["upfront_cash_required"])
    complete = bool(upfront["upfront_cash_complete"]) and not unknown_monthly and not unknown_monthly_cash_obligations
    trajectory = [{"month": 0, "ending_savings": _dollars(running), "status": "known_costs_only_upper_bound" if not complete else "modeled"}]
    monthly_net_before_housing = (
        _cents(profile.monthly_take_home_income)
        - _cents(profile.essential_monthly_nonhousing_expenses)
        - (0 if profile.student_loan_included_in_essential_expenses else _cents(profile.student_loan_payment))
    )
    for row in schedule:
        rent = row.get("rent_cash_due_this_month")
        if running is None or rent is None:
            running = None
            complete = False
        else:
            payment = max(0, _cents(rent) + _cents(row.get("monthly_nonrent_cash_due")) - _cents(row.get("roommate_contribution")))
            running += monthly_net_before_housing - payment - _cents(row.get("additional_cash_flow_due"))
        trajectory.append({"month": row["month"], "ending_savings": None if running is None else _dollars(running),
                           "status": "unknown" if running is None else "modeled" if complete else "known_costs_only_upper_bound"})
    values = [_cents(item["ending_savings"]) for item in trajectory if item["ending_savings"] is not None]
    minimum = min(values) if values else None
    reserve = _cents(profile.minimum_emergency_cash_reserve) if profile.minimum_emergency_cash_reserve is not None else None
    breached = None if reserve is None else (minimum < reserve if complete and minimum is not None else (True if minimum is not None and minimum < reserve else None))
    return {
        "available_monthly_housing_budget": _dollars(budget),
        "total_modeled_personal_housing_burden": _dollars(burden),
        "personal_housing_burden_complete": burden_complete,
        "monthly_cash_remaining": cash_after_target,
        "months_with_modeled_cash_shortfall": len(shortfall),
        "cash_shortfall_result_complete": not unknown_monthly and not unknown_monthly_cash_obligations and all(row.get("cash_remaining_after_expenses_and_savings") is not None for row in schedule),
        "first_month_with_modeled_cash_shortfall": shortfall[0] if shortfall else None,
        "savings_trajectory": trajectory,
        "minimum_modeled_savings": None if minimum is None else _dollars(minimum),
        "emergency_reserve_breached": breached,
        "savings_trajectory_complete": complete,
        "savings_accounting": "Starting savings less known upfront cash; each month adds take-home income less essential expenses, separately due loans, and actual scheduled personal housing cash, assuming all residual cash is retained. The planned savings target is not subtracted again; it is already reflected in the available-housing-budget and cash-after-target measures. This is an accounting scenario, not a savings prediction.",
    }


def _ordinary_stress(offer: RentalOffer, profile: FinancialProfile | None, scenario: UtilityIncrease | RoommateContributionLoss) -> dict[str, Any]:
    base = evaluate_rental(offer, profile)
    baseline_rows = base["month_by_month_cash_flow"]
    stressed_rows: list[dict[str, Any]] = []
    affected = set(range(scenario.first_affected_month, scenario.last_affected_month + 1))
    baseline_contribution = _effective_contribution(offer, profile)
    if isinstance(scenario, RoommateContributionLoss):
        if baseline_contribution <= 0:
            raise ValueError("A roommate-loss scenario requires an existing positive expected contribution")
        if _cents(scenario.monthly_contribution_lost) > baseline_contribution:
            raise ValueError("Lost roommate contribution cannot exceed the baseline expected contribution")
    total_personal_delta = 0
    total_gross_delta = 0
    for row in baseline_rows:
        month = row["month"]
        if month > offer.lease_term_months:
            continue
        gross = _cents(row["gross_contractual_housing_expense"])
        base_contribution = _cents(row["roommate_contribution"])
        stressed_gross = gross
        stressed_contribution = base_contribution
        extra_utility = 0
        if month in affected and isinstance(scenario, UtilityIncrease):
            extra_utility = _cents(scenario.additional_monthly_amount)
            stressed_gross += extra_utility
        elif month in affected and isinstance(scenario, RoommateContributionLoss):
            stressed_contribution = min(gross, max(0, baseline_contribution - _cents(scenario.monthly_contribution_lost)))
        base_personal = _cents(row["modeled_renter_housing_share"])
        stressed_personal = max(0, stressed_gross - stressed_contribution)
        personal_delta = stressed_personal - base_personal
        gross_delta = stressed_gross - gross
        total_personal_delta += personal_delta
        total_gross_delta += gross_delta
        expense_cash = row.get("cash_remaining_after_expenses_and_savings")
        scheduled_cash = row.get("cash_remaining_from_monthly_income_after_scheduled_payments")
        stressed_rows.append({
            "month": month,
            "calendar_month": row.get("calendar_month"),
            "affected": month in affected,
            "baseline_gross_household_obligation": row["gross_contractual_housing_expense"],
            "stressed_gross_household_obligation": _dollars(stressed_gross),
            "baseline_base_rent_after_concessions": row["base_rent_after_concessions"],
            "baseline_recurring_charges_after_concessions": row["recurring_charges_after_concessions"],
            "baseline_estimated_utilities_after_concessions": row["estimated_utilities_after_concessions"],
            "stressed_estimated_utilities_after_concessions": _dollars(_cents(row["estimated_utilities_after_concessions"]) + extra_utility),
            "baseline_roommate_contribution": row["roommate_contribution"],
            "stressed_roommate_contribution": _dollars(stressed_contribution),
            "baseline_personal_housing_burden": row["modeled_renter_housing_share"],
            "stressed_personal_housing_burden": _dollars(stressed_personal),
            "additional_personal_cash_burden": _dollars(personal_delta),
            "additional_gross_household_cost": _dollars(gross_delta),
            "baseline_cash_remaining_after_expenses_and_savings": expense_cash,
            "stressed_cash_remaining_after_expenses_and_savings": None if expense_cash is None else _dollars(_cents(expense_cash) - personal_delta),
            "baseline_cash_remaining_after_scheduled_payments": scheduled_cash,
            "stressed_cash_remaining_after_scheduled_payments": None if scheduled_cash is None else _dollars(_cents(scheduled_cash) - personal_delta),
            "baseline_rent_cash_due": row["rent_cash_due_this_month"],
            "baseline_other_housing_cash_due": row["monthly_nonrent_cash_due"],
        })
    base_schedule = deepcopy(baseline_rows)
    stressed_schedule = deepcopy(baseline_rows)
    for index, row in enumerate(stressed_schedule):
        adjusted = stressed_rows[index]
        row["gross_contractual_housing_expense"] = adjusted["stressed_gross_household_obligation"]
        row["roommate_contribution"] = adjusted["stressed_roommate_contribution"]
        row["modeled_renter_housing_share"] = adjusted["stressed_personal_housing_burden"]
        if row.get("cash_remaining_after_expenses_and_savings") is not None:
            row["cash_remaining_after_expenses_and_savings"] = adjusted["stressed_cash_remaining_after_expenses_and_savings"]
        if row.get("cash_remaining_from_monthly_income_after_scheduled_payments") is not None:
            row["cash_remaining_from_monthly_income_after_scheduled_payments"] = adjusted["stressed_cash_remaining_after_scheduled_payments"]
        if isinstance(scenario, UtilityIncrease) and row["month"] in affected:
            row["monthly_nonrent_cash_due"] = _dollars(_cents(row["monthly_nonrent_cash_due"]) + _cents(scenario.additional_monthly_amount))
    baseline_resilience = _resilience(base_schedule, base, profile)
    stressed_resilience = _resilience(stressed_schedule, base, profile)
    unknown = list(base["unknown_cost_categories"])
    if isinstance(scenario, UtilityIncrease):
        if offer.utilities.status == "included_in_rent":
            explanation = "This scenario adds an explicitly hypothetical out-of-pocket utility charge even though the offer marks utilities included. The offer terms are unchanged."
            warnings = [{"code": "utility_increase_overrides_included_terms", "message": explanation}]
        elif offer.utilities.status == "unknown":
            explanation = "The additional utility charge is known under the scenario; baseline utility expense remains unknown, so total housing cost is incomplete."
            warnings = [{"code": "baseline_utility_cost_unknown", "message": explanation}]
        else:
            explanation = "The scenario adds the stated monthly amount on top of the existing utility estimate; it does not infer an inflation rate or alter the lease estimate."
            warnings = []
        assumptions = {"additional_monthly_amount": scenario.additional_monthly_amount,
                       "first_affected_month": scenario.first_affected_month, "last_affected_month": scenario.last_affected_month,
                       "scenario_charge_is_hypothetical": True}
    else:
        explanation = (f"Expected roommate contribution decreases by ${scenario.monthly_contribution_lost:.2f} in months "
                       f"{scenario.first_affected_month}–{scenario.last_affected_month}; gross household obligations remain unchanged."
                       " The contribution affects only the modeled personal share, not contractual liability.")
        warnings = [{"code": "roommate_contribution_is_not_liability_reduction", "message": "Roommate contribution changes do not reduce gross household contractual obligations."}]
        assumptions = {"monthly_contribution_lost": scenario.monthly_contribution_lost,
                       "first_affected_month": scenario.first_affected_month, "last_affected_month": scenario.last_affected_month,
                       "baseline_expected_monthly_contribution": _dollars(baseline_contribution)}
    if total_personal_delta < 0:
        raise ValueError("Scenario produced an invalid negative additional personal burden")
    summaries = {
        "total_additional_personal_cash_burden": _dollars(total_personal_delta),
        "total_additional_gross_household_cost": _dollars(total_gross_delta),
        "cost_result_complete": not unknown,
        "unknown_cost_categories": sorted(set(unknown)),
        "baseline": baseline_resilience,
        "stressed": stressed_resilience,
    }
    return {"scenario_type": scenario.type, "assumptions": assumptions, "affected_months": sorted(affected),
            "baseline": _public_evaluation(base), "stressed": {"month_by_month": stressed_rows, "financial_resilience": stressed_resilience},
            "summary": summaries, "warnings": warnings, "explanation": explanation,
            "result_is_hypothetical_not_a_forecast": True}


def _early_departure(offer: RentalOffer, profile: FinancialProfile | None, scenario: EarlyDeparture) -> dict[str, Any]:
    if not 1 <= scenario.departure_month < offer.lease_term_months:
        raise ValueError("departure_month must be within the lease and before its final month")
    remaining_months = offer.lease_term_months - scenario.departure_month
    if scenario.continuing_rent_months is not None and scenario.continuing_rent_months > remaining_months:
        raise ValueError("continuing_rent_months cannot exceed the months remaining in the lease")
    base = evaluate_rental(offer, profile)
    base_rows = base["month_by_month_cash_flow"]
    prepaid_future = sum(_cents(row["rent_prepayment_allocated"]) for row in base_rows if row["month"] > scenario.departure_month)
    if scenario.prepaid_rent_treatment == "refunded" and prepaid_future == 0:
        raise ValueError("Prepaid rent cannot be marked refunded when no post-departure rent was prepaid")
    deposit = scenario.deposit_amount_override
    deposit_basis = "scenario_assumption"
    if deposit is None and offer.upfront.security_deposit.status == "provided":
        deposit = offer.upfront.security_deposit.amount
        deposit_basis = "confirmed_offer_amount"
    if scenario.deposit_treatment != "unknown" and deposit is None:
        raise ValueError("A deposit outcome requires a known offer deposit or explicit deposit_amount_override")
    fee = _cents(scenario.termination_fee)
    other_charges = sum(_cents(item.amount) for item in scenario.other_departure_charges)
    continuing_total = (_cents(scenario.continuing_rent_monthly_amount) * (scenario.continuing_rent_months or 0))
    continuing_cash_by_month: dict[int, int | None] = {}
    continuing_credit_by_month: dict[int, int | None] = {}
    if scenario.continuing_rent_monthly_amount is not None:
        for offset in range(1, (scenario.continuing_rent_months or 0) + 1):
            month = scenario.departure_month + offset
            prepaid = _cents(base_rows[month - 1]["rent_prepayment_allocated"])
            if prepaid and scenario.prepaid_rent_treatment == "unknown":
                continuing_cash_by_month[month] = None
                continuing_credit_by_month[month] = None
            else:
                prepaid_credit = min(prepaid, _cents(scenario.continuing_rent_monthly_amount)) if scenario.prepaid_rent_treatment == "retained" else 0
                continuing_credit_by_month[month] = prepaid_credit
                continuing_cash_by_month[month] = max(0, _cents(scenario.continuing_rent_monthly_amount) - prepaid_credit)
    continuing_cash_due = sum(amount for amount in continuing_cash_by_month.values() if amount is not None)
    if any(amount is None for amount in continuing_credit_by_month.values()):
        continuing_prepaid_credit: int | None = None
    else:
        continuing_prepaid_credit = sum(continuing_credit_by_month.values())
    deposit_cents = _cents(deposit)
    prepaid_refund = prepaid_future if scenario.prepaid_rent_treatment == "refunded" else 0
    deposit_flow = -deposit_cents if scenario.deposit_treatment == "refunded" else deposit_cents if scenario.deposit_treatment == "withheld" else 0
    one_time_departure_cash = fee + other_charges + deposit_flow - prepaid_refund
    event_cash_impact = one_time_departure_cash + continuing_cash_due
    unknown = list(base["unknown_cost_categories"])
    uncovered_future_months = 0 if scenario.remaining_rent_treatment == "none_confirmed" else remaining_months - (scenario.continuing_rent_months or 0)
    if scenario.treatment == "unknown_consequences":
        unknown.append("early_departure_consequences")
    elif scenario.remaining_rent_treatment == "unknown" or uncovered_future_months > 0:
        unknown.append("remaining_rent_obligation")
    unknown.append("post_departure_nonrent_obligations")
    if scenario.deposit_treatment == "unknown" and (offer.upfront.security_deposit.status == "provided" or offer.upfront.security_deposit.status == "unknown"):
        unknown.append("deposit_outcome")
    if prepaid_future and scenario.prepaid_rent_treatment == "unknown":
        unknown.append("prepaid_rent_recovery")
    future_concessions = [c for c in offer.concessions if c.month > scenario.departure_month]
    if future_concessions:
        unknown.append("conditional_concession_clawbacks")
    unknown = sorted(set(unknown))

    month_rows = []
    for row in base_rows:
        month = row["month"]
        if month <= scenario.departure_month:
            month_rows.append({"month": month, "calendar_month": row.get("calendar_month"), "status": "baseline_terms_continue_through_departure",
                               "baseline_gross_household_obligation": row["gross_contractual_housing_expense"],
                               "stressed_known_rent_obligation": row["base_rent_after_concessions"],
                               "prepaid_rent_credit_applied": Decimal("0.00"),
                               "stressed_rent_cash_due": row["rent_cash_due_this_month"],
                               "stressed_total_housing_obligation": row["gross_contractual_housing_expense"] if base["monthly_costs"]["monthly_costs_complete"] else None,
                               "stressed_departure_event_cash_flow": _dollars(one_time_departure_cash) if month == scenario.departure_month else Decimal("0.00")})
        else:
            offset = month - scenario.departure_month
            specified = scenario.continuing_rent_monthly_amount is not None and offset <= (scenario.continuing_rent_months or 0)
            rent_amount = scenario.continuing_rent_monthly_amount if specified else None
            prepaid_credit = continuing_credit_by_month.get(month, 0) if specified else 0
            month_rows.append({"month": month, "calendar_month": row.get("calendar_month"),
                               "status": "explicit_rent_amount_only_other_costs_unresolved" if specified else "post_departure_obligations_unresolved",
                               "baseline_gross_household_obligation": row["gross_contractual_housing_expense"],
                               "stressed_known_rent_obligation": rent_amount,
                               "prepaid_rent_credit_applied": None if prepaid_credit is None else _dollars(prepaid_credit),
                               "stressed_rent_cash_due": None if specified and continuing_cash_by_month.get(month) is None else _dollars(continuing_cash_by_month.get(month, 0)) if specified else None,
                               "stressed_total_housing_obligation": None,
                               "stressed_departure_event_cash_flow": None if not specified or continuing_cash_by_month.get(month) is None else _dollars(continuing_cash_by_month[month])})
    baseline_resilience = _resilience(base_rows, base, profile)
    if profile is None:
        stressed_resilience = _resilience([], base, None)
    else:
        stressed_schedule = deepcopy(base_rows)
        for row in stressed_schedule:
            row["additional_cash_flow_due"] = 0
            if row["month"] == scenario.departure_month:
                row["additional_cash_flow_due"] = one_time_departure_cash
                for field in ("cash_remaining_after_expenses_and_savings", "cash_remaining_from_monthly_income_after_scheduled_payments"):
                    if row.get(field) is not None:
                        row[field] = _dollars(_cents(row[field]) - one_time_departure_cash)
            elif row["month"] > scenario.departure_month:
                offset = row["month"] - scenario.departure_month
                if row["month"] in continuing_cash_by_month and continuing_cash_by_month[row["month"]] is not None:
                    row["additional_cash_flow_due"] = continuing_cash_by_month[row["month"]]
                row["cash_remaining_after_expenses_and_savings"] = None
                row["cash_remaining_from_monthly_income_after_scheduled_payments"] = None
                row["modeled_renter_housing_share"] = None
        stressed_resilience = _resilience(stressed_schedule, base, profile)
        if scenario.departure_month < offer.lease_term_months:
            stressed_resilience["savings_trajectory_complete"] = False
            for point in stressed_resilience["savings_trajectory"][scenario.departure_month + 1:]:
                point["ending_savings"] = None
                point["status"] = "unknown"
            known_savings = [_cents(point["ending_savings"]) for point in stressed_resilience["savings_trajectory"] if point["ending_savings"] is not None]
            stressed_resilience["minimum_modeled_savings"] = _dollars(min(known_savings)) if known_savings else None
            reserve_cents = _cents(profile.minimum_emergency_cash_reserve)
            stressed_resilience["emergency_reserve_breached"] = True if reserve_cents is not None and known_savings and min(known_savings) < reserve_cents else None
    assumptions = scenario.model_dump(mode="json", exclude={"type"})
    if "termination_fee_source" in assumptions:
        assumptions["termination_fee_source_provided"] = bool(assumptions.pop("termination_fee_source"))
    provenance = assumptions.get("termination_fee_provenance")
    if isinstance(provenance, dict) and "source_reference" in provenance:
        reference = provenance.pop("source_reference")
        provenance["source_reference_provided"] = bool(reference)
    return {
        "scenario_type": scenario.type,
        "assumptions": assumptions,
        "affected_months": list(range(scenario.departure_month + 1, offer.lease_term_months + 1)),
        "baseline": _public_evaluation(base),
        "stressed": {"month_by_month": month_rows, "financial_resilience": stressed_resilience,
                     "known_departure_cash_impact": _dollars(event_cash_impact),
                     "termination_fee": _dollars(fee), "other_departure_charges": _dollars(other_charges),
                     "specified_remaining_rent": _dollars(continuing_total),
                     "prepaid_rent_credit_applied": None if continuing_prepaid_credit is None else _dollars(continuing_prepaid_credit),
                     "continuing_rent_cash_due_after_prepaid_credit": _dollars(continuing_cash_due),
                     "deposit_cash_effect": _dollars(deposit_flow), "prepaid_rent_refund_assumed": _dollars(prepaid_refund),
                     "deposit_amount_basis": deposit_basis if scenario.deposit_treatment != "unknown" else None},
        "summary": {"additional_gross_household_cost": _dollars(fee + other_charges),
                    "specified_remaining_rent_obligation": _dollars(continuing_total),
                    "prepaid_rent_credit_applied": None if continuing_prepaid_credit is None else _dollars(continuing_prepaid_credit),
                    "additional_personal_cash_burden": None if unknown else _dollars(event_cash_impact),
                    "known_departure_cash_impact": _dollars(event_cash_impact),
                    "remaining_rent_treatment": scenario.remaining_rent_treatment,
                    "uncovered_future_months": uncovered_future_months,
                    "total_result_complete": not unknown,
                    "unknown_cost_categories": unknown,
                    "baseline_financial_resilience": baseline_resilience,
                    "stressed_financial_resilience": stressed_resilience},
        "warnings": [{"code": "early_departure_is_not_lease_termination",
                      "message": "Vacating does not establish that contractual obligations end. Only explicit scenario amounts are modeled; unresolved future liability remains unknown."},
                     {"code": "post_departure_nonrent_obligations_unknown",
                      "message": "Ongoing utilities and other recurring charges after departure are unresolved because the request does not specify how they are treated."},
                     *([{"code": "future_concession_clawback_unknown", "message": "Future concessions may have conditions or clawbacks that are not represented in the offer; no amount was inferred."}] if future_concessions else [])],
        "explanation": "This is an explicit settlement scenario, not a legal conclusion. A termination fee is not treated as replacing future rent unless the request explicitly confirms that treatment. Prepaid last-month rent is not charged again; any recovery is applied only when explicitly selected.",
        "result_is_hypothetical_not_a_forecast": True,
    }


def stress_test_rental(offer: RentalOffer | dict[str, Any], profile: FinancialProfile | dict[str, Any] | None, scenario: UtilityIncrease | RoommateContributionLoss | EarlyDeparture | dict[str, Any]) -> dict[str, Any]:
    offer_model = offer if isinstance(offer, RentalOffer) else RentalOffer.model_validate(offer)
    profile_model = profile if profile is None or isinstance(profile, FinancialProfile) else FinancialProfile.model_validate(profile)
    if isinstance(scenario, dict):
        scenario = TypeAdapter(StressScenario).validate_python(scenario)
    if isinstance(scenario, (UtilityIncrease, RoommateContributionLoss)):
        if scenario.last_affected_month > offer_model.lease_term_months:
            raise ValueError("Affected months cannot exceed the lease term")
    if isinstance(scenario, EarlyDeparture):
        return _early_departure(offer_model, profile_model, scenario)
    return _ordinary_stress(offer_model, profile_model, scenario)
