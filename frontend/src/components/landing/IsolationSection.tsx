"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/hooks";
import { CANDIDATES } from "./data";
import { Chapter, Rise, Words, useSeen } from "./primitives";

const TILES = 10;
const PASSING = 9; // cand_10, the scoped-role migration

function Glyph() {
  return (
    <svg viewBox="0 0 40 22" className="h-[16px] w-[30px]" aria-hidden>
      <path d="M5 11 C12 11 12 5 20 5 M5 11 C12 11 12 17 20 17 M20 5 C27 5 28 11 35 11 M20 17 C27 17 28 11 35 11" fill="none" stroke="#5c5650" strokeWidth={1.3} />
      {[
        [5, 11],
        [20, 5],
        [20, 17],
        [35, 11],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={2.3} fill="#050505" stroke="#8a847c" strokeWidth={1.2} />
      ))}
    </svg>
  );
}

function CandidateGraphs() {
  const [ref, seen] = useSeen<HTMLDivElement>("0px 0px -25% 0px");
  const reduced = usePrefersReducedMotion();
  const [judged, setJudged] = useState(0);
  const shown = reduced ? TILES : judged;

  useEffect(() => {
    if (!seen || reduced) return;
    let n = 0;
    let id = 0;
    const start = window.setTimeout(() => {
      id = window.setInterval(() => {
        n += 1;
        setJudged(n);
        if (n >= TILES) window.clearInterval(id);
      }, 190);
    }, 450);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(id);
    };
  }, [seen, reduced]);

  return (
    <div ref={ref}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="lp-mono-label">
          <span className="text-[var(--lp-bone)]">cutline_dev</span> → GRAPH.COPY × {TILES}
        </p>
        <p className="lp-mono-label tnum">
          <span className="text-[var(--lp-red)]">{Math.min(shown, PASSING)}</span> struck ·{" "}
          <span className="text-[var(--lp-bone)]">{shown > PASSING ? 1 : 0}</span> survives
        </p>
      </div>
      <ol className="mt-4 grid grid-cols-5 gap-1.5 sm:gap-2" aria-label="Ten isolated candidate graphs: nine rejected, one passes">
        {Array.from({ length: TILES }, (_, i) => {
          const verdict = i < shown ? (i === PASSING ? "pass" : "fail") : "pending";
          return (
            <li key={i} className="lp-tile" data-verdict={verdict}>
              <div className="lp-tile-body flex h-full flex-col justify-between">
                <span className="font-mono text-[10.5px] text-[var(--lp-bone-3)] sm:text-[11px]">
                  <span className="hidden sm:inline">cand_</span>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="hidden sm:block">
                  <Glyph />
                </span>
              </div>
              <span className="lp-tile-strike" aria-hidden />
              {verdict === "pass" ? <Check size={14} strokeWidth={2.5} className="absolute right-2 top-2 text-[var(--lp-bone)]" aria-label="passes" /> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function IsolationSection() {
  return (
    <section id="isolation" className="lp-section">
      <div className="lp-container">
        <Chapter index="02" name="Isolation" />
        <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <Words as="h2" className="lp-h2 block" text="Every candidate gets *its own graph.*" />
            <Rise delay={0.15}>
              <p className="lp-lead mt-7">
                CUTLINE never judges a fix in its head. Each candidate is applied to a GRAPH.COPY of the policy and re-queried in FalkorDB. A
                rejection always carries a counterexample: the route still open, or the workflow that would break.
              </p>
            </Rise>
          </div>
          <Rise delay={0.1}>
            <CandidateGraphs />
          </Rise>
        </div>

        <Rise className="mt-16">
          <div className="lp-panel overflow-x-auto">
            <table className="lp-table min-w-[640px]">
              <thead>
                <tr>
                  <th scope="col" className="w-[130px]">
                    Verdict
                  </th>
                  <th scope="col">Candidate fix</th>
                  <th scope="col">Counterexample, found on the copy</th>
                </tr>
              </thead>
              <tbody>
                {CANDIDATES.map((c) => {
                  const pass = c.verdict === "pass";
                  return (
                    <tr key={c.fix} className={cn(pass && "lp-pass-row")}>
                      <td>
                        <span className={cn("lp-verdict", pass ? "lp-verdict--pass" : "lp-verdict--fail")}>
                          {pass ? <Check size={13} strokeWidth={2.5} aria-hidden /> : <X size={13} strokeWidth={2.5} aria-hidden />}
                          {pass ? "Pass" : "Rejected"}
                        </span>
                      </td>
                      <td className="text-[15px] text-[var(--lp-bone)]">{c.fix}</td>
                      <td className="text-[14px] text-[var(--lp-bone-2)]">
                        {c.why}
                        {c.path ? <span className="lp-route mt-1 block">{c.path}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Rise>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Rise>
            <p className="lp-note">
              <span className="text-[var(--lp-bone)]">Bounded on purpose.</span> At most 24 candidates, cuts of at most 3 edges, inheritance depth
              6. CUTLINE returns the cheapest candidate that passes, not a claim of global optimality.
            </p>
          </Rise>
          <Rise delay={0.08}>
            <p className="lp-note">
              <span className="text-[var(--lp-bone)]">Reported, not hidden.</span> The old Support role still reaches export, now held only by the
              DSAR Bot. Anyone newly assigned to it would inherit export, so CUTLINE flags it for review.
            </p>
          </Rise>
        </div>
      </div>
    </section>
  );
}
