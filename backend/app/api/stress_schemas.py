"""Validated request and JSON-compatible response models for rental stress tests."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from backend.app.rental.stress_models import RentalStressBatchRequest, RentalStressRequest
from backend.app.ai_explanations.stress_explanations import StressInterpretation


class RentalStressResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    scenario_type: str
    assumptions: dict[str, Any]
    affected_months: list[int]
    baseline: dict[str, Any]
    stressed: dict[str, Any]
    summary: dict[str, Any]
    warnings: list[dict[str, str]]
    explanation: str
    result_is_hypothetical_not_a_forecast: bool
    interpretation: StressInterpretation


class StressExplanationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: Literal["gemini"]
    headline: str
    what_changed: str
    main_consequence: str
    why_it_matters: str
    what_to_watch: str
    what_to_consider: str
    statement_ids: list[str]


__all__ = ["RentalStressRequest", "RentalStressBatchRequest", "RentalStressResponse", "StressExplanationResponse"]
