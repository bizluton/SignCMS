"""
Asset router — upload, download, and metadata endpoints.

POST /assets/upload
    Accepts a multipart file upload.  SHA-256 is computed in memory before any
    disk I/O; if a matching record already exists the existing AssetResponse is
    returned immediately (HTTP 200) without writing a duplicate file.

GET  /assets/file/{sha256}
    Streams the raw file back to the caller.  Suitable for use as a direct
    download URL in the sync manifest.

GET  /assets/{asset_id}
    Returns metadata for a single asset by its UUID primary key.
"""

import hashlib
import re
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import storage
from app.config import settings
from app.database import get_db
from app.models import Asset
from app.schemas import AssetResponse

router = APIRouter(prefix="/assets", tags=["assets"])

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


@router.post(
    "/upload",
    response_model=AssetResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a media asset",
    description=(
        "Accepts a multipart/form-data file upload. "
        "The SHA-256 digest is computed in memory; if a file with the same "
        "digest already exists the existing record is returned (HTTP 200) "
        "and no duplicate file is written to disk."
    ),
    responses={
        200: {"description": "Duplicate detected — returning existing asset"},
        201: {"description": "New asset stored"},
        400: {"description": "Empty file or missing filename"},
        413: {"description": "File exceeds maximum allowed size"},
    },
)
async def upload_asset(
    file: Annotated[UploadFile, File(description="Media file to upload")],
    db: AsyncSession = Depends(get_db),
) -> AssetResponse:
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename is required",
        )

    # ── Read into memory ──────────────────────────────────────────────────────
    content = await file.read()

    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty",
        )

    if len(content) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"File size {len(content):,} bytes exceeds the "
                f"{settings.max_upload_bytes:,}-byte limit"
            ),
        )

    # ── SHA-256 deduplication ─────────────────────────────────────────────────
    sha256 = hashlib.sha256(content).hexdigest()

    result = await db.execute(select(Asset).where(Asset.hash_id == sha256))
    if existing := result.scalar_one_or_none():
        # Return 200 (not 201) to signal "no new resource created"
        from fastapi.responses import JSONResponse

        return JSONResponse(  # type: ignore[return-value]
            status_code=status.HTTP_200_OK,
            content=AssetResponse.model_validate(existing).model_dump(mode="json"),
        )

    # ── Persist file ──────────────────────────────────────────────────────────
    mime = file.content_type or "application/octet-stream"
    url = await storage.save(sha256, content, mime)

    asset = Asset(
        hash_id=sha256,
        filename=file.filename,
        content_type=mime,
        size=len(content),
        url=url,
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)

    return asset  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------


@router.get(
    "/file/{sha256}",
    response_class=FileResponse,
    summary="Download asset by SHA-256",
    responses={
        200: {"description": "Raw file stream"},
        400: {"description": "Invalid hash format"},
        404: {"description": "Asset not found on disk"},
    },
)
async def download_asset(sha256: str) -> FileResponse:
    if not _SHA256_RE.match(sha256):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="sha256 must be 64 lowercase hex characters",
        )

    path = storage.get_path(sha256)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset file not found",
        )

    return FileResponse(path=path)


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------


@router.get(
    "/{asset_id}",
    response_model=AssetResponse,
    summary="Get asset metadata by ID",
    responses={
        200: {"description": "Asset metadata"},
        404: {"description": "Asset not found"},
    },
)
async def get_asset(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
) -> AssetResponse:
    result = await db.execute(select(Asset).where(Asset.id == asset_id))
    asset = result.scalar_one_or_none()
    if asset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset {asset_id!r} not found",
        )
    return asset  # type: ignore[return-value]
