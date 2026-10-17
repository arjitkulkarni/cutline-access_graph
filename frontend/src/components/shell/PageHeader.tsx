import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export function PageContainer({ children, className, wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={cn("page-enter mx-auto w-full px-4 pb-8 pt-6 lg:px-6", wide ? "max-w-[2200px]" : "max-w-[1640px]", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-5 flex min-h-[68px] flex-wrap items-center justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        <p className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.13em] text-fg-3"><span>Workspace</span><span className="text-line-strong" aria-hidden>/</span><span>{title === "Access Graph" ? "Investigate" : title === "Repair Studio" ? "Remediate" : title === "Overview" ? "Monitor" : "Validate"}</span></p>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-medium tracking-[-0.035em] text-fg">{title}</h1>
          {meta}
        </div>
        {subtitle ? <p className="mt-1 text-sm text-fg-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
