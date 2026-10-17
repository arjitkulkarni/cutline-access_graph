"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { cn } from "@/lib/format";
import type { GraphSceneHandle, RejectAttempt, StoryStep } from "./GraphScene";
import { HACKATHON, MIGRATION } from "./data";
import { Blade, Rise, Roll, Words } from "./primitives";

const STAGE_NAMES = ["Breach", "Trace", "Reject", "Repair", "Verify"] as const;

/** One hero line, rendered twice and clipped along a diagonal so a red blade can part it. */
function Slice({ text, n, className }: { text: string; n: 1 | 2; className?: string }) {
  return (
    <span aria-hidden className={cn("lp-slice", `lp-slice--${n}`, className)}>
      <span className="lp-slice-top">{text}</span>
      <span className="lp-slice-bottom">{text}</span>
      {/* same diagonal as the clip-paths: (0, 64%) → (100%, 40%), extended 3% past each side */}
      <Blade y1={0.647} y2={0.393} />
    </span>
  );
}

function StepLabel({ n, name }: { n: number; name: string }) {
  return (
    <p className="lp-mono-label flex items-center gap-3">
      <span className="text-[var(--lp-red)]">{String(n).padStart(2, "0")} / 04</span>
      <span className="h-px w-6 bg-[var(--lp-line-3)]" aria-hidden />
      {name}
    </p>
  );
}

export function Story() {
  const mount = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const handle = useRef<GraphSceneHandle | null>(null);
  const section = useRef<HTMLElement>(null);
  const stepRef = useRef<StoryStep>(0);
  const reduced = useReducedMotion() ?? false;
  const [step, setStep] = useState<StoryStep>(0);
  const [attempt, setAttempt] = useState<RejectAttempt>("A");
  const [failed, setFailed] = useState(false);

  // Mount the WebGL scene lazily (three.js stays out of the initial bundle).
  useEffect(() => {
    let cancelled = false;
    import("./GraphScene")
      .then(({ createGraphScene }) => {
        if (cancelled || !mount.current || !labels.current) return;
        handle.current = createGraphScene({ container: mount.current, labelLayer: labels.current, reducedMotion: reduced, onAttempt: setAttempt });
        handle.current.setStep(stepRef.current);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      handle.current?.dispose();
      handle.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    stepRef.current = step;
    handle.current?.setStep(step);
  }, [step]);

  // The step whose block crosses the reading line drives the scene.
  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 1023px)").matches;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step) as StoryStep);
      },
      { rootMargin: mobile ? "-66% 0px -33% 0px" : "-49% 0px -50% 0px" },
    );
    section.current?.querySelectorAll("[data-step]").forEach((b) => io.observe(b));
    return () => io.disconnect();
  }, []);

  const stageName = step === 2 ? `Reject · attempt ${attempt}` : STAGE_NAMES[step];

  return (
    <section ref={section} id="top" className="lp-story" aria-label="How CUTLINE repairs a dangerous permission">
      {/* ── Hero: step 0 ─────────────────────────────────────────────────────────── */}
      <div className="lp-story-hero lp-story-col">
        <div data-step={0} className="lp-hero-block">
          <div className="lp-hero-copy">
            <Rise delay={1.3}>
              <p className="lp-hero-meta">
                <a href={HACKATHON.url} target="_blank" rel="noreferrer">
                  Graph Hacks
                </a>
                <i aria-hidden />
                <span>FalkorDB × WeMakeDevs</span>
                <i aria-hidden />
                <span className="text-[var(--lp-red)]">Track 01</span>
              </p>
            </Rise>

            <h1 className="lp-h1 mt-8">
              <span className="sr-only">Cut the dangerous path. Keep the work alive.</span>
              <Slice n={1} text="Cut the dangerous path." />
              <Slice n={2} text="Keep the work alive." className="text-[var(--lp-bone-3)]" />
            </h1>

            <Rise delay={1.9}>
              <p className="lp-lead mt-8">
                CUTLINE is a permission-repair agent built on FalkorDB. Name the access that must disappear and the workflows that must
                survive. It traces every hidden route, rejects unsafe fixes with counterexamples, and proves the repair against a running
                app before anything changes.
              </p>
            </Rise>

            <Rise delay={2.05}>
              <div className="mt-10 flex flex-wrap items-center gap-3">
                <a href="/overview" className="lp-btn lp-btn-primary">
                  <Roll>Open the console</Roll>
                  <ArrowRight size={15} aria-hidden />
                </a>
                <a href="#trace" className="lp-btn lp-btn-ghost">
                  <Roll>Scroll the repair</Roll>
                  <ArrowDown size={15} aria-hidden />
                </a>
              </div>
            </Rise>

            <Rise delay={2.2}>
              <div className="lp-ticker mt-12 max-w-[440px]">
                <span className="lp-mono-label flex items-center gap-2.5">
                  <span className="lp-live" aria-hidden />
                  Live · before CUTLINE
                </span>
                <span className="text-[var(--lp-bone-2)]">
                  POST /demo/customers/export <span className="text-[var(--lp-bone-3)]">as</span> <span className="text-[var(--lp-bone)]">maya</span>
                </span>
                <span className="flex flex-wrap items-center gap-2.5">
                  <span className="lp-code-pill lp-code-pill--red">200</span>
                  <span className="text-[var(--lp-bone)]">1,000 customer records</span>
                  <span className="text-[var(--lp-bone-3)]">exported by a support agent</span>
                </span>
              </div>
            </Rise>
          </div>
        </div>
      </div>

      {/* ── Sticky 3D stage ──────────────────────────────────────────────────────── */}
      <div
        className="lp-story-stage"
        role="img"
        aria-label="Permission graph. Maya and Noah reach export_customers through Shared Ops and Export Helper. Detaching Shared Ops leaves Export Helper open; revoking export from Shared Ops breaks Finance. CUTLINE cuts their Support assignments and adds Support (safe); Felix and the DSAR Bot keep their routes."
      >
        <div ref={mount} className="lp-stage-canvas" />
        <div className="lp-stage-horizon" aria-hidden />
        <div className="lp-stage-vignette" aria-hidden />
        <div ref={labels} className="lp-stage-labels" aria-hidden />
        <div className="lp-stage-hud" aria-hidden>
          <span className="lp-mono-label">
            <span className="text-[var(--lp-red)]">{String(step).padStart(2, "0")}</span> — {stageName}
          </span>
          <span className="lp-stage-ticks">
            {STAGE_NAMES.map((n, i) => (
              <span key={n} className="lp-stage-tick" data-on={i <= step} />
            ))}
          </span>
        </div>
        {failed ? (
          <p className="absolute inset-0 grid place-items-center px-8 text-center text-sm text-[var(--lp-bone-3)]">
            The 3D graph needs WebGL. The repair is told in full alongside.
          </p>
        ) : null}
      </div>

      {/* ── Steps 1–4 ────────────────────────────────────────────────────────────── */}
      <div className="lp-story-steps lp-story-col">
        <article id="trace" data-step={1} data-active={step === 1} className="lp-step-block">
          <div className="lp-step-body max-w-[560px]">
            <StepLabel n={1} name="Trace" />
            <Words as="h2" className="lp-h3 mt-6 block" text="Two hidden routes to a capability *nobody granted*." />
            <p className="lp-lead mt-6">
              Maya handles orders and reports. FalkorDB finds she can bulk-export customer data anyway: through Shared Ops, and through Export
              Helper. Felix needs Shared Ops for Finance close; the DSAR Bot needs Export Helper for legal data requests.
            </p>
            <p className="lp-route mt-7">
              maya → support → <b>shared_ops</b> → export_customers
              <br />
              maya → support → <b>export_helper</b> → export_customers
            </p>
            <p className="lp-mono-label mt-5">4 risky paths · 2 people × 2 routes · [:INHERITS*0..6]</p>
          </div>
        </article>

        <article id="reject" data-step={2} data-active={step === 2} className="lp-step-block">
          <div className="lp-step-body max-w-[560px]">
            <StepLabel n={2} name="Reject" />
            <Words as="h2" className="lp-h3 mt-6 block" text="The obvious fixes *break* something." />
            <p className="lp-lead mt-6">Every candidate is applied to its own copy of the graph and re-queried. Watch two of them fail.</p>
            <div className="mt-7 grid gap-3">
              <div className="lp-attempt" data-on={step !== 2 || attempt === "A"}>
                <span className="lp-mono-label">Attempt A</span>
                <span className="text-[17px] text-[var(--lp-bone)]">Detach Shared Ops from Support</span>
                <span className="lp-route">
                  still open: maya → support → <b>export_helper</b> → export_customers
                </span>
              </div>
              <div className="lp-attempt" data-on={step !== 2 || attempt === "B"}>
                <span className="lp-mono-label">Attempt B</span>
                <span className="text-[17px] text-[var(--lp-bone)]">Revoke export_customers from Shared Ops</span>
                <span className="lp-route">
                  felix loses export: <b>finance close breaks</b>. export_helper is still open.
                </span>
              </div>
            </div>
            <p className="lp-mono-label mt-6">9 of 10 candidates rejected with a counterexample</p>
          </div>
        </article>

        <article id="cut" data-step={3} data-active={step === 3} className="lp-step-block">
          <div className="lp-step-body max-w-[560px]">
            <StepLabel n={3} name="Repair" />
            <Words as="h2" className="lp-h3 mt-6 block" text="Cut two assignments. Add *one narrow role*." />
            <p className="lp-lead mt-6">
              Support (safe) grants exactly view_orders and generate_reports. Maya and Noah move onto it; nobody else changes. Seven edits,
              applied as one atomic Cypher write after a human approves.
            </p>
            <ol className="lp-diff mt-7 overflow-x-auto">
              {MIGRATION.map((m) => (
                <li key={m.text}>
                  <span className={m.sign === "+" ? "lp-diff-sign--add" : "lp-diff-sign--del"} aria-hidden>
                    {m.sign}
                  </span>
                  <span className="lp-diff-op">{m.op}</span>
                  <span className="text-[var(--lp-bone)]">{m.text}</span>
                </li>
              ))}
            </ol>
            <p className="lp-mono-label mt-5">Cost 8 · the cheapest candidate that passes all 8 constraints</p>
          </div>
        </article>

        <article id="verify" data-step={4} data-active={step === 4} className="lp-step-block">
          <div className="lp-step-body max-w-[560px]">
            <StepLabel n={4} name="Verify" />
            <Words as="h2" className="lp-h3 mt-6 block" text="Then prove it against *a running app*." />
            <p className="lp-lead mt-6">
              Real HTTP requests, decided by an independent enforcement point that must agree with FalkorDB on every single check.
            </p>
            <ul className="mt-7 grid gap-2.5 font-mono text-[12.5px]">
              {[
                ["maya", 200, 403, "denied, as required"],
                ["felix", 200, 200, "finance close"],
                ["dsar_bot", 200, 200, "dsar fulfilment"],
              ].map(([who, before, after, note]) => (
                <li key={who as string} className="flex flex-wrap items-center gap-3">
                  <span className="w-[72px] text-[var(--lp-bone-2)]">{who}</span>
                  <span className={cn("lp-code-pill", who === "maya" && "lp-code-pill--red")}>{before}</span>
                  <span className="text-[var(--lp-bone-3)]">→</span>
                  <span className="lp-code-pill lp-code-pill--bone">{after}</span>
                  <span className="text-[var(--lp-bone-3)]">{note}</span>
                </li>
              ))}
            </ul>
            <a href="#proof" className="lp-mono-label mt-7 inline-flex items-center gap-2 text-[var(--lp-bone)] hover:text-[var(--lp-red)]">
              12 / 12 checks pass · see all twelve <ArrowDown size={13} aria-hidden />
            </a>
          </div>
        </article>
      </div>
    </section>
  );
}
