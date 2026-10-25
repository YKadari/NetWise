"""Ephemeral Gemini extraction and explicit lease-term review endpoints."""
from __future__ import annotations

from io import BytesIO
from collections import defaultdict, deque
import threading
import time

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from backend.app.lease_extraction.config import extraction_enabled, provider_status
from backend.app.lease_extraction.models import ConfirmRequest, LeaseTextRequest
from backend.app.lease_extraction.provider import extract_with_gemini
from backend.app.lease_extraction.provider import GeminiConfigurationError, GeminiOutputError, GeminiQuotaError
from backend.app.lease_extraction.workflow import confirm_draft, make_draft, verify_pdf_evidence, verify_text_evidence

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
    try:
        extraction = extract_with_gemini(request.text)
    except (RuntimeError, TimeoutError, ValueError) as exc:
        raise _provider_error(exc) from None
    extraction = verify_text_evidence(extraction, request.text)
    return make_draft(extraction, "pasted_text").model_dump(mode="json")


@router.post("/extract-pdf")
async def extract_pdf(http_request: Request, file: UploadFile = File(...)) -> dict[str, object]:
    _require_extraction_enabled()
    _limit_extraction_requests(http_request)
    if not file.filename or not file.filename.casefold().endswith(".pdf") or file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="Upload a PDF file with application/pdf media type")
    chunks = []
    size = 0
    while True:
        chunk = await file.read(min(1024 * 1024, MAX_PDF_BYTES + 1 - size))
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_PDF_BYTES:
            raise HTTPException(status_code=413, detail="PDF exceeds the 10 MB upload limit")
        chunks.append(chunk)
    data = b"".join(chunks)
    # PDF parsing and the synchronous SDK call must not block the ASGI loop.
    # The text route is synchronous and FastAPI already runs it in this pool.
    return await run_in_threadpool(_extract_pdf_data, data)


def _extract_pdf_data(data: bytes) -> dict[str, object]:
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
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
