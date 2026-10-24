"""Strict three-objective Pareto dominance for eligible complete candidates."""

from __future__ import annotations

import math
from typing import Mapping, Sequence


OBJECTIVES = ("hud_monthly_rent", "workplace_distance_km", "nearest_cta_station_km")


def dominates(a: Sequence[float], b: Sequence[float]) -> bool:
    """Return true when a is no worse in all objectives and better in one."""
    try:
        valid = len(a) == 3 and len(b) == 3 and all(math.isfinite(value) for value in (*a, *b))
    except (TypeError, ValueError):
        valid = False
    if not valid:
        raise ValueError("Pareto comparison requires three finite objective values per candidate")
    return all(x <= y for x, y in zip(a, b)) and any(x < y for x, y in zip(a, b))


def pareto_frontier(objectives: Mapping[str, tuple[float, float, float]]) -> tuple[list[str], dict[str, str]]:
    """Return sorted frontier IDs and one deterministic dominator per dominated ID."""
    ids = sorted(objectives)
    frontier: list[str] = []
    dominated_by: dict[str, str] = {}
    for candidate_id in ids:
        dominators = [other_id for other_id in ids if other_id != candidate_id and dominates(objectives[other_id], objectives[candidate_id])]
        if dominators:
            dominated_by[candidate_id] = dominators[0]
        else:
            frontier.append(candidate_id)
    return frontier, dominated_by
