"""Wires every service once per process. Tests build their own Container."""

from __future__ import annotations

from dataclasses import dataclass

from .config import Settings, get_settings
from .db.falkordb_client import FalkorClient
from .db.graph_store import GraphStore
from .services.access_analyzer import AccessAnalyzer
from .services.authorization import PolicyDecisionPoint
from .services.ledger import Ledger
from .services.policy_service import PolicyService
from .services.rate_limit import RunLimiter
from .services.repair_planner import RepairPlanner
from .services.repair_service import RepairService
from .services.verifier import RuntimeVerifier


@dataclass
class Container:
    settings: Settings
    client: FalkorClient
    store: GraphStore
    ledger: Ledger
    policy: PolicyService
    analyzer: AccessAnalyzer
    pdp: PolicyDecisionPoint
    planner: RepairPlanner
    verifier: RuntimeVerifier
    repairs: RepairService
    llm_limiter: RunLimiter


def build_container(settings: Settings | None = None, store: GraphStore | None = None,
                    verifier: RuntimeVerifier | None = None) -> Container:
    settings = settings or get_settings()
    client = store.client if store is not None else FalkorClient(settings)
    store = store or GraphStore(client, settings)
    ledger = Ledger(store)
    policy = PolicyService(store, ledger, settings)
    analyzer = AccessAnalyzer(store, policy)
    pdp = PolicyDecisionPoint(store, settings)
    planner = RepairPlanner(store, settings)
    verifier = verifier or RuntimeVerifier(settings)
    repairs = RepairService(store, policy, planner, verifier, ledger, pdp, settings)
    llm_limiter = RunLimiter(settings.llm_runs_per_hour)
    return Container(settings, client, store, ledger, policy, analyzer, pdp, planner, verifier, repairs, llm_limiter)
