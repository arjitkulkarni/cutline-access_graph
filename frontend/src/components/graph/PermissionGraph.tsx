"use client";

import "@xyflow/react/dist/base.css";
import "./graph.css";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow,
  useStore,
  type NodeChange,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import { usePrefersReducedMotion } from "@/lib/hooks";
import type { GraphLayout } from "@/lib/graph/layout";
import type { HighlightPath } from "@/lib/graph/paths";
import { buildCanvas, type CanvasNode, type Presence, type RelationFlowEdge } from "@/lib/graph/view";
import type { GraphSnapshot } from "@/lib/types";
import { cn } from "@/lib/format";
import { ColumnNode, EntityNode } from "./GraphNodes";
import { RelationEdge } from "./RelationEdge";

const nodeTypes: NodeTypes = { entity: EntityNode, column: ColumnNode };
const edgeTypes: EdgeTypes = { relation: RelationEdge };

export interface PermissionGraphProps {
  graph: GraphSnapshot;
  layout: GraphLayout;
  ariaLabel: string;
  highlights?: HighlightPath[];
  activeRouteKey?: string | null;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  nodePresence?: Record<string, Presence>;
  edgePresence?: Record<string, Presence>;
  nodeBadges?: Record<string, string>;
  focusEdgeIds?: ReadonlySet<string>;
  focusNodeIds?: ReadonlySet<string>;
  showColumnLabels?: boolean;
  dimUnrelated?: boolean;
  /** Changes to this key re-fit the viewport (e.g. a new revision with new nodes). */
  fitKey?: string;
  fitPadding?: number;
  maxFitZoom?: number;
  className?: string;
  children?: ReactNode;
}

/**
 * Presentational authorization graph. Must be rendered inside a <ReactFlowProvider> so toolbars
 * and inspectors around it can drive the viewport.
 */
export function PermissionGraph({
  graph,
  layout,
  ariaLabel,
  highlights = [],
  activeRouteKey = null,
  selectedId = null,
  onSelect,
  nodePresence,
  edgePresence,
  nodeBadges,
  focusEdgeIds,
  focusNodeIds,
  showColumnLabels = true,
  dimUnrelated = true,
  fitKey,
  fitPadding = 0.12,
  maxFitZoom = 1,
  className,
  children,
}: PermissionGraphProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const rf = useReactFlow<CanvasNode, RelationFlowEdge>();
  const canvasWidth = useStore((s) => s.width);

  const highlightKey = highlights.map((h) => h.key).join("|");
  // Restart only for a meaningful interaction or newly resolved path data, never hover.
  useEffect(() => {
    const frame = requestAnimationFrame((now) => setEpoch(now));
    return () => cancelAnimationFrame(frame);
  }, [activeRouteKey, selectedId, highlightKey]);

  const { nodes, edges } = useMemo(
    () =>
      buildCanvas({
        graph,
        layout,
        highlights,
        activeRouteKey,
        signalEpoch: epoch,
        selectedId,
        hoveredNodeId,
        hoveredEdgeId,
        focusEdgeIds,
        focusNodeIds,
        nodePresence,
        edgePresence,
        nodeBadges,
        showColumnLabels,
        dimUnrelated,
      }),
    [
      graph,
      layout,
      highlights,
      activeRouteKey,
      epoch,
      selectedId,
      hoveredNodeId,
      hoveredEdgeId,
      focusEdgeIds,
      focusNodeIds,
      nodePresence,
      edgePresence,
      nodeBadges,
      showColumnLabels,
      dimUnrelated,
    ],
  );

  // Re-fit when the graph structure changes (new revision, different plan).
  const lastFitKey = useRef<string | undefined>(fitKey);
  useEffect(() => {
    if (lastFitKey.current === fitKey) return;
    lastFitKey.current = fitKey;
    const id = requestAnimationFrame(() => {
      void rf.fitView({ padding: fitPadding, maxZoom: maxFitZoom, duration: reducedMotion ? 0 : 260 });
    });
    return () => cancelAnimationFrame(id);
  }, [fitKey, rf, fitPadding, maxFitZoom, reducedMotion]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      if (!onSelect) return;
      const selects = changes.filter((c) => c.type === "select");
      if (!selects.length) return;
      const picked = selects.find((c) => c.type === "select" && c.selected && !c.id.startsWith("column:"));
      if (picked) {
        onSelect(picked.id);
      } else if (selectedId && selects.some((c) => c.type === "select" && c.id === selectedId && !c.selected)) {
        onSelect(null);
      }
    },
    [onSelect, selectedId],
  );

  return (
    <ReactFlow<CanvasNode, RelationFlowEdge>
      className={cn("cl-flow", className)}
      aria-label={ariaLabel}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={handleNodesChange}
      onNodeClick={(_, node) => {
        if (onSelect && node.type === "entity" && node.data.presence !== "removed") onSelect(node.id);
      }}
      onPaneClick={() => onSelect?.(null)}
      onNodeMouseEnter={(_, node) => node.type === "entity" && setHoveredNodeId(node.id)}
      onNodeMouseLeave={() => setHoveredNodeId(null)}
      onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
      onEdgeMouseLeave={() => setHoveredEdgeId(null)}
      fitView
      fitViewOptions={{ padding: fitPadding, maxZoom: maxFitZoom }}
      minZoom={canvasWidth > 0 && canvasWidth < 640 ? 0.85 : 0.55}
      maxZoom={2.2}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable={Boolean(onSelect)}
      nodesFocusable={Boolean(onSelect)}
      zoomOnDoubleClick={false}
      selectNodesOnDrag={false}
      multiSelectionKeyCode={null}
      selectionKeyCode={null}
      deleteKeyCode={null}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={0.8} color="#2a2525" />
      {children}
    </ReactFlow>
  );
}
