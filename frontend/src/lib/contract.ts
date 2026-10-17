import type { ConstraintPair, Contract, RiskFinding } from "./types";

export type ProvenanceKind = "guardrail" | "workflow" | "operator" | "other";

export interface Provenance {
  kind: ProvenanceKind;
  id: string | null;
  raw: string;
}

/** "guardrail:no_support_bulk_export" → { kind: "guardrail", id: "no_support_bulk_export" } */
export function parseSource(source: string): Provenance {
  const raw = source ?? "";
  if (raw === "operator") return { kind: "operator", id: null, raw };
  const idx = raw.indexOf(":");
  if (idx > 0) {
    const prefix = raw.slice(0, idx);
    const id = raw.slice(idx + 1) || null;
    if (prefix === "guardrail" || prefix === "workflow") return { kind: prefix, id, raw };
    if (prefix === "operator") return { kind: "operator", id, raw };
  }
  return { kind: "other", id: raw || null, raw };
}

export function pairKey(principal: string, capability: string): string {
  return `${principal}::${capability}`;
}

export interface ContractIndex {
  deny: Map<string, ConstraintPair[]>;
  allow: Map<string, ConstraintPair[]>;
}

export function indexContract(contract: Contract | null | undefined): ContractIndex {
  const deny = new Map<string, ConstraintPair[]>();
  const allow = new Map<string, ConstraintPair[]>();
  for (const pair of contract?.must_deny ?? []) {
    const key = pairKey(pair.principal, pair.capability);
    deny.set(key, [...(deny.get(key) ?? []), pair]);
  }
  for (const pair of contract?.must_allow ?? []) {
    const key = pairKey(pair.principal, pair.capability);
    allow.set(key, [...(allow.get(key) ?? []), pair]);
  }
  return { deny, allow };
}

/**
 * How a reachable (principal, capability) pair should be read in the graph:
 * - unwanted: FalkorDB reports it as a must-deny violation (or the contract forbids it)
 * - required: the contract requires it (a workflow depends on it)
 * - permitted: ordinary access the contract says nothing about
 */
export type AccessClass = "unwanted" | "required" | "permitted";

export function classifyAccess(
  principal: string,
  capability: string,
  index: ContractIndex,
  riskKeys: Set<string>,
): AccessClass {
  const key = pairKey(principal, capability);
  if (riskKeys.has(key) || index.deny.has(key)) return "unwanted";
  if (index.allow.has(key)) return "required";
  return "permitted";
}

export function riskKeySet(findings: RiskFinding[] | undefined): Set<string> {
  return new Set((findings ?? []).map((f) => pairKey(f.principal, f.capability)));
}

export function contractsEqual(a: Contract | null | undefined, b: Contract | null | undefined): boolean {
  if (!a || !b) return a === b;
  const norm = (pairs: ConstraintPair[]) =>
    pairs
      .map((p) => `${p.principal}|${p.capability}|${p.source}`)
      .sort()
      .join(",");
  return norm(a.must_deny) === norm(b.must_deny) && norm(a.must_allow) === norm(b.must_allow);
}

export function contractSources(contract: Contract): { guardrails: Set<string>; workflows: Set<string>; operator: number } {
  const guardrails = new Set<string>();
  const workflows = new Set<string>();
  let operator = 0;
  for (const pair of [...contract.must_deny, ...contract.must_allow]) {
    const p = parseSource(pair.source);
    if (p.kind === "guardrail" && p.id) guardrails.add(p.id);
    else if (p.kind === "workflow" && p.id) workflows.add(p.id);
    else if (p.kind === "operator") operator += 1;
  }
  return { guardrails, workflows, operator };
}
