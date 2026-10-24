"""Counterfactual profile and side-by-side area comparisons."""

from __future__ import annotations

from dataclasses import asdict
from typing import Iterable, Mapping
import re

from .data_loader import load_public_areas, validate_areas
from .engine import LIMITATIONS, optimize_housing
from .models import HousingArea, Preferences, RENT_FIELDS


def _profile(value: Preferences | Mapping[str, object]) -> Preferences:
    return value if isinstance(value, Preferences) else Preferences(**value)


def compare_scenarios(
    baseline_preferences: Preferences | Mapping[str, object],
    modified_preferences: Preferences | Mapping[str, object],
    areas: Iterable[HousingArea | Mapping[str, object]] | None = None,
) -> dict[str, object]:
    """Re-evaluate two profiles on one immutable snapshot of public areas."""
    records = load_public_areas() if areas is None else validate_areas(areas)
    baseline, modified = _profile(baseline_preferences), _profile(modified_preferences)
    before = optimize_housing(baseline, records)
    after = optimize_housing(modified, records)
    before_ids = {item["area_id"] for item in before["diagnostics"]["eligible_candidates"]}
    after_ids = {item["area_id"] for item in after["diagnostics"]["eligible_candidates"]}
    before_frontier = set(before["diagnostics"]["pareto_frontier_area_ids"])
    after_frontier = set(after["diagnostics"]["pareto_frontier_area_ids"])
    changed_fields = sorted(
        field for field, value in asdict(baseline).items() if value != getattr(modified, field)
    )
    weights_only = bool(changed_fields) and set(changed_fields) <= {"rent_weight", "workplace_weight", "station_weight"}
    explanation = (
        "Only display weights changed; eligibility and Pareto membership are unchanged. Recommendation order may change."
        if weights_only else
        f"Eligibility changed by {after['summary']['eligible_count'] - before['summary']['eligible_count']:+d} areas; Pareto membership changed by {len(after_frontier) - len(before_frontier):+d} areas."
    )
    return {
        "baseline_preferences": asdict(baseline),
        "modified_preferences": asdict(modified),
        "changed_fields": changed_fields,
        "baseline": {
            "eligible_count": before["summary"]["eligible_count"],
            "excluded_count": before["summary"]["excluded_count"],
            "pareto_efficient_count": before["summary"]["pareto_efficient_count"],
            "top_recommendation_area_ids": [item["area_id"] for item in before["recommendations"]],
        },
        "modified": {
            "eligible_count": after["summary"]["eligible_count"],
            "excluded_count": after["summary"]["excluded_count"],
            "pareto_efficient_count": after["summary"]["pareto_efficient_count"],
            "top_recommendation_area_ids": [item["area_id"] for item in after["recommendations"]],
        },
        "newly_eligible_area_ids": sorted(after_ids - before_ids),
        "newly_excluded_area_ids": sorted(before_ids - after_ids),
        "entered_pareto_area_ids": sorted(after_frontier - before_frontier),
        "left_pareto_area_ids": sorted(before_frontier - after_frontier),
        "eligible_count_change": len(after_ids) - len(before_ids),
        "pareto_count_change": len(after_frontier) - len(before_frontier),
        "explanation": explanation,
    }


def area_attributes(area: HousingArea) -> dict[str, object]:
    """Expose only the established public attributes of an area."""
    return {
        "area_id": area.area_id,
        "zip_code": area.zip_code,
        "latitude": area.latitude,
        "longitude": area.longitude,
        **dict(zip(RENT_FIELDS, area.rents)),
        "hud_area_id": area.hud_area_id,
        "hud_area_name": area.hud_area_name,
        "hud_data_year": area.hud_data_year,
        "geography_source_year": area.geography_source_year,
        "workplace_name": area.workplace_name,
        "workplace_latitude": area.workplace_latitude,
        "workplace_longitude": area.workplace_longitude,
        "workplace_distance_km": area.workplace_distance_km,
        "nearest_cta_station_id": area.nearest_cta_station_id,
        "nearest_cta_station_name": area.nearest_cta_station_name,
        "nearest_cta_station_km": area.nearest_cta_station_km,
        "nearest_cta_station_miles": area.nearest_cta_station_miles,
        "cta_stations_within_2km": area.cta_stations_within_2km,
        "transit_feed_date": area.transit_feed_date,
        "source_attribution": area.source_attribution,
        "distance_definition": area.distance_definition,
    }


def compare_areas(
    area_ids: list[str],
    bedrooms: int | None = None,
    areas: Iterable[HousingArea | Mapping[str, object]] | None = None,
) -> dict[str, object]:
    if not 2 <= len(area_ids) <= 4:
        raise ValueError("Compare between 2 and 4 area IDs")
    if len(set(area_ids)) != len(area_ids):
        raise ValueError("Area IDs must be unique")
    if any(not re.fullmatch(r"ZCTA:\d{5}", area_id) for area_id in area_ids):
        raise ValueError("Area IDs must use the ZCTA:12345 format")
    if bedrooms is not None and (isinstance(bedrooms, bool) or not isinstance(bedrooms, int) or bedrooms not in range(5)):
        raise ValueError("bedrooms must be an integer from 0 through 4")
    records = load_public_areas() if areas is None else validate_areas(areas)
    by_id = {area.area_id: area for area in records}
    unknown = [area_id for area_id in area_ids if area_id not in by_id]
    if unknown:
        raise LookupError(f"Unknown area IDs: {', '.join(unknown)}")
    selected = [by_id[area_id] for area_id in area_ids]
    rows = []
    for area in selected:
        row = area_attributes(area)
        row["selected_bedrooms"] = bedrooms
        row["selected_hud_rent"] = area.rents[bedrooms] if bedrooms is not None else None
        row["source_and_measurement_limitations"] = list(LIMITATIONS)
        rows.append(row)
    differences = []
    for i, left in enumerate(selected):
        for right in selected[i + 1:]:
            differences.append({
                "left_area_id": left.area_id,
                "right_area_id": right.area_id,
                "selected_hud_rent_difference_left_minus_right": _difference(
                    left.rents[bedrooms], right.rents[bedrooms]
                ) if bedrooms is not None else None,
                "workplace_distance_km_difference_left_minus_right": _difference(
                    left.workplace_distance_km, right.workplace_distance_km
                ),
                "nearest_cta_station_km_difference_left_minus_right": _difference(
                    left.nearest_cta_station_km, right.nearest_cta_station_km
                ),
            })
    return {"area_ids": area_ids, "bedrooms": bedrooms, "areas": rows, "pairwise_differences": differences}


def _difference(left: float | None, right: float | None) -> float | None:
    return left - right if left is not None and right is not None else None
