"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileDown, ScrollText, Wrench } from "lucide-react";
import { saveJson } from "@/lib/api";
import { createLabeler } from "@/lib/labels";
import { useEvidence, useGraph, useRepairs } from "@/lib/queries";
import { PageContainer, PageHeader } from "@/components/shell/PageHeader";
import { LiveChallengeControl } from "@/components/shell/ScenarioControls";
import { EvidencePanel } from "@/components/evidence/EvidencePanel";
import { RepairLedgerList } from "@/components/evidence/RepairLedgerList";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { GenerateRepairButton } from "@/components/repair/GenerateRepairAction";

export function EvidenceScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const repairs = useRepairs();
  const graph = useGraph();

  const sorted = useMemo(
    () => [...(repairs.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [repairs.data],
  );
  const selectedId = searchParams.get("repair") ?? sorted[0]?.id ?? null;
  const evidence = useEvidence(selectedId);
  const plan = sorted.find((p) => p.id === selectedId);

  const label = useMemo(
    () =>
      createLabeler({
        nodeLists: [graph.data?.nodes, plan?.after_graph?.nodes, plan?.before_graph.nodes],
        workflows: graph.data?.workflows,
        guardrails: graph.data?.guardrails,
      }),
    [graph.data, plan],
  );

  return (
    <PageContainer>
      <PageHeader
        title="Evidence"
        subtitle="What was proven, by which checks, against which policy revision."
        actions={
          <>
            <Button
              icon={FileDown}
              disabled={!evidence.data}
              onClick={() => evidence.data && saveJson(evidence.data, `${evidence.data.repair_id}_evidence.json`)}
              title="Saves the evidence record exactly as the API returned it"
            >
              Download evidence
            </Button>
            {selectedId ? (
              <ButtonLink href={`/repair?plan=${encodeURIComponent(selectedId)}`} icon={Wrench}>
                Open in Repair Studio
              </ButtonLink>
            ) : null}
            <LiveChallengeControl />
          </>
        }
      />
      {repairs.isError ? (
        <ErrorState title="Could not load the repair ledger" error={repairs.error} onRetry={() => repairs.refetch()} />
      ) : repairs.isPending ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Skeleton className="h-[360px] rounded-xl" />
          <Skeleton className="h-[560px] rounded-xl" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="panel">
          <EmptyState icon={ScrollText} title="No evidence recorded yet" action={<GenerateRepairButton label="Generate repair" />}>
            Evidence is written to the ledger when a repair is planned, then extended by verification, approval and
            application. Each record is bound to the policy revision it was produced for.
          </EmptyState>
        </div>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <RepairLedgerList
            plans={sorted}
            selectedId={selectedId}
            onSelect={(id) => router.replace(`${pathname}?repair=${encodeURIComponent(id)}`, { scroll: false })}
          />
          {evidence.isError ? (
            <ErrorState title={`Could not load evidence for ${selectedId}`} error={evidence.error} onRetry={() => evidence.refetch()} />
          ) : evidence.data ? (
            <EvidencePanel evidence={evidence.data} label={label} />
          ) : (
            <Skeleton className="h-[560px] rounded-xl" />
          )}
        </div>
      )}
    </PageContainer>
  );
}
