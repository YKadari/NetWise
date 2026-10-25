"""Optional AI selection over a fresh deterministic rental evaluation."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from backend.app.ai_explanations.decision_brief import (
    BriefResponse, FollowUpResponse, build_context, follow_up_catalog, render_follow_ups,
    render_selection, statement_catalog,
)
from backend.app.ai_explanations.provider import generate_selection
from backend.app.api.lease_routes import _limit_extraction_requests
from backend.app.api.rental_schemas import RentalEvaluateRequest
from backend.app.lease_extraction.config import extraction_enabled
from backend.app.lease_extraction.provider import (
    GeminiConfigurationError, GeminiOutputError, GeminiProviderError, GeminiQuotaError,
)
from backend.app.rental.calculations import evaluate_rental


router = APIRouter(prefix="/api/rental", tags=["rental decision brief"])


@router.post("/decision-brief", response_model=BriefResponse)
def rental_decision_brief(request: RentalEvaluateRequest, http_request: Request) -> dict[str, object]:
    if not extraction_enabled():
        raise HTTPException(status_code=503, detail="AI rental insights are unavailable on this service")
    _limit_extraction_requests(http_request)
    try:
        evaluation = evaluate_rental(request.offer, request.financial_profile)
        facts = build_context(request.offer, evaluation)
        catalog = statement_catalog(facts)
        follow_ups = follow_up_catalog(request.offer, facts)
        catalog["follow_up_ids"] = {key: key for key in follow_ups}
        selection = generate_selection(facts, catalog)
        return render_selection(selection, {key: value for key, value in catalog.items() if key != "follow_up_ids"}, follow_ups)
    except (ValidationError, GeminiOutputError):
        raise HTTPException(status_code=502, detail="AI rental insights could not be verified") from None
    except ValueError as exc:
        if str(exc) == "unsupported_brief_selection":
            raise HTTPException(status_code=502, detail="AI rental insights could not be verified") from None
        if str(exc) == "unsupported_follow_up_selection":
            raise HTTPException(status_code=502, detail="AI rental insights could not be verified") from None
        raise HTTPException(status_code=422, detail="The rental terms could not be evaluated") from None
    except GeminiQuotaError:
        raise HTTPException(status_code=429, detail="AI insights are at their request limit; try later") from None
    except GeminiConfigurationError:
        raise HTTPException(status_code=503, detail="AI rental insights are unavailable") from None
    except TimeoutError:
        raise HTTPException(status_code=504, detail="AI rental insights took too long; try later") from None
    except GeminiProviderError:
        raise HTTPException(status_code=502, detail="AI rental insights are temporarily unavailable") from None


@router.post("/follow-ups", response_model=FollowUpResponse)
def rental_follow_ups(request: RentalEvaluateRequest) -> dict[str, object]:
    """Public deterministic follow-ups; this route never invokes an AI provider."""
    try:
        evaluation = evaluate_rental(request.offer, request.financial_profile)
        facts = build_context(request.offer, evaluation)
        candidates = follow_up_catalog(request.offer, facts)
        return render_follow_ups(list(candidates)[:3], candidates, "deterministic")
    except (ValidationError, ValueError):
        raise HTTPException(status_code=422, detail="The rental terms could not be evaluated") from None
