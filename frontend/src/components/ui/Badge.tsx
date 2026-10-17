import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/format";

export type BadgeTone = "neutral" | "accent" | "amber" | "sage" | "red" | "muted";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-raised-2 text-fg border-line-strong",
  muted: "bg-transparent text-fg-2 border-line",
  // In-progress / human-confirmed states read bone; red is reserved for action and danger.
  accent: "bg-fg/[0.07] text-fg border-fg/30",
  amber: "bg-amber/10 text-amber border-amber/30",
  sage: "bg-sage/10 text-sage border-sage/30",
  red: "bg-red/10 text-red border-red/30",
};

const dots: Record<BadgeTone, string> = {
  neutral: "bg-fg-2",
  muted: "bg-fg-3",
  accent: "bg-fg",
  amber: "bg-amber",
  sage: "bg-sage",
  red: "bg-red",
};

export function Badge({
  tone = "neutral",
  icon: Icon,
  dot = false,
  size = "sm",
  className,
  children,
  title,
}: {
  tone?: BadgeTone;
  icon?: LucideIcon;
  dot?: boolean;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border font-medium",
        size === "sm" ? "h-5 px-1.5 text-2xs" : "h-6 px-2 text-xs",
        tones[tone],
        className,
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", dots[tone])} aria-hidden /> : null}
      {Icon ? <Icon size={size === "sm" ? 11 : 12} strokeWidth={2} aria-hidden /> : null}
      {children}
    </span>
  );
}

export function Dot({ tone, className, pulse = false }: { tone: BadgeTone; className?: string; pulse?: boolean }) {
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", dots[tone], pulse && "cl-pulse", className)} aria-hidden />;
}
