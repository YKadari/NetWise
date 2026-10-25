"""Privacy-boundary and integration tests; Gemini is mocked throughout."""
from __future__ import annotations

import json
from pathlib import Path

import pymupdf
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.api import lease_routes as routes, pdf_redaction_routes as pdf_routes
from backend.app.lease_extraction.models import CandidateTerm, LeaseExtraction
from backend.app.lease_extraction.provider import GeminiOutputError, GeminiProviderError, GeminiQuotaError
from backend.app.main import app
from backend.app.pdf_redaction.intake import document_digest
from backend.app.pdf_redaction.redact import inspect_pdf, redact_pdf
from scripts.diagnose_redacted_pdf_analysis import synthetic_lease_pdf
from tests.test_pdf_redaction import make_pdf, make_signature_pdf


@pytest.fixture(autouse=True)
def isolated_requests(monkeypatch):
    monkeypatch.setenv("NESTWISE_ENV", "test")
    monkeypatch.setenv("NESTWISE_ENABLE_PUBLIC_GEMINI", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-only")
    routes._REQUEST_TIMES.clear()
    pdf_routes._REQUEST_TIMES.clear()
    yield
    routes._REQUEST_TIMES.clear()
    pdf_routes._REQUEST_TIMES.clear()


def fixture_extraction() -> LeaseExtraction:
    def term(field_id, value, excerpt):
        return CandidateTerm(field_id=field_id, value=value, source_excerpt=excerpt, status="explicit")
    return LeaseExtraction(terms=[
        term("rental_label", "Demonstration Unit", "Rental name: Demonstration Unit"),
        term("monthly_base_rent", 1600, "Monthly base rent is $1600."),
        term("lease_term_months", 12, "Lease term is 12 months."),
        term("security_deposit", 800, "Refundable security deposit is $800."),
        term("nonrefundable_fees", [{"name": "Application", "amount": 100}], "Nonrefundable application fee is $100."),
        term("recurring_charges", [{"name": "Internet", "monthly_amount": 40}], "Mandatory monthly internet fee is $40."),
        term("utilities", {"status": "estimated", "amount": 130}, "Estimated utilities are $130 per month."),
        CandidateTerm(field_id="holding_deposit", status="not_found"),
        CandidateTerm(field_id="other_charges", status="not_found"),
        CandidateTerm(field_id="first_month_rent_due_upfront", status="not_found"),
        CandidateTerm(field_id="last_month_rent_due_upfront", status="not_found"),
        CandidateTerm(field_id="early_termination", status="ambiguous", value=None,
                      source_excerpt="Early termination obligations depend on an unavailable addendum."),
    ])


def prepared(data: bytes | None = None, *, no_candidates: bool = False):
    original = data if data is not None else synthetic_lease_pdf()
    inspection = inspect_pdf(original, "synthetic.pdf", "application/pdf")
    ids = [candidate["id"] for candidate in inspection["candidates"]]
    output = redact_pdf(original, "synthetic.pdf", "application/pdf", inspection["document_digest"], ids,
                        acknowledge_no_candidates=no_candidates)
    approval = {"document_digest": inspection["document_digest"], "approved_pdf_digest": document_digest(output),
                "candidate_ids": ids, "consent_to_gemini": True, "acknowledge_no_candidates": no_candidates}
    return original, output, approval


def submit(client, original, approval, **extra):
    return client.post("/api/lease/extract-redacted-pdf",
                       files={"file": ("synthetic.pdf", original, "application/pdf")},
                       data={"approval": json.dumps(approval), **extra})


def test_full_api_flow_only_verified_previewed_bytes_reach_provider_then_require_human_confirmation(monkeypatch, tmp_path):
    original = synthetic_lease_pdf()
    observed = []
    def provider(payload, *, is_pdf=False):
        assert is_pdf is True and payload != original
        with pymupdf.open(stream=payload, filetype="pdf") as document:
            text = "\n".join(page.get_text() for page in document)
        for value in ("Avery Signer", "avery.signer@example.test", "312-555-0198", "123-45-6789"):
            assert value not in text and value.encode() not in payload
        assert all(value in text for value in ("$1600", "12 months", "$800", "$100", "$40", "$130"))
        observed.append(payload)
        return fixture_extraction()
    monkeypatch.setattr(routes, "extract_with_gemini", provider)
    monkeypatch.chdir(tmp_path)
    with TestClient(app) as client:
        uploaded = {"file": ("synthetic.pdf", original, "application/pdf")}
        inspected = client.post("/api/pdf-redaction/inspect", files=uploaded)
        assert inspected.status_code == 200
        inspection = inspected.json()
        ids = [item["id"] for item in inspection["candidates"]]
        exported = client.post("/api/pdf-redaction/export", files=uploaded,
                               data={"document_digest": inspection["document_digest"], "candidate_ids": ids})
        assert exported.status_code == 200
        assert observed == []  # Inspect and export never invoke Gemini.
        assert exported.headers["x-redacted-pdf-sha256"] == document_digest(exported.content)
        approval = {"document_digest": inspection["document_digest"], "approved_pdf_digest": document_digest(exported.content),
                    "candidate_ids": list(reversed(ids)), "consent_to_gemini": True}
        extracted = submit(client, original, approval)
        assert extracted.status_code == 200, extracted.text
        assert observed == [exported.content]
        assert extracted.headers["cache-control"].startswith("no-store")
        draft = extracted.json()
        assert draft["source_type"] == "pdf" and draft["review_required"] is True
        assert "confirmed_offer" not in draft and "evaluation" not in draft
        fields = {item["field_id"]: item for item in draft["terms"]}
        assert fields["monthly_base_rent"]["evidence_verification"] == "verified_page"
        assert fields["holding_deposit"]["status"] == "not_found"
        assert fields["early_termination"]["status"] == "ambiguous" and fields["early_termination"]["value"] is None
        assert "Avery Signer" not in extracted.text
        missing_review = client.post("/api/lease/confirm", json={"draft": draft, "decisions": [
            {"field_id": "monthly_base_rent", "action": "accept"}]})
        assert missing_review.status_code == 422
        decisions = [{"field_id": item["field_id"], "action": "accept" if item["status"] == "explicit" else "mark_unknown"}
                     for item in draft["terms"]]
        confirmed = client.post("/api/lease/confirm", json={"draft": draft, "decisions": decisions})
        assert confirmed.status_code == 200, confirmed.text
        offer = confirmed.json()["confirmed_offer"]
        assert offer["upfront"]["holding_deposit_status"] == "unknown"
        assert offer["upfront"]["other_charges_status"] == "unknown"
        assert offer["upfront"]["first_month_rent_due_upfront"] == "unknown"
        assert offer["upfront"]["last_month_rent_due_upfront"] == "unknown"
        assert confirmed.json()["confirmed_clauses"]["early_termination"] is None
        # API financial inputs remain numeric; Pydantic serializes confirmed money as strings.
        offer["monthly_base_rent"] = float(offer["monthly_base_rent"])
        offer["upfront"]["security_deposit"]["amount"] = float(offer["upfront"]["security_deposit"]["amount"])
        for charge in offer["upfront"]["nonrefundable_fees"]:
            charge["amount"] = float(charge["amount"])
        for charge in offer["recurring_charges"]:
            charge["monthly_amount"] = float(charge["monthly_amount"])
        offer["utilities"]["estimated_monthly_amount"] = float(offer["utilities"]["estimated_monthly_amount"])
        evaluated = client.post("/api/rental/evaluate", json={"offer": offer})
        assert evaluated.status_code == 200, evaluated.text
        assert evaluated.json()["monthly_costs"]["gross_known_monthly_housing_obligation"] == 1770
        assert evaluated.json()["monthly_costs"]["monthly_costs_complete"] is False
    assert list(Path(tmp_path).iterdir()) == []


@pytest.mark.parametrize("change,status", [
    ({"document_digest": "0" * 64}, 409), ({"approved_pdf_digest": "0" * 64}, 409),
    ({"candidate_ids": ["region-9999"]}, 422), ({"candidate_ids": ["region-0001", "region-0001"]}, 422),
    ({"candidate_ids": []}, 422), ({"candidate_ids": [], "acknowledge_no_candidates": True}, 422),
    ({"consent_to_gemini": False}, 422), ({"consent_to_gemini": "true"}, 422),
    ({"redacted": True}, 422), ({"coordinates": [0, 0, 100, 100]}, 422),
])
def test_untrusted_approval_claims_never_reach_provider(monkeypatch, change, status):
    original, _, approval = prepared()
    monkeypatch.setattr(routes, "extract_with_gemini", lambda *_a, **_k: pytest.fail("Invalid approval reached Gemini"))
    with TestClient(app) as client:
        response = submit(client, original, {**approval, **change})
    assert response.status_code == status
    assert response.headers["cache-control"].startswith("no-store")


def test_missing_consent_modified_original_and_extra_file_claims_are_rejected(monkeypatch):
    original, output, approval = prepared()
    monkeypatch.setattr(routes, "extract_with_gemini", lambda *_a, **_k: pytest.fail("Unverified bytes reached Gemini"))
    with TestClient(app) as client:
        missing = {key: value for key, value in approval.items() if key != "consent_to_gemini"}
        assert submit(client, original, missing).status_code == 422
        assert submit(client, original + b" ", approval).status_code == 409
        modified_output_claim = {**approval, "approved_pdf_digest": document_digest(output + b" ")}
        assert submit(client, original, modified_output_claim).status_code == 409
        assert submit(client, original, approval, redacted="true").status_code == 422
        response = client.post("/api/lease/extract-redacted-pdf", files={
            "file": ("synthetic.pdf", original, "application/pdf"),
            "redacted_pdf": ("replacement.pdf", output + b" ", "application/pdf")},
            data={"approval": json.dumps(approval)})
        assert response.status_code == 422


def test_no_detected_candidates_require_acknowledgment_at_export_and_final_submission(monkeypatch):
    original = make_signature_pdf()  # Unlabeled names are outside the detector's narrow scope.
    inspected = inspect_pdf(original, "synthetic.pdf", "application/pdf")
    assert inspected["candidates"] == []
    with pytest.raises(HTTPException):
        redact_pdf(original, "synthetic.pdf", "application/pdf", inspected["document_digest"], [])
    original, output, approval = prepared(original, no_candidates=True)
    seen = []
    monkeypatch.setattr(routes, "extract_with_gemini", lambda data, **_kwargs: (seen.append(data) or fixture_extraction()))
    with TestClient(app) as client:
        assert submit(client, original, {**approval, "acknowledge_no_candidates": False}).status_code == 422
        assert submit(client, original, approval).status_code == 200
    assert seen == [output]


def test_no_candidate_export_requires_acknowledgment_and_returns_verified_digest():
    original = make_signature_pdf()
    inspection = inspect_pdf(original, "synthetic.pdf", "application/pdf")
    with TestClient(app) as client:
        files = {"file": ("synthetic.pdf", original, "application/pdf")}
        data = {"document_digest": inspection["document_digest"]}
        assert client.post("/api/pdf-redaction/export", files=files, data=data).status_code == 422
        result = client.post("/api/pdf-redaction/export", files=files, data={**data, "acknowledge_no_candidates": "true"})
    assert result.status_code == 200
    assert result.headers["x-redacted-pdf-sha256"] == document_digest(result.content)
    assert result.content != original


@pytest.mark.parametrize("invalid_timing", [False, 0, "PRIVATE_INVALID_TIMING"])
def test_unresolved_prepaid_timing_fix_does_not_accept_malformed_values(invalid_timing):
    from backend.app.lease_extraction.workflow import make_draft
    draft = make_draft(fixture_extraction(), "pdf").model_dump(mode="json")
    decisions = [{"field_id": item["field_id"], "action": "accept" if item["status"] == "explicit" else "mark_unknown"}
                 for item in draft["terms"] if item["field_id"] != "first_month_rent_due_upfront"]
    decisions.append({"field_id": "first_month_rent_due_upfront", "action": "correct", "value": invalid_timing})
    with TestClient(app) as client:
        result = client.post("/api/lease/confirm", json={"draft": draft, "decisions": decisions})
    assert result.status_code == 422
    assert "PRIVATE_INVALID_TIMING" not in result.text
    assert "input_value" not in result.text


def test_unsupported_pdf_and_failed_output_verification_block_provider(monkeypatch):
    import backend.app.pdf_redaction.redact as redaction
    original, _, approval = prepared()
    monkeypatch.setattr(routes, "extract_with_gemini", lambda *_a, **_k: pytest.fail("Unsafe PDF reached Gemini"))
    bad = make_pdf(annotation=True)
    with TestClient(app) as client:
        assert submit(client, bad, {**approval, "document_digest": document_digest(bad)}).status_code == 422
        monkeypatch.setattr(redaction, "_verify_redacted_output", lambda *_a: (_ for _ in ()).throw(ValueError("private source marker")))
        response = submit(client, original, approval)
        assert response.status_code == 422 and "private source marker" not in response.text


def test_production_gate_and_retired_raw_pdf_route_fail_before_provider(monkeypatch):
    original, _, approval = prepared()
    monkeypatch.setenv("NESTWISE_ENV", "production")
    monkeypatch.setenv("NESTWISE_ENABLE_PUBLIC_GEMINI", "false")
    monkeypatch.setattr(routes, "redact_pdf", lambda *_a, **_k: pytest.fail("Gate must precede PDF work"))
    monkeypatch.setattr(routes, "extract_with_gemini", lambda *_a, **_k: pytest.fail("Gate bypassed"))
    with TestClient(app) as client:
        assert submit(client, original, approval).status_code == 503
        assert client.post("/api/lease/extract-pdf", files={"file": ("s.pdf", original, "application/pdf")}).status_code == 410


@pytest.mark.parametrize("error,status", [(TimeoutError, 504), (GeminiOutputError, 502), (GeminiProviderError, 502), (GeminiQuotaError, 429)])
def test_provider_failures_are_sanitized_after_successful_redaction(monkeypatch, caplog, error, status):
    original, output, approval = prepared()
    def fail(payload, **_kwargs):
        assert payload == output
        raise error("PRIVATE_SOURCE_AND_KEY_MARKER")
    monkeypatch.setattr(routes, "extract_with_gemini", fail)
    with TestClient(app) as client:
        response = submit(client, original, approval)
    assert response.status_code == status
    assert "PRIVATE_SOURCE_AND_KEY_MARKER" not in response.text + caplog.text
    assert "avery.signer@example.test" not in response.text + caplog.text


def test_shared_gemini_rate_limit_covers_approved_pdf_and_text(monkeypatch):
    original, _, approval = prepared()
    calls = []
    monkeypatch.setattr(routes, "extract_with_gemini", lambda data, **_k: (calls.append(data) or fixture_extraction()))
    with TestClient(app) as client:
        for _ in range(5):
            assert submit(client, original, approval).status_code == 200
        assert submit(client, original, approval).status_code == 429
        assert client.post("/api/lease/extract-text", json={"text": "Synthetic lease"}).status_code == 429
    assert len(calls) == 5


def test_invalid_provider_json_still_fails_safely(monkeypatch):
    from google import genai
    original, output, approval = prepared()
    class FakeModels:
        def generate_content(self, **kwargs):
            assert kwargs["contents"][1].inline_data.data == output
            return type("Response", (), {"text": "not JSON - PRIVATE_MODEL_OUTPUT"})()
    class FakeClient:
        def __init__(self, **_kwargs):
            self.models = FakeModels()
    monkeypatch.setattr(genai, "Client", FakeClient)
    with TestClient(app) as client:
        response = submit(client, original, approval)
    assert response.status_code == 502
    assert "PRIVATE_MODEL_OUTPUT" not in response.text
