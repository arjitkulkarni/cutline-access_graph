import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/shell/AppShell";

export const metadata: Metadata = {
  title: {
    default: "CUTLINE",
    template: "%s · CUTLINE",
  },
  description:
    "Find dangerous permission paths, plan the smallest safe RBAC change, and prove which access survives — on a FalkorDB authorization graph.",
};

export const viewport: Viewport = {
  themeColor: "#070606",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // Read on the server so the disconnected state can show where the proxy points.
  const apiTarget = (process.env.CUTLINE_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Providers>
          <AppShell apiTarget={apiTarget}>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
