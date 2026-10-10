import base64
import json
import logging
from datetime import datetime, timedelta

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
from services.internal_notify import notify_managers

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/client", tags=["client"])

AGENT_HEARTBEAT_TTL_SECONDS = 120
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


async def _count_live_agents(db: AsyncSession) -> int:
    """Return agents that are online, idle and have sent a recent heartbeat."""
    cutoff = datetime.now() - timedelta(seconds=AGENT_HEARTBEAT_TTL_SECONDS)
    stmt = (
        select(func.count())
        .select_from(AgentAvailability)
        .where(
            AgentAvailability.status == AgentStatus.ONLINE,
            AgentAvailability.current_call_id.is_(None),
            AgentAvailability.last_heartbeat >= cutoff,
        )
    )
    result = await db.execute(stmt)
    return int(result.scalar_one() or 0)


async def _queue_for_live_agent(
    db: AsyncSession,
    verification: DocumentVerifications,
    priority: str,
) -> VideoCallQueue:
    """Queue a verification for WebRTC and immediately notify connected agents."""
    queue_entry = VideoCallQueue(
        verification_id=verification.id,
        customer_id=verification.user_id,
        priority=PRIORITY_MAP.get(priority, CallPriority.NORMAL),
        status=CallStatus.PENDING,
        created_at=datetime.now(),
    )
    db.add(queue_entry)

    try:
        existing_data: dict = json.loads(verification.extracted_data or "{}")
    except Exception:
        existing_data = {}
    existing_data.setdefault("review_history", []).append({
        "source": "live_agent_route",
        "route": "webrtc",
        "created_at": datetime.now().isoformat(),
    })
    verification.extracted_data = json.dumps(existing_data)

    await db.commit()
    await db.refresh(queue_entry)

    try:
        from routers.video_calls import manager as _ws
        await _ws.send_personal_message(
            {
                "type": "verification_routed",
                "route": "webrtc",
                "queue_id": queue_entry.id,
                "verification_id": verification.id,
            },
            verification.user_id,
        )
        await _ws.broadcast({
            "type": "new_call",
            "call_id": queue_entry.id,
            "verification_id": verification.id,
            "priority": priority,
            "source": "live_agent_route",
        })
    except Exception as ws_exc:
        logger.warning("WS notify failed for live-agent route %d: %s", verification.id, ws_exc)

    return queue_entry


async def _run_ai_admin_review(verification_id: int, document_type: str) -> None:
    """AI-only fallback when no live VerifyID agent exists; admin makes final decision."""
    from core.database import db_manager
    from sqlalchemy import select as _select

    try:
        async with db_manager.async_session_maker() as db:
            stmt = _select(DocumentVerifications).where(DocumentVerifications.id == verification_id)
            result = await db.execute(stmt)
            verification = result.scalar_one_or_none()
            if not verification:
                return

            ai_result: dict = {}
            try:
                ai_result = await AIHubClient.analyze_document({
                    "document_type": document_type,
                    "verification_id": verification_id,
                    "mode": "no_live_agent_admin_review",
                })
            except Exception as exc:
                logger.error("AI fallback failed for verification %d: %s", verification_id, exc)

            fraud_score = ai_result.get("fraud_score", 50)
            risk_level = ai_result.get("risk_level", "medium")
            verification.fraud_score = fraud_score
            verification.risk_level = risk_level

            try:
                existing_data: dict = json.loads(verification.extracted_data or "{}")
            except Exception:
                existing_data = {}
            existing_data.setdefault("review_history", []).append({
                "source": "ai_no_live_agent_fallback",
                "route": "ai_admin_review",
                "fraud_score": fraud_score,
                "risk_level": risk_level,
                "flags": ai_result.get("flags", []),
                "explanation": ai_result.get("explanation", ""),
                "checked_at": datetime.now().isoformat(),
                "final_decision": "pending_admin",
            })
            verification.extracted_data = json.dumps(existing_data)

            # AI never makes the final identity decision in this route.
            verification.verification_status = VerificationStatus.IN_REVIEW
            await db.commit()

            try:
                from routers.video_calls import manager as _ws
                await _ws.send_personal_message(
                    {
                        "type": "ai_reviewed",
                        "route": "ai_admin_review",
                        "verification_id": verification.id,
                        "message": "AI fraud review completed. Final approval is pending from a Thronos VerifyID administrator.",
                    },
                    verification.user_id,
                )
            except Exception as ws_exc:
                logger.debug("WS notify failed for AI fallback %d: %s", verification.id, ws_exc)

            await notify_managers(
                db,
                f"[VerifyID Admin Approval Required] Verification #{verification.id} "
                f"used the AI-only fallback because no live agent was available.\n"
                f"Fraud score: {fraud_score}/100 · Risk: {risk_level}.\n"
                "Please review the evidence and make the final decision in Thronos VerifyID.",
            )

            logger.info(
                "Verification %d routed to AI-only fallback and is awaiting admin approval.",
                verification.id,
            )
    except Exception as exc:
        logger.error("AI/admin review flow failed for verification %d: %s", verification_id, exc, exc_info=True)


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
    Upload identity evidence and choose the safest available verification route.

    - If a live, idle VerifyID agent is available, notify the agent and queue a WebRTC call.
    - If no live agent is available, run AI fraud analysis only and hold the case in
      IN_REVIEW until a Thronos VerifyID manager/admin makes the final decision.
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

    b64_content = base64.b64encode(content).decode("utf-8")
    data_url = f"data:{file.content_type};base64,{b64_content}"

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

        live_agents = await _count_live_agents(db)
        if live_agents > 0:
            queue_entry = await _queue_for_live_agent(db, verification, priority)
            return {
                "verification_id": verification.id,
                "status": "waiting_for_agent",
                "route": "webrtc",
                "queue_id": queue_entry.id,
                "available_agents": live_agents,
                "message": "A live VerifyID agent is available. You have been queued for WebRTC identity verification.",
            }

        background_tasks.add_task(_run_ai_admin_review, verification.id, document_type)
        return {
            "verification_id": verification.id,
            "status": "ai_review",
            "route": "ai_admin_review",
            "queue_id": None,
            "available_agents": 0,
            "message": "No live agent is available. AI fraud analysis will run and a Thronos VerifyID administrator will make the final decision.",
        }

    except Exception as exc:
        await db.rollback()
        logger.error("Failed to save document: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to save document: {exc}")


@router.get("/queue-status")
async def get_queue_status(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the current live-agent or AI/admin verification state."""
    stmt = (
        select(VideoCallQueue)
        .where(VideoCallQueue.customer_id == current_user.id)
        .order_by(VideoCallQueue.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    queue_entry = result.scalar_one_or_none()

    if queue_entry and queue_entry.status == CallStatus.CANCELLED:
        queue_entry = None

    if not queue_entry:
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
                    "in_queue": False, "status": "rejected", "route": "admin_decision", "queue_id": None,
                    "queue_position": 0, "available_agents": 0,
                    "verification_status": "rejected", "blockchain_tx_hash": None,
                }
            if recent_ver.verification_status == VerificationStatus.COMPLETED:
                return {
                    "in_queue": False, "status": "completed", "route": "admin_decision", "queue_id": None,
                    "queue_position": 0, "available_agents": 0,
                    "verification_status": "completed", "blockchain_tx_hash": recent_ver.blockchain_tx_hash,
                }
            if recent_ver.verification_status == VerificationStatus.APPROVED:
                return {
                    "in_queue": False, "status": "completed", "route": "admin_decision", "queue_id": None,
                    "queue_position": 0, "available_agents": 0,
                    "verification_status": "approved", "blockchain_tx_hash": recent_ver.blockchain_tx_hash,
                }
            if recent_ver.verification_status == VerificationStatus.IN_REVIEW:
                return {
                    "in_queue": False, "status": "ai_reviewed", "route": "ai_admin_review", "queue_id": None,
                    "queue_position": 0, "available_agents": 0,
                    "verification_status": "in_review", "blockchain_tx_hash": None,
                }
            if recent_ver.verification_status == VerificationStatus.PENDING:
                return {
                    "in_queue": False, "status": "fraud_check", "route": "pending", "queue_id": None,
                    "queue_position": 0, "available_agents": 0,
                }

        return {"in_queue": False, "queue_position": 0, "queue_id": None}

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
            "route": "webrtc",
            "verification_status": verification_status,
            "blockchain_tx_hash": blockchain_tx_hash,
        }

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

    available_agents = await _count_live_agents(db)

    return {
        "in_queue": True,
        "queue_id": queue_entry.id,
        "queue_position": queue_position,
        "available_agents": available_agents,
        "status": queue_entry.status.value,
        "route": "webrtc",
        "verification_status": None,
        "blockchain_tx_hash": None,
    }
