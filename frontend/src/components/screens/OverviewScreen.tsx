"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CircleCheck,
  CircleX,
  Database,
  GitCommitHorizontal,
  Lock,
  RotateCcw,
  UserCheck,
  Waypoints,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { createLabeler, isSensitive } from "@/lib/labels";
import { cn, joinNames, plural, revisionLabel, shortHash } from "@/lib/format";
import { useActivity, useConnection, useGraph, useRepairs, useRevision, useRisks, useScenarios } from "@/lib/queries";
import { isEffectivelyStale, isPending, latestVerification, statusPresentation, verificationCounts } from "@/lib/repair";
import type { ActivityEvent, ActivityKind, GraphNode, RepairPlan, RiskFinding } from "@/lib/types";
import type { Labeler } from "@/lib/labels";
import { PageContainer, PageHeader } from "@/components/shell/PageHeader";
import { ProvenanceChip, RevisionTag, Timestamp } from "@/components/common/Meta";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState, ErrorState, LoadingRows, Skeleton } from "@/components/ui/States";

export function OverviewScreen() {
  const conn = useConnection();
  const revision = useRevision();
  const risks = useRisks();
  const repairs = useRepairs();
  const graph = useGraph();
  const scenarios = useScenarios();

  const label = useMemo(
    () => createLabeler({ nodeLists: [graph.data?.nodes], workflows: graph.data?.workflows, guardrails: graph.data?.guardrails }),
    [graph.data],
  );

  const sorted = useMemo(
    () => [...(repairs.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [repairs.data],
  );
  const pending = sorted.filter(isPending);
  const newest = sorted[0] ?? null;
  const findings = risks.data?.findings ?? [];
  const firstCap = findings[0]?.capability;
  const scenarioName = scenarios.data?.find((s) => s.active)?.name;
  const graphName = conn.phase === "connected" ? conn.health.falkordb.graph : null;

  return (
    <PageContainer>
      <PageHeader
        title="Overview"
        subtitle={
          <>
            {scenarioName ?? "Policy graph"}
            {graphName ? (
              <>
                {" "}
                · <span className="mono text-[12px]">{graphName}</span>
              </>
            ) : null}
          </>
        }
        actions={
          <ButtonLink variant="primary" href={firstCap ? `/graph?focus=${encodeURIComponent(firstCap)}` : "/graph"} icon={Waypoints}>
            Inspect risky access
          </ButtonLink>
        }
      />

      <section aria-label="Operational status" className="panel grid grid-cols-4 overflow-hidden border-t-accent/40 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <Stat
          label="Policy revision"
          loading={revision.isPending}
          value={revision.data ? <span className="font-mono tracking-[-0.03em]">{revisionLabel(revision.data)}</span> : "—"}
          sub={
            revision.data ? (
              <>
                <span className="mono">{shortHash(revision.data.hash)}</span> · updated <Timestamp iso={revision.data.updated_at} />
              </>
            ) : null
          }
        />
        <Stat
          label="Risky access paths"
          loading={risks.isPending}
          value={risks.data ? risks.data.risky_path_count : "—"}
          tone={risks.data && risks.data.risky_path_count > 0 ? "amber" : "sage"}
          sub={
            risks.data
              ? risks.data.risky_path_count > 0
                ? `${plural(new Set(findings.map((f) => f.principal)).size, "principal")} · ${joinNames([...new Set(findings.map((f) => f.capability))])}`
                : "No guardrail is violated"
              : null
          }
        />
        <Stat
          label="Pending repair proposals"
          loading={repairs.isPending}
          value={repairs.data ? pending.length : "—"}
          sub={
            pending[0] ? (
              <Link href={`/repair?plan=${pending[0].id}`} className="hover:text-fg">
                <span className="mono">{pending[0].id}</span> · {statusPresentation(pending[0].status, false).label}
              </Link>
            ) : repairs.data ? (
              newest && isEffectivelyStale(newest) ? "Latest plan is stale" : "None waiting for review"
            ) : null
          }
        />
        <LatestVerificationStat loading={repairs.isPending} plan={newest} />
      </section>

      <div className="mt-3 grid items-start gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <RiskSummary findings={findings} label={label} loading={risks.isPending} error={risks.error} onRetry={() => risks.refetch()} revisionTag={risks.data ? <RevisionTag revision={risks.data.revision} /> : null} graphNodes={graph.data?.nodes ?? []} />
        <ActivityFeed />
      </div>
    </PageContainer>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  loading,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "amber" | "sage" | "red";
  loading?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 border-r border-line-soft px-5 py-5 last:border-r-0 max-lg:[&:nth-child(2)]:border-r-0 max-lg:[&:nth-child(-n+2)]:border-b max-sm:border-b max-sm:border-r-0 max-sm:last:border-b-0">
      <p className="label-micro">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-7 w-16" />
      ) : (
        <p
          className={cn(
            "tnum text-2xl font-medium tracking-[-0.04em]",
            tone === "amber" ? "text-amber" : tone === "sage" ? "text-sage" : tone === "red" ? "text-red" : "text-fg",
          )}
        >
          {value}
        </p>
      )}
      <p className="min-h-4 truncate text-xs text-fg-3">{loading ? null : sub}</p>
    </div>
  );
}

function LatestVerificationStat({ plan, loading }: { plan: RepairPlan | null; loading: boolean }) {
  if (loading) return <Stat label="Latest verification" value="—" loading />;
  if (!plan) return <Stat label="Latest verification" value="Not run" sub="No repair plan yet" />;
  const v = latestVerification(plan);
  const stale = isEffectivelyStale(plan);
  if (!v) {
    return (
      <Stat
        label="Latest verification"
        value="Not run"
        sub={
          <Link href={`/repair?plan=${plan.id}`} className="hover:text-fg">
            <span className="mono">{plan.id}</span> awaits verification
          </Link>
        }
      />
    );
  }
  const c = verificationCounts(v);
  const value = stale ? "Stale" : v.passed ? "Passed" : "Failed";
  return (
    <Stat
      label="Latest verification"
      value={value}
      tone={stale ? "amber" : v.passed ? "sage" : "red"}
      sub={
        <>
          {c.passed}/{c.total} checks · {v.kind === "post_apply" ? "post-apply" : "candidate"} · <Timestamp iso={v.finished_at} />
        </>
      }
    />
  );
}

function RiskSummary({
  findings,
  label,
  loading,
  error,
  onRetry,
  revisionTag,
  graphNodes,
}: {
  findings: RiskFinding[];
  label: Labeler;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  revisionTag: ReactNode;
  graphNodes: GraphNode[];
}) {
  const byCapability = useMemo(() => {
    const map = new Map<string, RiskFinding[]>();
    for (const f of findings) map.set(f.capability, [...(map.get(f.capability) ?? []), f]);
    return [...map.entries()];
  }, [findings]);

  return (
    <section className="panel" aria-labelledby="risk-title">
      <header className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-4">
        <h2 id="risk-title" className="text-sm font-semibold text-fg">
          Risky access
        </h2>
        {revisionTag}
        <span className="ml-auto text-xs text-fg-3">Forbidden routes found by FalkorDB</span>
      </header>
      {error ? (
        <div className="p-4">
          <ErrorState title="Could not load risky paths" error={error} onRetry={onRetry} />
        </div>
      ) : loading ? (
        <div className="p-4">
          <LoadingRows rows={4} />
        </div>
      ) : byCapability.length === 0 ? (
        <EmptyState icon={CircleCheck} title="No forbidden route">
          Every principal that a guardrail restricts is unreachable from the capability it forbids.
        </EmptyState>
      ) : (
        <ul>
          {byCapability.map(([capability, items]) => {
            const node = graphNodes.find((n) => n.id === capability);
            const paths = items.reduce((n, f) => n + f.paths.length, 0);
            return (
              <li key={capability} className="border-b border-line last:border-b-0">
                <div className="flex flex-wrap items-center gap-2.5 px-4 pb-2 pt-4">
                  <span className="mono text-[13px] font-medium text-fg">{capability}</span>
                  {isSensitive(node) ? (
                    <Badge tone="amber" icon={Lock}>
                      {String(node?.props.sensitivity)}
                    </Badge>
                  ) : null}
                  <span className="text-xs text-fg-3">
                    {plural(paths, "path")} · {plural(items.length, "principal")}
                  </span>
                  <Link
                    href={`/graph?focus=${encodeURIComponent(capability)}`}
                    className="ml-auto inline-flex items-center gap-1 text-xs text-fg-2 hover:text-fg"
                  >
                    Trace in graph <ArrowRight size={12} aria-hidden />
                  </Link>
                </div>
                <ul className="px-4 pb-3">
                  {items.map((f) => {
                    const via = [...new Set(f.paths.map((p) => p.nodes.slice(1, -1).map((id) => label.node(id)).join(" › ")))];
                    return (
                      <li key={f.principal} className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-2 border-t border-line-soft py-3 first:border-t-0 max-sm:grid-cols-1">
                        <span className="truncate text-[13px] text-fg">{label.node(f.principal)}</span>
                        <span className="min-w-0 text-xs leading-[18px] text-fg-2">
                          <span className="text-amber/90">{plural(f.paths.length, "route")}</span>
                          {via.map((v) => (
                            <span key={v} className="block truncate text-fg-3">
                              {v}
                            </span>
                          ))}
                        </span>
                        {f.guardrail ? <ProvenanceChip source={`guardrail:${f.guardrail}`} label={label} className="col-span-2 justify-self-start max-sm:col-span-1" /> : <span />}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const ACTIVITY_ICON: Record<ActivityKind, { icon: LucideIcon; cls: string }> = {
  seeded: { icon: Database, cls: "text-fg-2" },
  reset: { icon: RotateCcw, cls: "text-fg-2" },
  planned: { icon: Wrench, cls: "text-fg" },
  verified: { icon: CircleCheck, cls: "text-sage" },
  verification_failed: { icon: CircleX, cls: "text-red" },
  approved: { icon: UserCheck, cls: "text-fg" },
  applied: { icon: GitCommitHorizontal, cls: "text-sage" },
  mutated: { icon: Zap, cls: "text-amber" },
};

function ActivityFeed() {
  const activity = useActivity();
  const events: ActivityEvent[] = (activity.data ?? []).slice(0, 9);
  return (
    <section className="panel" aria-labelledby="activity-title">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 id="activity-title" className="text-sm font-semibold text-fg">
          Recent policy activity
        </h2>
        <span className="ml-auto text-xs text-fg-3">Evidence ledger</span>
      </header>
      {activity.isError ? (
        <div className="p-4">
          <ErrorState title="Could not load activity" error={activity.error} onRetry={() => activity.refetch()} />
        </div>
      ) : activity.isPending ? (
        <div className="p-4">
          <LoadingRows rows={5} />
        </div>
      ) : events.length === 0 ? (
        <EmptyState title="No activity recorded">Seeding, planning, verification and policy changes appear here.</EmptyState>
      ) : (
        <ol className="px-4 py-2">
          {events.map((e, i) => {
            const { icon: Icon, cls } = ACTIVITY_ICON[e.kind] ?? ACTIVITY_ICON.seeded;
            return (
              <li key={e.id} className="relative flex gap-3 py-2">
                {i < events.length - 1 ? <span className="absolute left-[9.5px] top-7 h-[calc(100%-18px)] w-px bg-line" aria-hidden /> : null}
                <span className="relative mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line bg-raised">
                  <Icon size={11} strokeWidth={2} className={cls} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-5 text-fg">{e.summary}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-3">
                    <Timestamp iso={e.ts} />
                    <span className="mono">r{e.revision}</span>
                    {e.repair_id ? (
                      <Link href={`/repair?plan=${e.repair_id}`} className="mono text-fg-2 hover:text-fg">
                        {e.repair_id}
                      </Link>
                    ) : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
