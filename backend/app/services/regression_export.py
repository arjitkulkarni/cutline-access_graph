"""Regression tests generated from a repair's verified constraints."""

from __future__ import annotations

import json
from typing import Any

from ..demo_app.customer_ops import ENDPOINTS
from ..models.repair import RegressionCase, RegressionResult, RegressionSuite, RepairPlan
from .util import now_iso


def build_suite(plan: RepairPlan) -> RegressionSuite:
    sources = {c.pair(): c.source for c in plan.contract.must_deny}
    sources.update({c.pair(): c.source for c in plan.contract.must_allow})
    latest = None
    if plan.application and plan.application.post_apply_verification:
        latest = plan.application.post_apply_verification
    elif plan.verification:
        latest = plan.verification
    results = {c.id: c for c in latest.checks} if latest else {}

    cases: list[RegressionCase] = []
    for row in plan.access_matrix:
        if row.capability not in ENDPOINTS:
            continue
        expected = row.expected or ("allow" if row.after else "deny")
        method, path = ENDPOINTS[row.capability]
        verb = "can" if expected == "allow" else "cannot"
        check = results.get(f"{row.principal}:{row.capability}")
        cases.append(RegressionCase(
            name=f"test_{row.principal}_{verb}_{row.capability}",
            principal=row.principal, capability=row.capability, method=method, path=path,  # type: ignore[arg-type]
            expected=expected, expected_status=200 if expected == "allow" else 403,  # type: ignore[arg-type]
            source=sources.get((row.principal, row.capability), "unchanged access"),
            last_result=RegressionResult(status_code=check.status_code, decision=check.decision, passed=check.passed,
                                         target=latest.policy_target) if (check and latest) else None,
        ))
    rank = {"guardrail": 0, "workflow": 1}
    cases.sort(key=lambda c: (rank.get(c.source.split(":", 1)[0], 2), c.principal, c.capability))
    revision = plan.application.to_revision if plan.application else plan.base_revision
    return RegressionSuite(repair_id=plan.id, revision=revision, cases=cases)


def export_json(plan: RepairPlan) -> dict[str, Any]:
    suite = build_suite(plan)
    return {
        "format": "cutline.regression.v1",
        "generated_at": now_iso(),
        "repair_id": plan.id,
        "policy_revision": suite.revision.model_dump(),
        "target": {
            "base_url_env": "CUTLINE_BASE_URL",
            "headers": {"X-Cutline-Principal": "<principal>", "X-Cutline-Policy": "active | candidate:<repair_id>"},
        },
        "cases": [c.model_dump(exclude={"last_result"}) for c in suite.cases],
    }


def export_pytest(plan: RepairPlan) -> str:
    suite = build_suite(plan)
    rows = ",\n".join(
        f"    ({json.dumps(c.name)}, {json.dumps(c.principal)}, {json.dumps(c.capability)}, {json.dumps(c.method)}, "
        f"{json.dumps(c.path)}, {c.expected_status}, {json.dumps(c.source)})"
        for c in suite.cases
    )
    default_policy = "active" if plan.application else f"candidate:{plan.id}"
    return f'''"""CUTLINE regression suite for repair {plan.id}.

Policy revision r{suite.revision.revision} ({suite.revision.hash}). Generated {now_iso()}.
Each case pins one (principal, capability) decision of the synthetic Customer Ops API, derived from
the repair's guardrails, required workflows and unchanged access.

Run:
    pip install pytest httpx
    CUTLINE_BASE_URL=http://127.0.0.1:8000 CUTLINE_POLICY={default_policy} pytest {plan.id}_regression_test.py -v
"""

import os

import httpx
import pytest

BASE_URL = os.environ.get("CUTLINE_BASE_URL", "http://127.0.0.1:8000")
POLICY = os.environ.get("CUTLINE_POLICY", "{default_policy}")

# (name, principal, capability, method, path, expected_status, provenance)
CASES = [
{rows},
]


@pytest.mark.parametrize(
    "principal,capability,method,path,expected_status,source",
    [case[1:] for case in CASES],
    ids=[case[0] for case in CASES],
)
def test_access_decision(principal, capability, method, path, expected_status, source):
    response = httpx.request(
        method,
        BASE_URL + path,
        headers={{"X-Cutline-Principal": principal, "X-Cutline-Policy": POLICY}},
        timeout=15,
    )
    assert response.status_code == expected_status, (
        f"{{principal}} -> {{capability}}: expected HTTP {{expected_status}}, got {{response.status_code}} "
        f"(required by {{source}}; decision id {{response.headers.get('X-Cutline-Decision-Id')}})"
    )
'''
