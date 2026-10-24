"""Request and response schemas for the local rental financial API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from backend.app.rental.models import FinancialProfile, RentalOffer


class RentalEvaluateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    offer: RentalOffer
    financial_profile: FinancialProfile | None = None


class RentalCompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    left_offer: RentalOffer
    right_offer: RentalOffer
    financial_profile: FinancialProfile | None = None


class RentalEvaluationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rental_label: str
    lease: dict[str, Any]
    term_provenance: dict[str, Any]
    monthly_costs: dict[str, Any]
    lease_totals: dict[str, Any]
    upfront: dict[str, Any]
    financial_profile: dict[str, Any] | None
    month_by_month_cash_flow: list[dict[str, Any]]
    unknown_cost_categories: list[str]
    assumptions: list[str]
    warnings: list[dict[str, str]]


class RentalComparisonResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    left: RentalEvaluationResponse
    right: RentalEvaluationResponse
    differences: dict[str, Any]
    comparison_notes: list[str]
    method: str


__all__ = ["RentalEvaluateRequest", "RentalCompareRequest", "RentalEvaluationResponse", "RentalComparisonResponse"]
