"use client";

import type { ReactNode } from "react";
import { GitCommitHorizontal, ShieldAlert, TriangleAlert, UserCheck, Workflow } from "lucide-react";
import { parseSource } from "@/lib/contract";
import type { Labeler } from "@/lib/labels";
import { cn, formatTime, formatTimeFull, relativeTime, revisionLabel, shortHash } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { PolicyRevision } from "@/lib/types";

export function RevisionTag({
  revision,
  tone = "neutral",
  showHash = false,
  className,
}: {
  revision: PolicyRevision | number | null | undefined;
  tone?: "neutral" | "amber";
  showHash?: boolean;
  className?: string;
}) {
  const rev = typeof revision === "object" && revision ? revision : null;
  return (
    <span
      title={rev ? `Policy revision ${rev.revision} · ${rev.hash}` : undefined}
      className={cn(
        "mono inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-[11.5px]",
        tone === "amber" ? "border-amber/35 bg-amber/10 text-amber" : "border-line-strong bg-raised text-fg",
        className,
      )}
    >
      <GitCommitHorizontal size={11} strokeWidth={2} aria-hidden className="opacity-70" />
      {revisionLabel(revision ?? null)}
      {showHash && rev ? <span className="text-fg-3">· {shortHash(rev.hash)}</span> : null}
    </span>
  );
}

export function Timestamp({ iso, mode = "relative", className }: { iso: string | null | undefined; mode?: "relative" | "absolute"; className?: string }) {
  const now = useNow(30_000);
  if (!iso) return <span className={className}>—</span>;
  return (
    <time dateTime={iso} title={formatTimeFull(iso)} className={cn("tnum", className)}>
      {mode === "relative" ? relativeTime(iso, now) : formatTime(iso)}
    </time>
  );
}

export function ProvenanceChip({ source, label, className }: { source: string; label: Labeler; className?: string }) {
  const p = parseSource(source);
  const base =
    "inline-flex h-5 min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border px-1.5 text-2xs font-medium";
  if (p.kind === "guardrail") {
    return (
      <span className={cn(base, "border-amber/25 bg-amber/[0.07] text-amber/90", className)} title={p.id ? `${p.id}: ${label.guardrail(p.id)}` : source}>
        <ShieldAlert size={11} strokeWidth={2} className="shrink-0" aria-hidden />
        <span className="shrink-0">Guardrail</span>
        {p.id ? <span className="mono min-w-0 truncate text-[10.5px] opacity-80">{p.id}</span> : null}
      </span>
    );
  }
  if (p.kind === "workflow") {
    return (
      <span className={cn(base, "border-sage/25 bg-sage/[0.07] text-sage", className)} title={p.id ?? source}>
        <Workflow size={11} strokeWidth={2} className="shrink-0" aria-hidden />
        <span className="truncate">{p.id ? label.workflow(p.id) : "Workflow"}</span>
      </span>
    );
  }
  if (p.kind === "operator") {
    return (
      <span className={cn(base, "border-fg/25 bg-fg/[0.06] text-fg", className)} title="Confirmed by an operator">
        <UserCheck size={11} strokeWidth={2} aria-hidden />
        Operator
      </span>
    );
  }
  return (
    <span className={cn(base, "border-line bg-raised text-fg-2", className)} title={source}>
      <span className="truncate">{source || "unspecified"}</span>
    </span>
  );
}

export function StaleBanner({
  title,
  children,
  action,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-lg border border-amber/30 bg-amber/[0.07] px-4 py-3",
        className,
      )}
    >
      <TriangleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-amber" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        {children ? <div className="mt-0.5 text-xs text-fg-2">{children}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function KeyValue({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="label-micro">{label}</dt>
      <dd className="min-w-0 text-sm text-fg">{children}</dd>
    </div>
  );
}
