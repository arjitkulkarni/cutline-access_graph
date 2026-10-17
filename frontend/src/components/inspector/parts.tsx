"use client";

import { createElement, useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { panelTransition } from "@/lib/motion";
import { ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/format";
import type { GraphNode } from "@/lib/types";
import { isSensitive, isServicePrincipal } from "@/lib/labels";
import { entityIcon, KIND_NAME } from "@/components/common/Entity";
import { Badge } from "@/components/ui/Badge";

export function InspectorHeader({ node, eyebrow }: { node: GraphNode; eyebrow?: ReactNode }) {
  const sensitive = node.kind === "capability" && isSensitive(node);
  const description = typeof node.props?.description === "string" ? node.props.description : typeof node.props?.title === "string" ? node.props.title : null;
  return (
    <div className="border-b border-line-soft bg-raised/40 px-[18px] py-5">
      {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center border border-accent/25 bg-accent/[0.06] text-accent",
            node.kind === "user" ? "rounded-full" : "rounded-lg",
          )}
        >
          {createElement(entityIcon(node.kind, node), { size: 18, strokeWidth: 1.5, "aria-hidden": true })}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words text-base font-medium tracking-[-0.02em] text-fg">{node.label}</h2>
            {sensitive ? (
              <Badge tone="amber" icon={Lock}>
                {String(node.props.sensitivity)}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-3">
            <span className="mono text-fg-2">{node.id}</span>
            <span aria-hidden>·</span>
            <span>{node.kind === "user" && isServicePrincipal(node) ? "Service identity" : KIND_NAME[node.kind]}</span>
          </p>
          {description ? <p className="mt-1.5 text-xs leading-[18px] text-fg-2">{description}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function InspectorSection({
  title,
  count,
  tone,
  children,
  className,
  aside,
}: {
  title: string;
  count?: ReactNode;
  tone?: "amber" | "sage" | "accent" | "red";
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}) {
  return (
    <section className={cn("inspector-section", className)}>
      <div className="mb-2 flex min-w-0 items-center gap-2">
        {tone ? (
          <span
            className={cn("h-1.5 w-1.5 rounded-full", tone === "red" ? "bg-red" : tone === "amber" ? "bg-amber" : tone === "sage" ? "bg-sage" : "bg-permitted")}
            aria-hidden
          />
        ) : null}
        <h3 className="label-micro whitespace-nowrap">{title}</h3>
        {count !== undefined ? <span className="tnum whitespace-nowrap text-[11px] text-fg-3">{count}</span> : null}
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function PropsTable({ node }: { node: GraphNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const entries = Object.entries(node.props ?? {}).filter(([k]) => k !== "description" && k !== "title");
  if (!entries.length) return null;
  return (
    <div className="border-b border-line-soft px-[18px] py-4 last:border-b-0">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-fg-3 hover:text-fg-2">
        <span className="label-micro">Stored properties</span>
        <span className="tnum text-[11px]">{entries.length}</span>
        <ChevronDown size={13} className={cn("ml-auto transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence initial={false}>{open ? <motion.div id={id} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={panelTransition} className="overflow-hidden">
      <dl className="mt-3 grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
        {entries.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="mono break-all text-fg-3">{k}</dt>
            <dd className="mono min-w-0 break-words text-right text-fg-2">{v === null ? "null" : typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
          </div>
        ))}
      </dl>
      </motion.div> : null}</AnimatePresence>
    </div>
  );
}

export function FactList({ items, empty }: { items: ReactNode[]; empty: string }) {
  if (!items.length) return <p className="text-xs text-fg-3">{empty}</p>;
  return <ul className="flex flex-col gap-1.5">{items.map((item, i) => <li key={i}>{item}</li>)}</ul>;
}
