"use client";

import { Minus, Plus, SquarePlus } from "lucide-react";
import { cn } from "@/lib/format";
import type { Labeler } from "@/lib/labels";
import { describeEdit, editSign, editTargets, OP_LABEL } from "@/lib/repair";
import type { Edit } from "@/lib/types";

const signStyles = {
  add: { icon: Plus, cls: "border-fg/30 text-fg bg-fg/[0.06]" },
  create: { icon: SquarePlus, cls: "border-fg/30 text-fg bg-fg/[0.06]" },
  remove: { icon: Minus, cls: "border-red/35 text-red bg-red/[0.08]" },
} as const;

export interface EditFocus {
  edgeIds: string[];
  nodeIds: string[];
}

/**
 * The chosen candidate's edits, each with the planner's reason. Hovering or focusing an edit
 * highlights the relations it touches in the comparison canvas.
 */
export function MigrationEditList({
  edits,
  label,
  onFocusEdit,
  focusedIndex,
}: {
  edits: Edit[];
  label: Labeler;
  onFocusEdit?: (focus: EditFocus | null, index: number | null) => void;
  focusedIndex?: number | null;
}) {
  return (
    <ol className="flex flex-col" aria-label="Proposed edits">
      {edits.map((edit, i) => {
        const sign = editSign(edit.op);
        const { icon: Icon, cls } = signStyles[sign];
        const parts = describeEdit(edit, label);
        const active = focusedIndex === i;
        return (
          <li key={`${edit.op}-${i}`}>
            <div
              tabIndex={0}
              onMouseEnter={() => onFocusEdit?.(editTargets(edit), i)}
              onMouseLeave={() => onFocusEdit?.(null, null)}
              onFocus={() => onFocusEdit?.(editTargets(edit), i)}
              onBlur={() => onFocusEdit?.(null, null)}
              className={cn(
                "group flex gap-2.5 rounded-lg px-2.5 py-2 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent",
                active ? "bg-raised" : "hover:bg-raised/60",
              )}
            >
              <span className="tnum mt-[3px] w-4 shrink-0 text-right text-[11px] text-fg-3">{i + 1}</span>
              <span className={cn("mt-0.5 inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border", cls)}>
                <Icon size={11} strokeWidth={2.25} aria-hidden />
                <span className="sr-only">{sign === "remove" ? "Removal" : sign === "create" ? "New role" : "Addition"}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-5 text-fg-2">
                  {parts.map((p, j) =>
                    p.id ? (
                      <span key={j} className={cn("font-medium text-fg", label.kindOf(p.id) === "capability" && "mono text-[12px]")}>
                        {label.kindOf(p.id) === "capability" ? p.id : p.text}
                      </span>
                    ) : (
                      <span key={j}>{p.text}</span>
                    ),
                  )}
                </p>
                <p className="mt-0.5 text-xs leading-[17px] text-fg-3">{edit.reason}</p>
              </div>
              <span className="mono mt-0.5 hidden shrink-0 text-[10.5px] text-fg-3 2xl:inline">{OP_LABEL[edit.op]}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
