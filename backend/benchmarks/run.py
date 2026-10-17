"""CUTLINE benchmark: 10 scenarios, CUTLINE vs. a greedy repair and a direct-grant checker.

    cd backend
    .venv\\Scripts\\python -m benchmarks.run                    # real FalkorDB from backend/.env (publishable)
    .venv\\Scripts\\python -m benchmarks.run --store memory     # test double, development only

Each scenario is loaded into its own graph; every graph it creates is deleted afterwards.
The chosen repair is re-checked by the independent reference engine (unbounded closure over one-hop
relations), never by the planner itself.
"""

from __future__ import annotations

import argparse
import statistics
import time
from pathlib import Path

from app.config import get_settings
from app.container import build_container
from app.db.graph_store import RawGraph
from app.errors import CutlineError
from app.models.policy import ConstraintPair, Contract
from app.models.repair import Edit
from app.services.authorization import ReferenceEngine

from .scenarios import SCENARIOS, Scenario

ENGINE = ReferenceEngine()


def raw_graph(sc: Scenario) -> RawGraph:
    return RawGraph(
        nodes={
            "User": [{"id": u, "name": u, "principal_type": "human"} for u in sc.users],
            "Role": [{"id": r, "name": r, "origin": "bench"} for r in sc.roles],
            "Capability": [{"id": c, "name": c} for c in sc.capabilities],
            "Policy": [{"id": "active", "revision": 1, "updated_at": "bench", "scenario": sc.name,
                        "last_change": "seed"}],
        },
        edges={"ASSIGNED_TO": list(sc.assign), "INHERITS": list(sc.inherits), "GRANTS": list(sc.grants)},
    )


def independent_ok(relations, sc: Scenario) -> bool:
    deny_ok = all(not ENGINE.decide(relations, u, c)[0] for u, c in sc.deny)
    allow_ok = all(ENGINE.decide(relations, u, c)[0] for u, c in sc.allow)
    return deny_ok and allow_ok


def greedy(c, sc: Scenario) -> bool:
    """Baseline: revoke the forbidden capability at the role that grants it on the first path found."""
    found = c.store.pair_paths(list(sc.deny))
    edits, seen = [], set()
    for pair in sc.deny:
        paths = found.get(pair) or []
        if paths:
            role, cap = paths[0].nodes[-2], paths[0].nodes[-1]
            if (role, cap) not in seen:
                seen.add((role, cap))
                edits.append(Edit(op="REMOVE_GRANT", role=role, capability=cap))
    graph = f"{c.store.active}__greedy"
    c.store.materialize_copy(c.store.active, graph)
    try:
        if edits:
            c.store.apply_edits(graph, edits, change="greedy", ts="bench")
        return independent_ok(c.store.relations(graph), sc)
    finally:
        c.store.delete_graph(graph)


def run_one(sc: Scenario, store_kind: str) -> dict:
    graph = f"cutline_bench__{sc.name}"
    settings = get_settings().model_copy(update={"falkordb_graph": graph, "demo_mode": True})
    store = None
    if store_kind == "memory":
        from tests.memory_store import MemoryGraphStore  # development-only test double
        store = MemoryGraphStore(settings)
    c = build_container(settings, store=store)
    try:
        c.store.delete_graph(graph)
        c.store.write_raw(graph, raw_graph(sc))
        c.policy._ready = True  # the scenario graph is the active policy; skip the demo auto-seed
        contract = Contract(must_deny=[ConstraintPair(principal=u, capability=x, source="bench") for u, x in sc.deny],
                            must_allow=[ConstraintPair(principal=u, capability=x, source="bench") for u, x in sc.allow])
        started = time.perf_counter()
        plan = c.repairs.plan(contract)
        plan_ms = round((time.perf_counter() - started) * 1000, 1)
        chosen = plan.chosen()
        verified = independent_ok(c.store.relations(chosen.candidate_graph), sc) if chosen else None
        before = {(r.principal, r.capability): r.before for r in plan.access_matrix}
        relations = c.store.relations(graph)
        disagreement = [p for p in sc.deny if ENGINE.decide(relations, *p)[0] and not before.get(p, False)]
        if sc.expect == "DISAGREEMENT":
            correct = plan.status == "NO_VIOLATIONS" and bool(disagreement)
        elif sc.expect == "PASS":
            correct = (plan.status == "PROPOSED" and bool(verified)
                       and (sc.expect_family is None or chosen.family == sc.expect_family))
        else:
            correct = plan.status == sc.expect
        direct_roles = {(u, r) for u, r in sc.assign}
        direct_hits = sum(1 for u, x in sc.deny if any((u, r) in direct_roles for r, cap in sc.grants if cap == x))
        multi_hop_hits = sum(1 for p in sc.deny if before.get(p, False))
        return {
            "scenario": sc.name, "description": sc.description, "expect": sc.expect, "status": plan.status,
            "family": chosen.family if chosen else "-", "edits": len(plan.edits),
            "candidates": len(plan.candidates), "rejected": sum(1 for x in plan.candidates if x.outcome != "PASS"),
            "independent_check": "-" if verified is None else ("pass" if verified else "FAIL"),
            "disagreement": len(disagreement), "correct": correct, "greedy_safe": greedy(c, sc),
            "direct_detected": direct_hits, "multi_hop_detected": multi_hop_hits,
            "violations_real": sum(1 for p in sc.deny if ENGINE.decide(relations, *p)[0]), "plan_ms": plan_ms,
            "isolation": chosen.isolation if chosen else "-",
        }
    finally:
        for name in c.store.list_graphs():
            if name == graph or name.startswith(graph + "__"):
                c.store.delete_graph(name)


def _public_host(host: str, port: int) -> str:
    """The report is committed publicly: never print a hosted instance's address, only where it runs."""
    if host in ("localhost", "127.0.0.1", "falkordb") or host.startswith("192.168."):
        return f"{host}:{port}"
    region = next((part for part in host.split(".") if part.count("-") == 2 and part[-1].isdigit()), None)
    return f"Cloud ({region})" if region else "Cloud (hosted instance)"


def main() -> int:
    parser = argparse.ArgumentParser(description="CUTLINE benchmark")
    parser.add_argument("--store", choices=["falkordb", "memory"], default="falkordb")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parents[2] / "docs" / "benchmarks.md"))
    args = parser.parse_args()
    s = get_settings()
    target = (f"FalkorDB {_public_host(s.falkordb_host, s.falkordb_port)}" if args.store == "falkordb"
              else "TEST DOUBLE (tests/memory_store.py) — development only, not publishable")
    print(f"Running {len(SCENARIOS)} scenarios against {target}")
    rows = []
    for sc in SCENARIOS:
        try:
            rows.append(run_one(sc, args.store))
        except CutlineError as exc:
            print(f"  {sc.name}: {exc.message}")
            return 2
        r = rows[-1]
        print(f"  {'ok ' if r['correct'] else 'BAD'} {r['scenario']:<28} {r['status']:<26} {r['family']:<22} "
              f"{r['plan_ms']:>8} ms  greedy_safe={r['greedy_safe']}")

    repairable = [r for r in rows if r["expect"] == "PASS"]
    correct = sum(r["correct"] for r in rows)
    safe = sum(r["correct"] for r in repairable)
    greedy_safe = sum(r["greedy_safe"] for r in repairable)
    real = sum(r["violations_real"] for r in rows)
    lines = [
        "# CUTLINE benchmark", "",
        f"Target: **{target}** · scenarios: {len(rows)} · planner budget: max_depth={s.max_depth}, "
        f"max_candidates={s.max_candidates}, max_cut_size={s.max_cut_size}", "",
        "| Metric | CUTLINE | Baseline |", "|---|---|---|",
        f"| Correct outcome (repair / refuse / flag as expected) | **{correct}/{len(rows)}** | — |",
        f"| Safe repair rate on repairable scenarios | **{safe}/{len(repairable)}** | greedy revoke-at-source: "
        f"{greedy_safe}/{len(repairable)} |",
        f"| Forbidden access detected (multi-hop vs direct grants only) | "
        f"{sum(r['multi_hop_detected'] for r in rows)}/{real} | direct-grant checker: "
        f"{sum(r['direct_detected'] for r in rows)}/{real} |",
        f"| Beyond-bound path caught by the independent engine | "
        f"{sum(1 for r in rows if r['disagreement'])} scenario(s) | — |",
        f"| Median planning time | {round(statistics.median(r['plan_ms'] for r in rows), 1)} ms | — |", "",
        "| Scenario | Expected | CUTLINE status | Chosen family | Edits | Candidates (rejected) | Independent check "
        "| Greedy safe | Plan ms |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(f"| `{r['scenario']}` — {r['description']} | {r['expect']} | {r['status']} | {r['family']} | "
                     f"{r['edits']} | {r['candidates']} ({r['rejected']}) | {r['independent_check']} | "
                     f"{'yes' if r['greedy_safe'] else 'no'} | {r['plan_ms']} |")
    lines += ["", "Safe repair = every forbidden pair denied and every required pair allowed, confirmed by the "
              "independent reference engine on the repaired graph. The beyond-bound scenario is reported, not "
              "repaired: the planner's FalkorDB traversal is bounded (MAX_DEPTH) and the unbounded independent "
              "engine flags the disagreement."]
    Path(args.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\ncorrect {correct}/{len(rows)} · safe repairs {safe}/{len(repairable)} vs greedy "
          f"{greedy_safe}/{len(repairable)} · wrote {args.out}")
    return 0 if correct == len(rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
