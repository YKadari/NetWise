from fastapi.testclient import TestClient

from backend.app.main import app


def offer(label="Example", rent=1000, term=3):
    return {
        "rental_label": label,
        "monthly_base_rent": rent,
        "lease_term_months": term,
        "recurring_charges": [],
        "recurring_charges_status": "complete",
        "utilities": {"status": "included_in_rent"},
        "upfront": {
            "security_deposit": {"status": "provided", "amount": 500},
            "first_month_rent_due_upfront": "yes",
            "last_month_rent_due_upfront": "no",
            "nonrefundable_fees": [{"name": "Application fee", "amount": 50}],
            "nonrefundable_fees_status": "complete",
            "other_charges_status": "complete",
            "holding_deposit_status": "none",
        },
    }


def finances():
    return {
        "monthly_take_home_income": 4000,
        "available_savings": 5000,
        "essential_monthly_nonhousing_expenses": 1500,
        "student_loan_payment": 200,
        "student_loan_included_in_essential_expenses": False,
        "monthly_savings_target": 300,
        "minimum_emergency_cash_reserve": 1000,
    }


def test_evaluate_endpoint_response_schema_and_cash_flow():
    with TestClient(app) as client:
        response = client.post("/api/rental/evaluate", json={"offer": offer(), "financial_profile": finances()})
    assert response.status_code == 200
    body = response.json()
    assert body["rental_label"] == "Example"
    assert len(body["month_by_month_cash_flow"]) == 3
    assert body["upfront"]["upfront_cash_required"] == 1550
    assert body["lease_totals"]["known_modeled_nonrefundable_lease_cost"] == 3050
    assert body["financial_profile"]["maximum_sustainable_monthly_housing_amount"] == 2000
    assert body["term_provenance"]["base_rent"]["source_type"] == "user_entered"
    assert body["financial_profile"]["input_source"] == "user_entered"


def test_compare_endpoint_uses_same_profile_and_reports_periods_and_differences():
    with TestClient(app) as client:
        response = client.post("/api/rental/compare", json={
            "left_offer": offer("A", 1000, 6),
            "right_offer": offer("B", 1200, 12),
            "financial_profile": finances(),
        })
    assert response.status_code == 200
    body = response.json()
    assert body["differences"]["left_minus_right"]["base_rent_per_month"] == -200
    assert body["differences"]["lease_terms_differ"] is True
    assert body["differences"]["total_period_costs_directly_comparable"] is False
    assert body["differences"]["left_minus_right"]["normalized_known_lease_expense_per_month"] == -195.84


def test_evaluate_optional_financial_profile_and_invalid_nested_terms_return_422():
    with TestClient(app) as client:
        assert client.post("/api/rental/evaluate", json={"offer": offer()}).status_code == 200
        invalid = offer()
        invalid["upfront"]["holding_deposit_status"] = "provided"
        invalid["upfront"]["holding_deposit"] = None
        response = client.post("/api/rental/evaluate", json={"offer": invalid, "financial_profile": finances()})
        assert response.status_code == 422
        overcredit = offer()
        overcredit["upfront"]["holding_deposit"] = {"amount": 1200, "treatment": "credited_to_security_deposit"}
        overcredit["upfront"]["holding_deposit_status"] = "provided"
        assert client.post("/api/rental/evaluate", json={"offer": overcredit}).status_code == 422
        assert client.post("/api/rental/compare", json={"left_offer": offer()}).status_code == 422


def test_nonfinite_sensitive_values_fail_without_echoing_payload():
    raw = '{"offer":{"rental_label":"Private","monthly_base_rent":NaN,"lease_term_months":12}}'
    with TestClient(app) as client:
        response = client.post("/api/rental/evaluate", content=raw, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert "NaN" not in response.text
    assert "Private" not in response.text


def test_deterministic_api_results_and_openapi_documents_new_routes():
    with TestClient(app) as client:
        first = client.post("/api/rental/evaluate", json={"offer": offer()})
        second = client.post("/api/rental/evaluate", json={"offer": offer()})
        spec = client.get("/openapi.json").json()
    assert first.json() == second.json()
    assert "/api/rental/evaluate" in spec["paths"]
    assert "/api/rental/compare" in spec["paths"]


def test_existing_housing_and_geographic_endpoints_remain_available():
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
        assert client.post("/api/optimize", json={"monthly_budget": 1900, "bedrooms": 1}).json()["summary"]["eligible_count"] == 38
        assert len(client.get("/api/geo/housing").json()["features"]) == 64
        assert len(client.get("/api/geo/stations").json()["features"]) == 143
        assert len(client.get("/api/geo/housing-points").json()["features"]) == 64
