# CUTLINE benchmark

Target: **FalkorDB Cloud (ap-south-1)** · scenarios: 10 · planner budget: max_depth=6, max_candidates=24, max_cut_size=3

| Metric | CUTLINE | Baseline |
|---|---|---|
| Correct outcome (repair / refuse / flag as expected) | **10/10** | — |
| Safe repair rate on repairable scenarios | **7/7** | greedy revoke-at-source: 2/7 |
| Forbidden access detected (multi-hop vs direct grants only) | 11/12 | direct-grant checker: 7/12 |
| Beyond-bound path caught by the independent engine | 1 scenario(s) | — |
| Median planning time | 1460.8 ms (FalkorDB Cloud ap-south-1, candidates evaluated in parallel) | — |

| Scenario | Expected | CUTLINE status | Chosen family | Edits | Candidates (rejected) | Independent check | Greedy safe | Plan ms |
|---|---|---|---|---|---|---|---|---|
| `two_paths_shared_roles` — The demo: two inherited paths, Finance and a DSAR bot depend on the same roles | PASS | PROPOSED | scoped_role_migration | 7 | 10 (9) | pass | no | 2269.7 |
| `bundled_direct_role` — Needed and forbidden capability bundled in one role another principal relies on | PASS | PROPOSED | scoped_role_migration | 4 | 3 (2) | pass | no | 1162.1 |
| `nested_private_chain` — Forbidden capability three INHERITS hops down a chain only the subject uses | PASS | PROPOSED | single_cut | 1 | 5 (1) | pass | yes | 1435.2 |
| `inheritance_cycle` — Roles inherit each other in a cycle; traversal must terminate and still cut | PASS | PROPOSED | single_cut | 1 | 4 (1) | pass | yes | 2953.9 |
| `assignment_only` — A dedicated export role shared with a legitimate user; only the subject's assignment goes | PASS | PROPOSED | single_cut | 1 | 3 (1) | pass | no | 1568.5 |
| `two_forbidden_capabilities` — One subject reaches two forbidden capabilities through different roles | PASS | PROPOSED | scoped_role_migration | 5 | 7 (6) | pass | no | 1488.8 |
| `different_keep_sets` — Two subjects keep different capabilities, so they need different scoped roles | PASS | PROPOSED | scoped_role_migration | 8 | 7 (6) | pass | no | 1486.4 |
| `infeasible_requirement` — A required capability the subject never had: CUTLINE must not invent grants | INFEASIBLE_WITHIN_BUDGET | INFEASIBLE_WITHIN_BUDGET | - | 0 | 3 (3) | - | no | 1424.7 |
| `already_safe` — The guardrail already holds: nothing to repair | NO_VIOLATIONS | NO_VIOLATIONS | - | 0 | 0 (0) | - | yes | 147.0 |
| `beyond_depth_bound` — An 8-hop chain beyond the planner's 6-hop bound: only the independent engine sees it | DISAGREEMENT | NO_VIOLATIONS | - | 0 | 0 (0) | - | no | 139.8 |

Safe repair = every forbidden pair denied and every required pair allowed, confirmed by the independent reference engine on the repaired graph. The beyond-bound scenario is reported, not repaired: the planner's FalkorDB traversal is bounded (MAX_DEPTH) and the unbounded independent engine flags the disagreement.
