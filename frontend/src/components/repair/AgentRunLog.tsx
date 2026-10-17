"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useMutationState } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, ChevronDown, TerminalSquare } from "lucide-react";
import { cn, formatMs } from "@/lib/format";
import { agentRunKey, errorCode, errorMessage, useInvestigate } from "@/lib/queries";
import type { AgentRun } from "@/lib/types";
import { useOperatorContract } from "@/state/operator-contract";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";

function compactJson(value: Record<string, unknown>): string {
  const text = JSON.stringify(value);
  return text.length > 96 ? `${text.slice(0, 95)}…` : text;
}

/**
 * Track 01 agent trace: POST /api/agent/investigate. Shown honestly as either an LLM run (with
 * its model) or the deterministic orchestrator. Secondary to the graph — collapsed by default.
 */
export function AgentRunLog() {
  const run = useInvestigate();
  const runs = useMutationState({ filters: { mutationKey: agentRunKey }, select: (m) => m.state });
  const latest = runs[runs.length - 1];
  const operator = useOperatorContract();
  const [open, setOpen] = useState(() => latest !== undefined);
  const bodyId = useId();
  const pending = latest?.status === "pending";
  const failed = latest?.status === "error";
  const data = latest?.status === "success" ? (latest.data as AgentRun) : undefined;
  const missingEndpoint = failed && errorCode(latest.error) === "NOT_FOUND";

  return (
    <section className="panel" aria-labelledby={`${bodyId}-t`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <TerminalSquare size={15} strokeWidth={1.75} className="shrink-0 text-fg-3" aria-hidden />
          <span id={`${bodyId}-t`} className="text-sm font-semibold text-fg">
            Agent run
          </span>
          {data ? (
            <Badge tone={data.mode === "llm" ? "accent" : "muted"}>
              {data.mode === "llm" ? `LLM · ${data.model ?? "model unknown"}` : "Deterministic"}
            </Badge>
          ) : null}
          <span className="truncate text-xs text-fg-3">
            {data ? `${data.steps.length} tool calls · ${formatMs(data.steps.reduce((t, s) => t + s.ms, 0))}` : "Investigate → plan → verify, as an auditable tool trace"}
          </span>
          <ChevronDown size={14} className={cn("ml-auto shrink-0 text-fg-3 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        <Button
          size="sm"
          loading={pending}
          onClick={() => {
            setOpen(true);
            run.mutate(operator.contract ? { contract: operator.contract } : {});
          }}
        >
          {data ? "Run again" : "Run investigation"}
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={bodyId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-line px-4 py-3.5">
              {pending ? (
                <p className="text-xs text-fg-2">Waiting for the agent to finish its tool calls…</p>
              ) : missingEndpoint ? (
                <p className="text-xs text-fg-2">
                  This backend does not expose <span className="mono text-fg">POST /api/agent/investigate</span> yet (HTTP 404).
                  The planner, verifier and evidence ledger above work without it.
                </p>
              ) : failed ? (
                <p className="text-xs text-red">{errorMessage(latest.error)}</p>
              ) : data ? (
                <div className="flex flex-col gap-3">
                  <ol className="flex flex-col overflow-hidden rounded-lg border border-line bg-inset">
                    {data.steps.map((s, i) => (
                      <li
                        key={i}
                        className="grid grid-cols-[22px_minmax(140px,180px)_minmax(0,1fr)_56px] items-baseline gap-x-3 border-b border-line-soft px-3 py-2 last:border-b-0"
                      >
                        <span className="tnum mono text-[11px] text-fg-3">{i + 1}</span>
                        <span className="mono truncate text-[12px] text-fg">{s.tool}</span>
                        <span className="min-w-0">
                          <span className="block text-[12.5px] text-fg-2">{s.summary}</span>
                          <span className="mono block truncate text-[11px] text-fg-3" title={JSON.stringify(s.input)}>
                            {compactJson(s.input)}
                          </span>
                        </span>
                        <span className="tnum mono text-right text-[11px] text-fg-3">{formatMs(s.ms)}</span>
                      </li>
                    ))}
                  </ol>
                  {data.narrative ? <p className="max-w-[90ch] text-[13px] leading-5 text-fg-2">{data.narrative}</p> : null}
                  {data.repair_id ? (
                    <Link
                      href={`/repair?plan=${encodeURIComponent(data.repair_id)}`}
                      className={buttonClasses("secondary", "sm", "self-start")}
                    >
                      Open plan <span className="mono">{data.repair_id}</span>
                      <ArrowUpRight size={13} aria-hidden />
                    </Link>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-fg-2">
                  Runs the investigation as tool calls (revision, risky paths, contract, plan, verification) and records each step
                  with its input and timing. The agent explains; FalkorDB queries and runtime checks decide.
                </p>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
