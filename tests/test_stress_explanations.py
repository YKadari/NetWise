"""Strict server-owned stress interpretation selection tests."""
import pytest

from backend.app.ai_explanations.stress_explanations import render_ai_stress


def test_stress_selection_rejects_duplicate_ids_even_when_each_field_allows_them():
    catalog = {field: {"shared": f"Approved {field} text"} for field in (
        "headline", "what_changed", "main_consequence", "why_it_matters", "what_to_watch", "what_to_consider")}
    raw = {field: "shared" for field in catalog}
    with pytest.raises(ValueError, match="unsupported_stress_selection"):
        render_ai_stress(raw, catalog)


def test_stress_selection_rejects_prose_and_unapproved_ids():
    catalog = {field: {field: f"Approved {field} text"} for field in (
        "headline", "what_changed", "main_consequence", "why_it_matters", "what_to_watch", "what_to_consider")}
    raw = {field: field for field in catalog}
    raw["main_consequence"] = "It costs $999 and is definitely affordable"
    with pytest.raises(ValueError, match="unsupported_stress_selection"):
        render_ai_stress(raw, catalog)
