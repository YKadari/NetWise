"""Constrained clause explanations; provider calls are mocked."""
from fastapi.testclient import TestClient
import pytest

from backend.app.ai_explanations.clause_explainer import render_clause_response
from backend.app.api import clause_routes, lease_routes
from backend.app.lease_extraction.provider import GeminiProviderError
from backend.app.main import app

CLAUSE = "The tenant is responsible for utilities as billed by the provider."
VALID = {
    "can_analyze": True,
    "plain_language_explanation": "This appears to say the renter pays utility bills directly.",
    "possible_financial_implications": ["Monthly housing costs may vary with usage."],
    "important_uncertainties": ["The excerpt does not identify which utilities are included."],
    "questions_to_ask": ["Which utilities are billed separately?"],
    "source_excerpt": "responsible for utilities as billed by the provider",
    "limitations": "The full agreement may add detail.",
}


def test_clause_render_requires_exact_evidence_and_rejects_model_numbers():
    result = render_clause_response(VALID, CLAUSE)
    assert result["source_excerpt"] in CLAUSE
    assert result["legal_note"].startswith("Informational only")
    numeric = {**VALID, "plain_language_explanation": "Pay $100 each month."}
    with pytest.raises(ValueError, match="unsupported_clause_numeric_claim"):
        render_clause_response(numeric, CLAUSE)
    fake = {**VALID, "source_excerpt": "invented lease sentence"}
    with pytest.raises(ValueError, match="unsupported_clause_excerpt"):
        render_clause_response(fake, CLAUSE)


def test_clause_endpoint_is_gated_and_provider_errors_are_sanitized(monkeypatch):
    lease_routes._REQUEST_TIMES.clear()
    monkeypatch.setenv("NESTWISE_ENV", "production")
    monkeypatch.setenv("NESTWISE_ENABLE_PUBLIC_GEMINI", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "never-return-this")
    monkeypatch.setattr(clause_routes, "generate_structured_json", lambda *args, **kwargs: VALID)
    with TestClient(app) as client:
        result = client.post("/api/lease/explain-clause", json={"clause_text": CLAUSE, "context": "utilities"})
        assert result.status_code == 200
        assert result.json()["source_excerpt"] in CLAUSE
        monkeypatch.setattr(clause_routes, "generate_structured_json", lambda *args, **kwargs: (_ for _ in ()).throw(GeminiProviderError("private raw error")))
        failed = client.post("/api/lease/explain-clause", json={"clause_text": CLAUSE})
        assert failed.status_code == 502
        assert "private raw error" not in failed.text and CLAUSE not in failed.text
    monkeypatch.setenv("NESTWISE_ENABLE_PUBLIC_GEMINI", "false")
    with TestClient(app) as client:
        assert client.post("/api/lease/explain-clause", json={"clause_text": CLAUSE}).status_code == 503
    lease_routes._REQUEST_TIMES.clear()
