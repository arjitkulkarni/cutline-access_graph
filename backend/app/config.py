from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
DEV_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")


class Settings(BaseSettings):
    """Runtime configuration. Values come from the environment or backend/.env."""

    model_config = SettingsConfigDict(
        env_file=(str(BACKEND_DIR.parent / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # FalkorDB (local Docker or FalkorDB Cloud)
    falkordb_host: str = "localhost"
    falkordb_port: int = 6379
    falkordb_username: str | None = None
    falkordb_password: str | None = None
    falkordb_tls: bool = False
    falkordb_graph: str = "cutline_dev"
    falkordb_connect_timeout: float = 5.0
    falkordb_socket_timeout: float = 15.0

    # Application
    environment: Literal["development", "production"] = "development"
    log_level: str = "INFO"
    demo_mode: bool = True
    backend_port: int = 8000
    demo_api_base_url: str | None = None
    # Comma-separated exact origins. Unset: the localhost console in development, nothing in production.
    cors_origins: str | None = None
    cors_origin_regex: str | None = None  # e.g. Vercel preview deployments

    # Independent enforcement point used by runtime verification
    authz_engine: Literal["reference", "opa"] = "reference"
    opa_url: str | None = None

    # Planner budget (explicit, reported in every plan)
    max_depth: int = 6
    max_candidates: int = 24
    max_cut_size: int = 3
    candidate_workers: int = 4

    # Optional LLM agent (investigates, orchestrates, explains — never the authority on safety)
    anthropic_api_key: str | None = None
    llm_model: str = "claude-opus-5-5"
    llm_effort: Literal["low", "medium", "high", "xhigh", "max"] = "medium"
    llm_max_turns: int = 8

    @field_validator("falkordb_username", "falkordb_password", "opa_url", "anthropic_api_key",
                     "demo_api_base_url", "cors_origins", "cors_origin_regex", mode="before")
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        if isinstance(value, str) and value.strip() == "":
            return None
        return value

    @field_validator("max_depth")
    @classmethod
    def _depth_bounds(cls, value: int) -> int:
        if not 1 <= value <= 10:
            raise ValueError("MAX_DEPTH must be between 1 and 10")
        return value

    @property
    def ledger_graph(self) -> str:
        return f"{self.falkordb_graph}__ledger"

    @property
    def candidate_prefix(self) -> str:
        return f"{self.falkordb_graph}__cand__"

    @property
    def demo_base_url(self) -> str:
        return self.demo_api_base_url or f"http://127.0.0.1:{self.backend_port}"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins is None:
            return [] if self.is_production else list(DEV_ORIGINS)
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
