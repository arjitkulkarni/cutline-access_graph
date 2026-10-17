"""Typed, domain-specific agent tools — shared by the MCP server and the in-app agent runner.

The agent can investigate, plan and verify. It can NOT approve: `apply_repair` only succeeds for a
repair a human already approved in the console. No tool accepts raw Cypher or graph names.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from ..container import Container
from ..models.graph import CheckRequest, PathsRequest
from ..models.policy import Contract
from ..services import regression_export
from ..services.contract import derive_contract
from ..services.contract_parser import parse_rules


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    run: Callable[[Container, dict[str, Any]], dict[str, Any]]
    read_only: bool = True


def _str(desc: str) -> dict[str, Any]:
    return {"type": "string", "description": desc}


CONTRACT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "description": "Optional operator contract; graph-declared workflows and guardrails are always included.",
    "properties": {
        "must_deny": {"type": "array", "items": {"type": "object", "properties": {
            "principal": {"type": "string"}, "capability": {"type": "string"}}, "required": ["principal", "capability"]}},
        "must_allow": {"type": "array", "items": {"type": "object", "properties": {
            "principal": {"type": "string"}, "capability": {"type": "string"}}, "required": ["principal", "capability"]}},
    },
}


def _overview(c: Container, _: dict[str, Any]) -> dict[str, Any]:
    snap = c.policy.snapshot()
    risks = c.analyzer.risks()
    return {
        "revision": snap.revision, "hash": snap.hash,
        "principals": {u: snap.nodes[u].label for u in snap.users},
        "roles": {r: snap.nodes[r].label for r in snap.roles},
        "capabilities": {k: snap.nodes[k].props.get("sensitivity") for k in snap.capabilities},
        "workflows": [w.model_dump() for w in snap.workflows],
        "guardrails": [g.model_dump() for g in snap.guardrails],
        "violations": [{"principal": f.principal, "capability": f.capability, "path_count": len(f.paths)}
                       for f in risks.findings],
    }


def _trace(c: Container, args: dict[str, Any]) -> dict[str, Any]:
    res = c.analyzer.paths(PathsRequest(principal=args["principal"], capability=args["capability"]))
    return {"allowed": res.allowed, "paths": [" → ".join(p.nodes) for p in res.paths], "cypher": res.cypher,
            "query_ms": res.query_ms}


def _check(c: Container, args: dict[str, Any]) -> dict[str, Any]:
    res = c.analyzer.check(CheckRequest(principal=args["principal"], capability=args["capability"]))
    return res.model_dump()


def _risks(c: Container, _: dict[str, Any]) -> dict[str, Any]:
    res = c.analyzer.risks()
    return {"revision": res.revision.revision, "risky_path_count": res.risky_path_count,
            "findings": [{"principal": f.principal, "capability": f.capability, "guardrail": f.guardrail,
                          "paths": [" → ".join(p.nodes) for p in f.paths]} for f in res.findings]}


def _contract(c: Container, args: dict[str, Any]) -> dict[str, Any]:
    snap = c.policy.snapshot()
    if args.get("requirement"):
        return parse_rules(args["requirement"], snap).model_dump()
    return {"contract": derive_contract(snap).model_dump(), "notes": ["Derived from graph workflows and guardrails."]}


def _summarize_plan(plan) -> dict[str, Any]:
    return {
        "repair_id": plan.id, "status": plan.status, "base_revision": plan.base_revision.revision,
        "chosen": plan.chosen_candidate_id,
        "edits": [{"op": e.op, "describe": e.describe(), "reason": e.reason} for e in plan.edits],
        "candidates": [{"id": c.id, "title": c.title, "outcome": c.outcome, "cost": c.cost.total,
                        "first_violation": c.violations[0].model_dump() if c.violations else None}
                       for c in plan.candidates],
        "residual_notes": plan.residual_notes,
        "verification": None if not plan.verification else {
            "passed": plan.verification.passed,
            "checks": [f"{k.principal} {k.method} {k.path} → {k.status_code} (expected {k.expected})"
                       for k in plan.verification.checks]},
    }


def _propose(c: Container, args: dict[str, Any]) -> dict[str, Any]:
    contract = Contract.model_validate(args["contract"]) if args.get("contract") else None
    return _summarize_plan(c.repairs.plan(contract))


def _verify(c: Container, args: dict[str, Any]) -> dict[str, Any]:
    return _summarize_plan(c.repairs.verify(args["repair_id"]))


def _evidence(c: Container, args: dict[str, Any]) -> dict[str, Any]:
    ev = c.repairs.evidence(args["repair_id"])
    return {"status": ev.status, "stale": ev.stale, "stale_reason": ev.stale_reason,
            "permissions_removed": [p.model_dump() for p in ev.permissions_removed],
            "workflows_preserved": [w.model_dump() for w in ev.workflows_preserved],
            "rejected": [r.model_dump() for r in ev.rejected_candidates]}


def _export(c: Container, args: dict[str, Any]) -> dict[str, Any]:
    plan = c.repairs.get(args["repair_id"])
    return {"filename": f"{plan.id}_regression_test.py", "pytest": regression_export.export_pytest(plan)}


def _apply(c: Container, args: dict[str, Any]) -> dict[str, Any]:
    return _summarize_plan(c.repairs.apply(args["repair_id"]))


def _recall(c: Container, args: dict[str, Any]) -> dict[str, Any]:
    """Cross-session memory: earlier repairs and their counterexamples, read back from the FalkorDB ledger."""
    limit = max(1, min(int(args.get("limit") or 5), 20))
    snap = c.policy.snapshot()
    repairs = []
    for plan in c.ledger.list(limit):
        stale, _ = c.repairs.staleness(plan, snap)
        repairs.append({
            "repair_id": plan.id, "status": plan.status, "base_revision": plan.base_revision.revision,
            "stale": stale, "edits": [e.describe() for e in plan.edits],
            "lessons": [f"{cand.title}: {cand.outcome} ({cand.violations[0].kind} {cand.violations[0].principal} → "
                        f"{cand.violations[0].capability})" for cand in plan.candidates
                        if cand.outcome != "PASS" and cand.violations][:6],
        })
    events = [f"r{e.revision} {e.kind}: {e.summary}" for e in c.ledger.events(10)]
    return {"current_revision": snap.revision, "repairs": repairs, "recent_events": events}


TOOLS: list[Tool] = [
    Tool("inspect_policy", "Overview of the active policy graph in FalkorDB: principals, roles, capabilities, "
         "workflows, guardrails and current guardrail violations.", {"type": "object", "properties": {}}, _overview),
    Tool("find_risks", "Every guardrail violation in the active graph with ALL access paths (multi-hop).",
         {"type": "object", "properties": {}}, _risks),
    Tool("trace_access", "Return every bounded access path from a principal to a capability (FalkorDB query).",
         {"type": "object", "properties": {"principal": _str("user id, e.g. maya"),
                                            "capability": _str("capability id, e.g. export_customers")},
          "required": ["principal", "capability"]}, _trace),
    Tool("check_access", "Can this principal reach this capability? Returns one witness path.",
         {"type": "object", "properties": {"principal": _str("user id"), "capability": _str("capability id")},
          "required": ["principal", "capability"]}, _check),
    Tool("get_contract", "The security + business-survival contract. With `requirement`, parse natural language "
         "into a typed contract proposal (must be confirmed by a human).",
         {"type": "object", "properties": {"requirement": _str("optional natural-language requirement")}}, _contract),
    Tool("propose_repair", "Run the deterministic planner: generate bounded candidates, evaluate each on an isolated "
         "FalkorDB graph, return the cheapest one that passes plus counterexamples for the rest.",
         {"type": "object", "properties": {"contract": CONTRACT_SCHEMA}}, _propose, read_only=False),
    Tool("verify_repair", "Run runtime verification: real HTTP requests against the Customer Ops API using the "
         "repair's isolated candidate policy and an independent enforcement engine.",
         {"type": "object", "properties": {"repair_id": _str("rp_xxxxxxxx")}, "required": ["repair_id"]}, _verify,
         read_only=False),
    Tool("get_evidence", "Revision-bound evidence for a repair, including whether it is stale.",
         {"type": "object", "properties": {"repair_id": _str("rp_xxxxxxxx")}, "required": ["repair_id"]}, _evidence),
    Tool("export_regression_tests", "Executable pytest suite pinning every decision of the repair.",
         {"type": "object", "properties": {"repair_id": _str("rp_xxxxxxxx")}, "required": ["repair_id"]}, _export),
    Tool("recall_history", "Memory across sessions: previous repairs (stale or current), the counterexamples that "
         "rejected earlier candidates, and recent policy events — read from the FalkorDB evidence ledger.",
         {"type": "object", "properties": {"limit": {"type": "integer", "description": "max repairs (1-20)"}}}, _recall),
    Tool("apply_repair", "Apply a repair to the ACTIVE policy. Only works after a human approved it in the CUTLINE "
         "console; guarded by the policy revision; followed by post-apply verification.",
         {"type": "object", "properties": {"repair_id": _str("rp_xxxxxxxx")}, "required": ["repair_id"]}, _apply,
         read_only=False),
]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}
