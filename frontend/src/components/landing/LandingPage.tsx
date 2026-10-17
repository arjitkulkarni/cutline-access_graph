import "./landing.css";
import { LandingNav } from "./LandingNav";
import { Story } from "./Story";
import { IsolationSection } from "./IsolationSection";
import { ProofSection } from "./ProofSection";
import { ProtocolSection } from "./ProtocolSection";
import { ChallengeSection } from "./ChallengeSection";
import { FalkorSection } from "./FalkorSection";
import { AgentSection } from "./AgentSection";
import { ResultsSection } from "./ResultsSection";
import { ClosingSection } from "./ClosingSection";

/** Opening incision: a red line splits the black screen and the halves part. Pure CSS. */
function Curtain() {
  return (
    <div className="lp-curtain" aria-hidden>
      <div className="lp-curtain-half lp-curtain-half--top" />
      <div className="lp-curtain-half lp-curtain-half--bottom" />
      <div className="lp-curtain-mark">CUTLINE</div>
      <div className="lp-curtain-line" />
    </div>
  );
}

/** Public landing page for the Graph Hacks submission. Static; the console lives at /overview. */
export function LandingPage() {
  return (
    <div className="lp">
      <Curtain />
      <div className="lp-grain" aria-hidden />
      <a
        href="#trace"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[110] focus:bg-[var(--lp-red)] focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to the repair story
      </a>
      <LandingNav />
      <main>
        <Story />
        <IsolationSection />
        <ProofSection />
        <ProtocolSection />
        <ChallengeSection />
        <FalkorSection />
        <AgentSection />
        <ResultsSection />
      </main>
      <ClosingSection />
    </div>
  );
}
