"""Runtime verification with Open Policy Agent as the enforcement engine.

Run with OPA serving policies/cutline_authz.rego, e.g.:
    opa run --server --addr 127.0.0.1:8181 --set decision_logs.console=true policies/cutline_authz.rego
    CUTLINE_TEST_OPA_URL=http://127.0.0.1:8181 pytest tests/test_opa_engine.py -v
"""

import os

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.container import build_container
from app.main import create_app
from app.services.verifier import RuntimeVerifier
from tests.conftest import ok
from tests.memory_store import MemoryGraphStore

OPA_URL = os.environ.get("CUTLINE_TEST_OPA_URL")


@pytest.fixture
def opa_client():
    if not OPA_URL:
        pytest.skip("set CUTLINE_TEST_OPA_URL to a running OPA server")
    settings = Settings(_env_file=None, falkordb_graph="cutline_opa", authz_engine="opa", opa_url=OPA_URL)
    verifier = RuntimeVerifier(settings)
    container = build_container(settings, store=MemoryGraphStore(settings), verifier=verifier)
    app = create_app(container)
    verifier._client = TestClient(app)
    container.policy.ensure_ready()
    return TestClient(app)


def test_opa_enforces_the_active_policy(opa_client):
    r = opa_client.post("/demo/customers/export", headers={"X-Cutline-Principal": "maya"})
    assert r.status_code == 200 and r.headers["X-Cutline-Engine"] == "opa"
    r = opa_client.get("/demo/orders", headers={"X-Cutline-Principal": "felix"})
    assert r.status_code == 403


def test_verification_with_opa_agrees_with_falkordb_predictions(opa_client):
    plan = ok(opa_client.post("/api/repairs/plan", json={}))
    verified = ok(opa_client.post(f"/api/repairs/{plan['id']}/verify"))
    v = verified["verification"]
    assert v["passed"] is True
    assert {c["engine"] for c in v["checks"]} == {"opa"}
    assert all(c["decision_id"] for c in v["checks"])
    health = opa_client.get("/api/health").json()
    assert health["authz_engine"] == {"name": "opa", "available": True, "detail": None}
