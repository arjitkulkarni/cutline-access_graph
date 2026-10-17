"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useReactFlow, useViewport } from "@xyflow/react";
import { Maximize, Minus, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/hooks";
import type { GraphLayout } from "@/lib/graph/layout";
import type { GraphNode, NodeKind } from "@/lib/types";
import { entityIcon, KIND_NAME } from "@/components/common/Entity";
import { Kbd } from "@/components/ui/CopyButton";

const KIND_RANK: Record<NodeKind, number> = { user: 0, role: 1, capability: 2, resource: 3 };

/** Centers the viewport on a node without changing the user's zoom unless it is very small. */
export function useFocusNode(layout: GraphLayout) {
  const rf = useReactFlow();
  const reduced = usePrefersReducedMotion();
  return (id: string) => {
    const pos = layout.positions[id];
    if (!pos) return;
    const zoom = Math.max(rf.getZoom(), 0.9);
    void rf.setCenter(pos.x + (layout.nodeWidths[id] ?? 150) / 2, pos.y + layout.nodeHeight / 2, {
      zoom,
      duration: reduced ? 0 : 280,
    });
  };
}

/** Combobox search over principals, roles, capabilities and resources. "/" focuses it. */
export function GraphSearch({
  nodes,
  onPick,
  className,
}: {
  nodes: GraphNode[];
  onPick: (id: string) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .filter((n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)) ||
          KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
          a.label.localeCompare(b.label),
      )
      .slice(0, 8);
  }, [nodes, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const showList = open && query.trim().length > 0;

  return (
    <div className={cn("relative w-[260px] min-w-0", className)}>
      <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-inset px-2.5 transition-colors focus-within:border-accent/70">
        <Search size={14} strokeWidth={1.75} className="shrink-0 text-fg-3" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          aria-label="Search principals, roles and capabilities"
          placeholder="Find a policy entity…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, Math.max(0, results.length - 1)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              pick(results[active].id);
            } else if (e.key === "Escape") {
              setQuery("");
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-3 hover:text-fg"
          >
            <X size={12} aria-hidden />
          </button>
        ) : (
          <Kbd>/</Kbd>
        )}
      </div>
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching graph nodes"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-md border border-line-strong bg-raised py-1 shadow-[var(--shadow-pop)]"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-fg-2">No node matches “{query.trim()}”.</li>
          ) : (
            results.map((n, i) => {
              const Icon = entityIcon(n.kind, n);
              return (
                <li
                  key={n.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(n.id);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[13px]",
                    i === active ? "bg-raised-2 text-fg" : "text-fg-2",
                  )}
                >
                  <Icon size={13} strokeWidth={1.75} className="shrink-0 text-fg-3" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-fg">{n.label}</span>
                  <span className="mono shrink-0 text-[11px] text-fg-3">{n.id}</span>
                  <span className="w-16 shrink-0 text-right text-[11px] text-fg-3">{KIND_NAME[n.kind]}</span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}

export function ZoomControls({ fitPadding = 0.12, maxFitZoom = 1 }: { fitPadding?: number; maxFitZoom?: number }) {
  const rf = useReactFlow();
  const { zoom } = useViewport();
  const reduced = usePrefersReducedMotion();
  const d = reduced ? 0 : 200;
  const btn =
    "inline-flex h-8 w-8 shrink-0 items-center justify-center text-fg-2 transition-colors hover:bg-raised-2 hover:text-fg";
  return (
    <div className="flex items-center overflow-hidden rounded-md border border-line bg-panel shadow-[var(--shadow-panel)]">
      <span className="mono w-12 text-center text-[10px] text-fg-3" aria-label={`Zoom ${Math.round(zoom * 100)} percent`}>{Math.round(zoom * 100)}%</span>
      <button type="button" className={btn} aria-label="Zoom in" title="Zoom in" onClick={() => void rf.zoomIn({ duration: d })}>
        <Plus size={14} strokeWidth={1.75} aria-hidden />
      </button>
      <button type="button" className={btn} aria-label="Zoom out" title="Zoom out" onClick={() => void rf.zoomOut({ duration: d })}>
        <Minus size={14} strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className={btn}
        aria-label="Fit graph to view"
        title="Fit to view"
        onClick={() => void rf.fitView({ padding: fitPadding, maxZoom: maxFitZoom, duration: reduced ? 0 : 260 })}
      >
        <Maximize size={13} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}

export function GraphLegend({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-fg-2",
        className,
      )}
      aria-label="Legend"
    >
      <span className="flex items-center gap-1.5" title="A relationship stored in the FalkorDB policy graph">
        <svg width="22" height="8" aria-hidden>
          <path d="M1 4 H17" stroke="#8d867e" strokeWidth="1.25" />
          <path d="M16 1.2 L21 4 L16 6.8 Z" fill="#8d867e" />
        </svg>
        Relationship
      </span>
      {!compact ? <span className="h-3 w-px bg-line" aria-hidden /> : null}
      <LegendBand color="var(--color-risk)" dash="6 4" label="Unwanted path" title="Dashed: derived route that a guardrail forbids" />
      <LegendBand color="var(--color-permitted)" dash="2 3" label="Permitted access" title="Dotted: derived route the contract does not constrain" />
      <LegendBand color="var(--color-sage)" label="Required access" title="Solid: derived route a declared workflow depends on" />
    </div>
  );
}

function LegendBand({ color, label, title, dash }: { color: string; label: string; title: string; dash?: string }) {
  return (
    <span className="flex items-center gap-1.5" title={title}>
      <svg width="20" height="8" aria-hidden>
        <path d="M2 4 H18" stroke={color} strokeWidth={dash ? "1.5" : "2.4"} strokeDasharray={dash} />
      </svg>
      {label}
    </span>
  );
}
