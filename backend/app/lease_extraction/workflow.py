"""Evidence checks, stateless draft IDs, and explicit user confirmation."""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from backend.app.rental.calculations import evaluate_rental
from backend.app.rental.models import FinancialProfile, RentalOffer
from .models import CandidateTerm, ConfirmRequest, LeaseDraft, LeaseExtraction


_TEST_METADATA_HEADING = re.compile(
    r"^\s{0,3}(?P<marks>#{1,6})?\s*(?:EXPECTED\s+TEST\s+FACTS|TEST[- ]ONLY(?:\s+INSTRUCTIONS)?|TEST\s+INSTRUCTIONS|EXPECTED\s+OUTPUT|TEST\s+FIXTURE|EVALUATION\s+NOTES)\s*:?\s*(?:#{1,6})?\s*$",
    re.IGNORECASE,
)
_MARKDOWN_HEADING = re.compile(r"^\s{0,3}(?P<marks>#{1,6})\s+")
_TEST_METADATA_END = re.compile(r"^\s{0,3}(?:END\s+(?:EXPECTED\s+TEST\s+FACTS|TEST[- ]ONLY|TEST\s+INSTRUCTIONS)|END\s+TEST\s+METADATA)\s*:?\s*$", re.IGNORECASE)


def strip_test_metadata_sections(source_text: str) -> str:
    """Remove clearly labeled synthetic test/evaluation appendices before extraction.

    Markdown sections end at the next same-or-higher-level heading. A plain
    text test-metadata heading ends at an explicit end marker or the next
    Markdown heading. The original source is never changed or persisted.
    """
    kept: list[str] = []
    skip_heading_level: int | None = None
    skip_plain_section = False
    for line in source_text.splitlines(keepends=True):
        heading = _MARKDOWN_HEADING.match(line)
        if skip_heading_level is not None or skip_plain_section:
            if _TEST_METADATA_END.match(line):
                skip_heading_level = None
                skip_plain_section = False
                continue
            if heading and (skip_plain_section or len(heading.group("marks")) <= skip_heading_level):
                skip_heading_level = None
                skip_plain_section = False
            else:
                continue
        metadata = _TEST_METADATA_HEADING.match(line)
        if metadata:
            marks = metadata.group("marks")
            if marks:
                skip_heading_level = len(marks)
            else:
                skip_plain_section = True
            continue
        kept.append(line)
    return "".join(kept).strip()


def _norm(text: str) -> str:
    return re.sub(r"[^\w]+", " ", text.casefold()).strip()


def verify_text_evidence(extraction: LeaseExtraction, source_text: str) -> LeaseExtraction:
    source = _norm(source_text)
    terms = []
    for term in extraction.terms:
        item = term.model_dump()
        if term.source_excerpt:
            item["evidence_verification"] = "verified_text" if _norm(term.source_excerpt) in source else "unverified"
        else:
            item["evidence_verification"] = "missing"
        item["page_reference"] = None
        terms.append(item)
    return LeaseExtraction(terms=terms, general_warnings=extraction.general_warnings)


def verify_pdf_evidence(extraction: LeaseExtraction, page_texts: list[str]) -> LeaseExtraction:
    terms = []
    for term in extraction.terms:
        item = term.model_dump()
        excerpt = _norm(term.source_excerpt or "")
        matches = [i + 1 for i, page in enumerate(page_texts) if excerpt and excerpt in _norm(page)]
        if len(matches) == 1:
            item["page_reference"] = matches[0]
            item["evidence_verification"] = "verified_page"
        else:
            item["evidence_verification"] = "unverified" if excerpt else "missing"
        terms.append(item)
    return LeaseExtraction(terms=terms, general_warnings=extraction.general_warnings)


def make_draft(extraction: LeaseExtraction, source_type: str) -> LeaseDraft:
    payload = {"terms": [t.model_dump(mode="json") for t in extraction.terms], "general_warnings": extraction.general_warnings, "source_type": source_type}
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:32]
    return LeaseDraft(draft_id=digest, **payload)


def _provenance(term: CandidateTerm | None, action: str) -> dict[str, Any]:
    if action == "correct":
        source_based = bool(term and term.status == "explicit" and term.source_excerpt)
        return {"source_type": "document_extracted" if source_based else "user_entered", "source_reference": term.source_excerpt if source_based else None,
                "confidence": None, "review_state": "corrected", "reviewed_by_user": True}
    if term:
        return {"source_type": "document_extracted", "source_reference": term.source_excerpt,
                "confidence": None, "review_state": "confirmed", "reviewed_by_user": True}
    return {"source_type": "user_entered", "review_state": "confirmed", "reviewed_by_user": True}


def confirm_draft(request: ConfirmRequest) -> dict[str, Any]:
    original = make_draft(LeaseExtraction(terms=request.draft.terms, general_warnings=request.draft.general_warnings), request.draft.source_type)
    if original.draft_id != request.draft.draft_id:
        raise ValueError("Draft identifier does not match the submitted reviewed fields")
    terms = {t.field_id: t for t in request.draft.terms}
    decisions = {d.field_id: d for d in request.decisions}
    if not set(terms).issubset(decisions):
        raise ValueError("Provide exactly one review decision for every draft term")
    for field_id in set(decisions) - set(terms):
        if decisions[field_id].action not in ("correct", "mark_unknown", "confirm_none"):
            raise ValueError("Fields not present in the draft can only be manually entered or explicitly reviewed")
    reviewed: dict[str, tuple[Any, str]] = {}
    history = []
    review_order = list(terms) + [key for key in decisions if key not in terms]
    for field_id in review_order:
        candidate = terms.get(field_id)
        decision = decisions[field_id]
        if decision.action == "accept":
            if candidate is None or candidate.status != "explicit" or candidate.value is None:
                raise ValueError(f"{field_id} has no explicit value to accept")
            value = candidate.value
        elif decision.action == "correct":
            if decision.value is None:
                raise ValueError(f"A corrected value is required for {field_id}")
            value = decision.value
        elif decision.action == "confirm_none":
            value = None
        else:
            value = None
        reviewed[field_id] = (value, decision.action)
        history.append({"field_id": field_id, "action": decision.action,
                        "original_extraction": candidate.model_dump(mode="json") if candidate else None,
                        "confirmed_value": value})

    for required in ("rental_label", "monthly_base_rent", "lease_term_months"):
        value, action = reviewed.get(required, (None, "mark_unknown"))
        if value is None or action in ("mark_unknown", "confirm_none"):
            raise ValueError(f"Required lease term {required} must be accepted or entered")

    def val(name: str, default: Any = None) -> Any:
        return reviewed.get(name, (default, "mark_unknown"))[0]

    def action(name: str) -> str:
        return reviewed.get(name, (None, "mark_unknown"))[1]

    def prov(name: str) -> dict[str, Any]:
        return _provenance(terms.get(name), action(name))

    def charge_items(name: str) -> list[Any]:
        value = val(name, []) or []
        if not isinstance(value, list):
            return value
        result = []
        for entry in value:
            if not isinstance(entry, dict):
                result.append(entry)
                continue
            item = dict(entry)
            item.setdefault("provenance", prov(name))
            candidate = terms.get(name)
            if candidate and candidate.source_excerpt:
                item.setdefault("source_description", candidate.source_excerpt)
            result.append(item)
        return result

    def money_term(name: str) -> dict[str, Any]:
        value = val(name)
        act = action(name)
        return {"status": "provided" if value is not None else ("none" if act == "confirm_none" else "unknown"),
                "amount": value, "provenance": prov(name)}

    def rent_timing(name: str) -> Any:
        value = val(name, "unknown")
        return "unknown" if value is None else value

    recurring = charge_items("recurring_charges")
    nonref = charge_items("nonrefundable_fees")
    others = charge_items("other_charges")
    concessions = charge_items("concessions")
    utilities_raw = val("utilities") or {}
    utility_status = utilities_raw.get("status", "unknown") if isinstance(utilities_raw, dict) else "unknown"
    if utility_status not in ("included_in_rent", "estimated"):
        utility_status = "unknown"
    utility_amount = utilities_raw.get("amount") if utility_status == "estimated" else None
    offer_data = {
        "rental_label": val("rental_label"), "monthly_base_rent": val("monthly_base_rent"),
        "lease_term_months": val("lease_term_months"), "lease_start_date": val("lease_start_date"),
        "occupants": val("occupants"), "base_rent_provenance": prov("monthly_base_rent"),
        "lease_term_provenance": prov("lease_term_months"),
        "recurring_charges": recurring,
        "recurring_charges_status": "complete" if action("recurring_charges_status") in ("accept", "confirm_none") else "unknown",
        "recurring_charges_status_provenance": prov("recurring_charges_status"),
        "utilities": {"status": utility_status, "estimated_monthly_amount": utility_amount,
                      "source_description": utilities_raw.get("source_description") if isinstance(utilities_raw, dict) else None,
                      "provenance": prov("utilities")},
        "upfront": {
            "security_deposit": money_term("security_deposit"),
            "first_month_rent_due_upfront": rent_timing("first_month_rent_due_upfront"),
            "first_month_rent_provenance": prov("first_month_rent_due_upfront"),
            "last_month_rent_due_upfront": rent_timing("last_month_rent_due_upfront"),
            "last_month_rent_provenance": prov("last_month_rent_due_upfront"),
            "nonrefundable_fees": nonref,
            "nonrefundable_fees_status": "complete" if action("nonrefundable_fees_status") in ("accept", "confirm_none") else "unknown",
            "nonrefundable_fees_provenance": prov("nonrefundable_fees_status"),
            "other_charges": others,
            "other_charges_status": "complete" if action("other_charges_status") in ("accept", "confirm_none") else "unknown",
            "other_charges_provenance": prov("other_charges_status"),
            "holding_deposit": ({**val("holding_deposit"), "provenance": val("holding_deposit").get("provenance", prov("holding_deposit"))}
                                if isinstance(val("holding_deposit"), dict) else val("holding_deposit")),
            "holding_deposit_status": ("provided" if val("holding_deposit") else "none" if action("holding_deposit_status") == "confirm_none" else "unknown"),
            "holding_deposit_status_provenance": prov("holding_deposit_status"),
        }, "concessions": concessions,
    }
    offer = RentalOffer.model_validate(offer_data)
    output: dict[str, Any] = {"confirmed_offer": offer.model_dump(mode="json"), "review_history": history,
                              "confirmed_clauses": {name: val(name) for name in (
                                  "early_termination", "lease_break_fee", "notice_requirements", "renewal_or_rent_change",
                                  "late_payment_fees", "roommate_liability", "conditional_concessions")}}
    if request.financial_profile is not None:
        profile = FinancialProfile.model_validate(request.financial_profile)
        output["evaluation"] = evaluate_rental(offer, profile)
    return output
