"""Ephemeral Gemini extraction and explicit lease-term review endpoints."""
from __future__ import annotations

from io import BytesIO
from collections import defaultdict, deque
import threading
import time

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from backend.app.lease_extraction.config import extraction_enabled, provider_status
from backend.app.lease_extraction.models import ConfirmRequest, LeaseTextRequest
from backend.app.lease_extraction.provider import extract_with_gemini
from backend.app.lease_extraction.provider import GeminiConfigurationError, GeminiOutputError, GeminiQuotaError
from backend.app.lease_extraction.workflow import confirm_draft, make_draft, strip_test_metadata_sections, verify_pdf_evidence, verify_text_evidence
from backend.app.pdf_redaction.intake import document_digest, read_pdf_upload
from backend.app.pdf_redaction.models import RedactedPdfApproval
from backend.app.pdf_redaction.redact import redact_pdf

router = APIRouter(prefix="/api/lease", tags=["lease extraction and review"])
MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 80
_RATE_LOCK = threading.Lock()
_REQUEST_TIMES: dict[str, deque[float]] = defaultdict(deque)


def _limit_extraction_requests(request: Request) -> None:
    """Small in-memory abuse guard for the expensive provider endpoints."""
    now = time.monotonic()
    address = request.client.host if request.client else "unknown"
    with _RATE_LOCK:
        for key in list(_REQUEST_TIMES):
            while _REQUEST_TIMES[key] and now - _REQUEST_TIMES[key][0] >= 60:
                _REQUEST_TIMES[key].popleft()
            if not _REQUEST_TIMES[key]:
                del _REQUEST_TIMES[key]
        if address not in _REQUEST_TIMES and len(_REQUEST_TIMES) >= 4096:
            raise HTTPException(status_code=429, detail="Gemini requests are busy; retry later")
        times = _REQUEST_TIMES[address]
        if len(times) >= 5:
            raise HTTPException(status_code=429, detail="Limit reached: at most five Gemini requests per minute per client")
        times.append(now)


@router.get("/status")
def lease_status() -> dict[str, object]:
    return provider_status()


def _require_extraction_enabled() -> None:
    if not extraction_enabled():
        raise HTTPException(status_code=503, detail="Live Gemini lease extraction is disabled on this service")


def _provider_error(exc: Exception) -> HTTPException:
    if isinstance(exc, TimeoutError):
        return HTTPException(status_code=504, detail="Gemini extraction timed out; retry later")
    if isinstance(exc, GeminiConfigurationError):
        if exc.args and exc.args[0] == "not_configured":
            return HTTPException(status_code=503, detail="Gemini extraction is not configured")
        if exc.args and exc.args[0] == "sdk_unavailable":
            return HTTPException(status_code=503, detail="Gemini extraction dependencies are unavailable")
        return HTTPException(status_code=503, detail="Gemini extraction is unavailable")
    if isinstance(exc, GeminiQuotaError):
        return HTTPException(status_code=429, detail="Gemini quota is unavailable; retry later")
    if isinstance(exc, GeminiOutputError):
        return HTTPException(status_code=502, detail="Gemini returned invalid structured output")
    if isinstance(exc, (RuntimeError, ValueError)):
        # Retain sanitized handling for other local/provider failures.
        return HTTPException(status_code=502, detail="Gemini extraction failed")
    return HTTPException(status_code=502, detail="Gemini extraction failed")


@router.post("/extract-text")
def extract_text(request: LeaseTextRequest, http_request: Request) -> dict[str, object]:
    _require_extraction_enabled()
    _limit_extraction_requests(http_request)
    extraction_text = strip_test_metadata_sections(request.text)
    if not extraction_text:
        raise HTTPException(status_code=422, detail="No lease text remains after excluding test-only metadata")
    try:
        extraction = extract_with_gemini(extraction_text)
    except (RuntimeError, TimeoutError, ValueError) as exc:
        raise _provider_error(exc) from None
    extraction = verify_text_evidence(extraction, extraction_text)
    return make_draft(extraction, "pasted_text").model_dump(mode="json")


@router.post("/extract-pdf", include_in_schema=False)
async def extract_pdf() -> None:
    raise HTTPException(status_code=410, detail="Direct PDF extraction has been replaced. Inspect and approve a redacted PDF before AI analysis.")


@router.post("/extract-redacted-pdf")
async def extract_redacted_pdf(http_request: Request, file: UploadFile = File(...),
                               approval: str = Form(..., max_length=65536)) -> dict[str, object]:
    _require_extraction_enabled()
    _limit_extraction_requests(http_request)
    form = await http_request.form()
    if set(form) != {"file", "approval"} or len(form.getlist("file")) != 1 or len(form.getlist("approval")) != 1:
        raise HTTPException(status_code=422, detail="Provide one PDF and one approval record; extra fields are not accepted")
    try:
        reviewed = RedactedPdfApproval.model_validate_json(approval)
    except (ValidationError, ValueError):
        raise HTTPException(status_code=422, detail="Valid document identifiers, unique approved regions, and explicit Gemini consent are required") from None
    data = await read_pdf_upload(file)
    return await run_in_threadpool(_extract_approved_pdf, data, file.filename, file.content_type, reviewed)


def _extract_approved_pdf(data: bytes, filename: str | None, content_type: str | None,
                          approval: RedactedPdfApproval) -> dict[str, object]:
    verified_output = redact_pdf(data, filename, content_type, approval.document_digest, approval.candidate_ids,
                                acknowledge_no_candidates=approval.acknowledge_no_candidates)
    if document_digest(verified_output) != approval.approved_pdf_digest:
        raise HTTPException(status_code=409, detail="The verified PDF differs from the version you reviewed. Generate and review it again.")
    return _extract_verified_pdf_data(verified_output)


def _extract_verified_pdf_data(data: bytes) -> dict[str, object]:
    if not data:
        raise HTTPException(status_code=422, detail="PDF upload is empty")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="Uploaded bytes are not a PDF")
    try:
        from pypdf import PdfReader
        reader = PdfReader(BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise ValueError("encrypted")
        if not 1 <= len(reader.pages) <= MAX_PDF_PAGES:
            raise ValueError("page_limit")
        pages = [(page.extract_text() or "") for page in reader.pages]
    except ImportError:
        raise HTTPException(status_code=503, detail="PDF validation dependency is unavailable") from None
    except Exception:
        raise HTTPException(status_code=422, detail="PDF is malformed, encrypted, or exceeds the 80-page limit") from None
    try:
        extraction = extract_with_gemini(data, is_pdf=True)
    except (RuntimeError, TimeoutError, ValueError) as exc:
        raise _provider_error(exc) from None
    extraction = verify_pdf_evidence(extraction, pages)
    return make_draft(extraction, "pdf").model_dump(mode="json")


@router.post("/confirm")
def confirm_lease(request: ConfirmRequest) -> dict[str, object]:
    try:
        return confirm_draft(request)
    except ValidationError:
        raise HTTPException(status_code=422, detail="Reviewed terms do not match valid rental inputs. Correct the terms and try again.") from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
