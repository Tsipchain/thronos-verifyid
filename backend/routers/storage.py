import logging
import mimetypes

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies.auth import get_admin_user, get_current_user
from dependencies.database import get_db
from models.file_storage import FileStorage
from schemas.auth import UserResponse
from schemas.storage import (
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
from services.storage import StorageService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/storage", tags=["storage"])


# ── Bucket operations ─────────────────────────────────────────────────────────

@router.post("/create-bucket", response_model=BucketResponse)
async def create_bucket(
    request: BucketRequest,
    _current_user: UserResponse = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a (virtual) bucket."""
    try:
        service = StorageService(db)
        return await service.create_bucket(request)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create bucket: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/list-buckets", response_model=BucketListResponse)
async def list_buckets(
    _current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        service = StorageService(db)
        return await service.list_buckets()
    except Exception as e:
        logger.error(f"Failed to list buckets: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/list-objects", response_model=ObjectListResponse)
async def list_objects(
    request: OSSBaseModel = Depends(),
    _current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        service = StorageService(db)
        return await service.list_objects(request)
    except Exception as e:
        logger.error(f"Failed to list objects: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("/get-object-info", response_model=ObjectInfo)
async def get_object_info(
    request: ObjectRequest = Depends(),
    _current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        service = StorageService(db)
        return await service.get_object_info(request)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to get object info: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/rename-object", response_model=RenameResponse)
async def rename_object(
    request: RenameRequest,
    _current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        service = StorageService(db)
        return await service.rename_object(request)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to rename object: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.delete("/delete-object", response_model=DeleteResponse)
async def delete_object(
    request: ObjectRequest,
    _current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        service = StorageService(db)
        return await service.delete_object(request)
    except Exception as e:
        logger.error(f"Failed to delete object: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ── Presigned-style URL generation ───────────────────────────────────────────

@router.post("/upload-url", response_model=FileUpDownResponse)
async def upload_file(
    request: FileUpDownRequest,
    _current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get a one-time upload URL for storing a file in the database.

    Steps:
    1. Client calls this endpoint with bucket_name + object_key
    2. Server creates a DB row and returns a unique upload URL
    3. Client PUTs the raw file bytes to that URL
    4. File is stored in PostgreSQL — no external service needed
    """
    try:
        service = StorageService(db)
        return await service.create_upload_url(request)
    except ValueError as e:
        logger.error(f"Invalid upload request: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to generate upload URL: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/download-url", response_model=FileUpDownResponse)
async def download_file(
    request: FileUpDownRequest,
    _current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a serve URL for downloading a previously uploaded file."""
    try:
        service = StorageService(db)
        return await service.create_download_url(request)
    except ValueError as e:
        logger.error(f"Object not found: {e}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to generate download URL: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ── Ingest (receive file bytes) ───────────────────────────────────────────────

@router.put("/ingest/{upload_token}", include_in_schema=False)
async def ingest_file(
    upload_token: str,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Receive raw file bytes uploaded by the client using the one-time
    upload_token obtained from /upload-url.

    No authentication required — the upload_token itself is the credential
    (a UUID that is unguessable and single-use).
    """
    stmt = select(FileStorage).where(FileStorage.upload_token == upload_token)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()

    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid or expired upload token.")

    if row.uploaded:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="File already uploaded.")

    try:
        data = await http_request.body()
    except Exception as e:
        logger.error(f"Failed to read upload body: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not read file data.")

    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file body.")

    content_type, _ = mimetypes.guess_type(row.object_key)
    row.data = data
    row.size_bytes = len(data)
    row.content_type = content_type or "application/octet-stream"
    row.uploaded = True

    await db.commit()
    logger.info("File ingested: bucket=%s key=%s size=%d", row.bucket_name, row.object_key, len(data))
    return {"status": "ok", "size_bytes": len(data)}


# ── Serve (return file bytes) ─────────────────────────────────────────────────

@router.get("/serve/{serve_token}", include_in_schema=False)
async def serve_file(
    serve_token: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Serve a previously uploaded file identified by its serve_token.

    No authentication required — the serve_token (UUID) acts as the
    access credential, matching the S3 presigned-URL security model.
    """
    stmt = select(FileStorage).where(FileStorage.serve_token == serve_token)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()

    if not row or not row.uploaded or not row.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found.")

    return Response(
        content=row.data,
        media_type=row.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'inline; filename="{row.object_key}"',
            "Content-Length": str(row.size_bytes or len(row.data)),
            "Cache-Control": "private, max-age=3600",
        },
    )
