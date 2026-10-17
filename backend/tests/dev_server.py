"""TEST TOOLING ONLY — serve the real API on the in-memory test double for UI contract checks.

    cd backend
    .venv\\Scripts\\python -m tests.dev_server --port 8000

This exists so the console can be exercised end-to-end against the real FastAPI routes when no FalkorDB is
reachable from a development machine. It is not part of the application: the app itself has no fallback and
returns 503 when FalkorDB is down. /api/health reports this server's FalkorDB host as "memory-test-double".
"""

from __future__ import annotations

import argparse

import uvicorn

from app.config import Settings
from app.container import build_container
from app.main import create_app
from app.services.verifier import RuntimeVerifier
from tests.memory_store import MemoryGraphStore


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    settings = Settings(_env_file=None, falkordb_host="memory-test-double", falkordb_port=0,
                        falkordb_graph="cutline_dev", demo_mode=True, backend_port=args.port)
    store = MemoryGraphStore(settings)
    container = build_container(settings, store=store, verifier=RuntimeVerifier(settings))
    container.policy.ensure_ready()
    print("WARNING: serving CUTLINE on the in-memory TEST DOUBLE (no FalkorDB). For UI contract checks only.")
    uvicorn.run(create_app(container), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
