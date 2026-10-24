"""Cents-based deterministic rental cash-flow and affordability calculations."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from .models import FinancialProfile, RentalOffer


def _cents(value: Decimal | None) -> int:
    return 0 if value is None else int(value * 100)


def _dollars(value: int) -> Decimal:
    return Decimal(value) / 100


def _credit(available: int, credit: int) -> tuple[int, int]:
    applied = min(max(0, available), max(0, credit))
    return available - applied, credit - applied


def _offer_terms(offer: RentalOffer) -> tuple[list[dict[str, Any]], int, int]:
    """Return month schedule, accumulated unused credits and modeled lease costs."""
    base_rent = _cents(offer.monthly_base_rent)
    charges = [(charge.name, _cents(charge.monthly_amount)) for charge in offer.recurring_charges]
    utilities = _cents(offer.utilities.estimated_monthly_amount)
    free_months = {item.month for item in offer.concessions if item.kind == "free_rent_month"}
    schedule: list[dict[str, Any]] = []
    unused_credits = 0
    known_housing_cost = 0
    for month in range(1, offer.lease_term_months + 1):
        rent = 0 if month in free_months else base_rent
        monthly_charges = {name: amount for name, amount in charges}
        monthly_utilities = utilities
        for concession in offer.concessions:
            if concession.month != month or concession.kind == "free_rent_month":
                continue
            credit = _cents(concession.amount)
            if concession.eligible_category == "base_rent":
                rent, unused = _credit(rent, credit)
            elif concession.eligible_category == "recurring_charge":
                name = concession.eligible_charge_name
                actual_name = next(key for key in monthly_charges if key.casefold() == name.casefold())
                monthly_charges[actual_name], unused = _credit(monthly_charges[actual_name], credit)
            else:
                monthly_utilities, unused = _credit(monthly_utilities, credit)
            unused_credits += unused
        charge_total = sum(monthly_charges.values())
        total = rent + charge_total + monthly_utilities
        known_housing_cost += total
        schedule.append({
            "month": month,
            "calendar_month": _calendar_month(offer.lease_start_date, month - 1),
            "base_rent_after_concessions": _dollars(rent),
            "recurring_charges_after_concessions": _dollars(charge_total),
            "estimated_utilities_after_concessions": _dollars(monthly_utilities),
            "gross_contractual_housing_expense": _dollars(total),
            "roommate_contribution": Decimal("0.00"),
            "modeled_renter_housing_share": _dollars(total),
            "rent_prepayment_allocated": Decimal("0.00"),
            "rent_cash_due_this_month": _dollars(rent),
            "monthly_nonrent_cash_due": _dollars(charge_total + monthly_utilities),
        })
    return schedule, unused_credits, known_housing_cost


def _calendar_month(start: Any, offset: int) -> str | None:
    if start is None:
        return None
    month_index = start.year * 12 + (start.month - 1) + offset
    return f"{month_index // 12:04d}-{month_index % 12 + 1:02d}"


def _upfront(offer: RentalOffer, schedule: list[dict[str, Any]]) -> dict[str, Any]:
    terms = offer.upfront
    unknown: list[str] = []
    deposit_status = terms.security_deposit.status
    security = _cents(terms.security_deposit.amount)
    if deposit_status == "unknown": unknown.append("security_deposit")
    if terms.first_month_rent_due_upfront == "unknown": unknown.append("first_month_rent_due_upfront")
    if terms.last_month_rent_due_upfront == "unknown": unknown.append("last_month_rent_due_upfront")
    if terms.nonrefundable_fees_status == "unknown": unknown.append("nonrefundable_fees")
    if terms.other_charges_status == "unknown": unknown.append("other_upfront_charges")
    if terms.holding_deposit_status == "unknown": unknown.append("holding_deposit")

    prepay_months: set[int] = set()
    if terms.first_month_rent_due_upfront == "yes": prepay_months.add(1)
    if terms.last_month_rent_due_upfront == "yes": prepay_months.add(offer.lease_term_months)
    holding = terms.holding_deposit
    if holding and holding.treatment == "credited_to_first_month_rent": prepay_months.add(1)
    if holding and holding.treatment == "credited_to_last_month_rent": prepay_months.add(offer.lease_term_months)
    unknown_timing_months: set[int] = set()
    if terms.first_month_rent_due_upfront == "unknown" and 1 not in prepay_months:
        unknown_timing_months.add(1)
    if terms.last_month_rent_due_upfront == "unknown" and offer.lease_term_months not in prepay_months:
        unknown_timing_months.add(offer.lease_term_months)
    rent_due_upfront = sum(_cents(schedule[index - 1]["base_rent_after_concessions"]) for index in prepay_months)

    nonref_fees = sum(_cents(item.amount) for item in terms.nonrefundable_fees if not item.refundable)
    refundable_fees = sum(_cents(item.amount) for item in terms.nonrefundable_fees if item.refundable)
    other_nonref = sum(_cents(item.amount) for item in terms.other_charges if not item.refundable)
    other_refundable = sum(_cents(item.amount) for item in terms.other_charges if item.refundable)
    holding_cents = _cents(holding.amount) if holding else 0
    holding_credit = 0
    if holding:
        target = holding.treatment
        if target == "credited_to_security_deposit":
            if deposit_status == "none": raise ValueError("Holding-deposit terms credit a security deposit marked as none")
            elif deposit_status != "provided": unknown.append("security_deposit_credit_target")
            elif holding_cents > security: raise ValueError("Holding-deposit credit exceeds the security deposit")
            else: holding_credit = holding_cents
        elif target == "credited_to_first_month_rent":
            rent = _cents(schedule[0]["base_rent_after_concessions"])
            if holding_cents > rent: raise ValueError("Holding-deposit credit exceeds first-month rent")
            holding_credit = holding_cents
        elif target == "credited_to_last_month_rent":
            rent = _cents(schedule[-1]["base_rent_after_concessions"])
            if holding_cents > rent: raise ValueError("Holding-deposit credit exceeds last-month rent")
            holding_credit = holding_cents
        elif target == "credited_to_nonrefundable_fees":
            if terms.nonrefundable_fees_status != "complete": unknown.append("nonrefundable_fee_credit_target")
            elif holding_cents > nonref_fees: raise ValueError("Holding-deposit credit exceeds nonrefundable fees")
            else: holding_credit = holding_cents

    known_upfront = security + rent_due_upfront + nonref_fees + refundable_fees + other_nonref + other_refundable + holding_cents - holding_credit
    if holding and holding.treatment == "not_credited_refundable": refundable_holding = holding_cents
    elif holding and holding.treatment == "not_credited_nonrefundable": other_nonref += holding_cents; refundable_holding = 0
    else: refundable_holding = 0
    refundable_deposits = security + refundable_fees + other_refundable + refundable_holding
    potential_deposit_refund = security + refundable_holding
    nonrefundable_upfront_cost = nonref_fees + other_nonref
    for month in prepay_months:
        amount = _cents(schedule[month - 1]["base_rent_after_concessions"])
        schedule[month - 1]["rent_prepayment_allocated"] = _dollars(amount)
        schedule[month - 1]["rent_cash_due_this_month"] = Decimal("0.00")
    for month in unknown_timing_months:
        schedule[month - 1]["rent_cash_due_this_month"] = None
    return {
        "upfront_cash_required": _dollars(known_upfront),
        "upfront_cash_complete": not unknown,
        "unknown_upfront_terms": sorted(set(unknown)),
        "refundable_cash_held": _dollars(refundable_deposits),
        "potential_deposit_refund_not_guaranteed": _dollars(potential_deposit_refund),
        "other_refundable_upfront_amounts": _dollars(refundable_fees + other_refundable),
        "nonrefundable_upfront_expenses": _dollars(nonrefundable_upfront_cost),
        "prepaid_rent_by_month": {str(i): _dollars(_cents(schedule[i - 1]["rent_prepayment_allocated"])) for i in sorted(prepay_months)},
        "unknown_rent_payment_timing_months": sorted(unknown_timing_months),
        "holding_deposit_paid": _dollars(holding_cents),
    }


def evaluate_rental(offer: RentalOffer | dict[str, Any], profile: FinancialProfile | dict[str, Any] | None = None) -> dict[str, Any]:
    """Evaluate known lease obligations; unknown terms remain explicit in the result."""
    offer = offer if isinstance(offer, RentalOffer) else RentalOffer.model_validate(offer)
    if profile is not None and not isinstance(profile, FinancialProfile):
        profile = FinancialProfile.model_validate(profile)
    provenance_terms = [
        ("base_rent", offer.base_rent_provenance),
        ("lease_term", offer.lease_term_provenance),
        ("recurring_charge_list", offer.recurring_charges_status_provenance),
        ("utilities", offer.utilities.provenance),
        ("security_deposit", offer.upfront.security_deposit.provenance),
        ("first_month_rent_timing", offer.upfront.first_month_rent_provenance),
        ("last_month_rent_timing", offer.upfront.last_month_rent_provenance),
        ("nonrefundable_fees_status", offer.upfront.nonrefundable_fees_provenance),
        ("other_charges_status", offer.upfront.other_charges_provenance),
        ("holding_deposit_status", offer.upfront.holding_deposit_status_provenance),
        ("expected_roommate_contribution", offer.expected_roommate_contribution.provenance),
    ]
    provenance_terms.extend((f"recurring_charge:{item.name}", item.provenance) for item in offer.recurring_charges)
    provenance_terms.extend((f"nonrefundable_fee:{item.name}", item.provenance) for item in offer.upfront.nonrefundable_fees)
    provenance_terms.extend((f"other_charge:{item.name}", item.provenance) for item in offer.upfront.other_charges)
    if offer.upfront.holding_deposit:
        provenance_terms.append(("holding_deposit", offer.upfront.holding_deposit.provenance))
    provenance_terms.extend((f"concession:{item.kind}:month_{item.month}", item.provenance) for item in offer.concessions)
    unreviewed_extracted_terms = [name for name, provenance in provenance_terms if provenance.source_type == "document_extracted" and provenance.review_state == "needs_review"]
    schedule, unused_credits, known_housing_cost = _offer_terms(offer)
    monthly_rent = _cents(offer.monthly_base_rent)
    recurring = sum(_cents(item.monthly_amount) for item in offer.recurring_charges)
    utilities = _cents(offer.utilities.estimated_monthly_amount)
    average_monthly_housing = known_housing_cost // offer.lease_term_months
    monthly_known_housing = monthly_rent + recurring + utilities

    if profile:
        contribution = profile.expected_roommate_contribution
        if contribution is None and offer.expected_roommate_contribution.status == "provided":
            contribution = offer.expected_roommate_contribution.amount
        contribution_cents = _cents(contribution)
        for row in schedule:
            gross = _cents(row["gross_contractual_housing_expense"])
            personal = max(0, gross - contribution_cents)
            row["roommate_contribution"] = _dollars(min(gross, contribution_cents))
            row["modeled_renter_housing_share"] = _dollars(personal)
            rent_cash_due = _cents(row["rent_cash_due_this_month"])
            nonrent_cash = _cents(row["monthly_nonrent_cash_due"])
            cash_remainder = _cents(profile.monthly_take_home_income) - _cents(profile.essential_monthly_nonhousing_expenses)
            if profile.student_loan_payment is not None and not profile.student_loan_included_in_essential_expenses:
                cash_remainder -= _cents(profile.student_loan_payment)
            cash_remainder -= _cents(profile.monthly_savings_target)
            cash_remainder -= personal
            row["cash_remaining_after_expenses_and_savings"] = _dollars(cash_remainder)
            row["in_lease_month_rent_cash_due"] = _dollars(rent_cash_due)
            row["in_lease_month_other_housing_cash_due"] = _dollars(nonrent_cash)
            net_income_after_nonhousing = (
                _cents(profile.monthly_take_home_income)
                - _cents(profile.essential_monthly_nonhousing_expenses)
                - (0 if profile.student_loan_included_in_essential_expenses else _cents(profile.student_loan_payment))
                - _cents(profile.monthly_savings_target)
            )
            scheduled_housing_cash = rent_cash_due + nonrent_cash
            row["cash_remaining_from_monthly_income_after_scheduled_payments"] = _dollars(net_income_after_nonhousing - max(0, scheduled_housing_cash - contribution_cents))
            row["note"] = "Prepaid rent appears in the upfront total and is allocated to this lease month; it is not charged a second time here."
        available_housing = (
            _cents(profile.monthly_take_home_income)
            - _cents(profile.essential_monthly_nonhousing_expenses)
            - (0 if profile.student_loan_included_in_essential_expenses else _cents(profile.student_loan_payment))
            - _cents(profile.monthly_savings_target)
        )
        available_savings = _cents(profile.available_savings)
        emergency_reserve = _cents(profile.minimum_emergency_cash_reserve)
    else:
        contribution_cents = _cents(offer.expected_roommate_contribution.amount) if offer.expected_roommate_contribution.status == "provided" else 0
        for row in schedule:
            gross = _cents(row["gross_contractual_housing_expense"])
            row["roommate_contribution"] = _dollars(min(gross, contribution_cents))
            row["modeled_renter_housing_share"] = _dollars(max(0, gross - contribution_cents))
            row["note"] = "Prepaid rent appears in the upfront total and is allocated to this lease month; it is not charged a second time here."
            row["in_lease_month_rent_cash_due"] = row["rent_cash_due_this_month"]
            row["cash_remaining_from_monthly_income_after_scheduled_payments"] = None
            row["in_lease_month_other_housing_cash_due"] = row["monthly_nonrent_cash_due"]
        available_housing = available_savings = emergency_reserve = None

    upfront = _upfront(offer, schedule)
    for row in schedule:
        row["in_lease_month_rent_cash_due"] = row["rent_cash_due_this_month"]
        if profile:
            net_income_after_nonhousing = (
                _cents(profile.monthly_take_home_income)
                - _cents(profile.essential_monthly_nonhousing_expenses)
                - (0 if profile.student_loan_included_in_essential_expenses else _cents(profile.student_loan_payment))
                - _cents(profile.monthly_savings_target)
            )
            scheduled_housing_cash = _cents(row["rent_cash_due_this_month"]) + _cents(row["monthly_nonrent_cash_due"])
            contribution = _cents(row["roommate_contribution"])
            row["cash_remaining_from_monthly_income_after_scheduled_payments"] = None if row["rent_cash_due_this_month"] is None else _dollars(net_income_after_nonhousing - max(0, scheduled_housing_cash - contribution))
    unknown_costs = []
    if offer.recurring_charges_status == "unknown": unknown_costs.append("recurring_charges")
    if offer.utilities.status == "unknown": unknown_costs.append("utilities")
    unknown_costs.extend(upfront["unknown_upfront_terms"])
    if unreviewed_extracted_terms: unknown_costs.append("unreviewed_extracted_terms")
    modeled_nonrefundable_total = known_housing_cost + _cents(upfront["nonrefundable_upfront_expenses"])
    total_cash_outflows = modeled_nonrefundable_total + _cents(upfront["refundable_cash_held"])
    savings_remaining = None if available_savings is None else available_savings - _cents(upfront["upfront_cash_required"])
    monthly_share = max(0, average_monthly_housing - contribution_cents)
    if profile is None:
        affordability_status = "not_evaluated"
        monthly_remaining = None
    else:
        monthly_remaining = available_housing - monthly_share
        if max(_cents(row["modeled_renter_housing_share"]) for row in schedule) > available_housing:
            affordability_status = "exceeds_budget"
        elif "recurring_charges" in unknown_costs or "utilities" in unknown_costs or "unreviewed_extracted_terms" in unknown_costs:
            affordability_status = "unknown"
        else:
            affordability_status = "within_budget"

    warnings: list[dict[str, str]] = []
    def warn(code: str, message: str) -> None:
        warnings.append({"code": code, "message": message})
    if upfront["upfront_cash_required"] > (profile.available_savings if profile else Decimal("0")) and profile:
        warn("upfront_exceeds_savings", "Known cash required before occupancy exceeds the available savings provided.")
    if profile and emergency_reserve is not None and savings_remaining is not None:
        if savings_remaining < emergency_reserve:
            warn("emergency_reserve_breached", "Known move-in cash would leave savings below the specified emergency reserve.")
        elif not upfront["upfront_cash_complete"]:
            warn("emergency_reserve_unknown", "Unknown upfront terms prevent confirmation that the emergency reserve will remain available.")
    if affordability_status == "exceeds_budget":
        warn("monthly_housing_budget_exceeded", "The known modeled personal housing share exceeds the available monthly housing amount.")
    if affordability_status == "unknown":
        warn("monthly_costs_incomplete", "Monthly affordability cannot be confirmed because one or more monthly cost categories are unknown.")
    if offer.utilities.status == "unknown":
        warn("utilities_unknown", "Utility responsibility or cost is unknown and has not been treated as zero.")
    if offer.recurring_charges_status == "unknown":
        warn("recurring_charges_unknown", "The recurring charge list is not confirmed complete; the displayed subtotal includes only listed charges.")
    if upfront["unknown_upfront_terms"]:
        warn("upfront_terms_unknown", "One or more move-in payment terms are unavailable; the upfront amount is a known subtotal.")
    if upfront["unknown_rent_payment_timing_months"]:
        warn("rent_payment_timing_unknown", "Rent payment timing for one or more lease months is unavailable; those cash-flow entries are left unknown.")
    if unreviewed_extracted_terms:
        warn("extracted_terms_need_review", "Document-extracted terms are shown as provisional until a user reviews them; confidence alone does not confirm them.")
    if contribution_cents > 0:
        warn("roommate_contribution_assumed", "The modeled personal share depends on an expected roommate contribution; contractual liability remains the full household amount.")
    if upfront["potential_deposit_refund_not_guaranteed"] > 0:
        warn("deposit_refund_uncertain", "A potential deposit refund is shown separately and is not guaranteed or included as a cost reduction.")
    if upfront["other_refundable_upfront_amounts"] > 0:
        warn("other_refundable_amount_uncertain", "Other upfront amounts marked refundable are shown as cash held; their return is not guaranteed.")
    if profile and profile.monthly_savings_target is None:
        warn("savings_target_not_provided", "No monthly savings target was supplied; the maximum housing amount uses a $0 savings target.")

    base_net_total = sum(_cents(row["base_rent_after_concessions"]) for row in schedule)
    recurring_net_total = sum(_cents(row["recurring_charges_after_concessions"]) for row in schedule)
    utilities_net_total = sum(_cents(row["estimated_utilities_after_concessions"]) for row in schedule)
    nonrefundable_total_complete = not (
        offer.recurring_charges_status == "unknown"
        or offer.utilities.status == "unknown"
        or offer.upfront.nonrefundable_fees_status == "unknown"
        or offer.upfront.other_charges_status == "unknown"
        or offer.upfront.holding_deposit_status == "unknown"
        or bool(unreviewed_extracted_terms)
    )
    return {
        "rental_label": offer.rental_label,
        "lease": {
            "term_months": offer.lease_term_months,
            "start_date": offer.lease_start_date,
            "occupants": offer.occupants,
            "expected_roommate_contribution": offer.expected_roommate_contribution.amount if offer.expected_roommate_contribution.status == "provided" else None,
        },
        "term_provenance": {
            "base_rent": offer.base_rent_provenance.model_dump(exclude_none=True),
            "lease_term": offer.lease_term_provenance.model_dump(exclude_none=True),
            "recurring_charge_list": offer.recurring_charges_status_provenance.model_dump(exclude_none=True),
            "recurring_charges": [{"name": item.name, "provenance": item.provenance.model_dump(exclude_none=True)} for item in offer.recurring_charges],
            "utilities": offer.utilities.provenance.model_dump(exclude_none=True),
            "security_deposit": offer.upfront.security_deposit.provenance.model_dump(exclude_none=True),
            "first_month_rent_timing": offer.upfront.first_month_rent_provenance.model_dump(exclude_none=True),
            "last_month_rent_timing": offer.upfront.last_month_rent_provenance.model_dump(exclude_none=True),
            "nonrefundable_fees_status": offer.upfront.nonrefundable_fees_provenance.model_dump(exclude_none=True),
            "nonrefundable_fees": [{"name": item.name, "provenance": item.provenance.model_dump(exclude_none=True)} for item in offer.upfront.nonrefundable_fees],
            "other_charges_status": offer.upfront.other_charges_provenance.model_dump(exclude_none=True),
            "other_charges": [{"name": item.name, "provenance": item.provenance.model_dump(exclude_none=True)} for item in offer.upfront.other_charges],
            "holding_deposit": None if offer.upfront.holding_deposit is None else offer.upfront.holding_deposit.provenance.model_dump(exclude_none=True),
            "holding_deposit_status": offer.upfront.holding_deposit_status_provenance.model_dump(exclude_none=True),
            "concessions": [{"kind": item.kind, "month": item.month, "provenance": item.provenance.model_dump(exclude_none=True)} for item in offer.concessions],
            "expected_roommate_contribution": offer.expected_roommate_contribution.provenance.model_dump(exclude_none=True),
            "unreviewed_extracted_terms": unreviewed_extracted_terms,
        },
        "monthly_costs": {
            "base_rent_before_concessions": offer.monthly_base_rent,
            "recurring_charges_known_subtotal": _dollars(recurring),
            "utilities_known_subtotal": _dollars(utilities),
            "gross_known_monthly_housing_obligation": _dollars(monthly_known_housing),
            "average_modeled_housing_obligation": _dollars(average_monthly_housing),
            "monthly_costs_complete": not any(key in unknown_costs for key in ("recurring_charges", "utilities", "unreviewed_extracted_terms")),
            "expected_roommate_contribution": _dollars(contribution_cents),
            "expected_personal_monthly_share": _dollars(monthly_share),
            "total_contractual_liability_remains_gross": True,
        },
        "lease_totals": {
            "expense_scope": "Gross household contractual obligations; expected roommate contributions are not deducted.",
            "base_rent_after_concessions": _dollars(base_net_total),
            "recurring_charges_after_concessions": _dollars(recurring_net_total),
            "estimated_utilities_after_concessions": _dollars(utilities_net_total),
            "known_modeled_nonrefundable_lease_cost": _dollars(modeled_nonrefundable_total),
            "nonrefundable_cost_complete": nonrefundable_total_complete,
            "known_total_cash_outflows_including_refundable_holds": _dollars(total_cash_outflows),
            "cash_outflow_scope": "Gross household cash payments including refundable deposits; excludes any uncertain future refunds.",
            "cash_outflow_total_complete": not unknown_costs,
            "potential_deposit_refund_not_guaranteed": upfront["potential_deposit_refund_not_guaranteed"],
            "unused_concession_credit": _dollars(unused_credits),
        },
        "upfront": upfront,
        "financial_profile": None if profile is None else {
            "input_source": "user_entered",
            "maximum_sustainable_monthly_housing_amount": _dollars(available_housing),
            "known_monthly_cash_remaining_after_housing_and_savings": _dollars(monthly_remaining),
            "initial_savings_remaining_after_known_move_in_cash": _dollars(savings_remaining),
            "emergency_reserve_preserved": None if emergency_reserve is None or (not upfront["upfront_cash_complete"] and savings_remaining >= emergency_reserve) else savings_remaining >= emergency_reserve,
            "affordability_status": affordability_status,
            "roommate_contribution_source": "profile" if profile.expected_roommate_contribution is not None else ("offer" if offer.expected_roommate_contribution.status == "provided" else "none provided"),
        },
        "month_by_month_cash_flow": schedule,
        "unknown_cost_categories": sorted(set(unknown_costs)),
        "assumptions": [
            "All displayed financial amounts are US dollars rounded to cents; calculations use integer cents.",
            "Monthly contractual liability is reported gross. Expected roommate contributions affect only the modeled personal share and do not limit contractual liability.",
            "Utilities marked unknown and incomplete fee lists are not assumed to cost $0; known subtotals are lower bounds where terms are incomplete.",
            "First and last rent paid upfront are prepaid for their corresponding lease months and are excluded from later in-term rent cash due.",
            "Concessions apply only to their named month and eligible category, are capped at that charge, and cannot create negative charges.",
            "Move-in cash is modeled as due before occupancy; recurring monthly charges are due during each lease month.",
            "Student-loan payments are subtracted separately only when supplied and marked as excluded from essential expenses.",
            "Monthly expense-based cash remaining uses the housing expense allocated to that lease month; a separate scheduled-payment balance reflects cash timing after prepaid rent.",
        ],
        "warnings": warnings,
    }
