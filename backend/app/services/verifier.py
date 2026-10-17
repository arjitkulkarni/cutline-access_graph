"""Runtime verification: real HTTP requests against the synthetic Customer Ops API."""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from ..config import Settings
from ..demo_app.customer_ops import ENDPOINTS
from ..models.repair import Decision, RuntimeCheck


@dataclass
class CheckCase:
    principal: str
    capability: str
    expected: Decision


class RuntimeVerifier:
    def __init__(self, settings: Settings, client: httpx.Client | None = None):
        self.settings = settings
        self._client = client

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(base_url=self.settings.demo_base_url, timeout=20.0)
        return self._client

    def run(self, policy_target: str, cases: list[CheckCase], predicted: set[tuple[str, str]],
            engine: str) -> list[RuntimeCheck]:
        checks = []
        for case in cases:
            method, path = ENDPOINTS[case.capability]
            prediction: Decision = "allow" if (case.principal, case.capability) in predicted else "deny"
            started = time.perf_counter()
            status, decision_id, engine_used = 0, None, engine
            try:
                resp = self.client.request(method, path, headers={
                    "X-Cutline-Principal": case.principal, "X-Cutline-Policy": policy_target})
                status = resp.status_code
                decision_id = resp.headers.get("X-Cutline-Decision-Id")
                engine_used = resp.headers.get("X-Cutline-Engine", engine)
            except httpx.HTTPError:
                status = 0  # transport failure: recorded, never counted as a pass
            decision: Decision = "allow" if status == 200 else "deny"
            checks.append(RuntimeCheck(
                id=f"{case.principal}:{case.capability}", principal=case.principal, capability=case.capability,
                method=method, path=path, expected=case.expected, graph_prediction=prediction, status_code=status,  # type: ignore[arg-type]
                decision=decision, engine=engine_used, decision_id=decision_id,
                latency_ms=round((time.perf_counter() - started) * 1000, 1),
                passed=status in (200, 403) and decision == case.expected and prediction == decision,
            ))
        return checks
