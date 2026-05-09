"""
Pydantic v2 schemas for request / response validation.

All schemas use:
  - ``model_config = ConfigDict(strict=True)`` — no implicit type coercion.
  - ``from_attributes=True`` on response schemas — maps SQLAlchemy ORM objects
    to Pydantic models without manual conversion.
"""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Shared type aliases
# ---------------------------------------------------------------------------

Sha256Hex = Annotated[
    str,
    Field(
        min_length=64,
        max_length=64,
        pattern=r"^[0-9a-f]{64}$",
        description="Lowercase SHA-256 hex digest (64 chars)",
    ),
]

NonNegativeInt = Annotated[int, Field(ge=0)]


# ---------------------------------------------------------------------------
# Asset schemas
# ---------------------------------------------------------------------------


class AssetResponse(BaseModel):
    """Returned by upload and GET-by-ID endpoints."""

    model_config = ConfigDict(from_attributes=True, strict=True)

    id: str = Field(description="UUID primary key")
    hash_id: Sha256Hex = Field(description="SHA-256 hex digest of the file content")
    filename: str = Field(description="Original filename")
    content_type: str = Field(description="MIME type")
    size: NonNegativeInt = Field(description="File size in bytes")
    url: str = Field(description="Public download URL")
    created_at: datetime = Field(description="UTC timestamp when first uploaded")


# ---------------------------------------------------------------------------
# Sync-manifest schemas
# ---------------------------------------------------------------------------


class SyncManifestItem(BaseModel):
    """One entry in the playlist manifest — what the player needs to cache."""

    model_config = ConfigDict(strict=True)

    url: str = Field(description="Public download URL for this asset")
    sha256: Sha256Hex = Field(description="SHA-256 hex digest — used as cache key")
    size: NonNegativeInt = Field(description="File size in bytes")
    filename: str = Field(description="Original filename")
    content_type: str = Field(description="MIME type")


class SyncManifest(BaseModel):
    """
    Response for the ``GET /manifest/{playlist_id}`` endpoint.

    Players download this manifest on startup, diff it against their local
    Content-Addressable Storage, and fetch only the missing assets.
    """

    model_config = ConfigDict(strict=True)

    playlist_id: str = Field(description="The playlist this manifest was built for")
    generated_at: datetime = Field(description="UTC timestamp of manifest generation")
    asset_count: NonNegativeInt = Field(description="Total number of assets")
    assets: list[SyncManifestItem] = Field(description="Ordered list of assets to cache")
