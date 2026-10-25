"""Single-excerpt lease clause explanations with server-side Gemini controls."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from backend.app.ai_explanations.clause_explainer import (
    ClauseExplainRequest, ClauseExplainResponse, clause_prompt, clause_schema, render_clause_response,
)
from backend.app.ai_explanations.provider import generate_structured_json
from backend.app.api.lease_routes import _limit_extraction_requests
from backend.app.lease_extraction.config import extraction_enabled
from backend.app.lease_extraction.provider import GeminiConfigurationError, GeminiOutputError, GeminiProviderError, GeminiQuotaError

router = APIRouter(prefix="/api/lease", tags=["lease clause explanation"])


@router.post("/explain-clause", response_model=ClauseExplainResponse)
def explain_clause(request: ClauseExplainRequest, http_request: Request) -> dict[str, object]:
    if not extraction_enabled():
        raise HTTPException(status_code=503, detail="AI clause explanations are unavailable on this service")
    _limit_extraction_requests(http_request)
    context = {"clause_text": request.clause_text, "context": request.context}
    try:
        raw = generate_structured_json(
            clause_prompt(), context, clause_schema(), max_output_tokens=900,
        )
        return render_clause_response(raw, request.clause_text)
    except (ValidationError, GeminiOutputError):
        raise HTTPException(status_code=502, detail="The clause explanation could not be verified") from None
    except ValueError as exc:
        if str(exc).startswith(("unsupported_clause_", "missing_clause_evidence")):
            raise HTTPException(status_code=502, detail="The clause explanation could not be verified") from None
        raise HTTPException(status_code=422, detail="The clause excerpt could not be analyzed") from None
    except GeminiQuotaError:
        raise HTTPException(status_code=429, detail="AI explanations are at their request limit; try later") from None
    except GeminiConfigurationError:
        raise HTTPException(status_code=503, detail="AI clause explanations are unavailable") from None
    except TimeoutError:
        raise HTTPException(status_code=504, detail="The clause explanation took too long; try later") from None
    except GeminiProviderError:
        raise HTTPException(status_code=502, detail="AI clause explanations are temporarily unavailable") from None
