import type { NextConfig } from "next";

/**
 * Every browser request goes to a relative `/api/...` URL, so the console never needs CORS or a
 * hard-coded host. That path reaches the CUTLINE FastAPI backend in one of two ways:
 *
 * - Vercel services (vercel.json at the repository root): Vercel routes `/api/*` to the `backend`
 *   service before Next.js sees the request. The frontend service builds with
 *   CUTLINE_API_SAME_ORIGIN=1 (its buildCommand), so no proxy is compiled in and CUTLINE_API_URL
 *   is not needed.
 * - Everywhere else (`next dev`, `next start`, Docker, a console-only Vercel project): Next.js
 *   proxies `/api/*` to CUTLINE_API_URL. Rewrites are compiled into the build manifest, so set it
 *   before `next build` (on Vercel: for the environment being built, then redeploy); `next dev`
 *   reads it when the dev server starts.
 */
const sameOrigin = process.env.CUTLINE_API_SAME_ORIGIN === "1";
const configuredApiUrl = process.env.CUTLINE_API_URL?.trim();

// A console-only Vercel build must proxy somewhere real: fail it instead of shipping a console that
// proxies to localhost. (`vercel dev` sets VERCEL_ENV=development and routes /api itself.)
if (process.env.VERCEL && !sameOrigin && process.env.VERCEL_ENV !== "development") {
  if (!configuredApiUrl) {
    throw new Error(
      "CUTLINE_API_URL is not set. Deploy from the repository root so vercel.json routes /api to the backend " +
        "service, or, for a console-only project, set CUTLINE_API_URL in Vercel → Project → Settings → " +
        "Environment Variables to the API's public https:// origin for this environment, then redeploy.",
    );
  }
  const target = new URL(configuredApiUrl);
  if (target.protocol !== "https:" || (target.pathname !== "/" && target.pathname !== "")) {
    throw new Error(
      `CUTLINE_API_URL must be the API's https:// origin with no path (got "${configuredApiUrl}"); ` +
        "the console appends /api/... itself.",
    );
  }
}

const apiUrl = (configuredApiUrl || "http://127.0.0.1:8000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Planning evaluates several isolated candidate graphs and verification issues real
    // HTTP checks; give the proxy more headroom than the 30s default.
    proxyTimeout: 120_000,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    if (sameOrigin) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
