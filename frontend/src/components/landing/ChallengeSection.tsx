"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Ban, Check, RotateCcw, Zap } from "lucide-react";
import { cn } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/hooks";
import { Chapter, EASE_OUT, Odometer, Rise, Words, useSeen } from "./primitives";

/**
 * Scripted replay of the live challenge from the demo. Stages:
 * 0 verified on r4 · 1 mutation lands (r5) · 2 evidence stale, apply refused
 * 3 FalkorDB traces the new route · 4 re-plan verified on r5
 */
const STAGE_MS = [1400, 1500, 1500, 1800];
const reveal = { initial: { opacity: 0, height: 0 }, animate: { opacity: 1, height: "auto" }, transition: { duration: 0.45, ease: EASE_OUT } };

function ChallengeConsole() {
  const [ref, seen] = useSeen<HTMLDivElement>("0px 0px -25% 0px");
  const reduced = usePrefersReducedMotion();
  const [played, setStage] = useState(0);
  const timers = useRef<number[]>([]);
  const stage = reduced && seen ? 4 : played;

  const schedule = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    let at = 0;
    STAGE_MS.forEach((ms, i) => {
      at += ms;
      timers.current.push(window.setTimeout(() => setStage(i + 1), at));
    });
  }, []);

  const replay = () => {
    setStage(0);
    schedule();
  };

  useEffect(() => {
    if (!seen || reduced) return;
    schedule();
    const pending = timers.current;
    return () => pending.forEach(window.clearTimeout);
  }, [seen, reduced, schedule]);

  const stale = stage >= 2 && stage < 4;

  return (
    <div ref={ref} className="lp-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--lp-line-2)] px-5 py-3">
        <p className="lp-mono-label">Repair Studio · live challenge</p>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[12px] text-[var(--lp-bone-3)]">
            policy{" "}
            <span className={cn("inline-flex items-center leading-none", stage >= 1 ? "text-[var(--lp-red)]" : "text-[var(--lp-bone)]")}>
              r<Odometer value={stage >= 1 ? "5" : "4"} />
            </span>{" "}
            · sha256:{stage >= 1 ? "02ce…" : "eb8b…"}
          </span>
          {!reduced ? (
            <button type="button" onClick={replay} className="lp-icon-btn !h-7 !w-7" aria-label="Replay the live challenge">
              <RotateCcw size={13} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2.5 p-5" aria-live="polite">
        <div className={cn("lp-console-line transition-colors duration-500", stale ? "lp-console-line--stale" : "lp-console-line--ok")}>
          {stale ? <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[var(--lp-red)]" aria-hidden /> : <Check size={17} className="mt-0.5 shrink-0 text-[var(--lp-bone)]" aria-hidden />}
          <div className="min-w-0">
            {stale ? (
              <>
                <p className="text-[var(--lp-bone)]">Evidence is stale: policy moved from r4 to r5</p>
                <p className="text-[var(--lp-bone-2)]">The verification was bound to r4. Its results no longer describe the active policy.</p>
              </>
            ) : stage >= 4 ? (
              <>
                <p className="text-[var(--lp-bone)]">Re-planned and verified on r5</p>
                <p className="text-[var(--lp-bone-2)]">New evidence, bound to the new revision and hash.</p>
              </>
            ) : (
              <>
                <p className="text-[var(--lp-bone)]">Verified on r4 · 12 / 12 checks</p>
                <p className="text-[var(--lp-bone-2)]">Support (safe) applied. Evidence is bound to r4 and its content hash.</p>
              </>
            )}
          </div>
        </div>

        <AnimatePresence initial={false}>
          {stage >= 1 ? (
            <motion.div key="mut" {...reveal} className="overflow-hidden">
              <div className="lp-console-line">
                <Zap size={16} className="mt-0.5 shrink-0 text-[var(--lp-red)]" aria-hidden />
                <p className="text-[var(--lp-bone-2)]">
                  <span className="text-[var(--lp-bone)]">Someone attaches Contractor Tools</span> to Support (safe). It grants export_customers.
                </p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {stage >= 3 ? (
            <motion.div key="path" {...reveal} className="overflow-hidden">
              <div className="lp-console-line block">
                <p className="lp-mono-label">FalkorDB · new forbidden route</p>
                <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[12px]">
                  {["maya", "support_safe", "contractor_tools", "export_customers"].map((n, i, a) => (
                    <motion.span key={n} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 + i * 0.2, duration: 0.25 }} className="inline-flex items-center gap-1.5">
                      <span className={n === "contractor_tools" ? "text-[var(--lp-red-hi)]" : "text-[var(--lp-bone)]"}>{n}</span>
                      {i < a.length - 1 ? <span className="text-[var(--lp-red)]">→</span> : null}
                    </motion.span>
                  ))}
                </p>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <span className={cn("lp-fake-btn", stale ? "lp-fake-btn--blocked" : "lp-fake-btn--ok")}>
            {stale ? <Ban size={13} aria-hidden /> : <Check size={13} aria-hidden />}
            {stale ? "Apply" : stage >= 4 ? "Ready for approval" : "Applied"}
          </span>
          <AnimatePresence initial={false} mode="popLayout">
            {stale ? (
              <motion.span key="409" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="font-mono text-[12px] text-[var(--lp-red)]">
                409 STALE_PROPOSAL
              </motion.span>
            ) : null}
            {stage >= 4 ? (
              <motion.span key="fix" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="font-mono text-[12px] text-[var(--lp-bone)]">
                1 edit · detach contractor_tools from support_safe
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
      </div>

      <div className="h-[2px] bg-[var(--lp-line)]" aria-hidden>
        <div className="h-full origin-left bg-[var(--lp-red)] transition-transform duration-500" style={{ transform: `scaleX(${stage / 4})` }} />
      </div>
    </div>
  );
}

export function ChallengeSection() {
  return (
    <section id="challenge" className="lp-section">
      <div className="lp-container">
        <Chapter index="05" name="Live challenge" />
        <div className="mt-14 grid items-start gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <Words as="h2" className="lp-h2 block" text="Change the graph underneath it. *The proof expires.*" />
            <Rise delay={0.15}>
              <p className="lp-lead mt-7">
                Evidence is never trusted forever. Every plan records the policy revision and a sha256 hash of the policy&apos;s edges it was built
                on.
              </p>
            </Rise>
            <Rise delay={0.25}>
              <dl className="mt-10 grid gap-6">
                {[
                  ["Stale is a live check, not a status", "Recomputed on every read. Approve and apply refuse a stale plan with 409 STALE_PROPOSAL."],
                  ["The hash catches quiet edits", "Editing the graph directly in FalkorDB Browser, without bumping the revision, still invalidates the proof."],
                  ["The write checks again", "The atomic apply compares the revision inside the statement. If it moved, zero rows match and nothing is written."],
                ].map(([t, d]) => (
                  <div key={t} className="lp-note">
                    <dt className="text-[var(--lp-bone)]">{t}</dt>
                    <dd className="mt-1">{d}</dd>
                  </div>
                ))}
              </dl>
            </Rise>
          </div>
          <Rise delay={0.1}>
            <ChallengeConsole />
          </Rise>
        </div>
      </div>
    </section>
  );
}
