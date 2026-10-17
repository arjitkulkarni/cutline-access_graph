"""Security + business-survival contract.

The default contract is derived from the graph itself: Guardrail nodes produce must_deny pairs and
Workflow nodes produce must_allow pairs. An operator contract (e.g. parsed from natural language)
is merged with the graph-declared workflows, which are treated as invariants.
"""

from __future__ import annotations

from ..errors import ValidationFailed
from ..models.policy import ConstraintPair, Contract, PolicySnapshot


def derive_contract(snap: PolicySnapshot) -> Contract:
    deny: dict[tuple[str, str], ConstraintPair] = {}
    for g in snap.guardrails:
        for principal in g.applies_to:
            for capability in g.forbids:
                deny.setdefault((principal, capability), ConstraintPair(
                    principal=principal, capability=capability, source=f"guardrail:{g.id}"))
    allow: dict[tuple[str, str], ConstraintPair] = {}
    for wf in snap.workflows:
        for principal in wf.performers:
            for capability in wf.requires:
                allow.setdefault((principal, capability), ConstraintPair(
                    principal=principal, capability=capability, source=f"workflow:{wf.id}"))
    return Contract(
        must_deny=[deny[k] for k in sorted(deny)],
        must_allow=[allow[k] for k in sorted(allow)],
    )


def merge_with_graph(operator: Contract, snap: PolicySnapshot) -> Contract:
    """Operator constraints plus the workflows/guardrails declared in the graph."""
    derived = derive_contract(snap)
    deny = {c.pair(): c for c in derived.must_deny}
    allow = {c.pair(): c for c in derived.must_allow}
    for c in operator.must_deny:
        deny[c.pair()] = c
    for c in operator.must_allow:
        allow[c.pair()] = c
    return Contract(must_deny=[deny[k] for k in sorted(deny)], must_allow=[allow[k] for k in sorted(allow)])


def validate_contract(contract: Contract, snap: PolicySnapshot) -> None:
    users, caps = set(snap.users), set(snap.capabilities)
    unknown: list[str] = []
    for c in [*contract.must_deny, *contract.must_allow]:
        if c.principal not in users:
            unknown.append(f"principal '{c.principal}'")
        if c.capability not in caps:
            unknown.append(f"capability '{c.capability}'")
    if unknown:
        raise ValidationFailed("Contract references entities that are not in the policy graph: " + ", ".join(sorted(set(unknown))))
    conflicts = contract.deny_pairs() & contract.allow_pairs()
    if conflicts:
        pretty = ", ".join(f"{u}:{c}" for u, c in sorted(conflicts))
        raise ValidationFailed(
            f"Contract is contradictory — the same access is both forbidden and required: {pretty}",
            {"conflicts": [{"principal": u, "capability": c} for u, c in sorted(conflicts)]},
        )
    if not contract.must_deny:
        raise ValidationFailed("Contract has no must_deny constraint; there is nothing to repair.")


def workflow_for(contract: Contract, principal: str, capability: str) -> str | None:
    for c in contract.must_allow:
        if c.principal == principal and c.capability == capability and c.source.startswith("workflow:"):
            return c.source.split(":", 1)[1]
    return None
