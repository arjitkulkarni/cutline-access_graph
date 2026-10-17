"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, CircleCheck, CircleX } from "lucide-react";
import { cn, formatMs, plural } from "@/lib/format";
import type { Labeler } from "@/lib/labels";
import { editText, FAMILY_LABEL, OUTCOME_PRESENTATION, violationSentence } from "@/lib/repair";
import type { Candidate, RepairPlan, Violation } from "@/lib/types";
import { PathChain } from "@/components/common/Entity";
import { Badge } from "@/components/ui/Badge";

function ViolationDetail({ v, label }: { v: Violation; label: Labeler }) {
  return (
    <li className="flex gap-2.5">
      <CircleX size={14} strokeWidth={1.75} className="mt-[3px] shrink-0 text-red" aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] text-fg">{violationSentence(v, label)}</p>
        {v.path ? (
          <p className="mt-0.5 text-xs text-fg-3">
            Witness: <PathChain nodes={v.path.nodes} label={label} tone="unwanted" className="text-xs" />
          </p>
        ) : null}
        {v.broken_by.length ? (
          <p className="mt-0.5 text-xs text-fg-3">
            Broken by <span className="mono text-fg-2">{v.broken_by.join("; ")}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

function CandidateRow({
  candidate,
  rank,
  chosen,
  label,
  expanded,
  onToggle,
  constraintCount,
}: {
  candidate: Candidate;
  rank: number;
  chosen: boolean;
  label: Labeler;
  expanded: boolean;
  onToggle: () => void;
  constraintCount: number;
}) {
  const outcome = OUTCOME_PRESENTATION[candidate.outcome];
  const first = candidate.violations[0];
  const pass = candidate.outcome === "PASS";
  const panelId = `cand-${candidate.id}`;
  return (
    <li className={cn("border-b border-line last:border-b-0", chosen && "bg-sage/[0.035]")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full flex-wrap items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-raised/50"
      >
        <span className="tnum mono mt-0.5 w-5 shrink-0 text-[11px] text-fg-3">{candidate.id}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("text-[13px] font-medium", pass ? "text-fg" : "text-fg")}>{candidate.title}</span>
            {chosen ? (
              <Badge tone="sage" icon={CircleCheck}>
                Chosen
              </Badge>
            ) : null}
          </span>
          <span className="mt-1 flex items-start gap-1.5 text-xs">
            {pass ? (
              <span className="text-sage/90">
                All {plural(constraintCount, "constraint")} hold, no new access.
              </span>
            ) : first ? (
              <span className="text-fg-2">
                <span className="text-red/90">✕</span> {violationSentence(first, label)}
                {first.path ? (
                  <span className="text-fg-3"> via {first.path.nodes.slice(1, -1).map((id) => label.node(id)).join(" › ")}</span>
                ) : null}
                {candidate.violations.length > 1 ? (
                  <span className="text-fg-3"> · +{candidate.violations.length - 1} more</span>
                ) : null}
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 max-sm:order-last max-sm:w-full max-sm:items-start max-sm:pl-8">
          <Badge tone={outcome.tone}>{outcome.label}</Badge>
          <span className="tnum text-[11px] text-fg-3">
            {FAMILY_LABEL[candidate.family]} · cost {candidate.cost.total}
          </span>
        </span>
        <ChevronRight
          size={14}
          className={cn("mt-0.5 shrink-0 text-fg-3 transition-transform duration-150", expanded && "rotate-90")}
          aria-hidden
        />
        <span className="sr-only">Rank {rank}</span>
      </button>
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
            className="overflow-hidden"
          >
            <div className="grid gap-4 px-4 pb-4 pl-12 pt-1 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <div>
                <p className="label-micro mb-1.5">{pass ? "Edits" : "Counterexamples"}</p>
                {pass ? (
                  <ol className="flex list-decimal flex-col gap-0.5 pl-4 text-xs text-fg-2 marker:text-fg-3">
                    {candidate.edits.map((e, i) => (
                      <li key={i}>{editText(e, label)}</li>
                    ))}
                  </ol>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {candidate.violations.map((v, i) => (
                      <ViolationDetail key={i} v={v} label={label} />
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <p className="label-micro mb-1.5">Cost {candidate.cost.total}</p>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
                    <dt className="text-fg-3">Edits ({candidate.edits.length})</dt>
                    <dd className="tnum text-right text-fg-2">{candidate.cost.edits}</dd>
                    <dt className="text-fg-3">Shared-role penalty</dt>
                    <dd className="tnum text-right text-fg-2">{candidate.cost.shared_role_penalty}</dd>
                    <dt className="text-fg-3">Collateral penalty</dt>
                    <dd className="tnum text-right text-fg-2">{candidate.cost.collateral_penalty}</dd>
                  </dl>
                  {candidate.cost.notes.length ? (
                    <ul className="mt-1.5 flex flex-col gap-0.5 text-[11px] leading-4 text-fg-3">
                      {candidate.cost.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <p className="text-[11px] leading-4 text-fg-3">
                  Evaluated on <span className="mono text-fg-2">{candidate.candidate_graph}</span> ({candidate.isolation}) in{" "}
                  {formatMs(candidate.eval_ms)}.
                </p>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}

/** Ranked candidates — rejected ones keep their counterexample so the operator sees *why*. */
export function CandidateList({ plan, label }: { plan: RepairPlan; label: Labeler }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const passing = plan.candidates.filter((c) => c.outcome === "PASS").length;
  const constraintCount = plan.contract.must_deny.length + plan.contract.must_allow.length;
  return (
    <section className="panel overflow-hidden" aria-labelledby="candidates-title">
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="candidates-title" className="text-sm font-semibold text-fg">
            Why not a simpler fix?
          </h2>
          <p className="mt-0.5 text-xs text-fg-2">
            {plural(plan.budget.evaluated, "candidate")} tested on isolated graph copies · {passing} passed
            {plan.budget.generated > plan.budget.evaluated ? ` · ${plan.budget.generated} generated` : ""}
          </p>
        </div>
        <span className="tnum mono shrink-0 text-[11px] text-fg-3" title="Planner budget reported by the API">
          depth ≤ {plan.budget.max_depth} · cut ≤ {plan.budget.max_cut_size}
        </span>
      </header>
      {plan.candidates.length ? (
        <ol>
          {plan.candidates.map((c, i) => (
            <CandidateRow
              key={c.id}
              candidate={c}
              rank={i + 1}
              chosen={c.id === plan.chosen_candidate_id}
              label={label}
              expanded={expanded === c.id}
              onToggle={() => setExpanded((cur) => (cur === c.id ? null : c.id))}
              constraintCount={constraintCount}
            />
          ))}
        </ol>
      ) : (
        <p className="px-4 py-6 text-sm text-fg-2">
          {plan.status === "NO_VIOLATIONS"
            ? "No candidate was needed: the contract already holds."
            : "The planner produced no candidates."}
        </p>
      )}
    </section>
  );
}
