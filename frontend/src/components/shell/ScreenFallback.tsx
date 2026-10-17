import { Skeleton } from "@/components/ui/States";
import { PageContainer } from "./PageHeader";

/** Server-safe placeholder while a client screen reads its URL state. */
export function ScreenFallback() {
  return (
    <PageContainer>
      <div aria-busy="true" aria-label="Loading">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-6 h-[420px] w-full rounded-xl" />
      </div>
    </PageContainer>
  );
}
