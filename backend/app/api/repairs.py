from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel

from ..container import Container
from ..models.repair import ApproveRequest, Evidence, PlanRequest, RegressionSuite, RepairPlan
from ..services import regression_export
from .deps import container

router = APIRouter(prefix="/api", tags=["repairs"])


class RepairList(BaseModel):
    repairs: list[RepairPlan]


@router.post("/repairs/plan", response_model=RepairPlan)
def plan(body: PlanRequest, c: Container = Depends(container)) -> RepairPlan:
    return c.repairs.plan(body.contract)


@router.get("/repairs", response_model=RepairList)
def list_repairs(c: Container = Depends(container)) -> RepairList:
    return RepairList(repairs=c.repairs.list())


@router.get("/repairs/{repair_id}", response_model=RepairPlan)
def get_repair(repair_id: str, c: Container = Depends(container)) -> RepairPlan:
    return c.repairs.get(repair_id)


@router.post("/repairs/{repair_id}/verify", response_model=RepairPlan)
def verify(repair_id: str, c: Container = Depends(container)) -> RepairPlan:
    return c.repairs.verify(repair_id)


@router.post("/repairs/{repair_id}/approve", response_model=RepairPlan)
def approve(repair_id: str, body: ApproveRequest, c: Container = Depends(container)) -> RepairPlan:
    return c.repairs.approve(repair_id, body.approved_by, body.note)


@router.post("/repairs/{repair_id}/apply", response_model=RepairPlan)
def apply(repair_id: str, c: Container = Depends(container)) -> RepairPlan:
    return c.repairs.apply(repair_id)


@router.get("/evidence/{repair_id}", response_model=Evidence)
def evidence(repair_id: str, c: Container = Depends(container)) -> Evidence:
    return c.repairs.evidence(repair_id)


@router.get("/regression-tests/{repair_id}", response_model=RegressionSuite)
def regression_suite(repair_id: str, c: Container = Depends(container)) -> RegressionSuite:
    return regression_export.build_suite(c.repairs.get(repair_id))


@router.get("/regression-tests/{repair_id}/export")
def regression_export_file(repair_id: str, format: Literal["json", "pytest"] = Query(default="json"),
                           c: Container = Depends(container)):
    plan = c.repairs.get(repair_id)
    if format == "pytest":
        return PlainTextResponse(regression_export.export_pytest(plan), media_type="text/x-python", headers={
            "Content-Disposition": f'attachment; filename="{plan.id}_regression_test.py"'})
    return JSONResponse(regression_export.export_json(plan), headers={
        "Content-Disposition": f'attachment; filename="{plan.id}_regression.json"'})
