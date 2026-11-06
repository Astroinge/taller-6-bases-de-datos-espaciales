# taller-6-bases-de-datos-espaciales
Taller 6: bases de datos espaciales

## NYC Spatial Explorer

API de solo lectura (FastAPI + PostGIS) para las tablas de la base NYC y un cliente web con mapa para filtrarlas.

### Ejecutar

```bash
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # ajusta DATABASE_URL (el nombre de la base distingue mayúsculas: NYC)
uvicorn app.main:app --reload
```

- Cliente web: http://localhost:8000/
- Documentación interactiva de la API: http://localhost:8000/docs

### Endpoints

| Endpoint | Tabla | Geometría |
|---|---|---|
| `GET /api/v1/subway-stations` | `nyc_subway_stations` | punto |
| `GET /api/v1/homicides` | `nyc_homicides` | punto |
| `GET /api/v1/neighborhoods` | `nyc_neighborhoods` | polígono |
| `GET /api/v1/streets` | `nyc_streets` | línea |
| `GET /api/v1/census-blocks` | `nyc_census_blocks` | polígono |
| `GET /api/v1/datasets` | catálogo de tablas, columnas y filtros | |
| `GET /api/v1/<tabla>/facets` | valores distintos de las columnas categóricas | |

#### Filtros por tabla

| Tabla | Filtros |
|---|---|
| subway-stations | `name`, `borough`, `route`, `express` |
| homicides | `borough`, `date_from`, `date_to`, `year_min`, `year_max`, `weapon`, `primary_mo`, `light_dark`, `num_victim` |
| neighborhoods | `name`, `borough` |
| streets | `name`, `type`, `oneway` |
| census-blocks | `blkid_prefix`, `borough`, `popn_total_min`, `popn_total_max`, `popn_white_min`, `popn_black_min`, `popn_nativ_min`, `popn_asian_min`, `popn_other_min` |

`borough` acepta `Manhattan`, `The Bronx`, `Brooklyn`, `Staten Island`, `Queens`.

#### Parámetros comunes a todas las tablas

| Parámetro | Descripción |
|---|---|
| `lat`, `lon`, `radius_m` | Registros dentro de un radio en metros; se envían juntos y ordenan por distancia (`distance_m`) |
| `polygon` | Geometría GeoJSON (`Polygon`/`MultiPolygon`, lon/lat) en JSON; devuelve los registros que la intersectan |
| `limit`, `offset` | Paginación. Máximo de `limit`: 1000 (homicidios), 500 (estaciones, calles), 200 (barrios, bloques censales) |

Ejemplos:

```bash
curl "localhost:8000/api/v1/subway-stations?borough=Brooklyn&express=true"
curl "localhost:8000/api/v1/homicides?year_min=2005&weapon=Knife"
curl "localhost:8000/api/v1/census-blocks?popn_total_min=500&borough=Queens"
curl "localhost:8000/api/v1/streets?type=primary&oneway=true&lat=40.7580&lon=-73.9855&radius_m=500"
```

#### Formato de respuesta

```json
{
  "total": 1, "limit": 50, "offset": 0,
  "items": [{
    "properties": {"name": "Times Sq - 42 St", "borough": "Manhattan", "routes": "1,2,3,7,N,Q,R,W", "express": true},
    "geometry": {"type": "Point", "coordinates": [-73.98, 40.75]},
    "distance_m": null
  }]
}
```

Las líneas y polígonos se devuelven simplificados (unos pocos metros de tolerancia) para que la respuesta sea liviana.

### Cliente web

Pestañas por tabla, filtros generados a partir de `/api/v1/datasets`, lista de resultados sincronizada con el mapa y filtro por zona dibujando un polígono, rectángulo o círculo (la figura se mantiene al cambiar de pestaña).

### Cómo agregar o cambiar una tabla

Las tablas se declaran en `app/datasets.py` (columnas, filtros y orden). La API, `/docs` y el cliente web se generan a partir de ahí.

### Supuestos

- La columna `geom` de cada tabla tiene un SRID definido; se reproyecta a EPSG:4326 con `ST_Transform`.
- `nyc_subway_stations.routes` es una lista separada por comas (ej. `A,C,E`).
- `nyc_homicides.id` no se expone; usa `gid` como identificador.
