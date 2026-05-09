import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Asset(Base):
    """
    Persisted media asset record.

    ``hash_id`` stores the hex-encoded SHA-256 digest of the file content and
    acts as the deduplication key.  A unique index is declared both via the
    column ``unique=True`` flag (DDL constraint) and an explicit ``Index``
    (gives us a named index usable in migrations / query plans).
    """

    __tablename__ = "assets"

    # ── Primary key ───────────────────────────────────────────────────────────
    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
        doc="UUID primary key",
    )

    # ── Content-addressable identity ─────────────────────────────────────────
    hash_id: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,           # DB-level UNIQUE constraint
        doc="SHA-256 hex digest of the file content (64 hex chars)",
    )

    # ── File metadata ─────────────────────────────────────────────────────────
    filename: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        doc="Original filename provided by the uploader",
    )
    content_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        doc="MIME type (e.g. image/jpeg, video/mp4)",
    )
    size: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
        doc="File size in bytes",
    )
    url: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        doc="Public download URL",
    )

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # ── Indexes ───────────────────────────────────────────────────────────────
    __table_args__ = (
        # Named unique index on hash_id — fast lookup during dedup check.
        Index("uix_assets_hash_id", "hash_id", unique=True),
    )

    def __repr__(self) -> str:
        return f"<Asset id={self.id!r} hash_id={self.hash_id[:12]}… size={self.size}>"
