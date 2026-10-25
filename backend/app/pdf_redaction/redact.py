"""User-approved permanent text redaction and post-save verification."""
from __future__ import annotations

import re
from collections import Counter

from fastapi import HTTPException
import pymupdf

from .detection import detect_candidates, page_previews, public_candidate
from .intake import document_digest, inspect_upload


def inspect_pdf(data: bytes, filename: str | None, content_type: str | None) -> dict[str, object]:
    document = inspect_upload(data, filename, content_type)
    try:
        candidates = detect_candidates(document)
        previews = page_previews(document, candidates)
        public = [public_candidate(item) for item in candidates]
        return {
            "document_digest": document_digest(data),
            "candidates": public,
            "pages": previews,
            "page_count": document.page_count,
            "warning": "Automatic detection may miss personal information. Review the PDF and exported document before sharing.",
        }
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=422, detail="This PDF could not be inspected safely") from None
    finally:
        document.close()


def _normal(text: str) -> str:
    return re.sub(r"\W+", "", text.casefold())


def _financial_tokens(text: str) -> list[str]:
    """Collect visible lease-money expressions for a conservative preservation check."""
    return re.findall(r"\$\s*\d[\d,]*(?:\.\d{2})?", text)


def _verify_redacted_output(output: bytes, page_count: int, selected: list[dict[str, object]],
                            kept_candidates: list[dict[str, object]], original_financial: list[str]) -> None:
    verified = pymupdf.open(stream=output, filetype="pdf")
    try:
        if verified.needs_pass or verified.page_count != page_count:
            raise ValueError("invalid_reopened_output")
        output_text_by_page = [page.get_text("text") for page in verified]
        combined = "\n".join(output_text_by_page)
        normalized_output = _normal(combined)
        selected_text = [str(item["match_text"]) for item in selected]
        if any(_normal(value) and _normal(value) in normalized_output for value in selected_text):
            raise ValueError("selected_text_remains")
        metadata_text = str(verified.metadata or {}) + str(verified.get_xml_metadata() or "")
        if any(_normal(value) and _normal(value) in _normal(metadata_text) for value in selected_text):
            raise ValueError("selected_metadata_remains")
        for item in kept_candidates:
            page_text = output_text_by_page[int(item["page_index"])]
            if _normal(str(item["match_text"])) not in _normal(page_text):
                raise ValueError("unselected_candidate_removed")
        output_counts = Counter(_financial_tokens(combined))
        for token, count in Counter(original_financial).items():
            if output_counts[token] < count:
                raise ValueError("financial_text_changed")
        for item in selected:
            page = verified[int(item["page_index"])]
            display_rect = item["display_rect"]
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1, 1), alpha=False)
            x = int((display_rect.x0 + display_rect.x1) / 2 - page.rect.x0)
            y = int((display_rect.y0 + display_rect.y1) / 2 - page.rect.y0)
            if not (0 <= x < pixmap.width and 0 <= y < pixmap.height):
                raise ValueError("redaction_render_bounds")
            if any(channel > 24 for channel in pixmap.pixel(x, y)[:3]):
                raise ValueError("redaction_not_visible")
        metadata = verified.metadata or {}
        if any(str(metadata.get(key, "")).strip() for key in ("title", "author", "subject", "keywords", "creator", "creationDate", "modDate")):
            raise ValueError("metadata_not_cleared")
        if "pymupdf" not in str(metadata.get("producer", "")).casefold():
            raise ValueError("producer_notice_missing")
    finally:
        verified.close()


def redact_pdf(data: bytes, filename: str | None, content_type: str | None, digest: str, selected_ids: list[str],
               *, acknowledge_no_candidates: bool = False) -> bytes:
    if document_digest(data) != digest:
        raise HTTPException(status_code=409, detail="The selected PDF changed after inspection. Inspect it again.")
    document = inspect_upload(data, filename, content_type)
    try:
        original_page_count = document.page_count
        candidates = detect_candidates(document)
        by_id = {str(item["candidate_id"]): item for item in candidates}
        if candidates and acknowledge_no_candidates:
            raise HTTPException(status_code=422, detail="Personal-information candidates were detected. Review and approve the regions to remove.")
        if not selected_ids and candidates:
            raise HTTPException(status_code=422, detail="Select at least one proposed redaction before export")
        if not candidates and not acknowledge_no_candidates:
            raise HTTPException(status_code=422, detail="No candidates were detected. Explicitly acknowledge independent review before preparing this PDF.")
        if len(selected_ids) != len(set(selected_ids)) or any(item not in by_id for item in selected_ids):
            raise HTTPException(status_code=422, detail="One or more proposed redactions are invalid. Inspect the PDF again.")

        selected = [by_id[item] for item in sorted(selected_ids)]
        selected_by_page: dict[int, list[dict[str, object]]] = {}
        for item in selected:
            selected_by_page.setdefault(int(item["page_index"]), []).append(item)
        original_financial = _financial_tokens("\n".join(page.get_text("text") for page in document))
        kept_candidates = [item for item in candidates if item["candidate_id"] not in set(selected_ids)]

        for page_index, items in selected_by_page.items():
            page = document[page_index]
            for item in items:
                rect = item["rect"]
                if rect.is_empty or not rect.is_valid or not page.cropbox.contains(rect):
                    raise HTTPException(status_code=422, detail="A proposed redaction region is outside the supported page bounds")
                page.add_redact_annot(rect, fill=(0, 0, 0), cross_out=False)
            if not page.apply_redactions(images=0, graphics=0, text=0):
                raise HTTPException(status_code=422, detail="The PDF redaction operation could not be applied")

        # Remove standard and XML metadata, then perform a full rewrite with
        # garbage collection. No incremental revision retains the source bytes.
        document.set_metadata({
            "title": "", "author": "", "subject": "", "keywords": "", "creator": "",
            # Retain the producer notice required by PyMuPDF's AGPL terms.
            "producer": "PyMuPDF (AGPLv3; Artifex Software Inc.)", "creationDate": "", "modDate": "", "trapped": "",
        })
        document.del_xml_metadata()
        # Remove the original identifying trailer ID. Suppressing a new random
        # ID makes repeated verified exports of identical inputs byte-stable.
        document.xref_set_key(-1, "ID", "null")
        # tobytes() always writes a complete document; it has no incremental mode.
        output = document.tobytes(garbage=4, deflate=True, clean=True, no_new_id=True)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=422, detail="The PDF could not be safely redacted") from None
    finally:
        document.close()

    # Verify only the new byte stream. It must reopen, have no selected text in
    # extractable page text or metadata, preserve unselected candidates and
    # visible financial expressions, and render the redacted region black.
    try:
        _verify_redacted_output(output, original_page_count, selected, kept_candidates, original_financial)
    except Exception:
        raise HTTPException(status_code=422, detail="Redaction verification did not pass; no file was returned") from None
    return output
