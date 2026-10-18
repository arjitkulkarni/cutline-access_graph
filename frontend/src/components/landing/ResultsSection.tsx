"use client";

import { Check } from "lucide-react";
import { BENCHMARKS } from "./data";
import { Chapter, Odometer, Rise, Words, useSeen } from "./primitives";

function Bar({ label, value, of, strong }: { label: string; value: number; of: number; strong?: boolean }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div ref={ref}>
      <div className="flex items-baseline justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.1em]">
        <span className={strong ? "text-[var(--lp-bone)]" : "text-[var(--lp-bone-3)]"}>{label}</span>
        <span className="tnum text-[var(--lp-bone-2)]">
          {value}/{of}
        </span>
      </div>
      <div className="lp-bar mt-2">
        <i style={{ transform: `scaleX(${seen ? value / of : 0})`, background: strong ? "var(--lp-red)" : "var(--lp-bone-3)" }} />
      </div>
    </div>
  );
}

export function ResultsSection() {
  const b = BENCHMARKS;
  return (
    <section id="results" className="lp-section">
      <div className="lp-container">
        <Chapter index="08" name="Results" />
        <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:items-end">
          <Words as="h2" className="lp-h2 block" text="Benchmarked on *real FalkorDB Cloud.*" />
          <Rise delay={0.15}>
            <p className="lp-lead">
              Ten synthetic scenarios with known correct answers, against two deliberately simple baselines. Every number below comes from that
              run.
            </p>
          </Rise>
        </div>

        <div className="mt-16 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          <Rise className="lp-stat">
            <p className="lp-stat-value">
              <Odometer value={`${b.correct.value}`} />
              <span className="text-[var(--lp-bone-3)]">/{b.correct.of}</span>
            </p>
            <p className="mt-4 text-[14px] leading-[21px] text-[var(--lp-bone-2)]">Correct outcome: repair, refuse, or flag, as expected.</p>
          </Rise>
          <Rise className="lp-stat" delay={0.06}>
            <p className="lp-stat-value">
              <Odometer value={`${b.safe.value}`} />
              <span className="text-[var(--lp-bone-3)]">/{b.safe.of}</span>
            </p>
            <p className="mt-4 text-[14px] leading-[21px] text-[var(--lp-bone-2)]">Safe repairs on the repairable scenarios.</p>
            <div className="mt-6 grid gap-3.5">
              <Bar label="CUTLINE" value={b.safe.value} of={b.safe.of} strong />
              <Bar label={b.safe.baselineLabel} value={b.safe.baseline} of={b.safe.of} />
            </div>
          </Rise>
          <Rise className="lp-stat" delay={0.12}>
            <p className="lp-stat-value">
              <Odometer value={`${b.detected.value}`} />
              <span className="text-[var(--lp-bone-3)]">/{b.detected.of}</span>
            </p>
            <p className="mt-4 text-[14px] leading-[21px] text-[var(--lp-bone-2)]">Forbidden access detected through multi-hop routes.</p>
            <div className="mt-6 grid gap-3.5">
              <Bar label="CUTLINE" value={b.detected.value} of={b.detected.of} strong />
              <Bar label={b.detected.baselineLabel} value={b.detected.baseline} of={b.detected.of} />
            </div>
          </Rise>
          <Rise className="lp-stat" delay={0.18}>
            <p className="lp-stat-value">
              <Odometer value={b.medianPlanSeconds.toFixed(2)} />
              <span className="text-[0.5em] text-[var(--lp-bone-3)]"> s</span>
            </p>
            <p className="mt-4 text-[14px] leading-[21px] text-[var(--lp-bone-2)]">Median planning time, candidates evaluated in parallel.</p>
            <p className="mt-6 border-t border-[var(--lp-line)] pt-4 text-[14px] leading-[21px] text-[var(--lp-bone-2)]">
              <span className="tnum text-[var(--lp-bone)]">
                {b.tests.value}/{b.tests.of}
              </span>{" "}
              backend tests pass with real FalkorDB Cloud and OPA enabled.
            </p>
          </Rise>
        </div>

        <Rise className="mt-12">
          <p className="lp-note max-w-[760px]">
            <span className="text-[var(--lp-bone)]">Why 11 of 12, not 12.</span> The twelfth is an 8-hop chain, beyond the planner&apos;s 6-hop
            bound. The unbounded independent engine catches it, and CUTLINE reports the disagreement instead of hiding it.
          </p>
        </Rise>

        <div className="mt-16 grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
          <Rise>
            <div className="lp-panel overflow-x-auto">
              <table className="lp-table lp-table--stack lp-table--numbered sm:min-w-[560px]">
                <thead>
                  <tr>
                    <th scope="col" className="w-[52px]">
                      #
                    </th>
                    <th scope="col">Scenario</th>
                    <th scope="col">Outcome, as expected</th>
                  </tr>
                </thead>
                <tbody>
                  {b.scenarios.map((s, i) => (
                    <tr key={s.name}>
                      <td className="font-mono text-[12px] text-[var(--lp-red)]">{String(i + 1).padStart(2, "0")}</td>
                      <td className="text-[var(--lp-bone)]">{s.name}</td>
                      <td className="text-[var(--lp-bone-2)]">
                        <span className="inline-flex items-start gap-2">
                          <Check size={14} className="mt-[4px] shrink-0 text-[var(--lp-bone)]" aria-hidden />
                          {s.outcome}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Rise>
          <div className="grid content-start gap-8">
            <Rise delay={0.05}>
              <p className="lp-mono-label text-[var(--lp-bone)]">Supported</p>
              <p className="mt-2 text-[15px] leading-[24px] text-[var(--lp-bone-2)]">
                Allow-only RBAC with role inheritance, named principals and capabilities, bounded depth (6 inheritance hops by default).
              </p>
            </Rise>
            <Rise delay={0.1}>
              <p className="lp-mono-label text-[var(--lp-red)]">Not modelled, on purpose</p>
              <p className="mt-2 text-[15px] leading-[24px] text-[var(--lp-bone-2)]">
                Deny rules, conditions and ABAC, time-bound grants, resource-scoped grants, cloud IAM policy languages.
              </p>
              <p className="mt-4 border-t border-[var(--lp-line)] pt-4 text-[13.5px] leading-[21px] text-[var(--lp-bone-3)]">
                Not silently approximated. CUTLINE claims only what its declared model can prove, and never invents a grant to make a constraint
                pass.
              </p>
            </Rise>
          </div>
        </div>
      </div>
    </section>
  );
}
