"""Constraint sensitivity with exact HUD-rent unlock thresholds."""

from __future__ import annotations

from dataclasses import asdict, replace
import math
from typing import Iterable, Mapping

from .data_loader import load_public_areas, validate_areas
from .engine import evaluate_candidates, optimize_housing
from .models import HousingArea, Preferences


def _validated_values(values: list[float] | None, label: str, *, positive: bool, maximum: float) -> list[float] | None:
    if values is None:
        return None
    if len(values) > 8:
        raise ValueError(f"{label} may contain at most 8 values")
    result = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > maximum or (positive and value == 0):
            raise ValueError(f"{label} values must be finite {'positive' if positive else 'nonnegative'} numbers at most {maximum:g}")
        result.append(float(value))
    if len(set(result)) != len(result):
        raise ValueError(f"{label} values must be unique")
    return result


def _snapshot(result: dict[str, object]) -> dict[str, object]:
    summary = result["summary"]
    return {
        "eligible_count": summary["eligible_count"],
        "excluded_count": summary["excluded_count"],
        "pareto_efficient_count": summary["pareto_efficient_count"],
        "eligible_area_ids": [item["area_id"] for item in result["diagnostics"]["eligible_candidates"]],
        "pareto_frontier_area_ids": result["diagnostics"]["pareto_frontier_area_ids"],
    }


def _change(baseline: dict[str, object], modified: dict[str, object], value: float) -> dict[str, object]:
    before, after = _snapshot(baseline), _snapshot(modified)
    prior_ids, current_ids = set(before["eligible_area_ids"]), set(after["eligible_area_ids"])
    prior_frontier, current_frontier = set(before["pareto_frontier_area_ids"]), set(after["pareto_frontier_area_ids"])
    return {
        "value": value,
        "eligible_count": after["eligible_count"],
        "excluded_count": after["excluded_count"],
        "pareto_efficient_count": after["pareto_efficient_count"],
        "eligible_count_change": after["eligible_count"] - before["eligible_count"],
        "pareto_count_change": after["pareto_efficient_count"] - before["pareto_efficient_count"],
        "newly_eligible_area_ids": sorted(current_ids - prior_ids),
        "no_longer_eligible_area_ids": sorted(prior_ids - current_ids),
        "entered_pareto_area_ids": sorted(current_frontier - prior_frontier),
        "left_pareto_area_ids": sorted(prior_frontier - current_frontier),
    }


def _next_budget_unlock(profile: Preferences, records: tuple[HousingArea, ...]) -> dict[str, object] | None:
    if not profile.budget_is_hard_constraint:
        return None
    # Disable only the budget gate. Every other hard constraint remains active.
    eligible_without_budget_gate, _, _ = evaluate_candidates(replace(profile, budget_is_hard_constraint=False), records)
    unlockable = [item for item in eligible_without_budget_gate if item.rent is not None and item.rent > profile.monthly_budget]
    if not unlockable:
        return None
    next_budget = min(item.rent for item in unlockable)
    return {
        "monthly_budget": next_budget,
        "increase_required": next_budget - profile.monthly_budget,
        "newly_unlocked_area_ids": sorted(item.area.area_id for item in unlockable if item.rent == next_budget),
    }


def analyze_sensitivity(
    preferences: Preferences | Mapping[str, object],
    areas: Iterable[HousingArea | Mapping[str, object]] | None = None,
    *,
    alternative_budgets: list[float] | None = None,
    workplace_limits_km: list[float] | None = None,
    station_limits_km: list[float] | None = None,
) -> dict[str, object]:
    """Re-run the existing optimizer over bounded counterfactual constraints."""
    profile = preferences if isinstance(preferences, Preferences) else Preferences(**preferences)
    records = load_public_areas() if areas is None else validate_areas(areas)
    budgets = _validated_values(alternative_budgets, "alternative_budgets", positive=True, maximum=10_000_000)
    workplace_limits = _validated_values(workplace_limits_km, "workplace_limits_km", positive=False, maximum=1000) or []
    station_limits = _validated_values(station_limits_km, "station_limits_km", positive=False, maximum=1000) or []
    if budgets is None:
        budgets = sorted({float(profile.monthly_budget + offset) for offset in (-200, -100, 100, 200) if 0 < profile.monthly_budget + offset <= 10_000_000})
    if len(budgets) + len(workplace_limits) + len(station_limits) > 16:
        raise ValueError("At most 16 total sensitivity adjustments are allowed")
    baseline_result = optimize_housing(profile, records)
    budget_changes = [
        _change(baseline_result, optimize_housing(replace(profile, monthly_budget=value), records), value)
        for value in budgets
    ]
    workplace_changes = [
        _change(baseline_result, optimize_housing(replace(profile, max_workplace_distance_km=value), records), value)
        for value in workplace_limits
    ]
    station_changes = [
        _change(baseline_result, optimize_housing(replace(profile, max_station_distance_km=value), records), value)
        for value in station_limits
    ]
    next_unlock = _next_budget_unlock(profile, records)
    return {
        "preferences": asdict(profile),
        "baseline": _snapshot(baseline_result),
        "budget_variations": budget_changes,
        "workplace_limit_variations": workplace_changes,
        "station_limit_variations": station_changes,
        "next_budget_unlock": next_unlock,
        "next_budget_unlock_explanation": (
            "The budget is soft, so changing it does not change rent-based eligibility."
            if not profile.budget_is_hard_constraint else
            "No higher HUD rent can unlock another area while the other active hard constraints remain satisfied."
            if next_unlock is None else
            f"Increase the monthly budget by ${next_unlock['increase_required']:,.2f} to ${next_unlock['monthly_budget']:,.2f} to unlock the next area."
        ),
        "method": "Exact reruns on the same public area snapshot; all other hard constraints remain active",
    }
