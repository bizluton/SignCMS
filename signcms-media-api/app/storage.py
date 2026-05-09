"""
Local-disk file storage.

Files are stored in a two-level directory tree keyed by their SHA-256 digest,
mirroring Git's object store layout:

    storage/
      ab/
        abcdef1234...   ← full 64-char hex name
      ff/
        ff00112233...

This keeps any single directory to at most 256 entries and makes bulk
iteration / deletion straightforward.
"""

from pathlib import Path

import aiofiles
import aiofiles.os

from app.config import settings


def _file_path(sha256: str) -> Path:
    """Return the absolute path for a given SHA-256 digest."""
    return settings.storage_path / sha256[:2] / sha256


async def save(sha256: str, content: bytes, _content_type: str) -> str:
    """
    Persist *content* to disk under its SHA-256 key and return the public URL.

    This function is idempotent: if the file already exists (e.g. after a
    crash between the DB write and the disk write) it is silently overwritten.
    """
    path = _file_path(sha256)
    await aiofiles.os.makedirs(path.parent, exist_ok=True)

    async with aiofiles.open(path, "wb") as fh:
        await fh.write(content)

    return f"{settings.base_url}/assets/file/{sha256}"


def get_path(sha256: str) -> Path:
    """Return the filesystem path for an asset (does not check existence)."""
    return _file_path(sha256)


async def exists(sha256: str) -> bool:
    """Return True if the file is present on disk."""
    return _file_path(sha256).is_file()


async def delete(sha256: str) -> None:
    """Remove the file from disk. No-op if already absent."""
    path = _file_path(sha256)
    try:
        await aiofiles.os.remove(path)
    except FileNotFoundError:
        pass
