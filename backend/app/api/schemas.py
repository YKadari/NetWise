"""Strict, bounded public API request models."""

from __future__ import annotations

import math
import re

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator, model_validator


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PreferenceRequest(StrictRequest):
    monthly_budget: float = Field(gt=0, le=10_000_000, allow_inf_nan=False)
    bedrooms: StrictInt = Field(ge=0, le=4)
    annual_income: float | None = Field(default=None, gt=0, le=1_000_000_000, allow_inf_nan=False)
    budget_is_hard_constraint: StrictBool = True
    max_workplace_distance_km: float | None = Field(default=None, ge=0, le=1000, allow_inf_nan=False)
    max_station_distance_km: float | None = Field(default=None, ge=0, le=1000, allow_inf_nan=False)
    rent_weight: float = Field(default=1, ge=0, le=1000, allow_inf_nan=False)
    workplace_weight: float = Field(default=1, ge=0, le=1000, allow_inf_nan=False)
    station_weight: float = Field(default=1, ge=0, le=1000, allow_inf_nan=False)
    max_results: StrictInt = Field(default=10, ge=1, le=100)

    @field_validator(
        "monthly_budget", "annual_income", "max_workplace_distance_km", "max_station_distance_km",
        "rent_weight", "workplace_weight", "station_weight", mode="before"
    )
    @classmethod
    def numbers_must_be_json_numbers(cls, value: object) -> object:
        if value is None:
            return value
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("Expected a finite JSON number")
        return value

    @model_validator(mode="after")
    def at_least_one_weight(self) -> PreferenceRequest:
        if self.rent_weight + self.workplace_weight + self.station_weight <= 0:
            raise ValueError("At least one preference weight must be positive")
        return self


class SensitivityRequest(StrictRequest):
    preferences: PreferenceRequest
    alternative_budgets: list[float] | None = Field(default=None, max_length=8)
    workplace_limits_km: list[float] | None = Field(default=None, max_length=8)
    station_limits_km: list[float] | None = Field(default=None, max_length=8)

    @field_validator("alternative_budgets", "workplace_limits_km", "station_limits_km", mode="before")
    @classmethod
    def validate_adjustment_list(cls, value: object) -> object:
        if value is None:
            return value
        if not isinstance(value, list) or len(value) > 8:
            raise ValueError("Expected a list of at most 8 values")
        if any(isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) for item in value):
            raise ValueError("Adjustments must be finite JSON numbers")
        return value

    @field_validator("alternative_budgets")
    @classmethod
    def budget_bounds(cls, value: list[float] | None) -> list[float] | None:
        if value is not None and (any(not 0 < item <= 10_000_000 for item in value) or len(value) != len(set(value))):
            raise ValueError("Budgets must be unique and between 0 and 10,000,000")
        return value

    @field_validator("workplace_limits_km", "station_limits_km")
    @classmethod
    def distance_bounds(cls, value: list[float] | None) -> list[float] | None:
        if value is not None and (any(not 0 <= item <= 1000 for item in value) or len(value) != len(set(value))):
            raise ValueError("Distance limits must be unique and between 0 and 1,000 km")
        return value

    @model_validator(mode="after")
    def total_adjustment_limit(self) -> SensitivityRequest:
        if sum(len(values or []) for values in (self.alternative_budgets, self.workplace_limits_km, self.station_limits_km)) > 16:
            raise ValueError("At most 16 total adjustments are allowed")
        return self


class ScenarioCompareRequest(StrictRequest):
    baseline_preferences: PreferenceRequest
    modified_preferences: PreferenceRequest


class AreaCompareRequest(StrictRequest):
    area_ids: list[str] = Field(min_length=2, max_length=4)
    bedrooms: StrictInt | None = Field(default=None, ge=0, le=4)

    @field_validator("area_ids")
    @classmethod
    def valid_unique_ids(cls, value: list[str]) -> list[str]:
        if any(not isinstance(item, str) or not re.fullmatch(r"ZCTA:\d{5}", item) for item in value):
            raise ValueError("Area IDs must use ZCTA:12345 format")
        if len(set(value)) != len(value):
            raise ValueError("Area IDs must be unique")
        return value
