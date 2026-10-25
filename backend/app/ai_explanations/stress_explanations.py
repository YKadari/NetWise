"""Grounded deterministic wording and constrained Gemini selection for stress results."""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, StrictStr

from backend.app.rental.models import FinancialProfile, RentalOffer


class StressSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    headline: StrictStr
    what_changed: StrictStr
    main_consequence: StrictStr
    why_it_matters: StrictStr
    what_to_watch: StrictStr
    what_to_consider: StrictStr


class StressInterpretation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    source: Literal["deterministic"]
    headline: str
    what_changed: str
    main_consequence: str
    why_it_matters: str
    what_to_watch: str
    what_to_consider: str


class StressAiInterpretation(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    source: Literal["gemini"]
    headline: str
    what_changed: str
    main_consequence: str
    why_it_matters: str
    what_to_watch: str
    what_to_consider: str
    statement_ids: list[str]


def _money(value: Any) -> str:
    return f"${Decimal(str(value)):,.2f}".removesuffix(".00")


def _resilience(result: dict[str, Any], which: str) -> dict[str, Any] | None:
    summary = result.get("summary", {})
    if which in summary and isinstance(summary[which], dict):
        return summary[which]
    key = "baseline_financial_resilience" if which == "baseline" else "stressed_financial_resilience"
    value = summary.get(key)
    return value if isinstance(value, dict) else None


def build_stress_explanation(offer: RentalOffer, profile: FinancialProfile | None, result: dict[str, Any]) -> tuple[dict[str, Any], dict[str, dict[str, str]]]:
    """Build approved sentences and minimal facts strictly from server calculations."""
    kind = result["scenario_type"]
    assumptions = result["assumptions"]
    summary = result["summary"]
    unknown = summary.get("unknown_cost_categories", [])
    baseline = _resilience(result, "baseline")
    stressed = _resilience(result, "stressed")
    facts: dict[str, Any] = {
        "scenario_type": kind,
        "profile_supplied": profile is not None,
        "unknown_categories": sorted(item for item in unknown if isinstance(item, str)),
        "baseline_shortfall_months": baseline.get("months_with_modeled_cash_shortfall") if baseline else None,
        "stressed_shortfall_months": stressed.get("months_with_modeled_cash_shortfall") if stressed else None,
        "baseline_reserve_breached": baseline.get("emergency_reserve_breached") if baseline else None,
        "stressed_reserve_breached": stressed.get("emergency_reserve_breached") if stressed else None,
        "utilities_estimated": offer.utilities.status == "estimated",
        "roommate_contribution_modeled": offer.expected_roommate_contribution.status == "provided" or (profile is not None and profile.expected_roommate_contribution is not None),
        "result_is_hypothetical_not_a_forecast": result.get("result_is_hypothetical_not_a_forecast") is True,
    }
    catalog: dict[str, dict[str, str]] = {}
    kind_text = {
        "utility_increase": "Utility increase scenario",
        "roommate_contribution_loss": "Roommate contribution loss scenario",
        "early_departure": "Early departure scenario",
    }[kind]
    catalog["headline"] = {"scenario": kind_text}

    if kind == "utility_increase":
        amount = _money(assumptions["additional_monthly_amount"])
        first, last = assumptions["first_affected_month"], assumptions["last_affected_month"]
        delta = _money(summary["total_additional_personal_cash_burden"])
        gross = _money(summary["total_additional_gross_household_cost"])
        facts.update({"monthly_increase": amount, "first_affected_month": first, "last_affected_month": last,
                      "additional_personal_cash_burden": delta, "additional_gross_household_cost": gross,
                      "cost_result_complete": summary.get("cost_result_complete")})
        catalog["what_changed"] = {"utility": f"The scenario adds {amount} per month in months {first} through {last}; this is an assumption, not a prediction."}
        catalog["main_consequence"] = {"burden": f"The modeled additional personal cash burden is {delta} across the affected months."}
        catalog["why_it_matters"] = {}
        if profile is not None and stressed and baseline and stressed.get("months_with_modeled_cash_shortfall") is not None and baseline.get("months_with_modeled_cash_shortfall") is not None:
            if stressed["months_with_modeled_cash_shortfall"] > baseline["months_with_modeled_cash_shortfall"]:
                catalog["why_it_matters"]["shortfall"] = "With the supplied financial profile, the scenario has more modeled shortfall months than the baseline."
            else:
                catalog["why_it_matters"]["profile"] = "The supplied profile was included in the scenario; the result is still a model, not a forecast."
            if stressed.get("emergency_reserve_breached") is True and baseline.get("emergency_reserve_breached") is not True:
                catalog["why_it_matters"]["reserve"] = "The supplied profile's modeled reserve indicator changes to breached under this scenario."
        else:
            catalog["why_it_matters"]["budget"] = "A higher utility amount would use more of the monthly budget available for housing, if that amount is incurred."
        catalog["what_to_watch"] = {
            "estimated": "The offer marks utilities as estimated; actual bills may differ." if offer.utilities.status == "estimated" else "The entered utility increase is hypothetical and does not change the lease terms.",
            "unknown": "Baseline utility costs are unknown, so this result does not represent complete housing costs." if "utilities" in unknown else "Only the selected months and the entered increase are modeled.",
        }
        catalog["what_to_consider"] = {"budget": "Check whether your monthly budget can absorb this assumed increase and confirm utility responsibility and typical bills."}
    elif kind == "roommate_contribution_loss":
        lost = _money(assumptions["monthly_contribution_lost"])
        first, last = assumptions["first_affected_month"], assumptions["last_affected_month"]
        delta = _money(summary["total_additional_personal_cash_burden"])
        facts.update({"monthly_contribution_lost": lost, "first_affected_month": first, "last_affected_month": last,
                      "additional_personal_cash_burden": delta,
                      "gross_household_cost_change": _money(summary["total_additional_gross_household_cost"])})
        catalog["what_changed"] = {"contribution": f"The modeled roommate contribution falls by {lost} per month in months {first} through {last}."}
        catalog["main_consequence"] = {"burden": f"The modeled additional personal cash burden is {delta}; gross household obligations remain unchanged."}
        catalog["why_it_matters"] = {"profile": "A modeled contribution affects the personal share, while the gross household obligation remains the same."}
        if profile is not None and stressed and baseline and stressed.get("months_with_modeled_cash_shortfall") is not None and baseline.get("months_with_modeled_cash_shortfall") is not None and stressed["months_with_modeled_cash_shortfall"] > baseline["months_with_modeled_cash_shortfall"]:
            catalog["why_it_matters"]["shortfall"] = "With the supplied financial profile, this scenario has more modeled shortfall months than the baseline."
        if profile is not None and stressed and baseline and stressed.get("emergency_reserve_breached") is True and baseline.get("emergency_reserve_breached") is not True:
            catalog["why_it_matters"]["reserve"] = "The supplied profile's modeled reserve indicator changes to breached under this scenario."
        catalog["what_to_watch"] = {"assumption": "This models a contribution change, not what the lease legally requires any renter to pay."}
        catalog["what_to_consider"] = {"plan": "Discuss a backup payment plan and confirm each renter's responsibilities from the written agreement."}
    else:
        departure = assumptions["departure_month"]
        treatment = assumptions["treatment"]
        exposure = _money(result["stressed"]["known_departure_cash_impact"])
        specified = result["stressed"].get("specified_remaining_rent")
        facts.update({"departure_month": departure, "treatment": treatment,
                      "known_departure_cash_impact": exposure,
                      "specified_remaining_rent": None if specified is None else _money(specified),
                      "remaining_rent_treatment": assumptions.get("remaining_rent_treatment", "unknown"),
                      "unknown_categories": sorted(item for item in unknown if isinstance(item, str))})
        catalog["what_changed"] = {"departure": f"The scenario assumes departure after month {departure}."}
        catalog["main_consequence"] = {"known": f"Known modeled departure cash impact is {exposure}; this may be incomplete."}
        if assumptions.get("remaining_rent_treatment") == "specified" and specified is not None:
            prepaid_credit = result["stressed"].get("prepaid_rent_credit_applied")
            if prepaid_credit is None:
                rent_text = "Cash due after prepaid rent remains unknown because its treatment is unresolved."
            else:
                cash_due = _money(result["stressed"]["continuing_rent_cash_due_after_prepaid_credit"])
                rent_text = f"Cash due after the stated prepaid credit is {cash_due}."
            catalog["main_consequence"]["specified_rent"] = (f"The scenario includes {_money(specified)} in specified remaining rent. "
                f"{rent_text} Other obligations may remain unresolved.")
        catalog["why_it_matters"] = {"exposure": "The result includes only amounts entered for this scenario and does not establish what the lease permits."}
        catalog["what_to_watch"] = {"unknown": "Remaining contractual rent or other post-departure obligations are unknown in this scenario." if treatment == "unknown_consequences" or assumptions.get("remaining_rent_treatment", "unknown") == "unknown" else "Other post-departure charges and contract terms may remain unresolved."}
        if treatment == "unknown_consequences":
            catalog["what_to_watch"]["unknown"] = "The agreement's early-departure outcome is unknown; no fee or remaining-rent amount was inferred."
        deposit_treatment = assumptions.get("deposit_treatment", "unknown")
        if deposit_treatment != "unknown":
            catalog["what_to_watch"]["deposit"] = f"Deposit cash treatment is {deposit_treatment} under the selected scenario assumption; a deposit remains separate from nonrefundable lease expense."
        if profile is not None and stressed and stressed.get("emergency_reserve_breached") is True:
            catalog["why_it_matters"]["reserve"] = "The supplied profile's modeled emergency-reserve indicator is breached before all post-departure obligations are known."
        catalog["what_to_consider"] = {"review": "Review the written early-termination terms or ask the landlord to explain the remaining rent, fees, and deposit treatment."}

    return facts, catalog


def render_deterministic_stress(result: dict[str, Any], catalog: dict[str, dict[str, str]]) -> dict[str, Any]:
    return StressInterpretation(source="deterministic", **{field: next(iter(choices.values())) for field, choices in catalog.items()}).model_dump()


def render_ai_stress(raw: object, catalog: dict[str, dict[str, str]]) -> dict[str, Any]:
    selection = StressSelection.model_validate(raw).model_dump()
    ids = list(selection.values())
    if len(ids) != len(set(ids)):
        raise ValueError("unsupported_stress_selection")
    rendered: dict[str, str] = {}
    for field, identifier in selection.items():
        if identifier not in catalog[field]:
            raise ValueError("unsupported_stress_selection")
        rendered[field] = catalog[field][identifier]
    return StressAiInterpretation(source="gemini", **rendered, statement_ids=ids).model_dump()
