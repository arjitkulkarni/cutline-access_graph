import { Bot, ChevronRight, Database, KeyRound, Shield, User, type LucideIcon } from "lucide-react";
import { Fragment, createElement } from "react";
import type { Labeler } from "@/lib/labels";
import { isServicePrincipal } from "@/lib/labels";
import { cn } from "@/lib/format";
import type { GraphNode, NodeKind } from "@/lib/types";

export function entityIcon(kind: NodeKind | undefined, node?: GraphNode): LucideIcon {
  switch (kind) {
    case "user":
      return isServicePrincipal(node) ? Bot : User;
    case "role":
      return Shield;
    case "capability":
      return KeyRound;
    case "resource":
      return Database;
    default:
      return Shield;
  }
}

export const KIND_NAME: Record<NodeKind, string> = {
  user: "Principal",
  role: "Role",
  capability: "Capability",
  resource: "Resource",
};

/** Inline entity reference: icon + display name (+ optional id). */
export function EntityName({
  id,
  label,
  showId = false,
  className,
  iconClassName,
}: {
  id: string;
  label: Labeler;
  showId?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  const node = label.nodeOf(id);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {createElement(entityIcon(node?.kind, node), { size: 13, strokeWidth: 1.75, className: cn("shrink-0 text-fg-3", iconClassName), "aria-hidden": true })}
      <span className="truncate text-fg">{label.node(id)}</span>
      {showId && node?.label !== id ? <span className="mono truncate text-fg-3">{id}</span> : null}
    </span>
  );
}

const toneText: Record<string, string> = {
  unwanted: "text-red",
  required: "text-sage",
  permitted: "text-permitted",
  neutral: "text-fg-3",
};

/** "Maya Chen › Support › Shared Ops › Export customers" */
export function PathChain({
  nodes,
  label,
  tone = "neutral",
  className,
  emphasizeLast = true,
}: {
  nodes: string[];
  label: Labeler;
  tone?: "unwanted" | "required" | "permitted" | "neutral";
  className?: string;
  emphasizeLast?: boolean;
}) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm leading-5", className)}>
      {nodes.map((id, i) => (
        <Fragment key={`${id}-${i}`}>
          {i > 0 ? (
            <ChevronRight size={12} strokeWidth={2} className={cn("shrink-0", toneText[tone])} aria-label="to" />
          ) : null}
          <span
            className={cn(
              "whitespace-nowrap",
              i === nodes.length - 1 && emphasizeLast ? "font-medium text-fg" : "text-fg-2",
              label.kindOf(id) === "capability" && "mono text-[12px]",
            )}
          >
            {label.kindOf(id) === "capability" ? id : label.node(id)}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
