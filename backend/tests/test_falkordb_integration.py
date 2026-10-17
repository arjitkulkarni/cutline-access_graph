"""End-to-end against a REAL FalkorDB (local Docker or FalkorDB Cloud).

Run:  CUTLINE_TEST_FALKORDB=1 pytest -m falkordb -v      (FALKORDB_* come from backend/.env)
Uses a throw-away graph name per run and deletes everything it created.
"""

from __future__ import annotations

import os
import threading
import time
import uuid

import httpx
import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.config import Settings
from app.container import build_container
from app.errors import StaleProposal
from app.main import create_app
from app.models.repair import Edit

pytestmark = pytest.mark.falkordb


@pytest.fixture(scope="module")
def real():
    if os.environ.get("CUTLINE_TEST_FALKORDB") != "1":
        pytest.skip("set CUTLINE_TEST_FALKORDB=1 (and FALKORDB_* credentials) to run against real FalkorDB")
    graph = f"cutline_it_{uuid.uuid4().hex[:6]}"
    settings = Settings().model_copy(update={"falkordb_graph": graph, "demo_mode": True, "authz_engine": "reference"})
    container = build_container(settings)
    app = create_app(container)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="off"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(200):
        if server.started:
            break
        time.sleep(0.05)
    base = f"http://127.0.0.1:{server.servers[0].sockets[0].getsockname()[1]}"
    container.verifier._client = httpx.Client(base_url=base, timeout=30)  # real sockets end to end
    container.policy.ensure_ready()
    yield container, TestClient(app)
    server.should_exit = True
    thread.join(timeout=5)
    for name in container.store.list_graphs():
        if name == graph or name.startswith(graph + "__"):
            container.store.delete_graph(name)


def test_seed_and_bounded_multi_path_discovery(real):
    container, client = real
    body = client.post("/api/access/paths", json={"principal": "maya", "capability": "export_customers"}).json()
    assert [p["nodes"] for p in body["paths"]] == [
        ["maya", "support", "export_helper", "export_customers"],
        ["maya", "support", "shared_ops", "export_customers"],
    ]
    direct = client.post("/api/access/paths", json={"principal": "maya", "capability": "view_orders"}).json()
    assert [p["nodes"] for p in direct["paths"]] == [["maya", "support", "view_orders"]]  # zero INHERITS hops
    assert container.store.effective_access() == {
        ("maya", "view_orders"), ("maya", "generate_reports"), ("maya", "export_customers"),
        ("noah", "view_orders"), ("noah", "generate_reports"), ("noah", "export_customers"),
        ("dsar_bot", "view_orders"), ("dsar_bot", "generate_reports"), ("dsar_bot", "export_customers"),
        ("felix", "export_customers"),
    }


def test_guarded_write_is_all_or_nothing(real):
    container, _ = real
    store = container.store
    snap = store.snapshot()
    with pytest.raises(StaleProposal):
        store.apply_edits(store.active, [Edit(op="UNASSIGN_ROLE", principal="maya", role="support")],
                          change="it", ts="t", expected_revision=snap.revision + 7)
    assert store.snapshot().hash == snap.hash


def test_full_lifecycle_on_real_falkordb(real):
    container, client = real
    before = container.store.snapshot()
    plan = client.post("/api/repairs/plan", json={}).json()
    assert plan["status"] == "PROPOSED", plan
    assert container.store.snapshot().hash == before.hash  # candidates never touch the active graph
    chosen = next(c for c in plan["candidates"] if c["id"] == plan["chosen_candidate_id"])
    assert chosen["family"] == "scoped_role_migration"
    assert chosen["isolation"] in ("GRAPH.COPY", "snapshot-replay")
    naive = next(c for c in plan["candidates"] if c["title"].startswith("Revoke export_customers from Shared Ops"))
    assert naive["outcome"] == "FAIL_REQUIRED_WORKFLOW"

    verified = client.post(f"/api/repairs/{plan['id']}/verify").json()
    assert verified["verification"]["passed"] is True, verified["verification"]
    client.post(f"/api/repairs/{plan['id']}/approve", json={"approved_by": "integration-test"})
    applied = client.post(f"/api/repairs/{plan['id']}/apply").json()
    assert applied["status"] == "APPLIED", applied
    write = applied["application"]["write"]
    assert (write["nodes_created"], write["relationships_created"], write["relationships_deleted"]) == (1, 4, 2)
    assert applied["application"]["to_revision"]["revision"] == before.revision + 1

    mutated = client.post("/api/demo/mutate-policy", json={"mutation": "contractor_tools"}).json()
    assert ["maya", "support_safe", "contractor_tools", "export_customers"] in [p["nodes"] for p in mutated["new_paths"]]
    assert client.get(f"/api/evidence/{plan['id']}").json()["stale"] is True
    replan = client.post("/api/repairs/plan", json={}).json()
    assert [(e["op"], e.get("role"), e.get("parent")) for e in replan["edits"]] == [
        ("REMOVE_INHERITS", "support_safe", "contractor_tools")]
