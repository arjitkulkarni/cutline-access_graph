import type { NextConfig } from "next";

/**
 * Every browser request goes to a relative `/api/...` URL. Next.js proxies it to the
 * CUTLINE FastAPI backend, so the console never needs CORS or a hard-coded host.
 *
 * Note: rewrites are compiled into the build manifest. For `next build` + `next start`,
 * set CUTLINE_API_URL before building; `next dev` reads it when the dev server starts.
 */
const apiUrl = (process.env.CUTLINE_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

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
