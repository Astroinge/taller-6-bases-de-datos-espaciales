from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .db import pool
from .routers import datasets


@asynccontextmanager
async def lifespan(_: FastAPI):
    pool.open()
    try:
        yield
    finally:
        pool.close()


app = FastAPI(
    title="NYC Spatial Data API",
    description="API de solo lectura sobre la base NYC (PostGIS): estaciones de metro, homicidios, barrios, calles y bloques censales.",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(datasets.router)


@app.get("/health", tags=["health"])
def health() -> dict:
    return {"status": "ok"}


# Cliente web: se monta al final para que las rutas de la API tengan prioridad.
app.mount("/", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="web")
