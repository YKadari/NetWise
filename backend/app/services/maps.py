"""Build outbound Google Maps directions links without making an API call."""

from __future__ import annotations

import math
from urllib.parse import urlencode

from backend.app.optimization.models import HousingArea


SUPPORTED_MODES = {"transit", "walking", "driving"}


def directions_url(
    origin_latitude: float, origin_longitude: float,
    destination_latitude: float, destination_longitude: float,
    travel_mode: str = "transit",
) -> str:
    if travel_mode not in SUPPORTED_MODES:
        raise ValueError("travel_mode must be transit, walking, or driving")
    values = (origin_latitude, origin_longitude, destination_latitude, destination_longitude)
    if any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) for value in values):
        raise ValueError("Directions coordinates must be finite numbers")
    if not (-90 <= origin_latitude <= 90 and -180 <= origin_longitude <= 180 and
            -90 <= destination_latitude <= 90 and -180 <= destination_longitude <= 180):
        raise ValueError("Directions coordinates are outside WGS84 ranges")
    query = urlencode({
        "api": "1",
        "origin": f"{origin_latitude:.6f},{origin_longitude:.6f}",
        "destination": f"{destination_latitude:.6f},{destination_longitude:.6f}",
        "travelmode": travel_mode,
    })
    return f"https://www.google.com/maps/dir/?{query}"


def area_directions_url(area: HousingArea, travel_mode: str = "transit") -> str | None:
    if area.workplace_latitude is None or area.workplace_longitude is None:
        return None
    return directions_url(
        area.latitude, area.longitude,
        area.workplace_latitude, area.workplace_longitude,
        travel_mode,
    )
