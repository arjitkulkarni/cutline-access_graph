"""Repair lifecycle: plan → verify (candidate) → approve (human) → apply (guarded) → post-apply verify."""

from __future__ import annotations

import logging
import re

from ..config import Settings
from ..db.graph_store import GraphStore
from ..errors import InvalidState, NotApproved, NotFound, NotVerified, StaleProposal, ValidationFailed
from ..models.policy import Contract, PolicySnapshot
from ..models.repair import (
    Application, Approval, Evidence, EvidenceGraphs, PreservedWorkflow, RejectedCandidate, RemovedPermission,
    RepairPlan, Verification, WriteStats, edits_hash,
)
from .authorization import PolicyDecisionPoint
from .contract import derive_contract, merge_with_graph, validate_contract
from .ledger import Ledger
from .policy_service import PolicyService
from .repair_planner import RepairPlanner
from .util import new_id, now_iso, plural
from .verifier import CheckCase, RuntimeVerifier

log = logging.getLogger("cutline.repairs")
REPAIR_ID = re.compile(r"^rp_[0-9a-f]{8}$")


class RepairService:
    def __init__(self, store: GraphStore, policy: PolicyService, planner: RepairPlanner, verifier: RuntimeVerifier,
                 ledger: Ledger, pdp: PolicyDecisionPoint, settings: Settings):
        self.store = store
        self.policy = policy
        self.planner = planner
        self.verifier = verifier
        self.ledger = ledger
        self.pdp = pdp
        self.settings = settings

    # ------------------------------------------------------------------ staleness
    @staticmethod
    def staleness(plan: RepairPlan, snap: PolicySnapshot) -> tuple[bool, str | None]:
        ref = plan.application.to_revision if plan.application else plan.base_revision
        if snap.revision != ref.revision:
            return True, f"Policy moved from r{ref.revision} to r{snap.revision} after this evidence was produced."
        if snap.hash != ref.hash:
            return True, f"Policy graph content changed outside CUTLINE at r{snap.revision} (hash drift)."
        return False, None

    def _decorate(self, plan: RepairPlan, snap: PolicySnapshot) -> RepairPlan:
        plan.stale, _ = self.staleness(plan, snap)
        plan.current_revision = snap.revision_model()
        return plan

    def _require_current(self, plan: RepairPlan, snap: PolicySnapshot) -> None:
        stale, reason = self.staleness(plan, snap)
        if stale:
            raise StaleProposal(f"{reason} Re-run discovery and plan a fresh repair.",
                                {"base_revision": plan.base_revision.revision, "current_revision": snap.revision})

    # ------------------------------------------------------------------ queries
    def get(self, repair_id: str) -> RepairPlan:
        if not REPAIR_ID.match(repair_id):
            raise NotFound(f"Repair plan '{repair_id}' does not exist.")
        return self._decorate(self.ledger.get(repair_id), self.policy.snapshot())

    def list(self) -> list[RepairPlan]:
        snap = self.policy.snapshot()
        return [self._decorate(p, snap) for p in self.ledger.list()]

    def resolve_policy_target(self, selector: str) -> str:
        """Map X-Cutline-Policy to a graph name. Only CUTLINE-owned graphs are reachable."""
        if selector == "active":
            self.policy.ensure_ready()
            return self.store.active
        if selector.startswith("candidate:"):
            repair_id = selector.split(":", 1)[1]
            if not REPAIR_ID.match(repair_id):
                raise ValidationFailed("Malformed repair id in X-Cutline-Policy.")
            chosen = self.ledger.get(repair_id).chosen()
            if chosen is None or not chosen.candidate_graph.startswith(self.settings.candidate_prefix):
                raise NotFound(f"Repair {repair_id} has no candidate policy.")
            if not self.store.graph_exists(chosen.candidate_graph):
                raise NotFound(f"Candidate graph for {repair_id} no longer exists (applied or cleaned up).")
            return chosen.candidate_graph
        raise ValidationFailed("X-Cutline-Policy must be 'active' or 'candidate:<repair_id>'.")

    # ------------------------------------------------------------------ plan
    def plan(self, contract: Contract | None) -> RepairPlan:
        snap = self.policy.snapshot()
        contract = merge_with_graph(contract, snap) if contract else derive_contract(snap)
        validate_contract(contract, snap)
        repair_id = new_id("rp")
        outcome = self.planner.plan(repair_id, snap, contract)
        plan = RepairPlan(
            id=repair_id, status=outcome.status, created_at=now_iso(),  # type: ignore[arg-type]
            base_revision=snap.revision_model(), contract=contract, candidates=outcome.candidates,
            chosen_candidate_id=outcome.chosen.id if outcome.chosen else None,
            edits=outcome.chosen.edits if outcome.chosen else [],
            access_matrix=outcome.access_matrix, before_graph=snap.payload(), after_graph=outcome.after_graph,
            budget=outcome.budget, residual_notes=outcome.residual_notes, stale=False,
            current_revision=snap.revision_model(),
        )
        self.ledger.save(plan)
        rejected = sum(1 for c in plan.candidates if c.outcome != "PASS")
        if outcome.chosen:
            summary = (f"Planned {repair_id}: {plural(len(plan.edits), 'edit')} chosen, "
                       f"{plural(rejected, 'candidate')} rejected with counterexamples")
        else:
            summary = f"Planned {repair_id}: {outcome.status.replace('_', ' ').lower()}"
        self.ledger.event("planned", summary, snap.revision, repair_id)
        return plan

    # ------------------------------------------------------------------ verify
    def _cases(self, plan: RepairPlan, use_after: bool) -> list[CheckCase]:
        cases = []
        for row in plan.access_matrix:
            if use_after:
                expected = row.expected or ("allow" if row.before else "deny")  # undeclared access must not change
            else:
                expected = "allow" if row.before else "deny"
            cases.append(CheckCase(row.principal, row.capability, expected))  # type: ignore[arg-type]
        return cases

    def _rematerialize(self, plan: RepairPlan) -> str:
        chosen = plan.chosen()
        assert chosen is not None
        self.store.materialize_copy(self.store.active, chosen.candidate_graph)
        self.store.apply_edits(chosen.candidate_graph, plan.edits, change=f"candidate {plan.id} (rebuilt)",
                               ts=now_iso())
        return chosen.candidate_graph

    def verify(self, repair_id: str) -> RepairPlan:
        plan = self.ledger.get(repair_id)
        if plan.status not in ("PROPOSED", "VERIFIED", "VERIFICATION_FAILED") or plan.chosen() is None:
            raise InvalidState(f"Repair {repair_id} is {plan.status}; only proposed repairs can be verified.")
        snap = self.policy.snapshot()
        self._require_current(plan, snap)
        chosen = plan.chosen()
        assert chosen is not None
        graph = chosen.candidate_graph
        if not self.store.graph_exists(graph):
            graph = self._rematerialize(plan)
        started = now_iso()
        predicted_after = self.store.effective_access(graph)
        predicted_before = self.store.effective_access()
        target = f"candidate:{repair_id}"
        checks = self.verifier.run(target, self._cases(plan, use_after=True), predicted_after, self.pdp.engine_name)
        baseline = self.verifier.run("active", self._cases(plan, use_after=False), predicted_before,
                                     self.pdp.engine_name)
        passed = bool(checks) and all(c.passed for c in checks)
        plan.verification = Verification(
            id=new_id("vf"), kind="candidate", policy_target=target, graph=graph, revision=snap.revision_model(),
            started_at=started, finished_at=now_iso(), passed=passed, checks=checks, baseline_checks=baseline,
        )
        plan.status = "VERIFIED" if passed else "VERIFICATION_FAILED"
        plan.approval = None
        self.ledger.save(plan)
        failed = [c.id for c in checks if not c.passed]
        summary = (f"Verified {repair_id}: {len(checks)}/{len(checks)} runtime checks passed" if passed
                   else f"Verification failed for {repair_id}: {', '.join(failed)}")
        self.ledger.event("verified" if passed else "verification_failed", summary, snap.revision, repair_id)
        return self._decorate(plan, snap)

    # ------------------------------------------------------------------ approve / apply
    def approve(self, repair_id: str, approved_by: str, note: str | None) -> RepairPlan:
        plan = self.ledger.get(repair_id)
        if plan.status != "VERIFIED" or not plan.verification or not plan.verification.passed:
            raise NotVerified(f"Repair {repair_id} must pass runtime verification before approval.")
        snap = self.policy.snapshot()
        self._require_current(plan, snap)
        plan.approval = Approval(approved_by=approved_by.strip(), approved_at=now_iso(), note=note,
                                 edits_hash=edits_hash(plan.edits))
        plan.status = "APPROVED"
        self.ledger.save(plan)
        self.ledger.event("approved", f"{approved_by.strip()} approved {repair_id} ({len(plan.edits)} edits)",
                          snap.revision, repair_id)
        return self._decorate(plan, snap)

    def _preflight(self, plan: RepairPlan, snap: PolicySnapshot) -> None:
        """Every edit must apply cleanly to the current graph, so the single guarded write cannot half-apply."""
        roles = set(snap.roles)
        problems = []
        for e in plan.edits:
            if e.op == "CREATE_ROLE":
                if e.role in roles:
                    problems.append(f"role {e.role} already exists")
                roles.add(e.role or "")
            elif e.op in ("ADD_GRANT", "REMOVE_GRANT") and (e.role not in roles or e.capability not in snap.capabilities):
                problems.append(e.describe())
            elif e.op in ("ADD_INHERITS", "REMOVE_INHERITS") and (e.role not in roles or e.parent not in roles):
                problems.append(e.describe())
            elif e.op in ("ASSIGN_ROLE", "UNASSIGN_ROLE") and (e.principal not in snap.users or e.role not in roles):
                problems.append(e.describe())
            if e.op == "REMOVE_GRANT" and not snap.has_edge(e.role or "", "GRANTS", e.capability or ""):
                problems.append(f"{e.describe()} (edge missing)")
            if e.op == "REMOVE_INHERITS" and not snap.has_edge(e.role or "", "INHERITS", e.parent or ""):
                problems.append(f"{e.describe()} (edge missing)")
            if e.op == "UNASSIGN_ROLE" and not snap.has_edge(e.principal or "", "ASSIGNED_TO", e.role or ""):
                problems.append(f"{e.describe()} (edge missing)")
        if problems:
            raise InvalidState("Edits no longer match the policy graph: " + "; ".join(problems))

    def apply(self, repair_id: str) -> RepairPlan:
        plan = self.ledger.get(repair_id)
        if plan.status in ("APPLIED", "APPLY_VERIFICATION_FAILED"):
            raise InvalidState(f"Repair {repair_id} was already applied.")
        if plan.status != "APPROVED" or plan.approval is None:
            if plan.status != "VERIFIED":
                raise NotVerified(f"Repair {repair_id} is {plan.status}; verify and approve it first.")
            raise NotApproved(f"Repair {repair_id} needs explicit human approval before it can be applied.")
        if plan.approval.edits_hash != edits_hash(plan.edits):
            raise NotApproved("The approved edits do not match the plan's edits.")
        snap = self.policy.snapshot()
        self._require_current(plan, snap)
        self._preflight(plan, snap)

        result = self.policy.guarded_apply(plan.edits, expected_revision=plan.base_revision.revision,
                                           change=f"repair:{repair_id}")
        expected_counts = (
            sum(1 for e in plan.edits if e.op == "CREATE_ROLE"),
            sum(1 for e in plan.edits if e.op in ("ADD_GRANT", "ADD_INHERITS", "ASSIGN_ROLE")),
            sum(1 for e in plan.edits if e.op in ("REMOVE_GRANT", "REMOVE_INHERITS", "UNASSIGN_ROLE")),
        )
        actual_counts = (result.nodes_created, result.relationships_created, result.relationships_deleted)
        after = self.policy.snapshot()

        # post-apply verification: the active graph must now match the verified candidate, and the
        # running application must enforce it
        started = now_iso()
        predicted = self.store.effective_access()
        expected_after = {(r.principal, r.capability) for r in plan.access_matrix if r.after}
        checks = self.verifier.run("active", self._cases(plan, use_after=True), predicted, self.pdp.engine_name)
        graph_matches = predicted == expected_after and actual_counts == expected_counts
        passed = graph_matches and bool(checks) and all(c.passed for c in checks)
        post = Verification(
            id=new_id("vf"), kind="post_apply", policy_target="active", graph=self.store.active,
            revision=after.revision_model(), started_at=started, finished_at=now_iso(), passed=passed, checks=checks,
        )
        status = "APPLIED" if passed else "APPLY_VERIFICATION_FAILED"
        plan.application = Application(
            applied_at=now_iso(), from_revision=plan.base_revision, to_revision=after.revision_model(),
            write=WriteStats(nodes_created=result.nodes_created, relationships_created=result.relationships_created,
                             relationships_deleted=result.relationships_deleted, query_ms=result.query_ms),
            post_apply_verification=post, status=status,  # type: ignore[arg-type]
        )
        plan.status = status  # type: ignore[assignment]
        if not graph_matches:
            plan.residual_notes.append(
                f"Post-apply graph check failed: write counts {actual_counts} vs expected {expected_counts}, "
                "or effective access differs from the verified candidate.")
        chosen = plan.chosen()
        if chosen is not None:
            self.store.delete_graph(chosen.candidate_graph)
        self.ledger.save(plan)
        self.ledger.event("applied", f"Applied {repair_id}: r{plan.base_revision.revision} → r{after.revision} "
                          f"({'post-apply checks passed' if passed else 'POST-APPLY CHECKS FAILED'})",
                          after.revision, repair_id)
        return self._decorate(plan, after)

    # ------------------------------------------------------------------ evidence
    def evidence(self, repair_id: str) -> Evidence:
        plan = self.ledger.get(repair_id)
        snap = self.policy.snapshot()
        stale, reason = self.staleness(plan, snap)
        latest = (plan.application.post_apply_verification if plan.application else None) or plan.verification
        results = {c.id: c for c in latest.checks} if latest else {}
        matrix = {(r.principal, r.capability): r for r in plan.access_matrix}
        preserved = []
        for c in plan.contract.must_allow:
            if not c.source.startswith("workflow:"):
                continue
            check = results.get(f"{c.principal}:{c.capability}")
            row = matrix.get(c.pair())
            ok = check.passed if check else bool(row and row.after)
            preserved.append(PreservedWorkflow(workflow=c.source.split(":", 1)[1], principal=c.principal,
                                               capability=c.capability, ok=ok))
        chosen = plan.chosen()
        return Evidence(
            repair_id=plan.id, status=plan.status, stale=stale, stale_reason=reason,
            base_revision=plan.base_revision, current_revision=snap.revision_model(), contract=plan.contract,
            edits=plan.edits,
            permissions_removed=[RemovedPermission(principal=r.principal, capability=r.capability)
                                 for r in plan.access_matrix if r.before and not r.after],
            workflows_preserved=preserved,
            candidate_verification=plan.verification,
            post_apply_verification=plan.application.post_apply_verification if plan.application else None,
            approval=plan.approval, application=plan.application,
            rejected_candidates=[RejectedCandidate(id=c.id, title=c.title, outcome=c.outcome,
                                                   first_violation=c.violations[0] if c.violations else None)
                                 for c in plan.candidates if c.outcome != "PASS"],
            graphs=EvidenceGraphs(active=self.store.active, candidate=chosen.candidate_graph if chosen else None,
                                  ledger=self.settings.ledger_graph),
            generated_at=now_iso(),
        )
