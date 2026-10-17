"""Every Cypher statement CUTLINE sends to FalkorDB.

Values are always passed as parameters. The only things formatted into query text are
(a) variable-length bounds, which Cypher cannot parameterize and which are validated ints, and
(b) labels / relationship types taken from the fixed allowlists below.
"""

from __future__ import annotations

from typing import Any

from ..errors import ValidationFailed
from ..models.repair import Edit  # noqa: F401  (used in type hints of composite_edit_query)

NODE_PROPS: dict[str, tuple[str, ...]] = {
    "User": ("id", "name", "department", "principal_type", "title"),
    "Role": ("id", "name", "description", "origin"),
    "Capability": ("id", "name", "sensitivity", "method", "endpoint"),
    "Resource": ("id", "name", "classification"),
    "Workflow": ("id", "name", "criticality", "description"),
    "Guardrail": ("id", "description"),
    "Policy": ("id", "revision", "updated_at", "scenario", "last_change"),
}

# relationship type -> (source label, target label)
EDGE_SHAPES: dict[str, tuple[str, str]] = {
    "ASSIGNED_TO": ("User", "Role"),
    "INHERITS": ("Role", "Role"),
    "GRANTS": ("Role", "Capability"),
    "ACTS_ON": ("Capability", "Resource"),
    "REQUIRES": ("Workflow", "Capability"),
    "PERFORMS": ("User", "Workflow"),
    "FORBIDS": ("Guardrail", "Capability"),
    "APPLIES_TO": ("Guardrail", "User"),
}

INDEXED_LABELS: tuple[str, ...] = ("User", "Role", "Capability", "Resource", "Workflow", "Guardrail", "Policy")
UNIQUE_LABELS: tuple[str, ...] = ("User", "Role", "Capability")


def _depth(max_depth: int) -> int:
    if not isinstance(max_depth, int) or isinstance(max_depth, bool) or not 1 <= max_depth <= 10:
        raise ValidationFailed("max_depth must be an integer between 1 and 10")
    return max_depth


# --------------------------------------------------------------------------- reads
# properties(n) returns a string-keyed map, so results never depend on the client's per-handle
# label/property-id schema cache (which can go stale when another process rebuilds the graph).
ALL_NODES = "MATCH (n) RETURN labels(n) AS labels, properties(n) AS props"

ALL_EDGES = "MATCH (a)-[r]->(b) RETURN type(r) AS type, a.id AS source, b.id AS target"

POLICY_META = "MATCH (p:Policy {id: 'active'}) RETURN p.revision AS revision, p.updated_at AS updated_at"

# One-hop relations only. Used by the enforcement point, which must not share traversal code
# with the analyzer or planner.
POLICY_RELATIONS = (
    "MATCH (a)-[r]->(b) WHERE type(r) IN ['ASSIGNED_TO', 'INHERITS', 'GRANTS'] "
    "RETURN type(r) AS type, a.id AS source, b.id AS target"
)


def paths_query(max_depth: int) -> str:
    """All bounded access paths principal -> capability (direct grant = zero INHERITS hops)."""
    d = _depth(max_depth)
    return (
        "MATCH p = (u:User {id: $principal})-[:ASSIGNED_TO]->(:Role)"
        f"-[:INHERITS*0..{d}]->(:Role)-[:GRANTS]->(c:Capability {{id: $capability}}) "
        "RETURN DISTINCT [n IN nodes(p) | n.id] AS node_ids, [r IN relationships(p) | type(r)] AS rel_types"
    )


def pair_paths_query(max_depth: int) -> str:
    """All bounded access paths for a batch of (principal, capability) pairs in one round trip."""
    d = _depth(max_depth)
    return (
        "UNWIND $pairs AS pair "
        "MATCH p = (u:User)-[:ASSIGNED_TO]->(:Role)"
        f"-[:INHERITS*0..{d}]->(:Role)-[:GRANTS]->(c:Capability) "
        "WHERE u.id = pair.principal AND c.id = pair.capability "
        "RETURN DISTINCT u.id AS principal, c.id AS capability, "
        "[n IN nodes(p) | n.id] AS node_ids, [r IN relationships(p) | type(r)] AS rel_types"
    )


def effective_access_query(max_depth: int) -> str:
    """Every (principal, capability) pair reachable in the graph."""
    d = _depth(max_depth)
    return (
        "MATCH (u:User)-[:ASSIGNED_TO]->(:Role)"
        f"-[:INHERITS*0..{d}]->(:Role)-[:GRANTS]->(c:Capability) "
        "RETURN DISTINCT u.id AS principal, c.id AS capability"
    )


# --------------------------------------------------------------------------- writes: seed / replay
def create_nodes_query(label: str) -> str:
    if label not in NODE_PROPS:
        raise ValidationFailed(f"unknown label {label}")
    sets = ", ".join(f"n.{p} = row.{p}" for p in NODE_PROPS[label] if p != "id")
    q = f"UNWIND $rows AS row CREATE (n:{label} {{id: row.id}})"
    return f"{q} SET {sets}" if sets else q


def create_edges_query(edge_type: str) -> str:
    if edge_type not in EDGE_SHAPES:
        raise ValidationFailed(f"unknown relationship type {edge_type}")
    src, dst = EDGE_SHAPES[edge_type]
    return (
        f"UNWIND $rows AS row MATCH (a:{src}), (b:{dst}) "
        f"WHERE a.id = row.s AND b.id = row.t CREATE (a)-[:{edge_type}]->(b)"
    )


def create_index_query(label: str) -> str:
    if label not in INDEXED_LABELS:
        raise ValidationFailed(f"unknown label {label}")
    return f"CREATE INDEX FOR (n:{label}) ON (n.id)"


# --------------------------------------------------------------------------- writes: allowlisted edits
_REMOVALS = {
    "REMOVE_GRANT": ("Role", "role", "GRANTS", "Capability", "capability"),
    "REMOVE_INHERITS": ("Role", "role", "INHERITS", "Role", "parent"),
    "UNASSIGN_ROLE": ("User", "principal", "ASSIGNED_TO", "Role", "role"),
}
_ADDITIONS = {
    "ADD_GRANT": ("Role", "role", "GRANTS", "Capability", "capability"),
    "ADD_INHERITS": ("Role", "role", "INHERITS", "Role", "parent"),
    "ASSIGN_ROLE": ("User", "principal", "ASSIGNED_TO", "Role", "role"),
}


def composite_edit_query(edits: list[Edit], *, guarded: bool) -> tuple[str, dict[str, Any]]:
    """One Cypher statement that applies every edit, all-or-nothing.

    Every precondition is a MATCH placed before any write: the Policy node (with a compare-and-set
    on its revision when `guarded`), every existing node an edit touches, and every relationship an
    edit removes. If any of them is missing the statement produces no row and writes nothing.
    Otherwise the revision bump, role creations, MERGEs and DELETEs commit together — a single
    FalkorDB query is atomic.
    """
    if guarded:
        reads = ["MATCH (pol:Policy {id: 'active'}) WHERE pol.revision = $expected_revision"]
        writes = ["SET pol.revision = pol.revision + 1, pol.updated_at = $ts, pol.last_change = $change"]
    else:
        reads = ["MATCH (pol:Policy {id: 'active'})"]
        writes = ["SET pol.last_change = $change"]
    params: dict[str, Any] = {}
    bound: dict[tuple[str, str], str] = {}
    created: dict[str, str] = {}

    def node(label: str, node_id: str | None) -> str:
        if not node_id:
            raise ValidationFailed(f"edit is missing a {label.lower()} id")
        if label == "Role" and node_id in created:
            return created[node_id]
        key = (label, node_id)
        if key not in bound:
            var = f"n{len(bound)}"
            params[f"{var}_id"] = node_id
            reads.append(f"MATCH ({var}:{label} {{id: ${var}_id}})")
            bound[key] = var
        return bound[key]

    for i, edit in enumerate(edits):
        op = edit.op
        if op == "CREATE_ROLE":
            var = f"cr{i}"
            params[f"{var}_id"] = edit.role
            params[f"{var}_name"] = edit.name or edit.role
            writes.append(f"MERGE ({var}:Role {{id: ${var}_id}}) ON CREATE SET {var}.name = ${var}_name, "
                          f"{var}.origin = 'cutline'")
            created[edit.role or ""] = var
        elif op in _ADDITIONS:
            src_label, src_field, rel, dst_label, dst_field = _ADDITIONS[op]
            src = node(src_label, getattr(edit, src_field))
            dst = node(dst_label, getattr(edit, dst_field))
            writes.append(f"MERGE ({src})-[:{rel}]->({dst})")
        elif op in _REMOVALS:
            src_label, src_field, rel, dst_label, dst_field = _REMOVALS[op]
            src = node(src_label, getattr(edit, src_field))
            dst = node(dst_label, getattr(edit, dst_field))
            reads.append(f"MATCH ({src})-[x{i}:{rel}]->({dst})")
            writes.append(f"DELETE x{i}")
        else:
            raise ValidationFailed(f"unsupported edit op {op}")
    return " ".join([*reads, *writes, "RETURN pol.revision AS revision"]), params


# --------------------------------------------------------------------------- ledger graph
LEDGER_PUT_REPAIR = (
    "MERGE (r:Repair {id: $id}) "
    "SET r.doc = $doc, r.status = $status, r.created_at = $created_at, r.updated_at = $updated_at "
    "WITH r MERGE (v:Revision {n: $base_revision}) ON CREATE SET v.hash = $base_hash "
    "WITH r, v MERGE (r)-[:BASED_ON]->(v)"
)
LEDGER_GET_REPAIR = "MATCH (r:Repair {id: $id}) RETURN r.doc AS doc"


def ledger_list_repairs_query(limit: int) -> str:
    n = max(1, min(int(limit), 200))
    return f"MATCH (r:Repair) RETURN r.doc AS doc ORDER BY r.created_at DESC LIMIT {n}"


LEDGER_ADD_EVENT = (
    "CREATE (e:Event {id: $id, ts: $ts, kind: $kind, summary: $summary, revision: $revision, repair_id: $repair_id}) "
    "WITH e MERGE (v:Revision {n: $revision}) WITH e, v MERGE (e)-[:AT]->(v)"
)


def ledger_events_query(limit: int) -> str:
    n = max(1, min(int(limit), 200))
    return (
        "MATCH (e:Event) RETURN e.id AS id, e.ts AS ts, e.kind AS kind, e.summary AS summary, "
        f"e.revision AS revision, e.repair_id AS repair_id ORDER BY e.ts DESC LIMIT {n}"
    )
