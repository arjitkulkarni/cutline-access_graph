/**
 * Typed client for the CUTLINE REST API.
 *
 * All requests use relative `/api/...` URLs. With Vercel services the deployment routes them to its
 * `backend` service; everywhere else next.config.ts rewrites them to CUTLINE_API_URL.
 * There is intentionally no mock adapter here: every value the console renders comes from
 * one of these calls.
 */
import type {
  ActivityResponse,
  AgentRun,
  ApproveRequest,
  CheckResponse,
  Contract,
  ContractParseResponse,
  Evidence,
  GraphResponse,
  Health,
  InvestigateRequest,
  MutatePolicyResponse,
  PathsRequest,
  PathsResponse,
  PlanRequest,
  PolicyMutation,
  PolicyRevision,
  RegressionExportFormat,
  RegressionSuite,
  RepairPlan,
  RepairsResponse,
  ResetScenarioResponse,
  RisksResponse,
  Scenario,
} from "./types";

export const API_BASE = "/api";

/** Error codes produced by the client itself (never by the backend). */
export type ClientErrorCode = "API_UNREACHABLE" | "GATEWAY_TIMEOUT" | "NETWORK" | "BAD_RESPONSE";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** The console could not reach the API at all (backend down, proxy failure, offline). */
  get isUnreachable(): boolean {
    return this.code === "API_UNREACHABLE" || this.code === "NETWORK";
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractError(
  payload: unknown,
  status: number,
): { code: string; message: string; details?: Record<string, unknown> } | null {
  if (!isRecord(payload)) return null;
  const err = payload.error;
  if (isRecord(err) && typeof err.code === "string") {
    return {
      code: err.code,
      message: typeof err.message === "string" ? err.message : err.code,
      details: isRecord(err.details) ? err.details : undefined,
    };
  }
  // FastAPI's default validation body, in case a route bypasses the error envelope.
  if ("detail" in payload) {
    const detail = payload.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail
              .map((d) => (isRecord(d) && typeof d.msg === "string" ? d.msg : JSON.stringify(d)))
              .join("; ")
          : "Request failed";
    const code = status === 404 ? "NOT_FOUND" : status === 422 ? "VALIDATION_ERROR" : `HTTP_${status}`;
    return { code, message };
  }
  return null;
}

async function toApiError(res: Response, path: string): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }
  const err = extractError(payload, res.status);
  if (err) return new ApiError(res.status, err.code, err.message, err.details);
  if (res.status === 504) {
    // The proxy (Next.js or Vercel's CDN, 120 s) gave up waiting; the API itself may still be working.
    return new ApiError(
      504,
      "GATEWAY_TIMEOUT",
      "The CUTLINE API took too long to answer and the proxy stopped waiting. Refresh in a moment to see the result.",
    );
  }
  if (res.status >= 500) {
    // The Next.js proxy answers a plain-text 500 when the backend refuses the connection.
    return new ApiError(
      res.status,
      "API_UNREACHABLE",
      "The CUTLINE API did not answer. The backend may not be running.",
    );
  }
  return new ApiError(res.status, "BAD_RESPONSE", `Unexpected ${res.status} response from ${path}.`);
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK", "The browser could not reach the console server.");
  }

  if (!res.ok) throw await toApiError(res, path);

  const text = await res.text();
  if (!text) throw new ApiError(res.status, "BAD_RESPONSE", `Empty response from ${path}.`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status, "BAD_RESPONSE", `Expected JSON from ${path}.`);
  }
}

const enc = encodeURIComponent;

export function regressionExportUrl(repairId: string, format: RegressionExportFormat): string {
  return `${API_BASE}/regression-tests/${enc(repairId)}/export?format=${format}`;
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star?.[1]) return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 2_000);
}

/** Download a value the API already returned (e.g. an evidence record) as pretty JSON. */
export function saveJson(value: unknown, filename: string) {
  saveBlob(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), filename);
}

export const api = {
  health: (signal?: AbortSignal) => request<Health>("/health", { signal }),

  scenarios: async (signal?: AbortSignal): Promise<Scenario[]> => {
    const data = await request<Scenario[] | { scenarios: Scenario[] }>("/scenarios", { signal });
    return Array.isArray(data) ? data : (data.scenarios ?? []);
  },

  resetScenario: () =>
    request<ResetScenarioResponse>("/scenarios/customer-ops/reset", { method: "POST", body: {} }),

  graph: (signal?: AbortSignal) => request<GraphResponse>("/graph", { signal }),

  revision: (signal?: AbortSignal) => request<PolicyRevision>("/policy/revision", { signal }),

  paths: (body: PathsRequest, signal?: AbortSignal) =>
    request<PathsResponse>("/access/paths", { method: "POST", body, signal }),

  check: (principal: string, capability: string) =>
    request<CheckResponse>("/access/check", { method: "POST", body: { principal, capability } }),

  risks: (signal?: AbortSignal) => request<RisksResponse>("/risks", { signal }),

  contract: (signal?: AbortSignal) => request<Contract>("/contract", { signal }),

  parseContract: (text: string) =>
    request<ContractParseResponse>("/contract/parse", { method: "POST", body: { text } }),

  planRepair: (body: PlanRequest) =>
    request<RepairPlan>("/repairs/plan", { method: "POST", body }),

  repairs: async (signal?: AbortSignal): Promise<RepairPlan[]> => {
    const data = await request<RepairsResponse>("/repairs", { signal });
    return data.repairs ?? [];
  },

  repair: (id: string, signal?: AbortSignal) =>
    request<RepairPlan>(`/repairs/${enc(id)}`, { signal }),

  verifyRepair: (id: string) =>
    request<RepairPlan>(`/repairs/${enc(id)}/verify`, { method: "POST", body: {} }),

  approveRepair: (id: string, body: ApproveRequest) =>
    request<RepairPlan>(`/repairs/${enc(id)}/approve`, { method: "POST", body }),

  applyRepair: (id: string) =>
    request<RepairPlan>(`/repairs/${enc(id)}/apply`, { method: "POST", body: {} }),

  evidence: (repairId: string, signal?: AbortSignal) =>
    request<Evidence>(`/evidence/${enc(repairId)}`, { signal }),

  regressionSuite: (repairId: string, signal?: AbortSignal) =>
    request<RegressionSuite>(`/regression-tests/${enc(repairId)}`, { signal }),

  /** Fetches the export, checks the status, then hands the file to the browser. */
  downloadRegressionExport: async (
    repairId: string,
    format: RegressionExportFormat,
  ): Promise<{ filename: string; bytes: number }> => {
    const url = regressionExportUrl(repairId, format);
    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch {
      throw new ApiError(0, "NETWORK", "The browser could not reach the console server.");
    }
    if (!res.ok) throw await toApiError(res, url);
    const blob = await res.blob();
    const fallback =
      format === "json" ? `cutline-regression-${repairId}.json` : `test_cutline_${repairId}.py`;
    const filename = filenameFromDisposition(res.headers.get("Content-Disposition")) ?? fallback;
    saveBlob(blob, filename);
    return { filename, bytes: blob.size };
  },

  activity: async (signal?: AbortSignal) => {
    const data = await request<ActivityResponse>("/activity", { signal });
    return data.events ?? [];
  },

  mutatePolicy: (mutation: PolicyMutation) =>
    request<MutatePolicyResponse>("/demo/mutate-policy", { method: "POST", body: { mutation } }),

  investigate: (body: InvestigateRequest) =>
    request<AgentRun>("/agent/investigate", { method: "POST", body }),
};

