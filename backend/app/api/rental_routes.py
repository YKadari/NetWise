"""Thin HTTP routes for ephemeral rental-cost calculations."""

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException

from backend.app.api.rental_schemas import (
    RentalCompareRequest,
    RentalComparisonResponse,
    RentalEvaluateRequest,
    RentalEvaluationResponse,
)
from backend.app.rental.calculations import evaluate_rental
from backend.app.rental.comparisons import compare_rentals


router = APIRouter(prefix="/api/rental", tags=["rental commitments"])


def _numeric_json(value: Any) -> Any:
    """Keep monetary values as JSON numbers at the HTTP boundary."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {key: _numeric_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_numeric_json(item) for item in value]
    return value


@router.post("/evaluate", response_model=RentalEvaluationResponse)
def rental_evaluate(request: RentalEvaluateRequest) -> dict[str, object]:
    try:
        return _numeric_json(evaluate_rental(request.offer, request.financial_profile))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/compare", response_model=RentalComparisonResponse)
def rental_compare(request: RentalCompareRequest) -> dict[str, object]:
    try:
        return _numeric_json(compare_rentals(request.left_offer, request.right_offer, request.financial_profile))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
