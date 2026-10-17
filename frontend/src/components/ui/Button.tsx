"use client";

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/format";
import { Spinner } from "./Spinner";

import {
  buttonBase as base,
  buttonClasses,
  buttonIconSizes as iconSizes,
  buttonVariants as variants,
  type ButtonSize,
  type ButtonVariant,
} from "./button-styles";

export { buttonClasses, type ButtonSize, type ButtonVariant };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon: Icon, iconRight: IconRight, loading = false, className, children, type, disabled, ...rest },
  ref,
) {
  const s = iconSizes[size];
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={s} /> : Icon ? <Icon size={s} strokeWidth={1.75} aria-hidden /> : null}
      {children}
      {IconRight && !loading ? <IconRight size={s} strokeWidth={1.75} aria-hidden /> : null}
    </button>
  );
});

interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
}

export function ButtonLink({ variant = "secondary", size = "md", icon: Icon, iconRight: IconRight, className, children, ...rest }: ButtonLinkProps) {
  const s = iconSizes[size];
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {Icon ? <Icon size={s} strokeWidth={1.75} aria-hidden /> : null}
      {children}
      {IconRight ? <IconRight size={s} strokeWidth={1.75} aria-hidden /> : null}
    </Link>
  );
}

export function IconButton({
  label,
  icon: Icon,
  size = "sm",
  variant = "ghost",
  className,
  ...rest
}: Omit<ButtonProps, "children" | "icon"> & { label: string; icon: LucideIcon }) {
  const dims = size === "xs" ? "h-6 w-6" : size === "sm" ? "h-7 w-7" : "h-8 w-8";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(base, variants[variant], dims, "px-0", className)}
      {...rest}
    >
      <Icon size={iconSizes[size]} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
