"""Eligibility, Pareto analysis, and deterministic preference ordering."""

from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
import json
import math
from typing import Iterable, Mapping

from .data_loader import load_public_areas, validate_areas
from .models import BEDROOM_LABELS, HousingArea, Preferences
from .pareto import OBJECTIVES, pareto_frontier


LIMITATIONS = (
    "HUD SAFMR is a benchmark, not an available apartment listing.",
    "Distances are straight-line measurements from a ZCTA representative point, not a walk or commute.",
    "Workplace distance uses the default Clark/Lake Loop destination, not a personal workplace.",
)


@dataclass(frozen=True)
class EvaluatedArea:
    area: HousingArea
    rent: float | None
    budget_difference: float | None
    within_budget: bool | None
    rent_burden_pct: float | None
    exclusion_reasons: tuple[str, ...]

    @property
    def complete_objectives(self) -> bool:
        return self.rent is not None and self.area.workplace_distance_km is not None and self.area.nearest_cta_station_km is not None

    @property
    def objectives(self) -> tuple[float, float, float]:
        if not self.complete_objectives:
            raise ValueError(f"Incomplete objectives for {self.area.area_id}")
        assert self.rent is not None and self.area.workplace_distance_km is not None and self.area.nearest_cta_station_km is not None
        return self.rent, self.area.workplace_distance_km, self.area.nearest_cta_station_km


def evaluate_candidates(preferences: Preferences, areas: Iterable[HousingArea]) -> tuple[list[EvaluatedArea], list[EvaluatedArea], dict[str, int]]:
    eligible: list[EvaluatedArea] = []
    excluded: list[EvaluatedArea] = []
    reason_counts: Counter[str] = Counter()
    for area in areas:
        rent = area.rents[preferences.bedrooms]
        difference = preferences.monthly_budget - rent if rent is not None else None
        reasons: list[str] = []
        if rent is None:
            reasons.append("rent_unavailable")
        elif preferences.budget_is_hard_constraint and rent > preferences.monthly_budget:
            reasons.append("over_budget")
        if preferences.max_workplace_distance_km is not None:
            if area.workplace_distance_km is None:
                reasons.append("workplace_distance_unavailable")
            elif area.workplace_distance_km > preferences.max_workplace_distance_km:
                reasons.append("workplace_too_far")
        if preferences.max_station_distance_km is not None:
            if area.nearest_cta_station_km is None:
                reasons.append("station_distance_unavailable")
            elif area.nearest_cta_station_km > preferences.max_station_distance_km:
                reasons.append("station_too_far")
        burden = None
        if rent is not None and preferences.annual_income is not None:
            monthly_income = preferences.annual_income / 12
            if monthly_income == 0:
                raise ValueError("annual_income is too small for a finite rent burden calculation")
            burden = rent / monthly_income * 100
            if not math.isfinite(burden):
                raise ValueError("rent burden calculation must be finite")
        item = EvaluatedArea(
            area=area, rent=rent, budget_difference=difference,
            within_budget=(rent <= preferences.monthly_budget) if rent is not None else None,
            rent_burden_pct=burden, exclusion_reasons=tuple(reasons),
        )
        if reasons:
            excluded.append(item)
            reason_counts.update(reasons)
        else:
            eligible.append(item)
    return eligible, excluded, dict(sorted(reason_counts.items()))


def _weighted_scores(candidates: list[EvaluatedArea], weights: tuple[float, float, float]) -> dict[str, float]:
    if not candidates:
        return {}
    vectors = [candidate.objectives for candidate in candidates]
    lows = tuple(min(vector[i] for vector in vectors) for i in range(3))
    highs = tuple(max(vector[i] for vector in vectors) for i in range(3))
    return {
        candidate.area.area_id: sum(
            weights[i] * ((candidate.objectives[i] - lows[i]) / (highs[i] - lows[i]) if highs[i] > lows[i] else 0.0)
            for i in range(3)
        )
        for candidate in candidates
    }


def _explanation(candidate: EvaluatedArea, preferences: Preferences, pareto_efficient: bool) -> str:
    assert candidate.rent is not None and candidate.budget_difference is not None
    relation = "below" if candidate.budget_difference >= 0 else "above"
    amount = abs(candidate.budget_difference)
    if amount == 0:
        budget_text = "exactly matches your monthly budget"
    else:
        budget_text = f"is ${amount:,.2f} {relation} your monthly budget"
    parts = [f"The HUD {BEDROOM_LABELS[preferences.bedrooms]} benchmark is ${candidate.rent:,.2f} and {budget_text}."]
    if candidate.area.nearest_cta_station_km is not None:
        parts.append(f"The ZCTA representative point is {candidate.area.nearest_cta_station_km:.2f} km straight-line from the nearest CTA rail station.")
    if candidate.area.workplace_distance_km is not None:
        parts.append(f"It is {candidate.area.workplace_distance_km:.2f} km straight-line from the Loop demo destination.")
    if pareto_efficient:
        parts.append("This area is Pareto-efficient among eligible areas with complete measurements.")
    return " ".join(parts)


def _recommendation(candidate: EvaluatedArea, preferences: Preferences, score: float, pareto_efficient: bool) -> dict[str, object]:
    area = candidate.area
    return {
        "area_id": area.area_id,
        "zip_code": area.zip_code,
        "latitude": area.latitude,
        "longitude": area.longitude,
        "bedrooms": preferences.bedrooms,
        "hud_monthly_rent": candidate.rent,
        "budget_difference": candidate.budget_difference,
        "within_budget": candidate.within_budget,
        "rent_burden_pct": candidate.rent_burden_pct,
        "workplace_distance_km": area.workplace_distance_km,
        "workplace_name": area.workplace_name,
        "nearest_cta_station_id": area.nearest_cta_station_id,
        "nearest_cta_station_name": area.nearest_cta_station_name,
        "nearest_cta_station_km": area.nearest_cta_station_km,
        "cta_stations_within_2km": area.cta_stations_within_2km,
        "pareto_efficient": pareto_efficient,
        "normalized_preference_score": score,
        "explanation": _explanation(candidate, preferences, pareto_efficient),
        "source_and_measurement_limitations": list(LIMITATIONS),
    }


def optimize_housing(
    preferences: Preferences | Mapping[str, object],
    areas: Iterable[HousingArea | Mapping[str, object]] | None = None,
) -> dict[str, object]:
    """Optimize the public core; pass controlled area records for tests."""
    profile = preferences if isinstance(preferences, Preferences) else Preferences(**preferences)
    all_areas = load_public_areas() if areas is None else validate_areas(areas)
    eligible, excluded, reason_counts = evaluate_candidates(profile, all_areas)
    complete = [candidate for candidate in eligible if candidate.complete_objectives]
    incomplete = [candidate for candidate in eligible if not candidate.complete_objectives]
    objectives = {candidate.area.area_id: candidate.objectives for candidate in complete}
    frontier, dominated_by = pareto_frontier(objectives)
    frontier_set = set(frontier)
    weights = profile.normalized_weights
    scores = _weighted_scores(complete, weights)
    ranked = sorted(
        complete,
        key=lambda candidate: (
            candidate.area.area_id not in frontier_set,
            scores[candidate.area.area_id],
            candidate.objectives,
            candidate.area.area_id,
        ),
    )
    first = all_areas[0] if all_areas else None
    result: dict[str, object] = {
        "request_context": {
            "preferences": asdict(profile),
            "data_version": {
                "dataset": "data/public/housing_transit_core.csv" if areas is None else "supplied area records",
                "hud_data_year": first.hud_data_year if first else None,
                "geography_source_year": first.geography_source_year if first else None,
                "transit_feed_date": first.transit_feed_date if first else None,
                "workplace_name": first.workplace_name if first else None,
                "source_attribution": first.source_attribution if first else None,
                "distance_definition": first.distance_definition if first else None,
            },
            "objectives": {
                "hud_monthly_rent": "Minimize selected HUD bedroom benchmark, USD/month",
                "workplace_distance_km": "Minimize straight-line distance to default Clark/Lake Loop destination, km",
                "nearest_cta_station_km": "Minimize straight-line distance to nearest CTA rail station, km",
            },
        },
        "summary": {
            "total_areas_evaluated": len(all_areas),
            "eligible_count": len(eligible),
            "excluded_count": len(excluded),
            "pareto_evaluable_count": len(complete),
            "pareto_efficient_count": len(frontier),
            "eligible_unranked_missing_objectives_count": len(incomplete),
            "exclusion_reason_counts": reason_counts,
        },
        "recommendations": [
            _recommendation(candidate, profile, scores[candidate.area.area_id], candidate.area.area_id in frontier_set)
            for candidate in ranked[:profile.max_results]
        ],
        "diagnostics": {
            "eligible_candidates": [
                {
                    "area_id": candidate.area.area_id,
                    "hud_monthly_rent": candidate.rent,
                    "workplace_distance_km": candidate.area.workplace_distance_km,
                    "nearest_cta_station_km": candidate.area.nearest_cta_station_km,
                    "pareto_efficient": candidate.area.area_id in frontier_set,
                    "normalized_preference_score": scores.get(candidate.area.area_id),
                }
                for candidate in eligible
            ],
            "excluded_areas": [
                {"area_id": candidate.area.area_id, "reasons": list(candidate.exclusion_reasons)}
                for candidate in excluded
            ],
            "pareto_frontier_area_ids": frontier,
            "dominated_by_example": dominated_by,
            "eligible_unranked_missing_objectives_area_ids": [candidate.area.area_id for candidate in incomplete],
            "ranking_method": {
                "score": "Weighted sum of min-max normalized objectives over eligible candidates with all three values; lower is preferred",
                "normalized_weights": dict(zip(OBJECTIVES, weights)),
                "zero_range_policy": "An objective with identical values for all ranked candidates contributes 0",
                "priority": "Pareto-efficient candidates first; then score, objective tuple, area_id",
                "dominated_fill": "Complete dominated candidates fill remaining recommendation slots",
                "missing_objectives": "Eligible candidates lacking either distance are reported but unranked; no values are imputed",
                "score_scope": "Relative to this eligible complete candidate set; not a universal quality score",
            },
        },
    }
    json.dumps(result, allow_nan=False)
    return result
