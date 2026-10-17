"use client";

import type { ReactNode } from "react";
import { CircleCheck, CircleX, Minus, Plus, SquarePlus } from "lucide-react";
import { cn, durationBetween, formatMs, formatTimeFull, plural, revisionLabel } from "@/lib/format";
import type { Labeler } from "@/lib/labels";
import { editSign, editText, OUTCOME_PRESENTATION, statusPresentation, verificationCounts, violationSentence } from "@/lib/repair";
import type { Evidence, Verification } from "@/lib/types";
import { PathChain } from "@/components/common/Entity";
import { ProvenanceChip, RevisionTag, StaleBanner } from "@/components/common/Meta";
import { Badge } from "@/components/ui/Badge";

function Section({ title, meta, children, className }: { title: string; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("border-b border-line px-5 py-4 last:border-b-0", className)}>
      <div className="mb-2.5 flex items-center gap-2">
        <h3 className="label-micro">{title}</h3>
        {meta ? <span className="text-[11px] text-fg-3">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function VerificationSummary({ v, label, stale }: { v: Verification | null; label: string; stale: boolean }) {
  if (!v) {
    return (
      <div className="rounded-lg border border-line px-3.5 py-3">
        <p className="text-[13px] font-medium text-fg">{label}</p>
        <p className="mt-0.5 text-xs text-fg-3">Not recorded.</p>
      </div>
    );
  }
  const c = verificationCounts(v);
  const failed = v.checks.filter((ch) => !ch.passed);
  const duration = durationBetween(v.started_at, v.finished_at);
  return (
    <div className={cn("rounded-lg border px-3.5 py-3", stale ? "border-amber/30" : v.passed ? "border-sage/30" : "border-red/30")}>
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-medium text-fg">{label}</p>
        {stale ? (
          <Badge tone="amber">Stale</Badge>
        ) : v.passed ? (
          <Badge tone="sage" icon={CircleCheck}>
            Passed
          </Badge>
        ) : (
          <Badge tone="red" icon={CircleX}>
            Failed
          </Badge>
        )}
        <span className="tnum ml-auto text-xs text-fg-2">
          {c.passed}/{c.total} checks
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-fg-3">Finished</dt>
        <dd className="text-fg-2">
          {formatTimeFull(v.finished_at)}
          {duration !== null ? ` · ${formatMs(duration)}` : ""}
        </dd>
        <dt className="text-fg-3">Target</dt>
        <dd className="mono text-fg-2">{v.policy_target}</dd>
        <dt className="text-fg-3">Graph</dt>
        <dd className="mono truncate text-fg-2">{v.graph}</dd>
        <dt className="text-fg-3">Bound to</dt>
        <dd>
          <RevisionTag revision={v.revision} tone={stale ? "amber" : "neutral"} showHash />
        </dd>
        <dt className="text-fg-3">Engine</dt>
        <dd className="text-fg-2">{[...new Set(v.checks.map((ch) => ch.engine))].join(", ") || "—"}</dd>
      </dl>
      {failed.length ? (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-red">
          {failed.map((f) => (
            <li key={f.id} className="mono">
              {f.id}: expected {f.expected}, got HTTP {f.status_code} ({f.decision})
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Audit view of GET /api/evidence/{repair_id}. */
export function EvidencePanel({ evidence, label }: { evidence: Evidence; label: Labeler }) {
  const s = statusPresentation(evidence.status, evidence.stale);
  return (
    <article className="evidence-document panel min-w-0 overflow-hidden" aria-label={`Evidence for ${evidence.repair_id}`}>
      <header className="flex flex-wrap items-start gap-x-6 gap-y-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1 max-sm:basis-full">
          <div className="flex items-center gap-2.5">
            <h2 className="mono text-base font-semibold text-fg">{evidence.repair_id}</h2>
            <Badge tone={s.tone} size="md" dot>
              {s.label}
            </Badge>
            {evidence.stale ? null : (
              <Badge tone="muted" size="md">
                Current
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-fg-3">Evidence generated {formatTimeFull(evidence.generated_at)}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <dt className="text-fg-3">Planned against</dt>
          <dd>
            <RevisionTag revision={evidence.base_revision} showHash />
          </dd>
          <dt className="text-fg-3">Active policy now</dt>
          <dd>
            <RevisionTag revision={evidence.current_revision} tone={evidence.stale ? "amber" : "neutral"} showHash />
          </dd>
        </dl>
      </header>

      {evidence.stale ? (
        <div className="border-b border-line px-5 py-3">
          <StaleBanner title={`Evidence is stale — policy moved from ${revisionLabel(evidence.application?.to_revision ?? evidence.base_revision)} to ${revisionLabel(evidence.current_revision)}`}>
            {evidence.stale_reason ?? "The active policy no longer matches the revision this evidence was produced for."} The
            verification results below describe {revisionLabel(evidence.application?.to_revision ?? evidence.base_revision)}, not the
            active policy.
          </StaleBanner>
        </div>
      ) : null}

      <Section title="Verification results" meta={evidence.candidate_verification ? `verified ${formatTimeFull(evidence.candidate_verification.finished_at)}` : undefined}>
        <div className="grid gap-3 md:grid-cols-2">
          <VerificationSummary v={evidence.candidate_verification} label="Candidate verification" stale={evidence.stale} />
          <VerificationSummary v={evidence.post_apply_verification} label="Post-apply verification" stale={evidence.stale && Boolean(evidence.post_apply_verification)} />
        </div>
      </Section>

      <Section title="Proposed edit operations" meta={plural(evidence.edits.length, "edit")}>
        {evidence.edits.length ? (
          <ol className="flex flex-col gap-2">
            {evidence.edits.map((e, i) => {
              const sign = editSign(e.op);
              const Icon = sign === "remove" ? Minus : sign === "create" ? SquarePlus : Plus;
              return (
                <li key={i} className="flex gap-2.5">
                  <span className="tnum mt-0.5 w-4 shrink-0 text-right text-[11px] text-fg-3">{i + 1}</span>
                  <Icon size={13} strokeWidth={2} className={cn("mt-[3px] shrink-0", sign === "remove" ? "text-red" : "text-fg")} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-[13px] text-fg">
                      {editText(e, label)} <span className="mono ml-1 text-[11px] text-fg-3">{e.op}</span>
                    </p>
                    <p className="text-xs text-fg-3">{e.reason}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-xs text-fg-3">No edits were chosen for this plan.</p>
        )}
      </Section>

      <div className="grid border-b border-line md:grid-cols-2">
        <Section title="Permissions removed" meta={String(evidence.permissions_removed.length)} className="border-b-0 md:border-r">
          {evidence.permissions_removed.length ? (
            <ul className="flex flex-col gap-1.5">
              {evidence.permissions_removed.map((p) => (
                <li key={`${p.principal}:${p.capability}`} className="flex items-center gap-2 text-[13px]">
                  <Minus size={12} className="text-amber" aria-hidden />
                  <span className="text-fg">{label.node(p.principal)}</span>
                  <span className="mono text-[12px] text-fg-2">{p.capability}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-3">None.</p>
          )}
        </Section>
        <Section title="Required workflows preserved" meta={`${evidence.workflows_preserved.filter((w) => w.ok).length}/${evidence.workflows_preserved.length}`} className="border-b-0">
          {evidence.workflows_preserved.length ? (
            <ul className="flex flex-col gap-1.5">
              {evidence.workflows_preserved.map((w) => (
                <li key={`${w.workflow}:${w.principal}:${w.capability}`} className="flex items-center gap-2 text-[13px]">
                  {w.ok ? (
                    <CircleCheck size={13} className="shrink-0 text-sage" aria-label="preserved" />
                  ) : (
                    <CircleX size={13} className="shrink-0 text-red" aria-label="broken" />
                  )}
                  <span className="text-fg">{label.node(w.principal)}</span>
                  <span className="mono text-[12px] text-fg-2">{w.capability}</span>
                  <ProvenanceChip source={`workflow:${w.workflow}`} label={label} className="ml-auto" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-fg-3">No workflow constraints recorded.</p>
          )}
        </Section>
      </div>

      <div className="grid border-b border-line md:grid-cols-2">
        <Section title="Approval" className="border-b-0 md:border-r">
          {evidence.approval ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-fg-3">Approved by</dt>
              <dd className="text-fg">{evidence.approval.approved_by}</dd>
              <dt className="text-fg-3">At</dt>
              <dd className="text-fg-2">{formatTimeFull(evidence.approval.approved_at)}</dd>
              {evidence.approval.note ? (
                <>
                  <dt className="text-fg-3">Note</dt>
                  <dd className="text-fg-2">{evidence.approval.note}</dd>
                </>
              ) : null}
              <dt className="text-fg-3">Edits hash</dt>
              <dd className="mono truncate text-fg-2">{evidence.approval.edits_hash}</dd>
            </dl>
          ) : (
            <p className="text-xs text-fg-3">Not approved. Nothing was written to the active policy.</p>
          )}
        </Section>
        <Section title="Application" className="border-b-0">
          {evidence.application ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-fg-3">Applied</dt>
              <dd className="text-fg-2">{formatTimeFull(evidence.application.applied_at)}</dd>
              <dt className="text-fg-3">Revision</dt>
              <dd className="flex items-center gap-1.5">
                <RevisionTag revision={evidence.application.from_revision} /> → <RevisionTag revision={evidence.application.to_revision} />
              </dd>
              <dt className="text-fg-3">Write</dt>
              <dd className="tnum text-fg-2">
                +{evidence.application.write.nodes_created} nodes, +{evidence.application.write.relationships_created} / −
                {evidence.application.write.relationships_deleted} relationships · {evidence.application.write.atomic ? "atomic" : "non-atomic"}
              </dd>
            </dl>
          ) : (
            <p className="text-xs text-fg-3">Not applied.</p>
          )}
        </Section>
      </div>

      <Section title="Rejected alternatives" meta={String(evidence.rejected_candidates.length)}>
        {evidence.rejected_candidates.length ? (
          <ul className="flex flex-col gap-2">
            {evidence.rejected_candidates.map((c) => (
              <li key={c.id} className="flex gap-3">
                <span className="mono mt-0.5 w-6 shrink-0 text-[11px] text-fg-3">{c.id}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[13px] text-fg">
                    {c.title} <Badge tone={OUTCOME_PRESENTATION[c.outcome].tone}>{OUTCOME_PRESENTATION[c.outcome].label}</Badge>
                  </p>
                  {c.first_violation ? (
                    <p className="text-xs text-fg-3">
                      {violationSentence(c.first_violation, label)}
                      {c.first_violation.path ? (
                        <>
                          {" "}
                          · <PathChain nodes={c.first_violation.path.nodes} label={label} tone="unwanted" className="text-xs" />
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-fg-3">No rejected candidates.</p>
        )}
      </Section>

      <Section title="Contract">
        <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          <ul className="flex flex-col gap-1">
            {evidence.contract.must_deny.map((p) => (
              <li key={`d:${p.principal}:${p.capability}`} className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-amber">deny</span>
                <span className="text-fg">{label.node(p.principal)}</span>
                <span className="mono text-fg-2">{p.capability}</span>
                <ProvenanceChip source={p.source} label={label} className="ml-auto" />
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-1">
            {evidence.contract.must_allow.map((p) => (
              <li key={`a:${p.principal}:${p.capability}`} className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-sage">allow</span>
                <span className="text-fg">{label.node(p.principal)}</span>
                <span className="mono text-fg-2">{p.capability}</span>
                <ProvenanceChip source={p.source} label={label} className="ml-auto" />
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section title="Graphs">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-fg-3">Active policy</dt>
          <dd className="mono text-fg-2">{evidence.graphs.active}</dd>
          <dt className="text-fg-3">Candidate</dt>
          <dd className="mono text-fg-2">{evidence.graphs.candidate ?? "—"}</dd>
          <dt className="text-fg-3">Ledger</dt>
          <dd className="mono text-fg-2">{evidence.graphs.ledger}</dd>
        </dl>
      </Section>
    </article>
  );
}
