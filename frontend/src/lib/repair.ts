import type { BadgeTone } from "@/components/ui/Badge";
import type { Labeler } from "./labels";
import type {
  AccessMatrixRow,
  Candidate,
  Edit,
  EditOp,
  RepairPlan,
  RepairStatus,
  RisksResponse,
  RuntimeCheck,
  Verification,
  Violation,
} from "./types";
import { edgeId } from "./graph/paths";
import { plural, revisionLabel } from "./format";

type StaleInput = Pick<RepairPlan, "stale" | "application" | "current_revision">;

/**
 * The backend computes `stale` as "current revision ≠ base revision". A plan that was itself
 * applied legitimately moved the revision; it is only stale if the policy moved again after.
 */
export function isEffectivelyStale(plan: StaleInput): boolean {
  if (!plan.stale) return false;
  const app = plan.application;
  if (app && app.to_revision.revision === plan.current_revision.revision) return false;
  return true;
}

/** "Verified" is shown only when a verification really passed and the plan still matches policy. */
export function isVerified(plan: RepairPlan): boolean {
  return plan.verification?.passed === true && !isEffectivelyStale(plan);
}

export function isPending(plan: RepairPlan): boolean {
  return (["PROPOSED", "VERIFIED", "APPROVED"] as RepairStatus[]).includes(plan.status) && !isEffectivelyStale(plan);
}

export function latestVerification(plan: RepairPlan): Verification | null {
  return plan.application?.post_apply_verification ?? plan.verification ?? null;
}

const STATUS_PRESENTATION: Record<RepairStatus, { label: string; tone: BadgeTone }> = {
  NO_VIOLATIONS: { label: "No violations", tone: "sage" },
  PROPOSED: { label: "Proposed", tone: "accent" },
  INFEASIBLE_WITHIN_BUDGET: { label: "Infeasible", tone: "red" },
  VERIFIED: { label: "Verified", tone: "sage" },
  VERIFICATION_FAILED: { label: "Verification failed", tone: "red" },
  APPROVED: { label: "Approved", tone: "accent" },
  APPLIED: { label: "Applied", tone: "sage" },
  APPLY_VERIFICATION_FAILED: { label: "Post-apply check failed", tone: "red" },
};

export function statusPresentation(status: RepairStatus, stale: boolean): { label: string; tone: BadgeTone } {
  const base = STATUS_PRESENTATION[status] ?? { label: status, tone: "muted" as BadgeTone };
  if (stale && status !== "APPLIED" && status !== "APPLY_VERIFICATION_FAILED") {
    return { label: "Stale", tone: "amber" };
  }
  return base;
}

// ---------------------------------------------------------------------------
// Stages (Discover → Plan → Verify → Apply)
// ---------------------------------------------------------------------------

export type StageKey = "discover" | "plan" | "verify" | "apply";
export type StageState = "complete" | "current" | "upcoming" | "failed" | "stale";

export interface Stage {
  key: StageKey;
  label: string;
  state: StageState;
  detail: string;
}

export function verificationCounts(v: Verification | null | undefined): { passed: number; total: number } {
  const checks = v?.checks ?? [];
  return { passed: checks.filter((c) => c.passed).length, total: checks.length };
}

export function deriveStages(plan: RepairPlan | null, risks: RisksResponse | undefined): Stage[] {
  const stale = plan ? isEffectivelyStale(plan) : false;
  const status = plan?.status;

  const discover: Stage = {
    key: "discover",
    label: "Discover",
    state: risks || plan ? "complete" : "current",
    detail: risks
      ? risks.risky_path_count > 0
        ? `${plural(risks.risky_path_count, "risky path")} at ${revisionLabel(risks.revision)}`
        : `No risky paths at ${revisionLabel(risks.revision)}`
      : "Querying FalkorDB…",
  };

  let planStage: Stage;
  if (!plan) {
    planStage = { key: "plan", label: "Plan", state: "current", detail: "No repair plan yet" };
  } else if (status === "NO_VIOLATIONS") {
    planStage = { key: "plan", label: "Plan", state: "complete", detail: "Nothing to repair" };
  } else if (status === "INFEASIBLE_WITHIN_BUDGET") {
    planStage = { key: "plan", label: "Plan", state: "failed", detail: "No passing candidate within budget" };
  } else {
    planStage = {
      key: "plan",
      label: "Plan",
      state: stale ? "stale" : "complete",
      detail: `${plural(plan.budget.evaluated, "candidate")} tested · ${plural(plan.edits.length, "edit")}`,
    };
  }

  let verify: Stage;
  const counts = verificationCounts(plan?.verification);
  if (!plan || status === "NO_VIOLATIONS" || status === "INFEASIBLE_WITHIN_BUDGET") {
    verify = { key: "verify", label: "Verify", state: "upcoming", detail: "Waiting for a plan" };
  } else if (stale && status !== "APPLIED" && status !== "APPLY_VERIFICATION_FAILED") {
    verify = {
      key: "verify",
      label: "Verify",
      state: "stale",
      detail: plan.verification ? `Bound to ${revisionLabel(plan.verification.revision)} — re-plan` : "Policy moved — re-plan",
    };
  } else if (status === "PROPOSED") {
    verify = { key: "verify", label: "Verify", state: "current", detail: "Runtime checks not run" };
  } else if (status === "VERIFICATION_FAILED") {
    verify = {
      key: "verify",
      label: "Verify",
      state: "failed",
      detail: `${counts.total - counts.passed} of ${counts.total} checks failed`,
    };
  } else {
    verify = { key: "verify", label: "Verify", state: "complete", detail: `${counts.passed}/${counts.total} checks passed` };
  }

  let apply: Stage;
  if (status === "APPLIED") {
    apply = {
      key: "apply",
      label: "Apply",
      state: stale ? "stale" : "complete",
      detail: plan?.application
        ? `${revisionLabel(plan.application.from_revision)} → ${revisionLabel(plan.application.to_revision)}`
        : "Applied",
    };
  } else if (status === "APPLY_VERIFICATION_FAILED") {
    apply = { key: "apply", label: "Apply", state: "failed", detail: "Post-apply verification failed" };
  } else if (stale && plan) {
    apply = { key: "apply", label: "Apply", state: "upcoming", detail: "Blocked: plan is stale" };
  } else if (status === "APPROVED") {
    apply = { key: "apply", label: "Apply", state: "current", detail: `Approved by ${plan?.approval?.approved_by ?? "operator"}` };
  } else if (status === "VERIFIED") {
    apply = { key: "apply", label: "Apply", state: "current", detail: "Ready for review" };
  } else {
    apply = { key: "apply", label: "Apply", state: "upcoming", detail: "Requires a verified plan" };
  }

  return [discover, planStage, verify, apply];
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

export type EditSign = "add" | "remove" | "create";

export function editSign(op: EditOp): EditSign {
  if (op === "CREATE_ROLE") return "create";
  if (op === "REMOVE_GRANT" || op === "REMOVE_INHERITS" || op === "UNASSIGN_ROLE") return "remove";
  return "add";
}

export const OP_LABEL: Record<EditOp, string> = {
  CREATE_ROLE: "Create role",
  ADD_GRANT: "Add grant",
  REMOVE_GRANT: "Remove grant",
  ADD_INHERITS: "Add inheritance",
  REMOVE_INHERITS: "Remove inheritance",
  ASSIGN_ROLE: "Assign role",
  UNASSIGN_ROLE: "Unassign role",
};

export interface EditTextPart {
  text: string;
  /** entity id when the part names a node */
  id?: string;
}

/** Sentence for an edit, split so entity names can be styled. */
export function describeEdit(edit: Edit, label: Labeler): EditTextPart[] {
  const n = (id: string | undefined): EditTextPart => ({ text: id ? (edit.op === "CREATE_ROLE" && id === edit.role && edit.name ? edit.name : label.node(id)) : "?", id });
  switch (edit.op) {
    case "CREATE_ROLE":
      return [{ text: "Create role " }, { text: edit.name ?? edit.role ?? "?", id: edit.role }];
    case "ADD_GRANT":
      return [{ text: "Grant " }, n(edit.capability), { text: " to " }, n(edit.role)];
    case "REMOVE_GRANT":
      return [{ text: "Revoke " }, n(edit.capability), { text: " from " }, n(edit.role)];
    case "ADD_INHERITS":
      return [n(edit.role), { text: " inherits " }, n(edit.parent)];
    case "REMOVE_INHERITS":
      return [{ text: "Detach " }, n(edit.parent), { text: " from " }, n(edit.role)];
    case "ASSIGN_ROLE":
      return [{ text: "Assign " }, n(edit.principal), { text: " to " }, n(edit.role)];
    case "UNASSIGN_ROLE":
      return [{ text: "Unassign " }, n(edit.principal), { text: " from " }, n(edit.role)];
    default:
      return [{ text: (edit as Edit).op }];
  }
}

export function editText(edit: Edit, label: Labeler): string {
  return describeEdit(edit, label)
    .map((p) => p.text)
    .join("");
}

/** Graph elements an edit touches (for cross-highlighting in the Before/After canvas). */
export function editTargets(edit: Edit): { edgeIds: string[]; nodeIds: string[] } {
  switch (edit.op) {
    case "CREATE_ROLE":
      return { edgeIds: [], nodeIds: edit.role ? [edit.role] : [] };
    case "ADD_GRANT":
    case "REMOVE_GRANT":
      return edit.role && edit.capability
        ? { edgeIds: [edgeId(edit.role, "GRANTS", edit.capability)], nodeIds: [edit.role, edit.capability] }
        : { edgeIds: [], nodeIds: [] };
    case "ADD_INHERITS":
    case "REMOVE_INHERITS":
      return edit.role && edit.parent
        ? { edgeIds: [edgeId(edit.role, "INHERITS", edit.parent)], nodeIds: [edit.role, edit.parent] }
        : { edgeIds: [], nodeIds: [] };
    case "ASSIGN_ROLE":
    case "UNASSIGN_ROLE":
      return edit.principal && edit.role
        ? { edgeIds: [edgeId(edit.principal, "ASSIGNED_TO", edit.role)], nodeIds: [edit.principal, edit.role] }
        : { edgeIds: [], nodeIds: [] };
    default:
      return { edgeIds: [], nodeIds: [] };
  }
}

// ---------------------------------------------------------------------------
// Candidates & violations
// ---------------------------------------------------------------------------

export const FAMILY_LABEL: Record<Candidate["family"], string> = {
  single_cut: "Single cut",
  multi_cut: "Multi cut",
  scoped_role_migration: "Scoped role migration",
};

export const OUTCOME_PRESENTATION: Record<Candidate["outcome"], { label: string; tone: BadgeTone }> = {
  PASS: { label: "Pass", tone: "sage" },
  FAIL_FORBIDDEN_PATH: { label: "Forbidden path remains", tone: "red" },
  FAIL_REQUIRED_WORKFLOW: { label: "Breaks a workflow", tone: "red" },
  FAIL_NEW_PRIVILEGE: { label: "Grants new access", tone: "red" },
};

export function violationSentence(v: Violation, label: Labeler): string {
  const who = label.node(v.principal);
  const what = label.node(v.capability);
  switch (v.kind) {
    case "FORBIDDEN_PATH":
      return `${who} can still reach ${what}`;
    case "REQUIRED_LOST":
      return v.workflow ? `${who} loses ${what} — ${label.workflow(v.workflow)} breaks` : `${who} loses ${what}`;
    case "NEW_PRIVILEGE":
      return `${who} gains ${what}, which it did not have before`;
    default:
      return `${who} · ${what}`;
  }
}

// ---------------------------------------------------------------------------
// Verification rows & access delta
// ---------------------------------------------------------------------------

export interface CheckRow {
  id: string;
  principal: string;
  capability: string;
  expected: RuntimeCheck["expected"];
  before: RuntimeCheck | null;
  after: RuntimeCheck | null;
}

export function joinChecks(v: Verification): CheckRow[] {
  const baseline = new Map(v.baseline_checks.map((c) => [c.id, c]));
  const rows: CheckRow[] = v.checks.map((c) => ({
    id: c.id,
    principal: c.principal,
    capability: c.capability,
    expected: c.expected,
    before: baseline.get(c.id) ?? null,
    after: c,
  }));
  for (const c of v.baseline_checks) {
    if (!rows.some((r) => r.id === c.id)) {
      rows.push({ id: c.id, principal: c.principal, capability: c.capability, expected: c.expected, before: c, after: null });
    }
  }
  // Must-deny checks first (the reason for the repair), then the preserved workflows.
  return rows.sort((a, b) => (a.expected === b.expected ? 0 : a.expected === "deny" ? -1 : 1));
}

export interface AccessDelta {
  removed: AccessMatrixRow[];
  preserved: AccessMatrixRow[];
  gained: AccessMatrixRow[];
  violations: AccessMatrixRow[];
}

export function accessDelta(matrix: AccessMatrixRow[]): AccessDelta {
  const removed = matrix.filter((r) => r.before && !r.after);
  const gained = matrix.filter((r) => !r.before && r.after);
  const preserved = matrix.filter((r) => r.expected === "allow" && r.after);
  const violations = matrix.filter(
    (r) => (r.expected === "deny" && r.after) || (r.expected === "allow" && !r.after),
  );
  return { removed, preserved, gained, violations };
}
