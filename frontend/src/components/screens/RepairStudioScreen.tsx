"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CircleCheck, Info, Play, ShieldCheck, Wrench } from "lucide-react";
import { buildComparison, type CompareView } from "@/lib/compare";
import { toHighlights } from "@/lib/graph/paths";
import { createLabeler } from "@/lib/labels";
import { cn, plural, revisionLabel } from "@/lib/format";
import {
  errorMessage,
  useConnection,
  useContract,
  useGraph,
  useRepair,
  useRepairs,
  useRisks,
  useVerifyRepair,
} from "@/lib/queries";
import {
  accessDelta,
  deriveStages,
  FAMILY_LABEL,
  isEffectivelyStale,
  isVerified,
  statusPresentation,
  verificationCounts,
} from "@/lib/repair";
import type { GraphSnapshot, RepairPlan } from "@/lib/types";
import { useOperatorContract } from "@/state/operator-contract";
import { PageContainer, PageHeader } from "@/components/shell/PageHeader";
import { LiveChallengeControl } from "@/components/shell/ScenarioControls";
import { RevisionTag, StaleBanner, Timestamp } from "@/components/common/Meta";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { AgentRunLog } from "@/components/repair/AgentRunLog";
import { ApplyDialog } from "@/components/repair/ApplyDialog";
import { BeforeAfterComparison } from "@/components/repair/BeforeAfterComparison";
import { CandidateList } from "@/components/repair/CandidateList";
import { ContractPanel } from "@/components/repair/ContractPanel";
import { ExportTestsMenu } from "@/components/repair/ExportTestsMenu";
import { GenerateRepairButton, useGenerateRepair } from "@/components/repair/GenerateRepairAction";
import { MigrationEditList, type EditFocus } from "@/components/repair/MigrationEditList";
import { PlanPicker } from "@/components/repair/PlanPicker";
import { RepairTimeline } from "@/components/repair/RepairTimeline";
import { VerificationTable, type Endpoint } from "@/components/repair/VerificationTable";

/** The comparison canvas leaves resources out: repairs never touch ACTS_ON relations. */
function withoutResources(g: GraphSnapshot): GraphSnapshot {
  const keep = new Set(g.nodes.filter((n) => n.kind !== "resource").map((n) => n.id));
  return { nodes: g.nodes.filter((n) => keep.has(n.id)), edges: g.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
}

export function RepairStudioScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const repairs = useRepairs();
  const graph = useGraph();

  const sorted = useMemo(
    () => [...(repairs.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [repairs.data],
  );
  const planParam = searchParams.get("plan");
  const planId = planParam ?? sorted[0]?.id ?? null;
  const planQuery = useRepair(planId);
  const plan = planQuery.data ?? sorted.find((p) => p.id === planId) ?? null;

  const choosePlan = useCallback(
    (id: string) => router.replace(`${pathname}?plan=${encodeURIComponent(id)}`, { scroll: false }),
    [router, pathname],
  );

  const loadingLedger = repairs.isPending || (Boolean(planId) && !plan && planQuery.isPending);

  return (
    <PageContainer>
      <PageHeader
        title="Repair Studio"
        subtitle="Make the smallest safe change. Prove what survives."
        meta={plan ? <PlanStatusBadge plan={plan} /> : null}
        actions={
          <>
            <PlanPicker plans={sorted} value={plan?.id ?? null} onChange={choosePlan} />
            <LiveChallengeControl />
          </>
        }
      />
      {repairs.isError ? (
        <ErrorState title="Could not load the repair ledger" error={repairs.error} onRetry={() => repairs.refetch()} />
      ) : planQuery.isError && planParam ? (
        <EmptyState
          title={`Plan ${planParam} is not in the ledger`}
          action={
            sorted[0] ? (
              <Link className={buttonClasses("secondary", "md")} href={`/repair?plan=${sorted[0].id}`}>
                Open the latest plan
              </Link>
            ) : (
              <GenerateRepairButton />
            )
          }
        >
          {errorMessage(planQuery.error)}
        </EmptyState>
      ) : loadingLedger || !graph.data ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[104px] rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-[460px] rounded-xl" />
        </div>
      ) : (
        <Studio key={plan?.id ?? "none"} plan={plan} graphNodes={graph.data} />
      )}
    </PageContainer>
  );
}

function PlanStatusBadge({ plan }: { plan: RepairPlan }) {
  const s = statusPresentation(plan.status, isEffectivelyStale(plan));
  return (
    <Badge tone={s.tone} size="md" dot>
      <span className="mono">{plan.id}</span> · {s.label}
    </Badge>
  );
}

function Studio({ plan, graphNodes }: { plan: RepairPlan | null; graphNodes: NonNullable<ReturnType<typeof useGraph>["data"]> }) {
  const risks = useRisks();
  const derivedContract = useContract();
  const operator = useOperatorContract();
  const conn = useConnection();
  const toast = useToast();
  const verify = useVerifyRepair({
    onSuccess: (p) => {
      const c = verificationCounts(p.verification);
      toast.push({
        tone: p.verification?.passed ? "success" : "error",
        title: p.verification?.passed
          ? `Verified · ${c.passed}/${c.total} runtime checks passed`
          : `Verification failed · ${c.total - c.passed} of ${c.total} checks`,
        description: `Real requests against candidate:${p.id} and the active policy.`,
      });
    },
    onError: (err) => toast.push({ tone: "error", title: "Verification could not run", description: errorMessage(err) }),
  });
  const gen = useGenerateRepair();
  const [view, setView] = useState<CompareView>("before");
  const [focus, setFocus] = useState<{ edit: EditFocus; index: number } | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);

  const label = useMemo(
    () =>
      createLabeler({
        nodeLists: [graphNodes.nodes, plan?.after_graph?.nodes, plan?.before_graph.nodes],
        workflows: graphNodes.workflows,
        guardrails: graphNodes.guardrails,
      }),
    [graphNodes, plan],
  );

  const endpoints = useMemo(() => {
    const map: Record<string, Endpoint> = {};
    for (const n of graphNodes.nodes) {
      if (n.kind === "capability" && typeof n.props.method === "string" && typeof n.props.endpoint === "string") {
        map[n.id] = { method: n.props.method, path: n.props.endpoint };
      }
    }
    return map;
  }, [graphNodes]);

  const stale = plan ? isEffectivelyStale(plan) : false;
  const stages = deriveStages(plan, risks.data);
  const contractForView = plan?.contract ?? operator.contract ?? derivedContract.data ?? null;

  const model = useMemo(() => {
    if (plan) {
      return buildComparison(
        withoutResources(plan.before_graph),
        plan.after_graph ? withoutResources(plan.after_graph) : null,
        plan.contract,
      );
    }
    const current = withoutResources(graphNodes);
    const base = buildComparison(current, null, contractForView ?? { must_deny: [], must_allow: [] });
    // No plan yet: show what /api/risks proved on the active graph.
    const fromApi = (risks.data?.findings ?? []).flatMap((f) => toHighlights(f.paths, "unwanted", f.principal, f.capability));
    return { ...base, beforeHighlights: fromApi.length || !risks.data ? fromApi : base.beforeHighlights };
  }, [plan, graphNodes, contractForView, risks.data]);

  const running = verify.isPending && verify.variables === plan?.id;
  const statusOk = plan ? ["PROPOSED", "VERIFIED", "VERIFICATION_FAILED"].includes(plan.status) && Boolean(plan.chosen_candidate_id) : false;
  const canVerify = Boolean(plan) && statusOk && !stale && !running;
  const canApply = Boolean(plan) && !stale && (plan?.status === "VERIFIED" || plan?.status === "APPROVED") && plan?.verification?.passed === true;
  const verifyPrimary = canVerify && (plan?.status === "PROPOSED" || plan?.status === "VERIFICATION_FAILED");
  const delta = plan ? accessDelta(plan.access_matrix) : null;

  const runVerify = () => {
    if (plan) verify.mutate(plan.id);
  };

  const nextHint = (() => {
    if (!plan) return "Generate a repair. Every candidate is tested on an isolated copy of the policy graph — nothing is applied.";
    if (stale) return `The policy moved to ${revisionLabel(plan.current_revision)}. This plan can no longer be verified or applied; generate a new one.`;
    switch (plan.status) {
      case "PROPOSED":
        return "Next: run verification — real HTTP checks against the candidate policy and the active one.";
      case "VERIFICATION_FAILED":
        return "Verification failed. Inspect the failing checks below before re-planning.";
      case "VERIFIED":
        return "Verified against the live enforcement point. Review the edits, then apply them with your approval.";
      case "APPROVED":
        return `Approved by ${plan.approval?.approved_by ?? "an operator"}. Apply when ready.`;
      case "APPLIED":
        return `Applied ${revisionLabel(plan.application?.from_revision)} → ${revisionLabel(plan.application?.to_revision)}. Post-apply verification is shown below.`;
      case "APPLY_VERIFICATION_FAILED":
        return "The write succeeded but post-apply verification failed. Investigate before relying on this policy.";
      case "NO_VIOLATIONS":
        return "Nothing to repair: every must-deny pair is already unreachable.";
      case "INFEASIBLE_WITHIN_BUDGET":
        return "No candidate satisfied the contract within the planner budget.";
      default:
        return "";
    }
  })();

  return (
    <div className="flex flex-col gap-3">
      {/* Stepper + actions */}
      <section className="panel" aria-label="Repair workflow">
        <div className="relative overflow-x-auto px-4 py-3.5">
          <RepairTimeline stages={stages} className="min-w-[640px]" />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-line px-4 py-2.5">
          <p className="flex min-w-[240px] flex-1 items-start gap-2 text-xs leading-[18px] text-fg-2">
            <Info size={13} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
            {nextHint}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={!plan || stale ? "primary" : "secondary"}
              icon={Wrench}
              loading={gen.pending}
              onClick={gen.run}
              title="POST /api/repairs/plan — proposes edits; nothing is applied"
            >
              {gen.pending ? "Testing candidates…" : plan ? "Generate new repair" : "Generate repair"}
            </Button>
            <Button
              variant={verifyPrimary ? "primary" : "secondary"}
              icon={Play}
              disabled={!canVerify}
              loading={running}
              onClick={runVerify}
              title={!plan ? "Generate a repair first" : stale ? "Plan is stale" : !statusOk ? `Not available while ${plan.status}` : undefined}
            >
              {running ? "Running checks…" : plan?.verification ? "Re-run verification" : "Run verification"}
            </Button>
            <ExportTestsMenu
              repairId={plan?.id ?? null}
              disabled={!plan || !plan.chosen_candidate_id}
              disabledReason="Generate a repair to derive its regression tests"
            />
            <Button
              variant={canApply ? "primary" : "secondary"}
              icon={ShieldCheck}
              disabled={!canApply}
              onClick={() => setApplyOpen(true)}
              title={canApply ? "Opens a confirmation — requires your name and review" : "Requires a verified, current plan"}
            >
              Apply verified migration
            </Button>
          </div>
        </div>
      </section>

      {plan && stale ? (
        <StaleBanner
          title={`Evidence is stale — policy moved from ${revisionLabel(plan.application?.to_revision ?? plan.base_revision)} to ${revisionLabel(plan.current_revision)}`}
          action={
            <Button variant="outline-amber" size="sm" icon={Wrench} loading={gen.pending} onClick={gen.run}>
              Re-plan on {revisionLabel(plan.current_revision)}
            </Button>
          }
        >
          {plan.verification
            ? `Verification ${plan.verification.id} was bound to ${revisionLabel(plan.verification.revision)}; its results no longer describe the active policy. Apply is blocked.`
            : "This plan was computed for an earlier revision. Apply is blocked."}
        </StaleBanner>
      ) : null}

      <ContractPanel label={label} defaultOpen={!plan} />

      <BeforeAfterComparison
        model={model}
        matrix={plan?.access_matrix ?? null}
        contract={contractForView ?? { must_deny: [], must_allow: [] }}
        label={label}
        view={view}
        onViewChange={setView}
        focus={focus?.edit ?? null}
        fitKey={plan?.id ?? "current"}
        footer={
          plan ? (
            <>
              Snapshots stored with {plan.id} at {revisionLabel(plan.base_revision)} · routes traced over ASSIGNED_TO → INHERITS ≤{" "}
              {plan.budget.max_depth} → GRANTS · resources hidden
            </>
          ) : (
            <>Active policy {revisionLabel(graphNodes.revision)} · forbidden routes from GET /api/risks · resources hidden</>
          )
        }
        side={
          plan ? (
            <PlanSide plan={plan} label={label} focusIndex={focus?.index ?? null} onFocus={(edit, index) => setFocus(edit && index !== null ? { edit, index } : null)} delta={delta} />
          ) : (
            <div className="flex flex-1 flex-col justify-center">
              <EmptyState
                icon={Wrench}
                title="No repair plan yet"
                action={<GenerateRepairButton label="Generate repair" navigate />}
              >
                CUTLINE generates candidate edits, evaluates each on an isolated FalkorDB copy, and keeps the cheapest one that
                satisfies the contract.
              </EmptyState>
            </div>
          )
        }
      />

      {plan ? (
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
          <CandidateList plan={plan} label={label} />
          <VerificationTable
            title="Runtime verification"
            verification={plan.verification}
            matrix={plan.access_matrix}
            contract={plan.contract}
            label={label}
            endpoints={endpoints}
            running={running}
            stale={stale}
            actions={
              !plan.verification && canVerify ? (
                <Button size="sm" variant="primary" icon={Play} loading={running} onClick={runVerify}>
                  Run verification
                </Button>
              ) : null
            }
          />
        </div>
      ) : null}

      {plan?.application ? <AppliedPanel plan={plan} label={label} endpoints={endpoints} /> : null}

      <AgentRunLog />

      {plan ? (
        <ApplyDialog
          plan={plan}
          open={applyOpen}
          onClose={() => setApplyOpen(false)}
          label={label}
          activeGraph={conn.phase === "connected" ? conn.health.falkordb.graph : "the active policy graph"}
        />
      ) : null}
    </div>
  );
}

function PlanSide({
  plan,
  label,
  focusIndex,
  onFocus,
  delta,
}: {
  plan: RepairPlan;
  label: ReturnType<typeof createLabeler>;
  focusIndex: number | null;
  onFocus: (edit: EditFocus | null, index: number | null) => void;
  delta: ReturnType<typeof accessDelta> | null;
}) {
  const chosen = plan.candidates.find((c) => c.id === plan.chosen_candidate_id) ?? null;
  return (
    <>
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-fg">Migration plan</h2>
          {isVerified(plan) ? (
            <Badge tone="sage" icon={CircleCheck}>
              Verified
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-fg-2">
          {chosen ? (
            <>
              {plural(plan.edits.length, "edit")} · candidate <span className="mono">{chosen.id}</span> · {FAMILY_LABEL[chosen.family]} · cost{" "}
              {chosen.cost.total}
            </>
          ) : plan.status === "NO_VIOLATIONS" ? (
            "No edits needed"
          ) : (
            "No candidate passed"
          )}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {plan.edits.length ? (
          <MigrationEditList edits={plan.edits} label={label} focusedIndex={focusIndex} onFocusEdit={onFocus} />
        ) : (
          <p className="px-3 py-4 text-sm text-fg-2">
            {plan.status === "NO_VIOLATIONS"
              ? "The contract already holds at this revision."
              : "Every candidate violated the contract. Their counterexamples are listed below."}
          </p>
        )}
        {plan.residual_notes.length ? (
          <ul className="mx-2.5 mb-2 mt-1 flex flex-col gap-1.5 rounded-md border border-line bg-inset px-3 py-2 text-[11.5px] leading-[17px] text-fg-2">
            {plan.residual_notes.map((n, i) => (
              <li key={i} className="flex gap-1.5">
                <Info size={12} className="mt-[3px] shrink-0 text-fg-3" aria-hidden />
                {n}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {delta ? (
        <dl className="grid grid-cols-3 border-t border-line text-center">
          <DeltaCell label="Access removed" value={delta.removed.length} tone={delta.removed.length ? "fg" : "muted"} />
          <DeltaCell label="Required kept" value={delta.preserved.length} tone="sage" />
          <DeltaCell label="New access" value={delta.gained.length} tone={delta.gained.length ? "red" : "muted"} />
        </dl>
      ) : null}
    </>
  );
}

function DeltaCell({ label, value, tone }: { label: string; value: number; tone: "fg" | "sage" | "red" | "muted" }) {
  return (
    <div className="border-r border-line px-2 py-2.5 last:border-r-0">
      <dd
        className={cn(
          "tnum text-base font-semibold leading-5",
          tone === "sage" ? "text-sage" : tone === "red" ? "text-red" : tone === "fg" ? "text-fg" : "text-fg-3",
        )}
      >
        {value}
      </dd>
      <dt className="mt-0.5 text-[11px] text-fg-3">{label}</dt>
    </div>
  );
}

function AppliedPanel({
  plan,
  label,
  endpoints,
}: {
  plan: RepairPlan;
  label: ReturnType<typeof createLabeler>;
  endpoints: Record<string, Endpoint>;
}) {
  const app = plan.application;
  if (!app) return null;
  return (
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <section className="panel" aria-labelledby="applied-title">
        <header className="border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 id="applied-title" className="text-sm font-semibold text-fg">
              Applied to the active policy
            </h2>
            <Badge tone={app.status === "APPLIED" ? "sage" : "red"}>{app.status === "APPLIED" ? "Applied" : "Post-apply check failed"}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-fg-2">
            <Timestamp iso={app.applied_at} mode="absolute" /> · approved by {plan.approval?.approved_by ?? "—"}
          </p>
        </header>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3.5 text-sm">
          <div>
            <dt className="label-micro">Revision</dt>
            <dd className="mt-1 flex items-center gap-1.5">
              <RevisionTag revision={app.from_revision} /> <span className="text-fg-3">→</span> <RevisionTag revision={app.to_revision} />
            </dd>
          </div>
          <div>
            <dt className="label-micro">Write</dt>
            <dd className="mt-1 text-[13px] text-fg-2">
              {app.write.atomic ? "Atomic" : "Non-atomic"} · {app.write.query_ms.toFixed(1)} ms
            </dd>
          </div>
          <div>
            <dt className="label-micro">Created</dt>
            <dd className="tnum mt-1 text-[13px] text-fg">
              {plural(app.write.nodes_created, "node")}, {plural(app.write.relationships_created, "relationship")}
            </dd>
          </div>
          <div>
            <dt className="label-micro">Deleted</dt>
            <dd className="tnum mt-1 text-[13px] text-fg">{plural(app.write.relationships_deleted, "relationship")}</dd>
          </div>
        </dl>
      </section>
      <VerificationTable
        title="Post-apply verification"
        variant="post_apply"
        verification={app.post_apply_verification}
        matrix={plan.access_matrix}
        contract={plan.contract}
        label={label}
        endpoints={endpoints}
        stale={isEffectivelyStale(plan)}
        emptyHint="The backend did not record a post-apply verification."
      />
    </div>
  );
}
