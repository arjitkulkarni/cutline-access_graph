import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/format";

export function Spinner({ size = 14, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <LoaderCircle
      size={size}
      strokeWidth={2}
      className={cn("cl-spin shrink-0", className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "status" : undefined}
    />
  );
}
