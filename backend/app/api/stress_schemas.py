"""Validated request and JSON-compatible response models for rental stress tests."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict

from backend.app.rental.stress_models import RentalStressBatchRequest, RentalStressRequest


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


__all__ = ["RentalStressRequest", "RentalStressBatchRequest", "RentalStressResponse"]
