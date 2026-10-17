from app.models.repair import Edit
from tests.conftest import ok


def test_both_unwanted_export_paths_are_discovered(harness):
    body = ok(harness.client.post("/api/access/paths", json={"principal": "maya", "capability": "export_customers"}))
    assert body["allowed"] is True
    assert [p["nodes"] for p in body["paths"]] == [
        ["maya", "support", "export_helper", "export_customers"],
        ["maya", "support", "shared_ops", "export_customers"],
    ]
    assert body["paths"][0]["edges"] == ["ASSIGNED_TO", "INHERITS", "GRANTS"]
    assert body["paths"][0]["edge_ids"][0] == "maya|ASSIGNED_TO|support"


def test_direct_grant_is_a_zero_hop_path(harness):
    body = ok(harness.client.post("/api/access/paths", json={"principal": "noah", "capability": "view_orders"}))
    assert [p["nodes"] for p in body["paths"]] == [["noah", "support", "view_orders"]]
    assert body["paths"][0]["edges"] == ["ASSIGNED_TO", "GRANTS"]


def test_finance_has_exactly_one_legitimate_route(harness):
    body = ok(harness.client.post("/api/access/paths", json={"principal": "felix", "capability": "export_customers"}))
    assert [p["nodes"] for p in body["paths"]] == [["felix", "finance", "shared_ops", "export_customers"]]


def test_risks_report_every_path_for_every_subject(harness):
    body = ok(harness.client.get("/api/risks"))
    assert {(f["principal"], f["capability"]) for f in body["findings"]} == {
        ("maya", "export_customers"), ("noah", "export_customers")}
    assert body["risky_path_count"] == 4


def test_multiple_assignments_and_cycles_are_handled(harness):
    store, active = harness.store, harness.container.store.active
    # second assignment for felix plus an inheritance cycle shared_ops -> support -> shared_ops
    store.apply_edits(active, [
        Edit(op="ASSIGN_ROLE", principal="felix", role="export_helper"),
        Edit(op="ADD_INHERITS", role="shared_ops", parent="support"),
    ], change="test", ts="t", expected_revision=None)
    paths, _, _ = store.paths("felix", "export_customers")
    starts = {tuple(p.nodes[:2]) for p in paths}
    assert ("felix", "finance") in starts and ("felix", "export_helper") in starts
    # the cycle terminates (each relationship used once per path) and paths are de-duplicated
    assert len(paths) == len({tuple(p.nodes) for p in paths})


def test_depth_bound_is_respected(harness):
    store = harness.store
    paths, _, _ = store.paths("maya", "export_customers", max_depth=1)
    assert len(paths) == 2
    # chain longer than the bound becomes invisible to the bounded query
    chain = [Edit(op="CREATE_ROLE", role=f"r{i}", name=f"r{i}") for i in range(3)]
    chain += [Edit(op="ADD_INHERITS", role="r0", parent="r1"), Edit(op="ADD_INHERITS", role="r1", parent="r2"),
              Edit(op="ADD_GRANT", role="r2", capability="export_customers"),
              Edit(op="ASSIGN_ROLE", principal="felix", role="r0")]
    store.apply_edits(store.active, chain, change="test", ts="t")
    shallow, _, _ = store.paths("felix", "export_customers", max_depth=1)
    deep, _, _ = store.paths("felix", "export_customers", max_depth=3)
    assert ["felix", "r0", "r1", "r2", "export_customers"] not in [p.nodes for p in shallow]
    assert ["felix", "r0", "r1", "r2", "export_customers"] in [p.nodes for p in deep]


def test_unknown_entities_are_rejected(harness):
    r = harness.client.post("/api/access/paths", json={"principal": "mallory", "capability": "export_customers"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_graph_endpoint_returns_falkordb_shaped_payload(harness):
    body = ok(harness.client.get("/api/graph"))
    kinds = {n["kind"] for n in body["nodes"]}
    assert kinds == {"user", "role", "capability", "resource"}
    assert {"maya|ASSIGNED_TO|support", "support|INHERITS|shared_ops", "export_helper|GRANTS|export_customers"} <= {
        e["id"] for e in body["edges"]}
    assert {w["id"] for w in body["workflows"]} == {"order_support", "finance_close", "dsar_fulfilment"}
    assert body["revision"]["revision"] == 1 and body["revision"]["hash"].startswith("sha256:")
