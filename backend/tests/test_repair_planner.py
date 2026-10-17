from tests.conftest import ok


def _plan(harness):
    return ok(harness.client.post("/api/repairs/plan", json={}))


def _by_title(plan, prefix):
    return next(c for c in plan["candidates"] if c["title"].startswith(prefix))


def test_naive_shared_role_revocation_is_rejected_because_it_breaks_finance(harness):
    plan = _plan(harness)
    naive = _by_title(plan, "Revoke export_customers from Shared Ops")
    assert naive["outcome"] == "FAIL_REQUIRED_WORKFLOW"
    lost = [v for v in naive["violations"] if v["kind"] == "REQUIRED_LOST"]
    assert [(v["principal"], v["workflow"]) for v in lost] == [("felix", "finance_close")]
    assert lost[0]["broken_by"] == ["revoke export_customers from shared_ops"]
    # and it does not even close the hole: the Export Helper route is still open
    still = [v for v in naive["violations"] if v["kind"] == "FORBIDDEN_PATH"]
    assert still and still[0]["path"]["nodes"][2] == "export_helper"


def test_detaching_one_bundle_leaves_the_other_path_open(harness):
    plan = _plan(harness)
    detach = _by_title(plan, "Detach Shared Ops from Support")
    assert detach["outcome"] == "FAIL_FORBIDDEN_PATH"
    assert detach["violations"][0]["path"]["nodes"] == ["maya", "support", "export_helper", "export_customers"]


def test_detaching_both_bundles_breaks_dsar_fulfilment(harness):
    plan = _plan(harness)
    both = next(c for c in plan["candidates"] if c["family"] == "multi_cut"
                and {e["op"] for e in c["edits"]} == {"REMOVE_INHERITS"})
    assert both["outcome"] == "FAIL_REQUIRED_WORKFLOW"
    assert {(v["principal"], v["workflow"]) for v in both["violations"]} == {("dsar_bot", "dsar_fulfilment")}


def test_structural_migration_is_the_chosen_repair(harness):
    plan = _plan(harness)
    assert plan["status"] == "PROPOSED"
    chosen = next(c for c in plan["candidates"] if c["id"] == plan["chosen_candidate_id"])
    assert chosen["family"] == "scoped_role_migration" and chosen["outcome"] == "PASS"
    assert [(e["op"], e.get("principal"), e.get("role"), e.get("capability")) for e in plan["edits"]] == [
        ("CREATE_ROLE", None, "support_safe", None),
        ("ADD_GRANT", None, "support_safe", "generate_reports"),
        ("ADD_GRANT", None, "support_safe", "view_orders"),
        ("ASSIGN_ROLE", "maya", "support_safe", None),
        ("ASSIGN_ROLE", "noah", "support_safe", None),
        ("UNASSIGN_ROLE", "maya", "support", None),
        ("UNASSIGN_ROLE", "noah", "support", None),
    ]
    assert all(e["reason"] for e in plan["edits"])
    assert chosen["cost"]["shared_role_penalty"] == 0
    # every other candidate was evaluated and rejected with a counterexample
    others = [c for c in plan["candidates"] if c["id"] != chosen["id"]]
    assert others and all(c["outcome"] != "PASS" and c["violations"] for c in others)


def test_matrix_shows_support_loses_export_and_nothing_else_changes(harness):
    plan = _plan(harness)
    changed = {(r["principal"], r["capability"]) for r in plan["access_matrix"] if r["before"] != r["after"]}
    assert changed == {("maya", "export_customers"), ("noah", "export_customers")}
    after_edges = {e["id"] for e in plan["after_graph"]["edges"]}
    assert "maya|ASSIGNED_TO|support_safe" in after_edges and "maya|ASSIGNED_TO|support" not in after_edges
    assert any("DSAR Bot" in note for note in plan["residual_notes"])


def test_planning_never_touches_the_active_graph_and_cleans_up_candidates(harness):
    before = harness.container.store.snapshot()
    plan = _plan(harness)
    after = harness.container.store.snapshot()
    assert (before.revision, before.hash) == (after.revision, after.hash)
    remaining = [g for g in harness.store.graphs if g.startswith(harness.container.settings.candidate_prefix)]
    chosen = next(c for c in plan["candidates"] if c["id"] == plan["chosen_candidate_id"])
    assert remaining == [chosen["candidate_graph"]]
    assert harness.store.copies == len(plan["candidates"])


def test_operator_contract_is_merged_with_graph_workflows(harness):
    contract = {"must_deny": [{"principal": "maya", "capability": "export_customers"}], "must_allow": []}
    plan = ok(harness.client.post("/api/repairs/plan", json={"contract": contract}))
    sources = {c["source"] for c in plan["contract"]["must_allow"]}
    assert "workflow:dsar_fulfilment" in sources and "workflow:finance_close" in sources
    assert plan["status"] == "PROPOSED"


def test_contradictory_contract_is_rejected(harness):
    contract = {"must_deny": [{"principal": "felix", "capability": "export_customers"}], "must_allow": []}
    r = harness.client.post("/api/repairs/plan", json={"contract": contract})
    assert r.status_code == 422 and "contradictory" in r.json()["error"]["message"]


def test_unsatisfiable_requirement_returns_infeasible_not_success(harness):
    contract = {"must_deny": [{"principal": "noah", "capability": "export_customers"}],
                "must_allow": [{"principal": "felix", "capability": "view_orders"}]}
    plan = ok(harness.client.post("/api/repairs/plan", json={"contract": contract}))
    assert plan["status"] == "INFEASIBLE_WITHIN_BUDGET"
    assert plan["chosen_candidate_id"] is None and plan["edits"] == []
    assert any("never invents new grants" in n for n in plan["residual_notes"])


def test_planning_is_deterministic(harness):
    a, b = _plan(harness), _plan(harness)
    assert [c["title"] for c in a["candidates"]] == [c["title"] for c in b["candidates"]]
    assert a["edits"] == b["edits"]
