"use client";

import { useRouter } from "next/navigation";
import { Wrench } from "lucide-react";
import { errorMessage, usePlanRepair } from "@/lib/queries";
import { plural } from "@/lib/format";
import { useOperatorContract } from "@/state/operator-contract";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

/**
 * POST /api/repairs/plan — produces a *proposal* only. Candidates are evaluated on isolated
 * FalkorDB graph copies; nothing touches the active policy until an operator applies it.
 */
export function useGenerateRepair({ navigate = true }: { navigate?: boolean } = {}) {
  const operator = useOperatorContract();
  const router = useRouter();
  const toast = useToast();
  const plan = usePlanRepair({
    onSuccess: (p) => {
      const passing = p.candidates.filter((c) => c.outcome === "PASS").length;
      toast.push({
        tone: p.status === "PROPOSED" ? "success" : p.status === "NO_VIOLATIONS" ? "info" : "warning",
        title:
          p.status === "PROPOSED"
            ? `Plan ${p.id} proposed`
            : p.status === "NO_VIOLATIONS"
              ? "Nothing to repair"
              : "No safe repair within budget",
        description: `${plural(p.candidates.length, "candidate")} tested on isolated graphs · ${passing} passed. Nothing was applied.`,
      });
      if (navigate) router.push(`/repair?plan=${encodeURIComponent(p.id)}`);
    },
    onError: (err) => toast.push({ tone: "error", title: "Planning failed", description: errorMessage(err) }),
  });

  const run = () => plan.mutate(operator.contract);

  return { run, pending: plan.isPending, error: plan.error, usesOperatorContract: Boolean(operator.contract) };
}

export function GenerateRepairButton({
  label = "Generate safe repair",
  variant = "primary",
  size = "md",
  className,
  navigate = true,
}: {
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  navigate?: boolean;
}) {
  const gen = useGenerateRepair({ navigate });
  return (
    <Button variant={variant} size={size} icon={Wrench} loading={gen.pending} onClick={gen.run} className={className}>
      {gen.pending ? "Testing candidates…" : label}
    </Button>
  );
}
