"""Stopping FalkorDB must make analysis and repair unavailable — never a silent fallback."""

from fastapi.testclient import TestClient

from app.config import Settings
from app.container import build_container
from app.main import create_app


def test_core_workflow_is_unavailable_without_falkordb():
    # real FalkorClient pointed at a port nothing listens on
    settings = Settings(_env_file=None, falkordb_host="127.0.0.1", falkordb_port=1, falkordb_connect_timeout=1.0,
                        demo_mode=True)
    client = TestClient(create_app(build_container(settings)))
    health = client.get("/api/health").json()
    assert health["falkordb"]["connected"] is False and health["status"] == "degraded"
    assert "unreachable" in health["falkordb"]["error"]
    for method, path, body in [
        ("GET", "/api/graph", None),
        ("GET", "/api/risks", None),
        ("POST", "/api/access/paths", {"principal": "maya", "capability": "export_customers"}),
        ("POST", "/api/repairs/plan", {}),
    ]:
        r = client.request(method, path, json=body)
        assert r.status_code == 503, (path, r.text)
        assert r.json()["error"]["code"] == "FALKORDB_UNAVAILABLE"
    # the protected application fails closed too
    r = client.post("/demo/customers/export", headers={"X-Cutline-Principal": "felix"})
    assert r.status_code == 503
