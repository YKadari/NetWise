"""Build the Batch 1A Chicago HUD/ZCTA/Zillow housing dataset."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
HUD_FILE = "FY27_safmrs.xlsx"
ZCTA_FILE = "cb_2020_us_zcta520_500k.zip"
ZORI_FILE = "Zip_zori_uc_sfrcondomfr_sm_month.csv"
HUD_RENTS = {
    "hud_studio_rent": "SAFMR\n0BR",
    "hud_1br_rent": "SAFMR\n1BR",
    "hud_2br_rent": "SAFMR\n2BR",
    "hud_3br_rent": "SAFMR\n3BR",
    "hud_4br_rent": "SAFMR\n4BR",
}
SCHEMA = [
    "area_id", "zip_code", "latitude", "longitude",
    *HUD_RENTS.keys(), "hud_area_id", "hud_area_name",
    "zillow_region_id", "zillow_observed_rent", "zillow_observation_date",
    "hud_data_year", "geography_source_year", "source_attribution",
]
ATTRIBUTION = "HUD FY2027 SAFMR; U.S. Census Bureau 2020 ZCTA; Zillow Research ZORI (local use)"


def find_input(name: str, input_dir: Path | None = None) -> Path:
    candidates = ([input_dir / name] if input_dir else []) + [ROOT / "data" / "raw" / name, ROOT / name]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(f"Could not find {name}; checked: {', '.join(map(str, candidates))}")


def normalize_zip(value: object) -> str | None:
    if pd.isna(value):
        return None
    raw = str(value).strip()
    if raw.endswith(".0"):
        raw = raw[:-2]
    if raw.isdigit() and len(raw) <= 5:
        return raw.zfill(5)
    return None


def prepare_hud(hud: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    zip_col = "ZIP\nCode"
    required = [zip_col, "HUD Area Code", "HUD Fair Market Rent Area Name", *HUD_RENTS.values()]
    missing = [column for column in required if column not in hud.columns]
    if missing:
        raise ValueError(f"HUD workbook is missing expected columns: {missing}")
    result = hud.copy()
    result["zip_code"] = result[zip_col].map(normalize_zip)
    result = result[result["zip_code"].notna()].copy()
    # HUD area names identify the metropolitan grouping; requiring an Illinois
    # label prevents ZIP-prefix-only selection from defining the scope.
    area_name = result["HUD Fair Market Rent Area Name"].astype("string")
    metro_mask = area_name.str.contains("Chicago", case=False, na=False) & area_name.str.contains(r"\bIL\b", case=False, na=False)
    metro = result.loc[metro_mask].copy()
    if metro.empty:
        raise ValueError("No HUD metropolitan area name containing both Chicago and IL was found")
    # The initial release focuses on Chicago's 606xx, 607xx, and 608xx ZIP
    # groups. Prefixes define the city-area slice only after HUD identifies the
    # records as belonging to its Chicago, IL metropolitan area.
    chicago = metro[metro["zip_code"].str.startswith(("606", "607", "608"))].copy()
    if chicago.empty:
        raise ValueError("No Chicago HUD records matched the documented 606xx/607xx/608xx ZIP groups")
    chicago["hud_area_id"] = chicago["HUD Area Code"].astype("string").str.strip()
    chicago["hud_area_name"] = chicago["HUD Fair Market Rent Area Name"].astype("string").str.strip()
    chicago["hud_data_year"] = 2027
    for output, source in HUD_RENTS.items():
        chicago[output] = pd.to_numeric(chicago[source], errors="coerce")
    ids = sorted(chicago["hud_area_id"].dropna().unique().tolist())
    return chicago, ids


def latest_zori(zori: pd.DataFrame) -> tuple[pd.DataFrame, str]:
    required = {"RegionID", "RegionName", "RegionType", "StateName", "City", "Metro", "CountyName"}
    missing = sorted(required - set(zori.columns))
    if missing:
        raise ValueError(f"Zillow file is missing expected columns: {missing}")
    month_columns = sorted(column for column in zori.columns if _is_date_column(column))
    if not month_columns:
        raise ValueError("Zillow file contains no monthly observation columns")
    date_col = month_columns[-1]
    z = zori[zori["RegionType"].astype("string").str.lower().eq("zip")].copy()
    z["zip_code"] = z["RegionName"].map(normalize_zip)
    z["zillow_observed_rent"] = pd.to_numeric(z[date_col], errors="coerce")
    z = z[z["zip_code"].notna()].copy()
    if z["zip_code"].duplicated().any():
        duplicates = sorted(z.loc[z["zip_code"].duplicated(keep=False), "zip_code"].unique())
        raise ValueError(f"Duplicate Zillow ZIP identifiers: {duplicates}")
    return z[["zip_code", "RegionID", "zillow_observed_rent"]].rename(columns={"RegionID": "zillow_region_id"}), date_col


def match_hud_zctas(hud_zips: set[str], zcta: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, list[str]]:
    """Return only source ZCTAs that match HUD ZIPs and list unmatched HUD IDs."""
    if "ZCTA5CE20" not in zcta.columns:
        raise ValueError("Census ZCTA source lacks ZCTA5CE20 identifier")
    normalized = zcta.copy()
    normalized["zip_code"] = normalized["ZCTA5CE20"].map(normalize_zip)
    if normalized["zip_code"].duplicated().any():
        raise ValueError("Duplicate Census ZCTA identifiers")
    matched_zips = hud_zips & set(normalized["zip_code"].dropna())
    unmatched_zips = sorted(hud_zips - matched_zips)
    return normalized[normalized["zip_code"].isin(matched_zips)].copy(), unmatched_zips


def _is_date_column(value: str) -> bool:
    try:
        pd.Timestamp(value)
        return len(value) == 10 and value[4] == "-"
    except (TypeError, ValueError):
        return False


def validate_records(frame: pd.DataFrame) -> None:
    if frame["area_id"].duplicated().any():
        raise ValueError("Duplicate area_id values")
    if frame["zip_code"].astype("string").str.fullmatch(r"\d{5}").ne(True).any():
        raise ValueError("Invalid five-character ZIP identifier")
    for field in HUD_RENTS:
        values = frame[field].dropna()
        if not pd.api.types.is_numeric_dtype(values) or (values <= 0).any():
            raise ValueError(f"HUD values in {field} must be positive numeric values when present")
    if frame[["latitude", "longitude"]].isna().any().any():
        raise ValueError("Missing representative point coordinates")
    if not frame["latitude"].between(-90, 90).all() or not frame["longitude"].between(-180, 180).all():
        raise ValueError("Invalid WGS84 coordinates")


def build(input_dir: Path | None = None, output_dir: Path | None = None) -> dict[str, object]:
    output_dir = output_dir or ROOT / "data" / "processed"
    output_dir.mkdir(parents=True, exist_ok=True)
    hud_path, zcta_path, zori_path = (find_input(name, input_dir) for name in (HUD_FILE, ZCTA_FILE, ZORI_FILE))

    hud_raw = pd.read_excel(hud_path, sheet_name="SAFMRs", dtype={"ZIP\nCode": "string"})
    hud, hud_ids = prepare_hud(hud_raw)
    if hud["zip_code"].duplicated().any():
        dupes = sorted(hud.loc[hud["zip_code"].duplicated(keep=False), "zip_code"].unique())
        raise ValueError(f"Duplicate HUD ZIP identifiers within selected area: {dupes}")
    for field in HUD_RENTS:
        if (hud[field].dropna() < 0).any():
            raise ValueError(f"Negative HUD rent in {field}")

    zcta = gpd.read_file(zcta_path)
    if zcta.crs is None:
        raise ValueError("Census ZCTA source lacks a CRS")
    selected, unmatched_zips = match_hud_zctas(set(hud["zip_code"]), zcta)
    if selected.empty:
        raise ValueError("No selected HUD ZIP codes matched Census ZCTAs")
    invalid_geom = sorted(selected.loc[~selected.geometry.is_valid | selected.geometry.is_empty, "zip_code"].tolist())
    if invalid_geom:
        raise ValueError(f"Invalid/empty ZCTA geometry for {invalid_geom}")

    # Illinois/Chicago is in UTM zone 16N. Points and simplification use meters.
    projected = selected.to_crs("EPSG:26916")
    points = projected.geometry.representative_point()
    projected["longitude"] = points.to_crs("EPSG:4326").x
    projected["latitude"] = points.to_crs("EPSG:4326").y
    projected["area_id"] = projected["zip_code"].map(lambda z: f"ZCTA:{z}")
    projected["geometry"] = projected.geometry.simplify(100, preserve_topology=True)
    map_data = projected.to_crs("EPSG:4326")[["area_id", "zip_code", "geometry"]]

    zori_raw = pd.read_csv(zori_path, dtype={"RegionName": "string"}, low_memory=False)
    zori, zori_date = latest_zori(zori_raw)
    combined = hud[["zip_code", "hud_area_id", "hud_area_name", "hud_data_year", *HUD_RENTS]].merge(
        selected[["zip_code"]], on="zip_code", how="inner", validate="one_to_one"
    ).merge(zori, on="zip_code", how="left", validate="one_to_one")
    combined["area_id"] = combined["zip_code"].map(lambda z: f"ZCTA:{z}")
    combined = combined.merge(projected[["zip_code", "latitude", "longitude"]], on="zip_code", how="left", validate="one_to_one")
    combined["zillow_observation_date"] = zori_date
    combined["geography_source_year"] = 2020
    combined["source_attribution"] = ATTRIBUTION
    combined = combined[SCHEMA].sort_values("zip_code", kind="stable").reset_index(drop=True)
    validate_records(combined)

    # Zillow has not been cleared for redistribution. Outputs remain local by default.
    combined.to_csv(output_dir / "housing_areas.csv", index=False, na_rep="")
    map_data.to_file(output_dir / "housing_areas.geojson", driver="GeoJSON")
    summary = make_summary(hud_raw, hud, combined, unmatched_zips, zcta.crs, hud_ids, output_dir)
    (output_dir / "batch_1a_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def make_summary(hud_raw: pd.DataFrame, hud: pd.DataFrame, frame: pd.DataFrame, unmatched: list[str], crs: object, hud_ids: list[str], output_dir: Path) -> dict[str, object]:
    matched_zips = set(frame["zip_code"])
    summary: dict[str, object] = {
        "hud_source_records_national": int(len(hud_raw)),
        "hud_chicago_records": int(len(hud)),
        "hud_area_ids": hud_ids,
        "matched_census_zctas": int(len(frame)),
        "unmatched_hud_zip_codes": unmatched,
        "complete_hud_rental_records": int(frame[list(HUD_RENTS)].notna().all(axis=1).sum()),
        "zillow_overlap_count": int(frame["zillow_region_id"].notna().sum()),
        "recent_zillow_values_count": int(frame["zillow_observed_rent"].notna().sum()),
        "source_zcta_crs": str(crs),
        "missing_by_field": {k: int(v) for k, v in frame.isna().sum().to_dict().items()},
        "duplicate_area_ids": int(frame["area_id"].duplicated().sum()),
        "duplicate_zips": int(frame["zip_code"].duplicated().sum()),
        "rent_statistics": {
            field: {"min": float(frame[field].min()), "median": float(frame[field].median()), "max": float(frame[field].max())}
            for field in HUD_RENTS if frame[field].notna().any()
        },
        "processed_records": int(len(frame)),
        "csv_bytes": (output_dir / "housing_areas.csv").stat().st_size,
        "geojson_bytes": (output_dir / "housing_areas.geojson").stat().st_size,
        "sample_records": frame.head(3).to_dict(orient="records"),
    }
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, help="Directory containing the three Batch 1A source files")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data" / "processed")
    args = parser.parse_args()
    print(json.dumps(build(args.input_dir, args.output_dir), indent=2))


if __name__ == "__main__":
    main()
