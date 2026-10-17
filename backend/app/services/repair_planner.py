"""Deterministic, bounded, explainable repair planner.

Candidates are generated from the forbidden access paths FalkorDB returns, then each candidate is
applied to its own isolated FalkorDB graph and re-checked with the same reachability queries.
The planner never trusts its own reasoning: a candidate PASSes only if FalkorDB says every
must_deny pair is unreachable, every must_allow pair is reachable, and no new access appeared.
"""

from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from itertools import combinations

from ..config import Settings
from ..db.graph_store import GraphStore
from ..models.graph import AccessPath, GraphPayload
from ..models.policy import Contract, PolicySnapshot
from ..models.repair import (
    EDIT_WEIGHTS, AccessMatrixRow, Candidate, CostBreakdown, Edit, PlanBudget, Violation,
)
from .contract import workflow_for
from .util import now_iso

log = logging.getLogger("cutline.planner")

Edge = tuple[str, str, str]  # (source, type, target)

FAMILY_ORDER = {"single_cut": 0, "multi_cut": 1, "scoped_role_migration": 2}
OP_ORDER = {"UNASSIGN_ROLE": 0, "REMOVE_INHERITS": 1, "REMOVE_GRANT": 2, "CREATE_ROLE": 3, "ADD_GRANT": 4,
            "ASSIGN_ROLE": 5, "ADD_INHERITS": 6}
ROLE_MUTATING_OPS = {"ADD_GRANT", "REMOVE_GRANT", "ADD_INHERITS", "REMOVE_INHERITS"}
REMOVAL_OPS = {"UNASSIGN_ROLE", "REMOVE_INHERITS", "REMOVE_GRANT"}
SHARED_ROLE_PENALTY = 2
COLLATERAL_PENALTY = 3
VIOLATION_ORDER = {"REQUIRED_LOST": 0, "FORBIDDEN_PATH": 1, "NEW_PRIVILEGE": 2}
OUTCOME_FOR = {"REQUIRED_LOST": "FAIL_REQUIRED_WORKFLOW", "FORBIDDEN_PATH": "FAIL_FORBIDDEN_PATH",
               "NEW_PRIVILEGE": "FAIL_NEW_PRIVILEGE"}


@dataclass
class CandidateSpec:
    family: str
    title: str
    edits: list[Edit]
    edit_cost: int = 0
    shared_penalty: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def static_cost(self) -> int:
        return self.edit_cost + self.shared_penalty

    def sort_key(self) -> tuple:
        return (self.static_cost, FAMILY_ORDER[self.family], [OP_ORDER[e.op] for e in self.edits],
                [e.key() for e in self.edits])


@dataclass
class Evaluated:
    candidate: Candidate
    access_after: set[tuple[str, str]]


@dataclass
class PlanOutcome:
    status: str
    candidates: list[Candidate]
    chosen: Candidate | None
    access_matrix: list[AccessMatrixRow]
    after_graph: GraphPayload | None
    budget: PlanBudget
    residual_notes: list[str]
    baseline_access: set[tuple[str, str]]


def path_edges(path: AccessPath) -> list[Edge]:
    return [(path.nodes[i], path.edges[i], path.nodes[i + 1]) for i in range(len(path.edges))]


def closure_reach(edges: set[Edge], principal: str) -> set[str]:
    """Planner-side heuristic reachability (generation only — evaluation always uses FalkorDB)."""
    frontier = [d for (s, t, d) in edges if t == "ASSIGNED_TO" and s == principal]
    seen: set[str] = set()
    while frontier:
        role = frontier.pop()
        if role in seen:
            continue
        seen.add(role)
        frontier.extend(d for (s, t, d) in edges if t == "INHERITS" and s == role)
    return {d for (s, t, d) in edges if t == "GRANTS" and s in seen}


class RepairPlanner:
    def __init__(self, store: GraphStore, settings: Settings):
        self.store = store
        self.settings = settings

    # ------------------------------------------------------------------ naming helpers
    @staticmethod
    def _name(snap: PolicySnapshot, node_id: str) -> str:
        node = snap.nodes.get(node_id)
        return node.label if node else node_id

    def _removal(self, edge: Edge, reason: str) -> Edit:
        s, t, d = edge
        if t == "ASSIGNED_TO":
            return Edit(op="UNASSIGN_ROLE", principal=s, role=d, reason=reason)
        if t == "INHERITS":
            return Edit(op="REMOVE_INHERITS", role=s, parent=d, reason=reason)
        return Edit(op="REMOVE_GRANT", role=s, capability=d, reason=reason)

    def _edge_title(self, snap: PolicySnapshot, edge: Edge) -> str:
        s, t, d = edge
        n = lambda x: self._name(snap, x)  # noqa: E731
        if t == "ASSIGNED_TO":
            return f"Remove {n(s)} from {n(d)}"
        if t == "INHERITS":
            return f"Detach {n(d)} from {n(s)}"
        return f"Revoke {d} from {n(s)}"

    def _cost(self, snap: PolicySnapshot, edits: list[Edit], subjects: set[str]) -> tuple[int, int, list[str]]:
        edit_cost = sum(EDIT_WEIGHTS[e.op] for e in edits)
        created = {e.role for e in edits if e.op == "CREATE_ROLE"}
        penalty, notes = 0, []
        for e in edits:
            if e.op in ROLE_MUTATING_OPS and e.role not in created:
                outside = snap.role_holders(e.role or "") - subjects
                if outside:
                    penalty += SHARED_ROLE_PENALTY
                    names = ", ".join(self._name(snap, p) for p in sorted(outside))
                    notes.append(f"'{e.describe()}' changes {self._name(snap, e.role or '')}, which {names} also rely on")
        return edit_cost, penalty, notes

    # ------------------------------------------------------------------ generation
    def generate(
        self,
        snap: PolicySnapshot,
        contract: Contract,
        forbidden_paths: dict[tuple[str, str], list[AccessPath]],
        baseline_access: set[tuple[str, str]],
    ) -> tuple[list[CandidateSpec], int]:
        subjects = contract.subjects()
        all_paths = [p for paths in forbidden_paths.values() for p in paths]
        path_sets = [set(path_edges(p)) for p in all_paths]
        union = sorted({e for ps in path_sets for e in ps})

        def hits_all(edges: set[Edge]) -> bool:
            return all(edges & ps for ps in path_sets)

        def cut_reason(edge: Edge) -> str:
            cut = [p for p in all_paths if edge in path_edges(p)]
            first = " → ".join(self._name(snap, x) for x in cut[0].nodes)
            more = f" and {len(cut) - 1} more" if len(cut) > 1 else ""
            return f"Cuts {first}{more}"

        specs: list[CandidateSpec] = []
        # single cuts: every role-level edge on a forbidden path (assignment edges only if they fix everything)
        for edge in union:
            if edge[1] == "ASSIGNED_TO" and not hits_all({edge}):
                continue
            specs.append(CandidateSpec("single_cut", self._edge_title(snap, edge),
                                       [self._removal(edge, cut_reason(edge))]))
        # minimal hitting sets of size 2..max_cut_size
        for k in range(2, self.settings.max_cut_size + 1):
            for combo in combinations(union, k):
                chosen = set(combo)
                if not hits_all(chosen):
                    continue
                if any(hits_all(set(sub)) for sub in combinations(combo, k - 1)):
                    continue  # not minimal
                specs.append(CandidateSpec("multi_cut", " + ".join(self._edge_title(snap, e) for e in combo),
                                           [self._removal(e, cut_reason(e)) for e in combo]))
        specs.extend(self._migrations(snap, contract, forbidden_paths, baseline_access))

        for spec in specs:
            spec.edit_cost, spec.shared_penalty, spec.notes = self._cost(snap, spec.edits, subjects)
        specs.sort(key=CandidateSpec.sort_key)
        generated = len(specs)
        budget = self.settings.max_candidates
        if len(specs) > budget:
            migrations = [s for s in specs if s.family == "scoped_role_migration"]
            cuts = [s for s in specs if s.family != "scoped_role_migration"][: max(0, budget - len(migrations))]
            log.info("candidate budget: kept %d of %d (all %d migrations kept)", budget, generated, len(migrations))
            specs = sorted(cuts + migrations, key=CandidateSpec.sort_key)[:budget]
        return specs, generated

    def _migrations(
        self,
        snap: PolicySnapshot,
        contract: Contract,
        forbidden_paths: dict[tuple[str, str], list[AccessPath]],
        baseline_access: set[tuple[str, str]],
    ) -> list[CandidateSpec]:
        """Move the contract's subjects to new least-privilege role(s) that keep everything else they had."""
        deny = contract.deny_pairs()
        violators = sorted({u for (u, _), paths in forbidden_paths.items() if paths})
        entries: dict[str, list[str]] = {}
        for (u, _), paths in forbidden_paths.items():
            for p in paths:
                entries.setdefault(u, [])
                if p.nodes[1] not in entries[u]:
                    entries[u].append(p.nodes[1])
        groups: dict[tuple[frozenset[str], tuple[str, ...]], list[str]] = {}
        for u in violators:
            entry_roles = sorted(entries.get(u, []))
            remaining = {e for e in snap.policy_edges if not (e[0] == u and e[1] == "ASSIGNED_TO" and e[2] in entry_roles)}
            keep = {c for (p, c) in baseline_access if p == u} - {c for (p, c) in deny if p == u}
            lost = keep - closure_reach(remaining, u)
            groups.setdefault((frozenset(lost), tuple(entry_roles)), []).append(u)

        specs: list[CandidateSpec] = []
        taken = set(snap.nodes)
        edits: list[Edit] = []
        title_parts: list[str] = []
        for (lost, entry_roles), members in sorted(groups.items(), key=lambda kv: (sorted(kv[0][1]), sorted(kv[1]))):
            # derive from the role's stem so a second round yields support_safe_2, not support_safe_safe
            base = re.sub(r"(_safe)+(_\d+)?$", "", entry_roles[0]) if len(entry_roles) == 1 else "scoped"
            role_id, n = f"{base}_safe", 2
            while role_id in taken:
                role_id, n = f"{base}_safe_{n}", n + 1
            taken.add(role_id)
            people = ", ".join(self._name(snap, m) for m in members)
            entry_names = " and ".join(self._name(snap, r) for r in entry_roles)
            if lost:
                suffix = "safe" if role_id.endswith("_safe") else f"safe {role_id.rsplit('_', 1)[-1]}"
                role_name = f"{self._name(snap, base)} ({suffix})" if base != "scoped" else f"Scoped ({suffix})"
                edits.append(Edit(op="CREATE_ROLE", role=role_id, name=role_name,
                                  reason=f"Least-privilege home for {people}: only what they still need, no route to the forbidden capability"))
                for cap in sorted(lost):
                    wf = next((workflow_for(contract, m, cap) for m in members if workflow_for(contract, m, cap)), None)
                    why = f"preserves the {wf.replace('_', ' ')} workflow" if wf else "preserves access they already had"
                    edits.append(Edit(op="ADD_GRANT", role=role_id, capability=cap,
                                      reason=f"Grant {cap} directly — {why}"))
                for m in members:
                    edits.append(Edit(op="ASSIGN_ROLE", principal=m, role=role_id,
                                      reason=f"Move {self._name(snap, m)} onto the scoped role"))
            for m in members:
                for r in entry_roles:
                    edits.append(Edit(op="UNASSIGN_ROLE", principal=m, role=r,
                                      reason=f"Removes {self._name(snap, m)}'s entry into every forbidden path through {self._name(snap, r)}"))
            title_parts.append(f"Move {people} off {entry_names} to {role_id if lost else 'no role'}")
        if edits:
            specs.append(CandidateSpec("scoped_role_migration", "; ".join(title_parts), edits))
        return specs

    # ------------------------------------------------------------------ evaluation (FalkorDB)
    def _evaluate(
        self,
        repair_id: str,
        index: int,
        spec: CandidateSpec,
        contract: Contract,
        baseline_access: set[tuple[str, str]],
        required_paths: dict[tuple[str, str], list[AccessPath]],
    ) -> Evaluated:
        started = time.perf_counter()
        graph = f"{self.settings.candidate_prefix}{repair_id}__c{index}"
        isolation = self.store.materialize_copy(self.store.active, graph)
        self.store.apply_edits(graph, spec.edits, change=f"candidate {repair_id}/c{index}", ts=now_iso())
        after = self.store.effective_access(graph)

        violations: list[Violation] = []
        still = sorted(p for p in contract.deny_pairs() if p in after)
        new_priv = sorted(after - baseline_access)
        witnesses = self.store.pair_paths(still + new_priv, graph) if (still or new_priv) else {}
        for u, c in still:
            w = witnesses.get((u, c)) or []
            violations.append(Violation(kind="FORBIDDEN_PATH", principal=u, capability=c, path=w[0] if w else None))
        removals = [e for e in spec.edits if e.op in REMOVAL_OPS]
        for u, c in sorted(p for p in contract.allow_pairs() if p not in after):
            baseline_routes = [set(path_edges(p)) for p in required_paths.get((u, c), [])]
            culprits = [e.describe() for e in removals if any(self._edit_edge(e) in route for route in baseline_routes)]
            violations.append(Violation(kind="REQUIRED_LOST", principal=u, capability=c, broken_by=culprits,
                                        workflow=workflow_for(contract, u, c)))
        for u, c in new_priv:
            w = witnesses.get((u, c)) or []
            violations.append(Violation(kind="NEW_PRIVILEGE", principal=u, capability=c, path=w[0] if w else None))
        violations.sort(key=lambda v: (VIOLATION_ORDER[v.kind], v.principal, v.capability))

        collateral = sorted(baseline_access - after - contract.deny_pairs() - contract.allow_pairs())
        notes = list(spec.notes)
        notes.extend(f"Undeclared access lost: {u} → {c}" for u, c in collateral)
        collateral_penalty = COLLATERAL_PENALTY * len(collateral)
        outcome = OUTCOME_FOR[violations[0].kind] if violations else "PASS"
        candidate = Candidate(
            id=f"c{index}", family=spec.family, title=spec.title, edits=spec.edits, outcome=outcome,  # type: ignore[arg-type]
            violations=violations,
            cost=CostBreakdown(edits=spec.edit_cost, shared_role_penalty=spec.shared_penalty,
                               collateral_penalty=collateral_penalty,
                               total=spec.static_cost + collateral_penalty, notes=notes),
            candidate_graph=graph, isolation=isolation,  # type: ignore[arg-type]
            eval_ms=round((time.perf_counter() - started) * 1000, 1),
        )
        return Evaluated(candidate=candidate, access_after=after)

    @staticmethod
    def _edit_edge(e: Edit) -> Edge:
        if e.op == "UNASSIGN_ROLE":
            return (e.principal or "", "ASSIGNED_TO", e.role or "")
        if e.op == "REMOVE_INHERITS":
            return (e.role or "", "INHERITS", e.parent or "")
        return (e.role or "", "GRANTS", e.capability or "")

    # ------------------------------------------------------------------ orchestration
    def plan(self, repair_id: str, snap: PolicySnapshot, contract: Contract) -> PlanOutcome:
        s = self.settings
        baseline_access = self.store.effective_access()
        violating = sorted(p for p in contract.deny_pairs() if p in baseline_access)
        budget = PlanBudget(max_candidates=s.max_candidates, max_cut_size=s.max_cut_size, max_depth=s.max_depth,
                            generated=0, evaluated=0)
        matrix_before = self._matrix(snap, contract, baseline_access, None)
        if not violating:
            return PlanOutcome("NO_VIOLATIONS", [], None, matrix_before, None, budget, [], baseline_access)

        forbidden_paths = self.store.pair_paths(violating)
        required_paths = self.store.pair_paths(sorted(contract.allow_pairs()))
        specs, generated = self.generate(snap, contract, forbidden_paths, baseline_access)
        budget.generated, budget.evaluated = generated, len(specs)

        evaluated: list[Evaluated] = []
        try:
            with ThreadPoolExecutor(max_workers=max(1, s.candidate_workers)) as pool:
                futures = [pool.submit(self._evaluate, repair_id, i + 1, spec, contract, baseline_access,
                                       required_paths) for i, spec in enumerate(specs)]
                evaluated = [f.result() for f in futures]
        except Exception:
            self._drop([f"{s.candidate_prefix}{repair_id}__c{i + 1}" for i in range(len(specs))])
            raise

        passing = sorted((e for e in evaluated if e.candidate.outcome == "PASS"),
                         key=lambda e: (e.candidate.cost.total, int(e.candidate.id[1:])))
        chosen = passing[0] if passing else None
        self._drop([e.candidate.candidate_graph for e in evaluated if chosen is None or e is not chosen])

        notes: list[str] = []
        unmet_before = sorted(p for p in contract.allow_pairs() if p not in baseline_access)
        notes.extend(f"Requirement {u} → {c} is not satisfied by the current policy; CUTLINE removes access and "
                     "never invents new grants, so it cannot be met." for u, c in unmet_before)
        after_graph = None
        if chosen is not None:
            after_graph = self.store.snapshot(chosen.candidate.candidate_graph).payload()
            notes.extend(self._residual(snap, contract, after_graph, chosen.candidate.edits))
        status = "PROPOSED" if chosen else "INFEASIBLE_WITHIN_BUDGET"
        if not chosen and generated > len(specs):
            notes.append(f"Search budget reached: evaluated {len(specs)} of {generated} generated candidates.")
        return PlanOutcome(
            status=status,
            candidates=[e.candidate for e in evaluated],
            chosen=chosen.candidate if chosen else None,
            access_matrix=self._matrix(snap, contract, baseline_access, chosen.access_after if chosen else None),
            after_graph=after_graph,
            budget=budget,
            residual_notes=notes,
            baseline_access=baseline_access,
        )

    def _drop(self, graphs: list[str]) -> None:
        for g in graphs:
            try:
                self.store.delete_graph(g)
            except Exception as exc:  # noqa: BLE001 — cleanup must not mask the real result
                log.warning("could not delete candidate graph %s: %s", g, exc)

    @staticmethod
    def _matrix(snap: PolicySnapshot, contract: Contract, before: set[tuple[str, str]],
                after: set[tuple[str, str]] | None) -> list[AccessMatrixRow]:
        deny, allow = contract.deny_pairs(), contract.allow_pairs()
        rows = []
        for u in snap.users:
            for c in snap.capabilities:
                expected = "deny" if (u, c) in deny else "allow" if (u, c) in allow else None
                rows.append(AccessMatrixRow(principal=u, capability=c, before=(u, c) in before,
                                            after=((u, c) in after) if after is not None else (u, c) in before,
                                            expected=expected))  # type: ignore[arg-type]
        return rows

    def _residual(self, snap: PolicySnapshot, contract: Contract, after_graph: GraphPayload,
                  chosen_edits: list[Edit]) -> list[str]:
        """Roles the subjects were moved off that still lead to a forbidden capability, and who holds them."""
        edges = {(e.source, e.type, e.target) for e in after_graph.edges if e.type != "ACTS_ON"}
        forbidden_caps = sorted({c for (_, c) in contract.deny_pairs()})
        left_roles = sorted({e.role for e in chosen_edits if e.op == "UNASSIGN_ROLE" and e.role})
        notes = []
        for role in left_roles:
            seen: set[str] = set()
            stack = [role]
            while stack:
                r = stack.pop()
                if r not in seen:
                    seen.add(r)
                    stack.extend(d for (s, t, d) in edges if t == "INHERITS" and s == r)
            risky = [c for c in forbidden_caps if any((r, "GRANTS", c) in edges for r in seen)]
            holders = sorted(s for (s, t, d) in edges if t == "ASSIGNED_TO" and d == role)
            if risky and holders:
                names = ", ".join(self._name(snap, h) for h in holders)
                notes.append(f"{self._name(snap, role)} still reaches {', '.join(risky)} and is now held only by "
                             f"{names}. Anyone newly assigned to it inherits that access — review before reuse.")
        return notes
