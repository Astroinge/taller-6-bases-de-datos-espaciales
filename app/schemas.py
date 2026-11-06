from typing import Any

from pydantic import BaseModel


class Feature(BaseModel):
    """Un registro de cualquier tabla: columnas en `properties` y geometría GeoJSON (lon/lat WGS84)."""

    properties: dict[str, Any]
    geometry: dict[str, Any] | None
    # Solo presente cuando se consulta por cercanía (lat/lon/radius_m)
    distance_m: float | None = None


class FeaturePage(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[Feature]


class FieldMeta(BaseModel):
    key: str
    label: str
    type: str
    unit: str


class FilterMeta(BaseModel):
    param: str
    label: str
    kind: str
    description: str
    choices: list[str]
    ui: str | None
    advanced: bool
    toggle_labels: list[str] | None
    min_value: float | None


class DatasetMeta(BaseModel):
    slug: str
    label: str
    description: str
    geometry_type: str
    endpoint: str
    facets_endpoint: str
    max_limit: int
    title_field: str
    card_fields: list[str]
    fields: list[FieldMeta]
    filters: list[FilterMeta]
