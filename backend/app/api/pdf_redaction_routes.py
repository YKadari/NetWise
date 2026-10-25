"""Ephemeral, non-AI PDF inspection and user-approved redaction endpoints."""
from __future__ import annotations

import json
import re
import threading
import time
from collections import defaultdict, deque
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from backend.app.pdf_redaction.intake import document_digest as pdf_digest, read_pdf_upload
from backend.app.pdf_redaction.redact import inspect_pdf, redact_pdf

router = APIRouter(prefix="/api/pdf-redaction", tags=["privacy-first PDF redaction"])
_LIMIT_LOCK = threading.Lock()
_REQUEST_TIMES: dict[str, deque[float]] = defaultdict(deque)


def _limit_pdf_requests(request: Request) -> None:
    now = time.monotonic()
    address = request.client.host if request.client else "unknown"
    with _LIMIT_LOCK:
        for key in list(_REQUEST_TIMES):
            while _REQUEST_TIMES[key] and now - _REQUEST_TIMES[key][0] >= 60:
                _REQUEST_TIMES[key].popleft()
            if not _REQUEST_TIMES[key]:
                del _REQUEST_TIMES[key]
        if address not in _REQUEST_TIMES and len(_REQUEST_TIMES) >= 4096:
            raise HTTPException(status_code=429, detail="PDF service is busy; retry later")
        times = _REQUEST_TIMES[address]
        if len(times) >= 5:
            raise HTTPException(status_code=429, detail="PDF service request limit reached; retry later")
        times.append(now)


@router.post("/inspect")
async def inspect_endpoint(request: Request, file: UploadFile = File(...)) -> Response:
    _limit_pdf_requests(request)
    data = await read_pdf_upload(file)
    result = await run_in_threadpool(inspect_pdf, data, file.filename, file.content_type)
    return Response(
        content=json.dumps(result, separators=(",", ":")),
        media_type="application/json",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff"},
    )


@router.post("/export")
async def export_endpoint(
    request: Request,
    file: UploadFile = File(...),
    document_digest: str = Form(..., min_length=64, max_length=64),
    candidate_ids: list[str] = Form(default=[]),
    acknowledge_no_candidates: Literal["true", "false"] = Form(default="false"),
) -> Response:
    _limit_pdf_requests(request)
    if not re.fullmatch(r"[0-9a-f]{64}", document_digest):
        raise HTTPException(status_code=422, detail="The inspected PDF identifier is invalid")
    data = await read_pdf_upload(file)
    output = await run_in_threadpool(redact_pdf, data, file.filename, file.content_type, document_digest, candidate_ids,
                                     acknowledge_no_candidates=acknowledge_no_candidates == "true")
    return Response(
        content=output,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="nestwise-redacted.pdf"',
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "X-Redacted-PDF-SHA256": pdf_digest(output),
        },
    )
