"""Synthetic Customer Ops application — the thing CUTLINE's repairs are verified against.

The principal comes from a development-only header (X-Cutline-Principal). This is a demo
principal selector, not authentication. X-Cutline-Policy selects which policy graph the
enforcement point reads: the active policy or a repair's isolated candidate graph.
"""

from __future__ import annotations

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

from ..errors import CutlineError

router = APIRouter(prefix="/demo", tags=["synthetic customer-ops app"])

ENDPOINTS: dict[str, tuple[str, str]] = {
    "view_orders": ("GET", "/demo/orders"),
    "generate_reports": ("GET", "/demo/reports"),
    "export_customers": ("POST", "/demo/customers/export"),
}

_ORDERS = [{"id": f"ORD-{1040 + i}", "customer": f"CUS-{2100 + i * 7}", "status": s, "total": round(42.5 + i * 13.25, 2)}
           for i, s in enumerate(["shipped", "processing", "refund_requested", "delivered", "shipped"])]


def _deny(principal: str | None, capability: str, decision, reason: str) -> JSONResponse:
    headers = _headers(decision) if decision else {}
    return JSONResponse(status_code=403, headers=headers, content={"error": {
        "code": "FORBIDDEN", "message": reason, "principal": principal, "capability": capability}})


def _headers(decision) -> dict[str, str]:
    return {
        "X-Cutline-Decision": "allow" if decision.allow else "deny",
        "X-Cutline-Engine": decision.engine,
        "X-Cutline-Decision-Id": decision.decision_id,
        "X-Cutline-Graph": decision.graph,
    }


def _authorize(request: Request, principal: str | None, policy: str, capability: str):
    container = request.app.state.container
    if not principal:
        return None, _deny(principal, capability, None, "Missing X-Cutline-Principal header (demo principal selector).")
    try:
        graph = container.repairs.resolve_policy_target(policy)
        decision = container.pdp.decide(graph, principal, capability)
    except CutlineError as exc:
        return None, JSONResponse(status_code=exc.status_code, content=exc.to_body())
    if not decision.allow:
        return decision, _deny(principal, capability, decision, f"{principal} may not {capability}.")
    return decision, None


@router.get("/orders")
def list_orders(request: Request, x_cutline_principal: str | None = Header(default=None),
                x_cutline_policy: str = Header(default="active")):
    decision, denied = _authorize(request, x_cutline_principal, x_cutline_policy, "view_orders")
    if denied:
        return denied
    return JSONResponse(headers=_headers(decision), content={"synthetic": True, "orders": _ORDERS})


@router.get("/reports")
def ticket_report(request: Request, x_cutline_principal: str | None = Header(default=None),
                  x_cutline_policy: str = Header(default="active")):
    decision, denied = _authorize(request, x_cutline_principal, x_cutline_policy, "generate_reports")
    if denied:
        return denied
    return JSONResponse(headers=_headers(decision), content={
        "synthetic": True, "report": "weekly-ticket-summary", "tickets_closed": 184, "median_first_response_min": 11})


@router.post("/customers/export")
def export_customers(request: Request, x_cutline_principal: str | None = Header(default=None),
                     x_cutline_policy: str = Header(default="active")):
    decision, denied = _authorize(request, x_cutline_principal, x_cutline_policy, "export_customers")
    if denied:
        return denied
    sample = [{"id": f"CUS-{2100 + i}", "email": f"customer{i:04d}@example.test"} for i in range(3)]
    return JSONResponse(headers=_headers(decision), content={
        "synthetic": True, "records": 1000, "sample": sample, "note": "Synthetic records only."})
