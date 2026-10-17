"""Smoke-test a FalkorDB endpoint against every Cypher shape CUTLINE depends on.

    cd backend
    .venv\\Scripts\\python -m scripts.falkordb_smoke        (reads FALKORDB_* from backend/.env)

Uses a throw-away graph, prints PASS/FAIL per check, deletes everything it created.
"""

from __future__ import annotations

import sys
import time
import uuid

from app.config import get_settings
from app.container import build_container
from app.errors import CutlineError, StaleProposal
from app.models.repair import Edit


def main() -> int:
    base = get_settings()
    graph = f"cutline_smoke_{uuid.uuid4().hex[:6]}"
    settings = base.model_copy(update={"falkordb_graph": graph})
    c = build_container(settings)
    failures = 0

    def check(name: str, fn) -> None:
        nonlocal failures
        started = time.perf_counter()
        try:
            detail = fn()
            print(f"  PASS  {name:<48} {round((time.perf_counter() - started) * 1000):>5} ms  {detail or ''}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"  FAIL  {name:<48} {exc.__class__.__name__}: {exc}")

    print(f"FalkorDB {base.falkordb_host}:{base.falkordb_port}  tls={base.falkordb_tls}  scratch graph={graph}")
    try:
        latency = c.store.ping()
    except CutlineError as exc:
        print(f"  FAIL  connect: {exc.message}")
        return 2
    print(f"  PASS  connect / PING ({latency} ms)")
    try:
        mods = c.client.db().connection.info("modules").get("modules", [])
        ver = next((m.get("ver") for m in mods if m.get("name") == "graph"), None)
        print(f"  INFO  graph module version: {ver} ({'Rust 6.x' if ver and ver >= 60000 else 'C 4.x'})")
    except Exception as exc:  # noqa: BLE001
        print(f"  INFO  could not read module version: {exc}")

    try:
        check("seed scenario (UNWIND create, indexes, constraints)", lambda: c.policy.ensure_ready())
        check("snapshot (labels(n), properties(n), type(r))",
              lambda: f"{len(c.store.snapshot().nodes)} nodes, revision {c.store.snapshot().revision}")
        check("bounded paths [:INHERITS*0..6] + list comprehension",
              lambda: [" → ".join(p.nodes) for p in c.store.paths("maya", "export_customers")[0]])
        check("zero-hop direct grant", lambda: c.store.paths("maya", "view_orders")[0][0].nodes)
        check("batched pair paths (UNWIND $pairs)",
              lambda: {k: len(v) for k, v in c.store.pair_paths([("maya", "export_customers"),
                                                                  ("felix", "export_customers")]).items()})
        check("effective access DISTINCT", lambda: f"{len(c.store.effective_access())} pairs")
        cand = f"{graph}__cand__smoke"
        check("GRAPH.COPY isolation", lambda: c.store.materialize_copy(graph, cand))
        check("composite unguarded write on copy",
              lambda: c.store.apply_edits(cand, [Edit(op="CREATE_ROLE", role="smoke_safe", name="Smoke"),
                                                Edit(op="ADD_GRANT", role="smoke_safe", capability="view_orders"),
                                                Edit(op="ASSIGN_ROLE", principal="maya", role="smoke_safe"),
                                                Edit(op="UNASSIGN_ROLE", principal="maya", role="support")],
                                          change="smoke", ts="t"))
        def active_untouched():
            if not c.store.paths("maya", "export_customers")[0]:
                raise AssertionError("candidate write leaked into the active graph")
            return "ok"

        check("active graph untouched by candidate write", active_untouched)

        def stale_guard():
            rev = c.store.snapshot().revision
            try:
                c.store.apply_edits(graph, [Edit(op="UNASSIGN_ROLE", principal="maya", role="support")],
                                    change="smoke", ts="t", expected_revision=rev + 9)
            except StaleProposal:
                return "refused, nothing written"
            raise AssertionError("guard did not fire")

        check("revision compare-and-set guard", stale_guard)
        check("one-hop relations for the enforcement point", lambda: f"{len(c.store.relations(graph))} relations")
        check("full plan (candidates on isolated graphs)",
              lambda: (lambda p: f"{p.status}, chosen={p.chosen_candidate_id}, "
                                 f"{len(p.candidates)} candidates")(c.repairs.plan(None)))
        check("ledger graph round trip", lambda: f"{len(c.ledger.list(5))} repairs, {len(c.ledger.events(5))} events")
    finally:
        try:
            for name in c.store.list_graphs():
                if name == graph or name.startswith(graph + "__"):
                    c.store.delete_graph(name)
            print(f"cleaned up graphs with prefix {graph}")
        except CutlineError as exc:
            print(f"  cleanup skipped: {exc.message}")
    print("ALL CHECKS PASSED" if failures == 0 else f"{failures} CHECK(S) FAILED")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
