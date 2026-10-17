"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Search } from "lucide-react";
import { useGraph } from "@/lib/queries";
import { cn } from "@/lib/format";
import { entityIcon, KIND_NAME } from "@/components/common/Entity";
import { Dialog } from "@/components/ui/Dialog";
import { Kbd } from "@/components/ui/CopyButton";

const pages = [
  { label: "Overview", href: "/overview" },
  { label: "Access Graph", href: "/graph" },
  { label: "Repair Studio", href: "/repair" },
  { label: "Evidence", href: "/evidence" },
  { label: "Regression Tests", href: "/tests" },
];

export function CommandSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const router = useRouter();
  const graph = useGraph();
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const navigation = pages.filter((p) => p.label.toLowerCase().includes(q)).map((p) => ({ ...p, detail: "Page", icon: ArrowUpRight }));
    const nodes = q ? (graph.data?.nodes ?? []).filter((n) => `${n.label} ${n.id}`.toLowerCase().includes(q)).slice(0, 10).map((n) => ({
      label: n.label, href: `/graph?focus=${encodeURIComponent(n.id)}`, detail: KIND_NAME[n.kind], icon: entityIcon(n.kind, n),
    })) : [];
    return [...navigation, ...nodes];
  }, [query, graph.data?.nodes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const choose = (href: string) => {
    setOpen(false);
    setQuery("");
    setActive(0);
    router.push(href);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search workspace" title="Search workspace (Ctrl / ⌘ K)" className="workspace-search mx-3 mb-5 flex h-8 items-center gap-2 rounded-md border border-line bg-bg/50 px-2.5 text-xs text-fg-3 transition-colors hover:border-line-strong hover:text-fg">
        <Search size={14} className="shrink-0" aria-hidden /><span className="sidebar-label whitespace-nowrap">Search</span><span className="sidebar-label ml-auto shrink-0 whitespace-nowrap"><Kbd>Ctrl K</Kbd></span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Search workspace" description="Jump to a page or investigate a policy entity." width={540}>
        <div className="flex items-center gap-2 rounded-md border border-line-strong bg-inset px-3 focus-within:border-accent">
          <Search size={16} className="text-accent" aria-hidden />
          <input ref={input} value={query} role="combobox" aria-label="Search pages and policy entities" aria-controls={listId} aria-expanded={true} aria-autocomplete="list" aria-activedescendant={results[active] ? `${listId}-${active}` : undefined} placeholder="Search by name or identifier…" className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
            if (e.key === "Enter" && results[active]) { e.preventDefault(); choose(results[active].href); }
          }} />
        </div>
        <ul id={listId} role="listbox" aria-label="Workspace results" className="mt-3 max-h-[320px] overflow-y-auto">
          {results.map((r, i) => <li key={r.href} role="option" aria-selected={i === active} id={`${listId}-${i}`} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(r.href)} className={cn("flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5", i === active ? "bg-raised text-fg" : "text-fg-2")}><r.icon size={15} className={i === active ? "text-accent" : "text-fg-3"} aria-hidden /><span className="flex-1">{r.label}</span><span className="text-xs text-fg-3">{r.detail}</span></li>)}
        </ul>
        {!results.length ? <p role="status" className="px-3 py-6 text-center text-sm text-fg-2">No matches for “{query}”.</p> : null}
        {graph.isError ? <p className="mt-3 text-xs text-red">Policy entities are unavailable. Page navigation still works.</p> : null}
        <p className="mt-3 border-t border-line-soft pt-3 text-xs text-fg-3">↑ ↓ Navigate <span className="mx-3">↵ Open</span> Esc Close</p>
      </Dialog>
    </>
  );
}
