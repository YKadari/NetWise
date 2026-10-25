"""Conservative, label-aware personal-data candidate detection using PDF words."""
from __future__ import annotations

import base64
import re


PATTERNS: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    ("email", "Email address", re.compile(r"(?P<secret>[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})", re.I)),
    ("phone", "Phone number", re.compile(r"(?:phone|telephone|mobile|cell(?:ular)?)(?:\s+number)?\s*[:#-]\s*(?P<secret>\+?\d[\d ().-]{6,}\d)", re.I)),
    ("personal_id", "Personal identification number", re.compile(r"(?:SSN|Social\s+Security\s+(?:No\.?|Number)|Driver'?s\s+License(?:\s+No\.?)?|Passport\s+No\.?)\s*[:#-]\s*(?P<secret>[A-Z0-9 -]{5,20})", re.I)),
    ("account", "Account or payment identifier", re.compile(r"(?:Credit\s+)?(?:Bank\s+)?(?:Account|Routing|Card|Payment)(?:\s+Number)?\s*(?:No\.?|#|Number)?\s*[:#-]\s*(?P<secret>[0-9 -]{6,30})", re.I)),
    ("identity_name", "Name in an identity field", re.compile(r"(?:Tenant|Applicant|Guarantor|Landlord)(?:\s+Name)?\s*[:#-]\s*(?P<secret>[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3})\b")),
    ("signature", "Typed signature", re.compile(r"Signature(?:\s+of\s+(?:Tenant|Applicant|Guarantor|Landlord))?\s*[:#-]\s*(?P<secret>[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3})\b", re.I)),
)
EMPTY_SENSITIVE_LABEL = re.compile(
    r"^\s*(?:e-?mail|phone|telephone|mobile|cell(?:ular)?|SSN|Social\s+Security(?:\s+(?:No\.?|Number))?|"
    r"Driver'?s\s+License(?:\s+(?:No\.?|Number))?|Passport\s+(?:No\.?|Number)|Account(?:\s+(?:No\.?|Number))?|"
    r"Routing(?:\s+(?:No\.?|Number))?|Card(?:\s+(?:No\.?|Number))?|Payment(?:\s+(?:No\.?|Number))?|"
    r"Tenant(?:\s+Name)?|Applicant(?:\s+Name)?|Guarantor(?:\s+Name)?|Landlord(?:\s+Name)?|Signature(?:\s+of\s+\w+)?)\s*[:#-]\s*$",
    re.I,
)


class UnmappableSensitiveText(ValueError):
    """A recognized sensitive value could not be mapped to exact PDF words."""


def _page_words_by_line(page):
    grouped = {}
    for word in page.get_text("words", sort=True):
        if len(word) < 8 or not str(word[4]).strip():
            continue
        grouped.setdefault((word[5], word[6]), []).append(word)
    return grouped


def _match_rect(words, start: int, end: int, pymupdf):
    pieces = []
    cursor = 0
    for word in words:
        value = str(word[4])
        word_start, word_end = cursor, cursor + len(value)
        if word_start < end and word_end > start:
            pieces.append(word)
        cursor = word_end + 1
    if not pieces:
        return None
    rect = pymupdf.Rect(min(w[0] for w in pieces), min(w[1] for w in pieces), max(w[2] for w in pieces), max(w[3] for w in pieces))
    if rect.is_empty or not rect.is_valid or rect.width <= 0 or rect.height <= 0:
        return None
    return rect


def detect_candidates(document) -> list[dict[str, object]]:
    """Return deterministic candidates with private match text for server use only."""
    import pymupdf

    found = []
    for page_index, page in enumerate(document):
        for words in _page_words_by_line(page).values():
            line = " ".join(str(word[4]) for word in words)
            if EMPTY_SENSITIVE_LABEL.match(line):
                # The value may be on another line or handwritten. This
                # workflow cannot map that region, so it refuses the document.
                raise UnmappableSensitiveText("label_without_same_line_value")
            for category, label, pattern in PATTERNS:
                for match in pattern.finditer(line):
                    value = match.group("secret").strip(" \t:#-")
                    if category in {"phone", "personal_id", "account"}:
                        digit_count = sum(char.isdigit() for char in value)
                        if not 7 <= digit_count <= (15 if category == "phone" else 24):
                            continue
                    span = match.span("secret")
                    rect = _match_rect(words, span[0], span[1], pymupdf)
                    if rect is None:
                        raise UnmappableSensitiveText("region")
                    display_rect = rect * page.rotation_matrix
                    page_rect = page.rect
                    if (rect.x0 < 0 or rect.y0 < 0 or rect.x1 > page.cropbox.width or rect.y1 > page.cropbox.height
                            or display_rect.x0 < page_rect.x0 or display_rect.y0 < page_rect.y0
                            or display_rect.x1 > page_rect.x1 or display_rect.y1 > page_rect.y1):
                        raise UnmappableSensitiveText("region_bounds")
                    found.append({
                        "page_index": page_index,
                        "category": category,
                        "label": label,
                        "match_text": value,
                        "rect": rect,
                        "display_rect": display_rect,
                    })
    # A signature label such as "Signature of Tenant:" also matches the
    # identity-name rule. Prefer the explicit signature category when both
    # identify the same value and region, then collapse the duplicate region.
    found.sort(key=lambda item: (item["page_index"], round(item["rect"].y0, 2), round(item["rect"].x0, 2), item["category"] != "signature", item["category"], item["match_text"].casefold()))
    # Collapse duplicate detections for the same exact region and value.
    unique = []
    seen = set()
    for item in found:
        rect = item["rect"]
        key = (item["page_index"], tuple(round(v, 2) for v in (rect.x0, rect.y0, rect.x1, rect.y1)), item["match_text"].casefold())
        if key in seen:
            continue
        seen.add(key)
        item["candidate_id"] = f"region-{len(unique) + 1:04d}"
        unique.append(item)
    return unique


def page_previews(document, candidates: list[dict[str, object]]) -> list[dict[str, object]]:
    """Render only candidate-bearing pages at a bounded thumbnail scale."""
    pages = sorted({int(item["page_index"]) for item in candidates})
    previews = []
    for page_index in pages:
        page = document[page_index]
        page_rect = page.rect
        scale = min(0.65, 900 / max(page_rect.width, page_rect.height))
        pixmap = page.get_pixmap(matrix=__import__("pymupdf").Matrix(scale, scale), alpha=False)
        image = base64.b64encode(pixmap.tobytes("jpeg", jpg_quality=55)).decode("ascii")
        previews.append({
            "page_number": page_index + 1,
            "width": float(page_rect.width),
            "height": float(page_rect.height),
            "image_data_url": f"data:image/jpeg;base64,{image}",
        })
    return previews


def public_candidate(candidate: dict[str, object]) -> dict[str, object]:
    rect = candidate["display_rect"]
    return {
        "id": candidate["candidate_id"],
        "page_number": int(candidate["page_index"]) + 1,
        "bbox": [round(float(rect.x0), 2), round(float(rect.y0), 2), round(float(rect.x1), 2), round(float(rect.y1), 2)],
        "category": candidate["category"],
        "label": candidate["label"],
        "review_required": True,
    }
