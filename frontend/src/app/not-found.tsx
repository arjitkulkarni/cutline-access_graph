import Link from "next/link";
import { PageContainer } from "@/components/shell/PageHeader";
import { buttonClasses } from "@/components/ui/button-styles";

export default function NotFound() {
  return (
    <PageContainer>
      <div className="mx-auto mt-[10vh] max-w-[520px] text-center">
        <p className="label-micro">404</p>
        <h1 className="mt-2 text-xl font-semibold tracking-[-0.015em] text-fg">This route is not part of the console</h1>
        <p className="mt-2 text-sm text-fg-2">CUTLINE has five destinations: Overview, Access Graph, Repair Studio, Evidence and Regression Tests.</p>
        <Link href="/overview" className={buttonClasses("secondary", "md", "mt-5")}>
          Back to Overview
        </Link>
      </div>
    </PageContainer>
  );
}
