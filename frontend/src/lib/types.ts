/**
 * CUTLINE API types — a 1:1 mirror of docs/API_CONTRACT.md (snake_case JSON).
 * Keep this file free of UI concerns; components derive view models from these shapes.
 */

// ---------- shared ----------
export type NodeKind = "user" | "role" | "capability" | "resource";
export type EdgeType = "ASSIGNED_TO" | "INHERITS" | "GRANTS" | "ACTS_ON";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  props: Record<string, string | number | boolean | null>;
}

export interface GraphEdge {
  /** `${source}|${type}|${target}` */
  id: string;
  source: string;
  target: string;
  type: EdgeType;
}

export interface PolicyRevision {
  revision: number;
  /** "sha256:..." over canonical policy edges */
  hash: string;
  updated_at: string;
}

// ---------- GET /api/health ----------
export interface Health {
  status: "ok" | "degraded";
  falkordb: {
    connected: boolean;
    host: string;
    graph: string;
    latency_ms: number | null;
    error: string | null;
  };
  demo_mode: boolean;
  authz_engine: { name: "reference" | "opa"; available: boolean; detail: string | null };
  llm: { configured: boolean; model: string | null };
  version: string;
}

// ---------- GET /api/scenarios ----------
export interface Scenario {
  id: "customer-ops";
  name: string;
  description: string;
  active: boolean;
}

export interface ResetScenarioResponse {
  revision: PolicyRevision;
}

// ---------- GET /api/graph ----------
export interface WorkflowSummary {
  id: string;
  name: string;
  requires: string[];
  performers: string[];
}

export interface GuardrailSummary {
  id: string;
  description: string;
  forbids: string[];
  applies_to: string[];
}

export interface GraphResponse {
  revision: PolicyRevision;
  nodes: GraphNode[];
  edges: GraphEdge[];
  workflows: WorkflowSummary[];
  guardrails: GuardrailSummary[];
  query_ms: number;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------- POST /api/access/paths ----------
export interface AccessPath {
  /** e.g. ["maya","support","shared_ops","export_customers"] */
  nodes: string[];
  /** e.g. ["ASSIGNED_TO","INHERITS","GRANTS"] */
  edges: EdgeType[];
  /** GraphEdge ids along the path */
  edge_ids: string[];
}

export interface PathsRequest {
  principal: string;
  capability: string;
  max_depth?: number;
}

export interface PathsResponse {
  principal: string;
  capability: string;
  allowed: boolean;
  paths: AccessPath[];
  cypher: string;
  query_ms: number;
  revision: PolicyRevision;
}

// ---------- POST /api/access/check ----------
export interface CheckResponse {
  principal: string;
  capability: string;
  allowed: boolean;
  path_count: number;
  witness: AccessPath | null;
}

// ---------- GET /api/risks ----------
export interface RiskFinding {
  principal: string;
  capability: string;
  guardrail: string | null;
  paths: AccessPath[];
}

export interface RisksResponse {
  revision: PolicyRevision;
  findings: RiskFinding[];
  risky_path_count: number;
}

// ---------- contract ----------
export interface ConstraintPair {
  principal: string;
  capability: string;
  /** "guardrail:<id>" | "workflow:<id>" | "operator" */
  source: string;
}

export interface Contract {
  must_deny: ConstraintPair[];
  must_allow: ConstraintPair[];
}

export interface ContractParseResponse {
  contract: Contract;
  notes: string[];
  unresolved: string[];
  parser: "rules" | "llm";
}

// ---------- repairs ----------
export type EditOp =
  | "CREATE_ROLE"
  | "ADD_GRANT"
  | "REMOVE_GRANT"
  | "ADD_INHERITS"
  | "REMOVE_INHERITS"
  | "ASSIGN_ROLE"
  | "UNASSIGN_ROLE";

export interface Edit {
  op: EditOp;
  role?: string;
  name?: string;
  capability?: string;
  parent?: string;
  principal?: string;
  /** why this edit is needed */
  reason: string;
}

export type Outcome =
  | "PASS"
  | "FAIL_FORBIDDEN_PATH"
  | "FAIL_REQUIRED_WORKFLOW"
  | "FAIL_NEW_PRIVILEGE";

export interface Violation {
  kind: "FORBIDDEN_PATH" | "REQUIRED_LOST" | "NEW_PRIVILEGE";
  principal: string;
  capability: string;
  path: AccessPath | null;
  broken_by: string[];
  workflow: string | null;
}

export interface CostBreakdown {
  edits: number;
  shared_role_penalty: number;
  collateral_penalty: number;
  total: number;
  notes: string[];
}

export interface Candidate {
  id: string;
  family: "single_cut" | "multi_cut" | "scoped_role_migration";
  title: string;
  edits: Edit[];
  outcome: Outcome;
  violations: Violation[];
  cost: CostBreakdown;
  candidate_graph: string;
  isolation: "GRAPH.COPY" | "snapshot-replay";
  eval_ms: number;
}

export type RepairStatus =
  | "NO_VIOLATIONS"
  | "PROPOSED"
  | "INFEASIBLE_WITHIN_BUDGET"
  | "VERIFIED"
  | "VERIFICATION_FAILED"
  | "APPROVED"
  | "APPLIED"
  | "APPLY_VERIFICATION_FAILED";

export interface AccessMatrixRow {
  principal: string;
  capability: string;
  before: boolean;
  after: boolean;
  expected: "allow" | "deny" | null;
}

export interface RepairBudget {
  max_candidates: number;
  max_cut_size: number;
  max_depth: number;
  generated: number;
  evaluated: number;
}

export interface RepairPlan {
  id: string;
  status: RepairStatus;
  created_at: string;
  base_revision: PolicyRevision;
  contract: Contract;
  candidates: Candidate[];
  chosen_candidate_id: string | null;
  edits: Edit[];
  access_matrix: AccessMatrixRow[];
  before_graph: GraphSnapshot;
  after_graph: GraphSnapshot | null;
  budget: RepairBudget;
  residual_notes: string[];
  stale: boolean;
  current_revision: PolicyRevision;
  verification: Verification | null;
  approval: Approval | null;
  application: Application | null;
}

export type Decision = "allow" | "deny";

export interface RuntimeCheck {
  id: string;
  principal: string;
  capability: string;
  method: "GET" | "POST";
  path: string;
  expected: Decision;
  graph_prediction: Decision;
  status_code: number;
  decision: Decision;
  engine: "reference" | "opa";
  decision_id: string | null;
  latency_ms: number;
  passed: boolean;
}

export interface Verification {
  id: string;
  kind: "candidate" | "post_apply";
  policy_target: string;
  graph: string;
  revision: PolicyRevision;
  started_at: string;
  finished_at: string;
  passed: boolean;
  checks: RuntimeCheck[];
  baseline_checks: RuntimeCheck[];
}

export interface Approval {
  approved_by: string;
  approved_at: string;
  note: string | null;
  edits_hash: string;
}

export interface Application {
  applied_at: string;
  from_revision: PolicyRevision;
  to_revision: PolicyRevision;
  write: {
    nodes_created: number;
    relationships_created: number;
    relationships_deleted: number;
    query_ms: number;
    atomic: true;
  };
  post_apply_verification: Verification | null;
  status: "APPLIED" | "APPLY_VERIFICATION_FAILED";
}

export interface PlanRequest {
  contract?: Contract;
}

export interface ApproveRequest {
  approved_by: string;
  note?: string;
}

export interface RepairsResponse {
  repairs: RepairPlan[];
}

// ---------- GET /api/evidence/{repair_id} ----------
export interface Evidence {
  repair_id: string;
  status: RepairStatus;
  stale: boolean;
  stale_reason: string | null;
  base_revision: PolicyRevision;
  current_revision: PolicyRevision;
  contract: Contract;
  edits: Edit[];
  permissions_removed: { principal: string; capability: string }[];
  workflows_preserved: { workflow: string; principal: string; capability: string; ok: boolean }[];
  candidate_verification: Verification | null;
  post_apply_verification: Verification | null;
  approval: Approval | null;
  application: Application | null;
  rejected_candidates: {
    id: string;
    title: string;
    outcome: Outcome;
    first_violation: Violation | null;
  }[];
  graphs: { active: string; candidate: string | null; ledger: string };
  generated_at: string;
}

// ---------- GET /api/regression-tests/{repair_id} ----------
export interface RegressionCase {
  name: string;
  principal: string;
  capability: string;
  method: "GET" | "POST";
  path: string;
  expected: Decision;
  expected_status: 200 | 403;
  source: string;
  last_result: {
    status_code: number;
    decision: Decision;
    passed: boolean;
    target: string;
  } | null;
}

export interface RegressionSuite {
  repair_id: string;
  revision: PolicyRevision;
  cases: RegressionCase[];
}

export type RegressionExportFormat = "json" | "pytest";

// ---------- GET /api/activity ----------
export type ActivityKind =
  | "seeded"
  | "planned"
  | "verified"
  | "approved"
  | "applied"
  | "mutated"
  | "reset"
  | "verification_failed";

export interface ActivityEvent {
  id: string;
  ts: string;
  kind: ActivityKind;
  summary: string;
  revision: number;
  repair_id: string | null;
}

export interface ActivityResponse {
  events: ActivityEvent[];
}

// ---------- POST /api/demo/mutate-policy ----------
export type PolicyMutation = "contractor_tools" | "direct_export_helper";

export interface MutatePolicyResponse {
  revision: PolicyRevision;
  summary: string;
  new_paths: AccessPath[];
}

// ---------- agent (Track 01) ----------
export interface InvestigateRequest {
  text?: string;
  contract?: Contract;
}

export interface AgentStep {
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  ms: number;
}

export interface AgentRun {
  mode: "llm" | "deterministic";
  model: string | null;
  steps: AgentStep[];
  repair_id: string | null;
  narrative: string;
}

// ---------- errors ----------
export type ApiErrorCode =
  | "FALKORDB_UNAVAILABLE"
  | "NOT_FOUND"
  | "STALE_PROPOSAL"
  | "NOT_VERIFIED"
  | "NOT_APPROVED"
  | "INVALID_STATE"
  | "VALIDATION_ERROR"
  | "DEMO_MODE_DISABLED"
  | "AUTHZ_ENGINE_UNAVAILABLE"
  | "INTERNAL";

export interface ApiErrorBody {
  error: { code: ApiErrorCode | string; message: string; details?: Record<string, unknown> };
}
