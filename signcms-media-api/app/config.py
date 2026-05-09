from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables / .env file.
    All fields are strictly typed via Pydantic v2.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:///./signcms_media.db"

    # ── Storage ───────────────────────────────────────────────────────────────
    storage_path: Path = Path("./storage")

    # Public base URL — included in download URLs returned by the API.
    # In production set this to your reverse-proxy / CDN origin.
    base_url: str = "http://localhost:8000"

    # ── File upload limits ────────────────────────────────────────────────────
    # Maximum allowed upload size in bytes (default: 256 MiB)
    max_upload_bytes: int = 256 * 1024 * 1024

    @field_validator("base_url")
    @classmethod
    def strip_trailing_slash(cls, v: str) -> str:
        return v.rstrip("/")


settings = Settings()
