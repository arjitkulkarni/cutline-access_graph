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
def test_production_hides_the_falkordb_host():
    health = unreachable_client(environment="production").get("/api/health").json()
    assert health["falkordb"]["host"] == "[hidden]:1"
    assert "127.0.0.1" not in health["falkordb"]["error"]
    assert "unreachable" in health["falkordb"]["error"]
    r = unreachable_client(environment="production").get("/api/graph")
    assert r.status_code == 503 and "127.0.0.1" not in r.text


def test_development_keeps_the_host_for_debugging():
    health = unreachable_client().get("/api/health").json()
    assert health["falkordb"]["host"] == "127.0.0.1:1"


@pytest.mark.parametrize("environment,leaks", [("production", False), ("development", True)])
def test_unexpected_errors_hide_internals_in_production(environment, leaks):
    container, client = memory_app(environment=environment)

    def boom():
        raise RuntimeError("internal detail: /srv/secret")

    container.analyzer.graph = boom
    r = client.get("/api/graph")
    assert r.status_code == 500 and r.json()["error"]["code"] == "INTERNAL"
    assert ("/srv/secret" in r.text) is leaks


# ---------------------------------------------------------------------- LLM agent guard rails
def _text(text: str):
    return SimpleNamespace(type="text", text=text)


class FakeClaude:
    """Stands in for anthropic.Anthropic: replays scripted responses or raises scripted errors."""

    def __init__(self, script):
        self.script = list(script)
        self.calls: list[dict] = []
        self.options: list[dict] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def with_options(self, **options):
        self.options.append(options)
        return self

    def _create(self, **params):
        self.calls.append(params)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _error(cls, status: int):
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    return cls("scripted", response=httpx2.Response(status, request=request), body=None)


@pytest.fixture
def fake_claude(monkeypatch):
    holder = {}

    def install(script):
        holder["client"] = FakeClaude(script)
        monkeypatch.setattr(anthropic, "Anthropic", lambda **_: holder["client"])
        return holder["client"]

    return install


def test_llm_agent_stops_at_the_time_budget(fake_claude):
    claude = fake_claude([])
    _, client = memory_app(anthropic_api_key="sk-test-not-real", llm_time_budget_s=1.0)
    run = client.post("/api/agent/investigate", json={}).json()
    assert run["stop_reason"] == "time_budget" and claude.calls == []


def test_llm_agent_reports_a_rejected_key_without_leaking_it(fake_claude):
    fake_claude([_error(anthropic.AuthenticationError, 401)])
    _, client = memory_app(anthropic_api_key="sk-test-not-real")
    r = client.post("/api/agent/investigate", json={})
    assert r.status_code == 200
    run = r.json()
    assert run["stop_reason"] == "api_error" and "401" in run["narrative"]
    assert "sk-test" not in r.text


def test_llm_agent_runs_are_capped_per_hour(fake_claude):
    fake_claude([SimpleNamespace(stop_reason="end_turn", content=[_text("first")])])
    _, client = memory_app(anthropic_api_key="sk-test-not-real", llm_runs_per_hour=1)
    assert client.post("/api/agent/investigate", json={}).status_code == 200
    r = client.post("/api/agent/investigate", json={})
    assert r.status_code == 429 and r.json()["error"]["code"] == "RATE_LIMITED"


def test_deterministic_agent_is_not_rate_limited():
    _, client = memory_app(llm_runs_per_hour=1)
    for _ in range(2):
        assert client.post("/api/agent/investigate", json={}).json()["mode"] == "deterministic"
