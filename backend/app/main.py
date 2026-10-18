"""CUTLINE API — `uvicorn app.main:app --port 8000` from the backend/ directory."""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from . import __version__
from .api import agent, graph, repairs, system
from .config import Settings
from .container import Container, build_container
from .demo_app import customer_ops
from .errors import CutlineError, FalkorUnavailable

log = logging.getLogger("cutline")


def configure_logging(settings: Settings) -> None:
    """Send the app's own loggers to stdout (uvicorn only configures its loggers)."""
    if not log.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        log.addHandler(handler)
    log.setLevel(settings.log_level.upper())


@asynccontextmanager
async def lifespan(app: FastAPI):
    container: Container = app.state.container
    s = container.settings
    configure_logging(s)
    log.info("CUTLINE %s starting (environment=%s, demo_mode=%s, authz_engine=%s, llm=%s)", __version__,
             s.environment, s.demo_mode, s.authz_engine, "on" if s.anthropic_api_key else "off")
    try:
        await run_in_threadpool(container.policy.ensure_ready)
        log.info("FalkorDB ready; active graph '%s'", container.store.active)
    except FalkorUnavailable as exc:
        log.warning("Starting without FalkorDB: %s", exc.message)
    except CutlineError as exc:
        log.warning("Policy graph not ready: %s", exc.message)
    yield


def create_app(container: Container | None = None) -> FastAPI:
    app = FastAPI(
        title="CUTLINE",
        version=__version__,
        description="Graph-native permission repair: trace every route to a forbidden capability in FalkorDB, "
                    "plan the smallest safe structural change, and prove what survives.",
        lifespan=lifespan,
    )
    app.state.container = container or build_container()
    settings = app.state.container.settings

    @app.middleware("http")
    async def _no_store(request: Request, call_next):
        # live policy state: never let a CDN or proxy (e.g. Vercel's rewrite cache) serve a stale answer
        response = await call_next(request)
        response.headers.setdefault("Cache-Control", "no-store")
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=app.state.container.settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Cutline-Decision", "X-Cutline-Engine", "X-Cutline-Decision-Id", "X-Cutline-Graph"],
    )

    @app.exception_handler(CutlineError)
    async def _cutline_error(_: Request, exc: CutlineError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_body())

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"error": {
            "code": "VALIDATION_ERROR", "message": "Request body is invalid.", "details": {"errors": exc.errors()}}})

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error")
        # the traceback is in the server log; production clients get no internals
        message = "Internal server error." if settings.is_production else str(exc)
        return JSONResponse(status_code=500, content={"error": {"code": "INTERNAL", "message": message}})

    app.include_router(system.probes)
    app.include_router(system.router)
    app.include_router(graph.router)
    app.include_router(repairs.router)
    app.include_router(agent.router)
    app.include_router(customer_ops.router)
    return app


app = create_app()
