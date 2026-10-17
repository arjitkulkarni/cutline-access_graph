import type { Metadata } from "next";
import { Suspense } from "react";
import { RepairStudioScreen } from "@/components/screens/RepairStudioScreen";
import { ScreenFallback } from "@/components/shell/ScreenFallback";

export const metadata: Metadata = { title: "Repair Studio" };

export default function RepairStudioPage() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <RepairStudioScreen />
    </Suspense>
  );
}
