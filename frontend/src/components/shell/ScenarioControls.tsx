"use client";

import { Ellipsis, GitPullRequestArrow, RotateCcw, Zap } from "lucide-react";
import { useConnection, useMutatePolicy, useResetScenario, errorMessage } from "@/lib/queries";
import { plural, revisionLabel } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { useToast } from "@/components/ui/Toast";

function useLiveChallenge() {
  const mutate = useMutatePolicy();
  const toast = useToast();
  const run = (onDone?: () => void) =>
    mutate.mutate("contractor_tools", {
      onSuccess: (res) => {
        toast.push({
          tone: "warning",
          title: `Policy moved to ${revisionLabel(res.revision)}`,
          description: `${res.summary}. ${plural(res.new_paths.length, "new path")} to a restricted capability. Earlier evidence is now stale.`,
        });
        onDone?.();
      },
      onError: (err) => toast.push({ tone: "error", title: "Mutation was rejected", description: errorMessage(err) }),
    });
  return { run, pending: mutate.isPending };
}

function useReset() {
  const reset = useResetScenario();
  const toast = useToast();
  const run = (onDone?: () => void) =>
    reset.mutate(undefined, {
      onSuccess: (res) => {
        toast.push({
          tone: "info",
          title: `Scenario reset at ${revisionLabel(res.revision)}`,
          description: "The seeded Customer Operations policy is active again. Plans from earlier revisions are stale.",
        });
        onDone?.();
      },
      onError: (err) => toast.push({ tone: "error", title: "Reset failed", description: errorMessage(err) }),
    });
  return { run, pending: reset.isPending };
}

/** Deliberate live challenge — only rendered when the backend reports demo mode. */
export function LiveChallengeControl({ align = "end" }: { align?: "start" | "end" }) {
  const conn = useConnection();
  const challenge = useLiveChallenge();
  if (conn.phase !== "connected" || !conn.health.demo_mode) return null;
  return (
    <Popover
      label="Introduce a new export path"
      align={align}
      width={320}
      trigger={(props) => (
        <Button {...props} variant="outline-amber" size="md" icon={Zap}>
          Live challenge
        </Button>
      )}
    >
      {(close) => (
        <div className="p-3.5">
          <p className="text-sm font-medium text-fg">Introduce a new export path?</p>
          <p className="mt-1 text-xs leading-[18px] text-fg-2">
            The demo backend attaches a new <span className="mono text-fg">contractor_tools</span> role, which grants{" "}
            <span className="mono text-fg">export_customers</span>, to the role Maya currently holds. The policy revision
            advances, so every plan and verification bound to the current revision becomes stale.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" variant="outline-amber" icon={GitPullRequestArrow} loading={challenge.pending} onClick={() => challenge.run(close)}>
              Introduce path
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}

/** Quiet scenario menu in the sidebar footer (demo mode only). */
export function ScenarioMenu() {
  const conn = useConnection();
  const challenge = useLiveChallenge();
  const reset = useReset();
  if (conn.phase !== "connected" || !conn.health.demo_mode) return null;
  return (
    <Popover
      label="Scenario controls"
      side="top"
      align="end"
      width={292}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label="Scenario controls"
          title="Scenario controls"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-raised hover:text-fg"
        >
          <Ellipsis size={15} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div className="divide-y divide-line">
          <div className="px-3.5 py-3">
            <p className="label-micro">Demo scenario</p>
            <p className="mt-1 text-xs text-fg-2">These controls change the active policy graph on the backend.</p>
          </div>
          <div className="px-3.5 py-3">
            <p className="text-sm font-medium text-fg">Introduce new export path</p>
            <p className="mt-0.5 text-xs text-fg-2">Attach a contractor_tools bundle that grants export_customers. Evidence goes stale.</p>
            <Button className="mt-2.5" size="sm" variant="outline-amber" icon={Zap} loading={challenge.pending} onClick={() => challenge.run(close)}>
              Introduce path
            </Button>
          </div>
          <div className="px-3.5 py-3">
            <p className="text-sm font-medium text-fg">Reset scenario</p>
            <p className="mt-0.5 text-xs text-fg-2">Re-seed the Customer Operations policy at a new revision.</p>
            <Button className="mt-2.5" size="sm" variant="secondary" icon={RotateCcw} loading={reset.pending} onClick={() => reset.run(close)}>
              Reset scenario
            </Button>
          </div>
        </div>
      )}
    </Popover>
  );
}
