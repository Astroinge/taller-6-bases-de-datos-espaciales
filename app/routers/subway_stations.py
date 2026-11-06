from fastapi import APIRouter, HTTPException, Query

from ..db import pool
from ..schemas import Borough, SubwayStationPage

router = APIRouter(prefix="/api/v1/subway-stations", tags=["nyc_subway_stations"])

# La geometría de la tabla se transforma a WGS84 (EPSG:4326) para devolver lon/lat.
_POINT_4326 = "ST_Transform(geom, 4326)"


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
