"use client";

import { AnimatePresence, motion } from "motion/react";
import { Clock3, X } from "lucide-react";
import { cn } from "@/lib/format";
import type { Stage, StageState } from "@/lib/repair";
import { AnimatedCheck } from "@/components/ui/AnimatedCheck";

function StageMarker({ state, index }: { state: StageState; index: number }) {
  return (
    <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.16 }}
          className="absolute inset-0 inline-flex items-center justify-center"
        >
          {state === "complete" ? (
            <AnimatedCheck size={22} className="text-sage" />
          ) : state === "failed" ? (
            <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border border-red/45 bg-red/10 text-red">
              <X size={12} strokeWidth={2.25} aria-hidden />
            </span>
          ) : state === "stale" ? (
            <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border border-amber/45 bg-amber/10 text-amber">
              <Clock3 size={12} strokeWidth={2} aria-hidden />
            </span>
          ) : (
            <span
              className={cn(
                "mono inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border text-[11px] font-semibold",
                state === "current" ? "border-accent bg-accent/12 text-accent" : "border-line-strong text-fg-3",
              )}
            >
              {index + 1}
            </span>
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const STATE_TEXT: Record<StageState, string> = {
  complete: "complete",
  current: "current step",
  upcoming: "not started",
  failed: "failed",
  stale: "stale",
};

/** Discover → Plan → Verify → Apply, derived from RepairPlan.status and the stale flag. */
export function RepairTimeline({ stages, className }: { stages: Stage[]; className?: string }) {
  return (
    <ol className={cn("flex min-w-0 flex-1 items-center gap-0", className)} aria-label="Repair progress">
      {stages.map((s, i) => (
        <li
          key={s.key}
          className={cn("flex min-w-0 items-center", i < stages.length - 1 ? "flex-1" : "flex-none")}
          aria-current={s.state === "current" ? "step" : undefined}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <StageMarker state={s.state} index={i} />
            <div className="min-w-0">
              <p
                className={cn(
                  "text-[13px] font-medium leading-5",
                  s.state === "upcoming" ? "text-fg-2" : "text-fg",
                )}
              >
                {s.label}
                <span className="sr-only"> — {STATE_TEXT[s.state]}</span>
              </p>
              <p
                className={cn(
                  "truncate text-xs leading-4",
                  s.state === "failed" ? "text-red" : s.state === "stale" ? "text-amber" : "text-fg-3",
                )}
                title={s.detail}
              >
                {s.detail}
              </p>
            </div>
          </div>
          {i < stages.length - 1 ? (
            <span
              className={cn(
                "mx-3 h-px min-w-6 flex-1 transition-colors duration-300",
                s.state === "complete" ? "bg-sage/45" : "bg-line-strong",
              )}
              aria-hidden
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
