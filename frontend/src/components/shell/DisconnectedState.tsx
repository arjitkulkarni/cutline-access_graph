"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useIsFetching } from "@tanstack/react-query";
import { Database, RotateCcw, ServerOff, type LucideIcon } from "lucide-react";
import type { ConnectionState } from "@/lib/queries";
import { qk } from "@/lib/queries";
import { formatTime } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Dot } from "@/components/ui/Badge";
import { PageContainer } from "./PageHeader";

const START_COMMAND = "cd backend && .venv\\Scripts\\python -m uvicorn app.main:app --port 8000";

function CommandBlock({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-inset py-1.5 pl-3 pr-1.5">
      <span className="select-none text-fg-3" aria-hidden>
        &gt;
      </span>
      <code className="mono min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[12.5px] text-fg">{command}</code>
      <CopyButton value={command} label="Copy command" />
    </div>
  );
}

export function DisconnectedState({
  connection,
  apiTarget,
}: {
  connection: Extract<ConnectionState, { phase: "unreachable" | "falkordb-down" }>;
  apiTarget: string;
}) {
  const qc = useQueryClient();
  const fetching = useIsFetching({ queryKey: qk.health }) > 0;
  const now = useNow(5_000);
  const healthState = qc.getQueryState(qk.health);
  const lastChecked = healthState?.errorUpdatedAt || healthState?.dataUpdatedAt || now;

  const apiDown = connection.phase === "unreachable";
  const Icon: LucideIcon = apiDown ? ServerOff : Database;

  return (
    <PageContainer>
      <div className="mx-auto mt-[8vh] max-w-[680px]">
        <div className="panel overflow-hidden">
          <div className="flex items-start gap-4 border-b border-line px-6 py-5">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red/30 bg-red/10 text-red">
              <Icon size={18} strokeWidth={1.75} aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-[-0.01em] text-fg">
                {apiDown ? "The CUTLINE API is not reachable" : "FalkorDB is not connected"}
              </h1>
              <p className="mt-1 text-sm text-fg-2">
                {apiDown ? (
                  <>
                    The console proxies <span className="mono text-fg">/api</span> to{" "}
                    <span className="mono text-fg">{apiTarget}</span> and nothing answered there.
                  </>
                ) : (
                  <>
                    The API is running (v{connection.health.version}) but cannot reach FalkorDB at{" "}
                    <span className="mono text-fg">{connection.health.falkordb.host}</span>, graph{" "}
                    <span className="mono text-fg">{connection.health.falkordb.graph}</span>.
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5 px-6 py-5">
            {!apiDown && connection.health.falkordb.error ? (
              <div>
                <p className="label-micro">Reported error</p>
                <p className="mono mt-1.5 rounded-lg border border-line bg-inset px-3 py-2 text-[12px] text-red">
                  {connection.health.falkordb.error}
                </p>
              </div>
            ) : null}

            <div>
              <p className="label-micro">{apiDown ? "Start the API" : "Then restart the API"}</p>
              {!apiDown ? (
                <p className="mt-1.5 text-sm text-fg-2">
                  Check <span className="mono text-fg">FALKORDB_HOST</span>, <span className="mono text-fg">FALKORDB_USERNAME</span>{" "}
                  and <span className="mono text-fg">FALKORDB_PASSWORD</span> in <span className="mono text-fg">backend/.env</span>.
                </p>
              ) : (
                <p className="mt-1.5 text-sm text-fg-2">From the repository root:</p>
              )}
              <div className="mt-2">
                <CommandBlock command={START_COMMAND} />
              </div>
              {apiDown ? (
                <p className="mt-2 text-xs text-fg-3">
                  Running the API elsewhere? Set <span className="mono">CUTLINE_API_URL</span> before starting the console.
                </p>
              ) : null}
            </div>

            <p className="text-xs text-fg-3">
              Nothing in this console is shown until the policy graph is reachable — no paths, counts or verification
              results are filled in without FalkorDB.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line bg-bg/40 px-6 py-3">
            <span className="flex items-center gap-2 text-xs text-fg-2">
              <Dot tone={fetching ? "muted" : "red"} pulse={fetching} />
              {fetching ? "Checking…" : `Last checked ${formatTime(new Date(lastChecked).toISOString())} · retrying every 5 s`}
            </span>
            <Button
              size="sm"
              icon={RotateCcw}
              loading={fetching}
              onClick={() => qc.invalidateQueries({ queryKey: qk.health })}
            >
              Retry now
            </Button>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
