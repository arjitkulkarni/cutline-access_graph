"""Active policy lifecycle: seeding, revision/hash, guarded writes, live-challenge mutations."""

from __future__ import annotations

import logging
import threading

from ..config import Settings
from ..db import scenario
from ..db.graph_store import EditResult, GraphStore, RawGraph
from ..errors import DemoModeDisabled, GraphQueryError, NotFound, ValidationFailed
from ..models.graph import PolicyRevision
from ..models.policy import PolicySnapshot
from ..models.repair import Edit, MutateResponse
from .ledger import Ledger
from .util import now_iso

log = logging.getLogger("cutline.policy")


class PolicyService:
    def __init__(self, store: GraphStore, ledger: Ledger, settings: Settings):
        self.store = store
        self.ledger = ledger
        self.settings = settings
        self._seed_lock = threading.Lock()
        self._ready = False

    # ------------------------------------------------------------------ lifecycle
    def ensure_ready(self) -> None:
        """Make sure the active policy graph exists (auto-seeds the demo scenario in demo mode)."""
        if self._ready:
            return
        with self._seed_lock:
            if self._ready:
                return
            if not self.store.graph_exists(self.store.active):
                if not self.settings.demo_mode:
                    raise NotFound(f"Policy graph '{self.store.active}' does not exist and DEMO_MODE is off.")
                self._seed(revision=1, kind="seeded")
            self._ready = True

    def _scenario_raw(self, revision: int) -> RawGraph:
        nodes = {label: [dict(row) for row in rows] for label, rows in scenario.NODES.items()}
        nodes["Policy"] = [{
            "id": "active", "revision": revision, "updated_at": now_iso(), "scenario": scenario.SCENARIO_ID,
            "last_change": "seed",
        }]
        return RawGraph(nodes=nodes, edges={k: list(v) for k, v in scenario.EDGES.items()})

    def _seed(self, revision: int, kind: str) -> PolicyRevision:
        self.store.delete_graph(self.store.active)
        self.store.write_raw(self.store.active, self._scenario_raw(revision))
        self.store.ensure_constraints(self.store.active)
        rev = self.revision()
        summary = "Seeded the Customer Operations scenario" if kind == "seeded" else "Reset the Customer Operations scenario"
        self.ledger.event(kind, summary, rev.revision)  # type: ignore[arg-type]
        return rev

    def reset(self) -> PolicyRevision:
        if not self.settings.demo_mode:
            raise DemoModeDisabled("Scenario reset is only available when DEMO_MODE=true.")
        with self._seed_lock:
            previous = 0
            if self.store.graph_exists(self.store.active):
                previous = self.store.snapshot().revision
            for name in self.store.list_graphs():
                if name.startswith(self.settings.candidate_prefix):
                    self.store.delete_graph(name)
            # revisions are monotonic across resets so evidence from before a reset is visibly stale
            rev = self._seed(revision=previous + 1, kind="reset")
            self._ready = True
            return rev

    # ------------------------------------------------------------------ reads
    def snapshot(self) -> PolicySnapshot:
        self.ensure_ready()
        try:
            return self.store.snapshot()
        except GraphQueryError as exc:
            # FalkorDB Cloud Free has no persistence: after an instance restart the graph is simply gone
            if "empty key" not in exc.message.lower():
                raise
            self._ready = False
            self.ensure_ready()
            return self.store.snapshot()

    def revision(self) -> PolicyRevision:
        return self.store.snapshot().revision_model()

    # ------------------------------------------------------------------ writes
    def guarded_apply(self, edits: list[Edit], *, expected_revision: int, change: str) -> EditResult:
        return self.store.apply_edits(
            self.store.active, edits, change=change, ts=now_iso(), expected_revision=expected_revision
        )

    def mutation_edits(self, kind: str, snap: PolicySnapshot) -> tuple[str, list[Edit]]:
        spec = scenario.MUTATIONS.get(kind)
        if spec is None:
            raise ValidationFailed(f"Unknown mutation '{kind}'.")
        principal = spec["principal"]
        if kind == "contractor_tools":
            roles = snap.assigned_roles(principal)
            if not roles:
                raise ValidationFailed(f"{principal} has no role to attach Contractor Tools to.")
            target = roles[0]
            edits = []
            if "contractor_tools" not in snap.nodes:
                edits.append(Edit(op="CREATE_ROLE", role="contractor_tools", name="Contractor Tools",
                                  reason="Live challenge: new bundle"))
            if not snap.has_edge("contractor_tools", "GRANTS", "export_customers"):
                edits.append(Edit(op="ADD_GRANT", role="contractor_tools", capability="export_customers",
                                  reason="Live challenge: bundle grants export"))
            if snap.has_edge(target, "INHERITS", "contractor_tools"):
                raise ValidationFailed(f"Contractor Tools is already attached to {target}.")
            edits.append(Edit(op="ADD_INHERITS", role=target, parent="contractor_tools",
                              reason=f"Live challenge: attach bundle to {target}"))
            name = snap.nodes[target].label if target in snap.nodes else target
            return f"Attached a Contractor Tools bundle (grants export_customers) to {name}", edits
        if snap.has_edge(principal, "ASSIGNED_TO", "export_helper"):
            raise ValidationFailed(f"{principal} is already assigned to export_helper.")
        return (
            "Assigned Noah directly to Export Helper",
            [Edit(op="ASSIGN_ROLE", principal=principal, role="export_helper", reason="Live challenge")],
        )

    def mutate(self, kind: str, new_paths_fn) -> MutateResponse:
        if not self.settings.demo_mode:
            raise DemoModeDisabled("Policy mutation is only available when DEMO_MODE=true.")
        snap = self.snapshot()
        summary, edits = self.mutation_edits(kind, snap)
        self.store.apply_edits(self.store.active, edits, change=f"challenge:{kind}", ts=now_iso(),
                               expected_revision=snap.revision)
        rev = self.revision()
        self.ledger.event("mutated", summary, rev.revision)
        principal = scenario.MUTATIONS[kind]["principal"]
        return MutateResponse(revision=rev, summary=summary, new_paths=new_paths_fn(principal))
