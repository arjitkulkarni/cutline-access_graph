from __future__ import annotations

from typing import Any


class CutlineError(Exception):
    """Base error rendered as {"error": {"code", "message", "details"}}."""

    status_code = 500
    code = "INTERNAL"

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}

    def to_body(self) -> dict[str, Any]:
        body: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            body["details"] = self.details
        return {"error": body}


class FalkorUnavailable(CutlineError):
    status_code = 503
    code = "FALKORDB_UNAVAILABLE"


class GraphQueryError(CutlineError):
    status_code = 500
    code = "GRAPH_QUERY_ERROR"


class NotFound(CutlineError):
    status_code = 404
    code = "NOT_FOUND"


class StaleProposal(CutlineError):
    status_code = 409
    code = "STALE_PROPOSAL"


class NotVerified(CutlineError):
    status_code = 409
    code = "NOT_VERIFIED"


class NotApproved(CutlineError):
    status_code = 409
    code = "NOT_APPROVED"


class InvalidState(CutlineError):
    status_code = 409
    code = "INVALID_STATE"


class ValidationFailed(CutlineError):
    status_code = 422
    code = "VALIDATION_ERROR"


class DemoModeDisabled(CutlineError):
    status_code = 403
    code = "DEMO_MODE_DISABLED"


class AuthzEngineUnavailable(CutlineError):
    status_code = 503
    code = "AUTHZ_ENGINE_UNAVAILABLE"
