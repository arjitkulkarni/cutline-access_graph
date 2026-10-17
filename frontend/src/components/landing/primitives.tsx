"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { motion, useInView, type MotionValue } from "motion/react";
import { cn } from "@/lib/format";

export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_CUT: [number, number, number, number] = [0.7, 0, 0.2, 1];

/** True once the element has been on screen; stays true. */
export function useSeen<T extends Element>(margin = "0px 0px -15% 0px") {
  const ref = useRef<T>(null);
  const seen = useInView(ref, { once: true, margin: margin as `${number}px` });
  return [ref, seen] as const;
}

/** A block that rises into place once it scrolls into view (CSS transition, see .lp-rise). */
export function Rise({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div ref={ref} data-in={seen} className={cn("lp-rise", className)} style={{ transitionDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

/** Splits text into lines of words; *asterisks* mark red spans, which may cover several words. */
function parseWords(text: string) {
  let index = 0;
  let red = false;
  return text.split("\n").map((line) =>
    line.split(" ").map((raw) => {
      if (raw.startsWith("*")) red = true;
      const word = { text: raw.replace(/\*/g, ""), red, index: index++ };
      if (/\*[.,;:!?]*$/.test(raw)) red = false;
      return word;
    }),
  );
}

/**
 * Words rise out of a hairline mask one after another. Wrap words in *asterisks* to set them in red.
 * Line breaks: use "\n".
 */
export function Words({
  text,
  as: Tag = "span",
  className,
  delay = 0,
  stagger = 0.045,
  start,
}: {
  text: string;
  as?: ElementType;
  className?: string;
  delay?: number;
  stagger?: number;
  /** Force the reveal (e.g. the hero, which plays on load). Defaults to "when scrolled into view". */
  start?: boolean;
}) {
  const [ref, seen] = useSeen<HTMLElement>("0px 0px -10% 0px");
  const shown = start ?? seen;
  const lines = parseWords(text);
  return (
    <Tag ref={ref} className={className}>
      <span className="sr-only">{text.replace(/\*/g, "")}</span>
      <span aria-hidden className="lp-words" data-in={shown}>
        {lines.map((line, li) => (
          <span key={li} className={cn(lines.length > 1 && "block")}>
            {line.map((w, wi) => (
              <span key={wi}>
                <span className="lp-w">
                  <span className={w.red ? "lp-red" : undefined} style={{ transitionDelay: `${delay + w.index * stagger}s` }}>
                    {w.text}
                  </span>
                </span>
                {wi < line.length - 1 ? " " : null}
              </span>
            ))}
          </span>
        ))}
      </span>
    </Tag>
  );
}

/** Chapter header: red index, a red incision that runs across the page, the chapter name. */
export function Chapter({ index, name, className }: { index: string; name: string; className?: string }) {
  const [ref, seen] = useSeen<HTMLDivElement>("0px 0px -8% 0px");
  return (
    <div ref={ref} data-in={seen} className={cn("lp-chapter", className)}>
      <span className="lp-chapter-index">{index}</span>
      <span className="lp-chapter-rule" aria-hidden />
      <span className="lp-chapter-name">{name}</span>
    </div>
  );
}

/**
 * A red incision across its parent box, from (-3%, y1) to (103%, y2) in fractions of the box.
 * Drawn in real pixels (viewBox = measured size) so the stroke and its dash maths stay exact:
 * a stretched viewBox with non-scaling-stroke turns pathLength dashes into a dotted line.
 * Without `progress` it plays the CSS draw animation (.lp-blade); with it, scroll scrubs the cut.
 */
export function Blade({ y1, y2, progress, className }: { y1: number; y2: number; progress?: MotionValue<number> | number; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => setBox({ w: parent.offsetWidth, h: parent.offsetHeight }));
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);
  const { w, h } = box;
  const line = { x1: -0.03 * w, y1: y1 * h, x2: 1.03 * w, y2: y2 * h };
  return (
    <svg ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 h-full w-full overflow-visible", className)} viewBox={w ? `0 0 ${w} ${h}` : "0 0 1 1"}>
      {w ? (
        progress === undefined ? (
          <line {...line} pathLength={1} className="lp-blade" />
        ) : (
          <motion.line {...line} className="lp-blade-scrub" style={{ pathLength: progress }} />
        )
      ) : null}
    </svg>
  );
}

/** Button label that rolls up to a copy of itself on hover. */
export function Roll({ children }: { children: string }) {
  return (
    <span className="lp-roll">
      <span>{children}</span>
      <span aria-hidden>{children}</span>
    </span>
  );
}

/** Rolling-digit counter: each digit is a column of 0–9 that spins to its value once visible. */
export function Odometer({ value, className, stagger = 0.08 }: { value: string; className?: string; stagger?: number }) {
  const [ref, seen] = useSeen<HTMLSpanElement>();
  let digitIndex = 0;
  return (
    <span ref={ref} className={cn("lp-odo tnum", className)}>
      <span className="sr-only">{value}</span>
      {value.split("").map((ch, i) => {
        if (!/\d/.test(ch)) {
          return (
            <span key={i} aria-hidden>
              {ch}
            </span>
          );
        }
        const d = Number(ch);
        const delay = digitIndex++ * stagger;
        return (
          <span key={i} className="lp-odo-d" aria-hidden>
            <span className="lp-odo-col" style={{ transform: `translateY(${seen ? -d : 0}em)`, transitionDelay: `${delay}s` }}>
              {Array.from({ length: 10 }, (_, n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Tiny Cypher highlighter: keywords, labels, relationship types, parameters, comments. */
export function Cypher({ code, className }: { code: string; className?: string }) {
  return (
    <pre className={cn("lp-code", className)}>
      <code>
        {code.split("\n").map((line, i) => (
          <span key={i} className="lp-code-line">
            {highlight(line)}
            {"\n"}
          </span>
        ))}
      </code>
    </pre>
  );
}

function highlight(line: string): ReactNode[] {
  const comment = line.indexOf("--");
  const body = comment >= 0 ? line.slice(0, comment) : line;
  const out: ReactNode[] = [];
  const token = /(\$[a-z_0-9]+)|(:[A-Z][A-Za-z_]*(?:\*\d+\.\.\d+)?)|('[^']*')|\b(MATCH|WHERE|RETURN|DISTINCT|UNWIND|AS|IN|SET|MERGE|ON CREATE SET|DELETE|AND|GRAPH\.COPY)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = token.exec(body))) {
    if (m.index > last) out.push(body.slice(last, m.index));
    const cls = m[1] ? "lp-tk-param" : m[2] ? "lp-tk-label" : m[3] ? "lp-tk-string" : "lp-tk-kw";
    out.push(
      <span key={k++} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  if (comment >= 0)
    out.push(
      <span key="c" className="lp-tk-comment">
        {line.slice(comment)}
      </span>,
    );
  return out;
}
