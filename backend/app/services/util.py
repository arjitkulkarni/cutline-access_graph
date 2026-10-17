from __future__ import annotations

import secrets
from datetime import datetime, timezone


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(4)}"


def plural(n: int, word: str, many: str | None = None) -> str:
    """plural(1, "edit") -> "1 edit"; plural(2, "edit") -> "2 edits"."""
    return f"{n} {word if n == 1 else (many or word + 's')}"
