"use client";

import { Activity, ChevronRight } from "lucide-react";
import { cn, joinNames } from "@/lib/format";
import type { Labeler } from "@/lib/labels";
import type { RouteGroup } from "@/lib/graph/paths";

const toneRing: Record<string, string> = {
  unwanted: "border-red/35 hover:border-red/70 data-[active=true]:border-red data-[active=true]:bg-red/[0.05]",
  required: "border-sage/25 hover:border-sage/45 data-[active=true]:border-sage/70 data-[active=true]:bg-sage/[0.07]",
  permitted: "border-permitted/25 hover:border-permitted/45 data-[active=true]:border-permitted/70 data-[active=true]:bg-permitted/[0.05]",
};

const toneText: Record<string, string> = {
  unwanted: "text-red",
  required: "text-sage",
  permitted: "text-permitted",
};

/**
 * Role chains (routes) as selectable rows. Selecting one traces it on the canvas with the
 * signal animation; selecting it again stops the trace.
 */
export function RouteList({
  routes,
  label,
  activeRouteKey,
  onToggle,
  showPrincipals = true,
  showCapability = true,
  letterOffset = 0,
}: {
  routes: RouteGroup[];
  label: Labeler;
  activeRouteKey: string | null;
  onToggle: (routeKey: string | null) => void;
  showPrincipals?: boolean;
  /** Hide the final capability when the surrounding section already names it. */
  showCapability?: boolean;
  letterOffset?: number;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {routes.map((route, i) => {
        const active = route.routeKey === activeRouteKey;
        const roles = route.chain.slice(0, -1);
        const capability = route.chain[route.chain.length - 1];
        return (
          <li key={route.routeKey}>
            <button
              type="button"
              data-active={active}
              aria-pressed={active}
              onClick={() => onToggle(active ? null : route.routeKey)}
              className={cn(
                "group flex w-full items-start gap-2.5 rounded-r-md border-l-2 bg-raised/30 px-2.5 py-2.5 text-left transition-colors duration-150",
                toneRing[route.tone],
              )}
            >
              <span
                className={cn(
                  "mono mt-px inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border text-[10.5px] font-semibold",
                  route.tone === "unwanted"
                    ? "border-red/40 text-red"
                    : route.tone === "required"
                      ? "border-sage/40 text-sage"
                      : "border-permitted/40 text-permitted",
                )}
                aria-hidden
              >
                {String.fromCharCode(65 + letterOffset + i)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-col items-start gap-y-1 text-[12px] leading-5">
                  {roles.map((id, j) => (
                    <span key={id} className="inline-flex items-center gap-1">
                      <span className="text-fg">{label.node(id)}</span>
                      {j < roles.length - 1 || showCapability ? (
                        <ChevronRight size={11} strokeWidth={2.25} className={toneText[route.tone]} aria-label="to" />
                      ) : null}
                    </span>
                  ))}
                  {showCapability ? <span className="mono break-all text-[11px] text-fg-2">{capability}</span> : null}
                </span>
                {showPrincipals ? (
                  <span className="mt-0.5 flex items-baseline gap-2 text-xs text-fg-3">
                    <span className="min-w-0 truncate">{joinNames(route.principals.map((p) => label.node(p)))}</span>
                    {route.paths.length > 1 ? <span className="tnum ml-auto shrink-0">{route.paths.length} paths</span> : null}
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  "mt-0.5 inline-flex shrink-0 items-center gap-1 text-[11px] transition-opacity",
                  active ? cn("opacity-100", toneText[route.tone]) : "text-fg-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
                )}
              >
                <Activity size={12} strokeWidth={2} aria-hidden />
                {active ? "Selected" : "Trace"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
