"""Build Batch 1B CTA rail accessibility and public/local housing datasets."""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import shutil
from zipfile import ZipFile

import geopandas as gpd
import pandas as pd

if __package__:
    from scripts.build_housing_data import ROOT, build as build_housing, find_input
else:
    from build_housing_data import ROOT, build as build_housing, find_input

CTA_FILE = "google_transit.zip"
PUBLIC_ATTRIBUTION = "HUD FY2027 SAFMR; U.S. Census Bureau 2020 ZCTA; CTA GTFS rail stations"
LOCAL_ATTRIBUTION = PUBLIC_ATTRIBUTION + "; Zillow Research ZORI (local use)"
DISTANCE_DEFINITION = "Straight-line Haversine distance from 2020 ZCTA representative point; not walking or travel time"
EARTH_RADIUS_KM = 6371.0088
KM_PER_MILE = 1.609344
ZILLOW_FIELDS = ("zillow_region_id", "zillow_observed_rent", "zillow_observation_date")
ADDED_FIELDS = (
    "nearest_cta_station_id", "nearest_cta_station_name", "nearest_cta_station_km",
    "nearest_cta_station_miles", "cta_stations_within_2km", "workplace_name",
    "workplace_latitude", "workplace_longitude", "workplace_distance_km",
    "transit_feed_date", "distance_definition",
)


def valid_coordinates(latitude: object, longitude: object) -> bool:
    try:
        lat, lon = float(latitude), float(longitude)
    except (TypeError, ValueError):
        return False
    return math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    if not (valid_coordinates(lat1, lon1) and valid_coordinates(lat2, lon2)):
        raise ValueError("Haversine requires valid latitude/longitude coordinates")
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def rail_trip_routes(routes: pd.DataFrame, trips: pd.DataFrame) -> dict[str, str]:
    if not {"route_id", "route_type", "route_long_name"}.issubset(routes.columns):
        raise ValueError("GTFS routes lack route_id, route_type, or route_long_name")
    if not {"trip_id", "route_id"}.issubset(trips.columns):
        raise ValueError("GTFS trips lack trip_id or route_id")
    if routes["route_id"].duplicated().any() or trips["trip_id"].duplicated().any():
        raise ValueError("Duplicate GTFS route_id or trip_id")
    rail_ids = set(routes.loc[routes["route_type"].astype(str).eq("1"), "route_id"])
    selected = trips.loc[trips["route_id"].isin(rail_ids), ["trip_id", "route_id"]]
    return dict(selected.itertuples(index=False, name=None))


def served_rail_stops(feed: ZipFile, trip_routes: dict[str, str]) -> dict[str, set[str]]:
    if "stop_times.txt" not in feed.namelist():
        raise ValueError("CTA GTFS archive lacks stop_times.txt")
    stop_routes: dict[str, set[str]] = defaultdict(set)
    with feed.open("stop_times.txt") as source:
        chunks = pd.read_csv(source, usecols=["trip_id", "stop_id"], dtype="string", chunksize=250_000)
        for chunk in chunks:
            selected = chunk.loc[chunk["trip_id"].isin(trip_routes)].drop_duplicates()
            for trip_id, stop_id in selected.itertuples(index=False, name=None):
                stop_routes[str(stop_id)].add(trip_routes[str(trip_id)])
    return stop_routes


def identify_rail_stations(
    stops: pd.DataFrame, routes: pd.DataFrame, stop_routes: dict[str, set[str]]
) -> tuple[pd.DataFrame, dict[str, object]]:
    required = {"stop_id", "stop_name", "stop_lat", "stop_lon", "location_type", "parent_station"}
    if not required.issubset(stops.columns):
        raise ValueError(f"GTFS stops lack columns: {sorted(required - set(stops.columns))}")
    if stops["stop_id"].duplicated().any():
        raise ValueError("Duplicate GTFS stop_id")
    stop_lookup = stops.set_index("stop_id")
    rail_route_names = dict(routes.loc[routes["route_type"].astype(str).eq("1"), ["route_id", "route_long_name"]].itertuples(index=False, name=None))
    station_routes: dict[str, set[str]] = defaultdict(set)
    missing_served_stops: list[str] = []
    unparented_rail_stops: list[str] = []
    invalid_parent_records: list[str] = []
    for stop_id, route_ids in sorted(stop_routes.items()):
        if stop_id not in stop_lookup.index:
            missing_served_stops.append(stop_id)
            continue
        stop = stop_lookup.loc[stop_id]
        parent = stop.get("parent_station")
        if pd.isna(parent) or not str(parent).strip():
            # A boarding point without an explicit parent is ambiguous: do not
            # invent a station or count a platform independently.
            unparented_rail_stops.append(stop_id)
            continue
        parent = str(parent).strip()
        if parent not in stop_lookup.index or str(stop_lookup.loc[parent, "location_type"]) != "1":
            invalid_parent_records.append(stop_id)
            continue
        station_routes[parent].update(route_ids)

    records = []
    invalid_station_ids = []
    for station_id in sorted(station_routes):
        parent = stop_lookup.loc[station_id]
        latitude, longitude = parent["stop_lat"], parent["stop_lon"]
        if not valid_coordinates(latitude, longitude) or pd.isna(parent["stop_name"]):
            invalid_station_ids.append(station_id)
            continue
        route_names = sorted(rail_route_names[route_id] for route_id in station_routes[station_id])
        records.append({
            "station_id": station_id,
            "station_name": str(parent["stop_name"]).strip(),
            "latitude": float(latitude),
            "longitude": float(longitude),
            "rail_routes": "|".join(route_names),
            "source_attribution": "Chicago Transit Authority GTFS",
        })
    station_frame = pd.DataFrame.from_records(records, columns=[
        "station_id", "station_name", "latitude", "longitude", "rail_routes", "source_attribution"
    ])
    if station_frame.empty or station_frame["station_id"].duplicated().any():
        raise ValueError("No unique valid CTA rail parent stations were found")
    diagnostics = {
        "stop_records_inspected": int(len(stops)),
        "rail_boarding_stop_ids_served": int(len(stop_routes)),
        "parent_station_records": int(stops["location_type"].astype(str).eq("1").sum()),
        "rail_stations_identified": int(len(station_frame)),
        "rail_served_stop_ids_missing_from_stops": missing_served_stops,
        "rail_served_stop_ids_without_parent": unparented_rail_stops,
        "rail_served_stop_ids_with_invalid_parent": invalid_parent_records,
        "invalid_rail_parent_station_ids": invalid_station_ids,
        "duplicate_station_ids": int(station_frame["station_id"].duplicated().sum()),
    }
    return station_frame, diagnostics


def read_cta_stations(path: Path) -> tuple[pd.DataFrame, dict[str, object]]:
    with ZipFile(path) as feed:
        for member in ("stops.txt", "routes.txt", "trips.txt", "stop_times.txt"):
            if member not in feed.namelist():
                raise ValueError(f"CTA GTFS archive lacks {member}")
        stops = pd.read_csv(feed.open("stops.txt"), dtype="string", low_memory=False)
        routes = pd.read_csv(feed.open("routes.txt"), dtype="string", low_memory=False)
        trips = pd.read_csv(feed.open("trips.txt"), dtype="string", low_memory=False)
        trip_routes = rail_trip_routes(routes, trips)
        stop_routes = served_rail_stops(feed, trip_routes)
        stations, diagnostics = identify_rail_stations(stops, routes, stop_routes)
        diagnostics["route_type_counts"] = {str(k): int(v) for k, v in routes["route_type"].value_counts().items()}
        diagnostics["rail_route_ids"] = sorted(routes.loc[routes["route_type"].eq("1"), "route_id"].tolist())
        diagnostics["rail_trip_records"] = len(trip_routes)
        diagnostics["feed_info_present"] = "feed_info.txt" in feed.namelist()
        if "calendar.txt" in feed.namelist():
            calendar = pd.read_csv(feed.open("calendar.txt"), dtype="string")
            diagnostics["service_window_start"] = str(calendar["start_date"].min())
            diagnostics["service_window_end"] = str(calendar["end_date"].max())
    return stations, diagnostics


def loop_workplace(stations: pd.DataFrame) -> tuple[str, float, float]:
    matches = stations[stations["station_name"].str.contains("Clark/Lake", case=False, regex=False)]
    if len(matches) != 1:
        raise ValueError(f"Expected one CTA Clark/Lake Loop station; found {len(matches)}")
    station = matches.iloc[0]
    return "Chicago Loop demo destination (Clark/Lake station)", float(station["latitude"]), float(station["longitude"])


def make_datasets(housing: pd.DataFrame, stations: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    if housing["area_id"].duplicated().any() or housing["zip_code"].duplicated().any():
        raise ValueError("Duplicate housing area identifiers")
    if stations["station_id"].duplicated().any():
        raise ValueError("Duplicate CTA station identifiers")
    workplace_name, workplace_lat, workplace_lon = loop_workplace(stations)
    public = housing.drop(columns=list(ZILLOW_FIELDS), errors="ignore").copy()
    stations_sorted = stations.sort_values("station_id", kind="stable")
    nearest_ids, nearest_names, nearest_km, nearby_counts, workplace_km = [], [], [], [], []
    for row in public.itertuples(index=False):
        if not valid_coordinates(row.latitude, row.longitude):
            raise ValueError(f"Invalid housing representative point: {row.area_id}")
        distances = [
            (haversine_km(float(row.latitude), float(row.longitude), float(s.latitude), float(s.longitude)), str(s.station_id), str(s.station_name))
            for s in stations_sorted.itertuples(index=False)
        ]
        distance, station_id, station_name = min(distances, key=lambda item: (item[0], item[1]))
        nearest_ids.append(station_id)
        nearest_names.append(station_name)
        nearest_km.append(distance)
        nearby_counts.append(sum(km <= 2.0 for km, _, _ in distances))
        workplace_km.append(haversine_km(float(row.latitude), float(row.longitude), workplace_lat, workplace_lon))
    public["nearest_cta_station_id"] = nearest_ids
    public["nearest_cta_station_name"] = nearest_names
    public["nearest_cta_station_km"] = nearest_km
    public["nearest_cta_station_miles"] = [km / KM_PER_MILE for km in nearest_km]
    public["cta_stations_within_2km"] = nearby_counts
    public["workplace_name"] = workplace_name
    public["workplace_latitude"] = workplace_lat
    public["workplace_longitude"] = workplace_lon
    public["workplace_distance_km"] = workplace_km
    public["transit_feed_date"] = None  # No feed_info.txt in this CTA archive.
    public["distance_definition"] = DISTANCE_DEFINITION
    public["source_attribution"] = PUBLIC_ATTRIBUTION
    public = public.sort_values("zip_code", kind="stable").reset_index(drop=True)
    enriched = public.merge(housing[["area_id", *ZILLOW_FIELDS]], on="area_id", how="left", validate="one_to_one")
    enriched["source_attribution"] = LOCAL_ATTRIBUTION
    return public, enriched


def write_point_geojson(frame: pd.DataFrame, id_field: str, destination: Path) -> None:
    features = []
    for row in frame.to_dict(orient="records"):
        properties = {key: (None if pd.isna(value) else value) for key, value in row.items() if key not in ("latitude", "longitude")}
        features.append({
            "type": "Feature", "id": str(row[id_field]),
            "properties": properties,
            "geometry": {"type": "Point", "coordinates": [float(row["longitude"]), float(row["latitude"])]},
        })
    destination.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def _stats(series: pd.Series) -> dict[str, float]:
    return {"min": float(series.min()), "median": float(series.median()), "max": float(series.max())}


def build(public_dir: Path | None = None, local_dir: Path | None = None) -> dict[str, object]:
    local_dir = local_dir or ROOT / "data" / "processed"
    public_dir = public_dir or ROOT / "data" / "public"
    public_dir.mkdir(parents=True, exist_ok=True)
    local_dir.mkdir(parents=True, exist_ok=True)
    build_housing(output_dir=local_dir)
    housing = pd.read_csv(local_dir / "housing_areas.csv", dtype={"area_id": "string", "zip_code": "string", "hud_area_id": "string", "zillow_region_id": "string"})
    polygons = gpd.read_file(local_dir / "housing_areas.geojson")
    if polygons.crs is None or polygons.crs.to_epsg() != 4326 or not polygons.geometry.is_valid.all():
        raise ValueError("Batch 1A polygons must be valid WGS84 geometry")
    if set(housing["area_id"]) != set(polygons["area_id"]) or len(housing) != len(polygons):
        raise ValueError("Batch 1A housing and polygon identifiers do not match")
    stations, diagnostics = read_cta_stations(find_input(CTA_FILE))
    public, enriched = make_datasets(housing, stations)
    if any("zillow" in column.lower() for column in public.columns):
        raise ValueError("Public core contains a Zillow-derived field")
    if len(public) != len(housing) or set(public["area_id"]) != set(housing["area_id"]):
        raise ValueError("Housing records were lost during CTA integration")

    public.to_csv(public_dir / "housing_transit_core.csv", index=False, na_rep="")
    enriched.to_csv(local_dir / "housing_transit_enriched.csv", index=False, na_rep="")
    stations.to_csv(public_dir / "cta_rail_stations.csv", index=False)
    shutil.copyfile(local_dir / "housing_areas.geojson", public_dir / "housing_areas.geojson")
    write_point_geojson(public, "area_id", public_dir / "housing_points.geojson")
    write_point_geojson(stations, "station_id", public_dir / "cta_rail_stations.geojson")

    geographic_outliers = public.loc[public["nearest_cta_station_km"] > 10, ["area_id", "nearest_cta_station_km"]]
    summary: dict[str, object] = {
        **diagnostics,
        "housing_area_records": int(len(public)),
        "valid_nearest_station_calculations": int(public["nearest_cta_station_km"].notna().sum()),
        "nearest_station_km": _stats(public["nearest_cta_station_km"]),
        "workplace_distance_km": _stats(public["workplace_distance_km"]),
        "areas_over_10km_from_nearest_station": geographic_outliers.to_dict(orient="records"),
        "duplicate_area_ids": int(public["area_id"].duplicated().sum()),
        "public_zillow_fields": [name for name in public.columns if "zillow" in name.lower()],
        "workplace_name": str(public.loc[0, "workplace_name"]),
        "workplace_latitude": float(public.loc[0, "workplace_latitude"]),
        "workplace_longitude": float(public.loc[0, "workplace_longitude"]),
        "transit_feed_date": None,
        "output_bytes": {path.name: path.stat().st_size for path in sorted(public_dir.iterdir()) if path.is_file() and path.name != "batch_1b_summary.json"},
        "local_enriched_bytes": (local_dir / "housing_transit_enriched.csv").stat().st_size,
        "sample_core_records": public.head(3).to_dict(orient="records"),
    }
    (public_dir / "batch_1b_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    summary["output_bytes"]["batch_1b_summary.json"] = (public_dir / "batch_1b_summary.json").stat().st_size
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-dir", type=Path, default=ROOT / "data" / "public")
    parser.add_argument("--local-dir", type=Path, default=ROOT / "data" / "processed")
    args = parser.parse_args()
    print(json.dumps(build(args.public_dir, args.local_dir), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
