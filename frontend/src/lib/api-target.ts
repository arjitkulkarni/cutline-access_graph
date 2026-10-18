/**
 * Where the console's `/api` requests end up, resolved on the server at build time (see layout.tsx).
 *
 * With Vercel services (vercel.json at the repository root) the deployment routes `/api/*` to its own
 * `backend` service, and the frontend service builds with CUTLINE_API_SAME_ORIGIN=1. Everywhere else
 * next.config.ts proxies `/api/*` to CUTLINE_API_URL.
 */
export const SAME_ORIGIN_API = "same-origin";

export function resolveApiTarget(): string {
  if (process.env.CUTLINE_API_SAME_ORIGIN === "1") return SAME_ORIGIN_API;
  return (process.env.CUTLINE_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
}
