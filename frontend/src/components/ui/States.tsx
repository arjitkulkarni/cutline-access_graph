"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleAlert, RotateCcw } from "lucide-react";
import { cn } from "@/lib/format";
import { errorCode, errorMessage } from "@/lib/queries";
import { Button } from "./Button";

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
  align = "center",
}: {
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 px-6 py-8",
        align === "center" ? "items-center text-center" : "items-start text-left",
        className,
      )}
    >
      {Icon ? (
        <span className="mb-1 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-raised text-fg-2">
          <Icon size={16} strokeWidth={1.75} aria-hidden />
        </span>
      ) : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {children ? <div className="max-w-[46ch] text-sm text-fg-2">{children}</div> : null}
      {action ? <div className="mt-2 flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title,
  error,
  onRetry,
  retrying,
  className,
  compact = false,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  compact?: boolean;
}) {
  const code = errorCode(error);
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-red/25 bg-red/[0.06]",
        compact ? "px-3 py-2.5" : "px-4 py-3.5",
        className,
      )}
    >
      <CircleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-red" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="mt-0.5 text-xs text-fg-2">
          {errorMessage(error)}
          {code ? <span className="mono ml-1.5 text-fg-3">[{code}]</span> : null}
        </p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("cl-pulse rounded-md bg-raised", className)} aria-hidden />;
}

export function LoadingRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("h-4", i % 3 === 2 ? "w-2/5" : i % 2 ? "w-3/4" : "w-full")} />
      ))}
    </div>
  );
}
