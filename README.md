# taller-6-bases-de-datos-espaciales
Taller 6: bases de datos espaciales

## NYC Subway Stations API

API de solo lectura (FastAPI + PostGIS) con un único entry point de datos: la tabla `nyc_subway_stations`.

### Ejecutar

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # ajusta DATABASE_URL
uvicorn app.main:app --reload
```

Documentación interactiva: http://localhost:8000/docs

### Endpoint

`GET /api/v1/subway-stations`

| Parámetro | Descripción |
|---|---|
| `name` | Búsqueda parcial por nombre |
| `borough` | `Manhattan`, `The Bronx`, `Brooklyn`, `Staten Island`, `Queens` |
| `route` | Línea que pasa por la estación (ej. `A`, `4`) |
| `express` | `true` / `false` |
| `lat`, `lon`, `radius_m` | Estaciones dentro de un radio (m); se envían juntos y ordenan por distancia |
| `limit` (1-500, def. 50), `offset` | Paginación |

Ejemplos:

```bash
curl "localhost:8000/api/v1/subway-stations?borough=Brooklyn&express=true"
curl "localhost:8000/api/v1/subway-stations?lat=40.7580&lon=-73.9855&radius_m=500"
```

Respuesta:

```json
{
  "total": 1, "limit": 50, "offset": 0,
  "items": [{
    "name": "Times Sq - 42 St", "borough": "Manhattan", "routes": "1,2,3,7,N,Q,R,W",
    "transfers": "...", "express": true,
    "geometry": {"type": "Point", "coordinates": [-73.98, 40.75]}
  }]
}
```

### Supuestos

- La columna `geom` tiene un SRID definido; se reproyecta a EPSG:4326 con `ST_Transform`.
- `routes` es una lista separada por comas (ej. `A,C,E`).
