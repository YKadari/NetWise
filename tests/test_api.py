import json
from urllib.parse import parse_qs, urlparse

from fastapi.testclient import TestClient
import pytest

from backend.app.main import PUBLIC_DIR, app, create_app
from backend.app.services.maps import directions_url
from tests.test_sensitivity import AREAS


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_real_startup_health_and_docs(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["housing_area_count"] == 64
    assert response.json()["dataset_loaded"] is True
    assert response.json()["hud_data_year"] == 2027
    assert client.get("/docs").status_code == 200


def test_controlled_fixture_startup_without_changing_public_csv():
    with TestClient(create_app(fixture_areas=AREAS, geo_dir=PUBLIC_DIR)) as fixture_client:
        assert fixture_client.get("/api/health").json()["housing_area_count"] == 5


def test_built_frontend_serves_assets_and_client_routes_without_masking_api(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><html>NestWise UI</html>", encoding="utf-8")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log('ui')", encoding="utf-8")
    application = create_app(fixture_areas=AREAS, geo_dir=PUBLIC_DIR, static_dir=tmp_path)
    with TestClient(application) as static_client:
        assert "NestWise UI" in static_client.get("/").text
        assert "NestWise UI" in static_client.get("/analyze/review").text
        asset = static_client.get("/assets/app.js")
        assert asset.status_code == 200 and "javascript" in asset.headers["content-type"]
        assert static_client.get("/assets/missing.js").status_code == 404
        api_404 = static_client.get("/api/not-a-route")
        assert api_404.status_code == 404, api_404.text
        assert api_404.json() == {"detail": "Not Found"}


def test_missing_or_corrupt_public_data_fail_startup(tmp_path):
    with pytest.raises(FileNotFoundError):
        with TestClient(create_app(data_path=tmp_path / "absent.csv", geo_dir=PUBLIC_DIR)):
            pass
    corrupt = tmp_path / "corrupt.csv"
    corrupt.write_text("area_id,zip_code\nZCTA:00001,00001\n", encoding="utf-8")
    with pytest.raises(ValueError, match="missing required columns"):
        with TestClient(create_app(data_path=corrupt, geo_dir=PUBLIC_DIR)):
            pass
    with pytest.raises(FileNotFoundError):
        with TestClient(create_app(geo_dir=tmp_path)):
            pass
    (tmp_path / "housing_areas.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": [{
            "type": "Feature", "properties": {"area_id": "ZCTA:00001"},
            "geometry": {"type": "Point", "coordinates": [200, 41]},
        }]}), encoding="utf-8",
    )
    with pytest.raises(ValueError, match="WGS84"):
        with TestClient(create_app(geo_dir=tmp_path)):
            pass


def test_real_optimize_response_and_input_validation(client):
    response = client.post("/api/optimize", json={"monthly_budget": 1900, "bedrooms": 1})
    assert response.status_code == 200
    assert response.json()["summary"]["eligible_count"] == 38
    assert response.json()["recommendations"][0]["area_id"] == "ZCTA:60653"
    for payload in (
        {"monthly_budget": -1, "bedrooms": 1},
        {"monthly_budget": 1900, "bedrooms": 5},
        {"monthly_budget": "1900", "bedrooms": 1},
        {"monthly_budget": 1900, "bedrooms": 1, "unsupported": True},
        {"monthly_budget": 1900, "bedrooms": 1, "max_results": 101},
    ):
        assert client.post("/api/optimize", json=payload).status_code == 422
    for nonfinite in ("NaN", "Infinity", "-Infinity"):
        response = client.post(
            "/api/optimize", content=f'{{"monthly_budget":{nonfinite},"bedrooms":1}}',
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422


def test_housing_listing_pagination_and_rent_filter(client):
    first = client.get("/api/areas", params={"offset": 0, "limit": 2}).json()
    second = client.get("/api/areas", params={"offset": 2, "limit": 2}).json()
    assert first["total"] == 64 and len(first["areas"]) == 2
    assert not {item["area_id"] for item in first["areas"]} & {item["area_id"] for item in second["areas"]}
    filtered = client.get("/api/areas", params={"bedrooms": 1, "max_rent": 1600, "limit": 100})
    assert filtered.status_code == 200
    assert filtered.json()["total"] == 24
    assert all(item["selected_hud_rent"] <= 1600 for item in filtered.json()["areas"])
    assert client.get("/api/areas", params={"max_rent": 1600}).status_code == 422
    assert client.get("/api/areas", params={"limit": 101}).status_code == 422


def test_colon_area_id_unknown_id_and_directions_modes(client):
    detail = client.get("/api/areas/ZCTA:60601")
    assert detail.status_code == 200
    assert detail.json()["hud_1br_rent"] == 2670
    assert "travelmode=transit" in detail.json()["google_maps_directions_url"]
    assert "travelmode=walking" in client.get("/api/areas/ZCTA:60601?travel_mode=walking").json()["google_maps_directions_url"]
    assert client.get("/api/areas/ZCTA:60601?travel_mode=boat").status_code == 422
    assert client.get("/api/areas/ZCTA:99999").status_code == 404
    assert client.get("/api/areas/60601").status_code == 422


def test_real_sensitivity_increase_decrease_and_next_unlock(client):
    response = client.post("/api/sensitivity", json={
        "preferences": {"monthly_budget": 1600, "bedrooms": 1},
        "alternative_budgets": [1500, 1700],
    })
    assert response.status_code == 200
    data = response.json()
    assert data["baseline"]["eligible_count"] == 24
    assert [row["eligible_count"] for row in data["budget_variations"]] == [16, 30]
    assert data["next_budget_unlock"]["monthly_budget"] == 1620
    assert data["next_budget_unlock"]["newly_unlocked_area_ids"] == ["ZCTA:60638"]


def test_api_sensitivity_respects_other_constraints_and_soft_budget():
    with TestClient(create_app(fixture_areas=AREAS)) as fixture_client:
        payload = {
            "preferences": {"monthly_budget": 1100, "bedrooms": 1, "max_workplace_distance_km": 8, "max_station_distance_km": 2},
            "alternative_budgets": [1000, 1300],
        }
        result = fixture_client.post("/api/sensitivity", json=payload).json()
        assert result["next_budget_unlock"]["monthly_budget"] == 1300
        assert result["budget_variations"][1]["newly_eligible_area_ids"] == ["ZCTA:00003"]
        soft = fixture_client.post("/api/sensitivity", json={
            **payload,
            "preferences": {**payload["preferences"], "budget_is_hard_constraint": False},
        }).json()
        assert soft["next_budget_unlock"] is None
        assert soft["budget_variations"][0]["eligible_count"] == soft["budget_variations"][1]["eligible_count"]
        invalid = fixture_client.post("/api/sensitivity", json={**payload, "alternative_budgets": list(range(1, 10))})
        assert invalid.status_code == 422


def test_scenario_comparison_hard_constraints_weights_and_zero_viable(client):
    baseline = {"monthly_budget": 1600, "bedrooms": 1}
    higher = {"monthly_budget": 1900, "bedrooms": 1}
    changed = client.post("/api/scenarios/compare", json={"baseline_preferences": baseline, "modified_preferences": higher})
    assert changed.status_code == 200
    assert changed.json()["eligible_count_change"] == 14
    weights = client.post("/api/scenarios/compare", json={
        "baseline_preferences": baseline,
        "modified_preferences": {**baseline, "rent_weight": 0.1, "workplace_weight": 0.8, "station_weight": 0.1},
    }).json()
    assert weights["eligible_count_change"] == weights["pareto_count_change"] == 0
    assert weights["entered_pareto_area_ids"] == weights["left_pareto_area_ids"] == []
    zero = client.post("/api/scenarios/compare", json={
        "baseline_preferences": {"monthly_budget": 500, "bedrooms": 1},
        "modified_preferences": {"monthly_budget": 600, "bedrooms": 1},
    }).json()
    assert zero["baseline"]["eligible_count"] == zero["modified"]["eligible_count"] == 0


def test_area_comparison_validation_and_no_fallback(client):
    payload = {"area_ids": ["ZCTA:60601", "ZCTA:60608"], "bedrooms": 1}
    response = client.post("/api/areas/compare", json=payload)
    assert response.status_code == 200
    assert [item["selected_hud_rent"] for item in response.json()["areas"]] == [2670, 1530]
    assert response.json()["pairwise_differences"][0]["selected_hud_rent_difference_left_minus_right"] == 1140
    assert response.json()["areas"][0]["google_maps_directions_url"].startswith("https://www.google.com/maps/dir/")
    assert client.post("/api/areas/compare", json={"area_ids": ["ZCTA:60601", "ZCTA:60601"]}).status_code == 422
    assert client.post("/api/areas/compare", json={"area_ids": ["ZCTA:60601", "ZCTA:99999"]}).status_code == 404
    assert client.post("/api/areas/compare", json={"area_ids": ["60601", "ZCTA:60608"]}).status_code == 422


def test_all_geojson_endpoints_are_valid_public_wgs84_data(client):
    for path, expected in (("housing", 64), ("stations", 143), ("housing-points", 64)):
        response = client.get(f"/api/geo/{path}")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/geo+json")
        assert response.json()["type"] == "FeatureCollection"
        assert len(response.json()["features"]) == expected
        assert "zillow" not in response.text.lower()


def test_cors_is_explicit_and_configurable(client, monkeypatch):
    preflight = client.options("/api/health", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET",
    })
    assert preflight.headers.get("access-control-allow-origin") == "http://localhost:5173"
    other = client.options("/api/health", headers={
        "Origin": "https://unrelated.example", "Access-Control-Request-Method": "GET",
    })
    assert other.headers.get("access-control-allow-origin") is None
    monkeypatch.setenv("NESTWISE_CORS_ORIGINS", "https://nestwise.example")
    with TestClient(create_app()) as configured:
        response = configured.options("/api/health", headers={
            "Origin": "https://nestwise.example", "Access-Control-Request-Method": "GET",
        })
        assert response.headers.get("access-control-allow-origin") == "https://nestwise.example"
    monkeypatch.setenv("NESTWISE_CORS_ORIGINS", "*")
    with pytest.raises(ValueError, match="explicit"):
        create_app()


def test_google_maps_url_encodes_coordinates_and_rejects_bad_modes():
    url = directions_url(41.1234567, -87.7654321, 41.885737, -87.630886)
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    assert parsed.scheme == "https" and parsed.netloc == "www.google.com"
    assert query == {
        "api": ["1"], "origin": ["41.123457,-87.765432"],
        "destination": ["41.885737,-87.630886"], "travelmode": ["transit"],
    }
    assert "%2C" in url
    with pytest.raises(ValueError, match="travel_mode"):
        directions_url(41, -87, 42, -87, "flying")


def test_public_responses_have_no_zillow_values_and_are_deterministic_strict_json(client):
    requests = [
        ("get", "/api/health", None),
        ("get", "/api/areas/ZCTA:60601", None),
        ("post", "/api/optimize", {"monthly_budget": 1900, "bedrooms": 1}),
        ("post", "/api/sensitivity", {"preferences": {"monthly_budget": 1600, "bedrooms": 1}, "alternative_budgets": [1700]}),
        ("post", "/api/areas/compare", {"area_ids": ["ZCTA:60601", "ZCTA:60608"]}),
    ]
    for method, path, body in requests:
        call = lambda: getattr(client, method)(path, json=body) if body is not None else getattr(client, method)(path)
        first, second = call(), call()
        assert first.status_code == second.status_code == 200
        assert first.json() == second.json()
        assert "zillow" not in first.text.lower()
        json.dumps(first.json(), allow_nan=False)
