"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ScanLine } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";

export function InspectorPanel({ children, open, onClose }: { children: ReactNode; open: boolean; onClose: () => void }) {
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1399px)");
    const update = () => setDrawer(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  if (drawer) return <Dialog open={open} onClose={onClose} title="Inspector" placement="right" width={380}><div className="-mx-5 -my-4">{children}</div></Dialog>;
  return (
    <aside aria-label="Inspector" className="panel flex min-h-0 flex-col overflow-hidden max-[1399px]:hidden">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line-soft px-4"><ScanLine size={13} className="text-accent" aria-hidden /><span className="label-micro text-[10px] tracking-[0.12em]">Inspector</span></div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </aside>
  );
}
