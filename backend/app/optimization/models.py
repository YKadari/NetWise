"""Validated preferences and immutable housing-area records."""

from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Mapping


RENT_FIELDS = (
    "hud_studio_rent", "hud_1br_rent", "hud_2br_rent", "hud_3br_rent", "hud_4br_rent"
)
BEDROOM_LABELS = ("studio", "one-bedroom", "two-bedroom", "three-bedroom", "four-bedroom")


def _finite_number(value: object, label: str, *, allow_none: bool = False, positive: bool = False) -> float | None:
    if value is None or value == "":
        if allow_none:
            return None
        raise ValueError(f"{label} is required")
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a finite number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a finite number") from exc
    if not math.isfinite(number) or number < 0 or (positive and number == 0):
        qualifier = "positive" if positive else "nonnegative"
        raise ValueError(f"{label} must be a finite {qualifier} number")
    return number


def _text(value: object) -> str | None:
    if value is None:
        return None
    result = str(value).strip()
    return result or None


@dataclass(frozen=True)
class Preferences:
    monthly_budget: float
    bedrooms: int
    annual_income: float | None = None
    budget_is_hard_constraint: bool = True
    max_workplace_distance_km: float | None = None
    max_station_distance_km: float | None = None
    rent_weight: float = 1.0
    workplace_weight: float = 1.0
    station_weight: float = 1.0
    max_results: int = 10

    def __post_init__(self) -> None:
        object.__setattr__(self, "monthly_budget", _finite_number(self.monthly_budget, "monthly_budget", positive=True))
        if isinstance(self.bedrooms, bool) or not isinstance(self.bedrooms, int) or self.bedrooms not in range(5):
            raise ValueError("bedrooms must be an integer from 0 through 4")
        object.__setattr__(self, "annual_income", _finite_number(self.annual_income, "annual_income", allow_none=True, positive=True))
        if not isinstance(self.budget_is_hard_constraint, bool):
            raise ValueError("budget_is_hard_constraint must be a boolean")
        for name in ("max_workplace_distance_km", "max_station_distance_km"):
            object.__setattr__(self, name, _finite_number(getattr(self, name), name, allow_none=True))
        for name in ("rent_weight", "workplace_weight", "station_weight"):
            object.__setattr__(self, name, _finite_number(getattr(self, name), name))
        if self.rent_weight + self.workplace_weight + self.station_weight == 0:
            raise ValueError("At least one preference weight must be positive")
        if not math.isfinite(self.rent_weight + self.workplace_weight + self.station_weight):
            raise ValueError("Sum of preference weights must be finite")
        if isinstance(self.max_results, bool) or not isinstance(self.max_results, int) or not 1 <= self.max_results <= 100:
            raise ValueError("max_results must be an integer from 1 through 100")

    @property
    def normalized_weights(self) -> tuple[float, float, float]:
        total = self.rent_weight + self.workplace_weight + self.station_weight
        if not math.isfinite(total):
            raise ValueError("Sum of preference weights must be finite")
        return (self.rent_weight / total, self.workplace_weight / total, self.station_weight / total)


@dataclass(frozen=True)
class HousingArea:
    area_id: str
    zip_code: str
    latitude: float
    longitude: float
    rents: tuple[float | None, float | None, float | None, float | None, float | None]
    workplace_distance_km: float | None
    nearest_cta_station_km: float | None
    nearest_cta_station_miles: float | None = None
    nearest_cta_station_id: str | None = None
    nearest_cta_station_name: str | None = None
    cta_stations_within_2km: int | None = None
    hud_area_id: str | None = None
    hud_area_name: str | None = None
    hud_data_year: int | None = None
    geography_source_year: int | None = None
    transit_feed_date: str | None = None
    workplace_name: str | None = None
    workplace_latitude: float | None = None
    workplace_longitude: float | None = None
    source_attribution: str | None = None
    distance_definition: str | None = None

    @classmethod
    def from_mapping(cls, row: Mapping[str, object]) -> HousingArea:
        area_id, zip_code = _text(row.get("area_id")), _text(row.get("zip_code"))
        if not area_id or not zip_code or not re.fullmatch(r"\d{5}", zip_code):
            raise ValueError("area_id and five-character zip_code are required")
        latitude = _coordinate(row.get("latitude"), "latitude", -90, 90)
        longitude = _coordinate(row.get("longitude"), "longitude", -180, 180)
        rents = tuple(_finite_number(row.get(name), name, allow_none=True) for name in RENT_FIELDS)
        nearby = row.get("cta_stations_within_2km")
        if nearby is None or nearby == "":
            nearby_count = None
        else:
            try:
                nearby_count = int(nearby)
            except (TypeError, ValueError) as exc:
                raise ValueError("cta_stations_within_2km must be a nonnegative integer") from exc
            if isinstance(nearby, bool) or nearby_count < 0 or float(nearby) != nearby_count:
                raise ValueError("cta_stations_within_2km must be a nonnegative integer")
        return cls(
            area_id=area_id, zip_code=zip_code, latitude=latitude, longitude=longitude,
            rents=rents,
            workplace_distance_km=_finite_number(row.get("workplace_distance_km"), "workplace_distance_km", allow_none=True),
            nearest_cta_station_km=_finite_number(row.get("nearest_cta_station_km"), "nearest_cta_station_km", allow_none=True),
            nearest_cta_station_miles=_finite_number(row.get("nearest_cta_station_miles"), "nearest_cta_station_miles", allow_none=True),
            nearest_cta_station_id=_text(row.get("nearest_cta_station_id")),
            nearest_cta_station_name=_text(row.get("nearest_cta_station_name")),
            cta_stations_within_2km=nearby_count,
            hud_area_id=_text(row.get("hud_area_id")), hud_area_name=_text(row.get("hud_area_name")),
            hud_data_year=_optional_year(row.get("hud_data_year"), "hud_data_year"),
            geography_source_year=_optional_year(row.get("geography_source_year"), "geography_source_year"),
            transit_feed_date=_text(row.get("transit_feed_date")),
            workplace_name=_text(row.get("workplace_name")),
            workplace_latitude=_coordinate(row["workplace_latitude"], "workplace_latitude", -90, 90) if row.get("workplace_latitude") not in (None, "") else None,
            workplace_longitude=_coordinate(row["workplace_longitude"], "workplace_longitude", -180, 180) if row.get("workplace_longitude") not in (None, "") else None,
            source_attribution=_text(row.get("source_attribution")),
            distance_definition=_text(row.get("distance_definition")),
        )


def _coordinate(value: object, label: str, minimum: int, maximum: int) -> float:
    if value is None or value == "" or isinstance(value, bool):
        raise ValueError(f"{label} must be a valid coordinate")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a valid coordinate") from exc
    if not math.isfinite(number) or not minimum <= number <= maximum:
        raise ValueError(f"{label} must be a valid coordinate")
    return number


def _optional_year(value: object, label: str) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a year")
    try:
        year = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a year") from exc
    if not 1900 <= year <= 2200 or str(year) != str(value).strip():
        raise ValueError(f"{label} must be a year")
    return year
