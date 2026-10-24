import json

import pytest

from backend.app.optimization.sensitivity import analyze_sensitivity


def area(zip_code, rent, workplace, station):
    return {
        "area_id": f"ZCTA:{zip_code}", "zip_code": zip_code,
        "latitude": 41, "longitude": -87,
        "hud_studio_rent": rent, "hud_1br_rent": rent,
        "hud_2br_rent": rent, "hud_3br_rent": rent, "hud_4br_rent": rent,
        "workplace_distance_km": workplace, "nearest_cta_station_km": station,
    }


AREAS = [
    area("00001", 1000, 5, 1),
    area("00002", 1200, 9, 1),  # blocked by workplace maximum
    area("00003", 1300, 7, 1),
    area("00004", 1400, 4, 4),  # blocked by station maximum
    area("00005", 1500, 6, 1),
]
PROFILE = {"monthly_budget": 1100, "bedrooms": 1, "max_workplace_distance_km": 8, "max_station_distance_km": 2}


def test_budget_increase_decrease_and_exact_unlock_respect_other_limits():
    result = analyze_sensitivity(PROFILE, AREAS, alternative_budgets=[1000, 1300, 1600])
    assert result["baseline"]["eligible_count"] == 1
    assert [item["eligible_count"] for item in result["budget_variations"]] == [1, 2, 3]
    assert result["budget_variations"][1]["newly_eligible_area_ids"] == ["ZCTA:00003"]
    assert result["next_budget_unlock"] == {
        "monthly_budget": 1300,
        "increase_required": 200,
        "newly_unlocked_area_ids": ["ZCTA:00003"],
    }
    assert "ZCTA:00002" not in result["budget_variations"][2]["newly_eligible_area_ids"]


def test_budget_decrease_removes_areas_and_workplace_limit_can_unlock():
    profile = PROFILE | {"monthly_budget": 1500}
    result = analyze_sensitivity(
        profile, AREAS, alternative_budgets=[1100], workplace_limits_km=[9], station_limits_km=[4]
    )
    assert result["budget_variations"][0]["no_longer_eligible_area_ids"] == ["ZCTA:00003", "ZCTA:00005"]
    assert result["workplace_limit_variations"][0]["newly_eligible_area_ids"] == ["ZCTA:00002"]
    assert result["station_limit_variations"][0]["newly_eligible_area_ids"] == ["ZCTA:00004"]


def test_no_further_unlock_and_soft_budget():
    limited = analyze_sensitivity(PROFILE | {"monthly_budget": 1500, "max_workplace_distance_km": 5}, AREAS)
    assert limited["next_budget_unlock"] is None
    soft = analyze_sensitivity(PROFILE | {"budget_is_hard_constraint": False}, AREAS, alternative_budgets=[1000, 2000])
    assert soft["next_budget_unlock"] is None
    assert [item["eligible_count"] for item in soft["budget_variations"]] == [3, 3]
    assert "budget is soft" in soft["next_budget_unlock_explanation"]


def test_sensitivity_bounds_and_json():
    with pytest.raises(ValueError, match="at most 8"):
        analyze_sensitivity(PROFILE, AREAS, alternative_budgets=list(range(1, 10)))
    with pytest.raises(ValueError, match="finite positive"):
        analyze_sensitivity(PROFILE, AREAS, alternative_budgets=[float("nan")])
    result = analyze_sensitivity(PROFILE, AREAS, alternative_budgets=[])
    json.dumps(result, allow_nan=False)
