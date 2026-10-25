"""Grounded decision brief and production gate; no live Gemini calls."""
from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

from backend.app.ai_explanations.decision_brief import build_context, follow_up_catalog, render_follow_ups, render_selection, statement_catalog
from backend.app.ai_explanations import provider
from backend.app.api import decision_brief_routes, lease_routes
from backend.app.lease_extraction.provider import GeminiOutputError, GeminiProviderError, GeminiQuotaError
from backend.app.main import app
from backend.app.rental.calculations import evaluate_rental
from backend.app.rental.models import RentalOffer


OFFER = {
    "rental_label": "SYNTHETIC PRIVATE LABEL",
    "monthly_base_rent": 1600,
    "lease_term_months": 12,
    "recurring_charges": [{"name": "Internet", "monthly_amount": 40}],
    "recurring_charges_status": "unknown",
    "utilities": {"status": "estimated", "estimated_monthly_amount": 130},
    "upfront": {
        "security_deposit": {"status": "provided", "amount": 800},
        "first_month_rent_due_upfront": "yes",
        "last_month_rent_due_upfront": "no",
        "nonrefundable_fees": [{"name": "Application fee", "amount": 100}],
        "nonrefundable_fees_status": "unknown",
        "other_charges_status": "complete",
        "holding_deposit_status": "unknown",
    },
}


@pytest.fixture(autouse=True)
def clear_limit():
    lease_routes._REQUEST_TIMES.clear()
    yield
    lease_routes._REQUEST_TIMES.clear()


def selection(catalog):
    return {
        "headline": next(iter(catalog["headline"])),
        "overall_summary": next(iter(catalog["overall_summary"])),
        "important_findings": ["monthly", "upfront"],
        "key_uncertainties": list(catalog["key_uncertainties"])[:2],
        "suggested_next_step": next(iter(catalog["suggested_next_step"])),
        "follow_up_ids": list(catalog.get("follow_up_ids", {}))[:3],
    }


def enabled(monkeypatch):
    monkeypatch.setenv("NESTWISE_ENV", "production")
    monkeypatch.setenv("NESTWISE_ENABLE_PUBLIC_GEMINI", "true")
    monkeypatch.setenv("GEMINI_API_KEY", "SYNTHETIC-KEY-NEVER-PRINT")


def test_context_is_minimal_and_preserves_financial_meanings():
    offer = RentalOffer.model_validate(OFFER)
    evaluation = evaluate_rental(offer)
    facts = build_context(offer, evaluation)
    assert facts["known_monthly_housing"] == "$1,770"
    assert facts["known_upfront_cash"] == "$2,500"
    assert facts["known_lease_expense"] == "$21,340"
    assert facts["refundable_cash_held"] == "$800"
    assert facts["has_prepaid_rent"] is True
    assert facts["utilities_estimated"] is True
    assert facts["monthly_complete"] is False
    assert facts["upfront_complete"] is False
    assert facts["lease_complete"] is False
    assert {"holding_deposit", "nonrefundable_fees", "recurring_charges"} <= set(facts["unknown_categories"])
    assert "SYNTHETIC PRIVATE LABEL" not in str(facts)
    assert "Internet" not in str(facts)
    catalog = statement_catalog(facts)
    assert "subtotal" in catalog["overall_summary"]["monthly"].lower()
    assert "estimated utilities" in catalog["overall_summary"]["monthly"]
    assert "not guaranteed" in catalog["important_findings"]["deposit"]
    assert "estimate" in catalog["important_findings"]["utilities_estimate"]
    assert "extra month" in catalog["important_findings"]["prepaid"]


def test_complete_offer_and_missing_profile_do_not_invent_extras_or_affordability():
    complete = {**OFFER, "recurring_charges": [], "recurring_charges_status": "complete", "utilities": {"status": "included_in_rent"}, "upfront": {
        "security_deposit": {"status": "none"}, "first_month_rent_due_upfront": "no", "last_month_rent_due_upfront": "no",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete", "holding_deposit_status": "none",
    }}
    offer = RentalOffer.model_validate(complete)
    facts = build_context(offer, evaluate_rental(offer))
    catalog = statement_catalog(facts)
    assert facts["monthly_complete"] and facts["upfront_complete"] and facts["lease_complete"]
    assert facts["affordability_status"] == "not_evaluated"
    assert facts["unknown_categories"] == []
    assert catalog["key_uncertainties"] == {}
    assert "No additional monthly charge" in catalog["important_findings"]["monthly"]
    assert "affordab" not in str(catalog).lower()


def test_unknown_future_category_remains_visible_without_sending_its_raw_text():
    offer = RentalOffer.model_validate(OFFER)
    evaluation = evaluate_rental(offer)
    evaluation["unknown_cost_categories"].append("SECRET USER CONTENT")
    facts = build_context(offer, evaluation)
    assert facts["has_other_unknown"] is True
    assert "SECRET USER CONTENT" not in str(facts)
    assert "other_unconfirmed_term" in statement_catalog(facts)["key_uncertainties"]


def test_selection_rejects_invented_numbers_prose_and_extra_fields():
    offer = RentalOffer.model_validate(OFFER)
    facts = build_context(offer, evaluate_rental(offer))
    followups = follow_up_catalog(offer, facts)
    catalog = {**statement_catalog(facts), "follow_up_ids": {key: key for key in followups}}
    statement_choices = statement_catalog(facts)
    valid = selection(catalog)
    rendered = render_selection(valid, statement_choices, followups)
    assert rendered["source"] == "gemini"
    assert rendered["important_findings"][0] == statement_choices["important_findings"]["monthly"]
    for bad in ({**valid, "overall_summary": "Your rent is $999"}, {**valid, "invented": "fee"}, {**valid, "important_findings": ["monthly", "monthly"]}, {**valid, "key_uncertainties": []}):
        with pytest.raises(ValueError):
            render_selection(bad, statement_choices, followups)
    with pytest.raises(ValueError, match="unsupported_follow_up_selection"):
        eligible_ids = list(followups)
        render_selection({**valid, "follow_up_ids": [eligible_ids[0], eligible_ids[1], "ineligible_candidate"]}, statement_choices, followups)


def test_server_recomputes_totals_and_does_not_send_profile_values_or_names(monkeypatch):
    enabled(monkeypatch)
    captured = {}
    def fake_generate(facts, catalog):
        captured.update(facts)
        return selection(catalog)
    monkeypatch.setattr(decision_brief_routes, "generate_selection", fake_generate)
    profile = {"monthly_take_home_income": 4500, "available_savings": 8000, "essential_monthly_nonhousing_expenses": 1800, "student_loan_included_in_essential_expenses": True}
    with TestClient(app) as client:
        response = client.post("/api/rental/decision-brief", json={"offer": OFFER, "financial_profile": profile})
        fabricated = client.post("/api/rental/decision-brief", json={"offer": OFFER, "verified_total": 1})
    assert response.status_code == 200
    assert response.json()["source"] == "gemini"
    assert "$1,770" in response.json()["overall_summary"]
    assert captured["affordability_status"] in {"within_budget", "unknown", "exceeds_budget"}
    assert "4500" not in str(captured) and "8000" not in str(captured)
    assert "SYNTHETIC PRIVATE LABEL" not in str(captured)
    assert fabricated.status_code == 422
    assert '"input"' not in fabricated.text


def test_gate_blocks_every_provider_call_when_production_flag_is_false(monkeypatch):
    monkeypatch.setenv("NESTWISE_ENV", "production")
    monkeypatch.setenv("NESTWISE_ENABLE_PUBLIC_GEMINI", "false")
    monkeypatch.setattr(decision_brief_routes, "generate_selection", lambda *_: pytest.fail("provider was called"))
    with TestClient(app) as client:
        response = client.post("/api/rental/decision-brief", json={"offer": OFFER})
        public = client.post("/api/rental/evaluate", json={"offer": OFFER})
    assert response.status_code == 503
    assert public.status_code == 200


@pytest.mark.parametrize("failure, status", [
    (GeminiQuotaError(), 429), (TimeoutError(), 504), (GeminiProviderError(), 502),
])
def test_provider_failures_are_sanitized(monkeypatch, caplog, failure, status):
    enabled(monkeypatch)
    monkeypatch.setattr(decision_brief_routes, "generate_selection", lambda *_: (_ for _ in ()).throw(failure))
    with TestClient(app) as client:
        response = client.post("/api/rental/decision-brief", json={"offer": OFFER})
    assert response.status_code == status
    assert "SYNTHETIC PRIVATE LABEL" not in response.text
    assert "SYNTHETIC-KEY" not in response.text
    assert "SYNTHETIC PRIVATE LABEL" not in caplog.text
    assert "SYNTHETIC-KEY" not in caplog.text


def test_invalid_model_selection_is_not_displayed(monkeypatch):
    enabled(monkeypatch)
    monkeypatch.setattr(decision_brief_routes, "generate_selection", lambda *_: {"headline": "You owe $999,999"})
    with TestClient(app) as client:
        response = client.post("/api/rental/decision-brief", json={"offer": OFFER})
    assert response.status_code == 502
    assert "999" not in response.text


def test_rate_limit_is_shared_with_lease_extraction(monkeypatch):
    enabled(monkeypatch)
    monkeypatch.setattr(decision_brief_routes, "generate_selection", lambda facts, catalog: selection(catalog))
    with TestClient(app) as client:
        for _ in range(5):
            assert client.post("/api/rental/decision-brief", json={"offer": OFFER}).status_code == 200
        limited = client.post("/api/rental/decision-brief", json={"offer": OFFER})
        lease_limited = client.post("/api/lease/extract-text", json={"text": "Synthetic lease"})
    assert limited.status_code == 429
    assert lease_limited.status_code == 429


def test_missing_key_and_unknown_incomplete_terms(monkeypatch):
    enabled(monkeypatch)
    monkeypatch.delenv("GEMINI_API_KEY")
    with TestClient(app) as client:
        response = client.post("/api/rental/decision-brief", json={"offer": OFFER})
    assert response.status_code == 503


def test_provider_uses_bounded_structured_generation(monkeypatch):
    enabled(monkeypatch)
    from google import genai
    offer = RentalOffer.model_validate(OFFER)
    facts = build_context(offer, evaluate_rental(offer))
    followups = follow_up_catalog(offer, facts)
    catalog = {**statement_catalog(facts), "follow_up_ids": {key: key for key in followups}}
    chosen = selection(catalog)
    seen = {}
    class FakeModels:
        def generate_content(self, **kwargs):
            seen.update(kwargs)
            return type("Response", (), {"text": __import__("json").dumps(chosen)})()
    class FakeClient:
        models = FakeModels()
    monkeypatch.setattr(genai, "Client", lambda **kwargs: FakeClient())
    assert provider.generate_selection(facts, catalog) == chosen
    assert seen["config"].max_output_tokens == 700
    assert seen["config"].response_mime_type == "application/json"
    assert seen["config"].response_json_schema["properties"]["follow_up_ids"]["items"]["enum"] == list(followups)
    assert seen["config"].response_json_schema["properties"]["follow_up_ids"]["minItems"] == min(3, len(followups))
    assert "deterministic rental evaluator" in seen["config"].system_instruction
    assert "SYNTHETIC PRIVATE LABEL" not in str(seen)


@pytest.mark.parametrize("error,expected", [
    (type("Quota", (Exception,), {"code": 429})(), GeminiQuotaError),
    (TimeoutError("PRIVATE REQUEST CONTENT"), TimeoutError),
    (type("Failure", (Exception,), {"code": 500})(), GeminiProviderError),
])
def test_sdk_error_categories_never_echo_raw_messages(monkeypatch, error, expected):
    enabled(monkeypatch)
    from google import genai
    facts = build_context(RentalOffer.model_validate(OFFER), evaluate_rental(OFFER))
    catalog = statement_catalog(facts)
    class FakeModels:
        def generate_content(self, **kwargs):
            raise error
    class FakeClient:
        models = FakeModels()
    monkeypatch.setattr(genai, "Client", lambda **kwargs: FakeClient())
    with pytest.raises(expected) as raised:
        provider.generate_selection(facts, catalog)
    assert "PRIVATE REQUEST CONTENT" not in str(raised.value)


def test_malformed_json_is_rejected_as_provider_output(monkeypatch):
    enabled(monkeypatch)
    from google import genai
    facts = build_context(RentalOffer.model_validate(OFFER), evaluate_rental(OFFER))
    catalog = statement_catalog(facts)
    class FakeModels:
        def generate_content(self, **kwargs):
            return type("Response", (), {"text": "not-json PRIVATE CONTENT"})()
    class FakeClient:
        models = FakeModels()
    monkeypatch.setattr(genai, "Client", lambda **kwargs: FakeClient())
    with pytest.raises(GeminiOutputError) as raised:
        provider.generate_selection(facts, catalog)
    assert "PRIVATE CONTENT" not in str(raised.value)


def test_follow_up_catalog_is_grounded_and_renders_verified_amounts():
    offer = RentalOffer.model_validate(OFFER)
    facts = build_context(offer, evaluate_rental(offer))
    candidates = follow_up_catalog(offer, facts)
    assert {"monthly_fees", "utilities", "move_in_costs", "deposit_return", "holding_deposit"} <= set(candidates)
    assert "$1,600" in candidates["monthly_fees"]["question"]
    assert "$800" in candidates["deposit_return"]["question"]
    assert "Internet" not in str(candidates)
    assert "early" not in str(candidates).lower()
    rendered = render_follow_ups(list(candidates)[:3], candidates, "deterministic")
    assert rendered["source"] == "deterministic"
    assert len(rendered["follow_ups"]) == 3
    assert len(rendered["additional_follow_ups"]) == len(candidates) - 3


def test_confirmed_absent_terms_do_not_create_questions():
    complete = {**OFFER, "recurring_charges": [], "recurring_charges_status": "complete", "utilities": {"status": "included_in_rent"}, "upfront": {
        "security_deposit": {"status": "none"}, "first_month_rent_due_upfront": "no", "last_month_rent_due_upfront": "no",
        "nonrefundable_fees_status": "complete", "other_charges_status": "complete", "holding_deposit_status": "none",
    }}
    offer = RentalOffer.model_validate(complete)
    facts = build_context(offer, evaluate_rental(offer))
    assert follow_up_catalog(offer, facts) == {}


def test_roommate_questions_require_a_modeled_contribution_and_use_derived_readiness():
    offer = RentalOffer.model_validate(OFFER)
    profile = {"monthly_take_home_income": 4500, "available_savings": 500, "essential_monthly_nonhousing_expenses": 1800, "student_loan_included_in_essential_expenses": True, "expected_roommate_contribution": 400, "minimum_emergency_cash_reserve": 1000}
    facts = build_context(offer, evaluate_rental(offer, profile))
    catalog = follow_up_catalog(offer, facts)
    assert "roommate_amount" in catalog
    assert "reserve" in catalog
    assert "4500" not in str(catalog) and "500" not in str(catalog)
    assert "roommate_liability" not in follow_up_catalog(offer, build_context(offer, evaluate_rental(offer)))


@pytest.mark.parametrize("ids", [["monthly_fees", "monthly_fees"], ["invented"]])
def test_follow_up_selection_rejects_duplicates_and_unknown_ids(ids):
    offer = RentalOffer.model_validate(OFFER)
    facts = build_context(offer, evaluate_rental(offer))
    candidates = follow_up_catalog(offer, facts)
    with pytest.raises(ValueError, match="unsupported_follow_up_selection"):
        render_follow_ups(ids, candidates, "gemini")


def test_ai_selection_ranks_only_allowed_followups_and_requires_expected_count():
    offer = RentalOffer.model_validate(OFFER)
    facts = build_context(offer, evaluate_rental(offer))
    followups = follow_up_catalog(offer, facts)
    selection_catalog = {**statement_catalog(facts), "follow_up_ids": {key: key for key in followups}}
    selected = selection(selection_catalog)
    rendered = render_selection(selected, statement_catalog(facts), followups)
    assert [item["title"] for item in rendered["follow_ups"]] == [followups[item]["title"] for item in selected["follow_up_ids"]]
    with pytest.raises(ValueError, match="unsupported_follow_up_selection"):
        render_selection({**selected, "follow_up_ids": ["invented"]}, statement_catalog(facts), followups)


def test_deterministic_follow_up_endpoint_remains_available_when_ai_is_disabled(monkeypatch):
    monkeypatch.setenv("NESTWISE_ENV", "production")
    monkeypatch.setenv("NESTWISE_ENABLE_PUBLIC_GEMINI", "false")
    monkeypatch.setattr(decision_brief_routes, "generate_selection", lambda *_: pytest.fail("AI provider must not run"))
    with TestClient(app) as client:
        response = client.post("/api/rental/follow-ups", json={"offer": OFFER})
    assert response.status_code == 200
    assert response.json()["source"] == "deterministic"
    assert response.json()["follow_ups"]
