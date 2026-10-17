import { cn } from "@/lib/format";

/** Server-safe button class recipe (usable from Server Components, e.g. links in not-found). */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline-amber";
export type ButtonSize = "xs" | "sm" | "md";

export const buttonBase =
  "relative inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium " +
  "transition-[background-color,border-color,color,opacity,box-shadow] duration-[120ms] ease-out active:shadow-[inset_0_1px_3px_rgb(0_0_0/0.25)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45";

export const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink border border-transparent hover:bg-accent-hover disabled:hover:bg-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]",
  secondary:
    "bg-raised text-fg border border-line hover:bg-raised-2 hover:border-line-strong disabled:hover:bg-raised disabled:hover:border-line",
  ghost: "text-fg-2 border border-transparent hover:bg-raised hover:text-fg disabled:hover:bg-transparent",
  danger: "bg-red/10 text-red border border-red/30 hover:bg-red/15 hover:border-red/45",
  "outline-amber": "bg-amber/8 text-amber border border-amber/30 hover:bg-amber/14 hover:border-amber/45",
};

export const buttonSizes: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-xs gap-1",
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
};

export const buttonIconSizes: Record<ButtonSize, number> = { xs: 12, sm: 14, md: 15 };

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}
