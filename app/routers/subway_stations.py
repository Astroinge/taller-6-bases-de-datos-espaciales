import json
import math

from fastapi import APIRouter, HTTPException, Query

from ..db import pool
from ..schemas import Borough, SubwayStationPage

router = APIRouter(prefix="/api/v1/subway-stations", tags=["nyc_subway_stations"])

# La geometría de la tabla se transforma a WGS84 (EPSG:4326) para devolver lon/lat.
_POINT_4326 = "ST_Transform(geom, 4326)"

_MAX_POLYGON_CHARS = 100_000


def _valid_position(pos) -> bool:
    return (
        isinstance(pos, list)
        and len(pos) >= 2
        and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in pos[:2])
        and -180 <= pos[0] <= 180
        and -90 <= pos[1] <= 90
    )


def _valid_polygon_coords(rings) -> bool:
    if not isinstance(rings, list) or not rings:
        return False
    for ring in rings:
        if not isinstance(ring, list) or len(ring) < 4:
            return False
        if not all(_valid_position(p) for p in ring):
            return False
        if ring[0][:2] != ring[-1][:2]:  # el anillo debe estar cerrado
            return False
    return True


def _parse_polygon(raw: str) -> str:
    """Valida un Polygon/MultiPolygon GeoJSON (lon/lat) y lo devuelve como JSON normalizado."""
    if len(raw) > _MAX_POLYGON_CHARS:
        raise HTTPException(422, "polygon es demasiado grande")
    try:
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(422, "polygon no es un JSON válido")

    if isinstance(data, dict) and data.get("type") == "Feature":
        data = data.get("geometry")
    if not isinstance(data, dict):
        raise HTTPException(422, "polygon debe ser una geometría GeoJSON")

    gtype, coords = data.get("type"), data.get("coordinates")
    if gtype == "Polygon":
        ok = _valid_polygon_coords(coords)
    elif gtype == "MultiPolygon":
        ok = isinstance(coords, list) and bool(coords) and all(_valid_polygon_coords(p) for p in coords)
    else:
        raise HTTPException(422, "polygon debe ser de tipo Polygon o MultiPolygon")
    if not ok:
        raise HTTPException(422, "polygon tiene coordenadas inválidas (lon/lat, anillos cerrados de 4+ puntos)")

    # Se reconstruye solo con type + coordinates para descartar cualquier otro campo.
    return json.dumps({"type": gtype, "coordinates": coords})


@router.get(
    "",
    response_model=SubwayStationPage,
    summary="Consultar estaciones de metro (nyc_subway_stations)",
)
def list_subway_stations(
    name: str | None = Query(None, min_length=1, description="Búsqueda parcial por nombre (sin distinguir mayúsculas)"),
    borough: Borough | None = Query(None, description="Distrito de NYC"),
    route: str | None = Query(None, min_length=1, max_length=5, description="Línea que pasa por la estación, ej. A, 4, N"),
    express: bool | None = Query(None, description="true = solo estaciones con parada express; false = sin express"),
    lat: float | None = Query(None, ge=-90, le=90, description="Latitud para búsqueda por cercanía"),
    lon: float | None = Query(None, ge=-180, le=180, description="Longitud para búsqueda por cercanía"),
    radius_m: float | None = Query(None, gt=0, le=50_000, description="Radio en metros para búsqueda por cercanía"),
    polygon: str | None = Query(
        None,
        description='Geometría GeoJSON (Polygon o MultiPolygon, lon/lat WGS84). Devuelve las estaciones dentro de ella. '
        'Ej: {"type":"Polygon","coordinates":[[[-74.0,40.7],[-73.9,40.7],[-73.9,40.8],[-74.0,40.7]]]}',
    ),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> SubwayStationPage:
    nearby = (lat, lon, radius_m)
    if any(v is not None for v in nearby) and not all(v is not None for v in nearby):
        raise HTTPException(422, "lat, lon y radius_m deben enviarse juntos")

    where: list[str] = []
    params: dict = {"limit": limit, "offset": offset}

    if name is not None:
        where.append("name ILIKE %(name)s")
        params["name"] = f"%{name}%"
    if borough is not None:
        where.append("borough = %(borough)s")
        params["borough"] = borough
    if route is not None:
        # routes es una lista separada por comas, ej. "A,C,E"
        where.append("string_to_array(routes, ',') @> ARRAY[%(route)s]")
        params["route"] = route.upper()
    if express is True:
        where.append("express = 'express'")
    elif express is False:
        where.append("COALESCE(express, '') <> 'express'")

    if polygon is not None:
        params["polygon"] = _parse_polygon(polygon)
        where.append(
            f"ST_Intersects({_POINT_4326}, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%(polygon)s), 4326)))"
        )

    distance_select = ""
    order_by = "name, borough"
    if lat is not None:
        point = "ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography"
        params.update(lat=lat, lon=lon, radius_m=radius_m)
        where.append(f"ST_DWithin({_POINT_4326}::geography, {point}, %(radius_m)s)")
        distance_select = f", ST_Distance({_POINT_4326}::geography, {point}) AS distance_m"
        order_by = "distance_m, name"

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    count_sql = f"SELECT count(*) AS total FROM nyc_subway_stations {where_sql}"
    items_sql = f"""
        SELECT name, borough, routes, transfers,
               COALESCE(express = 'express', false) AS express,
               ST_AsGeoJSON({_POINT_4326})::json AS geometry
               {distance_select}
        FROM nyc_subway_stations
        {where_sql}
        ORDER BY {order_by}
        LIMIT %(limit)s OFFSET %(offset)s
    """

    with pool.connection() as conn:
        total = conn.execute(count_sql, params).fetchone()["total"]
        items = conn.execute(items_sql, params).fetchall()

    return SubwayStationPage(total=total, limit=limit, offset=offset, items=items)
