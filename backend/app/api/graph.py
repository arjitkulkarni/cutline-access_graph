from __future__ import annotations

from fastapi import APIRouter, Depends

from ..container import Container
from ..models.graph import CheckRequest, CheckResponse, GraphResponse, PathsRequest, PathsResponse, RisksResponse
from ..models.policy import Contract, ParseRequest, ParseResponse
from ..services.contract import derive_contract
from ..services.contract_parser import parse_rules
from .deps import container

router = APIRouter(prefix="/api", tags=["graph"])


@router.get("/graph", response_model=GraphResponse)
def graph(c: Container = Depends(container)) -> GraphResponse:
    return c.analyzer.graph()


@router.post("/access/paths", response_model=PathsResponse)
def paths(body: PathsRequest, c: Container = Depends(container)) -> PathsResponse:
    return c.analyzer.paths(body)


@router.post("/access/check", response_model=CheckResponse)
def check(body: CheckRequest, c: Container = Depends(container)) -> CheckResponse:
    return c.analyzer.check(body)


@router.get("/risks", response_model=RisksResponse)
def risks(c: Container = Depends(container)) -> RisksResponse:
    return c.analyzer.risks()


@router.get("/contract", response_model=Contract)
def contract(c: Container = Depends(container)) -> Contract:
    return derive_contract(c.policy.snapshot())


@router.post("/contract/parse", response_model=ParseResponse)
def parse(body: ParseRequest, c: Container = Depends(container)) -> ParseResponse:
    return parse_rules(body.text, c.policy.snapshot())
