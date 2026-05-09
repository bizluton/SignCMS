"""
SignCMS Media API — FastAPI application entry point.

Startup:
    uvicorn app.main:app --reload

The application:
  - Creates the storage directory if it does not exist.
  - Runs SQLAlchemy ``create_all`` so the DB schema is always up to date on
    startup (use Alembic for production migrations).
  - Registers /assets and /manifest routers.
  - Provides a /health liveness endpoint.
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
from app.routers import assets, manifest


# ---------------------------------------------------------------------------
# Lifespan — init / teardown
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    # Ensure upload storage directory exists
    settings.storage_path.mkdir(parents=True, exist_ok=True)

    # Auto-create tables (idempotent via CREATE TABLE IF NOT EXISTS)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield

    # Clean shutdown — release all DB connections
    await engine.dispose()


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------


app = FastAPI(
    title="SignCMS Media API",
    version="1.0.0",
    description=(
        "Media asset upload with SHA-256 deduplication, "
        "and sync-manifest generation for SignCMS players."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Allow all origins in development; tighten in production via env var.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(assets.router)
app.include_router(manifest.router)


# ---------------------------------------------------------------------------
# Liveness probe
# ---------------------------------------------------------------------------


@app.get("/health", tags=["ops"])
async def health() -> dict[str, str]:
    """Returns ``{"status": "ok"}`` — used by load balancers / k8s probes."""
    return {"status": "ok"}
