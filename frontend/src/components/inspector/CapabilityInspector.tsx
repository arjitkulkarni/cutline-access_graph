"use client";

import { useMemo } from "react";
import { CircleCheck, CircleX, Database, Info } from "lucide-react";
import type { ContractIndex } from "@/lib/contract";
import { pairKey } from "@/lib/contract";
import { groupRoutes, type HighlightPath } from "@/lib/graph/paths";
import type { Labeler } from "@/lib/labels";
import { isSensitive } from "@/lib/labels";
import { cn, plural } from "@/lib/format";
import type { GraphResponse, GraphNode, PathsResponse, RiskFinding } from "@/lib/types";
import { ProvenanceChip } from "@/components/common/Meta";
import { Badge } from "@/components/ui/Badge";
import { LoadingRows } from "@/components/ui/States";
import { useGenerateRepair } from "@/components/repair/GenerateRepairAction";
import { Button } from "@/components/ui/Button";
import { Wrench } from "lucide-react";
import { InspectorHeader, InspectorSection, PropsTable } from "./parts";
import { RouteList } from "./RouteList";

export function CapabilityInspector({
  node,
  graph,
  label,
  contract,
  findings,
  highlights,
  pathResults,
  pathsPending,
  activeRouteKey,
  onRoute,
  onSelectNode,
}: {
  node: GraphNode;
  graph: GraphResponse;
  label: Labeler;
  contract: ContractIndex;
  findings: RiskFinding[];
  highlights: HighlightPath[];
  pathResults: PathsResponse[];
  pathsPending: boolean;
  activeRouteKey: string | null;
  onRoute: (key: string | null) => void;
  onSelectNode: (id: string) => void;
}) {
  const gen = useGenerateRepair();
  const sensitive = isSensitive(node);

  const unwanted = useMemo(() => groupRoutes(highlights.filter((h) => h.tone === "unwanted")), [highlights]);
  const permitted = useMemo(() => groupRoutes(highlights.filter((h) => h.tone === "permitted")), [highlights]);
  const unwantedPathCount = highlights.filter((h) => h.tone === "unwanted").length;
  const unwantedEdges = useMemo(
    () => new Set(highlights.filter((h) => h.tone === "unwanted").flatMap((h) => h.edgeIds)),
    [highlights],
  );

  const guardrails = [...new Set(findings.filter((f) => f.capability === node.id).map((f) => f.guardrail).filter(Boolean))] as string[];

  const required = [...contract.allow.entries()]
    .filter(([key]) => key.endsWith(`::${node.id}`))
    .map(([, pairs]) => pairs[0]);

  const resources = graph.edges.filter((e) => e.type === "ACTS_ON" && e.source === node.id).map((e) => e.target);
  const method = typeof node.props?.method === "string" ? node.props.method : null;
  const endpoint = typeof node.props?.endpoint === "string" ? node.props.endpoint : null;

  return (
    <div className="flex flex-col">
      <InspectorHeader
        node={node}
        eyebrow={
          <span className={cn("label-micro", sensitive ? "text-amber" : undefined)}>
            {sensitive ? "Sensitive capability" : "Capability"}
          </span>
        }
      />

      {(method && endpoint) || resources.length ? (
        <div className="flex flex-col gap-1 border-b border-line px-4 py-3 text-xs text-fg-2">
          {method && endpoint ? (
            <p>
              Enforced at <span className="mono text-fg">{method} {endpoint}</span>
            </p>
          ) : null}
          {resources.length ? (
            <p className="flex flex-wrap items-center gap-1">
              Acts on
              {resources.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => onSelectNode(r)}
                  className="inline-flex items-center gap-1 rounded px-1 text-fg underline-offset-2 hover:underline"
                >
                  <Database size={11} aria-hidden className="text-fg-3" />
                  {label.node(r)}
                </button>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}

      <InspectorSection
        title="Unwanted access"
        tone="red"
        count={unwanted.length ? `${plural(unwanted.length, "route")} · ${plural(unwantedPathCount, "path")}` : undefined}
      >
        {pathsPending && !unwanted.length ? (
          <LoadingRows rows={2} />
        ) : unwanted.length ? (
          <>
            <RouteList routes={unwanted} label={label} activeRouteKey={activeRouteKey} onToggle={onRoute} />
            {guardrails.map((g) => (
              <div key={g} className="mt-2.5 flex flex-col gap-1">
                <ProvenanceChip source={`guardrail:${g}`} label={label} className="self-start" />
                <p className="text-xs leading-[18px] text-fg-3">{label.guardrail(g)}.</p>
              </div>
            ))}
          </>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-fg-2">
            <CircleCheck size={13} className="text-sage" aria-hidden />
            No principal reaches this capability against a guardrail.
          </p>
        )}
      </InspectorSection>

      <InspectorSection title="Must keep access" tone="sage" count={required.length ? required.length : undefined}>
        {required.length ? (
          <ul className="flex flex-col gap-2">
            {required.map((pair) => {
              const res = pathResults.find((r) => r.principal === pair.principal && r.capability === node.id);
              const mine = highlights.filter((h) => h.principal === pair.principal && h.tone === "required");
              const overlap = [...new Set(mine.flatMap((h) => h.edgeIds))].filter((id) => unwantedEdges.has(id));
              return (
                <li key={pairKey(pair.principal, pair.capability)} className="rounded-lg border border-line bg-raised/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectNode(pair.principal)}
                      className="min-w-0 text-left text-[13px] font-medium text-fg hover:underline"
                    >
                      {label.node(pair.principal)}
                    </button>
                    <span className="ml-auto shrink-0">
                      {!res ? (
                        <span className="text-[11px] text-fg-3">{pathsPending ? "checking…" : "—"}</span>
                      ) : res.allowed ? (
                        <Badge tone="sage" icon={CircleCheck}>
                          Reachable
                        </Badge>
                      ) : (
                        <Badge tone="red" icon={CircleX}>
                          Not reachable
                        </Badge>
                      )}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <ProvenanceChip source={pair.source} label={label} />
                    {res?.allowed ? (
                      <span className="text-xs text-fg-3">
                        {plural(res.paths.length, "route")} today
                        {overlap.length ? (
                          <>
                            {" "}
                            · <span className="text-fg-2">shares {plural(overlap.length, "relation")} with unwanted routes</span>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-fg-3">No workflow in the contract depends on this capability.</p>
        )}
        {required.some((pair) => {
          const mine = highlights.filter((h) => h.principal === pair.principal && h.tone === "required");
          return mine.some((h) => h.edgeIds.some((id) => unwantedEdges.has(id)));
        }) ? (
          <p className="mt-2.5 flex gap-1.5 text-xs leading-[18px] text-fg-2">
            <Info size={13} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
            Required and unwanted routes share relations, so cutting one of those relations also cuts a workflow.
          </p>
        ) : null}
      </InspectorSection>

      {permitted.length ? (
        <InspectorSection title="Other access" tone="accent" count={permitted.length}>
          <RouteList routes={permitted} label={label} activeRouteKey={activeRouteKey} onToggle={onRoute} letterOffset={unwanted.length} />
        </InspectorSection>
      ) : null}

      {unwanted.length ? (
        // sticky so the primary action never sits half-hidden at the bottom of the scrolling inspector
        <div className="sticky bottom-0 z-10 border-y border-line bg-[var(--color-panel)] px-4 py-4">
          <Button variant="primary" className="w-full" icon={Wrench} loading={gen.pending} onClick={gen.run}>
            {gen.pending ? "Testing candidates…" : "Generate safe repair"}
          </Button>
          <p className="mt-2 text-xs leading-[18px] text-fg-3">
            Proposes edits and tests each candidate on an isolated copy of the policy graph. Nothing is applied.
            {gen.usesOperatorContract ? " Uses your confirmed operator contract." : ""}
          </p>
        </div>
      ) : null}

      <PropsTable node={node} />
    </div>
  );
}
