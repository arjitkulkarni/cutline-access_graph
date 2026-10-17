"use client";

import { useId, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Ban, Check, ChevronDown, CircleCheck, MessageSquareText, X } from "lucide-react";
import { contractsEqual, contractSources } from "@/lib/contract";
import { cn, plural } from "@/lib/format";
import type { Labeler } from "@/lib/labels";
import { errorMessage, useContract, useParseContract } from "@/lib/queries";
import type { ConstraintPair, Contract, ContractParseResponse } from "@/lib/types";
import { useOperatorContract } from "@/state/operator-contract";
import { ProvenanceChip } from "@/components/common/Meta";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorState, LoadingRows } from "@/components/ui/States";

function PairRows({ pairs, label, tone }: { pairs: ConstraintPair[]; label: Labeler; tone: "deny" | "allow" }) {
  if (!pairs.length) return <p className="text-xs text-fg-3">None</p>;
  return (
    <ul className="flex flex-col gap-1">
      {pairs.map((p) => (
        <li key={`${p.principal}:${p.capability}:${p.source}`} className="flex min-w-0 flex-wrap items-center gap-2 text-[13px]">
          {tone === "deny" ? (
            <Ban size={12} strokeWidth={2} className="shrink-0 text-amber" aria-label="must deny" />
          ) : (
            <Check size={12} strokeWidth={2.25} className="shrink-0 text-sage" aria-label="must allow" />
          )}
          <span className="truncate text-fg">{label.node(p.principal)}</span>
          <span className="mono shrink-0 text-[12px] text-fg-2">{p.capability}</span>
          <ProvenanceChip source={p.source} label={label} className="ml-auto shrink-0" />
        </li>
      ))}
    </ul>
  );
}

function ContractColumns({ contract, label }: { contract: Contract; label: Labeler }) {
  return (
    <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
      <div className="min-w-0">
        <p className="label-micro mb-2">
          Must deny <span className="tnum normal-case tracking-normal text-fg-3">· {contract.must_deny.length}</span>
        </p>
        <PairRows pairs={contract.must_deny} label={label} tone="deny" />
      </div>
      <div className="min-w-0">
        <p className="label-micro mb-2">
          Must allow <span className="tnum normal-case tracking-normal text-fg-3">· {contract.must_allow.length}</span>
        </p>
        <PairRows pairs={contract.must_allow} label={label} tone="allow" />
      </div>
    </div>
  );
}

/**
 * The security + business contract a plan must satisfy. Derived from Guardrail / Workflow nodes
 * by default; an operator can refine it in plain language, review the parse, and confirm it.
 */
export function ContractPanel({ label, defaultOpen = false }: { label: Labeler; defaultOpen?: boolean }) {
  const derived = useContract();
  const operator = useOperatorContract();
  const parse = useParseContract();
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<ContractParseResponse | null>(null);
  const bodyId = useId();
  const inputId = useId();

  const active = operator.contract ?? derived.data ?? null;
  const sources = active ? contractSources(active) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (value.length < 3) return;
    parse.mutate(value, { onSuccess: (res) => setDraft(res) });
  };

  const confirmDraft = () => {
    if (!draft) return;
    operator.confirm(draft.contract, text.trim());
    setDraft(null);
  };

  return (
    <section className="panel" aria-labelledby={`${bodyId}-title`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span id={`${bodyId}-title`} className="text-sm font-semibold text-fg">
          Contract
        </span>
        {operator.contract ? <Badge tone="accent">Operator · confirmed</Badge> : <Badge tone="muted">Derived from graph</Badge>}
        {active && sources ? (
          <span className="truncate text-xs text-fg-2">
            {plural(active.must_deny.length, "must-deny pair")} · {plural(active.must_allow.length, "must-allow pair")}
            <span className="text-fg-3">
              {" "}
              — from{" "}
              {[
                sources.guardrails.size ? plural(sources.guardrails.size, "guardrail") : null,
                sources.workflows.size ? plural(sources.workflows.size, "workflow") : null,
                sources.operator ? `${sources.operator} operator rules` : null,
              ]
                .filter(Boolean)
                .join(", ")}
            </span>
          </span>
        ) : derived.isPending ? (
          <span className="text-xs text-fg-3">Loading…</span>
        ) : null}
        <ChevronDown size={14} className={cn("ml-auto shrink-0 text-fg-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

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
            <div className="flex flex-col gap-4 border-t border-line px-4 pb-4 pt-3.5">
              {derived.isError && !operator.contract ? (
                <ErrorState compact title="Could not derive the contract" error={derived.error} onRetry={() => derived.refetch()} />
              ) : active ? (
                <ContractColumns contract={active} label={label} />
              ) : (
                <LoadingRows rows={3} />
              )}

              {operator.contract ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-fg/25 bg-fg/[0.05] px-3 py-2 text-xs text-fg-2">
                  <CircleCheck size={13} className="text-fg" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    New plans use your confirmed contract: “{operator.sourceText}”. Declared workflows are still enforced by the
                    planner.
                  </span>
                  <Button size="xs" variant="ghost" onClick={operator.clear}>
                    Use derived contract
                  </Button>
                </div>
              ) : null}

              <form onSubmit={submit} className="flex flex-col gap-2">
                <label htmlFor={inputId} className="label-micro">
                  Refine with a requirement
                </label>
                <div className="flex gap-2">
                  <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-inset px-2.5 focus-within:border-line-strong">
                    <MessageSquareText size={14} className="shrink-0 text-fg-3" aria-hidden />
                    <input
                      id={inputId}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      maxLength={2000}
                      placeholder="e.g. Support agents must not export customer data, but keep order lookup and reporting"
                      className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none"
                    />
                  </div>
                  <Button type="submit" size="md" loading={parse.isPending} disabled={text.trim().length < 3}>
                    Parse
                  </Button>
                </div>
                {parse.isError ? <p className="text-xs text-red">{errorMessage(parse.error)}</p> : null}
              </form>

              {draft ? (
                <div className="rounded-lg border border-line-strong bg-raised/50">
                  <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
                    <p className="text-[13px] font-medium text-fg">Parsed contract — review before confirming</p>
                    <Badge tone="muted">{draft.parser === "llm" ? "LLM parser" : "Rule parser"}</Badge>
                    {derived.data && contractsEqual(draft.contract, derived.data) ? (
                      <span className="text-xs text-fg-3">Same as the derived contract</span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-3 px-3.5 py-3">
                    <ContractColumns contract={draft.contract} label={label} />
                    {draft.unresolved.length ? (
                      <div>
                        <p className="label-micro mb-1.5 text-amber">Unresolved phrases</p>
                        <ul className="flex flex-wrap gap-1.5">
                          {draft.unresolved.map((u) => (
                            <li key={u} className="rounded-sm border border-amber/30 bg-amber/[0.07] px-1.5 py-0.5 text-xs text-amber">
                              “{u}”
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {draft.notes.length ? (
                      <ul className="flex flex-col gap-0.5 text-xs text-fg-3">
                        {draft.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="flex justify-end gap-2 border-t border-line px-3.5 py-2.5">
                    <Button size="sm" variant="ghost" icon={X} onClick={() => setDraft(null)}>
                      Discard
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={Check}
                      onClick={confirmDraft}
                      disabled={!draft.contract.must_deny.length}
                      title={draft.contract.must_deny.length ? undefined : "A contract needs at least one must-deny pair"}
                    >
                      Confirm contract
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
