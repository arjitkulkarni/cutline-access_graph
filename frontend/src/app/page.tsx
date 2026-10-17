import type { Metadata, Viewport } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const viewport: Viewport = { themeColor: "#050505", colorScheme: "dark" };

export const metadata: Metadata = {
  title: { absolute: "CUTLINE · Cut the dangerous path, keep the work alive" },
  description:
    "A permission-repair agent on FalkorDB: it traces every hidden route to a dangerous capability, rejects unsafe fixes with counterexamples, and proves the repair against a running app. Built for Graph Hacks, Track 01.",
};

export default function HomePage() {
  return <LandingPage />;
}
