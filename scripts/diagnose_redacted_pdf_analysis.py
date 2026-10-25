"""Opt-in, single-inference synthetic redacted PDF API smoke test. No content is printed."""
from __future__ import annotations

import argparse
import json


def synthetic_lease_pdf() -> bytes:
    import pymupdf

    document = pymupdf.open()
    page = document.new_page()
    lines = [
        "SYNTHETIC LEASE", "Rental name: Demonstration Unit",
        "Tenant: Avery Signer", "Email: avery.signer@example.test", "Phone: 312-555-0198", "SSN: 123-45-6789",
        "Monthly base rent is $1600.", "Lease term is 12 months.",
        "Refundable security deposit is $800.", "Nonrefundable application fee is $100.",
        "Mandatory monthly internet fee is $40.", "Estimated utilities are $130 per month.",
        "Holding deposit terms are not specified.", "Other move-in charges are not confirmed.",
        "Early termination obligations depend on an unavailable addendum.",
    ]
    for index, line in enumerate(lines):
        page.insert_text((50, 60 + index * 30), line, fontsize=10)
    payload = document.tobytes()
    document.close()
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Explicitly approve one synthetic-only Gemini inference.")
    if not parser.parse_args().live:
        parser.error("Use --live only when you intend to consume one synthetic Gemini inference.")
    from backend.app.lease_extraction.config import is_production_environment, provider_status
    status = provider_status()
    if is_production_environment() or not status["service_ready"]:
        print(json.dumps({"live_request_made": False, "reason": "local_service_not_ready"}))
        return

    from fastapi.testclient import TestClient
    from backend.app.main import app
    from backend.app.lease_extraction.models import LeaseDraft
    import pymupdf

    original = synthetic_lease_pdf()
    report: dict[str, object] = {"live_request_made": False}
    with TestClient(app) as client:
        uploaded = {"file": ("synthetic.pdf", original, "application/pdf")}
        inspected = client.post("/api/pdf-redaction/inspect", files=uploaded)
        report["inspect_status"] = inspected.status_code
        if inspected.status_code != 200:
            print(json.dumps(report)); return
        inspection = inspected.json()
        ids = [item["id"] for item in inspection["candidates"]]
        exported = client.post("/api/pdf-redaction/export", files=uploaded,
                               data={"document_digest": inspection["document_digest"], "candidate_ids": ids})
        report["export_status"] = exported.status_code
        if exported.status_code != 200:
            print(json.dumps(report)); return
        with pymupdf.open(stream=exported.content, filetype="pdf") as verified:
            text = "\n".join(page.get_text() for page in verified)
            report["identifiers_removed"] = all(value not in text for value in (
                "Avery Signer", "avery.signer@example.test", "312-555-0198", "123-45-6789"))
            report["financial_terms_preserved"] = all(value in text for value in ("$1600", "12 months", "$800", "$100", "$40", "$130"))
        if not report["identifiers_removed"] or not report["financial_terms_preserved"]:
            print(json.dumps(report)); return
        approval = {"document_digest": inspection["document_digest"],
                    "approved_pdf_digest": exported.headers["x-redacted-pdf-sha256"],
                    "candidate_ids": ids, "consent_to_gemini": True}
        # --live is developer consent for this known synthetic fixture only.
        report["live_request_made"] = True
        extracted = client.post("/api/lease/extract-redacted-pdf", files=uploaded,
                                data={"approval": json.dumps(approval)})
        report["extraction_status"] = extracted.status_code
        if extracted.status_code == 200:
            draft = LeaseDraft.model_validate(extracted.json())
            report["valid_review_draft"] = draft.review_required
            report["verified_page_terms"] = sum(term.evidence_verification == "verified_page" for term in draft.terms)
            facts = {term.field_id: term for term in draft.terms}
            report["rent_and_duration_match"] = (facts.get("monthly_base_rent") is not None
                and facts["monthly_base_rent"].value == 1600 and facts.get("lease_term_months") is not None
                and facts["lease_term_months"].value == 12)
            if report["rent_and_duration_match"]:
                # Explicit scripted review against this known synthetic source.
                # This is not evidence that a person reviewed a browser screen.
                known = {"rental_label": "Demonstration Unit", "monthly_base_rent": 1600, "lease_term_months": 12,
                         "security_deposit": 800, "nonrefundable_fees": [{"name": "Application fee", "amount": 100}],
                         "recurring_charges": [{"name": "Internet", "monthly_amount": 40}],
                         "utilities": {"status": "estimated", "amount": 130}}
                decisions = [{"field_id": term.field_id, "action": "mark_unknown"}
                             for term in draft.terms if term.field_id not in known]
                decisions.extend({"field_id": field, "action": "correct", "value": value} for field, value in known.items())
                confirmed = client.post("/api/lease/confirm", json={"draft": draft.model_dump(mode="json"), "decisions": decisions})
                report["scripted_synthetic_review_status"] = confirmed.status_code
                report["review_used_known_fixture_corrections"] = True
                if confirmed.status_code == 200:
                    offer = confirmed.json()["confirmed_offer"]
                    report["unknown_costs_preserved"] = (offer["upfront"]["holding_deposit_status"] == "unknown"
                        and offer["upfront"]["other_charges_status"] == "unknown"
                        and confirmed.json()["confirmed_clauses"]["early_termination"] is None)
                    offer["monthly_base_rent"] = float(offer["monthly_base_rent"])
                    offer["upfront"]["security_deposit"]["amount"] = float(offer["upfront"]["security_deposit"]["amount"])
                    for item in offer["upfront"]["nonrefundable_fees"]:
                        item["amount"] = float(item["amount"])
                    for item in offer["recurring_charges"]:
                        item["monthly_amount"] = float(item["monthly_amount"])
                    offer["utilities"]["estimated_monthly_amount"] = float(offer["utilities"]["estimated_monthly_amount"])
                    evaluated = client.post("/api/rental/evaluate", json={"offer": offer})
                    report["evaluation_status"] = evaluated.status_code
                    if evaluated.status_code == 200:
                        report["known_monthly_cost_matches"] = evaluated.json()["monthly_costs"]["gross_known_monthly_housing_obligation"] == 1770
                        report["projection_remains_incomplete"] = evaluated.json()["monthly_costs"]["monthly_costs_complete"] is False
    print(json.dumps(report))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"diagnostic_stopped": True, "raw_details_omitted": True}))
        raise SystemExit(1) from None
