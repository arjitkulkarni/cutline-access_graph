/**
 * Deterministic layered layout for authorization graphs.
 *
 * Columns: principals → roles (one column per inheritance depth) → capabilities → resources.
 * Edges that skip columns get "dummy" slots in the columns they cross, so a long edge is
 * routed through reserved space instead of under a node. Ordering uses barycentric sweeps
 * plus adjacent transpositions (best crossing count wins); vertical placement solves a small
 * isotonic regression per column so connected nodes line up while keeping minimum spacing.
 *
 * The same input always produces the same output, which keeps node positions stable between
 * the Before and After views of a repair (lay out the union of both graphs once).
 */
import type { GraphEdge, GraphNode, NodeKind } from "../types";

export interface Point {
  x: number;
  y: number;
}

export interface LayoutOptions {
  /** Columns size to their longest label, within [minNodeWidth, maxNodeWidth]. */
  minNodeWidth: number;
  maxNodeWidth: number;
  /** Approximate glyph advance of the node label font (13px Geist ≈ 7.1px). */
  charWidth: number;
  /** Padding + icon + gaps inside a node, around the label. */
  nodeChrome: number;
  nodeHeight: number;
  columnGap: number;
  rowGap: number;
  dummyHeight: number;
  dummyGap: number;
  sweeps: number;
  relaxIterations: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  minNodeWidth: 120,
  maxNodeWidth: 196,
  charWidth: 7.1,
  nodeChrome: 46,
  nodeHeight: 48,
  columnGap: 40,
  rowGap: 32,
  dummyHeight: 8,
  dummyGap: 12,
  sweeps: 10,
  relaxIterations: 40,
};

export type ColumnRole = "principals" | "roles" | "capabilities" | "resources";

export interface LayoutColumn {
  index: number;
  x: number;
  role: ColumnRole;
  depth: number;
  label: string;
  count: number;
  width: number;
}

export interface GraphLayout {
  /** Top-left corner of each node. */
  positions: Record<string, Point>;
  /** Intermediate routing points for edges that cross columns (absolute coordinates). */
  waypoints: Record<string, Point[]>;
  columns: LayoutColumn[];
  columnOf: Record<string, number>;
  width: number;
  height: number;
  /** Width of every node (all nodes of a column share the column width). */
  nodeWidths: Record<string, number>;
  nodeHeight: number;
  crossings: number;
}

interface Item {
  id: string;
  real: boolean;
  height: number;
}

const KIND_ORDER: Record<NodeKind, number> = { user: 0, role: 1, capability: 2, resource: 3 };

function compareNodes(a: GraphNode, b: GraphNode): number {
  return (
    (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
    a.label.localeCompare(b.label) ||
    a.id.localeCompare(b.id)
  );
}

function roleDepths(nodes: Map<string, GraphNode>, edges: GraphEdge[]): Map<string, number> {
  const parentsOf = new Map<string, string[]>(); // role -> roles that inherit it (incoming)
  for (const e of edges) {
    if (e.type !== "INHERITS") continue;
    if (nodes.get(e.source)?.kind !== "role" || nodes.get(e.target)?.kind !== "role") continue;
    parentsOf.set(e.target, [...(parentsOf.get(e.target) ?? []), e.source]);
  }
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // cycle guard: treat the back edge as a root
    visiting.add(id);
    const incoming = parentsOf.get(id) ?? [];
    const d = incoming.length ? 1 + Math.max(...incoming.map(visit)) : 0;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const n of nodes.values()) if (n.kind === "role") visit(n.id);
  return depth;
}

/** Pool-adjacent-violators: least-squares fit of a non-decreasing sequence. */
function isotonic(values: number[]): number[] {
  const blocks: { sum: number; count: number }[] = [];
  for (const v of values) {
    blocks.push({ sum: v, count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.count <= b.sum / b.count) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, count: a.count + b.count });
    }
  }
  const out: number[] = [];
  for (const b of blocks) for (let i = 0; i < b.count; i++) out.push(b.sum / b.count);
  return out;
}

export function layoutGraph(
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  opts: Partial<LayoutOptions> = {},
): GraphLayout {
  const o: LayoutOptions = { ...DEFAULT_LAYOUT, ...opts };
  const nodes = new Map<string, GraphNode>();
  for (const n of [...graphNodes].sort(compareNodes)) nodes.set(n.id, n);
  const edges = graphEdges
    .filter((e) => nodes.has(e.source) && nodes.has(e.target) && e.source !== e.target)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (nodes.size === 0) {
    return {
      positions: {},
      waypoints: {},
      columns: [],
      columnOf: {},
      width: 0,
      height: 0,
      nodeWidths: {},
      nodeHeight: o.nodeHeight,
      crossings: 0,
    };
  }

  // ---- 1. columns -------------------------------------------------------------------------
  const depths = roleDepths(nodes, edges);
  const roleNodes = [...nodes.values()].filter((n) => n.kind === "role");
  const maxDepth = roleNodes.length ? Math.max(...roleNodes.map((n) => depths.get(n.id) ?? 0)) : -1;
  const capCol = 1 + (maxDepth + 1);
  const resCol = capCol + 1;

  const columnOf: Record<string, number> = {};
  for (const n of nodes.values()) {
    columnOf[n.id] =
      n.kind === "user"
        ? 0
        : n.kind === "role"
          ? 1 + (depths.get(n.id) ?? 0)
          : n.kind === "capability"
            ? capCol
            : n.kind === "resource"
              ? resCol
              : capCol;
  }
  const columnCount = Math.max(...Object.values(columnOf)) + 1;

  // ---- 2. layers with dummy slots ------------------------------------------------------
  const layers: Item[][] = Array.from({ length: columnCount }, () => []);
  const itemLayer = new Map<string, number>();
  for (const n of nodes.values()) {
    const col = columnOf[n.id];
    layers[col].push({ id: n.id, real: true, height: o.nodeHeight });
    itemLayer.set(n.id, col);
  }

  const succ = new Map<string, string[]>();
  const pred = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    succ.set(a, [...(succ.get(a) ?? []), b]);
    pred.set(b, [...(pred.get(b) ?? []), a]);
  };
  const dummyChains = new Map<string, string[]>();

  for (const e of edges) {
    const cs = columnOf[e.source];
    const ct = columnOf[e.target];
    if (ct <= cs) continue; // backward/same-column edges are drawn directly
    let prev = e.source;
    const chain: string[] = [];
    for (let c = cs + 1; c < ct; c++) {
      const id = `~${e.id}~${c}`;
      layers[c].push({ id, real: false, height: o.dummyHeight });
      itemLayer.set(id, c);
      chain.push(id);
      link(prev, id);
      prev = id;
    }
    link(prev, e.target);
    if (chain.length) dummyChains.set(e.id, chain);
  }

  // ---- 3. ordering ---------------------------------------------------------------------------
  const order: string[][] = layers.map((layer) => layer.map((it) => it.id));
  const posIn = (layerOrder: string[]) => new Map(layerOrder.map((id, i) => [id, i]));

  const countBetween = (upper: string[], lower: string[]): number => {
    const pu = posIn(upper);
    const pl = posIn(lower);
    const segs: [number, number][] = [];
    for (const u of upper) {
      for (const v of succ.get(u) ?? []) {
        const lv = pl.get(v);
        if (lv !== undefined) segs.push([pu.get(u) as number, lv]);
      }
    }
    let c = 0;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const [a1, b1] = segs[i];
        const [a2, b2] = segs[j];
        if ((a1 - a2) * (b1 - b2) < 0) c += 1;
      }
    }
    return c;
  };
  const totalCrossings = (ord: string[][]): number => {
    let c = 0;
    for (let l = 0; l < ord.length - 1; l++) c += countBetween(ord[l], ord[l + 1]);
    return c;
  };

  const reorder = (l: number, neighborLayer: number, neighbors: Map<string, string[]>) => {
    const ref = posIn(order[neighborLayer]);
    const current = posIn(order[l]);
    const scored = order[l].map((id) => {
      const ns = (neighbors.get(id) ?? [])
        .map((n) => ref.get(n))
        .filter((p): p is number => p !== undefined);
      const own = current.get(id) as number;
      // Scale our own index into the neighbor layer's range so free nodes keep their place.
      const scale = order[neighborLayer].length / Math.max(1, order[l].length);
      const bc = ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : own * scale;
      return { id, bc, own };
    });
    scored.sort((a, b) => a.bc - b.bc || a.own - b.own);
    order[l] = scored.map((s) => s.id);
  };

  const transpose = () => {
    let improved = true;
    let guard = 0;
    while (improved && guard < 20) {
      improved = false;
      guard += 1;
      for (let l = 0; l < order.length; l++) {
        for (let i = 0; i < order[l].length - 1; i++) {
          const local = (ord: string[]) =>
            (l > 0 ? countBetween(order[l - 1], ord) : 0) +
            (l < order.length - 1 ? countBetween(ord, order[l + 1]) : 0);
          const before = local(order[l]);
          const swapped = [...order[l]];
          [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
          if (local(swapped) < before) {
            order[l] = swapped;
            improved = true;
          }
        }
      }
    }
  };

  let best = order.map((l) => [...l]);
  let bestCrossings = totalCrossings(order);
  for (let it = 0; it < o.sweeps && bestCrossings > 0; it++) {
    for (let l = 1; l < order.length; l++) reorder(l, l - 1, pred);
    for (let l = order.length - 2; l >= 0; l--) reorder(l, l + 1, succ);
    transpose();
    const c = totalCrossings(order);
    if (c < bestCrossings) {
      bestCrossings = c;
      best = order.map((l) => [...l]);
    }
  }
  for (let l = 0; l < order.length; l++) order[l] = best[l];

  // ---- 4. vertical placement -------------------------------------------------------------
  const heightOf = new Map<string, number>();
  for (const layer of layers) for (const it of layer) heightOf.set(it.id, it.height);
  const isReal = (id: string) => nodes.has(id);
  const gapBetween = (a: string, b: string) =>
    isReal(a) && isReal(b) ? o.rowGap : o.dummyGap;

  const center = new Map<string, number>();
  const layerSpans = order.map((ids) => {
    let y = 0;
    ids.forEach((id, i) => {
      const h = heightOf.get(id) as number;
      if (i > 0) y += gapBetween(ids[i - 1], id);
      center.set(id, y + h / 2);
      y += h;
    });
    return y;
  });
  const tallest = Math.max(...layerSpans);
  order.forEach((ids, l) => {
    const shift = (tallest - layerSpans[l]) / 2;
    for (const id of ids) center.set(id, (center.get(id) as number) + shift);
  });

  const placeLayer = (ids: string[], desired: number[]) => {
    // c_{i+1} - c_i >= s_i  →  z_i = c_i - S_i must be non-decreasing.
    const offsets: number[] = [0];
    for (let i = 1; i < ids.length; i++) {
      const s =
        (heightOf.get(ids[i - 1]) as number) / 2 +
        gapBetween(ids[i - 1], ids[i]) +
        (heightOf.get(ids[i]) as number) / 2;
      offsets.push(offsets[i - 1] + s);
    }
    const z = isotonic(desired.map((d, i) => d - offsets[i]));
    ids.forEach((id, i) => center.set(id, z[i] + offsets[i]));
  };

  for (let it = 0; it < o.relaxIterations; it++) {
    const forward = it % 2 === 0;
    const sequence = forward
      ? order.map((_, l) => l)
      : order.map((_, l) => order.length - 1 - l);
    for (const l of sequence) {
      const ids = order[l];
      if (!ids.length) continue;
      const desired = ids.map((id) => {
        const ns = [...(pred.get(id) ?? []), ...(succ.get(id) ?? [])];
        const own = center.get(id) as number;
        if (!ns.length) return own;
        const mean = ns.reduce((acc, n) => acc + (center.get(n) as number), 0) / ns.length;
        return own + (mean - own) * 0.85;
      });
      placeLayer(ids, desired);
    }
  }

  // Normalize so the topmost item starts at y = 0.
  let minTop = Infinity;
  let maxBottom = -Infinity;
  for (const [id, c] of center) {
    const h = heightOf.get(id) as number;
    minTop = Math.min(minTop, c - h / 2);
    maxBottom = Math.max(maxBottom, c + h / 2);
  }

  // Content-sized columns: each column is as wide as its longest label needs.
  // Roles created by a repair (or by the live challenge) can carry a "New" badge in the Before/After view,
  // so reserve room for it instead of truncating their label.
  const BADGE_ALLOWANCE = 44;
  const wantOf = (n: GraphNode) => {
    const origin = n.props?.origin;
    const badge = origin === "cutline" || origin === "challenge" ? BADGE_ALLOWANCE : 0;
    return Math.ceil(n.label.length * o.charWidth + o.nodeChrome + badge);
  };
  const colWidths = order.map((ids) => {
    const want = ids.filter(isReal).reduce((m, id) => Math.max(m, wantOf(nodes.get(id) as GraphNode)), 0);
    return Math.min(o.maxNodeWidth + BADGE_ALLOWANCE, Math.max(o.minNodeWidth, want));
  });
  const colX: number[] = [];
  colWidths.forEach((w, c) => colX.push(c === 0 ? 0 : colX[c - 1] + colWidths[c - 1] + o.columnGap));

  const positions: Record<string, Point> = {};
  const nodeWidths: Record<string, number> = {};
  for (const n of nodes.values()) {
    const col = columnOf[n.id];
    positions[n.id] = {
      x: colX[col],
      y: Math.round((center.get(n.id) as number) - minTop - o.nodeHeight / 2),
    };
    nodeWidths[n.id] = colWidths[col];
  }

  const waypoints: Record<string, Point[]> = {};
  for (const [edgeId, chain] of dummyChains) {
    const pts: Point[] = [];
    for (const dummy of chain) {
      const col = itemLayer.get(dummy) as number;
      const y = (center.get(dummy) as number) - minTop;
      pts.push({ x: colX[col], y }, { x: colX[col] + colWidths[col], y });
    }
    waypoints[edgeId] = pts;
  }

  // ---- 5. column descriptors --------------------------------------------------------------
  const columns: LayoutColumn[] = [];
  for (let c = 0; c < columnCount; c++) {
    const count = order[c].filter(isReal).length;
    if (!count) continue;
    let role: ColumnRole;
    let depth = 0;
    let label: string;
    if (c === 0) {
      role = "principals";
      label = "Principals";
    } else if (c < capCol) {
      role = "roles";
      depth = c - 1;
      label = depth === 0 ? "Roles" : maxDepth > 1 ? `Inherited roles · ${depth}` : "Inherited roles";
    } else if (c === capCol) {
      role = "capabilities";
      label = "Capabilities";
    } else {
      role = "resources";
      label = "Resources";
    }
    columns.push({ index: c, x: colX[c], role, depth, label, count, width: colWidths[c] });
  }

  return {
    positions,
    waypoints,
    columns,
    columnOf,
    width: colX[columnCount - 1] + colWidths[columnCount - 1],
    height: Math.max(o.nodeHeight, maxBottom - minTop),
    nodeWidths,
    nodeHeight: o.nodeHeight,
    crossings: bestCrossings,
  };
}

/** Merge two snapshots by id (used to lay out Before ∪ After once). */
export function unionGraph(
  a: { nodes: GraphNode[]; edges: GraphEdge[] },
  b: { nodes: GraphNode[]; edges: GraphEdge[] } | null | undefined,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  for (const n of a.nodes) nodes.set(n.id, n);
  for (const e of a.edges) edges.set(e.id, e);
  for (const n of b?.nodes ?? []) if (!nodes.has(n.id)) nodes.set(n.id, n);
  for (const e of b?.edges ?? []) if (!edges.has(e.id)) edges.set(e.id, e);
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
