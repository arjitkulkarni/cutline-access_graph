"use client";

import { useEffect, useState } from "react";

/**
 * Current time, refreshed on an interval — for relative timestamps ("4 min ago").
 * Returns 0 until mounted so prerendering never reads the clock (Cache Components rule).
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setNow(Date.now()));
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => { cancelAnimationFrame(frame); window.clearInterval(t); };
  }, [intervalMs]);
  return now;
}

/** Tracks `prefers-reduced-motion` for code paths that animate outside of Motion (rAF). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}
