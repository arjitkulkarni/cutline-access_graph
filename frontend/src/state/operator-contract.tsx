"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Contract } from "@/lib/types";

/**
 * A contract the operator explicitly confirmed (parsed from a natural-language requirement).
 * When present it is sent with POST /api/repairs/plan instead of the graph-derived contract.
 */
interface OperatorContractState {
  contract: Contract | null;
  sourceText: string | null;
  confirmedAt: string | null;
  confirm: (contract: Contract, sourceText: string) => void;
  clear: () => void;
}

const Ctx = createContext<OperatorContractState | null>(null);

export function OperatorContractProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ contract: Contract | null; sourceText: string | null; confirmedAt: string | null }>({
    contract: null,
    sourceText: null,
    confirmedAt: null,
  });

  const confirm = useCallback((contract: Contract, sourceText: string) => {
    setState({ contract, sourceText, confirmedAt: new Date().toISOString() });
  }, []);
  const clear = useCallback(() => setState({ contract: null, sourceText: null, confirmedAt: null }), []);

  const value = useMemo(() => ({ ...state, confirm, clear }), [state, confirm, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOperatorContract(): OperatorContractState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOperatorContract must be used inside <OperatorContractProvider>");
  return ctx;
}
