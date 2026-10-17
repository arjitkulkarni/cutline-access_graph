from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import BaseModel, Field

from .graph import GraphEdge, GraphNode, GraphPayload, Guardrail, PolicyRevision, Workflow


class ConstraintPair(BaseModel):
    principal: str
    capability: str
    source: str = "operator"

    def pair(self) -> tuple[str, str]:
        return self.principal, self.capability


class Contract(BaseModel):
    must_deny: list[ConstraintPair] = Field(default_factory=list)
    must_allow: list[ConstraintPair] = Field(default_factory=list)

    def deny_pairs(self) -> set[tuple[str, str]]:
        return {c.pair() for c in self.must_deny}

    def allow_pairs(self) -> set[tuple[str, str]]:
        return {c.pair() for c in self.must_allow}

    def subjects(self) -> set[str]:
        """Principals whose access the contract asks CUTLINE to cut."""
        return {c.principal for c in self.must_deny}


class ParseRequest(BaseModel):
    text: str = Field(min_length=3, max_length=2000)


class ParseResponse(BaseModel):
    contract: Contract
    notes: list[str]
    unresolved: list[str]
    parser: str


@dataclass
class PolicySnapshot:
    """A point-in-time read of one policy graph from FalkorDB."""

    graph: str
    nodes: dict[str, GraphNode]
    policy_edges: set[tuple[str, str, str]]  # (source, type, target) for ASSIGNED_TO/INHERITS/GRANTS
    resource_edges: set[tuple[str, str, str]]  # ACTS_ON
    workflows: list[Workflow] = field(default_factory=list)
    guardrails: list[Guardrail] = field(default_factory=list)
    revision: int = 0
    updated_at: str = ""
    hash: str = ""

    # ---- typed views -------------------------------------------------
    def ids(self, kind: str) -> list[str]:
        return sorted(n.id for n in self.nodes.values() if n.kind == kind)

    @property
    def users(self) -> list[str]:
        return self.ids("user")

    @property
    def roles(self) -> list[str]:
        return self.ids("role")

    @property
    def capabilities(self) -> list[str]:
        return self.ids("capability")

    def edges_of(self, edge_type: str) -> list[tuple[str, str]]:
        return sorted((s, t) for (s, ty, t) in self.policy_edges if ty == edge_type)

    def has_edge(self, source: str, edge_type: str, target: str) -> bool:
        return (source, edge_type, target) in self.policy_edges

    def assigned_roles(self, principal: str) -> list[str]:
        return sorted(t for (s, ty, t) in self.policy_edges if ty == "ASSIGNED_TO" and s == principal)

    def parents(self, role: str) -> list[str]:
        return sorted(t for (s, ty, t) in self.policy_edges if ty == "INHERITS" and s == role)

    def children(self, role: str) -> list[str]:
        return sorted(s for (s, ty, t) in self.policy_edges if ty == "INHERITS" and t == role)

    def grants(self, role: str) -> list[str]:
        return sorted(t for (s, ty, t) in self.policy_edges if ty == "GRANTS" and s == role)

    def role_holders(self, role: str) -> set[str]:
        """Principals that reach `role` through an assignment plus any INHERITS chain."""
        holders: set[str] = set()
        seen: set[str] = set()
        stack = [role]
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            holders.update(s for (s, ty, t) in self.policy_edges if ty == "ASSIGNED_TO" and t == current)
            stack.extend(self.children(current))
        return holders

    def payload(self) -> GraphPayload:
        edges = [GraphEdge.of(s, ty, t) for (s, ty, t) in sorted(self.policy_edges | self.resource_edges)]
        return GraphPayload(nodes=sorted(self.nodes.values(), key=lambda n: (n.kind, n.id)), edges=edges)

    def revision_model(self) -> PolicyRevision:
        return PolicyRevision(revision=self.revision, hash=self.hash, updated_at=self.updated_at)
