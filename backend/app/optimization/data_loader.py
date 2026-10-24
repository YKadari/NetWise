"""Load and validate the processed public housing/transit CSV once per run."""

from __future__ import annotations

import csv
import math
from pathlib import Path
from typing import Iterable, Mapping

from .models import HousingArea, RENT_FIELDS


ROOT = Path(__file__).resolve().parents[3]
PUBLIC_CORE = ROOT / "data" / "public" / "housing_transit_core.csv"
REQUIRED_COLUMNS = {
    "area_id", "zip_code", "latitude", "longitude", *RENT_FIELDS,
    "workplace_distance_km", "nearest_cta_station_km",
}


def validate_areas(areas: Iterable[HousingArea | Mapping[str, object]]) -> tuple[HousingArea, ...]:
    result = tuple(area if isinstance(area, HousingArea) else HousingArea.from_mapping(area) for area in areas)
    seen_ids: set[str] = set()
    seen_zips: set[str] = set()
    for area in result:
        if area.area_id in seen_ids or area.zip_code in seen_zips:
            raise ValueError(f"Duplicate area_id or zip_code: {area.area_id} / {area.zip_code}")
        seen_ids.add(area.area_id)
        seen_zips.add(area.zip_code)
        if not (-90 <= area.latitude <= 90 and -180 <= area.longitude <= 180):
            raise ValueError(f"Invalid coordinates for {area.area_id}")
        if (area.workplace_latitude is None) != (area.workplace_longitude is None):
            raise ValueError(f"Incomplete workplace coordinates for {area.area_id}")
        values = (*area.rents, area.workplace_distance_km, area.nearest_cta_station_km, area.nearest_cta_station_miles)
        if len(area.rents) != 5 or any(value is not None and (not math.isfinite(value) or value < 0) for value in values):
            raise ValueError(f"Invalid rent or distance for {area.area_id}")
    return tuple(sorted(result, key=lambda area: area.area_id))


def load_public_areas(path: Path | str = PUBLIC_CORE) -> tuple[HousingArea, ...]:
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = set(reader.fieldnames or ())
        missing = REQUIRED_COLUMNS - headers
        if missing:
            raise ValueError(f"Public core CSV is missing required columns: {sorted(missing)}")
        if any("zillow" in name.lower() for name in headers):
            raise ValueError("Optimization requires the Zillow-free public core CSV")
        areas = validate_areas(reader)
    if not areas:
        raise ValueError("Public core CSV has no housing areas")
    return areas
