import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessGraphScreen } from "@/components/screens/AccessGraphScreen";
import { ScreenFallback } from "@/components/shell/ScreenFallback";

export const metadata: Metadata = { title: "Access Graph" };

export default function AccessGraphPage() {
  return (
    <Suspense fallback={<ScreenFallback />}>
      <AccessGraphScreen />
    </Suspense>
  );
}
