"""Domain-level operations on FalkorDB graphs (active policy, candidates, ledger)."""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any

from redis.exceptions import ResponseError

from ..config import Settings
from ..errors import GraphQueryError, InvalidState, StaleProposal
from ..models.graph import LABEL_TO_KIND, POLICY_EDGE_TYPES, AccessPath, GraphNode, Guardrail, Workflow
from ..models.policy import PolicySnapshot
from ..models.repair import Edit
from . import queries as Q
from .falkordb_client import FalkorClient

log = logging.getLogger("cutline.store")


@dataclass
class EditResult:
    revision: int | None
    nodes_created: int
    relationships_created: int
    relationships_deleted: int
    query_ms: float


@dataclass
class RawGraph:
    """Label-faithful copy of a graph's contents, used for snapshot-replay isolation."""

    nodes: dict[str, list[dict[str, Any]]]
    edges: dict[str, list[tuple[str, str]]]


def policy_hash(nodes: dict[str, GraphNode], policy_edges: set[tuple[str, str, str]]) -> str:
    canonical = {
        "nodes": sorted(f"{n.kind}:{n.id}" for n in nodes.values() if n.kind in ("user", "role", "capability")),
        "edges": sorted(f"{s}|{t}|{d}" for (s, t, d) in policy_edges),
    }
    digest = hashlib.sha256(json.dumps(canonical, separators=(",", ":")).encode()).hexdigest()
    return f"sha256:{digest}"


class GraphStore:
    def __init__(self, client: FalkorClient, settings: Settings):
        self.client = client
        self.settings = settings
        self._copy_lock = threading.Lock()

    # ------------------------------------------------------------------ basics
    @property
    def active(self) -> str:
        return self.settings.falkordb_graph

    def _g(self, graph: str | None) -> str:
        return graph or self.active

    def _depth(self, max_depth: int | None) -> int:
        return max_depth or self.settings.max_depth

    def ping(self) -> float:
        return self.client.ping()

    def list_graphs(self) -> list[str]:
        return self.client.list_graphs()

    def graph_exists(self, name: str) -> bool:
        return self.client.graph_exists(name)

    def delete_graph(self, name: str) -> bool:
        return self.client.delete_graph(name)

    # ------------------------------------------------------------------ reads
    def raw(self, graph: str | None = None) -> RawGraph:
        g = self._g(graph)
        nodes: dict[str, list[dict[str, Any]]] = {}
        for labels, props in self.client.rows(g, Q.ALL_NODES):
            label = labels[0] if labels else None
            if label in Q.NODE_PROPS:
                nodes.setdefault(label, []).append(dict(props))
        edges: dict[str, list[tuple[str, str]]] = {}
        for edge_type, source, target in self.client.rows(g, Q.ALL_EDGES):
            if edge_type in Q.EDGE_SHAPES:
                edges.setdefault(edge_type, []).append((source, target))
        return RawGraph(nodes=nodes, edges=edges)

    def snapshot(self, graph: str | None = None) -> PolicySnapshot:
        g = self._g(graph)
        raw = self.raw(g)
        nodes: dict[str, GraphNode] = {}
        revision, updated_at = 0, ""
        for label, rows in raw.nodes.items():
            for props in rows:
                if label in LABEL_TO_KIND:
                    extra = {k: v for k, v in props.items() if k not in ("id", "name")}
                    nodes[props["id"]] = GraphNode(
                        id=props["id"], kind=LABEL_TO_KIND[label], label=str(props.get("name") or props["id"]), props=extra
                    )
                elif label == "Policy" and props.get("id") == "active":
                    revision = int(props.get("revision") or 0)
                    updated_at = str(props.get("updated_at") or "")
        policy_edges = {(s, t, d) for t in POLICY_EDGE_TYPES for (s, d) in raw.edges.get(t, [])}
        resource_edges = {(s, "ACTS_ON", d) for (s, d) in raw.edges.get("ACTS_ON", [])}

        workflows = []
        for wf in sorted(raw.nodes.get("Workflow", []), key=lambda r: r["id"]):
            workflows.append(Workflow(
                id=wf["id"], name=str(wf.get("name") or wf["id"]),
                requires=sorted(c for (w, c) in raw.edges.get("REQUIRES", []) if w == wf["id"]),
                performers=sorted(u for (u, w) in raw.edges.get("PERFORMS", []) if w == wf["id"]),
            ))
        guardrails = []
        for gr in sorted(raw.nodes.get("Guardrail", []), key=lambda r: r["id"]):
            guardrails.append(Guardrail(
                id=gr["id"], description=str(gr.get("description") or gr["id"]),
                forbids=sorted(c for (x, c) in raw.edges.get("FORBIDS", []) if x == gr["id"]),
                applies_to=sorted(u for (x, u) in raw.edges.get("APPLIES_TO", []) if x == gr["id"]),
            ))
        return PolicySnapshot(
            graph=g, nodes=nodes, policy_edges=policy_edges, resource_edges=resource_edges,
            workflows=workflows, guardrails=guardrails, revision=revision, updated_at=updated_at,
            hash=policy_hash(nodes, policy_edges),
        )

    def relations(self, graph: str) -> list[tuple[str, str, str]]:
        """One-hop policy relations for the enforcement point: (type, source, target)."""
        return [(t, s, d) for t, s, d in self.client.rows(graph, Q.POLICY_RELATIONS)]

    def effective_access(self, graph: str | None = None, max_depth: int | None = None) -> set[tuple[str, str]]:
        rows = self.client.rows(self._g(graph), Q.effective_access_query(self._depth(max_depth)))
        return {(u, c) for u, c in rows}

    def paths(
        self, principal: str, capability: str, graph: str | None = None, max_depth: int | None = None
    ) -> tuple[list[AccessPath], str, float]:
        cypher = Q.paths_query(self._depth(max_depth))
        started = time.perf_counter()
        rows = self.client.rows(self._g(graph), cypher, {"principal": principal, "capability": capability})
        elapsed = round((time.perf_counter() - started) * 1000, 1)
        return _dedupe_paths(rows), cypher, elapsed

    def pair_paths(
        self, pairs: list[tuple[str, str]], graph: str | None = None, max_depth: int | None = None
    ) -> dict[tuple[str, str], list[AccessPath]]:
        result: dict[tuple[str, str], list[AccessPath]] = {p: [] for p in pairs}
        if not pairs:
            return result
        params = {"pairs": [{"principal": u, "capability": c} for u, c in pairs]}
        rows = self.client.rows(self._g(graph), Q.pair_paths_query(self._depth(max_depth)), params)
        grouped: dict[tuple[str, str], list[list[Any]]] = {}
        for principal, capability, node_ids, rel_types in rows:
            grouped.setdefault((principal, capability), []).append([node_ids, rel_types])
        for key, group in grouped.items():
            result[key] = _dedupe_paths(group)
        return result

    # ------------------------------------------------------------------ writes
    def write_raw(self, graph: str, raw: RawGraph) -> None:
        """Create every node and edge of `raw` in `graph` (which should not exist yet)."""
        for label in Q.NODE_PROPS:
            rows = raw.nodes.get(label, [])
            if rows:
                cleaned = [{p: r.get(p) for p in Q.NODE_PROPS[label]} for r in rows]
                self.client.query(graph, Q.create_nodes_query(label), {"rows": cleaned})
        for label in Q.INDEXED_LABELS:
            if raw.nodes.get(label):
                try:
                    self.client.query(graph, Q.create_index_query(label))
                except GraphQueryError as exc:  # index already exists, or unsupported
                    log.info("index on %s skipped: %s", label, exc.message)
        for edge_type in Q.EDGE_SHAPES:
            rows = raw.edges.get(edge_type, [])
            if rows:
                self.client.query(graph, Q.create_edges_query(edge_type), {"rows": [{"s": s, "t": t} for s, t in rows]})

    def ensure_constraints(self, graph: str) -> list[str]:
        created = []
        g = self.client.graph(graph)
        for label in Q.UNIQUE_LABELS:
            try:
                g.create_node_unique_constraint(label, "id")
                created.append(label)
            except ResponseError as exc:
                log.info("unique constraint on %s skipped: %s", label, exc)
        return created

    def apply_edits(
        self, graph: str, edits: list[Edit], *, change: str, ts: str, expected_revision: int | None = None
    ) -> EditResult:
        """Apply allowlisted edits in a single atomic Cypher statement.

        With `expected_revision`, the statement is guarded by a compare-and-set on the Policy
        revision and bumps it in the same write. A moved revision raises StaleProposal and
        writes nothing.
        """
        guarded = expected_revision is not None
        cypher, params = Q.composite_edit_query(edits, guarded=guarded)
        params.update({"change": change, "ts": ts})
        if guarded:
            params["expected_revision"] = expected_revision
        started = time.perf_counter()
        result = self.client.query(graph, cypher, params)
        elapsed = round((time.perf_counter() - started) * 1000, 1)
        if not result.result_set:
            # zero rows => a precondition MATCH failed and nothing was written; say which kind
            meta = self.client.rows(graph, Q.POLICY_META)
            current = meta[0][0] if meta else None
            if guarded and current != expected_revision:
                raise StaleProposal(
                    f"The policy revision moved (expected r{expected_revision}, found r{current}); nothing was applied.",
                    {"expected_revision": expected_revision, "current_revision": current},
                )
            raise InvalidState(f"Edits no longer match graph '{graph}'; nothing was applied.",
                               {"edits": [e.describe() for e in edits]})
        # falkordb-py reports counts as floats (e.g. 2.0) when present
        return EditResult(
            revision=int(result.result_set[0][0]),
            nodes_created=int(result.nodes_created),
            relationships_created=int(result.relationships_created),
            relationships_deleted=int(result.relationships_deleted),
            query_ms=elapsed,
        )

    def materialize_copy(self, source: str, destination: str) -> str:
        """Create an isolated copy of `source`. Prefers GRAPH.COPY; falls back to snapshot replay.

        GRAPH.COPY forks the server process, so copies are serialized; evaluation still runs in parallel.
        """
        self.client.delete_graph(destination)
        for attempt in range(3):
            try:
                with self._copy_lock:
                    self.client.copy_graph(source, destination)
                return "GRAPH.COPY"
            except ResponseError as exc:
                # the server forks for each copy; back-to-back copies can briefly fail with "could not fork"
                if "fork" in str(exc).lower() and attempt < 2:
                    time.sleep(0.25 * (attempt + 1))
                    self.client.delete_graph(destination)
                    continue
                log.warning("GRAPH.COPY unavailable (%s); using snapshot replay", exc)
                break
        self.client.delete_graph(destination)
        self.write_raw(destination, self.raw(source))
        return "snapshot-replay"

    # ------------------------------------------------------------------ ledger
    def ledger_put(self, doc: dict[str, Any]) -> None:
        self.client.query(self.settings.ledger_graph, Q.LEDGER_PUT_REPAIR, {
            "id": doc["id"],
            "doc": json.dumps(doc, separators=(",", ":"), ensure_ascii=True),
            "status": doc["status"],
            "created_at": doc["created_at"],
            "updated_at": doc.get("updated_at") or doc["created_at"],
            "base_revision": doc["base_revision"]["revision"],
            "base_hash": doc["base_revision"]["hash"],
        })

    def ledger_get(self, repair_id: str) -> dict[str, Any] | None:
        if not self.client.graph_exists(self.settings.ledger_graph):
            return None  # GRAPH.RO_QUERY errors on a graph that does not exist yet
        rows = self.client.rows(self.settings.ledger_graph, Q.LEDGER_GET_REPAIR, {"id": repair_id})
        return json.loads(rows[0][0]) if rows else None

    def ledger_list(self, limit: int = 50) -> list[dict[str, Any]]:
        if not self.client.graph_exists(self.settings.ledger_graph):
            return []
        rows = self.client.rows(self.settings.ledger_graph, Q.ledger_list_repairs_query(limit))
        return [json.loads(r[0]) for r in rows]

    def ledger_event(self, event: dict[str, Any]) -> None:
        # null property values cannot be stored, so "no repair" is written as ""
        self.client.query(self.settings.ledger_graph, Q.LEDGER_ADD_EVENT,
                          {**event, "repair_id": event.get("repair_id") or ""})

    def ledger_events(self, limit: int = 30) -> list[dict[str, Any]]:
        if not self.client.graph_exists(self.settings.ledger_graph):
            return []
        rows = self.client.rows(self.settings.ledger_graph, Q.ledger_events_query(limit))
        keys = ("id", "ts", "kind", "summary", "revision", "repair_id")
        events = [dict(zip(keys, r)) for r in rows]
        for e in events:
            e["repair_id"] = e["repair_id"] or None
            e["revision"] = int(e["revision"])
        return events


def _dedupe_paths(rows: list[list[Any]]) -> list[AccessPath]:
    seen: set[tuple[tuple[str, ...], tuple[str, ...]]] = set()
    paths: list[AccessPath] = []
    for node_ids, rel_types in rows:
        path = AccessPath.from_lists(list(node_ids), list(rel_types))
        if path.key() not in seen:
            seen.add(path.key())
            paths.append(path)
    paths.sort(key=lambda p: (len(p.nodes), p.nodes))
    return paths
