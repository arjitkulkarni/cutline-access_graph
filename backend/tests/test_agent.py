import asyncio

from app.agent.tools import TOOLS
from tests.conftest import ok


def test_deterministic_agent_investigates_plans_and_verifies(harness):
    run = ok(harness.client.post("/api/agent/investigate", json={}))
    assert run["mode"] == "deterministic" and run["model"] is None
    tools = [s["tool"] for s in run["steps"]]
    assert tools[:3] == ["inspect_policy", "recall_history", "find_risks"]
    assert tools.count("trace_access") == 2 and tools[-2:] == ["propose_repair", "verify_repair"]
    assert all(s["ok"] for s in run["steps"])
    assert run["repair_id"].startswith("rp_")
    assert "rejected" in run["narrative"] and "approve" in run["narrative"]
    plan = ok(harness.client.get(f"/api/repairs/{run['repair_id']}"))
    assert plan["status"] == "VERIFIED"  # the agent verified but did not approve or apply


def test_agent_memory_recalls_earlier_counterexamples(harness):
    ok(harness.client.post("/api/agent/investigate", json={}))
    second = ok(harness.client.post("/api/agent/investigate", json={}))
    recall = next(s for s in second["steps"] if s["tool"] == "recall_history")
    assert recall["summary"].startswith("1 earlier repair,")


def test_agent_reports_unknown_entities_instead_of_guessing(harness):
    from app.agent.runner import AgentRunner
    runner = AgentRunner(harness.container)
    out, step = runner._call("check_access", {"principal": "maya", "capability": "delete_customers"})
    assert step.ok is False and "Unknown capability" in out["error"]["message"]


def test_mcp_server_exposes_typed_tools_without_raw_cypher():
    from app.mcp_server import server
    tools = asyncio.run(server.list_tools())
    names = {t.name for t in tools}
    assert {"find_risks", "trace_access", "propose_repair", "verify_repair", "recall_history", "apply_repair"} <= names
    for t in tools:
        props = (t.input_schema or {}).get("properties", {})
        assert not any(k in props for k in ("cypher", "query", "graph"))
    destructive = {t.name for t in tools if t.annotations and t.annotations.destructive_hint}
    assert destructive == {"apply_repair"}
    assert {t.name for t in TOOLS} == names
