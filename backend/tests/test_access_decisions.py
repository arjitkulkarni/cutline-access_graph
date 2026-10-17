import pytest

from app.services.authorization import ReferenceEngine


@pytest.mark.parametrize("principal,capability,status", [
    ("maya", "view_orders", 200),
    ("maya", "generate_reports", 200),
    ("maya", "export_customers", 200),   # the vulnerability, before repair
    ("felix", "export_customers", 200),
    ("felix", "view_orders", 403),
    ("dsar_bot", "export_customers", 200),
])
def test_enforcement_point_decisions_on_the_active_policy(harness, principal, capability, status):
    method, path = {"view_orders": ("GET", "/demo/orders"), "generate_reports": ("GET", "/demo/reports"),
                    "export_customers": ("POST", "/demo/customers/export")}[capability]
    r = harness.client.request(method, path, headers={"X-Cutline-Principal": principal})
    assert r.status_code == status
    assert r.headers["X-Cutline-Engine"] == "reference"
    assert r.headers["X-Cutline-Decision"] == ("allow" if status == 200 else "deny")
    assert r.headers["X-Cutline-Graph"] == harness.container.store.active


def test_missing_principal_is_forbidden(harness):
    assert harness.client.get("/demo/orders").status_code == 403


def test_policy_selector_only_reaches_cutline_graphs(harness):
    r = harness.client.get("/demo/orders", headers={"X-Cutline-Principal": "maya", "X-Cutline-Policy": "other_graph"})
    assert r.status_code == 422
    r = harness.client.get("/demo/orders", headers={"X-Cutline-Principal": "maya",
                                                    "X-Cutline-Policy": "candidate:rp_deadbeef"})
    assert r.status_code == 404


def test_reference_engine_is_cycle_safe_and_unbounded():
    relations = [("ASSIGNED_TO", "u", "a")] + [("INHERITS", f"r{i}", f"r{i + 1}") for i in range(20)]
    relations += [("INHERITS", "a", "r0"), ("INHERITS", "r20", "a"), ("GRANTS", "r20", "cap")]
    allow, reached, _ = ReferenceEngine().decide(relations, "u", "cap")
    assert allow and "r20" in reached
    allow, _, _ = ReferenceEngine().decide(relations, "u", "other")
    assert not allow


def test_health_reports_engine_and_store(harness):
    body = harness.client.get("/api/health").json()
    assert body["falkordb"]["connected"] is True and body["authz_engine"]["name"] == "reference"
    assert body["demo_mode"] is True
