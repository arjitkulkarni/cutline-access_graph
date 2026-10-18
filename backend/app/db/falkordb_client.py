"""Thin, failure-aware wrapper around the official falkordb-py client.

Every graph operation in CUTLINE goes through `FalkorClient.query`, which converts transport
failures into `FalkorUnavailable` (HTTP 503). There is deliberately no fallback store: when
FalkorDB is unreachable the analysis and repair workflow is unavailable.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from falkordb import FalkorDB
from falkordb.graph import Graph
from falkordb.query_result import QueryResult
from redis.backoff import ExponentialBackoff
from redis.exceptions import AuthenticationError, ConnectionError as RedisConnectionError
from redis.exceptions import RedisError, ResponseError
from redis.exceptions import TimeoutError as RedisTimeoutError
from redis.retry import Retry

from ..config import Settings
from ..errors import FalkorUnavailable, GraphQueryError

log = logging.getLogger("cutline.falkordb")


class FalkorClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._db: FalkorDB | None = None
        self._lock = threading.Lock()
        self.last_error: str | None = None

    # ------------------------------------------------------------------ connection
    def _connect(self) -> FalkorDB:
        s = self.settings
        tls: dict[str, Any] = {}
        if s.falkordb_tls:
            # redis-py verifies the certificate chain by default but not the hostname
            tls = {"ssl_check_hostname": s.falkordb_tls_check_hostname, "ssl_ca_data": s.falkordb_tls_ca_cert}
        return FalkorDB(
            host=s.falkordb_host,
            port=s.falkordb_port,
            username=s.falkordb_username,
            password=s.falkordb_password,
            ssl=s.falkordb_tls,
            **tls,
            socket_connect_timeout=s.falkordb_connect_timeout,
            socket_timeout=s.falkordb_socket_timeout,
            retry=Retry(ExponentialBackoff(cap=0.5, base=0.1), 1),
            client_name="cutline",
        )

    def db(self) -> FalkorDB:
        if self._db is not None:
            return self._db
        with self._lock:
            if self._db is None:
                try:
                    self._db = self._connect()
                    self.last_error = None
                except Exception as exc:  # noqa: BLE001 - normalise every connect failure
                    raise self._unavailable(exc) from exc
        return self._db

    def reset(self) -> None:
        with self._lock:
            if self._db is not None:
                self._db.close()
            self._db = None

    def _unavailable(self, exc: Exception) -> FalkorUnavailable:
        s = self.settings
        where = s.falkordb_public_address
        if isinstance(exc, AuthenticationError) or "NOAUTH" in str(exc) or "WRONGPASS" in str(exc):
            msg = (
                f"FalkorDB at {where} rejected the connection "
                "(authentication required or invalid). Set FALKORDB_USERNAME and FALKORDB_PASSWORD."
            )
        else:
            # redis-py names the host in its own messages; keep it out of public responses in production
            detail = str(exc).replace(s.falkordb_host, s.falkordb_public_host)
            msg = f"FalkorDB at {where} is unreachable: {exc.__class__.__name__}: {detail}"
        self.last_error = msg
        return FalkorUnavailable(msg, {"host": s.falkordb_public_host, "port": s.falkordb_port})

    def _no_module(self) -> FalkorUnavailable:
        s = self.settings
        msg = (f"{s.falkordb_public_address} is a Redis server without the FalkorDB module (GRAPH.* commands "
               "are unknown). Point FALKORDB_HOST/FALKORDB_PORT at FalkorDB — Docker falkordb/falkordb or FalkorDB Cloud.")
        self.last_error = msg
        return FalkorUnavailable(msg, {"host": s.falkordb_public_host, "port": s.falkordb_port})

    def _response_error(self, exc: ResponseError, graph: str | None) -> Exception:
        text = str(exc)
        if "unknown command" in text.lower() and "graph." in text.lower():
            return self._no_module()
        return GraphQueryError(f"FalkorDB rejected a query on graph '{graph}': {text}", {"graph": graph})

    def ping(self) -> float:
        """Round-trip latency in milliseconds; also proves the FalkorDB module is loaded."""
        started = time.perf_counter()
        try:
            self.db().connection.ping()
            latency = round((time.perf_counter() - started) * 1000, 1)
            self.db().list_graphs()
        except FalkorUnavailable:
            raise
        except ResponseError as exc:
            raise self._response_error(exc, None) from exc
        except RedisError as exc:
            self.reset()
            raise self._unavailable(exc) from exc
        self.last_error = None
        return latency

    # ------------------------------------------------------------------ graphs
    def graph(self, name: str) -> Graph:
        return self.db().select_graph(name)

    def query(self, graph: str, cypher: str, params: dict[str, Any] | None = None, *, read_only: bool = False) -> QueryResult:
        g = self.graph(graph)
        try:
            if read_only:
                return g.ro_query(cypher, params=params)
            return g.query(cypher, params=params)
        except (RedisConnectionError, RedisTimeoutError, AuthenticationError) as exc:
            self.reset()
            raise self._unavailable(exc) from exc
        except ResponseError as exc:
            raise self._response_error(exc, graph) from exc

    def rows(self, graph: str, cypher: str, params: dict[str, Any] | None = None, *, read_only: bool = True) -> list[list[Any]]:
        return self.query(graph, cypher, params, read_only=read_only).result_set

    def list_graphs(self) -> list[str]:
        try:
            return list(self.db().list_graphs())
        except (RedisConnectionError, RedisTimeoutError, AuthenticationError) as exc:
            self.reset()
            raise self._unavailable(exc) from exc
        except ResponseError as exc:
            raise self._response_error(exc, None) from exc

    def graph_exists(self, name: str) -> bool:
        return name in self.list_graphs()

    def delete_graph(self, name: str) -> bool:
        """Delete a graph if it exists. Returns True when something was deleted."""
        try:
            self.graph(name).delete()
            return True
        except ResponseError as exc:
            if "unknown command" in str(exc).lower():
                raise self._no_module() from exc
            return False  # graph did not exist
        except (RedisConnectionError, RedisTimeoutError, AuthenticationError) as exc:
            self.reset()
            raise self._unavailable(exc) from exc

    def copy_graph(self, source: str, destination: str) -> None:
        """GRAPH.COPY source destination (raises ResponseError if unsupported)."""
        try:
            self.graph(source).copy(destination)
        except (RedisConnectionError, RedisTimeoutError, AuthenticationError) as exc:
            self.reset()
            raise self._unavailable(exc) from exc
