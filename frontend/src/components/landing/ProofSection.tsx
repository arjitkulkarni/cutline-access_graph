"use client";

import { Fragment, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/hooks";
import { CHECKS, type CheckGroup } from "./data";
import { Chapter, Rise, Words, useSeen } from "./primitives";

const GROUP_LABEL: Record<CheckGroup, string> = {
  deny: "Must be denied",
  keep: "Must keep access",
  unchanged: "Not in the contract · must not change",
};

function RequestLog() {
  const [ref, seen] = useSeen<HTMLDivElement>("0px 0px -25% 0px");
  const reduced = usePrefersReducedMotion();
  const [done, setDone] = useState(0);
  const shown = reduced ? CHECKS.length : done;

  useEffect(() => {
    if (!seen || reduced) return;
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setDone(n);
      if (n >= CHECKS.length) window.clearInterval(id);
    }, 210);
    return () => window.clearInterval(id);
  }, [seen, reduced]);

  return (
    <div ref={ref} className="lp-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--lp-line-2)] px-5 py-3.5">
        <p className="lp-mono-label">Runtime verification · candidate policy</p>
        <p className="font-mono text-[12px] tnum">
          <span className={shown === CHECKS.length ? "text-[var(--lp-bone)]" : "text-[var(--lp-red)]"}>{String(shown).padStart(2, "0")}</span>
          <span className="text-[var(--lp-bone-3)]"> / {CHECKS.length} passed</span>
        </p>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          {CHECKS.map((c, i) => {
            const header = i === 0 || CHECKS[i - 1].group !== c.group;
            const ran = i < shown;
            return (
              <Fragment key={i}>
                {header ? <div className="lp-log-group">{GROUP_LABEL[c.group]}</div> : null}
                <div className="lp-log-row" data-scan={i === shown - 1}>
                  <span className="min-w-0 truncate">
                    <span className="text-[var(--lp-bone)]">{c.who}</span>
                    <span className="ml-2.5 font-mono text-[11.5px] text-[var(--lp-bone-3)]">
                      {c.method} {c.path}
                    </span>
                  </span>
                  <span className={cn("lp-code-pill justify-self-end", c.group === "deny" && "lp-code-pill--red")}>{c.before}</span>
                  <span className="text-center font-mono text-[12px] text-[var(--lp-bone-3)]" aria-hidden>
                    →
                  </span>
                  <span className={cn("lp-code-pill justify-self-start transition-opacity duration-300", ran ? "opacity-100" : "opacity-0", c.group === "deny" && "lp-code-pill--bone")}>
                    {c.after}
                  </span>
                  <span className="grid place-items-center">
                    {ran ? <Check size={15} strokeWidth={2.5} className="text-[var(--lp-bone)]" aria-label="passed" /> : <span className="h-px w-3 bg-[var(--lp-line-3)]" aria-hidden />}
                  </span>
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ProofSection() {
  return (
    <section id="proof" className="lp-section">
      <div className="lp-container">
        <Chapter index="03" name="Proof" />
        <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16">
          <div className="lg:order-2">
            <Words as="h2" className="lp-h2 block" text="Not a green tick. *Twelve real requests.*" />
            <Rise delay={0.15}>
              <p className="lp-lead mt-7">
                Before anything is applied, CUTLINE calls a running Customer Ops app, against the current policy and against the candidate.
                Every principal and capability is checked, including the ones nobody asked to change.
              </p>
            </Rise>
            <Rise delay={0.25}>
              <dl className="mt-10 grid gap-6">
                <div className="lp-note">
                  <dt className="lp-mono-label text-[var(--lp-bone)]">Planner · predicts</dt>
                  <dd className="mt-1.5">Reads the full policy graph with variable-length Cypher on FalkorDB.</dd>
                </div>
                <div className="lp-note">
                  <dt className="lp-mono-label text-[var(--lp-bone)]">Enforcement point · decides</dt>
                  <dd className="mt-1.5">
                    Reads only one-hop relations and computes reachability itself, with a reference closure or OPA and Rego. Separate code, so a
                    bug in one shows up as a disagreement, never as a false pass.
                  </dd>
                </div>
              </dl>
              <p className="mt-8 font-mono text-[12px] text-[var(--lp-bone-3)]">
                X-Cutline-Policy: <span className="text-[var(--lp-bone)]">candidate:&lt;repair_id&gt;</span> tests a repair before it exists.
              </p>
            </Rise>
          </div>
          <Rise className="lg:order-1">
            <RequestLog />
          </Rise>
        </div>
      </div>
    </section>
  );
}
