"""Thin API routes for request-only deterministic rental stress tests."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from backend.app.ai_explanations.provider import generate_selection
from backend.app.ai_explanations.stress_explanations import build_stress_explanation, render_ai_stress, render_deterministic_stress
from backend.app.api.lease_routes import _limit_extraction_requests
from backend.app.lease_extraction.config import extraction_enabled
from backend.app.lease_extraction.provider import GeminiConfigurationError, GeminiOutputError, GeminiProviderError, GeminiQuotaError
from .rental_routes import _numeric_json
from .stress_schemas import RentalStressBatchRequest, RentalStressRequest, RentalStressResponse, StressExplanationResponse
from backend.app.rental.stress_engine import stress_test_rental

router = APIRouter(prefix="/api/rental", tags=["rental stress testing"])


@router.post("/stress-test", response_model=RentalStressResponse)
def rental_stress_test(request: RentalStressRequest) -> dict[str, Any]:
    try:
        result = _numeric_json(stress_test_rental(request.offer, request.financial_profile, request.scenario))
        _, catalog = build_stress_explanation(request.offer, request.financial_profile, result)
        result["interpretation"] = render_deterministic_stress(result, catalog)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


@router.post("/stress-explanation", response_model=StressExplanationResponse)
def rental_stress_explanation(request: RentalStressRequest, http_request: Request) -> dict[str, Any]:
    if not extraction_enabled():
        raise HTTPException(status_code=503, detail="AI scenario explanations are unavailable on this service")
    _limit_extraction_requests(http_request)
    try:
        # The same backend engine recomputes baseline and stress results from validated inputs.
        result = _numeric_json(stress_test_rental(request.offer, request.financial_profile, request.scenario))
        facts, catalog = build_stress_explanation(request.offer, request.financial_profile, result)
        selected = generate_selection(
            facts,
            catalog,
            task_instruction=("For a financial stress-test interpretation, select exactly one eligible ID for each requested field. "
                              "Choose a coherent, scenario-specific set. Return IDs only; never create claims or monetary values."),
        )
        return render_ai_stress(selected, catalog)
    except (ValidationError, GeminiOutputError):
        raise HTTPException(status_code=502, detail="AI scenario explanation could not be verified") from None
    except ValueError as exc:
        if str(exc) == "unsupported_stress_selection":
            raise HTTPException(status_code=502, detail="AI scenario explanation could not be verified") from None
        raise HTTPException(status_code=422, detail="The stress scenario could not be evaluated") from None
    except GeminiQuotaError:
        raise HTTPException(status_code=429, detail="AI explanations are at their request limit; try later") from None
    except GeminiConfigurationError:
        raise HTTPException(status_code=503, detail="AI scenario explanations are unavailable") from None
    except TimeoutError:
        raise HTTPException(status_code=504, detail="AI scenario explanation took too long; try later") from None
    except GeminiProviderError:
        raise HTTPException(status_code=502, detail="AI scenario explanation is temporarily unavailable") from None


@router.post("/stress-test/batch")
def rental_stress_batch(request: RentalStressBatchRequest) -> dict[str, Any]:
    try:
        return {"results": [
            _numeric_json(stress_test_rental(request.offer, request.financial_profile, scenario))
            for scenario in request.scenarios
        ], "comparison_basis": "Each scenario is evaluated independently against the same original offer and financial profile; scenarios are not compounded."}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
