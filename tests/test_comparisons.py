import json

import pytest

from backend.app.optimization.comparisons import compare_areas, compare_scenarios
from tests.test_sensitivity import AREAS


def test_counterfactual_hard_constraint_changes_eligibility():
    baseline = {"monthly_budget": 1100, "bedrooms": 1}
    modified = {"monthly_budget": 1300, "bedrooms": 1}
    result = compare_scenarios(baseline, modified, AREAS)
    assert result["baseline"]["eligible_count"] == 1
    assert result["modified"]["eligible_count"] == 3
    assert result["newly_eligible_area_ids"] == ["ZCTA:00002", "ZCTA:00003"]
    assert result["eligible_count_change"] == 2
    json.dumps(result, allow_nan=False)


def test_weight_only_change_does_not_change_eligibility_or_frontier():
    baseline = {"monthly_budget": 1500, "bedrooms": 1}
    modified = baseline | {"rent_weight": 0.1, "workplace_weight": 0.8, "station_weight": 0.1}
    result = compare_scenarios(baseline, modified, AREAS)
    assert result["eligible_count_change"] == result["pareto_count_change"] == 0
    assert result["newly_eligible_area_ids"] == result["newly_excluded_area_ids"] == []
    assert result["entered_pareto_area_ids"] == result["left_pareto_area_ids"] == []
    assert "Only display weights changed" in result["explanation"]


def test_counterfactual_handles_zero_viable_areas():
    result = compare_scenarios(
        {"monthly_budget": 500, "bedrooms": 1},
        {"monthly_budget": 600, "bedrooms": 1}, AREAS,
    )
    assert result["baseline"]["eligible_count"] == 0
    assert result["modified"]["eligible_count"] == 0
    assert result["eligible_count_change"] == 0


def test_area_comparison_returns_all_rents_metadata_and_differences():
    result = compare_areas(["ZCTA:00001", "ZCTA:00003"], bedrooms=1, areas=AREAS)
    assert len(result["areas"]) == 2
    assert result["areas"][0]["selected_hud_rent"] == 1000
    assert result["areas"][1]["selected_hud_rent"] == 1300
    assert result["pairwise_differences"][0]["selected_hud_rent_difference_left_minus_right"] == -300
    assert result["areas"][0]["zip_code"] == "00001"
    assert "hud_4br_rent" in result["areas"][0]
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("ids,error", [
    (["ZCTA:00001"], ValueError),
    (["ZCTA:00001", "ZCTA:00001"], ValueError),
    (["00001", "ZCTA:00003"], ValueError),
    (["ZCTA:00001", "ZCTA:99999"], LookupError),
])
def test_area_comparison_rejects_invalid_or_missing_ids(ids, error):
    with pytest.raises(error):
        compare_areas(ids, areas=AREAS)
