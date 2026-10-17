from __future__ import annotations

import hashlib
import json
from typing import Literal

from pydantic import BaseModel, Field

from .graph import AccessPath, GraphPayload, PolicyRevision
from .policy import Contract

EditOp = Literal[
    "CREATE_ROLE", "ADD_GRANT", "REMOVE_GRANT", "ADD_INHERITS", "REMOVE_INHERITS", "ASSIGN_ROLE", "UNASSIGN_ROLE"
]
Outcome = Literal["PASS", "FAIL_FORBIDDEN_PATH", "FAIL_REQUIRED_WORKFLOW", "FAIL_NEW_PRIVILEGE"]
Family = Literal["single_cut", "multi_cut", "scoped_role_migration"]
RepairStatus = Literal[
    "NO_VIOLATIONS",
    "PROPOSED",
    "INFEASIBLE_WITHIN_BUDGET",
    "VERIFIED",
    "VERIFICATION_FAILED",
    "APPROVED",
    "APPLIED",
    "APPLY_VERIFICATION_FAILED",
]
Decision = Literal["allow", "deny"]

EDIT_WEIGHTS: dict[str, int] = {
    "CREATE_ROLE": 2,
    "ADD_GRANT": 1,
    "REMOVE_GRANT": 1,
    "ADD_INHERITS": 1,
    "REMOVE_INHERITS": 1,
    "ASSIGN_ROLE": 1,
    "UNASSIGN_ROLE": 1,
}


class Edit(BaseModel):
    op: EditOp
    role: str | None = None
    name: str | None = None
    capability: str | None = None
    parent: str | None = None
    principal: str | None = None
    reason: str = ""

    def key(self) -> str:
        """Canonical, reason-independent identity of the edit."""
        parts = [self.op, self.principal or "", self.role or "", self.parent or "", self.capability or ""]
        return ":".join(parts)

    def describe(self) -> str:
        if self.op == "CREATE_ROLE":
            return f"create role {self.role}"
        if self.op == "ADD_GRANT":
            return f"grant {self.capability} to {self.role}"
        if self.op == "REMOVE_GRANT":
            return f"revoke {self.capability} from {self.role}"
        if self.op == "ADD_INHERITS":
            return f"make {self.role} inherit {self.parent}"
        if self.op == "REMOVE_INHERITS":
            return f"detach {self.parent} from {self.role}"
        if self.op == "ASSIGN_ROLE":
            return f"assign {self.principal} to {self.role}"
        return f"remove {self.principal} from {self.role}"


def edits_hash(edits: list[Edit]) -> str:
    canonical = json.dumps([e.key() for e in edits], separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()


class Violation(BaseModel):
    kind: Literal["FORBIDDEN_PATH", "REQUIRED_LOST", "NEW_PRIVILEGE"]
    principal: str
    capability: str
    path: AccessPath | None = None
    broken_by: list[str] = Field(default_factory=list)
    workflow: str | None = None


class CostBreakdown(BaseModel):
    edits: int
    shared_role_penalty: int
    collateral_penalty: int
    total: int
    notes: list[str] = Field(default_factory=list)


class Candidate(BaseModel):
    id: str
    family: Family
    title: str
    edits: list[Edit]
    outcome: Outcome
    violations: list[Violation]
    cost: CostBreakdown
    candidate_graph: str
    isolation: Literal["GRAPH.COPY", "snapshot-replay"]
    eval_ms: float


class AccessMatrixRow(BaseModel):
    principal: str
    capability: str
    before: bool
    after: bool
    expected: Decision | None


class RuntimeCheck(BaseModel):
    id: str
    principal: str
    capability: str
    method: Literal["GET", "POST"]
    path: str
    expected: Decision
    graph_prediction: Decision
    status_code: int
    decision: Decision
    engine: str
    decision_id: str | None
    latency_ms: float
    passed: bool


class Verification(BaseModel):
    id: str
    kind: Literal["candidate", "post_apply"]
    policy_target: str
    graph: str
    revision: PolicyRevision
    started_at: str
    finished_at: str
    passed: bool
    checks: list[RuntimeCheck]
    baseline_checks: list[RuntimeCheck] = Field(default_factory=list)


class Approval(BaseModel):
    approved_by: str
    approved_at: str
    note: str | None = None
    edits_hash: str


class WriteStats(BaseModel):
    nodes_created: int
    relationships_created: int
    relationships_deleted: int
    query_ms: float
    atomic: bool = True


class Application(BaseModel):
    applied_at: str
    from_revision: PolicyRevision
    to_revision: PolicyRevision
    write: WriteStats
    post_apply_verification: Verification | None
    status: Literal["APPLIED", "APPLY_VERIFICATION_FAILED"]


class PlanBudget(BaseModel):
    max_candidates: int
    max_cut_size: int
    max_depth: int
    generated: int
    evaluated: int


class RepairPlan(BaseModel):
    id: str
    status: RepairStatus
    created_at: str
    base_revision: PolicyRevision
    contract: Contract
    candidates: list[Candidate]
    chosen_candidate_id: str | None
    edits: list[Edit]
    access_matrix: list[AccessMatrixRow]
    before_graph: GraphPayload
    after_graph: GraphPayload | None
    budget: PlanBudget
    residual_notes: list[str] = Field(default_factory=list)
    stale: bool = False
    current_revision: PolicyRevision
    verification: Verification | None = None
    approval: Approval | None = None
    application: Application | None = None

    def chosen(self) -> Candidate | None:
        for c in self.candidates:
            if c.id == self.chosen_candidate_id:
                return c
        return None


class PlanRequest(BaseModel):
    contract: Contract | None = None


class ApproveRequest(BaseModel):
    approved_by: str = Field(min_length=1, max_length=80)
    note: str | None = Field(default=None, max_length=500)


class RejectedCandidate(BaseModel):
    id: str
    title: str
    outcome: Outcome
    first_violation: Violation | None


class RemovedPermission(BaseModel):
    principal: str
    capability: str


class PreservedWorkflow(BaseModel):
    workflow: str
    principal: str
    capability: str
    ok: bool


class EvidenceGraphs(BaseModel):
    active: str
    candidate: str | None
    ledger: str


class Evidence(BaseModel):
    repair_id: str
    status: RepairStatus
    stale: bool
    stale_reason: str | None
    base_revision: PolicyRevision
    current_revision: PolicyRevision
    contract: Contract
    edits: list[Edit]
    permissions_removed: list[RemovedPermission]
    workflows_preserved: list[PreservedWorkflow]
    candidate_verification: Verification | None
    post_apply_verification: Verification | None
    approval: Approval | None
    application: Application | None
    rejected_candidates: list[RejectedCandidate]
    graphs: EvidenceGraphs
    generated_at: str


class RegressionResult(BaseModel):
    status_code: int
    decision: Decision
    passed: bool
    target: str


class RegressionCase(BaseModel):
    name: str
    principal: str
    capability: str
    method: Literal["GET", "POST"]
    path: str
    expected: Decision
    expected_status: Literal[200, 403]
    source: str
    last_result: RegressionResult | None = None


class RegressionSuite(BaseModel):
    repair_id: str
    revision: PolicyRevision
    cases: list[RegressionCase]


ActivityKind = Literal[
    "seeded", "planned", "verified", "verification_failed", "approved", "applied", "mutated", "reset"
]


class ActivityEvent(BaseModel):
    id: str
    ts: str
    kind: ActivityKind
    summary: str
    revision: int
    repair_id: str | None = None


class MutateRequest(BaseModel):
    mutation: Literal["contractor_tools", "direct_export_helper"] = "contractor_tools"


class MutateResponse(BaseModel):
    revision: PolicyRevision
    summary: str
    new_paths: list[AccessPath]
