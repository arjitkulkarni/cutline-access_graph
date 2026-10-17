"""TEST DOUBLE ONLY — an in-memory stand-in for GraphStore used by unit tests.

It mirrors the semantics of the Cypher in app/db/queries.py (bounded INHERITS*0..d traversal with
relationship uniqueness, single-statement edit application that stops at the first unmatched
segment, revision compare-and-set). The application never imports this module; when FalkorDB is
unavailable the app returns 503. The same test-suite runs against real FalkorDB when credentials
are configured (see test_falkordb_integration.py).
"""

from __future__ import annotations

import copy
import json
from typing import Any

from app.config import Settings
from app.db.graph_store import EditResult, GraphStore, RawGraph
from app.errors import GraphQueryError, InvalidState, StaleProposal
from app.models.graph import AccessPath
from app.models.repair import Edit


class MemoryGraphStore(GraphStore):
    def __init__(self, settings: Settings):
        super().__init__(client=None, settings=settings)  # type: ignore[arg-type]
        self.graphs: dict[str, RawGraph] = {}
        self.repairs: dict[str, str] = {}
        self.events: list[dict[str, Any]] = []
        self.copies = 0

    # ------------------------------------------------------------------ basics
    def ping(self) -> float:
        return 0.1

    def list_graphs(self) -> list[str]:
        names = list(self.graphs)
        if self.repairs or self.events:
            names.append(self.settings.ledger_graph)
        return names

    def graph_exists(self, name: str) -> bool:
        return name in self.list_graphs()

    def delete_graph(self, name: str) -> bool:
        return self.graphs.pop(name, None) is not None

    # ------------------------------------------------------------------ reads
    def raw(self, graph: str | None = None) -> RawGraph:
        g = self.graphs.get(self._g(graph))
        if g is None:  # what GRAPH.RO_QUERY says for a graph that does not exist
            raise GraphQueryError(f"FalkorDB rejected a query on graph '{self._g(graph)}': "
                                  "Invalid graph operation on empty key")
        return copy.deepcopy(g)

    def relations(self, graph: str) -> list[tuple[str, str, str]]:
        g = self.graphs[graph]
        return [(t, s, d) for t in ("ASSIGNED_TO", "INHERITS", "GRANTS") for (s, d) in g.edges.get(t, [])]

    def _paths(self, g: RawGraph, principal: str, capability: str, depth: int) -> list[AccessPath]:
        inherits = g.edges.get("INHERITS", [])
        grants = set(g.edges.get("GRANTS", []))
        found: list[AccessPath] = []

        def walk(role: str, nodes: list[str], rels: list[str], used: set[tuple[str, str]], hops: int) -> None:
            if (role, capability) in grants:
                found.append(AccessPath.from_lists(nodes + [capability], rels + ["GRANTS"]))
            if hops == depth:
                return
            for (s, d) in inherits:
                if s == role and (s, d) not in used:
                    walk(d, nodes + [d], rels + ["INHERITS"], used | {(s, d)}, hops + 1)

        for (u, r) in g.edges.get("ASSIGNED_TO", []):
            if u == principal:
                walk(r, [principal, r], ["ASSIGNED_TO"], set(), 0)
        unique = {p.key(): p for p in found}
        return sorted(unique.values(), key=lambda p: (len(p.nodes), p.nodes))

    def effective_access(self, graph: str | None = None, max_depth: int | None = None) -> set[tuple[str, str]]:
        g = self.graphs[self._g(graph)]
        users = [r["id"] for r in g.nodes.get("User", [])]
        caps = [r["id"] for r in g.nodes.get("Capability", [])]
        depth = self._depth(max_depth)
        return {(u, c) for u in users for c in caps if self._paths(g, u, c, depth)}

    def paths(self, principal: str, capability: str, graph: str | None = None, max_depth: int | None = None):
        g = self.graphs[self._g(graph)]
        return self._paths(g, principal, capability, self._depth(max_depth)), "memory-test-double", 0.0

    def pair_paths(self, pairs, graph: str | None = None, max_depth: int | None = None):
        g = self.graphs[self._g(graph)]
        return {p: self._paths(g, p[0], p[1], self._depth(max_depth)) for p in pairs}

    # ------------------------------------------------------------------ writes
    def write_raw(self, graph: str, raw: RawGraph) -> None:
        self.graphs[graph] = copy.deepcopy(raw)

    def ensure_constraints(self, graph: str) -> list[str]:
        return []

    def _ids(self, g: RawGraph, label: str) -> set[str]:
        return {r["id"] for r in g.nodes.get(label, [])}

    def apply_edits(self, graph: str, edits: list[Edit], *, change: str, ts: str,
                    expected_revision: int | None = None) -> EditResult:
        g = self.graphs.get(graph)
        policy = next((p for p in (g.nodes.get("Policy", []) if g else []) if p["id"] == "active"), None)
        if policy is None:
            raise InvalidState(f"Edits no longer match graph '{graph}'; nothing was applied.")
        if expected_revision is not None and policy["revision"] != expected_revision:
            raise StaleProposal("The policy revision moved; nothing was applied.")
        # all preconditions first (mirrors the MATCH-before-write statement), then every write
        roles, users, caps = self._ids(g, "Role"), self._ids(g, "User"), self._ids(g, "Capability")
        created = {e.role for e in edits if e.op == "CREATE_ROLE"}
        known = {"Role": roles | created, "User": users, "Capability": caps}
        shapes = {
            "ADD_GRANT": ("GRANTS", "Role", "role", "Capability", "capability"),
            "ADD_INHERITS": ("INHERITS", "Role", "role", "Role", "parent"),
            "ASSIGN_ROLE": ("ASSIGNED_TO", "User", "principal", "Role", "role"),
            "REMOVE_GRANT": ("GRANTS", "Role", "role", "Capability", "capability"),
            "REMOVE_INHERITS": ("INHERITS", "Role", "role", "Role", "parent"),
            "UNASSIGN_ROLE": ("ASSIGNED_TO", "User", "principal", "Role", "role"),
        }
        for e in edits:
            if e.op == "CREATE_ROLE":
                continue
            kind, sl, sf, dl, df = shapes[e.op]
            s, d = getattr(e, sf), getattr(e, df)
            existing_src = s in (roles if sl == "Role" else known[sl])
            existing_dst = d in (roles if dl == "Role" else known[dl])
            if e.op.startswith(("REMOVE", "UNASSIGN")):
                if (s, d) not in g.edges.get(kind, []):
                    raise InvalidState(f"Edits no longer match graph '{graph}'; nothing was applied.")
            elif not ((existing_src or s in created) and (existing_dst or d in created)):
                raise InvalidState(f"Edits no longer match graph '{graph}'; nothing was applied.")
        created_nodes = created_rels = deleted_rels = 0
        edges = g.edges
        for e in edits:
            if e.op == "CREATE_ROLE":
                if e.role not in roles:
                    g.nodes.setdefault("Role", []).append({"id": e.role, "name": e.name or e.role, "origin": "cutline"})
                    roles.add(e.role or "")
                    created_nodes += 1
                continue
            kind, _, sf, _, df = shapes[e.op]
            s, d = getattr(e, sf), getattr(e, df)
            if e.op.startswith(("ADD", "ASSIGN")):
                if (s, d) not in edges.setdefault(kind, []):
                    edges[kind].append((s, d))
                    created_rels += 1
            else:
                edges[kind].remove((s, d))
                deleted_rels += 1
        if expected_revision is not None:
            policy["revision"] += 1
            policy["updated_at"] = ts
        policy["last_change"] = change
        return EditResult(revision=policy["revision"], nodes_created=created_nodes, relationships_created=created_rels,
                          relationships_deleted=deleted_rels, query_ms=0.0)

    def materialize_copy(self, source: str, destination: str) -> str:
        self.graphs[destination] = copy.deepcopy(self.graphs[source])
        self.copies += 1
        return "GRAPH.COPY"

    # ------------------------------------------------------------------ ledger
    def ledger_put(self, doc: dict[str, Any]) -> None:
        self.repairs[doc["id"]] = json.dumps(doc)

    def ledger_get(self, repair_id: str) -> dict[str, Any] | None:
        raw = self.repairs.get(repair_id)
        return json.loads(raw) if raw else None

    def ledger_list(self, limit: int = 50) -> list[dict[str, Any]]:
        docs = [json.loads(v) for v in self.repairs.values()]
        return sorted(docs, key=lambda d: d["created_at"], reverse=True)[:limit]

    def ledger_event(self, event: dict[str, Any]) -> None:
        self.events.append(dict(event))

    def ledger_events(self, limit: int = 30) -> list[dict[str, Any]]:
        return sorted(self.events, key=lambda e: e["ts"], reverse=True)[:limit]
