"use client";

import { useId } from "react";
import { ChevronsUpDown } from "lucide-react";
import { formatTime, revisionLabel } from "@/lib/format";
import { isEffectivelyStale, statusPresentation } from "@/lib/repair";
import type { RepairPlan } from "@/lib/types";

/** Native select (fully keyboard accessible) over the repair ledger, newest first. */
export function PlanPicker({
  plans,
  value,
  onChange,
  label = "Repair plan",
}: {
  plans: RepairPlan[];
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
}) {
  const id = useId();
  if (!plans.length) return null;
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <label htmlFor={id} className="shrink-0 text-xs text-fg-3">
        {label}
      </label>
      <div className="relative min-w-0 max-w-full flex-1">
        <select
          id={id}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="mono h-8 w-full min-w-0 max-w-[440px] appearance-none truncate rounded-md border border-line bg-raised pl-2.5 pr-8 text-[12px] text-fg outline-none transition-colors hover:border-line-strong focus-visible:border-accent sm:min-w-[300px]"
        >
          {plans.map((p) => {
            const s = statusPresentation(p.status, isEffectivelyStale(p));
            return (
              <option key={p.id} value={p.id}>
                {p.id} · {s.label} · {revisionLabel(p.base_revision)} · {formatTime(p.created_at)}
              </option>
            );
          })}
        </select>
        <ChevronsUpDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
      </div>
    </div>
  );
}
