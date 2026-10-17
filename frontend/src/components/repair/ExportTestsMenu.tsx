"use client";

import { ChevronDown, Download, FileBraces, FileCode } from "lucide-react";
import { errorMessage, useRegressionDownload } from "@/lib/queries";
import type { RegressionExportFormat } from "@/lib/types";
import { Button, type ButtonVariant } from "@/components/ui/Button";
import { Popover } from "@/components/ui/Popover";
import { Spinner } from "@/components/ui/Spinner";
import { useToast } from "@/components/ui/Toast";

const OPTIONS: { format: RegressionExportFormat; title: string; detail: string; icon: typeof FileCode }[] = [
  { format: "json", title: "JSON test specification", detail: "Every case with its expected decision and provenance", icon: FileBraces },
  { format: "pytest", title: "Executable pytest file", detail: "Real HTTP requests against the Customer Ops API", icon: FileCode },
];

/** GET /api/regression-tests/{id}/export?format=json|pytest → browser download. */
export function ExportTestsMenu({
  repairId,
  disabled,
  disabledReason,
  variant = "secondary",
  label = "Export regression tests",
}: {
  repairId: string | null;
  disabled?: boolean;
  disabledReason?: string;
  variant?: ButtonVariant;
  label?: string;
}) {
  const download = useRegressionDownload();
  const toast = useToast();

  const run = (format: RegressionExportFormat, close: () => void) => {
    if (!repairId) return;
    download.mutate(
      { repairId, format },
      {
        onSuccess: (res) => {
          toast.push({ tone: "success", title: `Downloaded ${res.filename}`, description: `${(res.bytes / 1024).toFixed(1)} KB from the API.` });
          close();
        },
        onError: (err) => toast.push({ tone: "error", title: "Export failed", description: errorMessage(err) }),
      },
    );
  };

  if (disabled || !repairId) {
    return (
      <Button variant={variant} icon={Download} disabled title={disabledReason}>
        {label}
      </Button>
    );
  }

  return (
    <Popover
      label="Export regression tests"
      align="end"
      width={300}
      trigger={(props) => (
        <Button {...props} variant={variant} icon={Download} iconRight={ChevronDown}>
          {label}
        </Button>
      )}
    >
      {(close) => (
        <div className="p-1.5" role="menu">
          {OPTIONS.map((o) => {
            const pending = download.isPending && download.variables?.format === o.format;
            return (
              <button
                key={o.format}
                type="button"
                role="menuitem"
                disabled={download.isPending}
                onClick={() => run(o.format, close)}
                className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-raised-2 disabled:opacity-60"
              >
                {pending ? <Spinner size={15} className="mt-0.5 text-fg-2" /> : <o.icon size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-fg-2" aria-hidden />}
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-fg">{o.title}</span>
                  <span className="block text-xs text-fg-3">{o.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
