"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/hooks";
import { AGENT_RUN, HACKATHON, TOOLS, TRACK_FIT } from "./data";
import { Chapter, Rise, Words, useSeen } from "./primitives";

const KIND_LABEL = { read: "read", isolated: "isolated write", destructive: "human-approved only" } as const;

// Timeline of the replay, in ms from the moment the terminal scrolls into view.
const CHAR_MS = 26;
const GAP_MS = 260;
const timeline = (() => {
  let t = 300;
  return AGENT_RUN.map((s) => {
    const typeEnd = t + s.tool.length * CHAR_MS;
    const countMs = Math.min(700, 200 + s.ms * 0.18);
    const entry = { start: t, typeEnd, countEnd: typeEnd + countMs };
    t = entry.countEnd + GAP_MS;
    return entry;
  });
})();
const TOTAL = timeline[timeline.length - 1].countEnd + 200;

function AgentTerminal() {
  const [ref, seen] = useSeen<HTMLDivElement>("0px 0px -20% 0px");
  const reduced = usePrefersReducedMotion();
  const [elapsed, setElapsed] = useState(0);
  const t = reduced ? TOTAL : elapsed;

  useEffect(() => {
    if (!seen || reduced) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const e = now - t0;
      setElapsed(e);
      if (e < TOTAL) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, reduced]);

  const typing = timeline.findIndex((x) => t >= x.start && t < x.typeEnd);
  const done = t >= TOTAL;

  return (
    <div ref={ref} className="lp-term">
      <div className="lp-term-bar">
        <span className="min-w-0 truncate">POST /api/agent/investigate</span>
        <span className="shrink-0 text-[var(--lp-bone-3)]">
          deterministic<span className="hidden sm:inline"> · recorded 16 Oct</span>
        </span>
      </div>
      <ol className="min-h-[452px] px-4 py-3 font-mono text-[11.5px] sm:min-h-[392px] sm:px-5 sm:text-[12px]">
        {AGENT_RUN.map((s, i) => {
          const tl = timeline[i];
          if (t < tl.start) return null;
          const typed = s.tool.slice(0, Math.max(0, Math.floor((t - tl.start) / CHAR_MS)));
          const out = t >= tl.typeEnd;
          const ms = out ? Math.round(Math.min(1, (t - tl.typeEnd) / (tl.countEnd - tl.typeEnd)) * s.ms) : 0;
          return (
            <li key={`${s.tool}-${i}`} className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-baseline gap-x-3 py-[7px]">
              <span className="text-[var(--lp-bone-3)]">{i + 1}</span>
              <span className="min-w-0">
                <span className="text-[var(--lp-red-hi)]">{typed}</span>
                {typing === i ? <span className="lp-caret" aria-hidden /> : null}
                <span className={cn("mt-0.5 block text-[var(--lp-bone-2)] transition-opacity duration-200 sm:truncate", out ? "opacity-100" : "opacity-0")} title={s.out}>
                  {s.out}
                </span>
              </span>
              <span className={cn("tnum text-[var(--lp-bone-3)] transition-opacity duration-200", out ? "opacity-100" : "opacity-0")}>
                {ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`}
              </span>
            </li>
          );
        })}
        {done ? (
          <li className="mt-2 border-t border-[var(--lp-line)] pt-3 font-sans text-[13.5px] leading-5 text-[var(--lp-bone)]">
            “A human must review and approve the repair in the console before it is applied.”
          </li>
        ) : null}
      </ol>
    </div>
  );
}

export function AgentSection() {
  return (
    <section id="agent" className="lp-section">
      <div className="lp-container">
        <Chapter index="07" name={HACKATHON.track} />
        <div className="mt-14 grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <Words as="h2" className="lp-h2 block" text="An agent that uses the graph to *decide and act.*" />
            <Rise delay={0.15}>
              <p className="lp-lead mt-7">
                The model chooses which investigation to run. It never writes Cypher, never sees graph names, and can never approve. With an
                Anthropic API key, Claude picks the tools in a tool-use loop; without one, the same tools run in a fixed order and the run is
                labelled deterministic.
              </p>
            </Rise>
            <ol className="mt-12 border-t border-[var(--lp-line-2)]">
              {TRACK_FIT.map((r, i) => (
                <li key={r.ask} className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-4 border-b border-[var(--lp-line)] py-5">
                  <span className="font-mono text-[11px] text-[var(--lp-red)]">{String(i + 1).padStart(2, "0")}</span>
                  <Rise delay={i * 0.05}>
                    <p className="text-[16px] text-[var(--lp-bone)]">{r.ask}</p>
                    <p className="mt-1 text-[14.5px] leading-[22px] text-[var(--lp-bone-2)]">{r.how}</p>
                  </Rise>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
            <Rise delay={0.05}>
              <AgentTerminal />
            </Rise>
            <Rise delay={0.1}>
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="lp-mono-label">11 typed tools · also served over MCP</p>
                  <p className="font-mono text-[11px] text-[var(--lp-bone-3)]">app/mcp_server.py</p>
                </div>
                <ul className="mt-3.5 flex flex-wrap gap-1.5">
                  {TOOLS.map((t) => (
                    <li key={t.name} className={cn("lp-tool", `lp-tool--${t.kind}`)} title={KIND_LABEL[t.kind]}>
                      {t.name}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-[11px] text-[var(--lp-bone-3)]">
                  {(Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).map((k) => (
                    <span key={k} className="inline-flex items-center gap-2">
                      <span className={cn("size-2", k === "read" ? "border border-[var(--lp-line-3)]" : k === "isolated" ? "bg-[var(--lp-bone)]" : "bg-[var(--lp-red)]")} aria-hidden />
                      {KIND_LABEL[k]}
                    </span>
                  ))}
                </div>
              </div>
            </Rise>
          </div>
        </div>
      </div>
    </section>
  );
}
