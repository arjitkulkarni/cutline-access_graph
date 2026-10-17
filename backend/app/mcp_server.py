"""CUTLINE MCP server — typed security-domain tools over the FalkorDB permission graph.

Run (stdio):            python -m app.mcp_server
Run (streamable HTTP):  python -m app.mcp_server --http --port 8765

Claude Code:  claude mcp add cutline -- <path-to>/backend/.venv/Scripts/python -m app.mcp_server
(The tools call the same services as the REST API; FALKORDB_* settings come from backend/.env.)
"""

from __future__ import annotations

import argparse
import json
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp_types import ToolAnnotations

from .agent.tools import TOOLS_BY_NAME
from .container import build_container
from .errors import CutlineError

server = MCPServer(
    name="cutline",
    title="CUTLINE permission repair",
    instructions=(
        "CUTLINE repairs excessive permissions without breaking required workflows. Investigate with find_risks / "
        "trace_access, plan with propose_repair, prove with verify_repair. The deterministic verifier — not you — "
        "decides whether a repair is safe. You cannot approve repairs; a human approves in the CUTLINE console."
    ),
)
_container = None


def _c():
    global _container
    if _container is None:
        _container = build_container()
    return _container


def _call(name: str, args: dict[str, Any]) -> str:
    try:
        return json.dumps(TOOLS_BY_NAME[name].run(_c(), args), default=str)
    except CutlineError as exc:
        return json.dumps(exc.to_body())


def _ro(title: str) -> ToolAnnotations:
    return ToolAnnotations(title=title, read_only_hint=True, open_world_hint=False)


@server.tool(annotations=_ro("Inspect policy"))
def inspect_policy() -> str:
    """Overview of the active policy graph: principals, roles, capabilities, workflows, guardrails, violations."""
    return _call("inspect_policy", {})


@server.tool(annotations=_ro("Find risks"))
def find_risks() -> str:
    """Every guardrail violation with ALL multi-hop access paths, straight from FalkorDB."""
    return _call("find_risks", {})


@server.tool(annotations=_ro("Trace access"))
def trace_access(principal: str, capability: str) -> str:
    """Every bounded access path from a principal (e.g. maya) to a capability (e.g. export_customers)."""
    return _call("trace_access", {"principal": principal, "capability": capability})


@server.tool(annotations=_ro("Check access"))
def check_access(principal: str, capability: str) -> str:
    """Whether the principal can reach the capability, with one witness path."""
    return _call("check_access", {"principal": principal, "capability": capability})


@server.tool(annotations=_ro("Get contract"))
def get_contract(requirement: str | None = None) -> str:
    """The security + business-survival contract; pass `requirement` to parse natural language into a proposal."""
    return _call("get_contract", {"requirement": requirement} if requirement else {})


@server.tool(annotations=ToolAnnotations(title="Propose repair", read_only_hint=False, destructive_hint=False,
                                         idempotent_hint=False, open_world_hint=False))
def propose_repair(contract_json: str | None = None) -> str:
    """Plan a repair. Candidates are evaluated on isolated FalkorDB graphs; rejected ones carry counterexamples.
    `contract_json` optionally holds {"must_deny":[{principal,capability}],"must_allow":[...]}."""
    return _call("propose_repair", {"contract": json.loads(contract_json)} if contract_json else {})


@server.tool(annotations=ToolAnnotations(title="Verify repair", read_only_hint=False, destructive_hint=False,
                                         open_world_hint=False))
def verify_repair(repair_id: str) -> str:
    """Runtime verification: real HTTP requests to the Customer Ops API against the repair's candidate policy."""
    return _call("verify_repair", {"repair_id": repair_id})


@server.tool(annotations=_ro("Get evidence"))
def get_evidence(repair_id: str) -> str:
    """Revision-bound evidence for a repair, including whether it has gone stale."""
    return _call("get_evidence", {"repair_id": repair_id})


@server.tool(annotations=_ro("Recall history"))
def recall_history(limit: int = 5) -> str:
    """Memory across sessions: earlier repairs, the counterexamples that rejected candidates, recent policy events."""
    return _call("recall_history", {"limit": limit})


@server.tool(annotations=_ro("Export regression tests"))
def export_regression_tests(repair_id: str) -> str:
    """Executable pytest suite pinning every access decision of the repair."""
    return _call("export_regression_tests", {"repair_id": repair_id})


@server.tool(annotations=ToolAnnotations(title="Apply repair", read_only_hint=False, destructive_hint=True,
                                         open_world_hint=False))
def apply_repair(repair_id: str) -> str:
    """Apply an already human-approved repair to the active policy (revision-guarded, then re-verified)."""
    return _call("apply_repair", {"repair_id": repair_id})


def main() -> None:
    parser = argparse.ArgumentParser(description="CUTLINE MCP server")
    parser.add_argument("--http", action="store_true", help="serve streamable HTTP instead of stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.http:
        server.run("streamable-http", host=args.host, port=args.port)
    else:
        server.run()


if __name__ == "__main__":
    main()
