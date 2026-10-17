"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { ArrowRight } from "lucide-react";
import { usePrefersReducedMotion } from "@/lib/hooks";
import { Blade, Rise, Roll, Words } from "./primitives";

/** The wordmark is cut by a red line that follows the scroll, then its halves slide apart. */
function Wordmark() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const blade = useTransform(scrollYProgress, [0.2, 0.65], [0, 1]);
  const split = useTransform(scrollYProgress, [0.6, 1], [0, 1]);
  const topX = useTransform(split, (v) => `${v * 1.4}%`);
  const topY = useTransform(split, (v) => `${v * -2.5}%`);
  const botX = useTransform(split, (v) => `${v * -1.4}%`);
  const botY = useTransform(split, (v) => `${v * 2.5}%`);

  return (
    <div ref={ref} className="lp-wordmark" aria-hidden>
      <motion.span className="lp-wordmark-top" style={reduced ? { x: "1.4%", y: "-2.5%" } : { x: topX, y: topY }}>
        CUTLINE
      </motion.span>
      <motion.span className="lp-wordmark-bottom" style={reduced ? { x: "-1.4%", y: "2.5%" } : { x: botX, y: botY }}>
        CUTLINE
      </motion.span>
      {/* same diagonal as the clip-paths: (0, 70%) → (100%, 34%), extended 3% past each side */}
      <Blade y1={0.711} y2={0.329} progress={reduced ? 1 : blade} />
    </div>
  );
}

export function ClosingSection() {
  return (
    <section className="relative overflow-hidden border-t border-[var(--lp-line)] pt-28 lg:pt-40">
      <div className="lp-container">
        <Words
          as="p"
          className="block max-w-[1040px] text-[28px] font-medium leading-[1.15] tracking-[-0.03em] text-[var(--lp-bone-2)] sm:text-[44px]"
          stagger={0.025}
          text="One dangerous capability. Two hidden graph paths. The obvious fixes *rejected with proof.* One structural migration that keeps every workflow alive, twelve real requests proving it, and a live policy change it catches and repairs."
        />
        <Rise delay={0.2}>
          <div className="mt-12 flex flex-wrap items-center gap-3">
            <a href="/overview" className="lp-btn lp-btn-primary">
              <Roll>Open the console</Roll>
              <ArrowRight size={15} aria-hidden />
            </a>
          </div>
        </Rise>
      </div>

      <div className="mt-28 overflow-hidden px-2 lg:mt-40">
        <Wordmark />
      </div>

      <footer className="border-t border-[var(--lp-line)]">
        <div className="lp-container py-8 text-[var(--lp-bone-3)]">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.1em]">
            {["FalkorDB", "FastAPI", "Next.js", "three.js", "OPA", "MCP", "Claude"].map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      </footer>
    </section>
  );
}
