"""Definición declarativa de las tablas expuestas por la API.

Cada Dataset describe una tabla de la base NYC: qué columnas se devuelven, qué filtros
acepta y cómo se ordena. La API, la documentación (/docs) y el cliente web se generan
a partir de estas definiciones.

Seguridad: todo el SQL de este archivo es estático (escrito aquí). Los valores que envía
el usuario siempre viajan como parámetros (%(nombre)s), nunca dentro del texto SQL.
"""

from dataclasses import dataclass
from typing import Callable, Literal

GeometryType = Literal["point", "line", "polygon"]

BOROUGHS = ("Manhattan", "The Bronx", "Brooklyn", "Staten Island", "Queens")


def _contains(value: str) -> str:
    """Patrón ILIKE '%valor%' escapando los comodines que escriba el usuario."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _prefix(value: str) -> str:
    return f"{value}%"


@dataclass(frozen=True)
class Field:
    """Columna de salida (propiedad de cada registro)."""

    key: str
    label: str
    sql: str  # expresión SELECT
    type: str = "text"  # text | int | float | bool | date
    unit: str = ""


@dataclass(frozen=True)
class Filter:
    """Parámetro de consulta que se traduce en una condición WHERE."""

    param: str
    label: str
    kind: str  # text | choice | facet | int | float | date | bool
    sql: str  # condición con %(param)s
    description: str = ""
    choices: tuple[str, ...] = ()  # solo kind="choice"
    facet_column: str | None = None  # solo kind="facet": columna de la que salen los valores
    value_fn: Callable[[str], str] | None = None
    pattern: str | None = None
    ge: float | None = None
    ui: str | None = None  # pista para el cliente, ej. "lines"
    advanced: bool = False
    toggle_labels: tuple[str, str] | None = None  # solo kind="bool": (si, no)


@dataclass(frozen=True)
class Dataset:
    slug: str
    table: str
    label: str
    description: str
    geometry_type: GeometryType
    fields: tuple[Field, ...]
    filters: tuple[Filter, ...]
    order_by: str
    title_field: str
    card_fields: tuple[str, ...]
    max_limit: int
    simplify: float | None = None  # tolerancia en grados para líneas/polígonos
    geom_column: str = "geom"


def _borough(column: str) -> Filter:
    return Filter(
        param="borough",
        label="Distrito",
        kind="choice",
        choices=BOROUGHS,
        sql=f"{column} ILIKE %(borough)s",
        description="Distrito de NYC",
    )


def _name_filter(label: str = "Nombre") -> Filter:
    return Filter(
        param="name",
        label=label,
        kind="text",
        sql="name ILIKE %(name)s",
        value_fn=_contains,
        description="Búsqueda parcial por nombre (sin distinguir mayúsculas)",
    )


SUBWAY_STATIONS = Dataset(
    slug="subway-stations",
    table="nyc_subway_stations",
    label="Estaciones de metro",
    description="Estaciones del metro (nyc_subway_stations).",
    geometry_type="point",
    fields=(
        Field("name", "Nombre", "name"),
        Field("borough", "Distrito", "borough"),
        Field("routes", "Líneas", "routes"),
        Field("transfers", "Transbordos", "transfers"),
        Field("express", "Express", "COALESCE(express = 'express', false)", type="bool"),
    ),
    filters=(
        _name_filter("Nombre de la estación"),
        _borough("borough"),
        Filter(
            param="route",
            label="Línea",
            kind="text",
            sql="string_to_array(routes, ',') @> ARRAY[%(route)s]",
            value_fn=str.upper,
            pattern=r"^[A-Za-z0-9]{1,3}$",
            ui="lines",
            description="Línea que pasa por la estación, ej. A, 4, N",
        ),
        Filter(
            param="express",
            label="Servicio express",
            kind="bool",
            sql="COALESCE(express = 'express', false) = %(express)s",
            toggle_labels=("Express", "Local"),
            description="true = parada express; false = sin express",
        ),
    ),
    order_by="name NULLS LAST, borough, ctid",
    title_field="name",
    card_fields=("borough",),
    max_limit=500,
)

HOMICIDES = Dataset(
    slug="homicides",
    table="nyc_homicides",
    label="Homicidios",
    description="Homicidios registrados (nyc_homicides).",
    geometry_type="point",
    fields=(
        Field("gid", "ID", "gid", type="raw"),
        Field("incident_d", "Fecha", "incident_d", type="date"),
        Field("boroname", "Distrito", "boroname"),
        Field("num_victim", "Víctimas", "num_victim"),
        Field("primary_mo", "Modalidad", "primary_mo"),
        Field("weapon", "Arma", "weapon"),
        Field("light_dark", "Luz / oscuridad", "light_dark"),
        Field("year", "Año", '"year"::int', type="raw"),
    ),
    filters=(
        _borough("boroname"),
        Filter("date_from", "Desde", "date", "incident_d >= %(date_from)s", description="Fecha mínima del incidente (YYYY-MM-DD)"),
        Filter("date_to", "Hasta", "date", "incident_d <= %(date_to)s", description="Fecha máxima del incidente (YYYY-MM-DD)"),
        Filter("year_min", "Año desde", "int", '"year" >= %(year_min)s', ge=0),
        Filter("year_max", "Año hasta", "int", '"year" <= %(year_max)s', ge=0),
        Filter("weapon", "Arma", "facet", "weapon = %(weapon)s", facet_column="weapon"),
        Filter("primary_mo", "Modalidad", "facet", "primary_mo = %(primary_mo)s", facet_column="primary_mo"),
        Filter("light_dark", "Luz / oscuridad", "facet", "light_dark = %(light_dark)s", facet_column="light_dark"),
        Filter("num_victim", "Número de víctimas", "facet", "num_victim = %(num_victim)s", facet_column="num_victim"),
    ),
    order_by="incident_d DESC NULLS LAST, gid",
    title_field="incident_d",
    card_fields=("boroname", "primary_mo", "weapon", "light_dark", "num_victim"),
    max_limit=1000,
)

NEIGHBORHOODS = Dataset(
    slug="neighborhoods",
    table="nyc_neighborhoods",
    label="Barrios",
    description="Límites de barrios (nyc_neighborhoods).",
    geometry_type="polygon",
    fields=(
        Field("name", "Nombre", "name"),
        Field("boroname", "Distrito", "boroname"),
        Field(
            "area_km2",
            "Área",
            "ROUND((ST_Area(ST_Transform(geom, 4326)::geography) / 1e6)::numeric, 2)::float8",
            type="float",
            unit="km²",
        ),
    ),
    filters=(_name_filter("Nombre del barrio"), _borough("boroname")),
    order_by="name NULLS LAST, ctid",
    title_field="name",
    card_fields=("boroname", "area_km2"),
    max_limit=200,
    simplify=0.0001,
)

STREETS = Dataset(
    slug="streets",
    table="nyc_streets",
    label="Calles",
    description="Ejes de calles (nyc_streets).",
    geometry_type="line",
    fields=(
        Field("name", "Nombre", "name"),
        Field("type", "Tipo", '"type"'),
        Field("oneway", "Sentido único", "COALESCE(oneway = 'yes', false)", type="bool"),
        Field("length_m", "Longitud", "ROUND(ST_Length(ST_Transform(geom, 4326)::geography))::int", type="int", unit="m"),
    ),
    filters=(
        _name_filter("Nombre de la calle"),
        Filter("type", "Tipo de vía", "facet", '"type" = %(type)s', facet_column="type"),
        Filter(
            "oneway",
            "Sentido",
            "bool",
            "COALESCE(oneway = 'yes', false) = %(oneway)s",
            toggle_labels=("Único", "Doble"),
            description="true = calles de sentido único; false = doble sentido",
        ),
    ),
    order_by="name NULLS LAST, ctid",
    title_field="name",
    card_fields=("type", "oneway", "length_m"),
    max_limit=500,
    simplify=0.00005,
)

CENSUS_BLOCKS = Dataset(
    slug="census-blocks",
    table="nyc_census_blocks",
    label="Bloques censales",
    description="Bloques censales con población (nyc_census_blocks).",
    geometry_type="polygon",
    fields=(
        Field("blkid", "Bloque", "blkid::text", type="raw"),
        Field("boroname", "Distrito", "boroname"),
        Field("popn_total", "Población total", "popn_total::int", type="int"),
        Field("popn_white", "Blancos", "popn_white::int", type="int"),
        Field("popn_black", "Negros", "popn_black::int", type="int"),
        Field("popn_nativ", "Nativos americanos", "popn_nativ::int", type="int"),
        Field("popn_asian", "Asiáticos", "popn_asian::int", type="int"),
        Field("popn_other", "Otros", "popn_other::int", type="int"),
    ),
    filters=(
        Filter(
            "blkid_prefix",
            "Código de bloque (prefijo)",
            "text",
            "blkid::text LIKE %(blkid_prefix)s",
            value_fn=_prefix,
            pattern=r"^[0-9]{1,15}$",
            description="Prefijo del código de 15 dígitos (los primeros 11 identifican el tramo censal)",
        ),
        _borough("boroname"),
        Filter("popn_total_min", "Población total mín.", "int", "popn_total >= %(popn_total_min)s", ge=0),
        Filter("popn_total_max", "Población total máx.", "int", "popn_total <= %(popn_total_max)s", ge=0),
        Filter("popn_white_min", "Blancos mín.", "int", "popn_white >= %(popn_white_min)s", ge=0, advanced=True),
        Filter("popn_black_min", "Negros mín.", "int", "popn_black >= %(popn_black_min)s", ge=0, advanced=True),
        Filter("popn_nativ_min", "Nativos mín.", "int", "popn_nativ >= %(popn_nativ_min)s", ge=0, advanced=True),
        Filter("popn_asian_min", "Asiáticos mín.", "int", "popn_asian >= %(popn_asian_min)s", ge=0, advanced=True),
        Filter("popn_other_min", "Otros mín.", "int", "popn_other >= %(popn_other_min)s", ge=0, advanced=True),
    ),
    order_by="blkid",
    title_field="blkid",
    card_fields=("boroname", "popn_total", "popn_white", "popn_black", "popn_asian", "popn_nativ", "popn_other"),
    max_limit=200,
    simplify=0.00003,
)

DATASETS: tuple[Dataset, ...] = (SUBWAY_STATIONS, HOMICIDES, NEIGHBORHOODS, STREETS, CENSUS_BLOCKS)
DATASETS_BY_SLUG = {d.slug: d for d in DATASETS}
