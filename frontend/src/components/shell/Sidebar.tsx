"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, LayoutDashboard, ScrollText, Waypoints, Wrench, PanelLeftClose, PanelLeftOpen, Layers3, type LucideIcon } from "lucide-react";
import { useConnection, useRepairs, useRevision, useRisks, useScenarios } from "@/lib/queries";
import { isEffectivelyStale, isPending } from "@/lib/repair";
import { cn, formatMs, relativeTime, revisionLabel, shortHash } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { Popover } from "@/components/ui/Popover";
import { Dot } from "@/components/ui/Badge";
import { LogoMark } from "./Logo";
import { ScenarioMenu } from "./ScenarioControls";
import { CommandSearch } from "./CommandSearch";

interface NavItem {
  href: "/overview" | "/graph" | "/repair" | "/evidence" | "/tests";
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/graph", label: "Access Graph", icon: Waypoints },
  { href: "/repair", label: "Repair Studio", icon: Wrench },
  { href: "/evidence", label: "Evidence", icon: ScrollText },
  { href: "/tests", label: "Regression Tests", icon: FlaskConical },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const conn = useConnection();
  const risks = useRisks();
  const repairs = useRepairs();
  const scenarios = useScenarios();
  const connected = conn.phase === "connected";

  const newest = repairs.data?.[0];
  const pendingCount = repairs.data?.filter(isPending).length ?? 0;
  const evidenceStale = newest ? isEffectivelyStale(newest) : false;
  const scenarioName = scenarios.data?.find((s) => s.active)?.name;

  const badgeFor = (href: NavItem["href"]) => {
    if (!connected) return null;
    if (href === "/graph" && risks.data && risks.data.risky_path_count > 0) {
      return (
        <span
          className="tnum ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm bg-amber/12 px-1 text-[11px] font-medium text-amber"
          title={`${risks.data.risky_path_count} risky access paths`}
        >
          {risks.data.risky_path_count}
        </span>
      );
    }
    if (href === "/repair" && pendingCount > 0) {
      return (
        <span
          className="tnum ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm bg-raised-2 px-1 text-[11px] font-medium text-fg-2"
          title={`${pendingCount} pending repair proposal${pendingCount === 1 ? "" : "s"}`}
        >
          {pendingCount}
        </span>
      );
    }
    if (href === "/evidence" && evidenceStale) {
      return (
        <span className="ml-auto text-[11px] font-medium text-amber" title="Latest evidence no longer matches the active policy">
          Stale
        </span>
      );
    }
    return null;
  };

  return (
    <aside
      aria-label="Primary"
      data-collapsed={collapsed}
      className="app-sidebar sticky top-0 z-20 flex h-dvh w-[208px] shrink-0 flex-col border-r border-line-soft bg-panel max-lg:w-[60px]"
    >
      <Link href="/" title="CUTLINE home" className="sidebar-brand flex h-[72px] shrink-0 items-center gap-2.5 px-4 max-lg:justify-center max-lg:px-0">
        <LogoMark size={27} />
        <div className="sidebar-label min-w-0">
          <p className="text-[13px] font-semibold tracking-[0.19em] text-fg">CUTLINE</p>
          <p className="mt-0.5 text-[10px] tracking-[0.03em] text-fg-3">Permission intelligence</p>
        </div>
      </Link>
      <div className="sidebar-label mx-3 mb-4 flex items-center gap-2.5 rounded-md border border-line-soft bg-raised/60 px-2.5 py-2.5">
        <Layers3 size={15} className="shrink-0 text-fg-2" aria-hidden />
        <div className="min-w-0"><p className="truncate text-xs font-medium text-fg">{scenarioName ?? "Policy workspace"}</p><p className="mt-0.5 text-[10px] text-fg-3">{connected ? "Connected workspace" : "Connecting to workspace"}</p></div>
      </div>
      <CommandSearch />
      <nav aria-label="Main" className="flex flex-col gap-1 px-2.5 max-lg:px-2">
        <p className="sidebar-label label-micro mb-1 px-2 text-[9px] tracking-[0.12em]">Workspace</p>
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={item.label}
              className={cn(
                "sidebar-nav-item group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[12px] transition-colors duration-[120ms] max-lg:justify-center max-lg:px-0",
                active ? "bg-accent/[0.08] text-fg" : "text-fg-2 hover:bg-raised/60 hover:text-fg",
              )}
            >
              {active ? <span className="absolute -left-2.5 top-1.5 h-5 w-[2px] rounded-r bg-accent max-lg:-left-2" aria-hidden /> : null}
              <Icon
                size={16}
                strokeWidth={1.75}
                aria-hidden
                className={cn("shrink-0", active ? "text-accent" : "text-fg-3 group-hover:text-fg-2")}
              />
              <span className="sidebar-label truncate">{item.label}</span>
              <span className="sidebar-label contents">{badgeFor(item.href)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col">
        <PolicyBlock />
        <ConnectionFooter />
        <button type="button" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} title={collapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => setCollapsed((v) => !v)} className="sidebar-collapse flex h-10 items-center gap-2 border-t border-line-soft px-4 text-xs text-fg-3 hover:bg-raised hover:text-fg max-lg:hidden">
          {collapsed ? <PanelLeftOpen size={15} aria-hidden /> : <PanelLeftClose size={15} aria-hidden />}<span className="sidebar-label">Collapse navigation</span>
        </button>
      </div>
    </aside>
  );
}

function PolicyBlock() {
  const rev = useRevision();
  const now = useNow(30_000);
  if (!rev.data) return null;
  return (
    <div className="sidebar-label border-t border-line-soft px-4 py-4">
      <p className="label-micro">Active policy</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="mono text-[13px] font-medium text-fg">{revisionLabel(rev.data)}</span>
        <span className="mono truncate text-[11px] text-fg-3" title={rev.data.hash}>
          {shortHash(rev.data.hash)}
        </span>
      </p>
      <p className="text-[11px] text-fg-3">
        Updated <time dateTime={rev.data.updated_at}>{relativeTime(rev.data.updated_at, now)}</time>
      </p>
    </div>
  );
}

function ConnectionFooter() {
  const conn = useConnection();

  const summary =
    conn.phase === "connected"
      ? { tone: "sage" as const, title: "FalkorDB connected", detail: `${conn.health.falkordb.graph} · ${formatMs(conn.health.falkordb.latency_ms)}` }
      : conn.phase === "falkordb-down"
        ? { tone: "red" as const, title: "FalkorDB disconnected", detail: conn.health.falkordb.host }
        : conn.phase === "unreachable"
          ? { tone: "red" as const, title: "API unreachable", detail: "Backend not responding" }
          : { tone: "muted" as const, title: "Checking connection", detail: "GET /api/health" };

  return (
    <div className="border-t border-line px-2.5 py-2.5 max-lg:px-2">
      <Popover
        label="Connection details"
        side="top"
        align="start"
        width={300}
        className="w-full"
        trigger={(props) => (
          <button
            {...props}
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-raised max-lg:justify-center"
          >
            <Dot tone={summary.tone} pulse={conn.phase === "checking"} />
            <span className="sidebar-label min-w-0">
              <span className="block truncate text-xs font-medium text-fg">{summary.title}</span>
              <span className="mono block truncate text-[11px] text-fg-3">{summary.detail}</span>
            </span>
          </button>
        )}
      >
        {() => <HealthDetails />}
      </Popover>
      {conn.phase === "connected" && conn.health.demo_mode ? (
        <div className="sidebar-label mt-1.5 flex items-center justify-between gap-2 pl-1.5">
          <span
            className="inline-flex h-5 items-center rounded-sm border border-line-strong px-1.5 text-[11px] font-medium text-fg-2"
            title="The backend runs with DEMO_MODE=true: the seeded Customer Operations scenario and its live-challenge controls are enabled."
          >
            Demo scenario
          </span>
          <ScenarioMenu />
        </div>
      ) : null}
    </div>
  );
}

function HealthDetails() {
  const conn = useConnection();
  if (conn.phase === "checking") {
    return <p className="p-3.5 text-xs text-fg-2">Waiting for the first health response…</p>;
  }
  if (conn.phase === "unreachable") {
    return (
      <div className="p-3.5">
        <p className="text-sm font-medium text-fg">The API did not answer</p>
        <p className="mt-1 text-xs text-fg-2">{conn.error.message}</p>
      </div>
    );
  }
  const h = conn.health;
  const rows: Array<[string, ReactNode]> = [
    ["FalkorDB", h.falkordb.connected ? "Connected" : "Disconnected"],
    ["Host", <span key="h" className="mono">{h.falkordb.host}</span>],
    ["Graph", <span key="g" className="mono">{h.falkordb.graph}</span>],
    ["Latency", formatMs(h.falkordb.latency_ms)],
    ["Decision engine", `${h.authz_engine.name} · ${h.authz_engine.available ? "available" : "unavailable"}`],
    ["LLM", h.llm.configured ? h.llm.model ?? "configured" : "not configured"],
    ["API version", <span key="v" className="mono">{h.version}</span>],
    ["Mode", h.demo_mode ? "Demo scenario" : "Live policy"],
  ];
  return (
    <div className="p-3.5">
      <p className="label-micro">GET /api/health · {h.status}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-3">{k}</dt>
            <dd className="min-w-0 truncate text-right text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      {h.falkordb.error ? <p className="mono mt-2.5 rounded-md bg-inset p-2 text-[11px] text-red">{h.falkordb.error}</p> : null}
      {h.authz_engine.detail ? <p className="mt-2 text-[11px] text-fg-3">{h.authz_engine.detail}</p> : null}
    </div>
  );
}
