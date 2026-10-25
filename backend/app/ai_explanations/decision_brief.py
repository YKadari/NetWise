"""Server-owned rental facts, eligible narratives, and strict model selections."""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.app.rental.models import RentalOffer


class BriefSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    headline: str = Field(min_length=1, max_length=80)
    overall_summary: str = Field(min_length=1, max_length=80)
    important_findings: list[str] = Field(min_length=1, max_length=3)
    key_uncertainties: list[str] = Field(max_length=3)
    suggested_next_step: str = Field(min_length=1, max_length=80)
    follow_up_ids: list[str] = Field(max_length=3)


class BriefResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    source: Literal["gemini"]
    headline: str
    overall_summary: str
    important_findings: list[str]
    key_uncertainties: list[str]
    suggested_next_step: str
    fact_ids: list[str]
    follow_ups: list[dict[str, str | None]]
    additional_follow_ups: list[dict[str, str | None]]


class FollowUpResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    source: Literal["deterministic"]
    follow_ups: list[dict[str, str | None]]
    additional_follow_ups: list[dict[str, str | None]]


def _money(value: Any) -> str:
    return f"${Decimal(str(value)):,.2f}".removesuffix(".00")


def build_context(offer: RentalOffer, evaluation: dict[str, Any]) -> dict[str, Any]:
    """Never include labels, source text, names, or raw financial-profile inputs."""
    monthly = evaluation["monthly_costs"]
    upfront = evaluation["upfront"]
    total = evaluation["lease_totals"]
    profile = evaluation["financial_profile"]
    allowed_unknowns = {
        "recurring_charges", "utilities", "security_deposit", "first_month_rent_due_upfront",
        "last_month_rent_due_upfront", "nonrefundable_fees", "other_upfront_charges", "holding_deposit",
        "security_deposit_credit_target", "nonrefundable_fee_credit_target", "unreviewed_extracted_terms",
    }
    unknowns = sorted(set(evaluation["unknown_cost_categories"]) & allowed_unknowns)
    has_other_unknown = bool(set(evaluation["unknown_cost_categories"]) - allowed_unknowns)
    return {
        "advertised_monthly_rent": _money(monthly["base_rent_before_concessions"]),
        "known_monthly_housing": _money(monthly["gross_known_monthly_housing_obligation"]),
        "monthly_above_advertised": _money(max(Decimal("0"), Decimal(str(monthly["gross_known_monthly_housing_obligation"])) - Decimal(str(monthly["base_rent_before_concessions"])))),
        "has_monthly_extra": Decimal(str(monthly["gross_known_monthly_housing_obligation"])) > Decimal(str(monthly["base_rent_before_concessions"])),
        "monthly_complete": monthly["monthly_costs_complete"],
        "known_upfront_cash": _money(upfront["upfront_cash_required"]),
        "upfront_complete": upfront["upfront_cash_complete"],
        "known_lease_expense": _money(total["known_modeled_nonrefundable_lease_cost"]),
        "lease_complete": total["nonrefundable_cost_complete"],
        "lease_months": evaluation["lease"]["term_months"],
        "refundable_cash_held": _money(upfront["refundable_cash_held"]),
        "has_refundable_cash": Decimal(str(upfront["refundable_cash_held"])) > 0,
        "utilities_estimated": offer.utilities.status == "estimated",
        "has_prepaid_rent": bool(upfront["prepaid_rent_by_month"]),
        "has_roommate_assumption": Decimal(str(monthly["expected_roommate_contribution"])) > 0,
        "unknown_categories": unknowns,
        "has_other_unknown": has_other_unknown,
        "affordability_status": profile["affordability_status"] if profile else "not_evaluated",
        "reserve_preserved": profile["emergency_reserve_preserved"] if profile else None,
    }


def statement_catalog(facts: dict[str, Any]) -> dict[str, dict[str, str]]:
    """All monetary text is rendered here from evaluator facts, never model prose."""
    monthly_label = "Identified monthly housing cost" if facts["monthly_complete"] else "Known monthly housing subtotal"
    if facts["utilities_estimated"]:
        monthly_label += " (including estimated utilities)"
    upfront_label = "Move-in cash" if facts["upfront_complete"] else "Known move-in cash subtotal"
    lease_label = "Modeled lease expense" if facts["lease_complete"] else "Known lease expense subtotal"
    headlines = {"commitment": "Look beyond the advertised rent."}
    if not all(facts[k] for k in ("monthly_complete", "upfront_complete", "lease_complete")):
        headlines["unknowns"] = "Some costs need answers before you commit."
    if facts["has_refundable_cash"]:
        headlines["move_in"] = "Plan for cash held before move-in."
    summaries = {
        "monthly": f"{monthly_label} is {facts['known_monthly_housing']} versus {facts['advertised_monthly_rent']} advertised. {upfront_label} is {facts['known_upfront_cash']}.",
        "commitment": f"{upfront_label} is {facts['known_upfront_cash']}; {lease_label.lower()} over {facts['lease_months']} months is {facts['known_lease_expense']}.",
    }
    findings = {
        "monthly": f"{monthly_label}: {facts['known_monthly_housing']}. " + (f"That is {facts['monthly_above_advertised']} above the advertised rent and remains the household's gross obligation." if facts["has_monthly_extra"] else "No additional monthly charge has been identified; incomplete categories could change this." if not facts["monthly_complete"] else "No additional monthly charge is represented in the confirmed terms."),
        "upfront": f"{upfront_label}: {facts['known_upfront_cash']}. This is cash due before occupancy, not all extra expense.",
        "lease": f"{lease_label} for {facts['lease_months']} months: {facts['known_lease_expense']}. Refundable holds are excluded.",
    }
    if facts["has_refundable_cash"]:
        findings["deposit"] = f"{facts['refundable_cash_held']} is held as potentially refundable cash; its return is not guaranteed and it is not added to lease expense."
    if facts["has_prepaid_rent"]:
        findings["prepaid"] = "Prepaid rent raises move-in cash but is allocated to a lease month, not charged as an extra month of rent."
    if facts["utilities_estimated"]:
        findings["utilities_estimate"] = "The identified utility amount is an estimate, so actual bills may differ."
    if facts["has_roommate_assumption"]:
        findings["roommate"] = "The personal-share estimate assumes a roommate contribution; the modeled household obligation remains gross."
    if facts["reserve_preserved"] is False:
        findings["reserve"] = "Known move-in cash may leave less than the renter's stated emergency reserve; unknown upfront terms add uncertainty."
    if facts["affordability_status"] == "exceeds_budget":
        findings["budget"] = "The modeled personal housing share exceeds the amount available under the supplied financial profile."
    uncertainty = {}
    names = {
        "recurring_charges": "The required monthly fee list is not confirmed complete.",
        "utilities": "Utility responsibility or cost is still unknown.",
        "security_deposit": "The security deposit amount or refund treatment is unconfirmed.",
        "first_month_rent_due_upfront": "First-month rent payment timing is unconfirmed.",
        "last_month_rent_due_upfront": "Last-month rent prepayment is unconfirmed.",
        "nonrefundable_fees": "One-time nonrefundable fees are not confirmed complete.",
        "other_upfront_charges": "Other move-in charges are not confirmed complete.",
        "holding_deposit": "The holding deposit or its treatment is unconfirmed.",
        "security_deposit_credit_target": "The holding deposit's credit toward a security deposit is unconfirmed.",
        "nonrefundable_fee_credit_target": "The holding deposit's credit toward fees is unconfirmed.",
        "unreviewed_extracted_terms": "Some extracted terms still need human review.",
    }
    for key in facts["unknown_categories"]:
        uncertainty[key] = names[key]
    if facts["has_other_unknown"]:
        uncertainty["other_unconfirmed_term"] = "Another rental term remains unconfirmed and is excluded from a complete assessment."
    if facts["utilities_estimated"]:
        uncertainty["estimated_utilities"] = "Utility costs are estimated rather than guaranteed."
    steps = {"early_departure": "Ask what rent or fees remain if you need to leave before the lease ends."}
    if "recurring_charges" in uncertainty or "utilities" in uncertainty:
        steps["monthly_schedule"] = "Request the complete required monthly fee and utility schedule in writing."
    if any(key in uncertainty for key in ("nonrefundable_fees", "other_upfront_charges", "holding_deposit", "security_deposit", "security_deposit_credit_target", "nonrefundable_fee_credit_target", "other_unconfirmed_term")):
        steps["move_in_terms"] = "Request an itemized move-in payment list and written refund or credit terms."
    return {"headline": headlines, "overall_summary": summaries, "important_findings": findings, "key_uncertainties": uncertainty, "suggested_next_step": steps}


def follow_up_catalog(offer: RentalOffer, facts: dict[str, Any]) -> dict[str, dict[str, str | None]]:
    """Create only questions supported by validated offer/evaluator completeness facts."""
    candidates: dict[str, dict[str, str | None]] = {}
    rent = facts["advertised_monthly_rent"]
    unknowns = set(facts["unknown_categories"])
    if "recurring_charges" in unknowns:
        candidates["monthly_fees"] = {
            "title": "Confirm required monthly fees",
            "why_it_matters": "The complete required-fee schedule is not confirmed, so the monthly subtotal may change.",
            "question": f"Could you provide a written list of every required monthly charge beyond the {rent} advertised rent, including any building, internet, trash, or service fees?",
            "priority": "Ongoing cost",
            "facts": "Required monthly charge list is incomplete; advertised rent is known.",
        }
    if "utilities" in unknowns or facts["utilities_estimated"]:
        why = "Utility responsibility or cost is unknown." if "utilities" in unknowns else "The utility amount is an estimate, so actual bills may differ."
        candidates["utilities"] = {
            "title": "Clarify utility costs",
            "why_it_matters": why,
            "question": "Which utilities are included, and can you share typical monthly costs for this unit?",
            "priority": "Monthly estimate",
            "facts": "Utilities are unknown or explicitly estimated in the validated offer.",
        }
    upfront_unknowns = unknowns & {"first_month_rent_due_upfront", "last_month_rent_due_upfront", "nonrefundable_fees", "other_upfront_charges", "holding_deposit", "security_deposit_credit_target", "nonrefundable_fee_credit_target"}
    if upfront_unknowns:
        candidates["move_in_costs"] = {
            "title": "Confirm move-in payments",
            "why_it_matters": "Some move-in payment amounts, timing, or credits are still unconfirmed.",
            "question": "Could you send an itemized list of all payments due before move-in, when each is due, and whether any payment is credited or refundable?",
            "priority": "Before move-in",
            "facts": "The evaluator marked one or more upfront payment terms unknown.",
        }
    deposit = offer.upfront.security_deposit
    if "security_deposit" in unknowns:
        candidates["security_deposit"] = {
            "title": "Confirm the security deposit",
            "why_it_matters": "The deposit amount or its treatment is unconfirmed, so move-in cash and refundable cash held are incomplete.",
            "question": "Is a security deposit required? If so, what is the amount and what written conditions apply to its return?",
            "priority": "Before move-in",
            "facts": "Security deposit amount or treatment is unknown.",
        }
    elif deposit.status == "provided":
        candidates["deposit_return"] = {
            "title": "Confirm deposit return terms",
            "why_it_matters": "The deposit is counted as potentially refundable cash held; its return is not guaranteed.",
            "question": f"Could you confirm the conditions for receiving the { _money(deposit.amount) } security deposit back and provide those terms in writing?",
            "priority": "Refund terms",
            "facts": "A security deposit amount is explicitly provided; return is not guaranteed by the evaluator.",
        }
    if offer.upfront.holding_deposit_status == "unknown":
        candidates["holding_deposit"] = {
            "title": "Clarify any holding deposit",
            "why_it_matters": "Whether a holding deposit is required and how it is credited or refunded is not confirmed.",
            "question": "Is a holding deposit required? If so, how much is it, and when is it credited or refunded?",
            "priority": "Before move-in",
            "facts": "Holding deposit status is unknown.",
        }
    roommate = offer.expected_roommate_contribution
    profile = facts["has_roommate_assumption"]
    if roommate.status == "unknown" and offer.expected_roommate_contribution.status != "none":
        # The unknown default alone is not proof of roommate dependence. Only ask if the
        # financial profile actually supplied an expected contribution.
        if profile:
            candidates["roommate_amount"] = {
                "title": "Check the roommate contribution assumption",
                "why_it_matters": "The personal-share estimate depends on an expected roommate contribution.",
                "question": "What monthly amount can each roommate commit to, and when will payments be due?",
                "priority": "Shared payment assumption",
                "facts": "The financial profile includes a roommate contribution assumption.",
            }
    elif roommate.status == "provided" or facts["has_roommate_assumption"]:
        candidates["roommate_liability"] = {
            "title": "Understand shared rent responsibility",
            "why_it_matters": "The personal-share estimate uses a roommate contribution, while the modeled household obligation remains gross.",
            "question": "If one roommate stops paying, are all tenants still responsible for the full rent under the agreement?",
            "priority": "Shared payment assumption",
            "facts": "A roommate contribution is modeled; household contractual liability remains gross.",
        }
    if facts["reserve_preserved"] is False:
        candidates["reserve"] = {
            "title": "Check cash needed at move-in",
            "why_it_matters": "The current known move-in cash may leave less than the reserve amount in the supplied profile; unknown charges could change the result.",
            "question": "Could you confirm the complete move-in amount in writing, including every deposit, fee, and prepaid rent item?",
            "priority": "Cash flexibility",
            "facts": "The evaluator reports the supplied emergency reserve is not preserved after known move-in cash.",
        }
    # This is an objective ordering of missing/estimated commitments, not a prediction
    # of harm. Gemini can select and order up to three of the same eligible candidates.
    return candidates


def render_follow_ups(ids: list[str], catalog: dict[str, dict[str, str | None]], source: str) -> dict[str, Any]:
    if len(ids) != len(set(ids)) or any(identifier not in catalog for identifier in ids):
        raise ValueError("unsupported_follow_up_selection")
    selected = [catalog[identifier] for identifier in ids]
    remaining = [candidate for identifier, candidate in catalog.items() if identifier not in ids]
    return {"source": source, "follow_ups": selected, "additional_follow_ups": remaining}


def render_selection(raw: object, catalog: dict[str, dict[str, str]], follow_ups: dict[str, dict[str, str | None]] | None = None) -> dict[str, Any]:
    follow_ups = follow_ups or {}
    selection = BriefSelection.model_validate(raw)
    selected = selection.model_dump()
    for field, choices in catalog.items():
        ids = selected[field] if isinstance(selected[field], list) else [selected[field]]
        if len(ids) != len(set(ids)) or any(identifier not in choices for identifier in ids) or (field == "key_uncertainties" and choices and not ids):
            raise ValueError("unsupported_brief_selection")
    follow_ids = selected["follow_up_ids"]
    if len(follow_ids) != min(3, len(follow_ups)):
        raise ValueError("unsupported_follow_up_selection")
    rendered_follow_ups = render_follow_ups(follow_ids, follow_ups, "gemini")
    return {
        "source": "gemini",
        **{field: [choices[identifier] for identifier in selected[field]] if isinstance(selected[field], list) else choices[selected[field]] for field, choices in catalog.items()},
        "fact_ids": sorted({identifier for field, value in selected.items() if field != "follow_up_ids" for identifier in (value if isinstance(value, list) else [value])}),
        "follow_ups": rendered_follow_ups["follow_ups"],
        "additional_follow_ups": rendered_follow_ups["additional_follow_ups"],
    }
