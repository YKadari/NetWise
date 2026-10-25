"""Strict in-memory PDF intake for the privacy redaction workflow."""
from __future__ import annotations

import hashlib
from io import BytesIO
import json
import logging
import os
import re

from fastapi import HTTPException, UploadFile

MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 80
_LOGGER = logging.getLogger(__name__)
_REJECTION_CATEGORIES = frozenset({
    "media_type", "size", "signature", "encrypted", "page_count", "malformed",
    "interactive_content", "embedded_attachments", "associated_files", "active_content",
    "non_text_or_active_content", "annotations_or_forms", "no_extractable_text",
})
_STRUCTURAL_FLAG_NAMES = frozenset({
    "extension_pdf", "mime_pdf", "pdf_signature", "byte_limit_exceeded", "strict_page_count",
    "page_count", "repaired", "encrypted", "forms", "embedded_files", "open_action",
    "additional_actions", "acroform", "collection", "javascript_names", "embedded_file_names",
    "associated_files", "page_number", "images", "drawings", "links", "xobjects",
    "annotations", "widgets", "extractable_text",
})


class UnsupportedPdf(ValueError):
    pass


def _log_rejection(category: str, flags: dict[str, bool | int]) -> None:
    """Opt-in diagnostics with a fixed category and structural booleans/counts only."""
    if os.environ.get("NESTWISE_PDF_DIAGNOSTICS") != "1":
        return
    safe_category = category if category in _REJECTION_CATEGORIES else "malformed"
    safe_flags = {key: value for key, value in flags.items()
                  if key in _STRUCTURAL_FLAG_NAMES and type(value) in (bool, int)}
    _LOGGER.warning("PDF redaction intake rejected category=%s structural_flags=%s",
                    safe_category, json.dumps(safe_flags, sort_keys=True, separators=(",", ":")))


def open_supported_pdf(data: bytes):
    """Open only simple text PDFs; reject content this workflow cannot sanitize."""
    document = None
    flags: dict[str, bool | int] = {
        "byte_limit_exceeded": len(data) > MAX_PDF_BYTES,
        "pdf_signature": data.startswith(b"%PDF-"),
    }
    try:
        if flags["byte_limit_exceeded"]:
            raise UnsupportedPdf("size")
        if not flags["pdf_signature"]:
            raise UnsupportedPdf("signature")
        from pypdf import PdfReader
        strict_reader = PdfReader(BytesIO(data), strict=True)
        flags["encrypted"] = bool(strict_reader.is_encrypted)
        if flags["encrypted"]:
            raise UnsupportedPdf("encrypted")
        strict_page_count = len(strict_reader.pages)
        flags["strict_page_count"] = strict_page_count
        if not 1 <= strict_page_count <= MAX_PDF_PAGES:
            raise UnsupportedPdf("page_count")
        import pymupdf
        document = pymupdf.open(stream=data, filetype="pdf")
        flags.update({
            "page_count": document.page_count,
            "repaired": bool(document.is_repaired),
            "encrypted": bool(document.needs_pass),
            "forms": bool(document.is_form_pdf),
            "embedded_files": document.embfile_count(),
        })
        if flags["repaired"]:
            raise UnsupportedPdf("malformed")
        if flags["encrypted"]:
            raise UnsupportedPdf("encrypted")
        if not 1 <= document.page_count <= MAX_PDF_PAGES:
            raise UnsupportedPdf("page_count")
        if flags["forms"]:
            raise UnsupportedPdf("interactive_content")
        if flags["embedded_files"]:
            raise UnsupportedPdf("embedded_attachments")
        catalog = document.pdf_catalog()
        for key, flag in (("OpenAction", "open_action"), ("AA", "additional_actions"),
                          ("AcroForm", "acroform"), ("Collection", "collection")):
            object_type, _ = document.xref_get_key(catalog, key)
            flags[flag] = object_type not in {"null", "none"}
            if flags[flag]:
                raise UnsupportedPdf("active_content")
        names_type, names_value = document.xref_get_key(catalog, "Names")
        if names_type != "null":
            names_object = names_value
            reference = re.match(r"^(\d+)\s+\d+\s+R$", names_value)
            if reference:
                names_object = document.xref_object(int(reference.group(1)))
            flags["javascript_names"] = "JavaScript" in names_object
            flags["embedded_file_names"] = "EmbeddedFiles" in names_object
            if flags["javascript_names"]:
                raise UnsupportedPdf("active_content")
            if flags["embedded_file_names"]:
                raise UnsupportedPdf("embedded_attachments")
        associated_type, _ = document.xref_get_key(catalog, "AF")
        flags["associated_files"] = associated_type not in {"null", "none"}
        if flags["associated_files"]:
            raise UnsupportedPdf("associated_files")
        for page in document:
            flags.update({
                "page_number": page.number + 1,
                "images": len(page.get_images(full=True)),
                "drawings": len(page.get_drawings()),
                "links": len(page.get_links()),
                "xobjects": len(page.get_xobjects()),
                "annotations": bool(page.first_annot),
                "widgets": bool(page.first_widget),
                "extractable_text": bool(page.get_text("text").strip()),
            })
            if any(flags[key] for key in ("images", "drawings", "links", "xobjects")):
                raise UnsupportedPdf("non_text_or_active_content")
            if flags["annotations"] or flags["widgets"]:
                raise UnsupportedPdf("annotations_or_forms")
            if not flags["extractable_text"]:
                raise UnsupportedPdf("no_extractable_text")
        return document
    except UnsupportedPdf as exc:
        if document is not None:
            document.close()
        _log_rejection(str(exc), flags)
        raise
    except Exception:
        if document is not None:
            document.close()
        _log_rejection("malformed", flags)
        raise UnsupportedPdf("malformed") from None


def document_digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def read_pdf_upload(file: UploadFile) -> bytes:
    """Read at most the existing PDF byte limit plus one sentinel byte."""
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
    return b"".join(chunks)


def inspect_upload(file_bytes: bytes, filename: str | None, content_type: str | None):
    if not filename or not filename.casefold().endswith(".pdf") or content_type != "application/pdf":
        _log_rejection("media_type", {"extension_pdf": bool(filename and filename.casefold().endswith(".pdf")),
                                      "mime_pdf": content_type == "application/pdf"})
        raise HTTPException(status_code=415, detail="Upload a PDF file with application/pdf media type")
    if len(file_bytes) > MAX_PDF_BYTES:
        _log_rejection("size", {"byte_limit_exceeded": True})
        raise HTTPException(status_code=413, detail="PDF exceeds the 10 MB upload limit")
    try:
        document = open_supported_pdf(file_bytes)
    except UnsupportedPdf as exc:
        code = str(exc)
        if code == "signature":
            raise HTTPException(status_code=415, detail="Uploaded bytes are not a PDF") from None
        if code == "size":
            raise HTTPException(status_code=413, detail="PDF exceeds the 10 MB upload limit") from None
        if code == "no_extractable_text":
            raise HTTPException(status_code=422, detail="Scanned or image-only PDFs are not supported") from None
        if code in {"embedded_attachments", "associated_files"}:
            raise HTTPException(status_code=422, detail="PDFs with embedded attachments or associated files are not supported. Export a new PDF without attachments and inspect it again.") from None
        if code in {"interactive_content", "non_text_or_active_content", "annotations_or_forms", "active_content"}:
            raise HTTPException(status_code=422, detail="This PDF contains content the redaction workflow cannot safely sanitize") from None
        raise HTTPException(status_code=422, detail="PDF is malformed, encrypted, or outside supported page limits") from None
    return document
