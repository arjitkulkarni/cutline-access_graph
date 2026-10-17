"""Evidence ledger: repair plans and policy activity, persisted in a FalkorDB ledger graph.

(:Repair {id, doc})-[:BASED_ON]->(:Revision {n, hash}) and (:Event)-[:AT]->(:Revision) give every
plan and event revision provenance. There is deliberately no in-process cache: the API and the MCP
server are separate processes and must always see the same, current evidence.
"""

from __future__ import annotations

from ..db.graph_store import GraphStore
from ..errors import NotFound
from ..models.repair import ActivityEvent, ActivityKind, RepairPlan
from .util import new_id, now_iso


class Ledger:
    def __init__(self, store: GraphStore):
        self.store = store

    def save(self, plan: RepairPlan) -> RepairPlan:
        doc = plan.model_dump(mode="json")
        doc["updated_at"] = now_iso()
        self.store.ledger_put(doc)
        return plan

    def get(self, repair_id: str) -> RepairPlan:
        doc = self.store.ledger_get(repair_id)
        if doc is None:
            raise NotFound(f"Repair plan '{repair_id}' does not exist.")
        return RepairPlan.model_validate(doc)

    def list(self, limit: int = 20) -> list[RepairPlan]:
        return [RepairPlan.model_validate(d) for d in self.store.ledger_list(limit)]

    def event(self, kind: ActivityKind, summary: str, revision: int, repair_id: str | None = None) -> ActivityEvent:
        event = ActivityEvent(id=new_id("ev"), ts=now_iso(), kind=kind, summary=summary, revision=revision,
                              repair_id=repair_id)
        self.store.ledger_event(event.model_dump())
        return event

    def events(self, limit: int = 30) -> list[ActivityEvent]:
        return [ActivityEvent.model_validate(e) for e in self.store.ledger_events(limit)]
