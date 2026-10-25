"""Deterministic, evaluator-grounded rental comparison statements."""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ComparisonSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    main_tradeoff: str
    upfront_comparison: str
    monthly_and_lease_comparison: str
    important_uncertainties: str
    what_could_change_the_decision: str
    statement_ids: list[str] = Field(min_length=5, max_length=5)


class ComparisonAiResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    source: Literal["gemini"]
    main_tradeoff: str
    upfront_comparison: str
    monthly_and_lease_comparison: str
    important_uncertainties: str
    what_could_change_the_decision: str
    statement_ids: list[str] = Field(min_length=5, max_length=5)


def _money(value: Any) -> str:
    amount = Decimal(str(value))
    rendered = f"{abs(amount):,.2f}".removesuffix(".00")
    return f"-${rendered}" if amount < 0 else f"${rendered}"


def comparison_catalog(result: dict[str, Any]) -> dict[str, dict[str, str]]:
    """Create fixed prose from comparison-engine outputs; no client totals are accepted."""
    left, right = result["left"], result["right"]
    diff = result["differences"]["left_minus_right"]
    lm, rm = left["monthly_costs"], right["monthly_costs"]
    lu, ru = left["upfront"], right["upfront"]
    lt, rt = left["lease_totals"], right["lease_totals"]
    duration_differs = result["differences"]["lease_terms_differ"]
    monthly_delta = diff["gross_known_recurring_housing_cost_per_month"]
    upfront_delta = diff["upfront_cash_required"]
    norm_delta = diff["normalized_known_lease_expense_per_month"]
    total_delta = diff["known_modeled_nonrefundable_lease_expense"]
    monthly = (
        f"A's known monthly housing amount is {_money(lm['gross_known_monthly_housing_obligation'])}"
        f"{' (a subtotal)' if not lm['monthly_costs_complete'] else ''}; B's is "
        f"{_money(rm['gross_known_monthly_housing_obligation'])}"
        f"{' (a subtotal)' if not rm['monthly_costs_complete'] else ''}. "
        f"A minus B is {_money(monthly_delta)} per month."
    )
    upfront = (
        f"A's known move-in cash is {_money(lu['upfront_cash_required'])}"
        f"{' (a subtotal)' if not lu['upfront_cash_complete'] else ''}; B's is "
        f"{_money(ru['upfront_cash_required'])}"
        f"{' (a subtotal)' if not ru['upfront_cash_complete'] else ''}. "
        f"A minus B is {_money(upfront_delta)}. Refundable cash held is reported separately "
        f"({_money(lu['refundable_cash_held'])} for A; {_money(ru['refundable_cash_held'])} for B) and is not a lease expense."
    )
    lease = (
        f"Known modeled lease expense is {_money(lt['known_modeled_nonrefundable_lease_cost'])} for A and "
        f"{_money(rt['known_modeled_nonrefundable_lease_cost'])} for B; A minus B is {_money(total_delta)}. "
        f"The normalized monthly difference is {_money(norm_delta)}. "
        + ("Lease lengths differ, so full-term totals cover different periods." if duration_differs else "Both lease terms have the same duration.")
    )
    left_unknown = result["differences"]["unknown_cost_categories"]["left"]
    right_unknown = result["differences"]["unknown_cost_categories"]["right"]
    uncertainty = (
        f"Unconfirmed cost categories: A: {', '.join(left_unknown) if left_unknown else 'none reported'}; "
        f"B: {', '.join(right_unknown) if right_unknown else 'none reported'}. "
        "Incomplete amounts are known subtotals, not complete price estimates."
        if left_unknown or right_unknown else "No unknown cost categories were reported in the modeled terms. Other unmodeled terms may still matter."
    )
    caution = "These measurements do not establish an overall best rental. Confirm complete written payment schedules and compare the terms that matter to your circumstances."
    tradeoff = (
        f"The measured monthly difference is {_money(monthly_delta)} (A minus B), while the move-in cash difference is "
        f"{_money(upfront_delta)}. These are separate tradeoffs, not an overall ranking."
    )
    catalog = {
        "main_tradeoff": {"tradeoff": tradeoff, "no_overall_winner": "The available figures do not establish an overall best choice; the offers differ across measured costs."},
        "upfront_comparison": {"upfront": upfront},
        "monthly_and_lease_comparison": {"monthly_lease": monthly + " " + lease},
        "important_uncertainties": {"uncertainties": uncertainty},
        "what_could_change_the_decision": {"confirm_terms": caution},
    }
    return catalog


def deterministic_comparison_interpretation(result: dict[str, Any]) -> dict[str, str]:
    catalog = comparison_catalog(result)
    return {"source": "deterministic", **{field: next(iter(items.values())) for field, items in catalog.items()}}


def comparison_facts(result: dict[str, Any]) -> dict[str, Any]:
    left, right = result["left"], result["right"]
    diff = result["differences"]["left_minus_right"]
    return {
        "left_monthly_complete": left["monthly_costs"]["monthly_costs_complete"],
        "right_monthly_complete": right["monthly_costs"]["monthly_costs_complete"],
        "left_upfront_complete": left["upfront"]["upfront_cash_complete"],
        "right_upfront_complete": right["upfront"]["upfront_cash_complete"],
        "lease_terms_differ": result["differences"]["lease_terms_differ"],
        "unknown_categories_present": bool(result["differences"]["unknown_cost_categories"]["left"] or result["differences"]["unknown_cost_categories"]["right"]),
        "refundable_cash_present": bool(left["upfront"]["refundable_cash_held"] or right["upfront"]["refundable_cash_held"]),
        "monthly_difference": str(diff["gross_known_recurring_housing_cost_per_month"]),
        "upfront_difference": str(diff["upfront_cash_required"]),
    }


def render_comparison_selection(raw: object, catalog: dict[str, dict[str, str]]) -> dict[str, Any]:
    selection = ComparisonSelection.model_validate(raw)
    fields = ("main_tradeoff", "upfront_comparison", "monthly_and_lease_comparison", "important_uncertainties", "what_could_change_the_decision")
    expected = {field: selection.model_dump()[field] for field in fields}
    selected_ids = [expected[field] for field in fields]
    if len(set(selection.statement_ids)) != 5 or selection.statement_ids != selected_ids:
        raise ValueError("unsupported_comparison_selection")
    # Selection fields are checked against their specific server-owned catalogs.
    if any(expected[field] not in catalog[field] for field in fields):
        raise ValueError("unsupported_comparison_selection")
    return {"source": "gemini", **{field: catalog[field][expected[field]] for field in fields}, "statement_ids": selection.statement_ids}
