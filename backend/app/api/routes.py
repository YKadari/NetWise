"""Thin HTTP routes over the tested public-data services."""

from __future__ import annotations

import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from backend.app.optimization import optimize_housing
from backend.app.optimization.comparisons import area_attributes, compare_areas, compare_scenarios
from backend.app.optimization.models import HousingArea
from backend.app.optimization.sensitivity import analyze_sensitivity
from backend.app.services.maps import area_directions_url
from .schemas import AreaCompareRequest, PreferenceRequest, ScenarioCompareRequest, SensitivityRequest


router = APIRouter(prefix="/api")


def loaded_areas(request: Request) -> tuple[HousingArea, ...]:
    areas = getattr(request.app.state, "areas", None)
    if areas is None:
        raise HTTPException(status_code=503, detail="Public data is unavailable")
    return areas


AreaData = Annotated[tuple[HousingArea, ...], Depends(loaded_areas)]


@router.get("/health")
def health(areas: AreaData) -> dict[str, object]:
    first = areas[0]
    return {
        "status": "ok", "dataset_loaded": True, "housing_area_count": len(areas),
        "dataset": "housing_transit_core.csv", "hud_data_year": first.hud_data_year,
        "geography_source_year": first.geography_source_year,
        "transit_feed_date": first.transit_feed_date,
    }


@router.get("/areas")
def list_areas(
    areas: AreaData,
    bedrooms: Annotated[int | None, Query(ge=0, le=4)] = None,
    max_rent: Annotated[float | None, Query(gt=0, allow_inf_nan=False)] = None,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> dict[str, object]:
    if max_rent is not None and bedrooms is None:
        raise HTTPException(status_code=422, detail="bedrooms is required with max_rent")
    selected = [
        area for area in areas
        if max_rent is None or (area.rents[bedrooms] is not None and area.rents[bedrooms] <= max_rent)
    ]
    items = []
    for area in selected[offset:offset + limit]:
        item = area_attributes(area)
        if bedrooms is not None:
            item["selected_bedrooms"] = bedrooms
            item["selected_hud_rent"] = area.rents[bedrooms]
        items.append(item)
    return {"total": len(selected), "offset": offset, "limit": limit, "areas": items}


@router.get("/areas/{area_id}")
def get_area(
    area_id: str, areas: AreaData,
    travel_mode: Literal["transit", "walking", "driving"] = "transit",
) -> dict[str, object]:
    if not re.fullmatch(r"ZCTA:\d{5}", area_id):
        raise HTTPException(status_code=422, detail="Area ID must use ZCTA:12345 format")
    area = next((item for item in areas if item.area_id == area_id), None)
    if area is None:
        raise HTTPException(status_code=404, detail="Area not found")
    output = area_attributes(area)
    output["google_maps_directions_url"] = area_directions_url(area, travel_mode)
    output["directions_note"] = "Outbound link only; no route or travel time is verified by NestWise."
    return output


@router.post("/optimize")
def optimize(request: PreferenceRequest, areas: AreaData) -> dict[str, object]:
    try:
        return optimize_housing(request.model_dump(), areas)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sensitivity")
def sensitivity(request: SensitivityRequest, areas: AreaData) -> dict[str, object]:
    try:
        return analyze_sensitivity(
            request.preferences.model_dump(), areas,
            alternative_budgets=request.alternative_budgets,
            workplace_limits_km=request.workplace_limits_km,
            station_limits_km=request.station_limits_km,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/scenarios/compare")
def scenarios_compare(request: ScenarioCompareRequest, areas: AreaData) -> dict[str, object]:
    try:
        return compare_scenarios(
            request.baseline_preferences.model_dump(),
            request.modified_preferences.model_dump(),
            areas,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/areas/compare")
def areas_compare(request: AreaCompareRequest, areas: AreaData) -> dict[str, object]:
    try:
        result = compare_areas(request.area_ids, request.bedrooms, areas)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    for row in result["areas"]:
        area = next(area for area in areas if area.area_id == row["area_id"])
        row["google_maps_directions_url"] = area_directions_url(area)
    return result


@router.get("/geo/housing")
def housing_geo(request: Request) -> JSONResponse:
    return JSONResponse(request.app.state.geojson["housing"], media_type="application/geo+json")


@router.get("/geo/stations")
def stations_geo(request: Request) -> JSONResponse:
    return JSONResponse(request.app.state.geojson["stations"], media_type="application/geo+json")


@router.get("/geo/housing-points")
def housing_points_geo(request: Request) -> JSONResponse:
    return JSONResponse(request.app.state.geojson["housing_points"], media_type="application/geo+json")
