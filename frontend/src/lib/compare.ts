import type { Labeler } from "./labels";
import { capabilityPhrase } from "./labels";
import { joinNames, plural } from "./format";
import { layoutGraph, unionGraph, type GraphLayout } from "./graph/layout";
import { toHighlights, traceRoutes, type HighlightPath } from "./graph/paths";
import type { Presence } from "./graph/view";
import type { AccessMatrixRow, Contract, GraphSnapshot } from "./types";

export type CompareView = "before" | "after";

export interface ComparisonModel {
  union: GraphSnapshot;
  layout: GraphLayout;
  addedNodes: Set<string>;
  removedNodes: Set<string>;
  addedEdges: Set<string>;
  removedEdges: Set<string>;
  hasAfter: boolean;
  beforeHighlights: HighlightPath[];
  afterHighlights: HighlightPath[];
}

/** Forbidden routes (amber) for every must-deny pair that is reachable in a snapshot. */
function forbiddenRoutes(graph: GraphSnapshot, contract: Contract): HighlightPath[] {
  return contract.must_deny.flatMap((pair) =>
    toHighlights(traceRoutes(graph, pair.principal, pair.capability), "unwanted", pair.principal, pair.capability),
  );
}

/** Required routes (sage) for every must-allow pair that is reachable in a snapshot. */
function requiredRoutes(graph: GraphSnapshot, contract: Contract): HighlightPath[] {
  return contract.must_allow.flatMap((pair) =>
    toHighlights(traceRoutes(graph, pair.principal, pair.capability), "required", pair.principal, pair.capability),
  );
}

export function buildComparison(before: GraphSnapshot, after: GraphSnapshot | null, contract: Contract): ComparisonModel {
  const union = unionGraph(before, after);
  const layout = layoutGraph(union.nodes, union.edges);
  const beforeNodeIds = new Set(before.nodes.map((n) => n.id));
  const beforeEdgeIds = new Set(before.edges.map((e) => e.id));
  const afterNodeIds = new Set((after?.nodes ?? []).map((n) => n.id));
  const afterEdgeIds = new Set((after?.edges ?? []).map((e) => e.id));

  return {
    union,
    layout,
    addedNodes: new Set([...afterNodeIds].filter((id) => !beforeNodeIds.has(id))),
    removedNodes: after ? new Set([...beforeNodeIds].filter((id) => !afterNodeIds.has(id))) : new Set(),
    addedEdges: new Set([...afterEdgeIds].filter((id) => !beforeEdgeIds.has(id))),
    removedEdges: after ? new Set([...beforeEdgeIds].filter((id) => !afterEdgeIds.has(id))) : new Set(),
    hasAfter: Boolean(after),
    beforeHighlights: forbiddenRoutes(before, contract),
    afterHighlights: after ? [...forbiddenRoutes(after, contract), ...requiredRoutes(after, contract)] : [],
  };
}

export function presenceFor(model: ComparisonModel, view: CompareView): {
  nodes: Record<string, Presence>;
  edges: Record<string, Presence>;
  badges: Record<string, string>;
} {
  const nodes: Record<string, Presence> = {};
  const edges: Record<string, Presence> = {};
  const badges: Record<string, string> = {};
  if (view === "before") {
    for (const id of model.addedNodes) nodes[id] = "absent";
    for (const id of model.addedEdges) edges[id] = "absent";
  } else {
    for (const id of model.addedNodes) {
      nodes[id] = "added";
      badges[id] = "New";
    }
    for (const id of model.removedNodes) nodes[id] = "removed";
    for (const id of model.addedEdges) edges[id] = "added";
    for (const id of model.removedEdges) edges[id] = "removed";
  }
  return { nodes, edges, badges };
}

/** "Support can export customers" — the entry roles of the forbidden routes, from data. */
export function beforeCaption(model: ComparisonModel, label: Labeler): { title: string; detail: string } | null {
  const routes = model.beforeHighlights;
  if (!routes.length) return null;
  const entryRoles = [...new Set(routes.map((r) => r.nodes[1]).filter(Boolean))];
  const caps = [...new Set(routes.map((r) => r.capability))];
  const principals = [...new Set(routes.map((r) => r.principal))];
  const bundles = [...new Set(routes.map((r) => r.nodes[r.nodes.length - 2]).filter((id) => !entryRoles.includes(id)))];
  const capText = joinNames(caps.map((c) => capabilityPhrase(label.node(c))));
  return {
    title: `${joinNames(entryRoles.map((r) => label.node(r)))} can ${capText}.`,
    detail: `${joinNames(principals.map((p) => label.node(p)))} reach ${joinNames(caps)} through ${
      bundles.length ? joinNames(bundles.map((b) => label.node(b))) : plural(routes.length, "route")
    } — ${plural(routes.length, "forbidden path")}.`,
  };
}

export function afterCaption(matrix: AccessMatrixRow[], contract: Contract, label: Labeler): { title: string; detail: string; ok: boolean } {
  const denyCaps = new Set(contract.must_deny.map((p) => p.capability));
  const removed = matrix.filter((r) => r.expected === "deny" && r.before && !r.after);
  const stillForbidden = matrix.filter((r) => r.expected === "deny" && r.after);
  const kept = matrix.filter((r) => r.expected === "allow" && r.after && denyCaps.has(r.capability));
  const lostRequired = matrix.filter((r) => r.expected === "allow" && !r.after);
  const gained = matrix.filter((r) => !r.before && r.after);

  if (stillForbidden.length || lostRequired.length) {
    return {
      ok: false,
      title: `${plural(stillForbidden.length, "forbidden pair")} remain, ${plural(lostRequired.length, "required pair")} lost.`,
      detail: "This plan does not satisfy the contract.",
    };
  }
  const caps = [...new Set(removed.map((r) => r.capability))];
  const removedNames = [...new Set(removed.map((r) => label.node(r.principal)))];
  const keptNames = [...new Set(kept.map((r) => label.node(r.principal)))];
  const capText = joinNames(caps.map((c) => capabilityPhrase(label.node(c))));
  return {
    ok: true,
    title: removedNames.length
      ? `${joinNames(removedNames)} can no longer ${capText}.`
      : "No forbidden access to remove.",
    detail: `${keptNames.length ? `${joinNames(keptNames)} keep ${joinNames(caps)}. ` : ""}${
      gained.length ? `${plural(gained.length, "new access pair")} introduced.` : "No new access introduced."
    }`,
  };
}
