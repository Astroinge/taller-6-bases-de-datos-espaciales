from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

# open=False: el pool se abre en el lifespan de la app (ver main.py).
pool = ConnectionPool(
    settings.database_url,
    min_size=1,
    max_size=10,
    open=False,
    kwargs={"row_factory": dict_row},
)
