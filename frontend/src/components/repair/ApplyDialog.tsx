"use client";

import { useId, useState } from "react";
import { CircleCheck, ShieldCheck } from "lucide-react";
import { cn, plural, revisionLabel } from "@/lib/format";
import type { Labeler } from "@/lib/labels";
import { errorCode, errorMessage, useApplyRepair, useApproveRepair } from "@/lib/queries";
import { editText, editSign, verificationCounts } from "@/lib/repair";
import type { RepairPlan } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";

type Step = "idle" | "approving" | "applying";

/**
 * Human approval gate. Requires the operator's name and an explicit review acknowledgement,
 * then POST /approve (unless already approved) and POST /apply — a guarded atomic write that
 * the backend refuses if the policy moved since verification.
 */
export function ApplyDialog({
  plan,
  open,
  onClose,
  label,
  activeGraph,
}: {
  plan: RepairPlan;
  open: boolean;
  onClose: () => void;
  label: Labeler;
  activeGraph: string;
}) {
  const approve = useApproveRepair();
  const apply = useApplyRepair();
  const toast = useToast();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<unknown>(null);
  const nameId = useId();
  const noteId = useId();
  const ackId = useId();

  const alreadyApproved = plan.status === "APPROVED" && plan.approval !== null;
  const counts = verificationCounts(plan.verification);
  const n = plan.edits.length;

  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setReviewed(false);
      setError(null);
      setStep("idle");
    }
  }

  const busy = step !== "idle";
  const valid = reviewed && (alreadyApproved || name.trim().length >= 2);

  const run = async () => {
    setError(null);
    try {
      if (!alreadyApproved) {
        setStep("approving");
        await approve.mutateAsync({ id: plan.id, body: { approved_by: name.trim(), ...(note.trim() ? { note: note.trim() } : {}) } });
      }
      setStep("applying");
      const result = await apply.mutateAsync(plan.id);
      const post = result.application?.post_apply_verification;
      const pc = verificationCounts(post);
      toast.push({
        tone: result.status === "APPLIED" ? "success" : "error",
        title:
          result.status === "APPLIED"
            ? `Applied · ${revisionLabel(result.application?.from_revision)} → ${revisionLabel(result.application?.to_revision)}`
            : "Applied, but post-apply verification failed",
        description: post ? `Post-apply checks on the active policy: ${pc.passed}/${pc.total} passed.` : undefined,
      });
      setStep("idle");
      onClose();
    } catch (err) {
      setError(err);
      setStep("idle");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      dismissible={!busy}
      width={560}
      title="Apply verified migration"
      description={
        <>
          Writes {plural(n, "edit")} to <span className="mono text-fg">{activeGraph}</span> in one guarded, atomic transaction.
          The write is refused if the policy is no longer at {revisionLabel(plan.base_revision)}.
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon={ShieldCheck} disabled={!valid} loading={busy} onClick={run}>
            {busy ? (step === "approving" ? "Recording approval…" : "Applying…") : alreadyApproved ? "Apply migration" : "Approve and apply"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-3 rounded-lg border border-line bg-inset px-3.5 py-3 text-xs">
          <div>
            <dt className="text-fg-3">Plan</dt>
            <dd className="mono mt-0.5 text-fg">{plan.id}</dd>
          </div>
          <div>
            <dt className="text-fg-3">Policy</dt>
            <dd className="mono mt-0.5 text-fg">
              {revisionLabel(plan.base_revision)} <span className="text-fg-3">(current {revisionLabel(plan.current_revision)})</span>
            </dd>
          </div>
          <div>
            <dt className="text-fg-3">Candidate verification</dt>
            <dd className="mt-0.5 flex items-center gap-1 text-sage">
              <CircleCheck size={12} aria-hidden /> {counts.passed}/{counts.total} passed
            </dd>
          </div>
        </dl>

        <div>
          <p className="label-micro mb-1.5">Edits to write</p>
          <ol className="flex max-h-[180px] flex-col gap-1 overflow-y-auto rounded-lg border border-line px-3 py-2">
            {plan.edits.map((e, i) => (
              <li key={i} className="flex items-baseline gap-2 text-[13px]">
                <span className="tnum w-4 shrink-0 text-right text-[11px] text-fg-3">{i + 1}</span>
                <span className={cn("mono w-3 shrink-0 text-center", editSign(e.op) === "remove" ? "text-red" : "text-fg")}>
                  {editSign(e.op) === "remove" ? "−" : "+"}
                </span>
                <span className="text-fg">{editText(e, label)}</span>
              </li>
            ))}
          </ol>
        </div>

        {alreadyApproved && plan.approval ? (
          <p className="rounded-md border border-line bg-raised/50 px-3 py-2 text-xs text-fg-2">
            Approved by <span className="text-fg">{plan.approval.approved_by}</span>
            {plan.approval.note ? <> — “{plan.approval.note}”</> : null}. Edits hash{" "}
            <span className="mono text-fg-3">{plan.approval.edits_hash.slice(0, 19)}…</span>
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={nameId} className="text-xs font-medium text-fg">
                Approved by <span className="text-red">*</span>
              </label>
              <input
                id={nameId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
                disabled={busy}
                placeholder="Your name"
                className="h-8 rounded-md border border-line bg-inset px-2.5 text-[13px] text-fg outline-none focus:border-line-strong"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={noteId} className="text-xs font-medium text-fg">
                Note <span className="font-normal text-fg-3">(optional)</span>
              </label>
              <input
                id={noteId}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
                placeholder="Ticket or change reference"
                className="h-8 rounded-md border border-line bg-inset px-2.5 text-[13px] text-fg outline-none focus:border-line-strong"
              />
            </div>
          </div>
        )}

        <label htmlFor={ackId} className="flex cursor-pointer items-start gap-2.5 text-[13px] text-fg">
          <input
            id={ackId}
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
            disabled={busy}
            className="mt-[3px] h-3.5 w-3.5 accent-[var(--color-accent)]"
          />
          <span>
            I reviewed these {plural(n, "edit")} and the verification results.
          </span>
        </label>

        {busy ? (
          <p className="flex items-center gap-2 text-xs text-fg-2" role="status">
            <Spinner size={13} />
            {step === "approving" ? "POST /approve — recording your approval" : "POST /apply — guarded write, then post-apply verification"}
          </p>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-md border border-red/30 bg-red/[0.07] px-3 py-2 text-xs">
            <p className="font-medium text-red">{errorCode(error) === "STALE_PROPOSAL" ? "The policy moved — nothing was written" : "The backend refused the request"}</p>
            <p className="mt-0.5 text-fg-2">{errorMessage(error)}</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
