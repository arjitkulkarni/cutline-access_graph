"use client";

import { useEffect, useRef } from "react";
import {
  queryOptions,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api, ApiError } from "./api";
import type {
  ApproveRequest,
  Contract,
  Health,
  InvestigateRequest,
  PathsResponse,
  PolicyMutation,
  PolicyRevision,
  RepairPlan,
} from "./types";

/** Query keys. `repair(id)` lives under `repairs` so invalidating the list refreshes details. */
export const qk = {
  health: ["health"] as const,
  scenarios: ["scenarios"] as const,
  revision: ["revision"] as const,
  graph: ["graph"] as const,
  risks: ["risks"] as const,
  contract: ["contract"] as const,
  repairs: ["repairs"] as const,
  repair: (id: string) => ["repairs", "detail", id] as const,
  evidence: (id: string) => ["evidence", id] as const,
  regression: (id: string) => ["regression", id] as const,
  activity: ["activity"] as const,
  paths: (revisionKey: string, principal: string, capability: string) =>
    ["paths", revisionKey, principal, capability] as const,
};

export function revisionKey(rev: PolicyRevision | undefined | null): string {
  return rev ? `${rev.revision}:${rev.hash}` : "unknown";
}

// ---------------------------------------------------------------------------
// Health / connection
// ---------------------------------------------------------------------------

export const healthQuery = queryOptions({
  queryKey: qk.health,
  queryFn: ({ signal }) => api.health(signal),
  refetchInterval: (query) => (query.state.data?.falkordb.connected ? 15_000 : 5_000),
  refetchIntervalInBackground: false,
  retry: 1,
  retryDelay: 800,
  staleTime: 4_000,
});

export function useHealth() {
  return useQuery(healthQuery);
}

export type ConnectionState =
  | { phase: "checking" }
  | { phase: "unreachable"; error: ApiError | Error }
  | { phase: "falkordb-down"; health: Health }
  | { phase: "connected"; health: Health };

/** Single source of truth for whether the console may talk to the graph. */
export function useConnection(): ConnectionState {
  const health = useHealth();
  if (health.isError) {
    return { phase: "unreachable", error: health.error };
  }
  if (!health.data) return { phase: "checking" };
  if (!health.data.falkordb.connected) return { phase: "falkordb-down", health: health.data };
  return { phase: "connected", health: health.data };
}

export function useBackendReady(): boolean {
  return useConnection().phase === "connected";
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function useScenarios() {
  const ready = useBackendReady();
  return useQuery({ queryKey: qk.scenarios, queryFn: ({ signal }) => api.scenarios(signal), enabled: ready, staleTime: 60_000 });
}

export function useRevision() {
  const ready = useBackendReady();
  return useQuery({
    queryKey: qk.revision,
    queryFn: ({ signal }) => api.revision(signal),
    enabled: ready,
    refetchInterval: 15_000,
  });
}

export function useGraph() {
  const ready = useBackendReady();
  return useQuery({ queryKey: qk.graph, queryFn: ({ signal }) => api.graph(signal), enabled: ready });
}

export function useRisks() {
  const ready = useBackendReady();
  return useQuery({ queryKey: qk.risks, queryFn: ({ signal }) => api.risks(signal), enabled: ready });
}

export function useContract() {
  const ready = useBackendReady();
  return useQuery({ queryKey: qk.contract, queryFn: ({ signal }) => api.contract(signal), enabled: ready });
}

export function useRepairs() {
  const ready = useBackendReady();
  return useQuery({ queryKey: qk.repairs, queryFn: ({ signal }) => api.repairs(signal), enabled: ready });
}

export function useRepair(id: string | null | undefined) {
  const ready = useBackendReady();
  return useQuery({
    queryKey: qk.repair(id ?? "none"),
    queryFn: ({ signal }) => api.repair(id as string, signal),
    enabled: ready && Boolean(id),
  });
}

export function useEvidence(repairId: string | null | undefined) {
  const ready = useBackendReady();
  return useQuery({
    queryKey: qk.evidence(repairId ?? "none"),
    queryFn: ({ signal }) => api.evidence(repairId as string, signal),
    enabled: ready && Boolean(repairId),
  });
}

export function useRegressionSuite(repairId: string | null | undefined) {
  const ready = useBackendReady();
  return useQuery({
    queryKey: qk.regression(repairId ?? "none"),
    queryFn: ({ signal }) => api.regressionSuite(repairId as string, signal),
    enabled: ready && Boolean(repairId),
  });
}

export function useActivity() {
  const ready = useBackendReady();
  return useQuery({ queryKey: qk.activity, queryFn: ({ signal }) => api.activity(signal), enabled: ready });
}

export interface PairQuery {
  principal: string;
  capability: string;
}

/**
 * Reachability for several (principal, capability) pairs via POST /api/access/paths.
 * Keys include the policy revision so a new revision always re-queries FalkorDB.
 */
export function usePathQueries(pairs: PairQuery[], rev: PolicyRevision | undefined) {
  const ready = useBackendReady();
  const key = revisionKey(rev);
  return useQueries({
    queries: pairs.map((pair) => ({
      queryKey: qk.paths(key, pair.principal, pair.capability),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.paths({ principal: pair.principal, capability: pair.capability }, signal),
      enabled: ready && Boolean(rev),
      staleTime: 30_000,
    })),
    combine: (results) => ({
      data: results
        .map((r) => r.data)
        .filter((d): d is PathsResponse => Boolean(d)),
      isPending: results.some((r) => r.isPending && r.fetchStatus !== "idle"),
      error: results.find((r) => r.error)?.error ?? null,
    }),
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function storePlan(qc: QueryClient, plan: RepairPlan) {
  qc.setQueryData(qk.repair(plan.id), plan);
  qc.setQueryData<RepairPlan[]>(qk.repairs, (prev) => {
    if (!prev) return prev;
    const exists = prev.some((p) => p.id === plan.id);
    return exists ? prev.map((p) => (p.id === plan.id ? plan : p)) : [plan, ...prev];
  });
}

async function refreshAfterRepairChange(qc: QueryClient, plan: RepairPlan) {
  storePlan(qc, plan);
  await Promise.all([
    qc.invalidateQueries({ queryKey: qk.repairs }),
    qc.invalidateQueries({ queryKey: qk.evidence(plan.id) }),
    qc.invalidateQueries({ queryKey: qk.regression(plan.id) }),
    qc.invalidateQueries({ queryKey: qk.activity }),
  ]);
}

/** Invalidate everything except the connection probe — used after the policy itself changes. */
export function invalidatePolicyData(qc: QueryClient) {
  return qc.invalidateQueries({
    predicate: (query) => query.queryKey[0] !== "health",
  });
}

/**
 * Side effects (toasts, navigation) are passed as hook-level callbacks: unlike callbacks given to
 * mutate(), they still run if the calling component re-mounts while the request is in flight.
 */
export interface MutationEffects<T> {
  onSuccess?: (data: T) => void;
  onError?: (error: unknown) => void;
}

export function usePlanRepair(effects: MutationEffects<RepairPlan> = {}) {
  const qc = useQueryClient();
  const ref = useEffectsRef(effects);
  return useMutation({
    mutationFn: (contract: Contract | null) => api.planRepair(contract ? { contract } : {}),
    onSuccess: async (plan) => {
      await refreshAfterRepairChange(qc, plan);
      ref.current.onSuccess?.(plan);
    },
    onError: (err) => ref.current.onError?.(err),
  });
}

export function useVerifyRepair(effects: MutationEffects<RepairPlan> = {}) {
  const qc = useQueryClient();
  const ref = useEffectsRef(effects);
  return useMutation({
    mutationFn: (id: string) => api.verifyRepair(id),
    onSuccess: async (plan) => {
      await refreshAfterRepairChange(qc, plan);
      ref.current.onSuccess?.(plan);
    },
    onError: (err) => ref.current.onError?.(err),
  });
}

function useEffectsRef<T>(effects: MutationEffects<T>) {
  const ref = useRef(effects);
  useEffect(() => {
    ref.current = effects;
  });
  return ref;
}

export function useApproveRepair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ApproveRequest }) => api.approveRepair(id, body),
    onSuccess: (plan) => refreshAfterRepairChange(qc, plan),
  });
}

export function useApplyRepair() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.applyRepair(id),
    onSuccess: async (plan) => {
      storePlan(qc, plan);
      // Applying writes to the active policy graph: everything derived from it is now outdated.
      await invalidatePolicyData(qc);
    },
  });
}

export function useParseContract() {
  return useMutation({ mutationFn: (text: string) => api.parseContract(text) });
}

/**
 * The agent's own propose_repair creates a new plan, which remounts the Repair Studio (it is keyed by
 * plan id). The run therefore lives in the mutation cache under a stable key, and the log reads it with
 * useMutationState instead of component state.
 */
export const agentRunKey = ["agent-run"] as const;

export function useInvestigate() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: agentRunKey,
    mutationFn: (body: InvestigateRequest) => api.investigate(body),
    onSuccess: async (run) => {
      if (run.repair_id) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: qk.repairs }),
          qc.invalidateQueries({ queryKey: qk.activity }),
        ]);
      }
    },
  });
}

export function useMutatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mutation: PolicyMutation) => api.mutatePolicy(mutation),
    onSuccess: () => invalidatePolicyData(qc),
  });
}

export function useResetScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.resetScenario(),
    onSuccess: () => invalidatePolicyData(qc),
  });
}

export function useRegressionDownload() {
  return useMutation({
    mutationFn: ({ repairId, format }: { repairId: string; format: "json" | "pytest" }) =>
      api.downloadRegressionExport(repairId, format),
  });
}

/** Human-readable message for any error surfaced by a query or mutation. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}
