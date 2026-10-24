"""Measure local TestClient request latency over the real 64-area dataset."""

from __future__ import annotations

import json
import math
import statistics
import time

from fastapi.testclient import TestClient

from backend.app.main import app


REQUESTS = {
    "optimize": ("/api/optimize", {"monthly_budget": 1900, "bedrooms": 1}),
    "sensitivity": ("/api/sensitivity", {
        "preferences": {"monthly_budget": 1600, "bedrooms": 1},
        "alternative_budgets": [1500, 1700],
        "workplace_limits_km": [8],
        "station_limits_km": [2],
    }),
    "areas_compare": ("/api/areas/compare", {"area_ids": ["ZCTA:60601", "ZCTA:60608"], "bedrooms": 1}),
}


def benchmark(iterations: int = 30) -> dict[str, object]:
    output: dict[str, object] = {"method": "FastAPI TestClient, real public CSV loaded once at startup; five warmups and 30 measured POST requests per endpoint", "iterations": iterations}
    with TestClient(app) as client:
        for name, (path, payload) in REQUESTS.items():
            for _ in range(5):
                response = client.post(path, json=payload)
                response.raise_for_status()
            durations = []
            for _ in range(iterations):
                start = time.perf_counter_ns()
                response = client.post(path, json=payload)
                duration_ms = (time.perf_counter_ns() - start) / 1_000_000
                response.raise_for_status()
                durations.append(duration_ms)
            ordered = sorted(durations)
            output[name] = {
                "median_ms": statistics.median(ordered),
                "p95_ms": ordered[math.ceil(0.95 * iterations) - 1],
                "min_ms": ordered[0],
                "max_ms": ordered[-1],
            }
    return output


if __name__ == "__main__":
    print(json.dumps(benchmark(), indent=2))
