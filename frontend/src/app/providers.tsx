"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { ApiError } from "@/lib/api";
import { ToastProvider } from "@/components/ui/Toast";
import { OperatorContractProvider } from "@/state/operator-contract";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // 4xx answers are facts (not found, stale, invalid state) — do not hammer the API.
          if (error instanceof ApiError && error.isClientError) return false;
          return failureCount < 1;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <OperatorContractProvider>{children}</OperatorContractProvider>
        </ToastProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}
