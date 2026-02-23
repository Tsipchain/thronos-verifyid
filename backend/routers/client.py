import base64
import json
import logging
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies.auth import get_current_user
from dependencies.database import get_db
from models.agent_availability import AgentAvailability, AgentStatus
from models.blockchain_transactions import BlockchainTransactions, BlockchainStatus
from models.verifications import DocumentType, DocumentVerifications, VerificationStatus
from models.video_call_queue import CallPriority, CallStatus, VideoCallQueue
from schemas.auth import UserResponse
from services.aihub_client import AIHubClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/client", tags=["client"])


async def _run_fraud_check(verification_id: int, document_type: str) -> None:
    """Background task: run AI fraud analysis and update the verification record."""
    from core.database import db_manager
    from sqlalchemy import select as _select
    try:
        async with db_manager.async_session_maker() as db:
            stmt = _select(DocumentVerifications).where(DocumentVerifications.id == verification_id)
            result = await db.execute(stmt)
            verification = result.scalar_one_or_none()
            if not verification:
                return

            ai_result = await AIHubClient.analyze_document({
                "document_type": document_type,
                "verification_id": verification_id,
            })

            fraud_score = ai_result.get("fraud_score", 50)
            risk_level = ai_result.get("risk_level", "medium")

            verification.fraud_score = fraud_score
            verification.risk_level = risk_level

            if fraud_score < 30:
                # Very low score → auto-reject, remove from queue
                verification.verification_status = VerificationStatus.REJECTED
                queue_stmt = _select(VideoCallQueue).where(
                    VideoCallQueue.verification_id == verification_id,
                    VideoCallQueue.status == CallStatus.PENDING,
                )
                q_result = await db.execute(queue_stmt)
                queue_entry = q_result.scalar_one_or_none()
                if queue_entry:
                    queue_entry.status = CallStatus.CANCELLED

            await db.commit()
            logger.info(
                "Fraud check complete for verification %d: score=%d risk=%s",
                verification_id, fraud_score, risk_level,
            )
    except Exception as exc:
        logger.error("Fraud check failed for verification %d: %s", verification_id, exc)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
}

DOC_TYPE_MAP = {
    "passport": DocumentType.PASSPORT,
    "drivers_license": DocumentType.DRIVERS_LICENSE,
    "national_id": DocumentType.NATIONAL_ID,
    "residence_permit": DocumentType.RESIDENCE_PERMIT,
}

PRIORITY_MAP = {
    "urgent": CallPriority.URGENT,
    "high": CallPriority.HIGH,
    "normal": CallPriority.NORMAL,
    "low": CallPriority.LOW,
}


@router.post("/upload-document")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    back_file: UploadFile = File(default=None),
    document_type: str = Form(default="national_id"),
    priority: str = Form(default="normal"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload an identity document (front required, back optional for ID/licence).
    Persists as base64 data URLs, creates a DocumentVerifications record, and
    automatically adds the client to the VideoCallQueue for agent verification.
    """
    content = await file.read()

    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum allowed size is 10 MB.")

    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{file.content_type}' is not allowed. "
                   "Accepted types: JPEG, PNG, GIF, WebP, PDF.",
        )

    # Encode front as base64 data URL
    b64_content = base64.b64encode(content).decode("utf-8")
    data_url = f"data:{file.content_type};base64,{b64_content}"

    # Encode back image if provided
    back_data_url: str | None = None
    if back_file and back_file.filename:
        back_content = await back_file.read()
        if len(back_content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="Back file too large. Maximum allowed size is 10 MB.")
        if back_file.content_type not in ALLOWED_CONTENT_TYPES:
            raise HTTPException(status_code=400, detail=f"Back file type '{back_file.content_type}' is not allowed.")
        back_b64 = base64.b64encode(back_content).decode("utf-8")
        back_data_url = f"data:{back_file.content_type};base64,{back_b64}"

    doc_type = DOC_TYPE_MAP.get(document_type, DocumentType.NATIONAL_ID)
    call_priority = PRIORITY_MAP.get(priority, CallPriority.NORMAL)

    try:
        # 1. Create the DocumentVerifications record
        verification = DocumentVerifications(
            user_id=current_user.id,
            document_type=doc_type,
            document_image_url=data_url,
            extracted_data=json.dumps({"back_image_url": back_data_url}) if back_data_url else None,
            verification_status=VerificationStatus.PENDING,
            created_at=datetime.now(),
        )
        db.add(verification)
        await db.flush()  # Assigns verification.id without committing

        # 2. Add to the video call queue
        queue_entry = VideoCallQueue(
            verification_id=verification.id,
            customer_id=current_user.id,
            priority=call_priority,
            status=CallStatus.PENDING,
            created_at=datetime.now(),
        )
        db.add(queue_entry)
        await db.commit()
        await db.refresh(verification)
        await db.refresh(queue_entry)

        # Kick off AI fraud analysis in the background (non-blocking)
        background_tasks.add_task(_run_fraud_check, verification.id, document_type)

    except Exception as exc:
        await db.rollback()
        logger.error("Failed to save document or create queue entry: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to save document: {exc}")

    # 3. Calculate current queue position (# of PENDING entries with id <= ours)
    pos_stmt = (
        select(func.count())
        .select_from(VideoCallQueue)
        .where(
            VideoCallQueue.status == CallStatus.PENDING,
            VideoCallQueue.id <= queue_entry.id,
        )
    )
    pos_result = await db.execute(pos_stmt)
    queue_position = pos_result.scalar_one()

    # 4. Count available agents (online + recent heartbeat)
    agent_stmt = select(func.count()).select_from(AgentAvailability).where(
        AgentAvailability.status == AgentStatus.ONLINE,
    )
    agent_result = await db.execute(agent_stmt)
    available_agents = agent_result.scalar_one()

    return {
        "verification_id": verification.id,
        "queue_id": queue_entry.id,
        "queue_position": queue_position,
        "available_agents": available_agents,
        "status": "pending",
        "message": "Document uploaded. You are now in the queue for video verification.",
    }


@router.get("/queue-status")
async def get_queue_status(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the current queue/verification status for the logged-in client.

    The frontend polls this every 10 s to update the waiting screen.
    Once the agent completes the call the entry moves to COMPLETED and
    we return the verification outcome plus the Thronos blockchain tx_hash.
    """
    # Look for the most recent queue entry belonging to this client
    stmt = (
        select(VideoCallQueue)
        .where(VideoCallQueue.customer_id == current_user.id)
        .order_by(VideoCallQueue.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    queue_entry = result.scalar_one_or_none()

    if not queue_entry:
        return {"in_queue": False, "queue_position": 0, "queue_id": None}

    # If call is already completed, return the verification outcome + blockchain proof
    if queue_entry.status == CallStatus.COMPLETED:
        verification_status = None
        blockchain_tx_hash = None

        ver_stmt = select(DocumentVerifications).where(
            DocumentVerifications.id == queue_entry.verification_id
        )
        ver_result = await db.execute(ver_stmt)
        verification = ver_result.scalar_one_or_none()

        if verification:
            verification_status = verification.verification_status.value
            blockchain_tx_hash = verification.blockchain_tx_hash

            # If blockchain_tx_hash is not yet on the model, try BlockchainTransactions table
            if not blockchain_tx_hash:
                bc_stmt = (
                    select(BlockchainTransactions)
                    .where(BlockchainTransactions.verification_id == verification.id)
                    .order_by(BlockchainTransactions.created_at.desc())
                    .limit(1)
                )
                bc_result = await db.execute(bc_stmt)
                bc_tx = bc_result.scalar_one_or_none()
                if bc_tx:
                    blockchain_tx_hash = bc_tx.tx_hash

        return {
            "in_queue": False,
            "queue_id": queue_entry.id,
            "queue_position": 0,
            "available_agents": 0,
            "status": "completed",
            "verification_status": verification_status,
            "blockchain_tx_hash": blockchain_tx_hash,
        }

    # Still in queue (PENDING or ASSIGNED / IN_PROGRESS)
    pos_stmt = (
        select(func.count())
        .select_from(VideoCallQueue)
        .where(
            VideoCallQueue.status == CallStatus.PENDING,
            VideoCallQueue.id <= queue_entry.id,
        )
    )
    pos_result = await db.execute(pos_stmt)
    queue_position = pos_result.scalar_one()

    agent_stmt = select(func.count()).select_from(AgentAvailability).where(
        AgentAvailability.status == AgentStatus.ONLINE,
    )
    agent_result = await db.execute(agent_stmt)
    available_agents = agent_result.scalar_one()

    return {
        "in_queue": True,
        "queue_id": queue_entry.id,
        "queue_position": queue_position,
        "available_agents": available_agents,
        "status": queue_entry.status.value,
        "verification_status": None,
        "blockchain_tx_hash": None,
    }
