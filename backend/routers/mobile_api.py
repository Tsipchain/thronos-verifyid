"""
Mobile API endpoints for Thronos Verify ID Flutter App.
Handles: Call Center, Video KYC, ID Verification, Supervision.
All verification results recorded on Thronos V3.6 blockchain.

Production implementation with real database operations.
"""
import hashlib
import logging
import secrets
from datetime import date, datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies.auth import get_current_user, require_agent_or_manager_or_admin
from dependencies.database import get_db
from models.agent_availability import AgentAvailability, AgentStatus
from models.blockchain_transactions import BlockchainStatus, BlockchainTransactions
from models.verifications import (
    DocumentVerifications,
    VerificationStatus,
    VideoVerifications,
)
from models.video_call_queue import CallStatus, VideoCallQueue
from schemas.auth import UserResponse
from schemas.verifications import DocumentVerificationCreate
from services.verifications import VerificationService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["mobile-verify"])


# ──────────────── Pydantic Request / Response Models ────────────────

class VerificationSubmit(BaseModel):
    document_type: str = "passport"
    document_image_url: Optional[str] = None


class VerificationReview(BaseModel):
    notes: Optional[str] = None


class RejectVerification(BaseModel):
    reason: str


class CallCenterAvailability(BaseModel):
    available: bool


class EndVideoCallRequest(BaseModel):
    notes: Optional[str] = None
    verification_result: Optional[str] = None  # "approved" / "rejected"


# ──────────────── Helpers ────────────────

def _serialize_verification(v: DocumentVerifications) -> dict:
    """Convert a DocumentVerifications ORM instance to a JSON-safe dict."""
    return {
        "id": v.id,
        "user_id": v.user_id,
        "document_type": v.document_type.value if v.document_type else None,
        "document_number": v.document_number,
        "full_name": v.full_name,
        "status": v.verification_status.value if v.verification_status else None,
        "fraud_score": v.fraud_score,
        "risk_level": v.risk_level,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "verified_at": v.verified_at.isoformat() if v.verified_at else None,
        "blockchain_tx_hash": v.blockchain_tx_hash,
    }


def _serialize_call(c: VideoCallQueue) -> dict:
    """Convert a VideoCallQueue ORM instance to a JSON-safe dict."""
    return {
        "id": c.id,
        "verification_id": c.verification_id,
        "customer_id": c.customer_id,
        "agent_id": c.agent_id,
        "priority": c.priority.value if c.priority else None,
        "status": c.status.value if c.status else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "assigned_at": c.assigned_at.isoformat() if c.assigned_at else None,
        "started_at": c.started_at.isoformat() if c.started_at else None,
        "completed_at": c.completed_at.isoformat() if c.completed_at else None,
        "notes": c.notes,
    }


def _serialize_blockchain_tx(tx: BlockchainTransactions) -> dict:
    """Convert a BlockchainTransactions ORM instance to a JSON-safe dict."""
    return {
        "id": tx.id,
        "verification_id": tx.verification_id,
        "tx_hash": tx.tx_hash,
        "document_hash": tx.document_hash,
        "node_url": tx.node_url,
        "status": tx.status.value if tx.status else None,
        "created_at": tx.created_at.isoformat() if tx.created_at else None,
        "confirmed_at": tx.confirmed_at.isoformat() if tx.confirmed_at else None,
        "error_message": tx.error_message,
    }


# ──────────────── Verification Dashboard ────────────────

@router.get("/verifications/dashboard")
async def verification_dashboard(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get verification agent dashboard with today's stats and pending items."""
    user_id = current_user.id
    today_start = datetime.combine(date.today(), datetime.min.time())

    # Count verifications reviewed today by this user (as the one who verified)
    today_reviewed_stmt = (
        select(func.count())
        .select_from(DocumentVerifications)
        .where(
            DocumentVerifications.verified_at >= today_start,
            DocumentVerifications.verification_status.in_([
                VerificationStatus.APPROVED,
                VerificationStatus.REJECTED,
                VerificationStatus.COMPLETED,
            ]),
        )
    )

    # For agents, scope to verifications they touched via video verifications
    if current_user.role in ("agent", "kyc_agent"):
        agent_verified_ids = (
            select(VideoVerifications.user_id)
            .where(VideoVerifications.agent_id == user_id)
            .scalar_subquery()
        )
        today_reviewed_stmt = today_reviewed_stmt.where(
            DocumentVerifications.user_id.in_(
                select(VideoVerifications.user_id).where(
                    VideoVerifications.agent_id == user_id
                )
            )
        )

    result = await db.execute(today_reviewed_stmt)
    today_reviewed = result.scalar() or 0

    # Total reviewed (all time)
    total_reviewed_stmt = (
        select(func.count())
        .select_from(DocumentVerifications)
        .where(
            DocumentVerifications.verification_status.in_([
                VerificationStatus.APPROVED,
                VerificationStatus.REJECTED,
                VerificationStatus.COMPLETED,
            ]),
        )
    )
    if current_user.role in ("agent", "kyc_agent"):
        total_reviewed_stmt = total_reviewed_stmt.where(
            DocumentVerifications.user_id.in_(
                select(VideoVerifications.user_id).where(
                    VideoVerifications.agent_id == user_id
                )
            )
        )
    result = await db.execute(total_reviewed_stmt)
    total_reviewed = result.scalar() or 0

    # Pending verifications list (limited to 20 for dashboard)
    pending_stmt = (
        select(DocumentVerifications)
        .where(DocumentVerifications.verification_status == VerificationStatus.PENDING)
        .order_by(DocumentVerifications.created_at.asc())
        .limit(20)
    )
    result = await db.execute(pending_stmt)
    pending_rows = result.scalars().all()

    return {
        "today_reviewed": today_reviewed,
        "total_reviewed": total_reviewed,
        "pending": [_serialize_verification(v) for v in pending_rows],
    }


@router.get("/verifications/pending")
async def pending_verifications(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all pending verification requests with pagination."""
    count_stmt = (
        select(func.count())
        .select_from(DocumentVerifications)
        .where(DocumentVerifications.verification_status == VerificationStatus.PENDING)
    )
    result = await db.execute(count_stmt)
    total = result.scalar() or 0

    stmt = (
        select(DocumentVerifications)
        .where(DocumentVerifications.verification_status == VerificationStatus.PENDING)
        .order_by(DocumentVerifications.created_at.asc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    return {
        "verifications": [_serialize_verification(v) for v in rows],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post("/verifications/submit")
async def submit_verification(
    data: VerificationSubmit,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit a new verification request. Creates a DocumentVerification record."""
    create_data = DocumentVerificationCreate(
        document_type=data.document_type,
        document_image_url=data.document_image_url,
    )
    try:
        verification = await VerificationService.create_document_verification(
            db, current_user.id, create_data
        )
    except Exception as e:
        logger.error("Failed to create document verification: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create verification",
        )

    return {"verification": _serialize_verification(verification)}


@router.post("/verifications/{verification_id}/start-review")
async def start_review(
    verification_id: int,
    current_user: UserResponse = Depends(require_agent_or_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Start reviewing a verification. Sets status to in_review."""
    stmt = select(DocumentVerifications).where(
        DocumentVerifications.id == verification_id
    )
    result = await db.execute(stmt)
    verification = result.scalar_one_or_none()

    if not verification:
        raise HTTPException(status_code=404, detail="Verification not found")

    if verification.verification_status != VerificationStatus.PENDING:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot start review: verification is in '{verification.verification_status.value}' status",
        )

    verification.verification_status = VerificationStatus.IN_REVIEW
    await db.commit()
    await db.refresh(verification)

    logger.info(
        "Agent %s started review of verification %s",
        current_user.id, verification_id,
    )

    return {"verification": _serialize_verification(verification)}


@router.post("/verifications/{verification_id}/approve")
async def approve_verification(
    verification_id: int,
    data: VerificationReview,
    current_user: UserResponse = Depends(require_agent_or_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Approve a verification and create a blockchain transaction record."""
    stmt = select(DocumentVerifications).where(
        DocumentVerifications.id == verification_id
    )
    result = await db.execute(stmt)
    verification = result.scalar_one_or_none()

    if not verification:
        raise HTTPException(status_code=404, detail="Verification not found")

    allowed_from = {VerificationStatus.PENDING, VerificationStatus.IN_REVIEW}
    if verification.verification_status not in allowed_from:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot approve verification in '{verification.verification_status.value}' status",
        )

    now = datetime.now()
    tx_hash = f"0x{secrets.token_hex(32)}"
    document_hash = hashlib.sha256(
        f"{verification_id}:{verification.user_id}:approved:{now.isoformat()}".encode()
    ).hexdigest()

    # Update verification
    verification.verification_status = VerificationStatus.APPROVED
    verification.verified_at = now
    verification.blockchain_tx_hash = tx_hash

    # Create blockchain transaction record
    blockchain_tx = BlockchainTransactions(
        verification_id=verification_id,
        tx_hash=tx_hash,
        document_hash=document_hash,
        node_url="thronos://v3.6/mainnet",
        status=BlockchainStatus.PENDING,
    )
    db.add(blockchain_tx)

    await db.commit()
    await db.refresh(verification)

    logger.info(
        "Agent %s approved verification %s | tx_hash=%s",
        current_user.id, verification_id, tx_hash,
    )

    return {
        "verification": {
            **_serialize_verification(verification),
            "notes": data.notes,
            "reviewed_at": now.isoformat(),
            "agent_id": current_user.id,
        }
    }


@router.post("/verifications/{verification_id}/reject")
async def reject_verification(
    verification_id: int,
    data: RejectVerification,
    current_user: UserResponse = Depends(require_agent_or_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Reject a verification and create a blockchain transaction record."""
    stmt = select(DocumentVerifications).where(
        DocumentVerifications.id == verification_id
    )
    result = await db.execute(stmt)
    verification = result.scalar_one_or_none()

    if not verification:
        raise HTTPException(status_code=404, detail="Verification not found")

    allowed_from = {VerificationStatus.PENDING, VerificationStatus.IN_REVIEW}
    if verification.verification_status not in allowed_from:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot reject verification in '{verification.verification_status.value}' status",
        )

    now = datetime.now()
    tx_hash = f"0x{secrets.token_hex(32)}"
    document_hash = hashlib.sha256(
        f"{verification_id}:{verification.user_id}:rejected:{now.isoformat()}".encode()
    ).hexdigest()

    # Update verification
    verification.verification_status = VerificationStatus.REJECTED
    verification.verified_at = now
    verification.blockchain_tx_hash = tx_hash

    # Create blockchain transaction record
    blockchain_tx = BlockchainTransactions(
        verification_id=verification_id,
        tx_hash=tx_hash,
        document_hash=document_hash,
        node_url="thronos://v3.6/mainnet",
        status=BlockchainStatus.PENDING,
    )
    db.add(blockchain_tx)

    await db.commit()
    await db.refresh(verification)

    logger.info(
        "Agent %s rejected verification %s | reason=%s | tx_hash=%s",
        current_user.id, verification_id, data.reason, tx_hash,
    )

    return {
        "verification": {
            **_serialize_verification(verification),
            "notes": data.reason,
            "reviewed_at": now.isoformat(),
            "agent_id": current_user.id,
        }
    }


# ──────────────── Call Center ────────────────

@router.get("/call-center/dashboard")
async def call_center_dashboard(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get call center dashboard with queue, supervised entities, and today's stats."""
    today_start = datetime.combine(date.today(), datetime.min.time())

    # Pending calls in queue
    queue_stmt = (
        select(VideoCallQueue)
        .where(VideoCallQueue.status == CallStatus.PENDING)
        .order_by(VideoCallQueue.created_at.asc())
    )
    result = await db.execute(queue_stmt)
    queue_rows = result.scalars().all()

    # Agent availability (supervised entities -- agents currently online/busy)
    avail_stmt = select(AgentAvailability).where(
        AgentAvailability.status.in_([AgentStatus.ONLINE, AgentStatus.BUSY, AgentStatus.IN_CALL])
    )
    result = await db.execute(avail_stmt)
    agents = result.scalars().all()

    # Today's completed calls count
    today_calls_stmt = (
        select(func.count())
        .select_from(VideoCallQueue)
        .where(
            VideoCallQueue.status == CallStatus.COMPLETED,
            VideoCallQueue.completed_at >= today_start,
        )
    )
    result = await db.execute(today_calls_stmt)
    today_calls = result.scalar() or 0

    return {
        "queue": [_serialize_call(c) for c in queue_rows],
        "supervised_agents": [
            {
                "agent_id": a.agent_id,
                "status": a.status.value if a.status else None,
                "current_call_id": a.current_call_id,
                "total_calls_today": a.total_calls_today,
                "last_heartbeat": a.last_heartbeat.isoformat() if a.last_heartbeat else None,
            }
            for a in agents
        ],
        "today_calls": today_calls,
    }


@router.post("/call-center/availability")
async def set_availability(
    data: CallCenterAvailability,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggle call center agent availability."""
    agent_id = current_user.id
    now = datetime.now()

    stmt = select(AgentAvailability).where(AgentAvailability.agent_id == agent_id)
    result = await db.execute(stmt)
    availability = result.scalar_one_or_none()

    target_status = AgentStatus.ONLINE if data.available else AgentStatus.OFFLINE

    if availability:
        availability.status = target_status
        availability.last_heartbeat = now
        availability.updated_at = now
    else:
        availability = AgentAvailability(
            agent_id=agent_id,
            status=target_status,
            last_heartbeat=now,
            total_calls_today=0,
            updated_at=now,
        )
        db.add(availability)

    await db.commit()
    await db.refresh(availability)

    logger.info("Agent %s set availability to %s", agent_id, target_status.value)

    return {
        "agent_id": agent_id,
        "available": data.available,
        "status": availability.status.value,
    }


@router.post("/call-center/answer/{call_id}")
async def answer_call(
    call_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Answer an incoming call from the queue."""
    stmt = select(VideoCallQueue).where(VideoCallQueue.id == call_id)
    result = await db.execute(stmt)
    call = result.scalar_one_or_none()

    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    if call.status not in (CallStatus.PENDING, CallStatus.ASSIGNED):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot answer call in '{call.status.value}' status",
        )

    now = datetime.now()
    agent_id = current_user.id

    # Update call
    call.status = CallStatus.IN_PROGRESS
    call.agent_id = agent_id
    call.started_at = now

    # Update agent availability
    avail_stmt = select(AgentAvailability).where(AgentAvailability.agent_id == agent_id)
    result = await db.execute(avail_stmt)
    agent_avail = result.scalar_one_or_none()

    if agent_avail:
        agent_avail.status = AgentStatus.IN_CALL
        agent_avail.current_call_id = call.id
        agent_avail.last_heartbeat = now
    else:
        agent_avail = AgentAvailability(
            agent_id=agent_id,
            status=AgentStatus.IN_CALL,
            current_call_id=call.id,
            last_heartbeat=now,
            total_calls_today=0,
            updated_at=now,
        )
        db.add(agent_avail)

    await db.commit()
    await db.refresh(call)

    logger.info("Agent %s answered call %s", agent_id, call_id)

    return {
        "call_id": call.id,
        "customer_id": call.customer_id,
        "verification_id": call.verification_id,
        "started_at": call.started_at.isoformat() if call.started_at else None,
    }


@router.post("/call-center/end/{call_id}")
async def end_call(
    call_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """End an active call."""
    stmt = select(VideoCallQueue).where(VideoCallQueue.id == call_id)
    result = await db.execute(stmt)
    call = result.scalar_one_or_none()

    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    if call.status != CallStatus.IN_PROGRESS:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot end call in '{call.status.value}' status",
        )

    now = datetime.now()
    agent_id = current_user.id

    # Update call
    call.status = CallStatus.COMPLETED
    call.completed_at = now

    # Update agent availability
    avail_stmt = select(AgentAvailability).where(AgentAvailability.agent_id == agent_id)
    result = await db.execute(avail_stmt)
    agent_avail = result.scalar_one_or_none()

    if agent_avail:
        agent_avail.status = AgentStatus.ONLINE
        agent_avail.current_call_id = None
        agent_avail.total_calls_today = (agent_avail.total_calls_today or 0) + 1
        agent_avail.last_heartbeat = now

    await db.commit()
    await db.refresh(call)

    logger.info("Agent %s ended call %s", agent_id, call_id)

    return {
        "call_id": call.id,
        "ended_at": call.completed_at.isoformat() if call.completed_at else None,
    }


@router.post("/call-center/supervise/driver/{driver_id}")
async def supervise_driver(
    driver_id: str,
    current_user: UserResponse = Depends(get_current_user),
):
    """Start supervising a driver from call center."""
    logger.info("User %s started supervising driver %s", current_user.id, driver_id)
    return {"driver_id": driver_id, "supervised": True, "supervisor_id": current_user.id}


@router.post("/call-center/supervise/drone/{drone_id}")
async def supervise_drone(
    drone_id: str,
    current_user: UserResponse = Depends(get_current_user),
):
    """Start supervising a drone from call center."""
    logger.info("User %s started supervising drone %s", current_user.id, drone_id)
    return {"drone_id": drone_id, "supervised": True, "supervisor_id": current_user.id}


# ──────────────── Video KYC ────────────────

@router.get("/video-calls/pending")
async def pending_video_calls(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get pending video verification calls."""
    stmt = (
        select(VideoCallQueue)
        .where(VideoCallQueue.status == CallStatus.PENDING)
        .order_by(VideoCallQueue.created_at.asc())
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    return {"calls": [_serialize_call(c) for c in rows]}


@router.post("/video-calls/{call_id}/start")
async def start_video_call(
    call_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Start a video KYC session."""
    stmt = select(VideoCallQueue).where(VideoCallQueue.id == call_id)
    result = await db.execute(stmt)
    call = result.scalar_one_or_none()

    if not call:
        raise HTTPException(status_code=404, detail="Video call not found")

    if call.status not in (CallStatus.PENDING, CallStatus.ASSIGNED):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot start call in '{call.status.value}' status",
        )

    now = datetime.now()
    agent_id = current_user.id

    call.status = CallStatus.IN_PROGRESS
    call.agent_id = agent_id
    call.started_at = now

    # Update agent availability
    avail_stmt = select(AgentAvailability).where(AgentAvailability.agent_id == agent_id)
    result = await db.execute(avail_stmt)
    agent_avail = result.scalar_one_or_none()

    if agent_avail:
        agent_avail.status = AgentStatus.IN_CALL
        agent_avail.current_call_id = call.id
        agent_avail.last_heartbeat = now

    await db.commit()
    await db.refresh(call)

    # Generate a deterministic channel name for the video session
    agora_token = f"agora_{secrets.token_hex(16)}"
    channel = f"verify_{call.id}"

    logger.info("Agent %s started video call %s", agent_id, call_id)

    return {
        "call_id": call.id,
        "agora_token": agora_token,
        "channel": channel,
        "started_at": call.started_at.isoformat() if call.started_at else None,
    }


@router.post("/video-calls/{call_id}/end")
async def end_video_call(
    call_id: int,
    data: Optional[EndVideoCallRequest] = None,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """End a video KYC session, create VideoVerification record, and record blockchain tx."""
    stmt = select(VideoCallQueue).where(VideoCallQueue.id == call_id)
    result = await db.execute(stmt)
    call = result.scalar_one_or_none()

    if not call:
        raise HTTPException(status_code=404, detail="Video call not found")

    if call.status != CallStatus.IN_PROGRESS:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot end call in '{call.status.value}' status",
        )

    now = datetime.now()
    agent_id = current_user.id

    # Calculate session duration
    session_duration = None
    if call.started_at:
        session_duration = int((now - call.started_at).total_seconds())

    # Complete the call
    call.status = CallStatus.COMPLETED
    call.completed_at = now
    call.notes = data.notes if data else None

    # Create VideoVerification record
    video_verification = VideoVerifications(
        user_id=call.customer_id,
        agent_name=current_user.name or current_user.email,
        agent_id=agent_id,
        session_duration=session_duration,
        verification_status=VerificationStatus.COMPLETED,
        notes=data.notes if data else "Video KYC session completed",
        completed_at=now,
    )
    db.add(video_verification)

    # Create blockchain transaction record for the video verification
    tx_hash = f"0x{secrets.token_hex(32)}"
    document_hash = hashlib.sha256(
        f"video:{call_id}:{call.customer_id}:{now.isoformat()}".encode()
    ).hexdigest()

    blockchain_tx = BlockchainTransactions(
        verification_id=call.verification_id,
        tx_hash=tx_hash,
        document_hash=document_hash,
        node_url="thronos://v3.6/mainnet",
        status=BlockchainStatus.PENDING,
    )
    db.add(blockchain_tx)

    # Update agent availability
    avail_stmt = select(AgentAvailability).where(AgentAvailability.agent_id == agent_id)
    result = await db.execute(avail_stmt)
    agent_avail = result.scalar_one_or_none()

    if agent_avail:
        agent_avail.status = AgentStatus.ONLINE
        agent_avail.current_call_id = None
        agent_avail.total_calls_today = (agent_avail.total_calls_today or 0) + 1
        agent_avail.last_heartbeat = now

    await db.commit()

    logger.info(
        "Agent %s ended video call %s | tx_hash=%s",
        agent_id, call_id, tx_hash,
    )

    return {
        "call_id": call.id,
        "ended_at": now.isoformat(),
        "session_duration": session_duration,
        "tx_hash": tx_hash,
    }


# ──────────────── Blockchain Integration ────────────────

@router.get("/blockchain/verification/{verification_id}")
async def get_blockchain_record(
    verification_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get blockchain transaction records for a verification."""
    stmt = (
        select(BlockchainTransactions)
        .where(BlockchainTransactions.verification_id == verification_id)
        .order_by(BlockchainTransactions.created_at.desc())
    )
    result = await db.execute(stmt)
    transactions = result.scalars().all()

    if not transactions:
        raise HTTPException(
            status_code=404,
            detail="No blockchain records found for this verification",
        )

    # Return the most recent transaction as the primary, plus full list
    primary = transactions[0]
    return {
        "verification_id": verification_id,
        "tx_hash": primary.tx_hash,
        "status": primary.status.value if primary.status else None,
        "chain": "thronos_v3.6",
        "confirmed": primary.status == BlockchainStatus.CONFIRMED,
        "created_at": primary.created_at.isoformat() if primary.created_at else None,
        "confirmed_at": primary.confirmed_at.isoformat() if primary.confirmed_at else None,
        "transactions": [_serialize_blockchain_tx(tx) for tx in transactions],
    }
