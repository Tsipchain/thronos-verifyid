"""
Database-backed storage service.

Replaces the external OSS (Object Storage Service) dependency with
PostgreSQL.  Files are stored as raw bytes (LargeBinary / bytea) in the
file_storage table.  The upload/download "presigned URL" pattern is
emulated using one-time UUID tokens:

  upload_token  → PUT  /api/v1/storage/ingest/{upload_token}
  serve_token   → GET  /api/v1/storage/serve/{serve_token}

This way the SDK contract (request upload URL → PUT file → request
download URL → GET file) is preserved without any external service.
"""
import logging
import mimetypes
import os
import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from models.file_storage import FileStorage
from schemas.storage import (
    BucketInfo,
    BucketListResponse,
    BucketRequest,
    BucketResponse,
    DeleteResponse,
    FileUpDownRequest,
    FileUpDownResponse,
    ObjectInfo,
    ObjectListResponse,
    ObjectRequest,
    OSSBaseModel,
    RenameRequest,
    RenameResponse,
)

logger = logging.getLogger(__name__)

_URL_TTL_HOURS = 1  # "presigned" URLs expire after 1 hour (informational only)


def _public_base_url() -> str:
    """Return the public base URL of this backend (no trailing slash).

    Priority:
      1. PYTHON_BACKEND_URL env var (set by Railway / user)
      2. RAILWAY_PUBLIC_DOMAIN env var (auto-injected by Railway)
      3. Fallback to localhost (works for local dev, not for external callers)
    """
    # PYTHON_BACKEND_URL may accidentally contain multiple comma-separated
    # origins (copy-paste from CORS_ALLOW_ORIGINS).  Always use the first.
    if raw := os.environ.get("PYTHON_BACKEND_URL", ""):
        url = raw.split(",")[0].strip().rstrip("/")
        if url:
            return url
    if domain := os.environ.get("RAILWAY_PUBLIC_DOMAIN", ""):
        return f"https://{domain.rstrip('/')}"
    return "http://localhost:8000"


class StorageService:
    """Database-backed file storage — no external OSS service required."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Bucket operations (logical; buckets exist only as label on rows) ──────

    async def create_bucket(self, request: BucketRequest) -> BucketResponse:
        """Buckets are virtual (just the bucket_name label on file rows)."""
        return BucketResponse(
            bucket_name=request.bucket_name,
            visibility=request.visibility,
            created_at=datetime.now().isoformat(sep=" ", timespec="seconds"),
        )

    async def list_buckets(self) -> BucketListResponse:
        """Return distinct bucket names present in file_storage."""
        from sqlalchemy import func, distinct
        stmt = select(FileStorage.bucket_name).distinct()
        result = await self.db.execute(stmt)
        rows = result.scalars().all()
        return BucketListResponse(
            buckets=[BucketInfo(bucket_name=b, visibility="private") for b in rows]
        )

    async def list_objects(self, request: OSSBaseModel) -> ObjectListResponse:
        stmt = (
            select(FileStorage)
            .where(
                FileStorage.bucket_name == request.bucket_name,
                FileStorage.uploaded == True,
            )
            .order_by(FileStorage.created_at.desc())
        )
        result = await self.db.execute(stmt)
        rows = result.scalars().all()
        return ObjectListResponse(
            objects=[
                ObjectInfo(
                    bucket_name=r.bucket_name,
                    object_key=r.object_key,
                    size=r.size_bytes or 0,
                    last_modified=r.created_at.isoformat(sep=" ", timespec="seconds"),
                    etag=r.serve_token[:8],
                )
                for r in rows
            ]
        )

    async def get_object_info(self, request: ObjectRequest) -> ObjectInfo:
        row = await self._get_row(request.bucket_name, request.object_key)
        if not row or not row.uploaded:
            raise ValueError(f"Object not found: {request.bucket_name}/{request.object_key}")
        return ObjectInfo(
            bucket_name=row.bucket_name,
            object_key=row.object_key,
            size=row.size_bytes or 0,
            last_modified=row.created_at.isoformat(sep=" ", timespec="seconds"),
            etag=row.serve_token[:8],
        )

    async def rename_object(self, request: RenameRequest) -> RenameResponse:
        row = await self._get_row(request.bucket_name, request.source_key)
        if not row:
            raise ValueError(f"Source object not found: {request.source_key}")
        row.object_key = request.target_key
        await self.db.commit()
        return RenameResponse(success=True)

    async def delete_object(self, request: ObjectRequest) -> DeleteResponse:
        stmt = delete(FileStorage).where(
            FileStorage.bucket_name == request.bucket_name,
            FileStorage.object_key == request.object_key,
        )
        await self.db.execute(stmt)
        await self.db.commit()
        return DeleteResponse(success=True)

    # ── Upload / download URL generation ─────────────────────────────────────

    async def create_upload_url(self, request: FileUpDownRequest) -> FileUpDownResponse:
        """Create (or replace) a DB row and return a one-time upload URL."""
        upload_token = str(uuid.uuid4())
        serve_token = str(uuid.uuid4())
        expires_at = datetime.now() + timedelta(hours=_URL_TTL_HOURS)

        # Upsert: if (bucket_name, object_key) already exists, regenerate tokens
        existing = await self._get_row(request.bucket_name, request.object_key)
        if existing:
            existing.upload_token = upload_token
            existing.serve_token = serve_token
            existing.uploaded = False
            existing.data = None
            existing.expires_at = expires_at
        else:
            row = FileStorage(
                bucket_name=request.bucket_name,
                object_key=request.object_key,
                upload_token=upload_token,
                serve_token=serve_token,
                expires_at=expires_at,
            )
            self.db.add(row)

        await self.db.commit()

        base = _public_base_url()
        upload_url = f"{base}/api/v1/storage/ingest/{upload_token}"
        return FileUpDownResponse(
            upload_url=upload_url,
            expires_at=expires_at.isoformat(sep=" ", timespec="seconds"),
        )

    async def create_download_url(self, request: FileUpDownRequest) -> FileUpDownResponse:
        """Return a serve URL for an already-uploaded object."""
        row = await self._get_row(request.bucket_name, request.object_key)
        if not row:
            raise ValueError(f"Object not found: {request.bucket_name}/{request.object_key}")

        base = _public_base_url()
        download_url = f"{base}/api/v1/storage/serve/{row.serve_token}"
        return FileUpDownResponse(
            download_url=download_url,
            expires_at=(row.expires_at or datetime.now()).isoformat(sep=" ", timespec="seconds"),
        )

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _get_row(self, bucket_name: str, object_key: str):
        stmt = select(FileStorage).where(
            FileStorage.bucket_name == bucket_name,
            FileStorage.object_key == object_key,
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
