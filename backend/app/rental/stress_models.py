"""Strict request models for deterministic rental stress scenarios."""
from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, model_validator

from .models import FinancialProfile, Money, PositiveMoney, RentalOffer, TermProvenance


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UtilityIncrease(StrictModel):
    type: Literal["utility_increase"]
    additional_monthly_amount: PositiveMoney
    first_affected_month: StrictInt = Field(ge=1, le=120)
    last_affected_month: StrictInt = Field(ge=1, le=120)

    @model_validator(mode="after")
    def valid_range(self):
        if self.last_affected_month < self.first_affected_month:
            raise ValueError("last_affected_month must be on or after first_affected_month")
        return self


class RoommateContributionLoss(StrictModel):
    type: Literal["roommate_contribution_loss"]
    monthly_contribution_lost: PositiveMoney
    first_affected_month: StrictInt = Field(ge=1, le=120)
    last_affected_month: StrictInt = Field(ge=1, le=120)

    @model_validator(mode="after")
    def valid_range(self):
        if self.last_affected_month < self.first_affected_month:
            raise ValueError("last_affected_month must be on or after first_affected_month")
        return self


class DepartureCharge(StrictModel):
    name: StrictStr = Field(min_length=1, max_length=100)
    amount: PositiveMoney


class EarlyDeparture(StrictModel):
    type: Literal["early_departure"]
    departure_month: StrictInt = Field(ge=1, le=120, description="Last month the renter plans to occupy the home")
    treatment: Literal[
        "known_contractual_termination", "hypothetical_settlement",
        "continuing_lease_obligations", "unknown_consequences",
    ]
    termination_fee: Money | None = None
    termination_fee_source: StrictStr | None = Field(default=None, max_length=500)
    termination_fee_provenance: TermProvenance | None = None
    assumption_note: StrictStr | None = Field(default=None, max_length=500)
    remaining_rent_treatment: Literal["unknown", "specified", "none_confirmed"] = "unknown"
    continuing_rent_monthly_amount: Money | None = None
    continuing_rent_months: StrictInt | None = Field(default=None, ge=1, le=120)
    other_departure_charges: list[DepartureCharge] = Field(default_factory=list, max_length=20)
    deposit_treatment: Literal["unknown", "withheld", "refunded"] = "unknown"
    deposit_amount_override: Money | None = None
    deposit_treatment_note: StrictStr | None = Field(default=None, max_length=500)
    prepaid_rent_treatment: Literal["unknown", "retained", "refunded"] = "unknown"

    @model_validator(mode="after")
    def validate_treatment(self):
        if (self.continuing_rent_monthly_amount is None) != (self.continuing_rent_months is None):
            raise ValueError("Specify both continuing_rent_monthly_amount and continuing_rent_months, or neither")
        if (self.continuing_rent_monthly_amount is not None) != (self.remaining_rent_treatment == "specified"):
            raise ValueError("Specified remaining rent treatment requires both explicit rent amount and month count")
        if self.continuing_rent_monthly_amount is not None and self.continuing_rent_monthly_amount <= 0:
            raise ValueError("Specified continuing rent must be a positive monthly amount")
        if self.treatment == "known_contractual_termination":
            if self.termination_fee is None or not self.termination_fee_source or self.termination_fee_provenance is None or not self.termination_fee_provenance.source_reference:
                raise ValueError("Known contractual termination requires an explicit fee, reviewed provenance, and lease source")
            if not self.termination_fee_source.strip():
                raise ValueError("termination_fee_source cannot be blank")
            if self.termination_fee_provenance.review_state == "needs_review":
                raise ValueError("Known contractual termination fee must be reviewed and confirmed")
            if self.termination_fee_provenance.source_type == "document_extracted" and not self.termination_fee_provenance.reviewed_by_user:
                raise ValueError("Extracted termination fees require explicit user confirmation")
        elif self.treatment == "hypothetical_settlement":
            if self.termination_fee is None or not self.assumption_note or not self.assumption_note.strip():
                raise ValueError("Hypothetical settlement requires an explicit fee and assumption note")
            if self.termination_fee_source is not None or self.termination_fee_provenance is not None:
                raise ValueError("Hypothetical settlement fees must be labeled as user assumptions, not contract terms")
            if self.remaining_rent_treatment == "none_confirmed" and not self.assumption_note:
                raise ValueError("Confirming no remaining rent requires an assumption note")
        elif self.treatment == "continuing_lease_obligations":
            if self.termination_fee is not None or self.termination_fee_source is not None or self.termination_fee_provenance is not None:
                raise ValueError("Continuing-obligations treatment cannot also assume a termination fee")
            if self.continuing_rent_monthly_amount is None or self.continuing_rent_months is None:
                raise ValueError("Continuing-obligations treatment requires explicit rent amount and month count")
            if not self.assumption_note or not self.assumption_note.strip():
                raise ValueError("Continuing obligations require an assumption/source note")
            if self.remaining_rent_treatment != "specified":
                raise ValueError("Continuing obligations must specify the treatment and amount of remaining rent")
        if self.treatment == "known_contractual_termination" and self.remaining_rent_treatment == "none_confirmed" and not self.termination_fee_source:
            raise ValueError("Confirming no remaining rent requires a reviewed lease source")
        if self.treatment == "unknown_consequences" and any((self.termination_fee is not None, self.termination_fee_provenance is not None, self.remaining_rent_treatment != "unknown", self.continuing_rent_monthly_amount is not None,
                  self.other_departure_charges, self.deposit_treatment != "unknown",
                  self.prepaid_rent_treatment != "unknown")):
            raise ValueError("Unknown-consequences treatment cannot include modeled settlement amounts")
        if self.deposit_treatment != "unknown" and not (self.deposit_treatment_note and self.deposit_treatment_note.strip()):
            raise ValueError("A deposit outcome assumption requires a note")
        if self.deposit_amount_override is not None and self.deposit_treatment == "unknown":
            raise ValueError("A deposit amount override requires an explicit deposit outcome")
        return self


StressScenario = Annotated[
    Union[UtilityIncrease, RoommateContributionLoss, EarlyDeparture],
    Field(discriminator="type"),
]


class RentalStressRequest(StrictModel):
    offer: RentalOffer
    financial_profile: FinancialProfile | None = None
    scenario: StressScenario


class RentalStressBatchRequest(StrictModel):
    offer: RentalOffer
    financial_profile: FinancialProfile | None = None
    scenarios: list[StressScenario] = Field(min_length=1, max_length=10)
