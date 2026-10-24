import json

import pandas as pd
import pytest

from scripts.build_final_data import (
    haversine_km, identify_rail_stations, make_datasets, rail_trip_routes,
    valid_coordinates, write_point_geojson,
)


def synthetic_feed():
    routes = pd.DataFrame({
        "route_id": ["Red", "Blue", "Bus"],
        "route_type": ["1", "1", "3"],
        "route_long_name": ["Red Line", "Blue Line", "Bus Route"],
    })
    trips = pd.DataFrame({"trip_id": ["T1", "T2", "T3"], "route_id": ["Red", "Blue", "Bus"]})
    stops = pd.DataFrame({
        "stop_id": ["A", "A1", "A2", "B", "B1", "C", "C1"],
        "stop_name": ["Clark/Lake", "Platform 1", "Platform 2", "Other", "Platform 3", "Bad", "Platform 4"],
        "stop_lat": [0, 0, 0, 0, 0, "bad", 0],
        "stop_lon": [-1, -1, -1, 1, 1, 2, 2],
        "location_type": ["1", "0", "0", "1", "0", "1", "0"],
        "parent_station": [pd.NA, "A", "A", pd.NA, "B", pd.NA, "C"],
    })
    return routes, trips, stops


def test_rail_trip_selection_uses_route_type():
    routes, trips, _ = synthetic_feed()
    assert rail_trip_routes(routes, trips) == {"T1": "Red", "T2": "Blue"}


def test_rail_station_identification_deduplicates_platforms_and_checks_coordinates():
    routes, _, stops = synthetic_feed()
    stations, diagnostics = identify_rail_stations(
        stops, routes, {"A1": {"Red"}, "A2": {"Red", "Blue"}, "B1": {"Blue"}, "C1": {"Red"}}
    )
    assert stations.station_id.tolist() == ["A", "B"]
    assert stations.loc[0, "rail_routes"] == "Blue Line|Red Line"
    assert diagnostics["invalid_rail_parent_station_ids"] == ["C"]
    assert diagnostics["rail_stations_identified"] == 2


def test_haversine_known_reference_and_invalid_coordinates():
    assert haversine_km(0, 0, 0, 1) == pytest.approx(111.195, abs=0.002)
    assert haversine_km(41.885737, -87.630886, 41.885737, -87.630886) == 0
    assert not valid_coordinates("bad", -87)
    assert not valid_coordinates(91, -87)
    with pytest.raises(ValueError, match="valid"):
        haversine_km(91, 0, 0, 0)


def test_equal_distance_station_selection_preserves_housing_and_excludes_zillow():
    routes, _, stops = synthetic_feed()
    stations, _ = identify_rail_stations(stops, routes, {"A1": {"Red"}, "B1": {"Blue"}})
    housing = pd.DataFrame({
        "area_id": ["ZCTA:60601"], "zip_code": ["60601"], "latitude": [0.0], "longitude": [0.0],
        "hud_studio_rent": [1000], "hud_1br_rent": [1200], "hud_area_id": ["HUD"],
        "zillow_region_id": [42], "zillow_observed_rent": [1300.0], "zillow_observation_date": ["2026-09-30"],
    })
    public, enriched = make_datasets(housing, stations)
    assert len(public) == len(enriched) == len(housing) == 1
    assert public.loc[0, "nearest_cta_station_id"] == "A"
    assert public.loc[0, "cta_stations_within_2km"] == 0
    assert public.loc[0, "hud_studio_rent"] == 1000
    assert public.loc[0, "workplace_distance_km"] == pytest.approx(111.195, abs=0.002)
    assert not any("zillow" in column for column in public.columns)
    assert enriched.loc[0, "zillow_observed_rent"] == 1300
    assert not any("commute" in column or "walking" in column for column in public.columns)


def test_housing_malformed_coordinates_are_rejected():
    routes, _, stops = synthetic_feed()
    stations, _ = identify_rail_stations(stops, routes, {"A1": {"Red"}})
    housing = pd.DataFrame({"area_id": ["ZCTA:60601"], "zip_code": ["60601"], "latitude": [None], "longitude": [-87]})
    with pytest.raises(ValueError, match="Invalid housing"):
        make_datasets(housing, stations)


def test_point_geojson_is_wgs84_and_reproducible(tmp_path):
    points = pd.DataFrame({"station_id": ["A"], "station_name": ["Clark/Lake"], "latitude": [41.885737], "longitude": [-87.630886]})
    first, second = tmp_path / "first.geojson", tmp_path / "second.geojson"
    write_point_geojson(points, "station_id", first)
    write_point_geojson(points, "station_id", second)
    assert first.read_bytes() == second.read_bytes()
    feature = json.loads(first.read_text(encoding="utf-8"))["features"][0]
    assert feature["geometry"] == {"type": "Point", "coordinates": [-87.630886, 41.885737]}
    assert feature["properties"]["station_name"] == "Clark/Lake"
