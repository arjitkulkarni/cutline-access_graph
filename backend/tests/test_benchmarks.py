"""The benchmark scenarios double as regression tests for the planner's decisions."""

import pytest

from benchmarks.run import run_one
from benchmarks.scenarios import SCENARIOS


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[s.name for s in SCENARIOS])
def test_benchmark_scenario_outcome(scenario):
    result = run_one(scenario, "memory")
    assert result["correct"], result
    if scenario.expect == "PASS":
        assert result["independent_check"] == "pass"  # re-checked by the unbounded engine, not the planner
