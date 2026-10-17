"""Ten synthetic authorization scenarios with known correct outcomes."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Scenario:
    name: str
    description: str
    assign: list[tuple[str, str]]
    inherits: list[tuple[str, str]] = field(default_factory=list)
    grants: list[tuple[str, str]] = field(default_factory=list)
    deny: list[tuple[str, str]] = field(default_factory=list)
    allow: list[tuple[str, str]] = field(default_factory=list)
    expect: str = "PASS"                 # PASS | NO_VIOLATIONS | INFEASIBLE_WITHIN_BUDGET | DISAGREEMENT
    expect_family: str | None = None

    @property
    def users(self) -> list[str]:
        return sorted({u for u, _ in self.assign} | {u for u, _ in self.deny} | {u for u, _ in self.allow})

    @property
    def roles(self) -> list[str]:
        return sorted({r for _, r in self.assign} | {r for e in self.inherits for r in e} | {r for r, _ in self.grants})

    @property
    def capabilities(self) -> list[str]:
        return sorted({c for _, c in self.grants} | {c for _, c in self.deny} | {c for _, c in self.allow})


SCENARIOS: list[Scenario] = [
    Scenario(
        "two_paths_shared_roles", "The demo: two inherited paths, Finance and a DSAR bot depend on the same roles",
        assign=[("maya", "support"), ("noah", "support"), ("bot", "support"), ("felix", "finance")],
        inherits=[("support", "shared_ops"), ("support", "export_helper"), ("finance", "shared_ops")],
        grants=[("support", "view_orders"), ("support", "reports"), ("shared_ops", "export"), ("export_helper", "export")],
        deny=[("maya", "export"), ("noah", "export")],
        allow=[("maya", "view_orders"), ("maya", "reports"), ("noah", "view_orders"), ("noah", "reports"),
               ("felix", "export"), ("bot", "export")],
        expect_family="scoped_role_migration",
    ),
    Scenario(
        "bundled_direct_role", "Needed and forbidden capability bundled in one role another principal relies on",
        assign=[("ana", "ops"), ("ben", "ops")],
        grants=[("ops", "read"), ("ops", "export")],
        deny=[("ana", "export")], allow=[("ana", "read"), ("ben", "export")],
        expect_family="scoped_role_migration",
    ),
    Scenario(
        "nested_private_chain", "Forbidden capability three INHERITS hops down a chain only the subject uses",
        assign=[("u", "r1")], inherits=[("r1", "r2"), ("r2", "r3")],
        grants=[("r1", "read"), ("r3", "export")],
        deny=[("u", "export")], allow=[("u", "read")],
        expect_family="single_cut",
    ),
    Scenario(
        "inheritance_cycle", "Roles inherit each other in a cycle; traversal must terminate and still cut",
        assign=[("u", "r1")], inherits=[("r1", "r2"), ("r2", "r1")],
        grants=[("r1", "read"), ("r2", "export")],
        deny=[("u", "export")], allow=[("u", "read")],
        expect_family="single_cut",
    ),
    Scenario(
        "assignment_only", "A dedicated export role shared with a legitimate user; only the subject's assignment goes",
        assign=[("u", "exporter"), ("u", "base"), ("v", "exporter")],
        grants=[("exporter", "export"), ("base", "read")],
        deny=[("u", "export")], allow=[("u", "read"), ("v", "export")],
        expect_family="single_cut",
    ),
    Scenario(
        "two_forbidden_capabilities", "One subject reaches two forbidden capabilities through different roles",
        assign=[("u", "r"), ("u", "s"), ("v", "r")],
        grants=[("r", "read"), ("r", "export"), ("s", "delete")],
        deny=[("u", "export"), ("u", "delete")], allow=[("u", "read"), ("v", "export")],
        expect_family="scoped_role_migration",
    ),
    Scenario(
        "different_keep_sets", "Two subjects keep different capabilities, so they need different scoped roles",
        assign=[("u1", "r"), ("u2", "s"), ("v", "r"), ("v", "s")],
        grants=[("r", "read"), ("r", "export"), ("s", "write"), ("s", "export")],
        deny=[("u1", "export"), ("u2", "export")], allow=[("u1", "read"), ("u2", "write"), ("v", "export")],
        expect_family="scoped_role_migration",
    ),
    Scenario(
        "infeasible_requirement", "A required capability the subject never had: CUTLINE must not invent grants",
        assign=[("u", "r")], grants=[("r", "read"), ("r", "export"), ("q", "write")],
        deny=[("u", "export")], allow=[("u", "write")],
        expect="INFEASIBLE_WITHIN_BUDGET",
    ),
    Scenario(
        "already_safe", "The guardrail already holds: nothing to repair",
        assign=[("u", "r"), ("v", "x")], grants=[("r", "read"), ("x", "export")],
        deny=[("u", "export")], allow=[("u", "read")],
        expect="NO_VIOLATIONS",
    ),
    Scenario(
        "beyond_depth_bound", "An 8-hop chain beyond the planner's 6-hop bound: only the independent engine sees it",
        assign=[("u", "r0")], inherits=[(f"r{i}", f"r{i + 1}") for i in range(8)],
        grants=[("r0", "read"), ("r8", "export")],
        deny=[("u", "export")], allow=[("u", "read")],
        expect="DISAGREEMENT",
    ),
]
