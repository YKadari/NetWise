"""Strict intermediate schemas for candidate lease facts and human review."""
from __future__ import annotations

from typing import Any, Literal
import math

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, model_validator


FieldId = Literal[
    "rental_label", "monthly_base_rent", "lease_term_months", "lease_start_date", "occupants",
    "recurring_charges", "recurring_charges_status", "utilities", "security_deposit",
    "first_month_rent_due_upfront", "last_month_rent_due_upfront", "nonrefundable_fees",
    "nonrefundable_fees_status", "other_charges", "other_charges_status", "holding_deposit",
    "holding_deposit_status", "concessions", "early_termination", "lease_break_fee",
    "notice_requirements", "renewal_or_rent_change", "late_payment_fees",
    "roommate_liability", "conditional_concessions",
]
Status = Literal["explicit", "not_found", "ambiguous", "contradictory"]
ReviewState = Literal["needs_review", "accepted", "corrected", "unknown", "confirmed_none"]
JsonScalar = str | int | float | bool | None
JsonObject = dict[str, JsonScalar | list[JsonScalar]]
Value = JsonScalar | list[JsonObject] | JsonObject


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CandidateTerm(StrictModel):
    field_id: FieldId
    value: Value = None
    source_excerpt: str | None = Field(default=None, max_length=1500)
    page_reference: int | None = Field(default=None, ge=1, le=1000)
    status: Status
    uncertainty_note: str | None = Field(default=None, max_length=1000)
    evidence_verification: Literal["verified_text", "verified_page", "unverified", "missing"] = "missing"
    review_state: Literal["needs_review"] = "needs_review"

    @model_validator(mode="after")
    def validate_candidate(self):
        if self.status == "explicit" and self.value is None:
            raise ValueError("Explicit terms require a value")
        if self.status != "explicit" and self.value is not None:
            raise ValueError("Non-explicit terms cannot contain a value")
        if self.status == "explicit" and not self.source_excerpt:
            raise ValueError("Explicit terms require supporting evidence")
        if self.field_id in {"monthly_base_rent", "security_deposit", "lease_break_fee"} and isinstance(self.value, (int, float)):
            if isinstance(self.value, bool) or not math.isfinite(float(self.value)) or self.value < 0:
                raise ValueError("Amounts must be nonnegative numbers")
        if self.field_id in {"monthly_base_rent", "security_deposit"} and self.status == "explicit":
            if isinstance(self.value, bool) or not isinstance(self.value, (int, float)):
                raise ValueError("Rent and deposit values must be numeric")
        if self.field_id == "monthly_base_rent" and self.status == "explicit" and self.value <= 0:
            raise ValueError("Monthly base rent must be positive")
        def validate_amounts(value: Any, key: str = "") -> None:
            if isinstance(value, dict):
                for child_key, child in value.items():
                    validate_amounts(child, str(child_key))
            elif isinstance(value, list):
                for child in value:
                    validate_amounts(child, key)
            elif any(word in key.casefold() for word in ("amount", "rent", "fee", "deposit", "charge", "credit")) and isinstance(value, (int, float)):
                if isinstance(value, bool) or not math.isfinite(float(value)) or value < 0:
                    raise ValueError("Extracted monetary amounts must be finite and nonnegative")
        validate_amounts(self.value)
        if self.field_id == "lease_term_months" and self.status == "explicit":
            if isinstance(self.value, bool) or not isinstance(self.value, int) or not 1 <= self.value <= 120:
                raise ValueError("Lease duration must be a whole number of months from 1 to 120")
        if self.field_id == "occupants" and self.status == "explicit":
            if isinstance(self.value, bool) or not isinstance(self.value, int) or not 1 <= self.value <= 30:
                raise ValueError("Occupant count must be a whole number from 1 to 30")
        return self


class LeaseExtraction(StrictModel):
    terms: list[CandidateTerm] = Field(min_length=1, max_length=80)
    general_warnings: list[StrictStr] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def unique_fields(self):
        ids = [t.field_id for t in self.terms]
        if len(ids) != len(set(ids)):
            raise ValueError("Each lease field must appear at most once")
        return self


class LeaseTextRequest(StrictModel):
    text: StrictStr = Field(min_length=1, max_length=120_000)

    @model_validator(mode="after")
    def not_blank(self):
        if not self.text.strip():
            raise ValueError("Lease text cannot be blank")
        return self


class LeaseDraft(StrictModel):
    draft_id: str
    terms: list[CandidateTerm]
    general_warnings: list[str]
    review_required: StrictBool = True
    source_type: Literal["pasted_text", "pdf"]


class ReviewDecision(StrictModel):
    field_id: FieldId
    action: Literal["accept", "correct", "mark_unknown", "confirm_none"]
    value: Value = None

    @model_validator(mode="after")
    def action_matches_value(self):
        if self.action == "correct" and self.value is None:
            raise ValueError("Corrected values must be supplied explicitly")
        if self.action != "correct" and self.value is not None:
            raise ValueError("Only a correction action may supply a value")
        return self


class ConfirmRequest(StrictModel):
    draft: LeaseDraft
    decisions: list[ReviewDecision] = Field(min_length=1, max_length=80)
    financial_profile: dict[str, Any] | None = None

    @model_validator(mode="after")
    def unique_decisions(self):
        ids = [d.field_id for d in self.decisions]
        if len(ids) != len(set(ids)):
            raise ValueError("Review decisions must have unique field identifiers")
        return self
