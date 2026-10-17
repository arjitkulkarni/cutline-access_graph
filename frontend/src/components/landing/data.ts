/**
 * Landing-page content. Every number here comes from the project itself: README.md,
 * docs/benchmarks.md (real FalkorDB Cloud run) and the recorded live end-to-end walk.
 * Keep it in sync when those change; do not round results up.
 */

export const HACKATHON = {
  name: "Graph Hacks: Context for AI Agents",
  hosts: "FalkorDB × WeMakeDevs",
  url: "https://www.wemakedevs.org/hackathons/falkordb",
  track: "Track 01 · Agents That Act on Connected Data",
} as const;

export const NAV_LINKS = [
  { href: "#trace", label: "Repair" },
  { href: "#isolation", label: "Isolation" },
  { href: "#proof", label: "Proof" },
  { href: "#how", label: "Protocol" },
  { href: "#falkordb", label: "FalkorDB" },
  { href: "#results", label: "Results" },
] as const;

export type Verdict = "rejected" | "pass";

export const CANDIDATES: Array<{ fix: string; verdict: Verdict; why: string; path?: string }> = [
  {
    fix: "Revoke export_customers from Shared Ops",
    verdict: "rejected",
    why: "Felix loses export, so Finance close breaks. Maya still exports through Export Helper.",
  },
  {
    fix: "Detach Shared Ops from Support",
    verdict: "rejected",
    why: "A forbidden route is still open:",
    path: "maya → support → export_helper → export_customers",
  },
  {
    fix: "Detach Export Helper from Support",
    verdict: "rejected",
    why: "A forbidden route is still open:",
    path: "maya → support → shared_ops → export_customers",
  },
  {
    fix: "Detach both bundles from Support",
    verdict: "rejected",
    why: "The DSAR Bot loses export, so legally required DSAR fulfilment breaks.",
  },
  {
    fix: "Remove Maya and Noah from Support",
    verdict: "rejected",
    why: "They lose view_orders and generate_reports, so Order support breaks.",
  },
  {
    fix: "Create Support (safe) and move Maya and Noah onto it",
    verdict: "pass",
    why: "All 8 constraints hold. Nobody gains access they did not already have.",
  },
];

export const MIGRATION: Array<{ op: string; sign: "+" | "−"; text: string }> = [
  { op: "CREATE_ROLE", sign: "+", text: "support_safe" },
  { op: "ADD_GRANT", sign: "+", text: "support_safe → generate_reports" },
  { op: "ADD_GRANT", sign: "+", text: "support_safe → view_orders" },
  { op: "ASSIGN_ROLE", sign: "+", text: "maya → support_safe" },
  { op: "ASSIGN_ROLE", sign: "+", text: "noah → support_safe" },
  { op: "UNASSIGN_ROLE", sign: "−", text: "maya ✕ support" },
  { op: "UNASSIGN_ROLE", sign: "−", text: "noah ✕ support" },
];

export const PIPELINE = [
  {
    title: "Discover",
    body: "FalkorDB returns every bounded route from a person to a forbidden capability, not just direct grants.",
    tag: "[:INHERITS*0..6]",
  },
  {
    title: "Contract",
    body: "Guardrails (must deny) and workflows (must keep working) are graph nodes. Plain-English additions are parsed, then confirmed by a human.",
    tag: "2 must-deny · 6 must-allow",
  },
  {
    title: "Plan",
    body: "Bounded, deterministic candidates: single cuts, minimal hitting sets, scoped-role migration. Each one runs on its own graph copy.",
    tag: "GRAPH.COPY per candidate",
  },
  {
    title: "Verify",
    body: "Real HTTP requests hit a running app. An independent enforcement point decides; it must agree with FalkorDB on every check.",
    tag: "12 real requests",
  },
  {
    title: "Approve & apply",
    body: "A human signs off. All edits land in one Cypher statement guarded by a revision compare-and-set, then the checks re-run live.",
    tag: "1 atomic write",
  },
  {
    title: "Stay honest",
    body: "Evidence is bound to a revision and a content hash. When the policy moves, the proof goes stale, apply is refused, and CUTLINE re-plans.",
    tag: "revision + sha256",
  },
] as const;

export type CheckGroup = "deny" | "keep" | "unchanged";

export const CHECKS: Array<{
  group: CheckGroup;
  who: string;
  method: "GET" | "POST";
  path: string;
  before: 200 | 403;
  after: 200 | 403;
}> = [
  { group: "deny", who: "Maya", method: "POST", path: "/demo/customers/export", before: 200, after: 403 },
  { group: "deny", who: "Noah", method: "POST", path: "/demo/customers/export", before: 200, after: 403 },
  { group: "keep", who: "Felix", method: "POST", path: "/demo/customers/export", before: 200, after: 200 },
  { group: "keep", who: "DSAR Bot", method: "POST", path: "/demo/customers/export", before: 200, after: 200 },
  { group: "keep", who: "Maya", method: "GET", path: "/demo/orders", before: 200, after: 200 },
  { group: "keep", who: "Maya", method: "GET", path: "/demo/reports", before: 200, after: 200 },
  { group: "keep", who: "Noah", method: "GET", path: "/demo/orders", before: 200, after: 200 },
  { group: "keep", who: "Noah", method: "GET", path: "/demo/reports", before: 200, after: 200 },
  { group: "unchanged", who: "Felix", method: "GET", path: "/demo/orders", before: 403, after: 403 },
  { group: "unchanged", who: "Felix", method: "GET", path: "/demo/reports", before: 403, after: 403 },
  { group: "unchanged", who: "DSAR Bot", method: "GET", path: "/demo/orders", before: 200, after: 200 },
  { group: "unchanged", who: "DSAR Bot", method: "GET", path: "/demo/reports", before: 200, after: 200 },
];

export const FALKOR_WORK = [
  { work: "Effective-access reachability and multi-path witnesses", how: "Variable-length Cypher traversal" },
  { work: "Business intent: workflows, guardrails, the derived contract", how: "Graph nodes and relationships" },
  { work: "Candidate isolation", how: "GRAPH.COPY: one throw-away graph per candidate" },
  { work: "Counterexamples: path still open, workflow lost, new privilege", how: "Re-querying the candidate graph" },
  { work: "Atomic, revision-guarded application", how: "One parameterised Cypher statement" },
  { work: "Evidence ledger and cross-session agent memory", how: "The cutline_dev__ledger graph" },
  { work: "What the enforcement point reads at runtime", how: "One-hop relations from the selected graph" },
] as const;

export const TRACK_FIT = [
  { ask: "Multi-hop reasoning", how: "Person → role → inherited roles → capability, up to 6 inheritance hops, every independent route." },
  { ask: "Graph queries as agent tools", how: "11 typed tools, each running fixed, parameterised Cypher on FalkorDB." },
  { ask: "Tool selection through MCP", how: "The same tools ship as an MCP server (Python SDK v2); the model picks which to call." },
  { ask: "Actions based on the graph", how: "Repairs are generated from the discovered paths and applied after human approval." },
  { ask: "Explainable results", how: "Every rejection carries a witness path or the named workflow it breaks." },
] as const;

/** A recorded deterministic agent run, taken after the live challenge (16 Oct, 17:31 IST). */
export const AGENT_RUN = [
  { tool: "inspect_policy", out: "4 principals, 6 roles · 2 guardrail violations", ms: 184 },
  { tool: "recall_history", out: "3 earlier repairs read from the FalkorDB ledger", ms: 777 },
  { tool: "find_risks", out: "2 risky paths: maya and noah → export_customers", ms: 330 },
  { tool: "trace_access", out: "maya → support_safe → contractor_tools → export_customers", ms: 180 },
  { tool: "trace_access", out: "noah → support_safe → contractor_tools → export_customers", ms: 91 },
  { tool: "propose_repair", out: "1 edit chosen · 1 candidate rejected with a counterexample", ms: 604 },
  { tool: "verify_repair", out: "VERIFIED · runtime checks passed", ms: 2230 },
] as const;

export const TOOLS: Array<{ name: string; kind: "read" | "isolated" | "destructive" }> = [
  { name: "inspect_policy", kind: "read" },
  { name: "find_risks", kind: "read" },
  { name: "trace_access", kind: "read" },
  { name: "check_access", kind: "read" },
  { name: "recall_history", kind: "read" },
  { name: "get_contract", kind: "read" },
  { name: "get_evidence", kind: "read" },
  { name: "export_regression_tests", kind: "read" },
  { name: "propose_repair", kind: "isolated" },
  { name: "verify_repair", kind: "isolated" },
  { name: "apply_repair", kind: "destructive" },
];

export const BENCHMARKS = {
  correct: { value: 10, of: 10 },
  safe: { value: 7, of: 7, baseline: 2, baselineLabel: "Greedy revoke-at-source" },
  detected: { value: 11, of: 12, baseline: 7, baselineLabel: "Direct-grant checker" },
  medianPlanSeconds: 1.46,
  tests: { value: 72, of: 72 },
  scenarios: [
    { name: "The demo: two inherited paths; Finance and DSAR share the roles", outcome: "Scoped role · 7 edits" },
    { name: "Needed and forbidden capability bundled in one role", outcome: "Scoped role · 4 edits" },
    { name: "Forbidden capability three hops down a private chain", outcome: "Single cut · 1 edit" },
    { name: "Roles inherit each other in a cycle", outcome: "Single cut · 1 edit" },
    { name: "Dedicated export role shared with a legitimate user", outcome: "Single cut · 1 edit" },
    { name: "One subject, two forbidden capabilities", outcome: "Scoped role · 5 edits" },
    { name: "Two subjects keep different capabilities", outcome: "Scoped role · 8 edits" },
    { name: "A required capability the subject never had", outcome: "Infeasible: refuses to invent a grant" },
    { name: "Guardrail already holds", outcome: "No violations: nothing to do" },
    { name: "An 8-hop chain beyond the 6-hop planner bound", outcome: "Disagreement flagged by the independent engine" },
  ],
} as const;
