"""Natural language → typed contract, with every mapping explained.

The parser only proposes a contract; the operator must confirm it before planning. Entity names
are resolved against the live graph (users, departments, capabilities), never invented.
"""

from __future__ import annotations

import re

from ..models.policy import ConstraintPair, Contract, ParseResponse, PolicySnapshot

DENY_MARKERS = ("remove", "revoke", "block", "deny", "prevent", "stop", "must not", "mustn't", "should not",
                "shouldn't", "cannot", "can't", "never", "no longer", "forbid", "take away", "strip", "disable",
                "cut off", "lose")
ALLOW_MARKERS = ("keep", "preserve", "retain", "maintain", "still", "continue", "allow", "need", "require",
                 "ensure", "must be able", "should be able")
CAPABILITY_HINTS = {
    "export_customers": ("export", "customer data", "customer records", "raw customer", "bulk"),
    "view_orders": ("order lookup", "look up orders", "lookup orders", "view orders", "orders", "order"),
    "generate_reports": ("report", "reporting"),
}
GROUP_WORDS = ("agents", "agent", "staff", "team", "users", "people")
SPLIT = re.compile(
    r"[.;\n]|,?\s+but\s+|,?\s+while\s+|,?\s+and\s+(?=(?:keep|preserve|retain|maintain|allow|ensure|remove|revoke|"
    r"block|deny|prevent|stop)\b)",
    re.IGNORECASE,
)


def _has(text: str, phrase: str) -> bool:
    """Whole-word match that tolerates simple inflections (report → reports, reporting)."""
    return re.search(rf"(?<![a-z]){re.escape(phrase)}(?:s|es|ed|ing)?(?![a-z])", text) is not None


def _capabilities(clause: str, snap: PolicySnapshot) -> list[str]:
    found = []
    for cap in snap.capabilities:
        node = snap.nodes[cap]
        hints = (*CAPABILITY_HINTS.get(cap, ()), node.label.lower(), cap.replace("_", " "))
        if any(_has(clause, h) for h in hints):
            found.append(cap)
    return found


def _principals(clause: str, snap: PolicySnapshot, notes: list[str]) -> list[str]:
    found: list[str] = []
    for uid in snap.users:
        node = snap.nodes[uid]
        names = {uid.replace("_", " "), node.label.lower(), *node.label.lower().split()}
        if any(len(n) > 2 and _has(clause, n) for n in names):
            found.append(uid)
    departments = sorted({str(snap.nodes[u].props.get("department")) for u in snap.users
                          if snap.nodes[u].props.get("department")})
    for dept in departments:
        if _has(clause, dept):
            members = [u for u in snap.users if snap.nodes[u].props.get("department") == dept]
            humans = [u for u in members if snap.nodes[u].props.get("principal_type") == "human"]
            # "support" in a restriction means the people doing support work, not service identities
            chosen = humans or members
            skipped = sorted(set(members) - set(chosen))
            for u in chosen:
                if u not in found:
                    found.append(u)
            if skipped:
                names = ", ".join(snap.nodes[u].label for u in skipped)
                notes.append(f"Read '{dept}' as its human members; service identities ({names}) were not included.")
    return found


def parse_rules(text: str, snap: PolicySnapshot) -> ParseResponse:
    notes: list[str] = []
    unresolved: list[str] = []
    deny: dict[tuple[str, str], ConstraintPair] = {}
    allow: dict[tuple[str, str], ConstraintPair] = {}
    previous: list[str] = []
    for raw in SPLIT.split(text):
        clause = (raw or "").strip().lower()
        if len(clause) < 3:
            continue
        caps = _capabilities(clause, snap)
        principals = _principals(clause, snap, notes)
        if not principals and previous and (caps or re.search(r"\b(their|them|they)\b", clause)):
            principals = previous
        polarity = "deny" if any(_has(clause, m) for m in DENY_MARKERS) else (
            "allow" if any(_has(clause, m) for m in ALLOW_MARKERS) else None)
        if not caps or not principals or polarity is None:
            unresolved.append(raw.strip())
            continue
        target = deny if polarity == "deny" else allow
        for p in principals:
            for c in caps:
                target[(p, c)] = ConstraintPair(principal=p, capability=c, source="operator")
        previous = principals
    for pair in set(deny) & set(allow):
        allow.pop(pair)
        notes.append(f"'{pair[0]} → {pair[1]}' appeared as both forbidden and required; kept it forbidden.")
    contract = Contract(must_deny=[deny[k] for k in sorted(deny)], must_allow=[allow[k] for k in sorted(allow)])
    if snap.workflows:
        names = ", ".join(w.name for w in snap.workflows)
        notes.append(f"Workflows declared in the graph are always preserved as well: {names}.")
    return ParseResponse(contract=contract, notes=notes, unresolved=unresolved, parser="rules")
