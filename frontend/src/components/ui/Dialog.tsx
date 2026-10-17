"use client";

import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Modal dialog built on the native <dialog> element: focus trapping, Escape handling and
 * inert background come from the platform. Closes itself if the route is hidden by
 * Next.js <Activity> so a stale modal never reappears on navigation back.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 520,
  dismissible = true,
  placement = "center",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
  dismissible?: boolean;
  placement?: "center" | "right";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);

  useEffect(() => {
    onCloseRef.current = onClose;
    openRef.current = open;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (el?.open) el.close();
      if (openRef.current) onCloseRef.current();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === ref.current) onClose();
      }}
      className={cn(
        "cl-dialog m-auto max-h-[calc(100dvh-48px)] overflow-hidden rounded-xl border border-line bg-panel p-0 text-fg shadow-[var(--shadow-pop)]",
        placement === "right" && "cl-drawer !mr-0 !h-dvh !max-h-dvh !rounded-r-none",
      )}
      style={{ width: `min(${width}px, calc(100vw - 32px))` }}
    >
      <div className={cn("flex max-h-[calc(100dvh-50px)] flex-col", placement === "right" && "h-full !max-h-dvh")}>
        <header className="flex items-start gap-3 border-b border-line px-5 pb-3.5 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold tracking-[-0.01em] text-fg">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-sm text-fg-2">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="-mr-1.5 -mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-raised hover:text-fg"
            >
              <X size={15} strokeWidth={1.75} aria-hidden />
            </button>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex items-center justify-end gap-2 border-t border-line bg-bg/40 px-5 py-3">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
