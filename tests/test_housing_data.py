import pandas as pd
import pytest
import geopandas as gpd
from shapely.geometry import box

from scripts.build_housing_data import HUD_RENTS, latest_zori, match_hud_zctas, normalize_zip, prepare_hud, validate_records


def test_zip_codes_retain_leading_zeroes():
    assert normalize_zip(601) == "00601"
    assert normalize_zip("06001") == "06001"


def test_hud_numeric_positive_and_missing_values():
    source = {
        "ZIP\nCode": ["60601", "60602"],
        "HUD Area Code": ["M1", "M1"],
        "HUD Fair Market Rent Area Name": ["Chicago, IL HUD Area"] * 2,
    }
    for col in HUD_RENTS.values():
        source[col] = [1000, None]
    selected, _ = prepare_hud(pd.DataFrame(source))
    for col in HUD_RENTS:
        assert selected[col].dtype.kind in "if"
        assert selected[col].iloc[0] > 0
        assert pd.isna(selected[col].iloc[1])


def test_zillow_missing_does_not_replace_hud_values():
    zori, _ = latest_zori(pd.DataFrame({
        "RegionID": [1], "RegionName": ["06001"], "RegionType": ["zip"],
        "StateName": ["IL"], "City": ["X"], "Metro": ["Y"], "CountyName": ["Z"],
        "2026-09-30": [None],
    }))
    assert pd.isna(zori.loc[0, "zillow_observed_rent"])
    assert 1000 != zori.loc[0, "zillow_observed_rent"]


def test_zillow_duplicate_zip_is_rejected():
    rows = {"RegionID": [1, 2], "RegionName": ["06001", "06001"], "RegionType": ["zip", "zip"],
            "StateName": ["IL"] * 2, "City": ["X"] * 2, "Metro": ["Y"] * 2, "CountyName": ["Z"] * 2,
            "2026-09-30": [1000, 1100]}
    with pytest.raises(ValueError, match="Duplicate Zillow ZIP"):
        latest_zori(pd.DataFrame(rows))


def test_invalid_coordinate_and_duplicate_area_id_are_rejected():
    row = {"area_id": "ZCTA:06001", "zip_code": "06001", "latitude": 95, "longitude": -87}
    row.update({col: 1000 for col in HUD_RENTS})
    with pytest.raises(ValueError, match="Duplicate area_id|coordinates"):
        validate_records(pd.DataFrame([row, row]))


def test_hud_zcta_join_excludes_unmatched_zip_without_inventing_geometry():
    zctas = gpd.GeoDataFrame(
        {"ZCTA5CE20": ["60601"], "geometry": [box(-88, 41, -87, 42)]},
        geometry="geometry", crs="EPSG:4269",
    )
    matched, unmatched = match_hud_zctas({"60601", "60602"}, zctas)
    assert matched["zip_code"].tolist() == ["60601"]
    assert unmatched == ["60602"]
    assert matched.geometry.iloc[0].equals(zctas.geometry.iloc[0])

