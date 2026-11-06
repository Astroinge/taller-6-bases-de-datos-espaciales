"""Motor de consultas genérico: construye y ejecuta el SQL de un Dataset."""

import math

from fastapi import HTTPException

from .datasets import Dataset
from .db import pool
from .geo import parse_polygon
from .schemas import Feature, FeaturePage

_srid_cache: dict[str, int] = {}


def get_srid(ds: Dataset) -> int:
    """SRID de la columna de geometría, leído una vez de la propia tabla."""
    cached = _srid_cache.get(ds.slug)
    if cached:
        return cached
    sql = f"SELECT ST_SRID({ds.geom_column}) AS srid FROM {ds.table} WHERE {ds.geom_column} IS NOT NULL LIMIT 1"
    with pool.connection() as conn:
        row = conn.execute(sql).fetchone()
    srid = int(row["srid"]) if row and row["srid"] else 0
    if srid <= 0:
        raise HTTPException(500, f"No se pudo determinar el SRID de {ds.table}.{ds.geom_column}")
    _srid_cache[ds.slug] = srid
    return srid


def _geometry_expr(ds: Dataset) -> str:
    g = f"ST_Transform({ds.geom_column}, 4326)"
    if ds.geometry_type == "point" or ds.simplify is None:
        return f"ST_AsGeoJSON({g}, 6)::json"
    return f"ST_AsGeoJSON(ST_SimplifyPreserveTopology({g}, {float(ds.simplify)}), 5)::json"


def run_query(ds: Dataset, values: dict) -> FeaturePage:
    """Ejecuta la consulta de `ds`. `values` trae los filtros y los parámetros comunes."""
    polygon = values.get("polygon")
    lat, lon, radius_m = values.get("lat"), values.get("lon"), values.get("radius_m")
    limit, offset = values["limit"], values["offset"]

    nearby = (lat, lon, radius_m)
    if any(v is not None for v in nearby) and not all(v is not None for v in nearby):
        raise HTTPException(422, "lat, lon y radius_m deben enviarse juntos")

    where: list[str] = []
    params: dict = {"limit": limit, "offset": offset}

    for f in ds.filters:
        v = values.get(f.param)
        if v is None:
            continue
        where.append(f.sql)
        params[f.param] = f.value_fn(v) if f.value_fn else v

    geom = ds.geom_column
    needs_srid = polygon is not None or lat is not None
    srid = get_srid(ds) if needs_srid else 0

    if polygon is not None:
        params["polygon"] = parse_polygon(polygon)
        where.append(
            f"ST_Intersects({geom}, "
            f"ST_Transform(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%(polygon)s), 4326)), {srid}))"
        )

    distance_select = ""
    order_by = ds.order_by
    if lat is not None:
        # Caja envolvente aproximada (usa el índice espacial) + distancia exacta en metros.
        dlat = radius_m / 110_540
        dlon = radius_m / (111_320 * max(math.cos(math.radians(lat)), 0.01))
        params.update(
            lat=lat,
            lon=lon,
            radius_m=radius_m,
            west=max(lon - dlon, -180),
            east=min(lon + dlon, 180),
            south=max(lat - dlat, -90),
            north=min(lat + dlat, 90),
        )
        point = "ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography"
        geog = f"ST_Transform({geom}, 4326)::geography"
        where.append(
            f"{geom} && ST_Transform(ST_MakeEnvelope(%(west)s, %(south)s, %(east)s, %(north)s, 4326), {srid})"
        )
        where.append(f"ST_DWithin({geog}, {point}, %(radius_m)s)")
        distance_select = f", ST_Distance({geog}, {point}) AS _distance_m"
        order_by = f"_distance_m, {ds.order_by}"

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    fields_sql = ", ".join(f'{f.sql} AS "{f.key}"' for f in ds.fields)

    count_sql = f"SELECT count(*) AS total FROM {ds.table} {where_sql}"
    items_sql = f"""
        SELECT {fields_sql}, {_geometry_expr(ds)} AS _geometry{distance_select}
        FROM {ds.table}
        {where_sql}
        ORDER BY {order_by}
        LIMIT %(limit)s OFFSET %(offset)s
    """

    with pool.connection() as conn:
        total = conn.execute(count_sql, params).fetchone()["total"]
        rows = conn.execute(items_sql, params).fetchall()

    items = [
        Feature(
            properties={f.key: row[f.key] for f in ds.fields},
            geometry=row["_geometry"],
            distance_m=row.get("_distance_m"),
        )
        for row in rows
    ]
    return FeaturePage(total=total, limit=limit, offset=offset, items=items)


def get_facets(ds: Dataset) -> dict[str, list[str]]:
    """Valores distintos de las columnas categóricas (para llenar listas desplegables)."""
    result: dict[str, list[str]] = {}
    with pool.connection() as conn:
        for f in ds.filters:
            if f.kind != "facet":
                continue
            col = f'"{f.facet_column}"'
            rows = conn.execute(
                f"SELECT DISTINCT {col} AS v FROM {ds.table} WHERE {col} IS NOT NULL ORDER BY 1 LIMIT 200"
            ).fetchall()
            result[f.param] = [str(r["v"]) for r in rows]
    return result
