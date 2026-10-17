import type { Metadata } from "next";
import { Suspense } from "react";
import { EvidenceScreen } from "@/components/screens/EvidenceScreen";
import { ScreenFallback } from "@/components/shell/ScreenFallback";

export const metadata: Metadata = { title: "Evidence" };

export default function EvidencePage() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <EvidenceScreen />
    </Suspense>
  );
}
