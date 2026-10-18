"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Copy, Fingerprint, History, Lock, Network, Waypoints, Workflow, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/format";
import { FALKOR_WORK } from "./data";
import { Chapter, Cypher, EASE_OUT, Rise, Words } from "./primitives";

const ICONS: LucideIcon[] = [Waypoints, Workflow, Copy, Fingerprint, Lock, History, Network];

const SNIPPETS = [
  {
    id: "trace",
    label: "Trace",
    code: `-- every bounded route from one person to one capability
MATCH p = (u:User {id: $principal})
      -[:ASSIGNED_TO]->(:Role)
      -[:INHERITS*0..6]->(:Role)
      -[:GRANTS]->(c:Capability {id: $capability})
RETURN DISTINCT [n IN nodes(p) | n.id] AS node_ids`,
    note: "One query returns every witness path the UI draws. A direct grant is the zero-hop case.",
  },
  {
    id: "isolate",
    label: "Isolate",
    code: `GRAPH.COPY cutline_dev cutline_dev__cand__<repair>__c10
-- apply the candidate's edits to the copy, then ask FalkorDB:
--   is every must-deny pair unreachable?
--   is every must-allow pair still reachable?
--   did anyone gain a pair they did not have?
-- the copy is deleted after evaluation`,
    note: "If GRAPH.COPY is unavailable the planner rebuilds the copy from a snapshot, and the UI says which method ran.",
  },
  {
    id: "matrix",
    label: "Access matrix",
    code: `-- who can do what, for everyone
MATCH (u:User)-[:ASSIGNED_TO]->(:Role)
      -[:INHERITS*0..6]->(:Role)
      -[:GRANTS]->(c:Capability)
RETURN DISTINCT u.id AS principal, c.id AS capability`,
    note: "Diffed before and after each candidate: that is how “no new privilege” and “no collateral loss” are checked.",
  },
  {
    id: "apply",
    label: "Atomic apply",
    code: `-- preconditions first, writes after (abridged)
MATCH (pol:Policy {id: 'active'})
WHERE pol.revision = $expected_revision   -- compare-and-set
MATCH (maya:User {id: $maya_id})-[x:ASSIGNED_TO]->(:Role {id: $support_id})
SET pol.revision = pol.revision + 1
MERGE (safe:Role {id: $safe_id}) ON CREATE SET safe.origin = 'cutline'
MERGE (maya)-[:ASSIGNED_TO]->(safe)
DELETE x
RETURN pol.revision AS revision`,
    note: "If the revision moved or an expected edge is gone, zero rows match and nothing is written. A single FalkorDB query is atomic.",
  },
] as const;

function CodeTabs() {
  const [tab, setTab] = useState<(typeof SNIPPETS)[number]["id"]>("trace");
  const base = useId();
  const current = SNIPPETS.find((s) => s.id === tab)!;
  return (
    <div className="lp-panel flex flex-col overflow-hidden">
      <div role="tablist" aria-label="Core Cypher" className="lp-tablist flex overflow-x-auto border-b border-[var(--lp-line-2)]">
        {SNIPPETS.map((s) => (
          <button
            key={s.id}
            id={`${base}-${s.id}`}
            role="tab"
            type="button"
            aria-selected={tab === s.id}
            aria-controls={`${base}-panel`}
            onClick={() => setTab(s.id)}
            className="lp-tab"
          >
            {s.label}
          </button>
        ))}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-${tab}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ clipPath: "inset(0 100% 0 0)" }}
            animate={{ clipPath: "inset(0 0% 0 0)" }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: EASE_OUT }}
          >
            <Cypher code={current.code} />
            <p className="border-t border-[var(--lp-line)] px-5 py-4 text-[13.5px] leading-[21px] text-[var(--lp-bone-2)]">{current.note}</p>
          </motion.div>
        </AnimatePresence>
      </div>
      <p className="border-t border-[var(--lp-line)] px-5 py-2.5 font-mono text-[11px] text-[var(--lp-bone-3)]">backend/app/db/queries.py · values are always parameters</p>
    </div>
  );
}

export function FalkorSection() {
  const [connected, setConnected] = useState(true);
  const [touched, setTouched] = useState(false);

  return (
    <section id="falkordb" className="lp-section">
      <div className="lp-container">
        <Chapter index="06" name="Why FalkorDB" />
        <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:items-end">
          <Words as="h2" className="lp-h2 block" text="Not the visualisation layer. *The state space.*" />
          <Rise delay={0.15}>
            <p className="lp-lead">
              Every access path, business dependency, candidate repair and counterexample lives in the graph. Pull the plug and CUTLINE cannot
              plan, prove, or even let the demo app serve a request.
            </p>
          </Rise>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className={cn("lp-power")} data-off={!connected} data-touched={touched}>
            <Rise>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="lp-mono-label">What FalkorDB does in CUTLINE</p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={connected}
                  onClick={() => {
                    setTouched(true);
                    setConnected((v) => !v);
                  }}
                  className="lp-plug"
                  data-on={connected}
                >
                  <span className="lp-plug-track" aria-hidden>
                    <span className="lp-plug-thumb" />
                  </span>
                  {connected ? "Connected · pull the plug" : "Unplugged · reconnect"}
                </button>
              </div>
            </Rise>

            <ul className="grid gap-2 sm:grid-cols-2">
              {FALKOR_WORK.map((w, i) => {
                const Icon = ICONS[i];
                return (
                  <li key={w.work} className={cn(i === FALKOR_WORK.length - 1 && "sm:col-span-2")}>
                    <Rise delay={i * 0.05} className="h-full">
                      <div className="lp-work lp-panel--cut" style={{ animationDelay: `${i * 0.06}s` }}>
                        <div className="flex items-start justify-between gap-3">
                          <Icon size={17} strokeWidth={1.6} className="text-[var(--lp-red)]" aria-hidden />
                          <span className={cn("font-mono text-[11px] transition-opacity duration-300", connected ? "opacity-0" : "text-[var(--lp-red-hi)] opacity-100")} style={{ transitionDelay: connected ? "0s" : `${0.5 + i * 0.05}s` }}>
                            503
                          </span>
                        </div>
                        <p className="mt-4 text-[15px] leading-[22px] text-[var(--lp-bone)]">{w.work}</p>
                        <p className="mt-1.5 font-mono text-[11.5px] leading-[18px] text-[var(--lp-bone-3)]">{w.how}</p>
                      </div>
                    </Rise>
                  </li>
                );
              })}
            </ul>

            <AnimatePresence initial={false}>
              {!connected ? (
                <motion.div
                  key="down"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.5 }}
                  className="overflow-hidden"
                  aria-live="polite"
                >
                  <div className="mt-3 border border-[rgb(227_24_47/0.55)] bg-[rgb(138_11_22/0.12)] p-4 font-mono text-[12px] leading-[22px]">
                    <p>
                      <span className="text-[var(--lp-bone-3)]">GET  /api/risks             →</span> <span className="text-[var(--lp-red-hi)]">503 FALKORDB_UNAVAILABLE</span>
                    </p>
                    <p>
                      <span className="text-[var(--lp-bone-3)]">POST /api/repairs/plan      →</span> <span className="text-[var(--lp-red-hi)]">503 FALKORDB_UNAVAILABLE</span>
                    </p>
                    <p>
                      <span className="text-[var(--lp-bone-3)]">POST /demo/customers/export →</span> <span className="text-[var(--lp-bone)]">403 · fails closed</span>
                    </p>
                    <p className="mt-2 font-sans text-[13px] leading-5 text-[var(--lp-bone-2)]">
                      This is what <span className="font-mono text-[12px] text-[var(--lp-bone)]">tests/test_falkordb_unavailable.py</span> asserts against a
                      dead port. There is no fallback store.
                    </p>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <Rise delay={0.1} className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <CodeTabs />
          </Rise>
        </div>
      </div>
    </section>
  );
}
