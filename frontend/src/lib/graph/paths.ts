import type { AccessPath, EdgeType, GraphSnapshot } from "../types";
import type { AccessClass } from "../contract";

/** A derived reachability path drawn on top of the stored relationships. */
export interface HighlightPath {
  /** unique per (tone, principal, capability, path) */
  key: string;
  /** identical role chain → same route (e.g. "support>shared_ops>export_customers") */
  routeKey: string;
  tone: AccessClass;
  principal: string;
  capability: string;
  nodes: string[];
  edgeIds: string[];
}

export function routeKeyOf(path: AccessPath): string {
  return path.nodes.slice(1).join(">");
}

export function toHighlights(
  paths: AccessPath[],
  tone: AccessClass,
  principal: string,
  capability: string,
): HighlightPath[] {
  return paths.map((p, i) => ({
    key: `${tone}:${principal}:${capability}:${i}:${p.edge_ids.join(",")}`,
    routeKey: `${tone}:${routeKeyOf(p)}`,
    tone,
    principal,
    capability,
    nodes: p.nodes,
    edgeIds: p.edge_ids,
  }));
}

export interface RouteGroup {
  routeKey: string;
  tone: AccessClass;
  /** role chain, without the principal (ends at the capability) */
  chain: string[];
  principals: string[];
  paths: HighlightPath[];
  edgeIds: Set<string>;
}

/** Group principal-specific paths that share the same role chain into one "route". */
export function groupRoutes(highlights: HighlightPath[]): RouteGroup[] {
  const groups = new Map<string, RouteGroup>();
  for (const h of highlights) {
    let g = groups.get(h.routeKey);
    if (!g) {
      g = {
        routeKey: h.routeKey,
        tone: h.tone,
        chain: h.nodes.slice(1),
        principals: [],
        paths: [],
        edgeIds: new Set(),
      };
      groups.set(h.routeKey, g);
    }
    if (!g.principals.includes(h.principal)) g.principals.push(h.principal);
    g.paths.push(h);
    for (const id of h.edgeIds) g.edgeIds.add(id);
  }
  return [...groups.values()];
}

export function edgeId(source: string, type: EdgeType, target: string): string {
  return `${source}|${type}|${target}`;
}

/**
 * Enumerate role-based routes from a principal to a capability in a graph snapshot:
 * ASSIGNED_TO → INHERITS*0..maxDepth → GRANTS. Mirrors the planner's bounded path query and
 * is only used to trace routes inside repair-plan snapshots (Before / After), where the API
 * returns graph structure but not per-pair path lists.
 */
export function traceRoutes(
  graph: GraphSnapshot,
  principal: string,
  capability: string,
  maxDepth = 6,
): AccessPath[] {
  const out = new Map<string, { target: string; type: EdgeType; id: string }[]>();
  for (const e of graph.edges) {
    out.set(e.source, [...(out.get(e.source) ?? []), { target: e.target, type: e.type, id: e.id }]);
  }
  const results: AccessPath[] = [];
  const walk = (
    role: string,
    nodes: string[],
    edges: EdgeType[],
    ids: string[],
    inheritsUsed: number,
  ) => {
    for (const next of out.get(role) ?? []) {
      if (next.type === "GRANTS" && next.target === capability) {
        results.push({
          nodes: [...nodes, next.target],
          edges: [...edges, "GRANTS"],
          edge_ids: [...ids, next.id],
        });
      } else if (next.type === "INHERITS" && inheritsUsed < maxDepth && !nodes.includes(next.target)) {
        walk(next.target, [...nodes, next.target], [...edges, "INHERITS"], [...ids, next.id], inheritsUsed + 1);
      }
    }
  };
  for (const first of out.get(principal) ?? []) {
    if (first.type !== "ASSIGNED_TO") continue;
    walk(first.target, [principal, first.target], ["ASSIGNED_TO"], [first.id], 0);
  }
  return results.sort((a, b) => a.edge_ids.join().localeCompare(b.edge_ids.join()));
}

/** Edge ids that two sets of highlights have in common. */
export function sharedEdges(a: HighlightPath[], b: HighlightPath[]): string[] {
  const left = new Set(a.flatMap((h) => h.edgeIds));
  return [...new Set(b.flatMap((h) => h.edgeIds))].filter((id) => left.has(id));
}

export function parseEdgeId(id: string): { source: string; type: string; target: string } | null {
  const parts = id.split("|");
  if (parts.length !== 3) return null;
  return { source: parts[0], type: parts[1], target: parts[2] };
}
