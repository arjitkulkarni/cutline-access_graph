"""Production behaviour: probes, CORS by environment, no internals in responses, the LLM agent's guard rails."""

from __future__ import annotations

from types import SimpleNamespace

import anthropic
import httpx2
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.container import build_container
from app.main import create_app
from app.services.verifier import RuntimeVerifier
from tests.memory_store import MemoryGraphStore

UNREACHABLE = {"falkordb_host": "127.0.0.1", "falkordb_port": 1, "falkordb_connect_timeout": 1.0}


def memory_app(**overrides):
    settings = Settings(_env_file=None, falkordb_graph="cutline_test", demo_mode=True, authz_engine="reference",
                        **overrides)
    store = MemoryGraphStore(settings)
    container = build_container(settings, store=store, verifier=RuntimeVerifier(settings))
    app = create_app(container)
    container.verifier._client = TestClient(app)
    container.policy.ensure_ready()
    return container, TestClient(app, raise_server_exceptions=False)


def unreachable_client(**overrides) -> TestClient:
    settings = Settings(_env_file=None, demo_mode=True, **UNREACHABLE, **overrides)
    return TestClient(create_app(build_container(settings)))


# ---------------------------------------------------------------------- probes
def test_liveness_does_not_need_falkordb():
    r = unreachable_client().get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_readiness_reports_falkordb():
    r = unreachable_client().get("/ready")
    assert r.status_code == 503 and r.json()["falkordb"]["connected"] is False
    _, client = memory_app()
    r = client.get("/ready")
    assert r.status_code == 200 and r.json()["status"] == "ready"


# ---------------------------------------------------------------------- no internals in production
@pytest.mark.parametrize("environment,leaks", [("production", False), ("development", True)])
def test_unexpected_errors_hide_internals_in_production(environment, leaks):
    container, client = memory_app(environment=environment)

    def boom():
        raise RuntimeError("internal detail: /srv/secret")

    container.analyzer.graph = boom
    r = client.get("/api/graph")
    assert r.status_code == 500 and r.json()["error"]["code"] == "INTERNAL"
    assert ("/srv/secret" in r.text) is leaks
