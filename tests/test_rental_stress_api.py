from fastapi.testclient import TestClient
import pytest
import time

from backend.app.main import app
from backend.app.api import stress_routes
from backend.app.api import lease_routes
from backend.app.ai_explanations import provider as ai_provider
from backend.app.lease_extraction.provider import GeminiConfigurationError, GeminiProviderError, GeminiQuotaError
from tests.test_rental_api import finances, offer


def test_stress_test_endpoint_accepts_utility_scenario_and_returns_numeric_results():
    payload = {"offer": offer(), "financial_profile": finances(), "scenario": {
        "type": "utility_increase", "additional_monthly_amount": 25,
        "first_affected_month": 2, "last_affected_month": 3,
    }}
    with TestClient(app) as client:
        response = client.post("/api/rental/stress-test", json=payload)
    assert response.status_code == 200
    result = response.json()
    assert result["scenario_type"] == "utility_increase"
    assert result["summary"]["total_additional_gross_household_cost"] == 50
    assert result["summary"]["total_additional_personal_cash_burden"] == 50
    assert result["result_is_hypothetical_not_a_forecast"] is True
    assert result["interpretation"]["source"] == "deterministic"
    assert "assumption" in result["interpretation"]["what_changed"]
    assert "not a prediction" in result["interpretation"]["what_changed"]


@pytest.mark.parametrize("scenario", [
    {"type": "utility_increase", "additional_monthly_amount": 25, "first_affected_month": 2, "last_affected_month": 3},
    {"type": "roommate_contribution_loss", "monthly_contribution_lost": 25, "first_affected_month": 2, "last_affected_month": 3},
    # offer() defaults to a three-month lease, so month 2 is a valid early departure.
    {"type": "early_departure", "departure_month": 2, "treatment": "unknown_consequences"},
])
def test_all_stress_scenarios_have_grounded_deterministic_interpretations(scenario):
    value = offer()
    if scenario["type"] == "roommate_contribution_loss":
        value["expected_roommate_contribution"] = {"status": "provided", "amount": 100}
    with TestClient(app) as client:
        response = client.post("/api/rental/stress-test", json={"offer": value, "scenario": scenario})
    assert response.status_code == 200
    interpretation = response.json()["interpretation"]
    assert interpretation["source"] == "deterministic"
    assert interpretation["headline"]
    assert interpretation["main_consequence"]
    assert interpretation["what_to_watch"]


def test_stress_explanation_gate_and_grounded_ai_selection(monkeypatch):
    payload = {"offer": offer(), "scenario": {"type": "utility_increase", "additional_monthly_amount": 25,
        "first_affected_month": 2, "last_affected_month": 3}}
    monkeypatch.setattr(stress_routes, "extraction_enabled", lambda: False)
    monkeypatch.setattr(stress_routes, "generate_selection", lambda *args, **kwargs: pytest.fail("provider called while disabled"))
    with TestClient(app) as client:
        disabled = client.post("/api/rental/stress-explanation", json=payload)
        deterministic = client.post("/api/rental/stress-test", json=payload)
    assert disabled.status_code == 503
    assert deterministic.status_code == 200

    monkeypatch.setattr(stress_routes, "extraction_enabled", lambda: True)
    lease_routes._REQUEST_TIMES.clear()
    def valid_selection(facts, catalog, **kwargs):
        assert facts["scenario_type"] == "utility_increase"
        assert "SYNTHETIC PRIVATE LABEL" not in str(facts)
        assert facts["additional_personal_cash_burden"] == "$50"
        assert "monthly_take_home_income" not in str(facts)
        return {field: next(iter(ids)) for field, ids in catalog.items()}
    monkeypatch.setattr(stress_routes, "generate_selection", valid_selection)
    with TestClient(app) as client:
        response = client.post("/api/rental/stress-explanation", json={**payload, "financial_profile": finances()})
    assert response.status_code == 200
    assert response.json()["source"] == "gemini"
    assert response.json()["main_consequence"] == "The modeled additional personal cash burden is $50 across the affected months."


def test_stress_explanation_rejects_invalid_selection_and_client_totals(monkeypatch):
    payload = {"offer": offer(), "scenario": {"type": "utility_increase", "additional_monthly_amount": 25,
        "first_affected_month": 2, "last_affected_month": 3}}
    monkeypatch.setattr(stress_routes, "extraction_enabled", lambda: True)
    monkeypatch.setattr(stress_routes, "generate_selection", lambda *args, **kwargs: {field: "invented" for field in (
        "headline", "what_changed", "main_consequence", "why_it_matters", "what_to_watch", "what_to_consider")})
    with TestClient(app) as client:
        invalid = client.post("/api/rental/stress-explanation", json=payload)
        extra = client.post("/api/rental/stress-explanation", json={**payload, "baseline_total": 1})
    assert invalid.status_code == 502
    assert "invented" not in invalid.text
    assert extra.status_code == 422


@pytest.mark.parametrize(("failure", "status"), [
    (GeminiQuotaError("PRIVATE PROVIDER DETAIL"), 429), (GeminiConfigurationError("PRIVATE PROVIDER DETAIL"), 503),
    (TimeoutError("PRIVATE PROVIDER DETAIL"), 504), (GeminiProviderError("PRIVATE PROVIDER DETAIL"), 502),
])
def test_stress_explanation_provider_failures_are_sanitized(monkeypatch, failure, status):
    monkeypatch.setattr(stress_routes, "extraction_enabled", lambda: True)
    def fail(*args, **kwargs):
        raise failure
    monkeypatch.setattr(stress_routes, "generate_selection", fail)
    lease_routes._REQUEST_TIMES.clear()
    payload = {"offer": offer(), "scenario": {"type": "utility_increase", "additional_monthly_amount": 25,
        "first_affected_month": 2, "last_affected_month": 3}}
    with TestClient(app) as client:
        response = client.post("/api/rental/stress-explanation", json=payload)
    assert response.status_code == status
    assert "PRIVATE PROVIDER DETAIL" not in response.text
    assert "SYNTHETIC PRIVATE LABEL" not in response.text


def test_stress_explanation_obeys_shared_limiter(monkeypatch):
    monkeypatch.setattr(stress_routes, "extraction_enabled", lambda: True)
    monkeypatch.setattr(stress_routes, "generate_selection", lambda *args, **kwargs: pytest.fail("provider called over limit"))
    lease_routes._REQUEST_TIMES.clear()
    lease_routes._REQUEST_TIMES["testclient"].extend([time.monotonic()] * 5)
    payload = {"offer": offer(), "scenario": {"type": "utility_increase", "additional_monthly_amount": 25,
        "first_affected_month": 2, "last_affected_month": 3}}
    with TestClient(app) as client:
        response = client.post("/api/rental/stress-explanation", json=payload)
    assert response.status_code == 429


def test_stress_explanation_missing_key_fails_closed(monkeypatch):
    monkeypatch.setattr(stress_routes, "extraction_enabled", lambda: True)
    monkeypatch.setattr(ai_provider, "get_api_key", lambda: None)
    monkeypatch.setattr(stress_routes, "generate_selection", ai_provider.generate_selection)
    lease_routes._REQUEST_TIMES.clear()
    payload = {"offer": offer(), "scenario": {"type": "utility_increase", "additional_monthly_amount": 25,
        "first_affected_month": 2, "last_affected_month": 3}}
    with TestClient(app) as client:
        response = client.post("/api/rental/stress-explanation", json=payload)
    assert response.status_code == 503
    assert "API key" not in response.text


def test_stress_test_rejects_invalid_scenario_months_and_extra_fields():
    base = {"offer": offer(), "scenario": {"type": "utility_increase", "additional_monthly_amount": 50,
             "first_affected_month": 2, "last_affected_month": 3}}
    with TestClient(app) as client:
        out_of_term = client.post("/api/rental/stress-test", json={**base, "scenario": {**base["scenario"], "last_affected_month": 4}})
        invalid = {**base, "scenario": {**base["scenario"], "last_affected_month": 1}}
        reversed_months = client.post("/api/rental/stress-test", json=invalid)
        extra = {**base, "scenario": {**base["scenario"], "expression": "__import__('os')"}}
        extra_field = client.post("/api/rental/stress-test", json=extra)
    assert out_of_term.status_code == 422
    assert reversed_months.status_code == 422
    assert extra_field.status_code == 422
    assert "__import__" not in extra_field.text


def test_stress_test_flags_unreviewed_extracted_offer_terms():
    value = offer()
    value["base_rent_provenance"] = {"source_type": "document_extracted", "review_state": "needs_review"}
    payload = {"offer": value, "scenario": {"type": "utility_increase", "additional_monthly_amount": 20,
               "first_affected_month": 1, "last_affected_month": 1}}
    with TestClient(app) as client:
        response = client.post("/api/rental/stress-test", json=payload)
    assert response.status_code == 200
    assert "unreviewed_extracted_terms" in response.json()["summary"]["unknown_cost_categories"]


def test_stress_batch_scenarios_compare_independently_to_original_offer():
    payload = {"offer": offer(), "scenarios": [
        {"type": "utility_increase", "additional_monthly_amount": 10, "first_affected_month": 1, "last_affected_month": 1},
        {"type": "utility_increase", "additional_monthly_amount": 20, "first_affected_month": 1, "last_affected_month": 1},
    ]}
    with TestClient(app) as client:
        response = client.post("/api/rental/stress-test/batch", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert [item["summary"]["total_additional_gross_household_cost"] for item in body["results"]] == [10, 20]
    assert "independently" in body["comparison_basis"]


def test_existing_rental_endpoints_remain_available_with_stress_router():
    with TestClient(app) as client:
        evaluation = client.post("/api/rental/evaluate", json={"offer": offer()})
        comparison = client.post("/api/rental/compare", json={"left_offer": offer(), "right_offer": offer()})
        health = client.get("/api/health")
        optimization = client.post("/api/optimize", json={"monthly_budget": 1900, "bedrooms": 1})
        housing_map = client.get("/api/geo/housing")
        stations_map = client.get("/api/geo/stations")
        points_map = client.get("/api/geo/housing-points")
        lease_status = client.get("/api/lease/status")
    assert evaluation.status_code == 200
    assert comparison.status_code == 200
    assert health.status_code == 200
    assert optimization.status_code == 200
    assert housing_map.status_code == 200
    assert stations_map.status_code == 200
    assert points_map.status_code == 200
    assert lease_status.status_code == 200
