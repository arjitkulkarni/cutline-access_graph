"""In-app investigation agent (Track 01): the model chooses which typed graph tools to call.

LLM mode (ANTHROPIC_API_KEY set): Claude runs a manual tool-use loop over the same tools the MCP
server exposes. Deterministic mode (no key): the same tools run in a fixed order and the narrative
is templated — the response says which mode produced it. In both modes the deterministic planner
and the runtime verifier, not the model, decide whether a repair is safe, and the agent can never
approve or apply.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from pydantic import BaseModel, Field

from ..container import Container
from ..errors import CutlineError
from ..models.policy import Contract
from ..services.util import plural
from .tools import TOOLS, TOOLS_BY_NAME

log = logging.getLogger("cutline.agent")

AGENT_TOOL_NAMES = ["inspect_policy", "recall_history", "find_risks", "trace_access", "check_access", "get_contract",
                    "propose_repair", "verify_repair", "get_evidence", "export_regression_tests"]  # no apply_repair
MIN_TURN_S = 5.0  # do not start a model call with less of the time budget left than this

SYSTEM_PROMPT = """You are CUTLINE's investigation agent. CUTLINE repairs excessive permissions in a role-based \
authorization graph stored in FalkorDB without breaking the business workflows that legitimately depend on them.

How to work:
- Investigate before proposing: find the guardrail violations, then trace every access path for each one so you \
can explain the multi-hop route (principal → role → inherited role → capability).
- Check recall_history once early: earlier repairs and their rejected candidates are memory you should reuse.
- Plan with propose_repair. If the operator gave a confirmed contract, pass it unchanged. The planner evaluates \
every candidate on an isolated graph; rejected candidates carry counterexamples — use them to explain why the \
obvious fixes fail.
- Prove the chosen repair with verify_repair (real HTTP requests against the running Customer Ops app).
- You may only call the tools provided. Never invent principals, roles, capabilities or paths: if something the \
operator asks about is not in the graph, say that plainly.
- You cannot approve or apply a repair. A human approves it in the CUTLINE console.

Finish with a short report for the operator (under 220 words, plain sentences, no headings): what was wrong and \
through which paths; which obvious fixes fail and why; what the chosen repair changes; what the runtime checks \
showed. Only call the repair safe if verify_repair passed."""


class AgentStep(BaseModel):
    tool: str
    input: dict[str, Any] = Field(default_factory=dict)
    summary: str
    ms: float
    ok: bool = True


class AgentRun(BaseModel):
    mode: str  # "llm" | "deterministic"
    model: str | None
    steps: list[AgentStep]
    repair_id: str | None
    narrative: str
    stop_reason: str | None = None


class InvestigateRequest(BaseModel):
    text: str | None = Field(default=None, max_length=2000)
    contract: Contract | None = None


def summarize(tool: str, out: dict[str, Any]) -> str:
    if "error" in out:
        return f"error: {out['error'].get('message', out['error'])}"
    if tool == "inspect_policy":
        return (f"r{out['revision']} · {plural(len(out['principals']), 'principal')}, "
                f"{plural(len(out['roles']), 'role')} · {plural(len(out['violations']), 'guardrail violation')}")
    if tool == "recall_history":
        return (f"{plural(len(out['repairs']), 'earlier repair')}, "
                f"{plural(len(out['recent_events']), 'recent event')}")
    if tool == "find_risks":
        pairs = ", ".join(f"{f['principal']}→{f['capability']} ({len(f['paths'])})" for f in out["findings"])
        return f"{plural(out['risky_path_count'], 'risky path')}: {pairs or 'none'}"
    if tool == "trace_access":
        return plural(len(out["paths"]), "path") + (
            f": {out['paths'][0]}" + (" …" if len(out["paths"]) > 1 else "") if out["paths"] else "")
    if tool == "check_access":
        return "allowed" if out.get("allowed") else "denied"
    if tool == "get_contract":
        c = out.get("contract", {})
        return f"{len(c.get('must_deny', []))} must-deny, {len(c.get('must_allow', []))} must-allow"
    if tool in ("propose_repair", "verify_repair"):
        rejected = sum(1 for c in out["candidates"] if c["outcome"] != "PASS")
        text = f"{out['repair_id']}: {out['status']}"
        if tool == "propose_repair":
            return f"{text} · {plural(len(out['edits']), 'edit')} chosen · {plural(rejected, 'candidate')} rejected"
        v = out.get("verification") or {}
        return f"{text} · runtime checks {'passed' if v.get('passed') else 'FAILED'}"
    if tool == "get_evidence":
        return "stale" if out.get("stale") else "current"
    if tool == "export_regression_tests":
        return out.get("filename", "exported")
    return "done"


class AgentRunner:
    def __init__(self, container: Container):
        self.c = container

    def _call(self, name: str, args: dict[str, Any]) -> tuple[dict[str, Any], AgentStep]:
        started = time.perf_counter()
        try:
            out, ok = TOOLS_BY_NAME[name].run(self.c, args), True
        except CutlineError as exc:
            out, ok = exc.to_body(), False
        step = AgentStep(tool=name, input=args, summary=summarize(name, out), ok=ok,
                         ms=round((time.perf_counter() - started) * 1000, 1))
        return out, step

    def run(self, req: InvestigateRequest) -> AgentRun:
        if self.c.settings.anthropic_api_key:
            with self.c.llm_limiter.run("LLM agent run"):
                return self._run_llm(req)
        return self._run_deterministic(req)

    # ------------------------------------------------------------------ deterministic orchestrator
    def _run_deterministic(self, req: InvestigateRequest) -> AgentRun:
        steps: list[AgentStep] = []
        overview, s = self._call("inspect_policy", {})
        steps.append(s)
        _, s = self._call("recall_history", {"limit": 3})
        steps.append(s)
        risks, s = self._call("find_risks", {})
        steps.append(s)
        for f in risks.get("findings", []):
            _, s = self._call("trace_access", {"principal": f["principal"], "capability": f["capability"]})
            steps.append(s)
        if not risks.get("findings") and not req.contract:
            return AgentRun(mode="deterministic", model=None, steps=steps, repair_id=None, narrative=(
                "No guardrail is violated at this policy revision, so there is nothing to repair."))
        args = {"contract": req.contract.model_dump()} if req.contract else {}
        plan, s = self._call("propose_repair", args)
        steps.append(s)
        if "error" in plan:
            return AgentRun(mode="deterministic", model=None, steps=steps, repair_id=None, narrative=s.summary)
        verified = plan
        if plan["status"] == "PROPOSED":
            verified, s = self._call("verify_repair", {"repair_id": plan["repair_id"]})
            steps.append(s)
        return AgentRun(mode="deterministic", model=None, steps=steps, repair_id=plan["repair_id"],
                        narrative=self._template(risks, verified))

    @staticmethod
    def _template(risks: dict[str, Any], plan: dict[str, Any]) -> str:
        if "error" in plan:
            return plan["error"]["message"]
        findings = risks.get("findings", [])
        routes = sorted({p for f in findings for p in f["paths"]})
        parts = [f"{plural(len(findings), 'guardrail violation')} reach the forbidden capability through "
                 f"{plural(len(routes), 'path')}, e.g. {routes[0]}." if routes else "No current violations."]
        rejected = [c for c in plan["candidates"] if c["outcome"] != "PASS"]
        if rejected:
            examples = "; ".join(
                f"'{c['title']}' fails ({c['first_violation']['kind'].lower().replace('_', ' ')}: "
                f"{c['first_violation']['principal']} → {c['first_violation']['capability']})"
                for c in rejected[:3] if c["first_violation"])
            verb = "was" if len(rejected) == 1 else "were"
            parts.append(f"{plural(len(rejected), 'candidate repair')} {verb} rejected by FalkorDB counterexamples "
                         f"— {examples}.")
        if plan["edits"]:
            parts.append("Chosen repair: " + "; ".join(e["describe"] for e in plan["edits"]) + ".")
        v = plan.get("verification")
        if v:
            parts.append("Runtime checks against the Customer Ops app " +
                         ("all passed." if v["passed"] else "FAILED — do not approve."))
        if plan["status"] == "INFEASIBLE_WITHIN_BUDGET":
            parts.append("No candidate satisfied every constraint within the search budget.")
        parts.append("A human must review and approve the repair in the console before it is applied.")
        return " ".join(parts)

    # ------------------------------------------------------------------ LLM agent (Claude)
    def _run_llm(self, req: InvestigateRequest) -> AgentRun:
        import anthropic  # imported lazily so the API runs without the SDK configured

        s = self.c.settings
        deadline = time.monotonic() + s.llm_time_budget_s
        client = anthropic.Anthropic(api_key=s.anthropic_api_key)
        tools = [{"name": t.name, "description": t.description, "input_schema": t.input_schema}
                 for t in TOOLS if t.name in AGENT_TOOL_NAMES]
        ask = ["Investigate the active policy graph and repair any guardrail violation."]
        if req.text:
            ask.append(f"Operator requirement (natural language): {req.text}")
        if req.contract:
            ask.append("Operator-confirmed contract — pass it to propose_repair unchanged:\n"
                       + json.dumps(req.contract.model_dump(), separators=(",", ":")))
        messages: list[dict[str, Any]] = [{"role": "user", "content": "\n\n".join(ask)}]
        steps: list[AgentStep] = []
        repair_id: str | None = None
        narrative, stop_reason = "", None
        for _ in range(s.llm_max_turns):
            if deadline - time.monotonic() < MIN_TURN_S:
                narrative = narrative or (
                    f"Stopped at the {s.llm_time_budget_s:.0f} s time budget after {plural(len(steps), 'tool call')}. "
                    "Every tool result above is complete; open Repair Studio to continue.")
                stop_reason = "time_budget"
                break
            try:
                response = self._create(
                    client, deadline,
                    model=s.llm_model,
                    max_tokens=16000,
                    system=SYSTEM_PROMPT,
                    tools=tools,
                    messages=messages,
                    output_config={"effort": s.llm_effort},
                    cache_control={"type": "ephemeral"},  # tools + system are stable across turns
                    betas=["server-side-fallback-2026-07-01"],
                    fallbacks="default",
                )
            except anthropic.APIError as exc:
                log.warning("Claude API call failed: %s (request id %s)", exc.__class__.__name__,
                            getattr(exc, "request_id", None))
                narrative, stop_reason = api_error_text(exc, s.llm_model, len(steps)), "api_error"
                break
            stop_reason = response.stop_reason
            if stop_reason == "refusal":
                narrative = "The model declined this request; no tools were run after the refusal."
                break
            # append-only history: thinking and tool_use blocks go back unchanged
            messages.append({"role": "assistant", "content": response.content})
            text = "".join(b.text for b in response.content if b.type == "text").strip()
            if stop_reason != "tool_use":
                narrative = text + (" (truncated)" if stop_reason == "max_tokens" else "")
                if stop_reason == "pause_turn":
                    continue
                break
            results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                if block.name not in AGENT_TOOL_NAMES:
                    out, step = {"error": {"message": f"tool {block.name} is not available"}}, AgentStep(
                        tool=block.name, input=dict(block.input), summary="not available", ms=0, ok=False)
                else:
                    out, step = self._call(block.name, dict(block.input))
                steps.append(step)
                repair_id = out.get("repair_id", repair_id) if isinstance(out, dict) else repair_id
                results.append({"type": "tool_result", "tool_use_id": block.id,
                                "content": json.dumps(out, default=str), "is_error": not step.ok})
            messages.append({"role": "user", "content": results})  # all results in one message
        else:
            narrative = narrative or "Stopped after the maximum number of agent turns."
        return AgentRun(mode="llm", model=s.llm_model, steps=steps, repair_id=repair_id, narrative=narrative,
                        stop_reason=stop_reason)

    @staticmethod
    def _create(client: Any, deadline: float, **params: Any) -> Any:
        """One model call inside the run's time budget, retried once for 429 / 5xx / connection errors.

        The SDK's own retries are off: they would also retry timeouts and could overrun the budget.
        """
        import anthropic

        for attempt in range(2):
            try:
                return client.with_options(timeout=max(deadline - time.monotonic(), 1.0), max_retries=0) \
                    .beta.messages.create(**params)
            except anthropic.APITimeoutError:
                raise
            except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
                transient = not isinstance(exc, anthropic.APIStatusError) or exc.status_code == 429 \
                    or exc.status_code >= 500
                if attempt or not transient or deadline - time.monotonic() < 2 * MIN_TURN_S:
                    raise
            time.sleep(1.0)
        raise AssertionError("unreachable")  # the second attempt returns or raises


def api_error_text(exc: Exception, model: str, steps: int) -> str:
    """Operator-facing reason for a failed Claude API call (never includes the key or raw response)."""
    import anthropic

    if isinstance(exc, anthropic.AuthenticationError):
        why = "rejected ANTHROPIC_API_KEY (401); check the key set on the API service"
    elif isinstance(exc, anthropic.PermissionDeniedError):
        why = f"refused this key access to {model} (403)"
    elif isinstance(exc, anthropic.NotFoundError):
        why = f"does not know the model '{model}' (404); check LLM_MODEL"
    elif isinstance(exc, anthropic.RateLimitError):
        why = "rate-limited this run (429)"
    elif isinstance(exc, anthropic.APIStatusError):
        why = f"answered HTTP {exc.status_code}"
    elif isinstance(exc, anthropic.APITimeoutError):
        why = "did not answer within the run's time budget"
    else:
        why = "could not be reached"
    done = f" after {plural(steps, 'tool call')}" if steps else ""
    return f"The Claude API {why}, so the agent stopped{done}. Nothing was approved or applied."
