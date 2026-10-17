"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/format";

export interface PopoverTriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-haspopup": "dialog";
}

/**
 * Small anchored panel for confirmations and details. Closes on outside pointer, Escape
 * (returning focus to its trigger) and when the route is hidden by <Activity>.
 */
export function Popover({
  trigger,
  children,
  label,
  side = "bottom",
  align = "start",
  width = 300,
  className,
}: {
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: (close: () => void) => ReactNode;
  label: string;
  side?: "top" | "bottom";
  align?: "start" | "end";
  width?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    const first = panelRef.current?.querySelector<HTMLElement>(
      "button:not([disabled]), [href], input, textarea, select, [tabindex]:not([tabindex='-1'])",
    );
    first?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Transient UI: reset when Next.js hides this route.
  useLayoutEffect(() => () => setOpen(false), []);

  return (
    <div ref={wrapRef} className={cn("relative inline-flex", className)}>
      {trigger({
        ref: triggerRef,
        onClick: () => setOpen((o) => !o),
        "aria-expanded": open,
        "aria-controls": id,
        "aria-haspopup": "dialog",
      })}
      <AnimatePresence>
        {open ? (
          <motion.div
            ref={panelRef}
            id={id}
            role="dialog"
            aria-label={label}
            initial={{ opacity: 0, y: side === "bottom" ? -4 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: side === "bottom" ? -2 : 2, transition: { duration: 0.12 } }}
            transition={{ duration: 0.16, ease: [0.25, 1, 0.5, 1] }}
            className={cn(
              "absolute z-50 rounded-lg border border-line-strong bg-raised text-sm shadow-[var(--shadow-pop)]",
              side === "bottom" ? "top-[calc(100%+6px)]" : "bottom-[calc(100%+6px)]",
              align === "start" ? "left-0" : "right-0",
            )}
            style={{ width }}
          >
            {children(() => setOpen(false))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
