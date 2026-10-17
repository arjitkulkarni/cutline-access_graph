"use client";

import { cn, formatTime, revisionLabel } from "@/lib/format";
import { isEffectivelyStale, statusPresentation } from "@/lib/repair";
import type { RepairPlan } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";

/** Repair plans from the evidence ledger (GET /api/repairs), newest first. */
export function RepairLedgerList({
  plans,
  selectedId,
  onSelect,
  title = "Ledger",
}: {
  plans: RepairPlan[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  title?: string;
}) {
  return (
    <nav aria-label="Repair plans" className="panel overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <span className="tnum text-xs text-fg-3">{plans.length}</span>
      </header>
      <ul className="max-h-[calc(100dvh-220px)] overflow-y-auto py-1">
        {plans.map((p) => {
          const stale = isEffectivelyStale(p);
          const s = statusPresentation(p.status, stale);
          const active = p.id === selectedId;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "relative flex w-full flex-col gap-1 px-4 py-2.5 text-left transition-colors",
                  active ? "bg-raised" : "hover:bg-raised/50",
                )}
              >
                {active ? <span className="absolute left-0 top-2.5 h-[calc(100%-20px)] w-[2px] rounded-r bg-accent" aria-hidden /> : null}
                <span className="flex items-center gap-2">
                  <span className="mono text-[12.5px] text-fg">{p.id}</span>
                  <Badge tone={s.tone} className="ml-auto">
                    {s.label}
                  </Badge>
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-fg-3">
                  <span className="mono">{revisionLabel(p.base_revision)}</span>
                  {stale ? <span className="text-amber">→ {revisionLabel(p.current_revision)}</span> : null}
                  <span aria-hidden>·</span>
                  <span>{formatTime(p.created_at)}</span>
                  <span aria-hidden>·</span>
                  <span>{p.edits.length} edits</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
