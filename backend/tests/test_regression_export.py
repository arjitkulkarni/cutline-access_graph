import ast
import subprocess
import sys
import threading
import time

import httpx
import pytest
import uvicorn

from app.services.verifier import RuntimeVerifier
from tests.conftest import ok


def _applied(harness):
    plan = ok(harness.client.post("/api/repairs/plan", json={}))
    ok(harness.client.post(f"/api/repairs/{plan['id']}/verify"))
    ok(harness.client.post(f"/api/repairs/{plan['id']}/approve", json={"approved_by": "op"}))
    return ok(harness.client.post(f"/api/repairs/{plan['id']}/apply"))


def test_suite_lists_every_decision_with_provenance(harness):
    plan = _applied(harness)
    suite = ok(harness.client.get(f"/api/regression-tests/{plan['id']}"))
    names = [c["name"] for c in suite["cases"]]
    assert names[:2] == ["test_maya_cannot_export_customers", "test_noah_cannot_export_customers"]
    assert "test_felix_can_export_customers" in names and "test_dsar_bot_can_export_customers" in names
    assert len(suite["cases"]) == 12
    assert all(c["last_result"]["passed"] for c in suite["cases"])
    assert suite["revision"]["revision"] == 2


def test_json_export_is_a_stable_spec(harness):
    plan = _applied(harness)
    r = harness.client.get(f"/api/regression-tests/{plan['id']}/export?format=json")
    assert "attachment" in r.headers["content-disposition"]
    spec = r.json()
    assert spec["format"] == "cutline.regression.v1" and len(spec["cases"]) == 12


@pytest.fixture
def live_server(harness):
    """Serve the (test-double backed) app over real HTTP so the exported pytest file can run."""
    from app.main import create_app
    app = create_app(harness.container)
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="warning", lifespan="off")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    port = server.servers[0].sockets[0].getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    # point runtime verification at the real socket as well
    harness.container.verifier._client = httpx.Client(base_url=base, timeout=20)
    yield base
    server.should_exit = True
    thread.join(timeout=5)


def test_exported_pytest_file_is_valid_and_passes_against_the_running_app(harness, live_server, tmp_path):
    plan = _applied(harness)
    source = harness.client.get(f"/api/regression-tests/{plan['id']}/export?format=pytest").text
    ast.parse(source)
    test_file = tmp_path / f"{plan['id']}_regression_test.py"
    test_file.write_text(source, encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-m", "pytest", str(test_file), "-q", "-p", "no:cacheprovider"],
        capture_output=True, text=True, timeout=120,
        env={**__import__("os").environ, "CUTLINE_BASE_URL": live_server, "CUTLINE_POLICY": "active"},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "12 passed" in result.stdout


def test_exported_tests_fail_when_the_vulnerability_returns(harness, live_server, tmp_path):
    plan = _applied(harness)
    source = harness.client.get(f"/api/regression-tests/{plan['id']}/export?format=pytest").text
    ok(harness.client.post("/api/demo/mutate-policy", json={"mutation": "contractor_tools"}))
    test_file = tmp_path / "regression_test.py"
    test_file.write_text(source, encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-m", "pytest", str(test_file), "-q", "-p", "no:cacheprovider"],
        capture_output=True, text=True, timeout=120,
        env={**__import__("os").environ, "CUTLINE_BASE_URL": live_server, "CUTLINE_POLICY": "active"},
    )
    assert result.returncode == 1 and "test_maya_cannot_export_customers" in result.stdout


def test_real_http_verification_against_a_live_socket(harness, live_server):
    assert isinstance(harness.container.verifier, RuntimeVerifier)
    plan = ok(harness.client.post("/api/repairs/plan", json={}))
    verified = ok(harness.client.post(f"/api/repairs/{plan['id']}/verify"))
    assert verified["verification"]["passed"] is True
