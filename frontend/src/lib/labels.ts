import type { GraphNode, GuardrailSummary, NodeKind, WorkflowSummary } from "./types";

/**
 * Resolves stable ids ("maya", "shared_ops") to the display names the API returned.
 * Falls back to the raw id so nothing is ever invented.
 */
export interface Labeler {
  node: (id: string) => string;
  nodeOf: (id: string) => GraphNode | undefined;
  kindOf: (id: string) => NodeKind | undefined;
  workflow: (id: string) => string;
  guardrail: (id: string) => string;
}

export function createLabeler(input: {
  nodeLists?: Array<GraphNode[] | undefined | null>;
  workflows?: WorkflowSummary[];
  guardrails?: GuardrailSummary[];
}): Labeler {
  const nodes = new Map<string, GraphNode>();
  for (const list of input.nodeLists ?? []) {
    for (const n of list ?? []) if (!nodes.has(n.id)) nodes.set(n.id, n);
  }
  const workflows = new Map((input.workflows ?? []).map((w) => [w.id, w]));
  const guardrails = new Map((input.guardrails ?? []).map((g) => [g.id, g]));
  return {
    node: (id) => nodes.get(id)?.label ?? id,
    nodeOf: (id) => nodes.get(id),
    kindOf: (id) => nodes.get(id)?.kind,
    workflow: (id) => workflows.get(id)?.name ?? id,
    guardrail: (id) => guardrails.get(id)?.description ?? id,
  };
}

/** "Export customers" → "export customers" (used to build sentences from API labels). */
export function capabilityPhrase(label: string): string {
  return label ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

export function isServicePrincipal(node: GraphNode | undefined): boolean {
  if (!node) return false;
  const t = node.props?.principal_type;
  return t === "service" || t === "bot";
}

export function isSensitive(node: GraphNode | undefined): boolean {
  const s = node?.props?.sensitivity;
  return s === "restricted" || s === "confidential" || s === "secret";
}
