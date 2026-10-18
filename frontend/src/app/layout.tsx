import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/shell/AppShell";
import { resolveApiTarget } from "@/lib/api-target";

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
  // Read on the server so the disconnected state can show where /api requests go.
  const apiTarget = resolveApiTarget();
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
