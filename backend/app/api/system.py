from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import __version__
from ..container import Container
from ..db import scenario
from ..errors import CutlineError, FalkorUnavailable
from ..models.graph import PolicyRevision
from ..models.repair import ActivityEvent, MutateRequest, MutateResponse
from .deps import container

router = APIRouter(prefix="/api", tags=["system"])
probes = APIRouter(tags=["probes"])


@probes.get("/health")
async def liveness() -> dict[str, str]:
    """Liveness: the process answers. Touches no dependency, so it is safe to poll often."""
    return {"status": "ok", "version": __version__}


@probes.get("/ready")
def readiness(c: Container = Depends(container)) -> JSONResponse:
    """Readiness: FalkorDB answers PING and GRAPH.LIST. 503 otherwise (for uptime monitors)."""
    try:
        latency = c.store.ping()
    except CutlineError as exc:
        return JSONResponse(status_code=503, content={"status": "unavailable", "falkordb": {
            "connected": False, "error": exc.message}})
    return JSONResponse(content={"status": "ready", "falkordb": {"connected": True, "latency_ms": latency}})


class FalkorStatus(BaseModel):
    connected: bool
    host: str
    graph: str
    latency_ms: float | None
    error: str | None


class EngineStatus(BaseModel):
    name: str
    available: bool
    detail: str | None


class LlmStatus(BaseModel):
    configured: bool
    model: str | None


class Health(BaseModel):
    status: str
    falkordb: FalkorStatus
    demo_mode: bool
    authz_engine: EngineStatus
    llm: LlmStatus
    version: str


class Scenario(BaseModel):
    id: str
    name: str
    description: str
    active: bool


class ResetResponse(BaseModel):
    revision: PolicyRevision


class ActivityResponse(BaseModel):
    events: list[ActivityEvent]


@router.get("/health", response_model=Health)
def health(c: Container = Depends(container)) -> Health:
    s = c.settings
    try:
        latency, error, connected = c.store.ping(), None, True
    except FalkorUnavailable as exc:
        latency, error, connected = None, exc.message, False
    engine_ok, engine_detail = c.pdp.engine.available()
    return Health(
        status="ok" if connected and engine_ok else "degraded",
        falkordb=FalkorStatus(connected=connected, host=f"{s.falkordb_host}:{s.falkordb_port}",
                              graph=s.falkordb_graph, latency_ms=latency, error=error),
        demo_mode=s.demo_mode,
        authz_engine=EngineStatus(name=c.pdp.engine_name, available=engine_ok, detail=engine_detail),
        llm=LlmStatus(configured=bool(s.anthropic_api_key), model=s.llm_model if s.anthropic_api_key else None),
        version=__version__,
    )


@router.get("/scenarios", response_model=list[Scenario])
def scenarios() -> list[Scenario]:
    return [Scenario(id=scenario.SCENARIO_ID, name=scenario.SCENARIO_NAME, description=scenario.SCENARIO_DESCRIPTION,
                     active=True)]


@router.post("/scenarios/customer-ops/reset", response_model=ResetResponse)
def reset(c: Container = Depends(container)) -> ResetResponse:
    return ResetResponse(revision=c.policy.reset())


@router.get("/policy/revision", response_model=PolicyRevision)
def revision(c: Container = Depends(container)) -> PolicyRevision:
    c.policy.ensure_ready()
    return c.policy.revision()


@router.get("/activity", response_model=ActivityResponse)
def activity(limit: int = 30, c: Container = Depends(container)) -> ActivityResponse:
    c.policy.ensure_ready()
    return ActivityResponse(events=c.ledger.events(limit))


@router.post("/demo/mutate-policy", response_model=MutateResponse)
def mutate(body: MutateRequest, c: Container = Depends(container)) -> MutateResponse:
    return c.policy.mutate(body.mutation, c.analyzer.new_paths_for)
