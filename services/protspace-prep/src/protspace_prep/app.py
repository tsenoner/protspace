from __future__ import annotations
import asyncio
import logging
from contextlib import asynccontextmanager
from functools import partial
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from .api import fasta_validation_error_handler, make_router
from .config import Settings, load_settings
from .jobs import JobRegistry, PipelineFn
from .logger import setup_logging
from .pipeline import run_protspace_prepare
from .ratelimit import make_limiter
from .validation import FastaValidationError

logger = logging.getLogger("protspace_prep")


def create_app(*, pipeline: Optional[PipelineFn] = None) -> FastAPI:
    settings = load_settings()
    # Configure logging before anything else emits a log line so no logger is
    # cached without the structlog formatter.
    setup_logging(json_logs=settings.log_json_format, log_level=settings.log_level)
    settings.job_root.mkdir(parents=True, exist_ok=True)

    registry = JobRegistry(
        job_root=settings.job_root,
        max_concurrent=settings.max_concurrent_jobs,
        max_pending=settings.max_pending_jobs,
        pipeline=pipeline or partial(run_protspace_prepare, settings=settings),
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async def _sweep_loop():
            while True:
                try:
                    await asyncio.sleep(settings.sweep_interval_seconds)
                    registry.sweep_expired(settings.bundle_ttl_seconds)
                except asyncio.CancelledError:
                    break
                except Exception:
                    logger.exception("sweeper iteration failed")

        sweeper = asyncio.create_task(_sweep_loop())
        try:
            yield
        finally:
            sweeper.cancel()
            try:
                await sweeper
            except asyncio.CancelledError:
                pass

    app = FastAPI(title="protspace-prep", version="0.1.0", lifespan=lifespan)
    app.state.registry = registry
    app.state.settings = settings

    limiter = make_limiter()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    if settings.cors_allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_allowed_origins),
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Content-Type"],
            max_age=86400,
        )
    else:
        # A blank/empty CORS_ALLOWED_ORIGIN silently disables CORS. Surface it so
        # an accidentally-blanked secret shows up in logs rather than failing mute.
        logger.warning("CORS disabled: no allowed origins configured.")

    app.add_exception_handler(FastaValidationError, fasta_validation_error_handler)

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"ok": True, "jobs": registry.counts()}

    app.include_router(make_router(registry, settings, limiter))
    return app


app = create_app()
