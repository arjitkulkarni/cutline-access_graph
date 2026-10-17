"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { PageContainer } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/Button";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <PageContainer>
      <div role="alert" className="panel mx-auto mt-[8vh] max-w-[560px] px-6 py-5">
        <p className="label-micro text-red">Rendering error</p>
        <h1 className="mt-1.5 text-lg font-semibold text-fg">This screen failed to render</h1>
        <p className="mono mt-2 rounded-md bg-inset px-3 py-2 text-[12px] text-fg-2">{error.message}</p>
        <Button className="mt-4" icon={RotateCcw} onClick={reset}>
          Try again
        </Button>
      </div>
    </PageContainer>
  );
}
