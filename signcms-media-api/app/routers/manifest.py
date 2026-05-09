"""
Sync-manifest router.

GET /manifest/{playlist_id}

Returns a JSON document listing every asset that belongs to the given playlist,
with its SHA-256 digest and public download URL.

Players (Android / Electron) download this on startup and use it to diff their
local Content-Addressable Storage (CAS) against the server state, then fetch
only the files they don't yet have cached.

Manifest item format:
    {
        "url":          "https://host/assets/file/<sha256>",
        "sha256":       "<64-char hex>",
        "size":         <bytes>,
        "filename":     "<original name>",
        "content_type": "video/mp4"
    }

TODO: Once a playlist → asset join table exists, filter assets by playlist_id.
      The current implementation returns all assets and is suitable for
      single-playlist / proof-of-concept deployments.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Asset
from app.schemas import SyncManifest, SyncManifestItem

router = APIRouter(prefix="/manifest", tags=["manifest"])


@router.get(
    "/{playlist_id}",
    response_model=SyncManifest,
    summary="Get sync manifest for a playlist",
    description=(
        "Returns the complete list of asset hashes and download URLs for the "
        "specified playlist.  Players use this to determine which files to "
        "fetch or evict from their local cache."
    ),
    responses={
        200: {"description": "Manifest generated successfully"},
        404: {"description": "Playlist not found (future: when playlist table exists)"},
    },
)
async def sync_manifest(
    playlist_id: str,
    db: AsyncSession = Depends(get_db),
) -> SyncManifest:
    # ── Fetch assets ──────────────────────────────────────────────────────────
    # TODO: JOIN with a playlist_assets table once that relationship is modelled.
    #       For now we return all assets, ordered by creation time so the
    #       manifest is deterministic across calls.
    result = await db.execute(
        select(Asset).order_by(Asset.created_at.asc())
    )
    assets = result.scalars().all()

    items: list[SyncManifestItem] = [
        SyncManifestItem(
            url=a.url,
            sha256=a.hash_id,
            size=a.size,
            filename=a.filename,
            content_type=a.content_type,
        )
        for a in assets
    ]

    return SyncManifest(
        playlist_id=playlist_id,
        generated_at=datetime.now(timezone.utc),
        asset_count=len(items),
        assets=items,
    )
