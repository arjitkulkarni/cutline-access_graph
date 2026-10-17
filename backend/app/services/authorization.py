"""Policy decision point for the synthetic Customer Ops API.

Deliberately independent of the analyzer and planner: it reads only one-hop relations
(ASSIGNED_TO, INHERITS, GRANTS) from the selected FalkorDB graph and decides with its own engine.
A planner or path-query bug therefore shows up as a graph/runtime disagreement instead of being
silently "verified" by the same code that produced it.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass

import httpx

from ..config import Settings
from ..db.graph_store import GraphStore
from ..errors import AuthzEngineUnavailable

Relations = list[tuple[str, str, str]]  # (type, source, target)


@dataclass
class Decision:
    allow: bool
    engine: str
    decision_id: str
    reached_roles: list[str]
    graph: str


class ReferenceEngine:
    """Fixpoint closure over role inheritance (no depth bound, cycle-safe)."""

    name = "reference"

    def available(self) -> tuple[bool, str | None]:
        return True, None

    def decide(self, relations: Relations, principal: str, capability: str) -> tuple[bool, list[str], str]:
        parents: dict[str, set[str]] = defaultdict(set)
        grants: dict[str, set[str]] = defaultdict(set)
        frontier: list[str] = []
        for kind, source, target in relations:
            if kind == "ASSIGNED_TO" and source == principal:
                frontier.append(target)
            elif kind == "INHERITS":
                parents[source].add(target)
            elif kind == "GRANTS":
                grants[source].add(target)
        reached: set[str] = set()
        while frontier:
            role = frontier.pop()
            if role in reached:
                continue
            reached.add(role)
            frontier.extend(parents[role] - reached)
        allow = any(capability in grants[r] for r in reached)
        return allow, sorted(reached), f"ref-{uuid.uuid4().hex[:12]}"


class OpaEngine:
    """Delegates the decision to Open Policy Agent (policies/cutline_authz.rego)."""

    name = "opa"

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def available(self) -> tuple[bool, str | None]:
        try:
            r = httpx.get(f"{self.base_url}/health", timeout=2.0)
            return r.status_code == 200, None if r.status_code == 200 else f"OPA health returned {r.status_code}"
        except httpx.HTTPError as exc:
            return False, f"OPA unreachable at {self.base_url}: {exc}"

    def decide(self, relations: Relations, principal: str, capability: str) -> tuple[bool, list[str], str]:
        policy = {
            "assignments": [{"user": s, "role": t} for k, s, t in relations if k == "ASSIGNED_TO"],
            "inherits": [{"child": s, "parent": t} for k, s, t in relations if k == "INHERITS"],
            "grants": [{"role": s, "capability": t} for k, s, t in relations if k == "GRANTS"],
        }
        body = {"input": {"principal": principal, "capability": capability, "policy": policy}}
        try:
            r = httpx.post(f"{self.base_url}/v1/data/cutline/authz", json=body, timeout=5.0)
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise AuthzEngineUnavailable(f"OPA decision failed: {exc}") from exc
        payload = r.json()
        result = payload.get("result") or {}
        return (bool(result.get("allow", False)), sorted(result.get("reached_roles") or []),
                payload.get("decision_id") or f"opa-{uuid.uuid4().hex[:12]}")


class PolicyDecisionPoint:
    def __init__(self, store: GraphStore, settings: Settings):
        self.store = store
        if settings.authz_engine == "opa":
            if not settings.opa_url:
                raise AuthzEngineUnavailable("AUTHZ_ENGINE=opa requires OPA_URL.")
            self.engine: ReferenceEngine | OpaEngine = OpaEngine(settings.opa_url)
        else:
            self.engine = ReferenceEngine()

    @property
    def engine_name(self) -> str:
        return self.engine.name

    def decide(self, graph: str, principal: str, capability: str) -> Decision:
        relations = self.store.relations(graph)
        allow, reached, decision_id = self.engine.decide(relations, principal, capability)
        return Decision(allow=allow, engine=self.engine.name, decision_id=decision_id, reached_roles=reached,
                        graph=graph)
