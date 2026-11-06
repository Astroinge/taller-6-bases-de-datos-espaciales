"""Rutas de la API generadas a partir de app/datasets.py.

Para cada Dataset se crea `GET /api/v1/<slug>` con sus filtros declarados como parámetros
de consulta (así FastAPI los valida y los documenta en /docs) y `GET /api/v1/<slug>/facets`.
"""

import inspect
from datetime import date
from typing import Literal

from fastapi import APIRouter, Query

from ..datasets import DATASETS, Dataset, Filter
from ..query import get_facets, run_query
from ..schemas import DatasetMeta, FeaturePage, FieldMeta, FilterMeta

router = APIRouter(prefix="/api/v1")

_POLYGON_DESC = (
    "Geometría GeoJSON (Polygon o MultiPolygon, lon/lat WGS84). Devuelve los registros que la intersectan. "
    'Ej: {"type":"Polygon","coordinates":[[[-74.0,40.7],[-73.9,40.7],[-73.9,40.8],[-74.0,40.7]]]}'
)


def _filter_parameter(f: Filter) -> inspect.Parameter:
    """Convierte un Filter en un parámetro de consulta tipado para FastAPI."""
    desc = f.description or f.label
    if f.kind == "choice":
        annotation = Literal[f.choices]  # type: ignore[valid-type]
        query = Query(None, description=desc)
    elif f.kind == "int":
        annotation, query = int, Query(None, description=desc, ge=f.ge)
    elif f.kind == "float":
        annotation, query = float, Query(None, description=desc, ge=f.ge)
    elif f.kind == "date":
        annotation, query = date, Query(None, description=desc)
    elif f.kind == "bool":
        annotation, query = bool, Query(None, description=desc)
    else:  # text | facet
        annotation, query = str, Query(None, description=desc, min_length=1, max_length=100, pattern=f.pattern)
    return inspect.Parameter(f.param, inspect.Parameter.KEYWORD_ONLY, default=query, annotation=annotation | None)


def _common_parameters(ds: Dataset) -> list[inspect.Parameter]:
    kw = inspect.Parameter.KEYWORD_ONLY

    def p(name, annotation, query):
        return inspect.Parameter(name, kw, default=query, annotation=annotation)

    return [
        p("polygon", str | None, Query(None, description=_POLYGON_DESC)),
        p("lat", float | None, Query(None, ge=-90, le=90, description="Latitud para búsqueda por cercanía")),
        p("lon", float | None, Query(None, ge=-180, le=180, description="Longitud para búsqueda por cercanía")),
        p("radius_m", float | None, Query(None, gt=0, le=50_000, description="Radio en metros para búsqueda por cercanía")),
        p("limit", int, Query(50, ge=1, le=ds.max_limit, description=f"Máximo de registros (hasta {ds.max_limit})")),
        p("offset", int, Query(0, ge=0)),
    ]


def _register(ds: Dataset) -> None:
    def list_records(**kwargs):
        return run_query(ds, kwargs)

    list_records.__name__ = f"list_{ds.slug.replace('-', '_')}"
    list_records.__signature__ = inspect.Signature(  # type: ignore[attr-defined]
        [_filter_parameter(f) for f in ds.filters] + _common_parameters(ds)
    )
    router.add_api_route(
        f"/{ds.slug}",
        list_records,
        methods=["GET"],
        response_model=FeaturePage,
        summary=f"Consultar {ds.label.lower()} ({ds.table})",
        description=ds.description,
        tags=[ds.table],
    )

    def facets():
        return get_facets(ds)

    facets.__name__ = f"facets_{ds.slug.replace('-', '_')}"
    router.add_api_route(
        f"/{ds.slug}/facets",
        facets,
        methods=["GET"],
        response_model=dict[str, list[str]],
        summary=f"Valores distintos de las columnas categóricas de {ds.table}",
        tags=[ds.table],
    )


for _ds in DATASETS:
    _register(_ds)


def _meta(ds: Dataset) -> DatasetMeta:
    return DatasetMeta(
        slug=ds.slug,
        label=ds.label,
        description=ds.description,
        geometry_type=ds.geometry_type,
        endpoint=f"/api/v1/{ds.slug}",
        facets_endpoint=f"/api/v1/{ds.slug}/facets",
        max_limit=ds.max_limit,
        title_field=ds.title_field,
        card_fields=list(ds.card_fields),
        fields=[FieldMeta(key=f.key, label=f.label, type=f.type, unit=f.unit) for f in ds.fields],
        filters=[
            FilterMeta(
                param=f.param,
                label=f.label,
                kind=f.kind,
                description=f.description,
                choices=list(f.choices),
                ui=f.ui,
                advanced=f.advanced,
                toggle_labels=list(f.toggle_labels) if f.toggle_labels else None,
                min_value=f.ge,
            )
            for f in ds.filters
        ],
    )


@router.get("/datasets", response_model=list[DatasetMeta], tags=["metadata"], summary="Catálogo de tablas, columnas y filtros")
def list_datasets():
    return [_meta(ds) for ds in DATASETS]
