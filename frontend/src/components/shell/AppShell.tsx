"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { invalidatePolicyData, revisionKey, useConnection, useRevision } from "@/lib/queries";
import { revisionLabel } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { Skeleton } from "@/components/ui/States";
import { GraphMarkers } from "@/components/graph/GraphMarkers";
import { Sidebar } from "./Sidebar";
import { DisconnectedState } from "./DisconnectedState";
import { PageContainer } from "./PageHeader";

export function AppShell({ children, apiTarget }: { children: ReactNode; apiTarget: string }) {
  // The landing page at "/" is public and static: no sidebar, and it must render without the API.
  if (usePathname() === "/") return <>{children}</>;
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-raised focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <GraphMarkers />
      <Sidebar />
      <main id="main" className="min-w-0 flex-1">
        <BackendGate apiTarget={apiTarget}>{children}</BackendGate>
      </main>
    </div>
  );
}

/** Renders the screens only when the API answers and FalkorDB is connected. */
function BackendGate({ children, apiTarget }: { children: ReactNode; apiTarget: string }) {
  const conn = useConnection();
  if (conn.phase === "checking") return <GateLoading />;
  if (conn.phase === "unreachable" || conn.phase === "falkordb-down") {
    return <DisconnectedState connection={conn} apiTarget={apiTarget} />;
  }
  return (
    <>
      <RevisionWatcher />
      {children}
    </>
  );
}

function GateLoading() {
  return (
    <PageContainer>
      <div aria-busy="true" aria-label="Connecting to the CUTLINE API">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-80" />
        <div className="mt-6 grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}

/**
 * Polls the policy revision; when it moves (another operator, the live challenge, an apply),
 * every derived view is refetched so stale evidence is flagged immediately.
 */
function RevisionWatcher() {
  const rev = useRevision();
  const qc = useQueryClient();
  const toast = useToast();
  const last = useRef<{ key: string; label: string } | null>(null);

  useEffect(() => {
    if (!rev.data) return;
    const key = revisionKey(rev.data);
    const label = revisionLabel(rev.data);
    const prev = last.current;
    last.current = { key, label };
    if (!prev || prev.key === key) return;
    void invalidatePolicyData(qc);
    // Changes made from this console already announce themselves; only report outside changes.
    const recentLocalWrite = qc
      .getMutationCache()
      .getAll()
      .some((m) => m.state.submittedAt > 0 && Date.now() - m.state.submittedAt < 20_000);
    if (!recentLocalWrite) {
      toast.push({
        tone: "info",
        title: `Policy moved from ${prev.label} to ${label}`,
        description: "The revision changed outside this session. All views were refreshed.",
      });
    }
  }, [rev.data, qc, toast]);

  return null;
}
