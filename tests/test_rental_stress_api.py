from fastapi.testclient import TestClient

from backend.app.main import app
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
