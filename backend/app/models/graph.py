from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

NodeKind = Literal["user", "role", "capability", "resource"]
EdgeType = Literal["ASSIGNED_TO", "INHERITS", "GRANTS", "ACTS_ON"]
PolicyEdgeType = Literal["ASSIGNED_TO", "INHERITS", "GRANTS"]
POLICY_EDGE_TYPES: tuple[str, ...] = ("ASSIGNED_TO", "INHERITS", "GRANTS")

LABEL_TO_KIND: dict[str, NodeKind] = {
    "User": "user",
    "Role": "role",
    "Capability": "capability",
    "Resource": "resource",
}
KIND_TO_LABEL: dict[str, str] = {v: k for k, v in LABEL_TO_KIND.items()}

PropValue = str | int | float | bool | None


def edge_id(source: str, edge_type: str, target: str) -> str:
    return f"{source}|{edge_type}|{target}"


class GraphNode(BaseModel):
    id: str
    kind: NodeKind
    label: str
    props: dict[str, PropValue] = Field(default_factory=dict)


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    type: EdgeType

    @classmethod
    def of(cls, source: str, edge_type: str, target: str) -> "GraphEdge":
        return cls(id=edge_id(source, edge_type, target), source=source, target=target, type=edge_type)  # type: ignore[arg-type]


class GraphPayload(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class PolicyRevision(BaseModel):
    revision: int
    hash: str
    updated_at: str


class Workflow(BaseModel):
    id: str
    name: str
    requires: list[str]
    performers: list[str]


class Guardrail(BaseModel):
    id: str
    description: str
    forbids: list[str]
    applies_to: list[str]


class GraphResponse(BaseModel):
    revision: PolicyRevision
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    workflows: list[Workflow]
    guardrails: list[Guardrail]
    query_ms: float


class AccessPath(BaseModel):
    nodes: list[str]
    edges: list[PolicyEdgeType]
    edge_ids: list[str]

    @classmethod
    def from_lists(cls, nodes: list[str], edges: list[str]) -> "AccessPath":
        ids = [edge_id(nodes[i], edges[i], nodes[i + 1]) for i in range(len(edges))]
        return cls(nodes=nodes, edges=edges, edge_ids=ids)  # type: ignore[arg-type]

    def key(self) -> tuple[tuple[str, ...], tuple[str, ...]]:
        return tuple(self.nodes), tuple(self.edges)


class PathsRequest(BaseModel):
    principal: str
    capability: str
    max_depth: int | None = Field(default=None, ge=1, le=10)


class PathsResponse(BaseModel):
    principal: str
    capability: str
    allowed: bool
    paths: list[AccessPath]
    cypher: str
    query_ms: float
    revision: PolicyRevision


class CheckRequest(BaseModel):
    principal: str
    capability: str


class CheckResponse(BaseModel):
    principal: str
    capability: str
    allowed: bool
    path_count: int
    witness: AccessPath | None


class RiskFinding(BaseModel):
    principal: str
    capability: str
    guardrail: str | None
    paths: list[AccessPath]


class RisksResponse(BaseModel):
    revision: PolicyRevision
    findings: list[RiskFinding]
    risky_path_count: int
