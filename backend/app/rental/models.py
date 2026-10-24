"""Strict request models for rental terms and renter finances."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StrictBool, StrictInt, model_validator


CENT = Decimal("0.01")


def parse_money(value: object) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ValueError("Money values must be finite JSON numbers")
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("Money values must be finite JSON numbers") from exc
    if not amount.is_finite():
        raise ValueError("Money values must be finite JSON numbers")
    amount = amount.quantize(CENT, rounding=ROUND_HALF_UP)
    if amount < 0 or amount > Decimal("1000000000.00"):
        raise ValueError("Money values must be between 0 and 1,000,000,000")
    return amount


Money = Annotated[Decimal, BeforeValidator(parse_money)]
PositiveMoney = Annotated[Decimal, BeforeValidator(parse_money), Field(gt=0)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TermProvenance(StrictModel):
    source_type: Literal["user_entered", "document_extracted"] = "user_entered"
    source_reference: str | None = Field(default=None, max_length=500)
    confidence: Annotated[Decimal, Field(ge=0, le=1)] | None = None
    review_state: Literal["needs_review", "confirmed", "corrected"] = "confirmed"

    @model_validator(mode="after")
    def extraction_requires_review(self) -> "TermProvenance":
        if self.source_type == "document_extracted" and self.review_state == "confirmed":
            raise ValueError("Document-extracted terms require explicit user review before confirmation")
        return self


class MoneyTerm(StrictModel):
    """A provided amount, explicitly absent charge, or unavailable amount."""

    status: Literal["provided", "none", "unknown"] = "unknown"
    amount: Money | None = None
    provenance: TermProvenance = Field(default_factory=TermProvenance)

    @model_validator(mode="after")
    def status_matches_amount(self) -> "MoneyTerm":
        if (self.status == "provided") != (self.amount is not None):
            raise ValueError("A provided money term needs an amount; none and unknown terms must omit it")
        if self.status == "none" and self.amount is not None:
            raise ValueError("A term marked none cannot include an amount")
        return self


class RecurringCharge(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    monthly_amount: PositiveMoney
    source_description: str | None = Field(default=None, max_length=500)
    provenance: TermProvenance = Field(default_factory=TermProvenance)


class UtilityTerms(StrictModel):
    status: Literal["included_in_rent", "estimated", "unknown"] = "unknown"
    estimated_monthly_amount: Money | None = None
    source_description: str | None = Field(default=None, max_length=500)
    provenance: TermProvenance = Field(default_factory=TermProvenance)

    @model_validator(mode="after")
    def amount_matches_status(self) -> "UtilityTerms":
        if (self.status == "estimated") != (self.estimated_monthly_amount is not None):
            raise ValueError("Estimated utilities require an amount; other utility statuses omit it")
        return self


class OneTimeCharge(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    amount: PositiveMoney
    refundable: StrictBool = False
    source_description: str | None = Field(default=None, max_length=500)
    provenance: TermProvenance = Field(default_factory=TermProvenance)


class HoldingDeposit(StrictModel):
    amount: PositiveMoney
    treatment: Literal[
        "credited_to_security_deposit", "credited_to_first_month_rent",
        "credited_to_last_month_rent", "credited_to_nonrefundable_fees",
        "not_credited_refundable", "not_credited_nonrefundable",
    ]
    source_description: str | None = Field(default=None, max_length=500)
    provenance: TermProvenance = Field(default_factory=TermProvenance)


class UpfrontTerms(StrictModel):
    security_deposit: MoneyTerm = Field(default_factory=MoneyTerm)
    first_month_rent_due_upfront: Literal["yes", "no", "unknown"] = "unknown"
    first_month_rent_provenance: TermProvenance = Field(default_factory=TermProvenance)
    last_month_rent_due_upfront: Literal["yes", "no", "unknown"] = "unknown"
    last_month_rent_provenance: TermProvenance = Field(default_factory=TermProvenance)
    nonrefundable_fees: list[OneTimeCharge] = Field(default_factory=list, max_length=30)
    nonrefundable_fees_status: Literal["complete", "unknown"] = "unknown"
    nonrefundable_fees_provenance: TermProvenance = Field(default_factory=TermProvenance)
    other_charges: list[OneTimeCharge] = Field(default_factory=list, max_length=30)
    other_charges_status: Literal["complete", "unknown"] = "unknown"
    other_charges_provenance: TermProvenance = Field(default_factory=TermProvenance)
    holding_deposit: HoldingDeposit | None = None
    holding_deposit_status: Literal["provided", "none", "unknown"] = "unknown"
    holding_deposit_status_provenance: TermProvenance = Field(default_factory=TermProvenance)

    @model_validator(mode="after")
    def holding_status_matches(self) -> "UpfrontTerms":
        if (self.holding_deposit_status == "provided") != (self.holding_deposit is not None):
            raise ValueError("Holding-deposit status must match whether its terms are provided")
        if any(item.refundable for item in self.nonrefundable_fees):
            raise ValueError("A nonrefundable fee cannot be marked refundable; use other_charges for refundable amounts")
        return self


class Concession(StrictModel):
    kind: Literal["free_rent_month", "rent_credit", "promotional_credit"]
    month: StrictInt = Field(ge=1, le=120)
    amount: Money | None = None
    eligible_category: Literal["base_rent", "recurring_charge", "utilities"] = "base_rent"
    eligible_charge_name: str | None = Field(default=None, max_length=100)
    source_description: str | None = Field(default=None, max_length=500)
    provenance: TermProvenance = Field(default_factory=TermProvenance)

    @model_validator(mode="after")
    def validate_concession(self) -> "Concession":
        if self.kind == "free_rent_month":
            if self.amount is not None or self.eligible_category != "base_rent":
                raise ValueError("A free-rent month applies to base rent and does not take an amount")
        elif self.amount is None or self.amount <= 0:
            raise ValueError("A rent or promotional credit requires a positive amount")
        if (self.eligible_category == "recurring_charge") != (self.eligible_charge_name is not None):
            raise ValueError("Recurring-charge credits must name the eligible charge")
        return self


class RentalOffer(StrictModel):
    rental_label: str = Field(min_length=1, max_length=120)
    monthly_base_rent: PositiveMoney
    lease_term_months: StrictInt = Field(ge=1, le=120)
    lease_term_provenance: TermProvenance = Field(default_factory=TermProvenance)
    lease_start_date: date | None = None
    occupants: StrictInt | None = Field(default=None, ge=1, le=30)
    expected_roommate_contribution: MoneyTerm = Field(default_factory=MoneyTerm)
    recurring_charges: list[RecurringCharge] = Field(default_factory=list, max_length=50)
    recurring_charges_status: Literal["complete", "unknown"] = "unknown"
    recurring_charges_status_provenance: TermProvenance = Field(default_factory=TermProvenance)
    utilities: UtilityTerms = Field(default_factory=UtilityTerms)
    upfront: UpfrontTerms = Field(default_factory=UpfrontTerms)
    concessions: list[Concession] = Field(default_factory=list, max_length=120)
    base_rent_provenance: TermProvenance = Field(default_factory=TermProvenance)

    @model_validator(mode="after")
    def validate_terms(self) -> "RentalOffer":
        seen = set()
        charge_names = [charge.name.casefold() for charge in self.recurring_charges]
        if len(charge_names) != len(set(charge_names)):
            raise ValueError("Recurring charge names must be unique")
        charge_names = {charge.name.casefold() for charge in self.recurring_charges}
        for concession in self.concessions:
            if concession.month > self.lease_term_months:
                raise ValueError("Concession month must fall within the lease term")
            if concession.kind == "free_rent_month" and concession.month in seen:
                raise ValueError("Only one free-rent concession may apply in a lease month")
            if concession.kind == "free_rent_month":
                seen.add(concession.month)
            if concession.eligible_category == "recurring_charge" and concession.eligible_charge_name.casefold() not in charge_names:
                raise ValueError("Concession names a recurring charge not present in this offer")
        return self


class FinancialProfile(StrictModel):
    monthly_take_home_income: PositiveMoney
    available_savings: Money
    essential_monthly_nonhousing_expenses: Money
    student_loan_payment: Money | None = None
    student_loan_included_in_essential_expenses: StrictBool = True
    monthly_savings_target: Money | None = None
    expected_roommate_contribution: Money | None = None
    minimum_emergency_cash_reserve: Money | None = None
