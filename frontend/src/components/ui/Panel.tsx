import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export function Panel({
  children,
  className,
  as: Tag = "section",
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "aside" | "article";
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <Tag className={cn("panel", className)} aria-label={ariaLabel} aria-labelledby={labelledBy}>
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  meta,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <header className={cn("flex items-start gap-3 border-b border-line px-4 py-3", className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 id={id} className="text-sm font-semibold text-fg">
            {title}
          </h2>
          {meta}
        </div>
        {description ? <p className="mt-0.5 text-xs text-fg-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

export function SectionLabel({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <h3 id={id} className={cn("label-micro", className)}>
      {children}
    </h3>
  );
}
