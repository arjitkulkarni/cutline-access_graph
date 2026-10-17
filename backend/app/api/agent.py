from __future__ import annotations

from fastapi import APIRouter, Depends

from ..agent.runner import AgentRun, AgentRunner, InvestigateRequest
from ..container import Container
from .deps import container

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.post("/investigate", response_model=AgentRun)
def investigate(body: InvestigateRequest, c: Container = Depends(container)) -> AgentRun:
    return AgentRunner(c).run(body)
