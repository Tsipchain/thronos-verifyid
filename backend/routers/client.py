import base64
import json
import logging
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies.auth import get_current_user
from dependencies.database import get_db
from models.blockchain_transactions import BlockchainTransactions, BlockchainStatus
from models.verifications import DocumentType, DocumentVerifications, VerificationStatus
from models.video_call_queue import CallPriority, CallStatus, VideoCallQueue
from schemas.auth import UserResponse
from services.aihub_client import AIHubClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/client", tags=["client"])


async def _run_fraud_check(verification_id: int, document_type: str, priority: str = "normal") -> None:
    """Background task: run AI fraud analysis, then either add to agent queue or reject."""
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

            # Persist audit entry into extracted_data.review_history
            try:
                existing_data: dict = json.loads(verification.extracted_data or "{}")
            except Exception:
                existing_data = {}
            existing_data.setdefault("review_history", []).append({
                "source": "ai_fraud_check",
                "fraud_score": fraud_score,
                "risk_level": risk_level,
                "flags": ai_result.get("flags", []),
                "explanation": ai_result.get("explanation", ""),
                "checked_at": datetime.now().isoformat(),
            })
            verification.extracted_data = json.dumps(existing_data)
            await db.commit()

            if fraud_score >= 30:
                # Fraud check passed → add to agent queue
                call_priority = PRIORITY_MAP.get(priority, CallPriority.NORMAL)
                queue_entry = VideoCallQueue(
                    verification_id=verification_id,
                    customer_id=verification.user_id,
                    priority=call_priority,
                    status=CallStatus.PENDING,
                    created_at=datetime.now(),
                )
                db.add(queue_entry)
                await db.commit()
                await db.refresh(queue_entry)

                logger.info(
                    "Fraud check passed for verification %d (score=%d). Added to queue as entry %d.",
                    verification_id, fraud_score, queue_entry.id,
                )

                # Notify client: they're now in the agent queue
                try:
                    from routers.video_calls import manager as _ws
                    await _ws.send_personal_message(
                        {"type": "fraud_passed", "queue_id": queue_entry.id, "verification_id": verification_id},
                        verification.user_id,
                    )
                    # Notify agents: new call waiting
                    await _ws.broadcast(
                        {"type": "new_call", "call_id": queue_entry.id, "verification_id": verification_id, "priority": priority}
                    )
                except Exception as ws_exc:
                    logger.warning("WS notify failed after fraud pass for %d: %s", verification_id, ws_exc)
            else:
                # Fraud check failed → reject immediately
                verification.verification_status = VerificationStatus.REJECTED
                await db.commit()

                logger.info(
                    "Fraud check FAILED for verification %d (score=%d). Auto-rejected.",
                    verification_id, fraud_score,
                )

                # Notify client: document rejected
                try:
                    from routers.video_calls import manager as _ws
                    await _ws.send_personal_message(
                        {"type": "fraud_failed", "verification_id": verification_id,
                         "reason": "Document could not be verified by our AI system."},
                        verification.user_id,
                    )
                except Exception as ws_exc:
                    logger.warning("WS notify failed after fraud fail for %d: %s", verification_id, ws_exc)

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

    try:
        # 1. Create the DocumentVerifications record only — the queue entry is created
        #    AFTER the AI fraud check passes (inside _run_fraud_check background task).
        verification = DocumentVerifications(
            user_id=current_user.id,
            document_type=doc_type,
            document_image_url=data_url,
            extracted_data=json.dumps({"back_image_url": back_data_url}) if back_data_url else None,
            verification_status=VerificationStatus.PENDING,
            created_at=datetime.now(),
        )
        db.add(verification)
        await db.commit()
        await db.refresh(verification)

        # 2. Kick off AI fraud analysis in the background.
        #    On pass → creates queue entry + notifies client + notifies agents.
        #    On fail → sets status REJECTED + notifies client.
        background_tasks.add_task(_run_fraud_check, verification.id, document_type, priority)

    except Exception as exc:
        await db.rollback()
        logger.error("Failed to save document: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to save document: {exc}")

    return {
        "verification_id": verification.id,
        "status": "fraud_check",
        "message": "Document uploaded. AI fraud analysis is running — you will be notified shortly.",
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

    # Treat CANCELLED as "not in queue" — check verification status instead
    if queue_entry and queue_entry.status == CallStatus.CANCELLED:
        queue_entry = None

    if not queue_entry:
        # No active queue entry: check whether a verification exists (fraud check running / failed / AI-reviewed)
        ver_stmt = (
            select(DocumentVerifications)
            .where(DocumentVerifications.user_id == current_user.id)
            .order_by(DocumentVerifications.created_at.desc())
            .limit(1)
        )
        ver_result = await db.execute(ver_stmt)
        recent_ver = ver_result.scalar_one_or_none()

        if recent_ver:
            if recent_ver.verification_status == VerificationStatus.REJECTED:
                return {
                    "in_queue": False, "status": "rejected", "queue_id": None,
                    "queue_position": 0, "available_agents": 0,
                    "verification_status": "rejected", "blockchain_tx_hash": None,
                }
            if recent_ver.verification_status == VerificationStatus.IN_REVIEW:
                return {
                    "in_queue": False, "status": "ai_reviewed", "queue_id": None,
                    "queue_position": 0, "available_agents": 0,
                }
            if recent_ver.verification_status == VerificationStatus.PENDING:
                # Fraud check is still running
                return {
                    "in_queue": False, "status": "fraud_check", "queue_id": None,
                    "queue_position": 0, "available_agents": 0,
                }

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
