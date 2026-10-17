"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { pairKey } from "@/lib/contract";
import { cn, durationBetween, endpointPath, formatMs, plural } from "@/lib/format";
import type { Labeler } from "@/lib/labels";
import { joinChecks, type CheckRow } from "@/lib/repair";
import type { AccessMatrixRow, Contract, Decision, RuntimeCheck, Verification } from "@/lib/types";
import { RevisionTag, Timestamp } from "@/components/common/Meta";
import { AnimatedCheck, CrossMark } from "@/components/ui/AnimatedCheck";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";

type Group = "deny" | "allow" | "unchanged";

const GROUP_TITLE: Record<Group, string> = {
  deny: "Must be denied",
  allow: "Must keep access",
  unchanged: "Unchanged access",
};

const GROUP_HINT: Record<Group, string> = {
  deny: "guardrails",
  allow: "required workflows",
  unchanged: "not in the contract — must not change",
};

export interface Endpoint {
  method: string;
  path: string;
}

function decisionWord(d: Decision) {
  return d === "allow" ? "Allowed" : "Denied";
}

function StatusCell({ check, expected, side }: { check: RuntimeCheck | null; expected: Decision; side: "before" | "after" }) {
  if (!check) return <span className="text-fg-3">—</span>;
  const transport = check.status_code === 0;
  const matches = check.decision === expected;
  const tone =
    side === "before" ? (matches ? "text-fg-2" : "text-amber") : check.passed ? "text-sage" : "text-red";
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 whitespace-nowrap", tone)}>
      <span className="mono tnum text-[12px]">{transport ? "ERR" : check.status_code}</span>
      <span className="text-[12.5px]">{transport ? "No response" : decisionWord(check.decision)}</span>
    </span>
  );
}

function ResultCell({ row, running, delay }: { row: CheckRow; running: boolean; delay: number }) {
  if (running) return <Spinner size={13} className="text-fg-3" label="Running" />;
  if (!row.after) return <span className="text-[12px] text-fg-3">Not run</span>;
  return row.after.passed ? (
    <span className="inline-flex items-center gap-1.5 text-sage">
      <AnimatedCheck size={15} delay={delay} />
      <span className="sr-only">Passed</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-red">
      <CrossMark size={15} />
      <span className="sr-only">Failed</span>
    </span>
  );
}

function DetailLine({ title, check }: { title: string; check: RuntimeCheck | null }) {
  if (!check) return null;
  return (
    <div className="grid grid-cols-[72px_1fr] gap-x-3 text-[11px] leading-[17px]">
      <span className="text-fg-3">{title}</span>
      <span className="mono text-fg-2">
        graph predicted {check.graph_prediction} · engine {check.engine} decided {check.decision} · HTTP {check.status_code || "—"} ·{" "}
        {formatMs(check.latency_ms)}
        {check.decision_id ? ` · ${check.decision_id}` : ""}
        {check.graph_prediction !== check.decision ? <span className="text-red"> · prediction mismatch</span> : null}
      </span>
    </div>
  );
}

/**
 * Runtime checks. "Before" = the same requests against the active policy; "After" = against the
 * candidate (or, post-apply, against the new active policy). Every value is an HTTP result.
 */
export function VerificationTable({
  title,
  verification,
  matrix,
  contract,
  label,
  endpoints,
  running = false,
  stale = false,
  variant = "candidate",
  actions,
  emptyHint,
}: {
  title: string;
  verification: Verification | null;
  matrix: AccessMatrixRow[];
  contract: Contract;
  label: Labeler;
  endpoints: Record<string, Endpoint>;
  running?: boolean;
  stale?: boolean;
  variant?: "candidate" | "post_apply";
  actions?: ReactNode;
  emptyHint?: ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const rows: CheckRow[] = useMemo(() => {
    if (verification) return joinChecks(verification);
    return matrix.map((r) => ({
      id: `${r.principal}:${r.capability}`,
      principal: r.principal,
      capability: r.capability,
      expected: r.expected ?? (r.after ? "allow" : "deny"),
      before: null,
      after: null,
    }));
  }, [verification, matrix]);

  const groupOf = useMemo(() => {
    const deny = new Set(contract.must_deny.map((p) => pairKey(p.principal, p.capability)));
    const allow = new Set(contract.must_allow.map((p) => pairKey(p.principal, p.capability)));
    return (row: CheckRow): Group => {
      const key = pairKey(row.principal, row.capability);
      return deny.has(key) ? "deny" : allow.has(key) ? "allow" : "unchanged";
    };
  }, [contract]);

  const groups = (["deny", "allow", "unchanged"] as Group[])
    .map((g) => ({ group: g, rows: rows.filter((r) => groupOf(r) === g) }))
    .filter((g) => g.rows.length);

  const passed = verification?.checks.filter((c) => c.passed).length ?? 0;
  const total = verification?.checks.length ?? 0;
  const duration = verification ? durationBetween(verification.started_at, verification.finished_at) : null;
  const showBefore = variant === "candidate";

  const status: ReactNode = running ? (
    <Badge tone="accent">
      <Spinner size={11} /> Running
    </Badge>
  ) : !verification ? (
    <Badge tone="muted">Not run</Badge>
  ) : stale ? (
    <Badge tone="amber">Stale · bound to r{verification.revision.revision}</Badge>
  ) : verification.passed ? (
    <Badge tone="sage">
      {variant === "candidate" ? "Verified" : "Passed"} · {passed}/{total}
    </Badge>
  ) : (
    <Badge tone="red">
      Failed · {total - passed} of {total}
    </Badge>
  );

  let animIndex = 0;

  return (
    <section className="panel overflow-hidden" aria-labelledby={`${variant}-verification-title`}>
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 id={`${variant}-verification-title`} className="text-sm font-semibold text-fg">
              {title}
            </h2>
            {status}
          </div>
          {verification ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
              <span className="mono text-fg-2">{verification.policy_target}</span>
              <span aria-hidden>·</span>
              <span className="mono">{verification.graph}</span>
              <RevisionTag revision={verification.revision} tone={stale ? "amber" : "neutral"} />
              <span aria-hidden>·</span>
              <Timestamp iso={verification.finished_at} />
              {duration !== null ? <span>in {formatMs(duration)}</span> : null}
            </p>
          ) : (
            <p className="mt-1 text-xs text-fg-3">{emptyHint ?? "Checks planned from the access matrix. Nothing has been requested yet."}</p>
          )}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>

      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[11px] font-medium uppercase tracking-[0.06em] text-fg-3">
              <th scope="col" className="py-2 pl-4 pr-2 font-medium">
                Runtime check
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                Expected
              </th>
              {showBefore ? (
                <th scope="col" className="px-2 py-2 font-medium">
                  Before
                </th>
              ) : null}
              <th scope="col" className="px-2 py-2 font-medium">
                {variant === "candidate" ? "After" : "Active policy"}
              </th>
              <th scope="col" className="w-10 py-2 pl-2 pr-4 text-right font-medium">
                <span className="sr-only">Result</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ group, rows: groupRows }) => (
              <Fragment key={group}>
                <tr>
                  <th
                    scope="rowgroup"
                    colSpan={showBefore ? 5 : 4}
                    className="bg-bg/40 py-1.5 pl-4 text-left text-[11px] font-medium text-fg-2"
                  >
                    {GROUP_TITLE[group]} <span className="font-normal text-fg-3">· {GROUP_HINT[group]} · {groupRows.length}</span>
                  </th>
                </tr>
                {groupRows.map((row) => {
                  const ep = row.after ?? row.before;
                  const method = ep?.method ?? endpoints[row.capability]?.method;
                  const path = ep ? endpointPath(ep.path) : endpoints[row.capability]?.path;
                  const expanded = open === row.id;
                  const delay = verification && !running ? Math.min(animIndex++ * 0.035, 0.5) : 0;
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={cn(
                          "border-t border-line-soft transition-colors",
                          ep ? "cursor-pointer hover:bg-raised/40" : undefined,
                          expanded && "bg-raised/40",
                        )}
                        onClick={() => ep && setOpen(expanded ? null : row.id)}
                      >
                        <td className="py-2 pl-4 pr-2 align-top">
                          <div className="flex items-start gap-1.5">
                            {ep ? (
                              <button
                                type="button"
                                aria-expanded={expanded}
                                aria-label={`Decision details for ${label.node(row.principal)} ${row.capability}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpen(expanded ? null : row.id);
                                }}
                                className="mt-[3px] text-fg-3 hover:text-fg"
                              >
                                <ChevronRight size={12} className={cn("transition-transform", expanded && "rotate-90")} aria-hidden />
                              </button>
                            ) : (
                              <span className="w-3" />
                            )}
                            <div className="min-w-0">
                              <p className="text-[13px] leading-5 text-fg">
                                {label.node(row.principal)} <span className="text-fg-3">·</span>{" "}
                                <span className="mono text-[12px] text-fg-2">{row.capability}</span>
                              </p>
                              {method && path ? (
                                <p className="mono text-[11px] leading-4 text-fg-3">
                                  {method} {path}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2 align-top text-[12.5px] text-fg-2">{row.expected === "allow" ? "Allow" : "Deny"}</td>
                        {showBefore ? (
                          <td className="px-2 py-2 align-top">
                            <StatusCell check={row.before} expected={row.expected} side="before" />
                          </td>
                        ) : null}
                        <td className="px-2 py-2 align-top">
                          {running ? (
                            <span className="text-[12px] text-fg-3">Requesting…</span>
                          ) : (
                            <StatusCell check={row.after} expected={row.expected} side="after" />
                          )}
                        </td>
                        <td className="py-2 pl-2 pr-4 text-right align-top">
                          <span className="inline-flex justify-end">
                            <ResultCell row={row} running={running} delay={delay} />
                          </span>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="bg-raised/40">
                          <td colSpan={showBefore ? 5 : 4} className="px-4 pb-2.5 pl-[34px]">
                            <div className="flex flex-col gap-0.5">
                              {showBefore ? <DetailLine title="Before" check={row.before} /> : null}
                              <DetailLine title={variant === "candidate" ? "After" : "Active"} check={row.after} />
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] leading-4 text-fg-3">
        {verification
          ? `${plural(total, "request")} to the synthetic Customer Ops API.`
          : "Requests will go to the synthetic Customer Ops API."}{" "}
        <span className="mono">X-Cutline-Principal</span> selects the demo principal — it is not authentication.
      </p>
    </section>
  );
}
