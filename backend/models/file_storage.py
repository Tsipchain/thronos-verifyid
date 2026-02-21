from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import relationship

from .base import Base


class FileStorage(Base):
    """Database-backed object storage — no external OSS service required.

    Lifecycle:
      1. A row is created (uploaded=False) when upload-url is requested.
         upload_token is returned to the client as the upload URL key.
      2. The client PUTs the file to /api/v1/storage/ingest/{upload_token}.
         The row is updated with the raw bytes and uploaded=True.
      3. When download-url is requested for (bucket_name, object_key),
         serve_token is returned as the download URL key.
      4. Anyone with serve_token can GET /api/v1/storage/serve/{serve_token}.
    """

    __tablename__ = "file_storage"
    __table_args__ = (
        UniqueConstraint("bucket_name", "object_key", name="uq_file_storage_bucket_key"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    bucket_name = Column(String(255), nullable=False, index=True)
    object_key = Column(String(500), nullable=False, index=True)

    # Security tokens (UUIDs)
    upload_token = Column(String(36), unique=True, nullable=False, index=True)
    serve_token = Column(String(36), unique=True, nullable=False, index=True)

    # File metadata
    content_type = Column(String(128), default="application/octet-stream", nullable=False)
    size_bytes = Column(Integer, nullable=True)

    # File content
    data = Column(LargeBinary, nullable=True)  # NULL until PUT /ingest completes
    uploaded = Column(Boolean, default=False, nullable=False)

    # Timestamps
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    expires_at = Column(DateTime, nullable=True)
