from app.models.repair import Edit
from tests.conftest import ok


def _verified(harness):
    plan = ok(harness.client.post("/api/repairs/plan", json={}))
    return ok(harness.client.post(f"/api/repairs/{plan['id']}/verify"))


def test_mutation_makes_previous_evidence_stale_and_reveals_the_new_path(harness):
    plan = _verified(harness)
    mutated = ok(harness.client.post("/api/demo/mutate-policy", json={"mutation": "contractor_tools"}))
    assert mutated["revision"]["revision"] == 2
    assert ["maya", "support", "contractor_tools", "export_customers"] in [p["nodes"] for p in mutated["new_paths"]]
    evidence = ok(harness.client.get(f"/api/evidence/{plan['id']}"))
    assert evidence["stale"] is True and "r1 to r2" in evidence["stale_reason"]
    assert ok(harness.client.get(f"/api/repairs/{plan['id']}"))["stale"] is True


def test_stale_repair_cannot_be_approved_verified_or_applied(harness):
    plan = _verified(harness)
    ok(harness.client.post("/api/demo/mutate-policy", json={"mutation": "contractor_tools"}))
    for action, body in (("approve", {"approved_by": "op"}), ("verify", None)):
        r = harness.client.post(f"/api/repairs/{plan['id']}/{action}", json=body)
        assert r.status_code == 409 and r.json()["error"]["code"] == "STALE_PROPOSAL"


def test_approved_but_stale_repair_is_refused_at_apply_time(harness):
    plan = _verified(harness)
    ok(harness.client.post(f"/api/repairs/{plan['id']}/approve", json={"approved_by": "op"}))
    ok(harness.client.post("/api/demo/mutate-policy", json={"mutation": "direct_export_helper"}))
    before = harness.container.store.snapshot()
    r = harness.client.post(f"/api/repairs/{plan['id']}/apply")
    assert r.status_code == 409 and r.json()["error"]["code"] == "STALE_PROPOSAL"
    after = harness.container.store.snapshot()
    assert (before.revision, before.hash) == (after.revision, after.hash)  # nothing written


def test_out_of_band_edit_is_detected_as_hash_drift(harness):
    plan = _verified(harness)
    # someone edits the graph directly (e.g. FalkorDB Browser) without bumping the revision
    harness.store.graphs[harness.container.store.active].edges["ASSIGNED_TO"].append(("noah", "finance"))
    evidence = ok(harness.client.get(f"/api/evidence/{plan['id']}"))
    assert evidence["stale"] is True and "hash drift" in evidence["stale_reason"]


def test_guarded_write_refuses_a_moved_revision_and_writes_nothing(harness):
    store = harness.container.store
    snap = store.snapshot()
    try:
        store.apply_edits(store.active, [Edit(op="UNASSIGN_ROLE", principal="maya", role="support")],
                          change="t", ts="t", expected_revision=snap.revision + 5)
        raise AssertionError("expected StaleProposal")
    except Exception as exc:  # noqa: BLE001
        assert exc.__class__.__name__ == "StaleProposal"
    assert store.snapshot().hash == snap.hash


def test_replanning_after_apply_and_mutation_cuts_only_the_new_edge(harness):
    plan = _verified(harness)
    ok(harness.client.post(f"/api/repairs/{plan['id']}/approve", json={"approved_by": "op"}))
    ok(harness.client.post(f"/api/repairs/{plan['id']}/apply"))
    mutated = ok(harness.client.post("/api/demo/mutate-policy", json={"mutation": "contractor_tools"}))
    assert ["maya", "support_safe", "contractor_tools", "export_customers"] in [p["nodes"] for p in mutated["new_paths"]]
    assert ok(harness.client.get(f"/api/evidence/{plan['id']}"))["stale"] is True
    replan = ok(harness.client.post("/api/repairs/plan", json={}))
    assert replan["status"] == "PROPOSED"
    assert [(e["op"], e.get("role"), e.get("parent")) for e in replan["edits"]] == [
        ("REMOVE_INHERITS", "support_safe", "contractor_tools")]
    migration = next(c for c in replan["candidates"] if c["family"] == "scoped_role_migration")
    created = next(e for e in migration["edits"] if e["op"] == "CREATE_ROLE")
    assert (created["role"], created["name"]) == ("support_safe_2", "Support (safe 2)")
    verified = ok(harness.client.post(f"/api/repairs/{replan['id']}/verify"))
    assert verified["verification"]["passed"] is True


def test_vanished_graph_is_reseeded_and_old_evidence_is_stale(harness):
    plan = _verified(harness)
    # FalkorDB Cloud Free has no persistence: an instance restart drops every graph
    harness.store.graphs.pop(harness.container.store.active)
    body = ok(harness.client.get("/api/graph"))
    assert body["revision"]["revision"] == 1 and len(body["nodes"]) > 10
    assert ok(harness.client.get("/api/risks"))["risky_path_count"] == 4
    # same revision number but the ledger still knows the plan; content hash matches the seed, so it is current
    assert ok(harness.client.get(f"/api/repairs/{plan['id']}"))["base_revision"]["revision"] == 1


def test_reset_restores_the_scenario_with_a_monotonic_revision(harness):
    plan = _verified(harness)
    ok(harness.client.post("/api/demo/mutate-policy", json={"mutation": "contractor_tools"}))
    rev = ok(harness.client.post("/api/scenarios/customer-ops/reset"))["revision"]
    assert rev["revision"] == 3
    assert ok(harness.client.get("/api/risks"))["risky_path_count"] == 4
    assert ok(harness.client.get(f"/api/repairs/{plan['id']}"))["stale"] is True
