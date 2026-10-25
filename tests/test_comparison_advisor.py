"""Grounded comparison interpretation and explicit AI selection tests."""
from fastapi.testclient import TestClient
import pytest

from backend.app.ai_explanations.comparison_advisor import (
    comparison_catalog, deterministic_comparison_interpretation, render_comparison_selection,
)
from backend.app.api import comparison_advisor_routes, lease_routes
from backend.app.main import app
from backend.app.rental.comparisons import compare_rentals
from backend.app.rental.models import RentalOffer

OFFER_A = {"rental_label": "PRIVATE LABEL A", "monthly_base_rent": 1600, "lease_term_months": 12,
           "recurring_charges_status": "unknown", "utilities": {"status": "unknown"},
           "upfront": {"security_deposit": {"status": "provided", "amount": 800}}}
OFFER_B = {"rental_label": "PRIVATE LABEL B", "monthly_base_rent": 1750, "lease_term_months": 6,
           "recurring_charges_status": "complete", "utilities": {"status": "included_in_rent"},
           "upfront": {"security_deposit": {"status": "none"}}}


def test_deterministic_interpretation_qualifies_totals_and_duration():
    result = compare_rentals(RentalOffer.model_validate(OFFER_A), RentalOffer.model_validate(OFFER_B))
    interpretation = deterministic_comparison_interpretation(result)
    assert interpretation["source"] == "deterministic"
    monthly_and_lease = interpretation["monthly_and_lease_comparison"].lower()
    assert "subtotal" in monthly_and_lease
    assert "lease lengths differ" in monthly_and_lease
    assert "full-term totals cover different periods" in monthly_and_lease
    assert "overall best" in interpretation["main_tradeoff"] or "overall ranking" in interpretation["main_tradeoff"]
    assert "PRIVATE LABEL" not in str(comparison_catalog(result))
    assert "-$150" in interpretation["main_tradeoff"]
    assert "$-150" not in str(comparison_catalog(result))


def test_ai_selection_rejects_ids_outside_each_field_catalog():
    result = compare_rentals(OFFER_A, OFFER_B)
    catalog = comparison_catalog(result)
    raw = {field: next(iter(options)) for field, options in catalog.items()}
    raw["main_tradeoff"] = "invented claim"
    raw["statement_ids"] = [next(iter(options)) for options in catalog.values()]
    with pytest.raises(ValueError, match="unsupported_comparison_selection"):
        render_comparison_selection(raw, catalog)


def test_existing_public_compare_endpoint_adds_deterministic_guidance(monkeypatch):
    lease_routes._REQUEST_TIMES.clear()
    monkeypatch.setenv("NESTWISE_ENV", "production")
    monkeypatch.setenv("NESTWISE_ENABLE_PUBLIC_GEMINI", "false")
    with TestClient(app) as client:
        response = client.post("/api/rental/compare", json={"left_offer": OFFER_A, "right_offer": OFFER_B})
    assert response.status_code == 200, response.text
    assert response.json()["interpretation"]["source"] == "deterministic"
    assert "overall ranking" in response.json()["interpretation"]["main_tradeoff"]
    lease_routes._REQUEST_TIMES.clear()


def test_ai_comparison_endpoint_recomputes_and_returns_only_catalog_statements(monkeypatch):
    lease_routes._REQUEST_TIMES.clear()
    monkeypatch.setenv("NESTWISE_ENV", "production")
    monkeypatch.setenv("NESTWISE_ENABLE_PUBLIC_GEMINI", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "never-return-this")
    def selected(_instruction, _context, _schema, **_kwargs):
        return {field: next(iter(options)) for field, options in comparison_catalog(compare_rentals(OFFER_A, OFFER_B)).items()}
    monkeypatch.setattr(comparison_advisor_routes, "generate_structured_json", selected)
    with TestClient(app) as client:
        response = client.post("/api/rental/comparison-explanation", json={"left_offer": OFFER_A, "right_offer": OFFER_B})
        assert response.status_code == 200, response.text
        assert response.json()["source"] == "gemini"
        assert "PRIVATE LABEL" not in response.text
        invalid = client.post("/api/rental/comparison-explanation", json={"left_offer": OFFER_A, "right_offer": OFFER_B, "client_total": 10})
        assert invalid.status_code == 422
    lease_routes._REQUEST_TIMES.clear()
