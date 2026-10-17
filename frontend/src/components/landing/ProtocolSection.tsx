"use client";

import { PIPELINE } from "./data";
import { Chapter, Rise, Words, useSeen } from "./primitives";

const ROLES = [
  { who: "The AI", does: "interprets and explains" },
  { who: "FalkorDB", does: "holds and reasons over the permission state" },
  { who: "A deterministic planner and verifier", does: "make every security decision" },
  { who: "An independent engine", does: "confirms predictions against real enforcement" },
];

function ProtocolRow({ i, title, body, tag }: { i: number; title: string; body: string; tag: string }) {
  const [ref, seen] = useSeen<HTMLLIElement>("0px 0px -18% 0px");
  return (
    <li ref={ref} data-in={seen} className="lp-proto-row">
      <span className="lp-proto-num tnum" aria-hidden>
        {String(i + 1).padStart(2, "0")}
      </span>
      <h3 className="text-[24px] font-semibold leading-tight tracking-[-0.03em] text-[var(--lp-bone)]">
        <span className="sr-only">Step {i + 1}: </span>
        {title}
      </h3>
      <p className="max-w-[54ch] text-[15.5px] leading-[25px] text-[var(--lp-bone-2)]">{body}</p>
      <span className="lp-tag md:justify-self-end">{tag}</span>
    </li>
  );
}

export function ProtocolSection() {
  return (
    <section id="how" className="lp-section">
      <div className="lp-container">
        <Chapter index="04" name="Protocol" />
        <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <Words as="h2" className="lp-h2 block" text="Six steps. The AI decides *none of them.*" />
          <Rise delay={0.15}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {ROLES.map((r, i) => (
                <li key={r.who} className="text-[14.5px] leading-[22px]">
                  <span className="lp-mono-label block text-[var(--lp-red)]">{String.fromCharCode(97 + i)}</span>
                  <span className="text-[var(--lp-bone)]">{r.who}</span> <span className="text-[var(--lp-bone-2)]">{r.does}.</span>
                </li>
              ))}
            </ul>
          </Rise>
        </div>
        <ol className="mt-16 border-b border-[var(--lp-line-2)]">
          {PIPELINE.map((s, i) => (
            <ProtocolRow key={s.title} i={i} title={s.title} body={s.body} tag={s.tag} />
          ))}
        </ol>
        <Rise className="mt-8">
          <p className="lp-mono-label">The model is never the security proof.</p>
        </Rise>
      </div>
    </section>
  );
}
