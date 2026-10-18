import type { NextConfig } from "next";

/**
 * Every browser request goes to a relative `/api/...` URL. Next.js proxies it to the
 * CUTLINE FastAPI backend, so the console never needs CORS or a hard-coded host.
 *
 * Note: rewrites are compiled into the build manifest. For `next build` + `next start`,
 * set CUTLINE_API_URL before building; `next dev` reads it when the dev server starts.
 * On Vercel the variable must be set for the environment being built, and changing it needs a redeploy.
 */
const configuredApiUrl = process.env.CUTLINE_API_URL?.trim();

// Fail the Vercel build instead of shipping a console that proxies to localhost.
if (process.env.VERCEL) {
  if (!configuredApiUrl) {
    throw new Error(
      "CUTLINE_API_URL is not set. In Vercel → Project → Settings → Environment Variables, set it to the " +
        "Railway API's public URL (https://<service>.up.railway.app) for this environment, then redeploy.",
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
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
