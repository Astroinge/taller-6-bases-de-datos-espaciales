from typing import Any, Literal

from pydantic import BaseModel

Borough = Literal["Manhattan", "The Bronx", "Brooklyn", "Staten Island", "Queens"]


class SubwayStation(BaseModel):
    name: str | None
    borough: str | None
    routes: str | None
    transfers: str | None
    express: bool
    # Punto en GeoJSON, coordenadas WGS84 [lon, lat]
    geometry: dict[str, Any]
    # Solo presente cuando se consulta por cercanía (lat/lon/radius_m)
    distance_m: float | None = None


class SubwayStationPage(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[SubwayStation]
