"""FastAPI application over the processed public Chicago housing data."""

from __future__ import annotations

from contextlib import asynccontextmanager
import json
import math
import os
from pathlib import Path
from typing import Iterable, Mapping
from urllib.parse import urlparse

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from shapely.geometry import shape

from backend.app.api.routes import router
from backend.app.api.rental_routes import router as rental_router
from backend.app.api.lease_routes import router as lease_router
from backend.app.api.stress_routes import router as stress_router
from backend.app.api.decision_brief_routes import router as decision_brief_router
from backend.app.optimization.data_loader import PUBLIC_CORE, load_public_areas, validate_areas
from backend.app.optimization.models import HousingArea


PUBLIC_DIR = PUBLIC_CORE.parent
PROJECT_ROOT = Path(__file__).resolve().parents[2]
GEO_FILES = {
    "housing": "housing_areas.geojson",
    "stations": "cta_rail_stations.geojson",
    "housing_points": "housing_points.geojson",
}


def cors_origins_from_environment() -> list[str]:
    default = "" if os.environ.get("NESTWISE_ENV", "").strip().casefold() in {"production", "prod"} else "http://localhost:5173"
    raw = os.environ.get("NESTWISE_CORS_ORIGINS", default)
    origins = [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]
    for origin in origins:
        parsed = urlparse(origin)
        if origin == "*" or parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.path or parsed.query or parsed.fragment:
            raise ValueError("NESTWISE_CORS_ORIGINS must list explicit http(s) origins")
    return origins


def _load_geojson(directory: Path) -> dict[str, dict[str, object]]:
    result = {}
    for key, filename in GEO_FILES.items():
        with (directory / filename).open("r", encoding="utf-8") as handle:
            value = json.load(handle)
        if value.get("type") != "FeatureCollection" or not isinstance(value.get("features"), list):
            raise ValueError(f"Invalid public GeoJSON: {filename}")
        seen_ids: set[str] = set()
        for feature in value["features"]:
            if not isinstance(feature, dict) or feature.get("type") != "Feature" or not isinstance(feature.get("properties"), dict):
                raise ValueError(f"Invalid public GeoJSON feature: {filename}")
            if "zillow" in json.dumps(feature).lower():
                raise ValueError(f"Public GeoJSON contains restricted fields: {filename}")
            feature_id = str(feature["properties"].get("area_id") or feature["properties"].get("station_id"))
            if feature_id in seen_ids or feature_id == "None":
                raise ValueError(f"Invalid or duplicate public GeoJSON identifier: {filename}")
            seen_ids.add(feature_id)
            try:
                geometry = shape(feature["geometry"])
                minx, miny, maxx, maxy = geometry.bounds
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError(f"Invalid public GeoJSON geometry: {filename}") from exc
            if (geometry.is_empty or not geometry.is_valid or
                    not all(map(math.isfinite, (minx, miny, maxx, maxy))) or
                    not (-180 <= minx <= maxx <= 180 and -90 <= miny <= maxy <= 90)):
                raise ValueError(f"Invalid WGS84 public GeoJSON geometry: {filename}")
        result[key] = value
    return result


class SPAStaticFiles(StaticFiles):
    """Serve built frontend assets and client routes without masking API 404s."""

    async def get_response(self, path: str, scope):
        normalized_path = path.lstrip("/")
        if normalized_path == "api" or normalized_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and not Path(normalized_path).suffix:
                return await super().get_response("index.html", scope)
            raise


def create_app(
    *,
    data_path: Path | str = PUBLIC_CORE,
    geo_dir: Path | str = PUBLIC_DIR,
    fixture_areas: Iterable[HousingArea | Mapping[str, object]] | None = None,
    cors_origins: list[str] | None = None,
    static_dir: Path | str | None = None,
) -> FastAPI:
    """Create an app that loads an immutable data snapshot during lifespan startup."""
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.areas = (
            validate_areas(fixture_areas) if fixture_areas is not None else load_public_areas(data_path)
        )
        if not application.state.areas:
            raise RuntimeError("Public housing dataset contains no areas")
        application.state.geojson = _load_geojson(Path(geo_dir))
        yield

    application = FastAPI(title="NestWise API", version="5A", lifespan=lifespan, debug=False)

    @application.exception_handler(RequestValidationError)
    async def validation_error_handler(_, exc: RequestValidationError) -> JSONResponse:
        # Pydantic may include NaN or personal income in the raw "input" field.
        # Keep validation errors useful without echoing request values.
        details = [
            {"location": list(error["loc"]), "message": error["msg"], "type": error["type"]}
            for error in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": details})

    application.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins if cors_origins is not None else cors_origins_from_environment(),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @application.middleware("http")
    async def prevent_api_spa_fallback(request, call_next):
        response = await call_next(request)
        request_path = request.url.path
        content_type = response.headers.get("content-type", "")
        if (request_path == "/api" or request_path.startswith("/api/")) and "text/html" in content_type:
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        return response

    application.include_router(router)
    application.include_router(rental_router)
    application.include_router(lease_router)
    application.include_router(stress_router)
    application.include_router(decision_brief_router)
    assets = Path(static_dir) if static_dir is not None else PROJECT_ROOT / "frontend" / "dist"
    if (assets / "index.html").is_file():
        application.mount("/", SPAStaticFiles(directory=assets, html=True), name="frontend")
    return application


app = create_app()
