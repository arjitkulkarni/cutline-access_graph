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


def test_api_responses_are_never_cacheable():
    _, client = memory_app()
    for path in ("/health", "/api/health", "/api/graph"):
        assert client.get(path).headers["cache-control"] == "no-store", path


def test_lifespan_starts_without_falkordb_and_closes_connections_on_shutdown():
    settings = Settings(_env_file=None, demo_mode=True, **UNREACHABLE)
    container = build_container(settings)
    _ = container.verifier.client  # open the runtime-verification HTTP client
    resets = []
    original_reset = container.client.reset
    container.client.reset = lambda: (resets.append(True), original_reset())
    with TestClient(create_app(container)) as client:  # runs startup, then shutdown on exit
        assert client.get("/health").status_code == 200
        before_shutdown = len(resets)
    assert container.verifier._client is None
    assert len(resets) == before_shutdown + 1  # the FalkorDB pool was closed by the shutdown hook


# ---------------------------------------------------------------------- CORS
def _preflight(client: TestClient, origin: str):
    return client.options("/api/health", headers={"Origin": origin, "Access-Control-Request-Method": "POST"})


def test_cors_allows_localhost_only_in_development():
    dev = unreachable_client()
    assert _preflight(dev, "http://localhost:3000").headers.get("access-control-allow-origin") == "http://localhost:3000"
    prod = unreachable_client(environment="production")
    assert "access-control-allow-origin" not in _preflight(prod, "http://localhost:3000").headers


def test_cors_honours_configured_origins_and_regex():
    client = unreachable_client(environment="production", cors_origins="https://cutline.vercel.app/",
                                cors_origin_regex=r"^https://cutline-[a-z0-9-]+\.vercel\.app$")
    ok = _preflight(client, "https://cutline.vercel.app")
    assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == "https://cutline.vercel.app"
    assert _preflight(client, "https://cutline-git-feature-x.vercel.app").status_code == 200
    assert "access-control-allow-origin" not in _preflight(client, "https://evil.example").headers
    # simple requests: no wildcard, no credentials
    r = client.get("/health", headers={"Origin": "https://cutline.vercel.app"})
    assert r.headers["access-control-allow-origin"] == "https://cutline.vercel.app"
    assert "access-control-allow-credentials" not in r.headers


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
