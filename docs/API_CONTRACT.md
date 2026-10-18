# CUTLINE — Architecture & API Contract (source of truth)

This file is the shared contract between the FastAPI backend (`backend/`) and the Next.js console
(`frontend/`). Backend Pydantic models mirror these TypeScript shapes exactly (snake_case JSON).

---

## 1. Demo scenario — "Customer Operations"

| Kind | id | Display name | Notes |
|---|---|---|---|
| User (human) | `maya` | Maya Chen | department `support` |
| User (human) | `noah` | Noah Patel | department `support` |
| User (human) | `felix` | Felix Romero | department `finance` |
| User (service) | `dsar_bot` | DSAR Bot | service identity that fulfils data-subject access requests |
| Role | `support` | Support | assigned to maya, noah, dsar_bot |
| Role | `shared_ops` | Shared Ops | shared bundle used by Support and Finance |
| Role | `export_helper` | Export Helper | attached to Support so the DSAR bot could export |
| Role | `finance` | Finance | assigned to felix |
| Capability | `view_orders` | View orders | sensitivity `internal`, resource `orders` |
| Capability | `generate_reports` | Generate reports | sensitivity `internal`, resource `reports` |
| Capability | `export_customers` | Export customers | sensitivity `restricted`, resource `customer_records` |
| Resource | `orders`, `reports`, `customer_records` | | |

Relationships (direction matters; `A INHERITS B` ⇒ A receives B's grants):

```
maya     -[:ASSIGNED_TO]-> support
noah     -[:ASSIGNED_TO]-> support
dsar_bot -[:ASSIGNED_TO]-> support
felix    -[:ASSIGNED_TO]-> finance
support  -[:INHERITS]->    shared_ops
support  -[:INHERITS]->    export_helper
finance  -[:INHERITS]->    shared_ops
support  -[:GRANTS]->      view_orders
support  -[:GRANTS]->      generate_reports
shared_ops    -[:GRANTS]-> export_customers
export_helper -[:GRANTS]-> export_customers
(Capability)-[:ACTS_ON]->(Resource)
```

Business intent lives in the graph too:

```
(:Workflow {id:'order_support'})  -[:REQUIRES]-> view_orders, generate_reports ; maya, noah -[:PERFORMS]-> it
(:Workflow {id:'finance_close'})  -[:REQUIRES]-> export_customers ; felix -[:PERFORMS]-> it
(:Workflow {id:'dsar_fulfilment'})-[:REQUIRES]-> export_customers ; dsar_bot -[:PERFORMS]-> it
(:Guardrail {id:'no_support_bulk_export'}) -[:FORBIDS]-> export_customers ; -[:APPLIES_TO]-> maya, noah
(:Policy {id:'active', revision:int, updated_at})
```

Derived contract: **must_deny** = maya/noah × export_customers.
**must_allow** = maya/noah × {view_orders, generate_reports}, felix × export_customers, dsar_bot × export_customers.

Why naive fixes fail (all proven by FalkorDB on isolated candidate graphs):

| Candidate | Outcome | Witness |
|---|---|---|
| Revoke `export_customers` from Shared Ops | FAIL | Felix loses export; Maya still exports via Export Helper |
| Detach Shared Ops from Support | FAIL | Maya → Support → Export Helper → export_customers remains |
| Detach both bundles from Support | FAIL | DSAR Bot loses `export_customers` (DSAR fulfilment breaks) |
| Revoke export from Export Helper | FAIL | Maya → Support → Shared Ops → export_customers remains |
| **Create `support_safe` (view_orders, generate_reports); move Maya + Noah** | **PASS** | all constraints hold, no new access |

Live challenge (`POST /api/demo/mutate-policy`): attaches a new `contractor_tools` role (grants
`export_customers`) to Maya's current role → revision bumps, evidence goes stale, a new path appears.

---

## 2. Graph names

- Active policy graph: `${FALKORDB_GRAPH}` (default `cutline_dev`)
- Candidate graphs: `${FALKORDB_GRAPH}__cand__<repair_id>__<n>` (created with `GRAPH.COPY`, deleted after use)
- Evidence ledger graph: `${FALKORDB_GRAPH}__ledger`

---

## 3. REST API (FastAPI, prefix `/api`)

All errors: HTTP 4xx/5xx with body `{ "error": { "code": string, "message": string, "details"?: object } }`.
Codes: `FALKORDB_UNAVAILABLE` (503), `NOT_FOUND` (404), `STALE_PROPOSAL` (409), `NOT_VERIFIED` (409),
`NOT_APPROVED` (409), `INVALID_STATE` (409), `VALIDATION_ERROR` (422), `DEMO_MODE_DISABLED` (403),
`AUTHZ_ENGINE_UNAVAILABLE` (503), `INTERNAL` (500).

```ts
// ---------- shared ----------
type NodeKind = "user" | "role" | "capability" | "resource";
type EdgeType = "ASSIGNED_TO" | "INHERITS" | "GRANTS" | "ACTS_ON";

interface GraphNode {
  id: string;                 // stable id, e.g. "maya", "shared_ops"
  kind: NodeKind;
  label: string;              // display name
  props: Record<string, string | number | boolean | null>; // e.g. department, sensitivity, principal_type
}
interface GraphEdge {
  id: string;                 // `${source}|${type}|${target}`
  source: string;
  target: string;
  type: EdgeType;
}
interface PolicyRevision {
  revision: number;
  hash: string;               // "sha256:..." over canonical policy edges
  updated_at: string;         // ISO-8601
}

// ---------- probes (no /api prefix; for platforms and uptime monitors) ----------
// GET /health -> 200 { status: "ok"; version: string }        liveness, touches no dependency
// GET /ready  -> 200 { status: "ready"; falkordb: { connected: true; latency_ms: number } }
//             |  503 { status: "unavailable"; falkordb: { connected: false; error: string } }

// ---------- GET /api/health ----------
interface Health {
  status: "ok" | "degraded";
  // host is "[hidden]:<port>" when ENVIRONMENT=production
  falkordb: { connected: boolean; host: string; graph: string; latency_ms: number | null; error: string | null };
  demo_mode: boolean;
  authz_engine: { name: "reference" | "opa"; available: boolean; detail: string | null };
  llm: { configured: boolean; model: string | null };
  version: string;
}

// ---------- GET /api/scenarios ----------
interface Scenario { id: "customer-ops"; name: string; description: string; active: boolean }
// POST /api/scenarios/customer-ops/reset  -> { revision: PolicyRevision }   (demo mode only)

// ---------- GET /api/graph ----------
interface GraphResponse {
  revision: PolicyRevision;
  nodes: GraphNode[];
  edges: GraphEdge[];
  workflows: { id: string; name: string; requires: string[]; performers: string[] }[];
  guardrails: { id: string; description: string; forbids: string[]; applies_to: string[] }[];
  query_ms: number;
}

// ---------- GET /api/policy/revision -> PolicyRevision ----------

// ---------- POST /api/access/paths  { principal, capability, max_depth?: number } ----------
interface AccessPath {
  nodes: string[];            // ["maya","support","shared_ops","export_customers"]
  edges: EdgeType[];          // ["ASSIGNED_TO","INHERITS","GRANTS"]
  edge_ids: string[];         // GraphEdge ids along the path
}
interface PathsResponse {
  principal: string; capability: string; allowed: boolean;
  paths: AccessPath[];
  cypher: string;             // the exact parameterized query that produced this
  query_ms: number;
  revision: PolicyRevision;
}
// ---------- POST /api/access/check { principal, capability } ----------
interface CheckResponse { principal: string; capability: string; allowed: boolean; path_count: number; witness: AccessPath | null }

// ---------- GET /api/risks ----------  (all must_deny violations on the active graph)
interface RiskFinding {
  principal: string; capability: string;
  guardrail: string | null;   // guardrail id that forbids it
  paths: AccessPath[];        // every route (multi-path)
}
interface RisksResponse { revision: PolicyRevision; findings: RiskFinding[]; risky_path_count: number }

// ---------- contract ----------
interface ConstraintPair { principal: string; capability: string; source: string } // source: "guardrail:<id>" | "workflow:<id>" | "operator"
interface Contract { must_deny: ConstraintPair[]; must_allow: ConstraintPair[] }
// GET  /api/contract                  -> Contract (derived from Workflow/Guardrail nodes)
// POST /api/contract/parse { text }   -> { contract: Contract; notes: string[]; unresolved: string[]; parser: "rules" | "llm" }

// ---------- repairs ----------
type EditOp = "CREATE_ROLE" | "ADD_GRANT" | "REMOVE_GRANT" | "ADD_INHERITS" | "REMOVE_INHERITS" | "ASSIGN_ROLE" | "UNASSIGN_ROLE";
interface Edit {
  op: EditOp;
  // CREATE_ROLE: role,name | ADD/REMOVE_GRANT: role,capability | ADD/REMOVE_INHERITS: role(child),parent
  // ASSIGN/UNASSIGN_ROLE: principal,role
  role?: string; name?: string; capability?: string; parent?: string; principal?: string;
  reason: string;             // why this edit is needed
}
type Outcome = "PASS" | "FAIL_FORBIDDEN_PATH" | "FAIL_REQUIRED_WORKFLOW" | "FAIL_NEW_PRIVILEGE";
interface Violation {
  kind: "FORBIDDEN_PATH" | "REQUIRED_LOST" | "NEW_PRIVILEGE";
  principal: string; capability: string;
  path: AccessPath | null;     // witness path for FORBIDDEN_PATH / NEW_PRIVILEGE
  broken_by: string[];         // edit descriptions responsible for REQUIRED_LOST
  workflow: string | null;     // workflow id that breaks (REQUIRED_LOST)
}
interface CostBreakdown { edits: number; shared_role_penalty: number; collateral_penalty: number; total: number; notes: string[] }
interface Candidate {
  id: string;                  // "c1".."cN"
  family: "single_cut" | "multi_cut" | "scoped_role_migration";
  title: string;               // e.g. "Revoke export_customers from Shared Ops"
  edits: Edit[];
  outcome: Outcome;
  violations: Violation[];
  cost: CostBreakdown;
  candidate_graph: string;     // FalkorDB graph it was evaluated on
  isolation: "GRAPH.COPY" | "snapshot-replay";
  eval_ms: number;
}
type RepairStatus =
  | "NO_VIOLATIONS" | "PROPOSED" | "INFEASIBLE_WITHIN_BUDGET"
  | "VERIFIED" | "VERIFICATION_FAILED" | "APPROVED"
  | "APPLIED" | "APPLY_VERIFICATION_FAILED";
interface AccessMatrixRow { principal: string; capability: string; before: boolean; after: boolean; expected: "allow" | "deny" | null }
interface RepairPlan {
  id: string;                  // "rp_xxxxxx"
  status: RepairStatus;
  created_at: string;
  base_revision: PolicyRevision;
  contract: Contract;
  candidates: Candidate[];     // ranked by cost, rejected ones included with counterexamples
  chosen_candidate_id: string | null;
  edits: Edit[];               // chosen edits ([] if none)
  access_matrix: AccessMatrixRow[]; // before vs after(chosen) for all principals x capabilities
  before_graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  after_graph: { nodes: GraphNode[]; edges: GraphEdge[] } | null;
  budget: { max_candidates: number; max_cut_size: number; max_depth: number; generated: number; evaluated: number };
  residual_notes: string[];    // e.g. "Role support keeps export reachability; only dsar_bot holds it"
  stale: boolean;              // computed live: current revision != base_revision
  current_revision: PolicyRevision;
  verification: Verification | null;      // candidate (pre-apply) runtime verification
  approval: Approval | null;
  application: Application | null;
}
interface RuntimeCheck {
  id: string;                  // "maya:export_customers"
  principal: string; capability: string;
  method: "GET" | "POST"; path: string;   // e.g. "POST /demo/customers/export"
  expected: "allow" | "deny";
  graph_prediction: "allow" | "deny";      // FalkorDB reachability on the evaluated graph
  status_code: number;                     // actual HTTP status from the demo API
  decision: "allow" | "deny";              // what the enforcement point decided
  engine: "reference" | "opa";
  decision_id: string | null;
  latency_ms: number;
  passed: boolean;                         // decision == expected AND graph_prediction == decision
}
interface Verification {
  id: string;
  kind: "candidate" | "post_apply";
  policy_target: string;       // "candidate:<repair_id>" | "active"
  graph: string;               // FalkorDB graph the enforcement point read
  revision: PolicyRevision;    // revision the verification is bound to
  started_at: string; finished_at: string;
  passed: boolean;
  checks: RuntimeCheck[];
  baseline_checks: RuntimeCheck[];   // same requests against the active policy (the "Before" column)
}
interface Approval { approved_by: string; approved_at: string; note: string | null; edits_hash: string }
interface Application {
  applied_at: string;
  from_revision: PolicyRevision; to_revision: PolicyRevision;
  write: { nodes_created: number; relationships_created: number; relationships_deleted: number; query_ms: number; atomic: true };
  post_apply_verification: Verification | null;
  status: "APPLIED" | "APPLY_VERIFICATION_FAILED";
}
// POST /api/repairs/plan     { contract?: Contract } -> RepairPlan
// GET  /api/repairs          -> { repairs: RepairPlan[] } (newest first)
// GET  /api/repairs/{id}     -> RepairPlan
// POST /api/repairs/{id}/verify                         -> RepairPlan (verification filled)
// POST /api/repairs/{id}/approve { approved_by, note? } -> RepairPlan (requires VERIFIED, not stale)
// POST /api/repairs/{id}/apply                          -> RepairPlan (requires APPROVED, not stale; guarded atomic write)

// ---------- GET /api/evidence/{repair_id} ----------
interface Evidence {
  repair_id: string;
  status: RepairStatus;
  stale: boolean; stale_reason: string | null;
  base_revision: PolicyRevision; current_revision: PolicyRevision;
  contract: Contract;
  edits: Edit[];
  permissions_removed: { principal: string; capability: string }[];
  workflows_preserved: { workflow: string; principal: string; capability: string; ok: boolean }[];
  candidate_verification: Verification | null;
  post_apply_verification: Verification | null;
  approval: Approval | null; application: Application | null;
  rejected_candidates: { id: string; title: string; outcome: Outcome; first_violation: Violation | null }[];
  graphs: { active: string; candidate: string | null; ledger: string };
  generated_at: string;
}

// ---------- GET /api/regression-tests/{repair_id} ----------
interface RegressionCase {
  name: string;                // "test_maya_cannot_export_customers"
  principal: string; capability: string;
  method: "GET" | "POST"; path: string;
  expected: "allow" | "deny"; expected_status: 200 | 403;
  source: string;              // guardrail/workflow provenance
  last_result: { status_code: number; decision: "allow" | "deny"; passed: boolean; target: string } | null;
}
interface RegressionSuite { repair_id: string; revision: PolicyRevision; cases: RegressionCase[] }
// GET /api/regression-tests/{repair_id}/export?format=json   -> JSON spec (download)
// GET /api/regression-tests/{repair_id}/export?format=pytest -> text/x-python (download, executable)

// ---------- GET /api/activity ----------
interface ActivityEvent { id: string; ts: string; kind: "seeded" | "planned" | "verified" | "approved" | "applied" | "mutated" | "reset" | "verification_failed";
  summary: string; revision: number; repair_id: string | null }
// -> { events: ActivityEvent[] } newest first

// ---------- POST /api/demo/mutate-policy { mutation: "contractor_tools" | "direct_export_helper" } ----------
// -> { revision: PolicyRevision; summary: string; new_paths: AccessPath[] }   (demo mode only)

// ---------- agent (Track 01) ----------
// POST /api/agent/investigate { text?: string; contract?: Contract }
interface AgentStep { tool: string; input: Record<string, unknown>; summary: string; ms: number }
interface AgentRun { mode: "llm" | "deterministic"; model: string | null; steps: AgentStep[]; repair_id: string | null; narrative: string }
```

### Synthetic Customer Ops API (the enforcement point — independent of the planner)

| Capability | Endpoint |
|---|---|
| `view_orders` | `GET /demo/orders` |
| `generate_reports` | `GET /demo/reports` |
| `export_customers` | `POST /demo/customers/export` |

Headers: `X-Cutline-Principal: <user id>` (development-only principal selector — not authentication),
`X-Cutline-Policy: active | candidate:<repair_id>`. Responses: 200 with synthetic data, or 403
`{error:{code:"FORBIDDEN"}}`. Every response carries `X-Cutline-Decision`, `X-Cutline-Engine`,
`X-Cutline-Decision-Id`, `X-Cutline-Graph`.

The enforcement point loads one-hop relations (`ASSIGNED_TO`, `INHERITS`, `GRANTS`) from the selected
FalkorDB graph and decides with an independent engine: `reference` (Python fixpoint closure) or `opa`
(Rego `graph.reachable`). It never calls the planner or the path-query code.

---

## 4. Planner (deterministic, bounded)

1. Read baseline from FalkorDB; derive contract from Workflow/Guardrail nodes (or operator contract).
2. For every must_deny pair, FalkorDB returns **all** bounded paths (`[:INHERITS*0..6]`).
3. Generate candidates (deterministic order):
   - `single_cut`: remove one edge that lies on a forbidden path (ASSIGNED_TO / INHERITS / GRANTS).
   - `multi_cut`: minimal hitting sets (size ≤ 3) that cut every forbidden path.
   - `scoped_role_migration`: create `<role>_safe` granting the subjects' current capabilities minus
     the forbidden ones, assign subjects to it, unassign them from every role on a forbidden path.
4. Evaluate each on an isolated FalkorDB candidate graph (`GRAPH.COPY`, fallback snapshot replay):
   must_deny unreachable, must_allow reachable, no new (principal, capability) pairs.
5. Cost = Σ edit weights (CREATE_ROLE 2, others 1) + 2 × edits mutating a pre-existing role that
   principals outside the contract subjects can reach + 3 × undeclared capabilities lost.
6. Choose the cheapest PASS; if none within budget → `INFEASIBLE_WITHIN_BUDGET`.
