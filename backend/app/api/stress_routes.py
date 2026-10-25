"""Thin API routes for request-only deterministic rental stress tests."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from .rental_routes import _numeric_json
from .stress_schemas import RentalStressBatchRequest, RentalStressRequest, RentalStressResponse
from backend.app.rental.stress_engine import stress_test_rental

router = APIRouter(prefix="/api/rental", tags=["rental stress testing"])


@router.post("/stress-test", response_model=RentalStressResponse)
def rental_stress_test(request: RentalStressRequest) -> dict[str, Any]:
    try:
        return _numeric_json(stress_test_rental(request.offer, request.financial_profile, request.scenario))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.post("/stress-test/batch")
def rental_stress_batch(request: RentalStressBatchRequest) -> dict[str, Any]:
    try:
        return {"results": [
            _numeric_json(stress_test_rental(request.offer, request.financial_profile, scenario))
            for scenario in request.scenarios
        ], "comparison_basis": "Each scenario is evaluated independently against the same original offer and financial profile; scenarios are not compounded."}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
