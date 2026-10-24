"""Run the three Batch 2A preference scenarios against the real public core."""

from __future__ import annotations

import json

from backend.app.optimization import optimize_housing


SCENARIOS = {
    "A_budget_conscious": {
        "monthly_budget": 1600, "bedrooms": 1, "annual_income": 65000,
        "rent_weight": 0.6, "workplace_weight": 0.2, "station_weight": 0.2,
        "max_results": 5,
    },
    "B_balanced": {
        "monthly_budget": 1900, "bedrooms": 1, "annual_income": 75000,
        "rent_weight": 0.34, "workplace_weight": 0.33, "station_weight": 0.33,
        "max_results": 5,
    },
    "C_accessibility_focused": {
        "monthly_budget": 2400, "bedrooms": 1,
        "rent_weight": 0.1, "workplace_weight": 0.45, "station_weight": 0.45,
        "max_results": 5,
    },
}


def run_demo() -> dict[str, object]:
    output = {}
    for name, preferences in SCENARIOS.items():
        result = optimize_housing(preferences)
        output[name] = {
            "summary": result["summary"],
            "top_five": [
                {
                    "area_id": area["area_id"],
                    "zip_code": area["zip_code"],
                    "hud_monthly_rent": area["hud_monthly_rent"],
                    "workplace_distance_km": area["workplace_distance_km"],
                    "nearest_cta_station_km": area["nearest_cta_station_km"],
                    "pareto_efficient": area["pareto_efficient"],
                }
                for area in result["recommendations"]
            ],
        }
    return output


if __name__ == "__main__":
    print(json.dumps(run_demo(), indent=2, allow_nan=False))
