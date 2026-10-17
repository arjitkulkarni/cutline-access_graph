import { Position, type Edge, type Node } from "@xyflow/react";
import type { AccessClass } from "../contract";
import type { EdgeType, GraphNode, GraphSnapshot } from "../types";
import type { GraphLayout, Point } from "./layout";
import type { HighlightPath } from "./paths";

export type Presence = "present" | "absent" | "removed" | "added" | "modified";
export type Emphasis = "none" | "hover" | "focus";

export interface EntityNodeData extends Record<string, unknown> {
  node: GraphNode;
  tone: AccessClass | null;
  dimmed: boolean;
  presence: Presence;
  badge: string | null;
  focused: boolean;
  compact: boolean;
}
export type EntityFlowNode = Node<EntityNodeData, "entity">;

export interface ColumnNodeData extends Record<string, unknown> {
  label: string;
  count: number;
}
export type ColumnFlowNode = Node<ColumnNodeData, "column">;

export type CanvasNode = EntityFlowNode | ColumnFlowNode;

export interface SignalSpec {
  tone: AccessClass;
  /** position of this edge along the traced path */
  index: number;
  /** number of edges in the traced path */
  count: number;
  /** shared clock origin so every edge of the route animates in sequence */
  epoch: number;
}

export interface RelationEdgeData extends Record<string, unknown> {
  relation: EdgeType;
  waypoints: Point[];
  lanes: AccessClass[];
  dimmed: boolean;
  emphasis: Emphasis;
  presence: Presence;
  signal: SignalSpec | null;
  showLabel: boolean;
  label: string;
}
export type RelationFlowEdge = Edge<RelationEdgeData, "relation">;

export const TONE_ORDER: AccessClass[] = ["unwanted", "required", "permitted"];

const KIND_LABEL: Record<string, string> = {
  user: "Principal",
  role: "Role",
  capability: "Capability",
  resource: "Resource",
};

export const RELATION_LABEL: Record<EdgeType, string> = {
  ASSIGNED_TO: "assigned to",
  INHERITS: "inherits",
  GRANTS: "grants",
  ACTS_ON: "acts on",
};

export interface BuildCanvasInput {
  graph: GraphSnapshot;
  layout: GraphLayout;
  highlights?: HighlightPath[];
  activeRouteKey?: string | null;
  signalEpoch?: number;
  selectedId?: string | null;
  hoveredNodeId?: string | null;
  hoveredEdgeId?: string | null;
  focusEdgeIds?: ReadonlySet<string>;
  focusNodeIds?: ReadonlySet<string>;
  nodePresence?: Record<string, Presence>;
  edgePresence?: Record<string, Presence>;
  nodeBadges?: Record<string, string>;
  showColumnLabels?: boolean;
  dimUnrelated?: boolean;
  compact?: boolean;
}

export function buildCanvas(input: BuildCanvasInput): { nodes: CanvasNode[]; edges: RelationFlowEdge[] } {
  const {
    graph,
    layout,
    highlights = [],
    activeRouteKey = null,
    signalEpoch = 0,
    selectedId = null,
    hoveredNodeId = null,
    hoveredEdgeId = null,
    focusEdgeIds = new Set<string>(),
    focusNodeIds = new Set<string>(),
    nodePresence = {},
    edgePresence = {},
    nodeBadges = {},
    showColumnLabels = true,
    dimUnrelated = true,
    compact = false,
  } = input;

  const labelOf = new Map(graph.nodes.map((n) => [n.id, n.label]));

  // Extend proven capability paths through their stored ACTS_ON relations. This is
  // presentation only: the inspector and access decisions still use the API paths.
  const canvasHighlights = highlights.flatMap((h) => {
    const resources = graph.edges.filter((e) => e.type === "ACTS_ON" && e.source === h.capability && edgePresence[e.id] !== "removed");
    return resources.length ? resources.map((e) => ({ ...h, nodes: [...h.nodes, e.target], edgeIds: [...h.edgeIds, e.id] })) : [h];
  });

  // Which tones touch each node / edge.
  const nodeTones = new Map<string, Set<AccessClass>>();
  const edgeTones = new Map<string, Set<AccessClass>>();
  for (const h of canvasHighlights) {
    for (const id of h.nodes) nodeTones.set(id, (nodeTones.get(id) ?? new Set()).add(h.tone));
    for (const id of h.edgeIds) edgeTones.set(id, (edgeTones.get(id) ?? new Set()).add(h.tone));
  }

  // One finite traversal on selection, or the explicit inspector route. Shared
  // segments use one marker; no perpetual animation runs in an idle workspace.
  const signals = new Map<string, SignalSpec>();
  if (activeRouteKey || selectedId) {
    for (const h of canvasHighlights) {
      if (activeRouteKey ? h.routeKey !== activeRouteKey : !h.nodes.includes(selectedId!)) continue;
      h.edgeIds.forEach((id, index) => {
        if (!signals.has(id)) {
          signals.set(id, { tone: h.tone, index, count: h.edgeIds.length, epoch: signalEpoch });
        }
      });
    }
  }

  const hasOverlay = dimUnrelated && (highlights.length > 0 || selectedId !== null);
  const hasFocus = focusEdgeIds.size > 0 || focusNodeIds.size > 0;

  const strongest = (tones: Set<AccessClass> | undefined): AccessClass | null => {
    if (!tones) return null;
    return TONE_ORDER.find((t) => tones.has(t)) ?? null;
  };

  const entityNodes: EntityFlowNode[] = graph.nodes
    .filter((n) => layout.positions[n.id])
    .map((n) => {
      const presence = nodePresence[n.id] ?? "present";
      const onOverlay = nodeTones.has(n.id);
      const focused = focusNodeIds.has(n.id);
      const dimmed =
        (hasOverlay && !onOverlay && n.id !== selectedId) || (hasFocus && !focused && !touchesFocus(n.id, focusEdgeIds));
      return {
        id: n.id,
        type: "entity" as const,
        position: layout.positions[n.id],
        width: layout.nodeWidths[n.id],
        height: layout.nodeHeight,
        // Static dimensions + handle anchors: edges never wait on DOM measurement, and
        // rebuilding node objects on hover cannot drop handle bounds.
        measured: { width: layout.nodeWidths[n.id], height: layout.nodeHeight },
        handles: staticHandles(layout.nodeWidths[n.id], layout.nodeHeight),
        draggable: false,
        connectable: false,
        selectable: presence !== "absent" && presence !== "removed",
        focusable: presence !== "absent" && presence !== "removed",
        selected: n.id === selectedId,
        ariaLabel: `${KIND_LABEL[n.kind] ?? "Node"}: ${n.label}${strongest(nodeTones.get(n.id)) ? `, ${strongest(nodeTones.get(n.id))} access` : ""}${presence !== "present" ? `, ${presence}` : ""}`,
        data: {
          node: n,
          tone: strongest(nodeTones.get(n.id)),
          dimmed,
          presence,
          badge: nodeBadges[n.id] ?? (presence === "added" ? "New" : presence === "modified" ? "Updated" : presence === "removed" ? "Removed" : null),
          focused,
          compact,
        },
      };
    });

  const columnNodes: ColumnFlowNode[] = showColumnLabels
    ? layout.columns.map((c) => ({
        id: `column:${c.index}`,
        type: "column" as const,
        position: { x: c.x, y: -34 },
        width: c.width,
        height: 20,
        measured: { width: c.width, height: 20 },
        draggable: false,
        selectable: false,
        focusable: false,
        connectable: false,
        ariaLabel: `${c.label} column`,
        data: { label: c.label, count: c.count },
      }))
    : [];

  const edges: RelationFlowEdge[] = graph.edges
    .filter((e) => layout.positions[e.source] && layout.positions[e.target])
    .map((e) => {
      const tones = edgeTones.get(e.id);
      const lanes = tones ? TONE_ORDER.filter((t) => tones.has(t)) : [];
      const presence = edgePresence[e.id] ?? "present";
      const incidentHover = hoveredNodeId !== null && (e.source === hoveredNodeId || e.target === hoveredNodeId);
      const focused = focusEdgeIds.has(e.id);
      const emphasis: Emphasis = focused ? "focus" : incidentHover || hoveredEdgeId === e.id ? "hover" : "none";
      const dimmed =
        (hasOverlay && lanes.length === 0 && emphasis === "none") || (hasFocus && !focused);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "relation" as const,
        selectable: false,
        focusable: false,
        zIndex: lanes.length || emphasis !== "none" ? 1 : 0,
        ariaLabel: `${labelOf.get(e.source) ?? e.source} ${RELATION_LABEL[e.type]} ${labelOf.get(e.target) ?? e.target}`,
        data: {
          relation: e.type,
          waypoints: layout.waypoints[e.id] ?? [],
          lanes,
          dimmed,
          emphasis,
          presence,
          signal: signals.get(e.id) ?? null,
          showLabel: hoveredEdgeId === e.id || focused,
          label: RELATION_LABEL[e.type],
        },
      };
    });

  return { nodes: [...columnNodes, ...entityNodes], edges };
}

/** Anchors at the exact middle of the left/right borders (must match .cl-flow handle CSS). */
export function staticHandles(width: number, height: number) {
  return [
    { type: "target" as const, position: Position.Left, x: 0, y: height / 2 - 0.5, width: 1, height: 1 },
    { type: "source" as const, position: Position.Right, x: width - 1, y: height / 2 - 0.5, width: 1, height: 1 },
  ];
}

function touchesFocus(nodeId: string, focusEdgeIds: ReadonlySet<string>): boolean {
  for (const id of focusEdgeIds) {
    const [s, , t] = id.split("|");
    if (s === nodeId || t === nodeId) return true;
  }
  return false;
}
