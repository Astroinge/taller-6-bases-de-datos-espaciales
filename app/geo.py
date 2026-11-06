import json
import math

from fastapi import HTTPException

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


def parse_polygon(raw: str) -> str:
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
