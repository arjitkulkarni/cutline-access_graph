import type { Metadata } from "next";
import { Suspense } from "react";
import { RegressionTestsScreen } from "@/components/screens/RegressionTestsScreen";
import { ScreenFallback } from "@/components/shell/ScreenFallback";

export const metadata: Metadata = { title: "Regression Tests" };

export default function RegressionTestsPage() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <RegressionTestsScreen />
    </Suspense>
  );
}
