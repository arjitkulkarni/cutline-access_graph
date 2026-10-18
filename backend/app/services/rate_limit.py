"""Process-local caps for expensive endpoints (the API runs as one process; state lives in FalkorDB)."""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Iterator
from contextlib import contextmanager

from ..errors import RateLimited


class RunLimiter:
    """At most `per_hour` runs in any rolling hour (0 = no hourly cap) and `concurrent` runs at once."""

    def __init__(self, per_hour: int, concurrent: int = 2, window_s: float = 3600.0):
        self.per_hour = per_hour
        self.concurrent = concurrent
        self.window_s = window_s
        self._starts: deque[float] = deque()
        self._slots = threading.BoundedSemaphore(concurrent)
        self._lock = threading.Lock()

    @contextmanager
    def run(self, what: str) -> Iterator[None]:
        if not self._slots.acquire(blocking=False):
            raise RateLimited(f"{self.concurrent} {what}s are already in progress. Try again when one finishes.")
        try:
            with self._lock:
                now = time.monotonic()
                while self._starts and now - self._starts[0] >= self.window_s:
                    self._starts.popleft()
                if self.per_hour and len(self._starts) >= self.per_hour:
                    retry_after = int(self.window_s - (now - self._starts[0])) + 1
                    raise RateLimited(
                        f"This deployment allows {self.per_hour} {what}s per hour. "
                        f"Try again in {retry_after // 60 + 1} min.",
                        {"retry_after_s": retry_after},
                    )
                self._starts.append(now)
            yield
        finally:
            self._slots.release()
