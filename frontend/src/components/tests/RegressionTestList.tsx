"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn, endpointPath } from "@/lib/format";
import type { Labeler } from "@/lib/labels";
import type { GraphSnapshot, RegressionCase } from "@/lib/types";
import { ProvenanceChip } from "@/components/common/Meta";
import { AnimatedCheck, CrossMark } from "@/components/ui/AnimatedCheck";
import { Segmented } from "@/components/ui/Segmented";

type Filter = "all" | "passing" | "failing" | "not_run";

function resultOf(c: RegressionCase): Exclude<Filter, "all"> {
  if (!c.last_result) return "not_run";
  return c.last_result.passed ? "passing" : "failing";
}

/** Test explorer for GET /api/regression-tests/{repair_id}. */
export function RegressionTestList({
  cases,
  label,
  rolesFrom,
}: {
  cases: RegressionCase[];
  label: Labeler;
  /** Snapshot used to show each principal's roles (the graph the suite protects). */
  rolesFrom: GraphSnapshot | null;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const c = { all: cases.length, passing: 0, failing: 0, not_run: 0 };
    for (const t of cases) c[resultOf(t)] += 1;
    return c;
  }, [cases]);

  const rolesOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const e of rolesFrom?.edges ?? []) {
      if (e.type === "ASSIGNED_TO") map.set(e.source, [...(map.get(e.source) ?? []), e.target]);
    }
    return map;
  }, [rolesFrom]);

  const visible = cases.filter((c) => {
    if (filter !== "all" && resultOf(c) !== filter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.principal.toLowerCase().includes(q) ||
      label.node(c.principal).toLowerCase().includes(q) ||
      c.capability.toLowerCase().includes(q) ||
      c.source.toLowerCase().includes(q)
    );
  });

  return (
    <section className="panel overflow-hidden" aria-label="Regression test cases">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
        <Segmented<Filter>
          label="Filter by result"
          className="max-sm:grid max-sm:w-full max-sm:grid-cols-2"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: <>All <span className="tnum text-fg-3">{counts.all}</span></> },
            { value: "passing", label: <>Passing <span className="tnum text-fg-3">{counts.passing}</span></> },
            { value: "failing", label: <>Failing <span className="tnum text-fg-3">{counts.failing}</span></> },
            { value: "not_run", label: <>Not run <span className="tnum text-fg-3">{counts.not_run}</span></> },
          ]}
        />
        <label className="ml-auto flex h-8 w-[260px] items-center gap-2 rounded-md border border-line bg-inset px-2.5 focus-within:border-line-strong">
          <Search size={13} className="shrink-0 text-fg-3" aria-hidden />
          <span className="sr-only">Search tests</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by test, principal, capability"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none"
          />
        </label>
      </div>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-fg-3">
              <th scope="col" className="py-2 pl-4 pr-2 font-medium">
                Test
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Principal / role
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Capability
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Expected
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Actual
              </th>
              <th scope="col" className="w-16 py-2 pl-2 pr-4 text-right font-medium">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-fg-2">
                  No test matches this filter.
                </td>
              </tr>
            ) : (
              visible.map((c, i) => {
                const r = c.last_result;
                const roles = rolesOf.get(c.principal) ?? [];
                return (
                  <tr key={c.name} className="border-t border-line-soft first:border-t-0 hover:bg-raised/30">
                    <td className="py-2.5 pl-4 pr-2 align-top">
                      <p className="mono text-[12.5px] text-fg">{c.name}</p>
                      <div className="mt-1">
                        <ProvenanceChip source={c.source} label={label} />
                      </div>
                    </td>
                    <td className="px-2 py-2.5 align-top">
                      <p className="text-[13px] text-fg">{label.node(c.principal)}</p>
                      <p className="text-xs text-fg-3">{roles.length ? roles.map((id) => label.node(id)).join(", ") : "no role"}</p>
                    </td>
                    <td className="px-2 py-2.5 align-top">
                      <p className="mono text-[12px] text-fg-2">{c.capability}</p>
                      <p className="mono text-[11px] text-fg-3">
                        {c.method} {endpointPath(c.path)}
                      </p>
                    </td>
                    <td className="px-2 py-2.5 align-top">
                      <span className="inline-flex items-baseline gap-1.5 text-[12.5px] text-fg-2">
                        <span className="mono tnum text-[12px]">{c.expected_status}</span>
                        {c.expected === "allow" ? "Allow" : "Deny"}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 align-top">
                      {r ? (
                        <span className={cn("inline-flex flex-col", r.passed ? "text-sage" : "text-red")}>
                          <span className="inline-flex items-baseline gap-1.5 text-[12.5px]">
                            <span className="mono tnum text-[12px]">{r.status_code || "ERR"}</span>
                            {r.decision === "allow" ? "Allowed" : "Denied"}
                          </span>
                          <span className="mono text-[11px] text-fg-3">{r.target}</span>
                        </span>
                      ) : (
                        <span className="text-[12px] text-fg-3">Not run</span>
                      )}
                    </td>
                    <td className="py-2.5 pl-2 pr-4 text-right align-top">
                      <span className="inline-flex justify-end">
                        {!r ? (
                          <span className="text-[12px] text-fg-3">—</span>
                        ) : r.passed ? (
                          <span className="text-sage" title="Passed">
                            <AnimatedCheck size={15} delay={Math.min(i * 0.03, 0.4)} />
                            <span className="sr-only">Passed</span>
                          </span>
                        ) : (
                          <span className="text-red" title="Failed">
                            <CrossMark size={15} />
                            <span className="sr-only">Failed</span>
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
