"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import { Route, PanelRightOpen, X, GitCompareArrows, MousePointer2 } from "lucide-react";
import { classifyAccess, indexContract, riskKeySet } from "@/lib/contract";
import { layoutGraph, unionGraph } from "@/lib/graph/layout";
import { graphChanges } from "@/lib/graph/changes";
import { panelTransition } from "@/lib/motion";
import { toHighlights, type HighlightPath } from "@/lib/graph/paths";
import { createLabeler } from "@/lib/labels";
import { cn, formatMs, plural } from "@/lib/format";
import { usePathQueries, useContract, useGraph, useRisks, type PairQuery } from "@/lib/queries";
import type { GraphResponse, NodeKind } from "@/lib/types";
import { PageContainer, PageHeader } from "@/components/shell/PageHeader";
import { RevisionTag } from "@/components/common/Meta";
import { PermissionGraph } from "@/components/graph/PermissionGraph";
import { GraphLegend, GraphSearch, ZoomControls, useFocusNode } from "@/components/graph/GraphToolbar";
import { CapabilityInspector } from "@/components/inspector/CapabilityInspector";
import { InspectorEmpty, PrincipalInspector, ResourceInspector, RoleInspector } from "@/components/inspector/EntityInspectors";
import { ErrorState, Skeleton } from "@/components/ui/States";
import { InspectorPanel } from "@/components/inspector/InspectorPanel";

export function AccessGraphScreen() {
  const graph = useGraph();
  return (
    <PageContainer wide className="graph-page !pb-4">
      <PageHeader title="Access Graph" subtitle="Trace every route to a sensitive capability." meta={graph.data ? <RevisionTag revision={graph.data.revision} showHash /> : null} />
      {graph.isError ? (
        <ErrorState title="Could not load the policy graph" error={graph.error} onRetry={() => graph.refetch()} retrying={graph.isFetching} />
      ) : !graph.data ? (
        <div className="grid h-[calc(100dvh-152px)] min-h-[520px] grid-cols-[minmax(0,1fr)_316px] gap-3 max-[1399px]:grid-cols-1"><Skeleton className="h-full rounded-xl" /><Skeleton className="h-full rounded-xl max-[1399px]:hidden" /></div>
      ) : (
        <ReactFlowProvider><AccessGraphWorkspace graph={graph.data} /></ReactFlowProvider>
      )}
    </PageContainer>
  );
}

function AccessGraphWorkspace({ graph }: { graph: GraphResponse }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const risks = useRisks();
  const contractQuery = useContract();
  const [showPaths, setShowPaths] = useState(true);
  const [activeRoute, setActiveRoute] = useState<string | null>(null);
  const focusParam = searchParams.get("focus");
  const selected = focusParam && graph.nodes.some((n) => n.id === focusParam) ? focusParam : null;
  const selectedNode = selected ? graph.nodes.find((n) => n.id === selected) ?? null : null;
  const [inspectorOpen, setInspectorOpen] = useState(Boolean(focusParam));
  const [observed, setObserved] = useState<{ current: GraphResponse; previous: GraphResponse | null }>({ current: graph, previous: null });
  if (observed.current.revision.hash !== graph.revision.hash) {
    setObserved({ current: graph, previous: observed.current });
  }
  const changes = useMemo(() => observed.previous ? graphChanges(observed.previous, graph) : null, [observed.previous, graph]);
  const canvasGraph = useMemo(() => observed.previous ? unionGraph(graph, observed.previous) : graph, [observed.previous, graph]);
  const layout = useMemo(() => layoutGraph(canvasGraph.nodes, canvasGraph.edges), [canvasGraph.nodes, canvasGraph.edges]);
  const label = useMemo(() => createLabeler({ nodeLists: [graph.nodes], workflows: graph.workflows, guardrails: graph.guardrails }), [graph]);
  const contract = useMemo(() => indexContract(contractQuery.data), [contractQuery.data]);
  const findings = useMemo(() => risks.data?.revision.hash === graph.revision.hash ? risks.data.findings : [], [risks.data, graph.revision.hash]);
  const riskKeys = useMemo(() => riskKeySet(findings), [findings]);
  const focusNode = useFocusNode(layout);

  const select = useCallback((id: string | null) => {
    setActiveRoute(null);
    setInspectorOpen(Boolean(id));
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("focus", id); else params.delete("focus");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !selected) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.closest("dialog"))) return;
      select(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, select]);

  // All access decisions continue to come from the revision-bound FalkorDB queries.
  const pairs: PairQuery[] = useMemo(() => {
    if (!selectedNode) return [];
    const users = graph.nodes.filter((n) => n.kind === "user").map((n) => n.id);
    const caps = graph.nodes.filter((n) => n.kind === "capability").map((n) => n.id);
    if (selectedNode.kind === "capability") return users.map((u) => ({ principal: u, capability: selectedNode.id }));
    if (selectedNode.kind === "user") return caps.map((c) => ({ principal: selectedNode.id, capability: c }));
    return [];
  }, [selectedNode, graph.nodes]);
  const paths = usePathQueries(pairs, graph.revision);

  const highlights: HighlightPath[] = useMemo(() => {
    const kind: NodeKind | undefined = selectedNode?.kind;
    const fromRisks = (filter: (f: (typeof findings)[number]) => boolean) => findings.filter(filter).flatMap((f) => toHighlights(f.paths, "unwanted", f.principal, f.capability));
    if (!selectedNode) return fromRisks(() => true);
    if (kind === "capability" || kind === "user") {
      if (!paths.data.length) return fromRisks((f) => kind === "capability" ? f.capability === selectedNode.id : f.principal === selectedNode.id);
      return paths.data.flatMap((res) => res.allowed ? toHighlights(res.paths, classifyAccess(res.principal, res.capability, contract, riskKeys), res.principal, res.capability) : []);
    }
    if (kind === "role") return fromRisks((f) => f.paths.some((p) => p.nodes.includes(selectedNode.id)));
    if (kind === "resource") {
      const caps = new Set(graph.edges.filter((e) => e.type === "ACTS_ON" && e.target === selectedNode.id).map((e) => e.source));
      return fromRisks((f) => caps.has(f.capability));
    }
    return [];
  }, [selectedNode, findings, paths.data, contract, riskKeys, graph.edges]);

  const resourceFocus = useMemo(() => {
    if (selectedNode?.kind !== "resource" && selectedNode?.kind !== "role") return undefined;
    return new Set(graph.edges.filter((e) => e.target === selectedNode.id || e.source === selectedNode.id).map((e) => e.id));
  }, [selectedNode, graph.edges]);
  const inspectorProps = {
    graph, label, contract, findings, highlights, pathResults: paths.data, pathsPending: paths.isPending,
    activeRouteKey: activeRoute, onRoute: setActiveRoute,
    onSelectNode: (id: string) => { select(id); focusNode(id); },
  };

  return (
    <div className="graph-workspace grid h-[calc(100dvh-152px)] min-h-[540px] grid-cols-[minmax(0,1fr)_316px] gap-3 max-[1399px]:grid-cols-1">
      <section aria-label="Authorization graph canvas" className="panel relative flex min-w-0 flex-col overflow-hidden">
        <div className="graph-workspace-toolbar flex min-h-[54px] shrink-0 flex-wrap items-center gap-2 border-b border-line-soft px-3 py-2.5">
          <GraphSearch nodes={graph.nodes} onPick={(id) => { select(id); focusNode(id); }} className="max-sm:w-full" />
          <button type="button" role="switch" aria-checked={showPaths} onClick={() => setShowPaths((v) => !v)}
            className={cn("flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs transition-colors", showPaths ? "border-line bg-raised text-fg" : "border-transparent text-fg-3 hover:text-fg")}
            title="Show access routes derived by FalkorDB">
            <Route size={13} aria-hidden className={showPaths ? "text-accent" : "text-fg-3"} />Derived paths
            <span className={cn("relative inline-flex h-3.5 w-6 rounded-full transition-colors", showPaths ? "bg-accent/70" : "bg-line-strong")} aria-hidden><span className={cn("absolute top-0.5 h-2.5 w-2.5 rounded-full bg-fg transition-transform duration-150", showPaths ? "translate-x-3" : "translate-x-0.5")} /></span>
          </button>
          <button type="button" aria-label="Open inspector" onClick={() => setInspectorOpen(true)} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-fg-2 hover:bg-raised min-[1400px]:hidden"><PanelRightOpen size={14} aria-hidden />Inspector</button>
          <p className="graph-query-time mono ml-auto text-[10px] text-fg-3" title="Graph query duration">{formatMs(graph.query_ms)}</p>
        </div>
        <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-line-soft/60 px-4 py-2 text-[11px] text-fg-3">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-sage" aria-hidden /><span className="text-fg-2">Policy topology</span><span className="mx-1 text-line-strong" aria-hidden>/</span><span className="tnum">{plural(graph.nodes.length, "node")} · {plural(graph.edges.length, "relationship")}</span>
          {selectedNode ? <button type="button" aria-label="Clear selection" onClick={() => select(null)} className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-accent hover:text-fg" title="Clear selection (Esc)"><span className="max-w-[140px] truncate">{selectedNode.label}</span><X size={12} aria-hidden /></button> : null}
        </div>
        {changes && observed.previous ? (
          <div role="status" className="flex flex-wrap items-center gap-2 border-b border-line-soft bg-raised px-4 py-2 text-[11px] text-fg-2" title="Changes between policy snapshots observed in this session">
            <GitCompareArrows size={13} className="text-accent" aria-hidden /><span>Since r{observed.previous.revision.revision}</span><span className="text-sage">+{changes.counts.added} added</span><span className="text-red">−{changes.counts.removed} removed</span><span>{changes.counts.modified} modified</span>
            <button type="button" aria-label="Dismiss revision comparison" title="Show only the current policy" onClick={() => setObserved({ current: graph, previous: null })} className="ml-auto p-1 hover:text-fg"><X size={12} aria-hidden /></button>
          </div>
        ) : null}
        <div className="relative min-h-[300px] flex-1 bg-bg/25">
          <PermissionGraph graph={canvasGraph} layout={layout} ariaLabel={`Authorization graph at revision ${graph.revision.revision}`} highlights={showPaths ? highlights : []} activeRouteKey={showPaths ? activeRoute : null} selectedId={selected} onSelect={select} focusEdgeIds={resourceFocus} dimUnrelated={Boolean(selectedNode) && showPaths} nodePresence={changes?.nodePresence} edgePresence={changes?.edgePresence} fitPadding={0.06} maxFitZoom={1.08} />
          {risks.isError ? <div className="absolute inset-x-3 top-3 z-10"><ErrorState compact title="Risky paths could not be loaded" error={risks.error} onRetry={() => risks.refetch()} /></div> : null}
          {!graph.nodes.length ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-fg-2">No policy entities to display.</div> : null}
        </div>
        <div className="graph-workspace-footer flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line-soft px-4 py-3"><GraphLegend /><ZoomControls fitPadding={0.06} maxFitZoom={1.08} /></div>
        <div className="flex shrink-0 items-center gap-1.5 border-t border-line-soft/60 px-4 py-2 text-[10px] text-fg-3"><MousePointer2 size={11} aria-hidden /><span>Drag to pan · Scroll to zoom</span><span className="ml-auto">/ Search<span className="ml-3 max-sm:hidden">Esc Clear selection</span></span></div>
      </section>
      <InspectorPanel open={inspectorOpen} onClose={() => setInspectorOpen(false)}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={selected ?? "none"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 0 }} transition={panelTransition}>
            {!selectedNode ? <InspectorEmpty graph={graph} findings={findings} label={label} onSelectNode={inspectorProps.onSelectNode} />
              : selectedNode.kind === "capability" ? <CapabilityInspector node={selectedNode} {...inspectorProps} />
              : selectedNode.kind === "user" ? <PrincipalInspector node={selectedNode} {...inspectorProps} />
              : selectedNode.kind === "role" ? <RoleInspector node={selectedNode} {...inspectorProps} />
              : <ResourceInspector node={selectedNode} graph={graph} label={label} onSelectNode={inspectorProps.onSelectNode} />}
          </motion.div>
        </AnimatePresence>
        {paths.error ? <div className="px-4 pb-4"><ErrorState compact title="Path query failed" error={paths.error} /></div> : null}
      </InspectorPanel>
    </div>
  );
}
