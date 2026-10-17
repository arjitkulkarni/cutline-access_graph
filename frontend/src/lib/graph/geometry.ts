import type { Point } from "./layout";

/**
 * Smooth left-to-right edge path through optional waypoints.
 * Every joint has a horizontal tangent, so consecutive cubic segments join without kinks.
 * `offset` shifts the whole route vertically (used to draw parallel overlay lanes).
 */
export function buildEdgePath(source: Point, waypoints: Point[], target: Point, offset = 0): string {
  const pts = [source, ...waypoints, target].map((p) => ({ x: p.x, y: p.y + offset }));
  let d = `M ${r(pts[0].x)} ${r(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    if (Math.abs(b.y - a.y) < 0.5 && dx > 0) {
      d += ` L ${r(b.x)} ${r(b.y)}`;
      continue;
    }
    const k = dx > 0 ? dx * 0.5 : Math.max(48, Math.abs(dx) * 0.5);
    d += ` C ${r(a.x + k)} ${r(a.y)}, ${r(b.x - k)} ${r(b.y)}, ${r(b.x)} ${r(b.y)}`;
  }
  return d;
}

/** Visual midpoint of the route, used to place relation labels. */
export function edgeMidpoint(source: Point, waypoints: Point[], target: Point): Point {
  if (waypoints.length >= 2) {
    const mid = Math.floor(waypoints.length / 2);
    const a = waypoints[mid - 1];
    const b = waypoints[mid];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
}

export function laneOffset(index: number, count: number, gap = 4.5): number {
  return (index - (count - 1) / 2) * gap;
}

function r(n: number): number {
  return Math.round(n * 10) / 10;
}
