import copy
import json

import pytest

from backend.app.optimization import Preferences, optimize_housing
from backend.app.optimization.data_loader import load_public_areas, validate_areas
from backend.app.optimization.models import RENT_FIELDS


def area(zip_code="00001", rents=(1000, 1200, 1400, 1600, 1800), workplace=5.0, station=1.0):
    item = {
        "area_id": f"ZCTA:{zip_code}", "zip_code": zip_code,
        "latitude": 41.0, "longitude": -87.0,
        "workplace_distance_km": workplace, "nearest_cta_station_km": station,
        "nearest_cta_station_id": "S1", "nearest_cta_station_name": "Test Station",
        "cta_stations_within_2km": 2,
        "hud_area_id": "HUD", "hud_data_year": 2027, "geography_source_year": 2020,
        "workplace_name": "Chicago Loop demo destination (Clark/Lake station)",
        "source_attribution": "HUD; Census; CTA", "distance_definition": "straight-line",
    }
    item.update(dict(zip(RENT_FIELDS, rents)))
    return item


def run(items=None, **changes):
    profile = {"monthly_budget": 2000, "bedrooms": 1, **changes}
    return optimize_housing(profile, areas=[area()] if items is None else items)


@pytest.mark.parametrize("bedrooms,expected", [(0, 1000), (1, 1200), (2, 1400), (3, 1600), (4, 1800)])
def test_all_five_hud_bedroom_benchmarks(bedrooms, expected):
    result = run(bedrooms=bedrooms)
    assert result["recommendations"][0]["hud_monthly_rent"] == expected
    assert result["recommendations"][0]["bedrooms"] == bedrooms


@pytest.mark.parametrize("budget,eligible,difference", [(1199, 0, None), (1200, 1, 0), (1201, 1, 1)])
def test_budget_threshold_is_inclusive(budget, eligible, difference):
    result = run(monthly_budget=budget)
    assert result["summary"]["eligible_count"] == eligible
    if eligible:
        assert result["recommendations"][0]["budget_difference"] == difference
    else:
        assert result["diagnostics"]["excluded_areas"][0]["reasons"] == ["over_budget"]


def test_income_is_optional_and_burden_uses_gross_monthly_income():
    with_income = run(annual_income=60000)
    assert with_income["recommendations"][0]["rent_burden_pct"] == pytest.approx(24.0)
    assert run()["recommendations"][0]["rent_burden_pct"] is None


def test_missing_rent_is_excluded_even_with_soft_budget():
    item = area(rents=(1000, None, 1400, 1600, 1800))
    result = run([item], budget_is_hard_constraint=False)
    assert result["summary"]["eligible_count"] == 0
    assert result["diagnostics"]["excluded_areas"][0]["reasons"] == ["rent_unavailable"]


def test_missing_distances_fail_only_requested_hard_limits_and_never_get_imputed():
    item = area(workplace=None, station=None)
    unconstrained = run([item])
    assert unconstrained["summary"]["eligible_count"] == 1
    assert unconstrained["summary"]["eligible_unranked_missing_objectives_count"] == 1
    assert unconstrained["recommendations"] == []
    constrained = run([item], max_workplace_distance_km=5, max_station_distance_km=2)
    assert constrained["diagnostics"]["excluded_areas"][0]["reasons"] == [
        "workplace_distance_unavailable", "station_distance_unavailable"
    ]


@pytest.mark.parametrize("changes", [
    {"monthly_budget": 0}, {"monthly_budget": float("inf")}, {"bedrooms": 5},
    {"bedrooms": 1.5}, {"annual_income": -1}, {"max_station_distance_km": -1},
    {"max_workplace_distance_km": float("nan")}, {"budget_is_hard_constraint": "yes"},
    {"rent_weight": 0, "workplace_weight": 0, "station_weight": 0},
    {"rent_weight": -1}, {"max_results": 0}, {"max_results": 101},
])
def test_invalid_preferences_are_rejected(changes):
    with pytest.raises(ValueError):
        Preferences(**{"monthly_budget": 2000, "bedrooms": 1, **changes})


def test_hard_and_soft_budget_behavior():
    item = area(rents=(1000, 2100, 1400, 1600, 1800))
    assert run([item])["summary"]["eligible_count"] == 0
    soft = run([item], budget_is_hard_constraint=False)
    assert soft["summary"]["eligible_count"] == 1
    assert soft["recommendations"][0]["budget_difference"] == -100
    assert soft["recommendations"][0]["within_budget"] is False


def test_workplace_and_station_maxima_are_inclusive():
    at_limit = run(max_workplace_distance_km=5, max_station_distance_km=1)
    assert at_limit["summary"]["eligible_count"] == 1
    too_far = run(max_workplace_distance_km=4.99, max_station_distance_km=0.99)
    assert too_far["diagnostics"]["excluded_areas"][0]["reasons"] == [
        "workplace_too_far", "station_too_far"
    ]


def test_multiple_exclusion_reasons_are_counted_per_area():
    item = area(rents=(1000, 2100, 1400, 1600, 1800), workplace=None, station=3)
    result = run([item], max_workplace_distance_km=5, max_station_distance_km=2)
    assert result["summary"]["excluded_count"] == 1
    assert result["summary"]["exclusion_reason_counts"] == {
        "over_budget": 1, "station_too_far": 1, "workplace_distance_unavailable": 1
    }


def test_empty_eligible_set_returns_valid_json_and_no_recommendations():
    result = run([area(rents=(1000, 2500, 1400, 1600, 1800))])
    assert result["summary"]["eligible_count"] == 0
    assert result["recommendations"] == []
    json.dumps(result, allow_nan=False)


def test_pareto_priority_dominated_fill_and_eligible_only_recommendations():
    items = [
        area("00001", workplace=2, station=1),
        area("00002", rents=(1000, 1300, 1400, 1600, 1800), workplace=3, station=2),
        area("00003", rents=(1000, 2100, 1400, 1600, 1800), workplace=0.1, station=0.1),
    ]
    result = run(items, max_results=3)
    assert result["diagnostics"]["pareto_frontier_area_ids"] == ["ZCTA:00001"]
    assert [x["area_id"] for x in result["recommendations"]] == ["ZCTA:00001", "ZCTA:00002"]
    assert result["recommendations"][1]["pareto_efficient"] is False
    assert result["diagnostics"]["dominated_by_example"]["ZCTA:00002"] == "ZCTA:00001"


def test_zero_range_normalization_weight_normalization_and_ties():
    items = [area("00002", workplace=5, station=1), area("00001", workplace=5, station=1)]
    result = run(items, rent_weight=2, workplace_weight=1, station_weight=1)
    assert result["diagnostics"]["ranking_method"]["normalized_weights"] == {
        "hud_monthly_rent": 0.5, "workplace_distance_km": 0.25, "nearest_cta_station_km": 0.25
    }
    assert [x["area_id"] for x in result["recommendations"]] == ["ZCTA:00001", "ZCTA:00002"]
    assert [x["normalized_preference_score"] for x in result["recommendations"]] == [0, 0]


def test_data_loader_validates_ids_coordinates_and_nonnegative_metrics():
    assert validate_areas([area("00001")])[0].zip_code == "00001"
    with pytest.raises(ValueError, match="Duplicate"):
        validate_areas([area("00001"), area("00001")])
    with pytest.raises(ValueError, match="latitude"):
        validate_areas([area("00001") | {"latitude": 91}])
    with pytest.raises(ValueError, match="nonnegative"):
        validate_areas([area("00001", station=-1)])


def test_real_public_dataset_loads_with_64_stable_areas():
    areas = load_public_areas()
    assert len(areas) == 64
    assert len({item.area_id for item in areas}) == 64
    assert all(len(item.zip_code) == 5 for item in areas)
    assert areas[0].hud_data_year == 2027
    assert areas[0].transit_feed_date is None


def test_no_mutation_and_repeated_results_are_deterministic_json():
    fixture = [area("00002"), area("00001", workplace=2)]
    original = copy.deepcopy(fixture)
    first = run(fixture)
    second = run(fixture)
    assert fixture == original
    assert first == second
    json.dumps(first, allow_nan=False)


def test_real_scenarios_never_recommend_excluded_areas_and_have_correct_frontiers():
    from scripts.demo_optimizer import SCENARIOS

    for profile in SCENARIOS.values():
        result = optimize_housing(profile)
        eligible = result["diagnostics"]["eligible_candidates"]
        excluded_ids = {item["area_id"] for item in result["diagnostics"]["excluded_areas"]}
        recommended_ids = {item["area_id"] for item in result["recommendations"]}
        assert not recommended_ids & excluded_ids
        assert all(item["hud_monthly_rent"] <= profile["monthly_budget"] for item in result["recommendations"])
        vectors = {
            item["area_id"]: (item["hud_monthly_rent"], item["workplace_distance_km"], item["nearest_cta_station_km"])
            for item in eligible
        }
        independently_nondominated = {
            area_id for area_id, value in vectors.items()
            if not any(
                other_id != area_id
                and all(a <= b for a, b in zip(other, value))
                and any(a < b for a, b in zip(other, value))
                for other_id, other in vectors.items()
            )
        }
        assert set(result["diagnostics"]["pareto_frontier_area_ids"]) == independently_nondominated
        assert {item["area_id"] for item in result["recommendations"] if item["pareto_efficient"]} <= independently_nondominated
        json.dumps(result, allow_nan=False)
