"""Read-side analysis over the active FalkorDB policy graph."""

from __future__ import annotations

import time

from ..db.graph_store import GraphStore
from ..errors import ValidationFailed
from ..models.graph import (
    AccessPath, CheckRequest, CheckResponse, GraphResponse, PathsRequest, PathsResponse, RiskFinding, RisksResponse,
)
from ..models.policy import PolicySnapshot
from .contract import derive_contract
from .policy_service import PolicyService


class AccessAnalyzer:
    def __init__(self, store: GraphStore, policy: PolicyService):
        self.store = store
        self.policy = policy

    def graph(self) -> GraphResponse:
        started = time.perf_counter()
        snap = self.policy.snapshot()
        payload = snap.payload()
        return GraphResponse(
            revision=snap.revision_model(), nodes=payload.nodes, edges=payload.edges,
            workflows=snap.workflows, guardrails=snap.guardrails,
            query_ms=round((time.perf_counter() - started) * 1000, 1),
        )

    def _check_entities(self, snap: PolicySnapshot, principal: str, capability: str) -> None:
        if principal not in snap.users:
            raise ValidationFailed(f"Unknown principal '{principal}'.")
        if capability not in snap.capabilities:
            raise ValidationFailed(f"Unknown capability '{capability}'.")

    def paths(self, req: PathsRequest) -> PathsResponse:
        snap = self.policy.snapshot()
        self._check_entities(snap, req.principal, req.capability)
        paths, cypher, ms = self.store.paths(req.principal, req.capability, max_depth=req.max_depth)
        return PathsResponse(
            principal=req.principal, capability=req.capability, allowed=bool(paths), paths=paths,
            cypher=cypher, query_ms=ms, revision=snap.revision_model(),
        )

    def check(self, req: CheckRequest) -> CheckResponse:
        snap = self.policy.snapshot()
        self._check_entities(snap, req.principal, req.capability)
        paths, _, _ = self.store.paths(req.principal, req.capability)
        return CheckResponse(principal=req.principal, capability=req.capability, allowed=bool(paths),
                             path_count=len(paths), witness=paths[0] if paths else None)

    def risks(self) -> RisksResponse:
        """Every guardrail violation in the active graph, with all of its access paths."""
        snap = self.policy.snapshot()
        contract = derive_contract(snap)
        pairs = sorted(contract.deny_pairs())
        found = self.store.pair_paths(pairs)
        findings = []
        for c in contract.must_deny:
            paths = found.get(c.pair(), [])
            if paths:
                guardrail = c.source.split(":", 1)[1] if c.source.startswith("guardrail:") else None
                findings.append(RiskFinding(principal=c.principal, capability=c.capability, guardrail=guardrail,
                                            paths=paths))
        return RisksResponse(revision=snap.revision_model(), findings=findings,
                             risky_path_count=sum(len(f.paths) for f in findings))

    def new_paths_for(self, principal: str) -> list[AccessPath]:
        """Forbidden paths that currently exist for one principal (used after a live mutation)."""
        snap = self.policy.snapshot()
        contract = derive_contract(snap)
        pairs = sorted(p for p in contract.deny_pairs() if p[0] == principal)
        found = self.store.pair_paths(pairs)
        return [p for pair in pairs for p in found.get(pair, [])]
