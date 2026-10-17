from tests.conftest import ok


def _verified(harness):
    plan = ok(harness.client.post("/api/repairs/plan", json={}))
    return ok(harness.client.post(f"/api/repairs/{plan['id']}/verify"))


def test_candidate_verification_hits_the_real_endpoints(harness):
    plan = _verified(harness)
    v = plan["verification"]
    assert plan["status"] == "VERIFIED" and v["passed"] is True
    checks = {c["id"]: c for c in v["checks"]}
    assert checks["maya:export_customers"]["status_code"] == 403
    assert checks["noah:export_customers"]["status_code"] == 403
    assert checks["maya:view_orders"]["status_code"] == 200
    assert checks["noah:generate_reports"]["status_code"] == 200
    assert checks["felix:export_customers"]["status_code"] == 200
    assert checks["dsar_bot:export_customers"]["status_code"] == 200
    assert checks["maya:export_customers"]["path"] == "/demo/customers/export"
    assert all(c["engine"] == "reference" and c["decision_id"] for c in v["checks"])
    # graph prediction (FalkorDB) and runtime decision (independent engine) agree on every check
    assert all(c["graph_prediction"] == c["decision"] for c in v["checks"])


def test_baseline_checks_document_the_unsafe_before_state(harness):
    plan = _verified(harness)
    before = {c["id"]: c for c in plan["verification"]["baseline_checks"]}
    assert before["maya:export_customers"]["status_code"] == 200
    assert plan["verification"]["policy_target"] == f"candidate:{plan['id']}"


def test_apply_requires_verification_and_explicit_approval(harness):
    plan = ok(harness.client.post("/api/repairs/plan", json={}))
    r = harness.client.post(f"/api/repairs/{plan['id']}/apply")
    assert r.status_code == 409 and r.json()["error"]["code"] == "NOT_VERIFIED"
    r = harness.client.post(f"/api/repairs/{plan['id']}/approve", json={"approved_by": "operator"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "NOT_VERIFIED"
    ok(harness.client.post(f"/api/repairs/{plan['id']}/verify"))
    r = harness.client.post(f"/api/repairs/{plan['id']}/apply")
    assert r.status_code == 409 and r.json()["error"]["code"] == "NOT_APPROVED"


def test_failed_verification_blocks_application(harness):
    plan = ok(harness.client.post("/api/repairs/plan", json={}))
    # sabotage the candidate graph: the enforcement point now disagrees with the planner's prediction
    graph = next(c["candidate_graph"] for c in plan["candidates"] if c["id"] == plan["chosen_candidate_id"])
    harness.store.graphs[graph].edges["ASSIGNED_TO"].append(("maya", "export_helper"))
    failed = ok(harness.client.post(f"/api/repairs/{plan['id']}/verify"))
    assert failed["status"] == "VERIFICATION_FAILED" and failed["verification"]["passed"] is False
    bad = next(c for c in failed["verification"]["checks"] if c["id"] == "maya:export_customers")
    assert bad["status_code"] == 200 and bad["passed"] is False
    r = harness.client.post(f"/api/repairs/{plan['id']}/approve", json={"approved_by": "operator"})
    assert r.status_code == 409


def test_full_apply_updates_the_active_policy_with_a_revision_bump(harness):
    plan = _verified(harness)
    ok(harness.client.post(f"/api/repairs/{plan['id']}/approve", json={"approved_by": "Riya (security)"}))
    applied = ok(harness.client.post(f"/api/repairs/{plan['id']}/apply"))
    assert applied["status"] == "APPLIED"
    app_ = applied["application"]
    assert app_["from_revision"]["revision"] == 1 and app_["to_revision"]["revision"] == 2
    assert app_["write"] == {"nodes_created": 1, "relationships_created": 4, "relationships_deleted": 2,
                             "query_ms": app_["write"]["query_ms"], "atomic": True}
    post = app_["post_apply_verification"]
    assert post["kind"] == "post_apply" and post["policy_target"] == "active" and post["passed"] is True
    assert applied["stale"] is False  # evidence is bound to the post-apply revision
    # the active graph now enforces the repair
    r = harness.client.post("/demo/customers/export", headers={"X-Cutline-Principal": "maya"})
    assert r.status_code == 403
    r = harness.client.post("/demo/customers/export", headers={"X-Cutline-Principal": "felix"})
    assert r.status_code == 200
    # the candidate graph is gone once applied
    assert applied["edits"] and not any(
        g.startswith(harness.container.settings.candidate_prefix) for g in harness.store.graphs)
    r = harness.client.post(f"/api/repairs/{plan['id']}/apply")
    assert r.status_code == 409


def test_activity_records_the_lifecycle(harness):
    plan = _verified(harness)
    ok(harness.client.post(f"/api/repairs/{plan['id']}/approve", json={"approved_by": "op"}))
    ok(harness.client.post(f"/api/repairs/{plan['id']}/apply"))
    kinds = [e["kind"] for e in ok(harness.client.get("/api/activity"))["events"]]
    assert {"seeded", "planned", "verified", "approved", "applied"} <= set(kinds)
