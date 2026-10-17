from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.container import Container, build_container
from app.main import create_app
from app.services.verifier import RuntimeVerifier
from tests.memory_store import MemoryGraphStore


@dataclass
class Harness:
    container: Container
    client: TestClient
    store: MemoryGraphStore


@pytest.fixture
def settings() -> Settings:
    return Settings(_env_file=None, falkordb_graph="cutline_test", demo_mode=True, authz_engine="reference")


@pytest.fixture
def harness(settings: Settings) -> Harness:
    store = MemoryGraphStore(settings)
    verifier = RuntimeVerifier(settings)
    container = build_container(settings, store=store, verifier=verifier)
    app = create_app(container)
    # unit tests drive the synthetic app in-process; the FalkorDB integration test uses real HTTP
    verifier._client = TestClient(app)
    container.policy.ensure_ready()
    return Harness(container=container, client=TestClient(app), store=store)


def ok(response):
    assert response.status_code == 200, response.text
    return response.json()
