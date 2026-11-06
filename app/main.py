from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .db import pool
from .routers import subway_stations


@asynccontextmanager
async def lifespan(_: FastAPI):
    pool.open()
    try:
        yield
    finally:
        pool.close()


app = FastAPI(
    title="NYC Subway Stations API",
    description="API de solo lectura sobre la tabla nyc_subway_stations (PostGIS).",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(subway_stations.router)


@app.get("/health", tags=["health"])
def health() -> dict:
    return {"status": "ok"}


# Cliente web: se monta al final para que las rutas de la API tengan prioridad.
app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="web")
