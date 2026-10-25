"""Ephemeral Gemini extraction and explicit lease-term review endpoints."""
from __future__ import annotations

from io import BytesIO
from collections import defaultdict, deque
import threading
import time

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from backend.app.lease_extraction.config import extraction_enabled, provider_status
from backend.app.lease_extraction.firebase_auth import FirebaseUnavailable, InvalidFirebaseToken, verify_firebase_id_token
from backend.app.lease_extraction.models import ConfirmRequest, LeaseTextRequest
from backend.app.lease_extraction.quota import (
    ConcurrentLimitReached,
    GlobalDailyLimitReached,
    QuotaLimits,
    QuotaReservation,
    QuotaUnavailable,
    UserDailyLimitReached,
    finish_reservation,
    quota_limits_from_environment,
    reserve_extraction,
)
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
            raise HTTPException(status_code=429, detail="Gemini extraction is busy; retry later")
        times = _REQUEST_TIMES[address]
        if len(times) >= 5:
            raise HTTPException(status_code=429, detail="Limit reached: at most five Gemini submissions per minute per client")
        times.append(now)


@router.get("/status")
def lease_status() -> dict[str, object]:
    return provider_status()


def _require_extraction_enabled() -> None:
    if not extraction_enabled():
        raise HTTPException(status_code=503, detail="Live Gemini lease extraction is disabled on this service")
    if not provider_status()["service_ready"]:
        raise HTTPException(status_code=503, detail="Gemini authentication or quota service is not configured")


def _authenticated_uid(request: Request) -> str:
    header = request.headers.get("authorization", "")
    scheme, separator, token = header.partition(" ")
    if not separator or scheme.casefold() != "bearer" or not token or len(token) > 8192:
        raise HTTPException(status_code=401, detail="Sign in with Google to use AI lease extraction")
    try:
        return verify_firebase_id_token(token)
    except InvalidFirebaseToken:
        raise HTTPException(status_code=401, detail="Your sign-in expired or is invalid. Sign in again.") from None
    except FirebaseUnavailable:
        raise HTTPException(status_code=503, detail="Sign-in verification is temporarily unavailable") from None


def _reserve_user_quota(uid: str) -> QuotaReservation:
    limits = quota_limits_from_environment()
    if limits is None:
        raise HTTPException(status_code=503, detail="AI usage limits are not configured")
    try:
        return reserve_extraction(uid, limits)
    except UserDailyLimitReached as exc:
        raise HTTPException(status_code=429, detail="Your daily AI extraction limit has been reached.", headers={"Retry-After": str(exc.retry_after)}) from None
    except GlobalDailyLimitReached as exc:
        raise HTTPException(status_code=429, detail="Today's shared AI extraction limit has been reached.", headers={"Retry-After": str(exc.retry_after)}) from None
    except ConcurrentLimitReached:
        raise HTTPException(status_code=429, detail="The AI demo is busy. Please try again shortly.", headers={"Retry-After": "30"}) from None
    except QuotaUnavailable:
        raise HTTPException(status_code=503, detail="AI usage service is temporarily unavailable") from None


def _release_quota(reservation: QuotaReservation) -> None:
    try:
        finish_reservation(reservation)
    except QuotaUnavailable:
        raise HTTPException(status_code=503, detail="AI usage service is temporarily unavailable") from None


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
    uid = _authenticated_uid(http_request)
    reservation = _reserve_user_quota(uid)
    try:
        try:
            extraction = extract_with_gemini(request.text)
        except (RuntimeError, TimeoutError, ValueError) as exc:
            raise _provider_error(exc) from None
        extraction = verify_text_evidence(extraction, request.text)
        return make_draft(extraction, "pasted_text").model_dump(mode="json")
    finally:
        _release_quota(reservation)


@router.post("/extract-pdf")
async def extract_pdf(http_request: Request, file: UploadFile = File(...)) -> dict[str, object]:
    _require_extraction_enabled()
    _limit_extraction_requests(http_request)
    uid = _authenticated_uid(http_request)
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
    reservation = _reserve_user_quota(uid)
    try:
        try:
            extraction = extract_with_gemini(data, is_pdf=True)
        except (RuntimeError, TimeoutError, ValueError) as exc:
            raise _provider_error(exc) from None
        extraction = verify_pdf_evidence(extraction, pages)
        return make_draft(extraction, "pdf").model_dump(mode="json")
    finally:
        _release_quota(reservation)


@router.post("/confirm")
def confirm_lease(request: ConfirmRequest) -> dict[str, object]:
    try:
        return confirm_draft(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
