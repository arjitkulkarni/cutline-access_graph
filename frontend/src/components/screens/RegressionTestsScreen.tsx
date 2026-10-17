"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileBraces, FileCode, FlaskConical } from "lucide-react";
import { createLabeler } from "@/lib/labels";
import { errorMessage, useGraph, useRegressionDownload, useRegressionSuite, useRepairs, useRevision } from "@/lib/queries";
import { plural, revisionLabel } from "@/lib/format";
import { isEffectivelyStale } from "@/lib/repair";
import type { RegressionExportFormat } from "@/lib/types";
import { PageContainer, PageHeader } from "@/components/shell/PageHeader";
import { RevisionTag, StaleBanner } from "@/components/common/Meta";
import { PlanPicker } from "@/components/repair/PlanPicker";
import { GenerateRepairButton } from "@/components/repair/GenerateRepairAction";
import { RegressionTestList } from "@/components/tests/RegressionTestList";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";

export function RegressionTestsScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const repairs = useRepairs();
  const graph = useGraph();
  const revision = useRevision();
  const download = useRegressionDownload();
  const toast = useToast();

  const sorted = useMemo(
    () => [...(repairs.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [repairs.data],
  );
  const selectedId = searchParams.get("repair") ?? sorted[0]?.id ?? null;
  const plan = sorted.find((p) => p.id === selectedId) ?? null;
  const suite = useRegressionSuite(selectedId);

  const label = useMemo(
    () =>
      createLabeler({
        nodeLists: [graph.data?.nodes, plan?.after_graph?.nodes, plan?.before_graph.nodes],
        workflows: graph.data?.workflows,
        guardrails: graph.data?.guardrails,
      }),
    [graph.data, plan],
  );

  const exportAs = (format: RegressionExportFormat) => {
    if (!selectedId) return;
    download.mutate(
      { repairId: selectedId, format },
      {
        onSuccess: (res) =>
          toast.push({ tone: "success", title: `Downloaded ${res.filename}`, description: `${(res.bytes / 1024).toFixed(1)} KB from the API.` }),
        onError: (err) => toast.push({ tone: "error", title: "Export failed", description: errorMessage(err) }),
      },
    );
  };

  const cases = suite.data?.cases ?? [];
  const passing = cases.filter((c) => c.last_result?.passed).length;
  const lastTarget = cases.find((c) => c.last_result)?.last_result?.target ?? null;
  const suiteStale = plan ? isEffectivelyStale(plan) : false;
  const canExport = Boolean(selectedId && suite.data);

  return (
    <PageContainer>
      <PageHeader
        title="Regression Tests"
        subtitle="Executable checks that keep a repair true after it ships."
        actions={
          <>
            <PlanPicker plans={sorted} value={selectedId} onChange={(id) => router.replace(`${pathname}?repair=${encodeURIComponent(id)}`, { scroll: false })} />
            <Button
              icon={FileBraces}
              disabled={!canExport}
              loading={download.isPending && download.variables?.format === "json"}
              onClick={() => exportAs("json")}
            >
              Export JSON spec
            </Button>
            <Button
              variant="primary"
              icon={FileCode}
              disabled={!canExport}
              loading={download.isPending && download.variables?.format === "pytest"}
              onClick={() => exportAs("pytest")}
            >
              Export pytest
            </Button>
          </>
        }
      />

      {repairs.isError ? (
        <ErrorState title="Could not load the repair ledger" error={repairs.error} onRetry={() => repairs.refetch()} />
      ) : repairs.isPending ? (
        <Skeleton className="h-[480px] rounded-xl" />
      ) : sorted.length === 0 ? (
        <div className="panel">
          <EmptyState icon={FlaskConical} title="No regression suite yet" action={<GenerateRepairButton label="Generate repair" />}>
            A suite is derived from a repair plan: one case per principal and capability, pinned to the decision the contract
            requires — guardrails, required workflows, and access that must not change.
          </EmptyState>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {suiteStale && plan ? (
            <StaleBanner
              title={`This suite protects ${revisionLabel(plan.application?.to_revision ?? plan.base_revision)}; the active policy is ${revisionLabel(plan.current_revision)}`}
            >
              Results below were recorded before the policy moved. Re-run the exported tests, or generate a new repair to derive a
              current suite.
            </StaleBanner>
          ) : null}

          <section className="panel flex flex-wrap items-center gap-x-8 gap-y-4 border-t-sage/40 px-5 py-4" aria-label="Suite summary">
            <div>
              <p className="label-micro">Suite</p>
              <p className="mono mt-0.5 text-[13px] text-fg">{selectedId}</p>
            </div>
            <div>
              <p className="label-micro">Protects</p>
              <div className="mt-0.5">{suite.data ? <RevisionTag revision={suite.data.revision} showHash tone={suiteStale ? "amber" : "neutral"} /> : "—"}</div>
            </div>
            <div>
              <p className="label-micro">Cases</p>
              <p className="tnum mt-0.5 text-[13px] text-fg">{suite.data ? plural(cases.length, "case") : "—"}</p>
            </div>
            <div>
              <p className="label-micro">Last run</p>
              <p className="mt-0.5 flex items-center gap-2 text-[13px]">
                {!suite.data ? (
                  "—"
                ) : lastTarget ? (
                  <>
                    <Badge tone={passing === cases.length ? "sage" : "red"}>
                      {passing}/{cases.length} passing
                    </Badge>
                    <span className="mono text-xs text-fg-3">{lastTarget}</span>
                  </>
                ) : (
                  <span className="text-fg-3">Not run — verify the plan in Repair Studio</span>
                )}
              </p>
            </div>
            {revision.data ? (
              <p className="ml-auto text-xs text-fg-3">
                Active policy <span className="mono text-fg-2">{revisionLabel(revision.data)}</span>
              </p>
            ) : null}
          </section>

          {suite.isError ? (
            <ErrorState title={`Could not load the suite for ${selectedId}`} error={suite.error} onRetry={() => suite.refetch()} />
          ) : suite.data ? (
            <RegressionTestList cases={cases} label={label} rolesFrom={plan?.after_graph ?? plan?.before_graph ?? null} />
          ) : (
            <Skeleton className="h-[420px] rounded-xl" />
          )}
        </div>
      )}
    </PageContainer>
  );
}
