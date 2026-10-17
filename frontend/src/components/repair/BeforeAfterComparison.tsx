"use client";

import { useMemo, type ReactNode } from "react";
import { Panel as FlowPanel, ReactFlowProvider } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import { afterCaption, beforeCaption, presenceFor, type CompareView, type ComparisonModel } from "@/lib/compare";
import { cn } from "@/lib/format";
import type { Labeler } from "@/lib/labels";
import type { AccessMatrixRow, Contract } from "@/lib/types";
import { PermissionGraph } from "@/components/graph/PermissionGraph";
import { ZoomControls } from "@/components/graph/GraphToolbar";
import { Segmented } from "@/components/ui/Segmented";
import type { EditFocus } from "./MigrationEditList";

/**
 * Before / After on one stable layout (the union of both graphs). Switching views fades removed
 * relations to dashed ghosts and draws the replacement relations in; nodes never move.
 */
export function BeforeAfterComparison({
  model,
  matrix,
  contract,
  label,
  view,
  onViewChange,
  focus,
  side,
  footer,
  fitKey,
}: {
  model: ComparisonModel;
  matrix: AccessMatrixRow[] | null;
  contract: Contract;
  label: Labeler;
  view: CompareView;
  onViewChange: (view: CompareView) => void;
  focus: EditFocus | null;
  side: ReactNode;
  footer?: ReactNode;
  fitKey: string;
}) {
  const effectiveView: CompareView = model.hasAfter ? view : "before";
  const presence = useMemo(() => presenceFor(model, effectiveView), [model, effectiveView]);
  const highlights = effectiveView === "before" ? model.beforeHighlights : model.afterHighlights;
  const focusEdges = useMemo(() => (focus ? new Set(focus.edgeIds) : undefined), [focus]);
  const focusNodes = useMemo(() => (focus ? new Set(focus.nodeIds) : undefined), [focus]);

  const before = beforeCaption(model, label);
  const after = matrix && model.hasAfter ? afterCaption(matrix, contract, label) : null;
  const caption =
    effectiveView === "before"
      ? before
        ? { ...before, tone: "amber" as const }
        : { title: "No forbidden route in this graph.", detail: "Every must-deny pair is unreachable.", tone: "sage" as const }
      : after
        ? { ...after, tone: after.ok ? ("sage" as const) : ("red" as const) }
        : null;

  return (
    <div className="panel grid min-h-[440px] grid-cols-[minmax(0,1fr)_332px] overflow-hidden max-xl:grid-cols-1">
      <div className="flex min-w-0 flex-col border-r border-line max-xl:border-b max-xl:border-r-0">
        <div className="flex min-h-[60px] flex-wrap items-center gap-4 border-b border-line px-4 py-2.5">
          <Segmented<CompareView>
            label="Policy view"
            value={effectiveView}
            onChange={onViewChange}
            options={[
              { value: "before", label: "Before" },
              {
                value: "after",
                label: "After",
                disabled: !model.hasAfter,
                title: model.hasAfter ? "Graph after the chosen edits" : "No candidate passed, so there is no repaired graph",
              },
            ]}
          />
          <AnimatePresence mode="wait" initial={false}>
            {caption ? (
              <motion.div
                key={`${effectiveView}:${caption.title}`}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.18 }}
                className="flex min-w-0 items-start gap-2.5"
              >
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    caption.tone === "amber" ? "bg-amber" : caption.tone === "sage" ? "bg-sage" : "bg-red",
                  )}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium leading-5 text-fg">{caption.title}</p>
                  <p className="truncate text-xs text-fg-2" title={caption.detail}>
                    {caption.detail}
                  </p>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
        <div className="relative h-[400px] min-h-[360px] flex-1">
          <ReactFlowProvider>
            <PermissionGraph
              graph={model.union}
              layout={model.layout}
              ariaLabel={effectiveView === "before" ? "Policy graph before the repair" : "Policy graph after the repair"}
              highlights={highlights}
              nodePresence={presence.nodes}
              edgePresence={presence.edges}
              nodeBadges={presence.badges}
              focusEdgeIds={focusEdges}
              focusNodeIds={focusNodes}
              dimUnrelated={false}
              fitKey={fitKey}
              fitPadding={0.08}
            >
              <FlowPanel position="bottom-right" className="!m-3">
                <ZoomControls fitPadding={0.08} />
              </FlowPanel>
              <FlowPanel position="bottom-left" className="!m-3 max-sm:!bottom-auto max-sm:!right-3 max-sm:!top-0">
                <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-panel/95 px-2.5 py-1.5 text-[11px] text-fg-2">
                  {effectiveView === "before" ? (
                    <LegendSwatch color="var(--color-risk)" label="Forbidden route" />
                  ) : (
                    <>
                      <LegendSwatch color="var(--color-sage)" label="Required access kept" />
                      <span className="flex items-center gap-1.5">
                        <svg width="18" height="6" aria-hidden>
                          <path d="M1 3 H17" stroke="var(--color-fg)" strokeWidth="1.75" />
                        </svg>
                        New relation
                      </span>
                      <span className="flex items-center gap-1.5">
                        <svg width="18" height="6" aria-hidden>
                          <path d="M1 3 H17" stroke="var(--color-red)" strokeWidth="1.25" strokeDasharray="3 3" />
                        </svg>
                        Removed
                      </span>
                    </>
                  )}
                </div>
              </FlowPanel>
            </PermissionGraph>
          </ReactFlowProvider>
        </div>
        {footer ? <div className="border-t border-line px-4 py-2 text-[11px] text-fg-3">{footer}</div> : null}
      </div>
      <div className="flex min-h-0 min-w-0 flex-col">{side}</div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="18" height="8" aria-hidden>
        <path d="M2 4 H16" stroke={color} strokeWidth="5" strokeLinecap="round" opacity="0.32" />
        <path d="M2 4 H16" stroke={color} strokeWidth="1.5" />
      </svg>
      {label}
    </span>
  );
}
