"use client";

import { memo, useEffect, useRef } from "react";
import { EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { cn } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/hooks";
import { buildEdgePath, edgeMidpoint, laneOffset } from "@/lib/graph/geometry";
import type { RelationFlowEdge, SignalSpec } from "@/lib/graph/view";
import { markerUrl, type MarkerKey } from "./GraphMarkers";
import { motionTokens } from "@/lib/motion";

const TRACE_MS = motionTokens.trace * 1000;

/**
 * A tiny signal that travels the selected route edge by edge. All edges of the route share one
 * clock origin (`epoch`), so the dot hands over cleanly from one relation to the next.
 */
function SignalDot({ d, spec }: { d: string; spec: SignalSpec }) {
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    const dot = dotRef.current;
    if (!path || !dot) return;
    const total = path.getTotalLength();
    const segment = TRACE_MS / Math.max(1, spec.count);
    const start = spec.index * segment;
    const isFirst = spec.index === 0;
    const isLast = spec.index === spec.count - 1;
    let raf = 0;
    const tick = (now: number) => {
      const t = now - spec.epoch;
      const local = (t - start) / segment;
      if (local >= 0 && local <= 1) {
        const p = path.getPointAtLength(local * total);
        dot.setAttribute("cx", p.x.toFixed(2));
        dot.setAttribute("cy", p.y.toFixed(2));
        let opacity = 1;
        if (isFirst && local < 0.15) opacity = local / 0.15;
        if (isLast && local > 0.85) opacity = (1 - local) / 0.15;
        dot.style.opacity = opacity.toFixed(3);
      } else {
        dot.style.opacity = "0";
      }
      if (t < TRACE_MS) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [d, spec.epoch, spec.index, spec.count]);

  return (
    <g aria-hidden>
      <path ref={pathRef} d={d} fill="none" stroke="none" />
      <circle ref={dotRef} r={3.4} className={cn("cl-signal", `cl-signal--${spec.tone}`)} style={{ opacity: 0 }} />
    </g>
  );
}

export const RelationEdge = memo(function RelationEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<RelationFlowEdge>) {
  const reducedMotion = usePrefersReducedMotion();
  if (!data) return null;

  const source = { x: sourceX, y: sourceY };
  const target = { x: targetX, y: targetY };
  const base = buildEdgePath(source, data.waypoints, target);
  const multi = data.lanes.length > 1;
  const lanes = data.lanes.map((tone, i) => ({
    tone,
    d: multi ? buildEdgePath(source, data.waypoints, target, laneOffset(i, data.lanes.length)) : base,
  }));

  const toneClass = data.lanes.length === 0 ? null : multi ? "tone-mixed" : `tone-${data.lanes[0]}`;
  const marker: MarkerKey =
    data.presence === "added"
      ? "added"
      : data.presence === "removed"
        ? "removed"
        : data.emphasis === "focus"
          ? "focus"
          : data.lanes.length === 1
            ? data.lanes[0]
            : multi
              ? "mixed"
              : data.emphasis === "hover"
                ? "hover"
                : data.dimmed
                  ? "dim"
                  : "base";

  const signalLane = data.signal ? lanes.find((l) => l.tone === data.signal?.tone) : undefined;
  const mid = edgeMidpoint(source, data.waypoints, target);

  return (
    <>
      <g
        className={cn(
          "cl-edge",
          toneClass,
          data.dimmed && "is-dimmed",
          data.emphasis !== "none" && `is-${data.emphasis}`,
          data.presence !== "present" && `is-${data.presence}`,
          data.signal && "is-active",
        )}
      >
        {lanes.map((l) => (
          <path key={l.tone} className={cn("cl-lane", `cl-lane--${l.tone}`)} d={l.d} />
        ))}
        <path
          className="cl-edge__line"
          d={base}
          markerEnd={markerUrl(marker)}
          pathLength={data.presence === "added" ? 1 : undefined}
        />
        <path className="cl-edge__hit" d={base} />
        {data.signal && signalLane && !reducedMotion && data.presence !== "absent" ? (
          <SignalDot d={signalLane.d} spec={data.signal} />
        ) : null}
      </g>
      {data.showLabel && data.presence !== "absent" ? (
        <EdgeLabelRenderer>
          <div
            className="cl-edge-label"
            style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});
