"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/format";

/** A check that draws itself once when it first appears (never loops). */
export function AnimatedCheck({ size = 14, delay = 0, className }: { size?: number; delay?: number; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cn("shrink-0", className)} aria-hidden>
      <motion.circle
        cx="8"
        cy="8"
        r="7"
        stroke="currentColor"
        strokeOpacity={0.35}
        strokeWidth="1.25"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18, delay }}
      />
      <motion.path
        d="M4.9 8.3 L7 10.4 L11.2 5.9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduced ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.28, delay: delay + 0.06, ease: [0.25, 1, 0.5, 1] }}
      />
    </svg>
  );
}

export function CrossMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={cn("shrink-0", className)} aria-hidden>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity={0.35} strokeWidth="1.25" />
      <path d="M5.6 5.6 L10.4 10.4 M10.4 5.6 L5.6 10.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
