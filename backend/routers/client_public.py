import logging
import os
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.verifications import DocumentType, DocumentVerifications, VerificationStatus
from models.video_call_queue import CallPriority, VideoCallQueue
from services.aihub import AIHubService
from services.video_call_service import VideoCallService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/client", tags=["client-public"])

# CareerForge callback config
_CF_CALLBACK_URL = os.getenv("CAREERFORGE_CALLBACK_URL", "").strip()
_CF_INTERNAL_KEY = os.getenv("CAREERFORGE_INTERNAL_KEY", "").strip()
# Auto-approve threshold: fraud_score >= this value skips video-call queue
_AUTO_APPROVE_THRESHOLD = int(os.getenv("AUTO_APPROVE_THRESHOLD", "80"))


# WebSocket connection manager for clients
class ClientConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, WebSocket] = {}  # verification_id -> WebSocket

    async def connect(self, verification_id: int, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[verification_id] = websocket
        logger.info(f"Client WebSocket connected for verification {verification_id}")

    def disconnect(self, verification_id: int):
        if verification_id in self.active_connections:
            del self.active_connections[verification_id]
            logger.info(f"Client WebSocket disconnected for verification {verification_id}")

    async def send_status_update(self, verification_id: int, status: dict):
        if verification_id in self.active_connections:
            try:
                await self.active_connections[verification_id].send_json({
                    "type": "status_update",
                    "status": status
                })
            except Exception as e:
                logger.error(f"Error sending status to verification {verification_id}: {e}")


client_manager = ClientConnectionManager()


class ClientUploadRequest(BaseModel):
    document_type: str = "passport"
    full_name: str
    document_number: str
    date_of_birth: str
    nationality: str
    front_image: str  # Base64 encoded
    back_image: Optional[str] = None
    # Optional: CareerForge (or any external) user sub to link the verification back
    external_user_id: Optional[str] = None


class VerificationStatusResponse(BaseModel):
    verification_id: int
    status: str
    ai_score: Optional[int] = None
    risk_level: Optional[str] = None
    agent_name: Optional[str] = None
    estimated_wait_minutes: Optional[int] = None
    blockchain_tx_hash: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


async def _notify_careerforge(external_user_id: str, verification_id: int) -> None:
    """Fire-and-forget: notify CareerForge that a user has passed KYC."""
    if not _CF_CALLBACK_URL or not external_user_id:
        return
    try:
        headers = {}
        if _CF_INTERNAL_KEY:
            headers["X-Internal-Key"] = _CF_INTERNAL_KEY
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                _CF_CALLBACK_URL,
                json={"sub": external_user_id, "verification_id": verification_id},
                headers=headers,
            )
        logger.info(f"CareerForge notified for sub={external_user_id} verification={verification_id}")
    except Exception as exc:
        logger.warning(f"CareerForge callback failed (non-fatal): {exc}")


async def _process_ai_review(
    verification_id: int,
    user_id: str,
    front_image: str,
    back_image: Optional[str],
    external_user_id: Optional[str] = None,
) -> None:
    """
    Background task: Run AI fraud analysis and auto-queue for video call if score is good.
    """
    from core.database import db_manager
    try:
        async with db_manager.async_session_maker() as db:
            # 1. Update status to IN_REVIEW
            stmt = select(DocumentVerifications).where(DocumentVerifications.id == verification_id)
            result = await db.execute(stmt)
            verification = result.scalar_one_or_none()

            if not verification:
                logger.error(f"Verification {verification_id} not found")
                return

            verification.verification_status = VerificationStatus.IN_REVIEW
            await db.commit()

            # Notify client
            await client_manager.send_status_update(verification_id, {
                "verification_id": verification_id,
                "status": "in_review"
            })

            # 2. Run AI fraud analysis
            logger.info(f"Running AI analysis for verification {verification_id}")
            ai_result = await AIHubService.analyze_document(
                document_images=[front_image, back_image] if back_image else [front_image],
                document_type=verification.document_type.value
            )

            # 3. Update verification with AI results
            verification.fraud_score = ai_result.get("fraud_score", 0)
            verification.risk_level = ai_result.get("risk_level", "unknown")

            # 4. Decide next step based on AI score
            fraud_score = ai_result.get("fraud_score", 0)

            if fraud_score < 50:
                # Auto-reject if fraud score is too low
                verification.verification_status = VerificationStatus.REJECTED
                logger.warning(f"Verification {verification_id} auto-rejected (fraud_score={fraud_score})")

                await client_manager.send_status_update(verification_id, {
                    "verification_id": verification_id,
                    "status": "rejected",
                    "ai_score": fraud_score,
                    "risk_level": ai_result.get("risk_level")
                })

            elif fraud_score >= _AUTO_APPROVE_THRESHOLD:
                # High-confidence clean document — auto-approve, no video call needed
                verification.verification_status = VerificationStatus.COMPLETED
                logger.info(f"Verification {verification_id} auto-approved (fraud_score={fraud_score})")

                await db.commit()

                await client_manager.send_status_update(verification_id, {
                    "verification_id": verification_id,
                    "status": "completed",
                    "ai_score": fraud_score,
                    "risk_level": ai_result.get("risk_level"),
                })

                # Notify external platform (e.g. CareerForge) so it can grant bonus credits
                await _notify_careerforge(external_user_id, verification_id)

            else:
                # Medium confidence — queue for video call review
                verification.verification_status = VerificationStatus.PENDING

                call_queue = VideoCallQueue(
                    verification_id=verification_id,
                    customer_id=user_id,
                    priority=CallPriority.HIGH if fraud_score < 70 else CallPriority.NORMAL
                )
                db.add(call_queue)

                logger.info(f"Verification {verification_id} queued for video call (fraud_score={fraud_score})")

                await db.commit()
                await VideoCallService.auto_assign_next_call(db)

                await client_manager.send_status_update(verification_id, {
                    "verification_id": verification_id,
                    "status": "pending",
                    "ai_score": fraud_score,
                    "risk_level": ai_result.get("risk_level"),
                    "estimated_wait_minutes": 5
                })

            await db.commit()

    except Exception as e:
        logger.error(f"AI review failed for verification {verification_id}: {e}")
        # Don't fail the entire verification, just log


@router.post("/verifications/upload")
async def upload_verification(
    request: ClientUploadRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Public endpoint for clients to upload verification documents.
    No authentication required - generates anonymous user_id.
    """
    try:
        # Use external_user_id if provided (e.g. CareerForge sub), else generate anonymous ID
        user_id = request.external_user_id or f"client_{datetime.now().timestamp()}"

        # Create verification record
        verification = DocumentVerifications(
            user_id=user_id,
            document_type=DocumentType(request.document_type),
            full_name=request.full_name,
            document_number=request.document_number,
            date_of_birth=request.date_of_birth,
            nationality=request.nationality,
            document_image_url=request.front_image,
            verification_status=VerificationStatus.PENDING,
            fraud_score=0
        )

        db.add(verification)
        await db.commit()
        await db.refresh(verification)

        logger.info(f"Created verification {verification.id} for user {user_id}")

        # Trigger AI review in background
        background_tasks.add_task(
            _process_ai_review,
            verification.id,
            user_id,
            request.front_image,
            request.back_image,
            request.external_user_id,
        )
        
        return {
            "success": True,
            "verification_id": verification.id,
            "user_id": user_id,
            "status": "pending",
            "message": "Documents uploaded successfully. AI review in progress."
        }
        
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/verifications/{verification_id}/status", response_model=VerificationStatusResponse)
async def get_verification_status(
    verification_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Get current status of a verification (public endpoint, no auth).
    """
    try:
        stmt = select(DocumentVerifications).where(DocumentVerifications.id == verification_id)
        result = await db.execute(stmt)
        verification = result.scalar_one_or_none()
        
        if not verification:
            raise HTTPException(status_code=404, detail="Verification not found")
        
        # Get queue position if in queue
        estimated_wait = None
        if verification.verification_status == VerificationStatus.PENDING:
            # Count pending calls ahead in queue
            queue_stmt = select(VideoCallQueue).where(
                VideoCallQueue.verification_id == verification_id
            )
            queue_result = await db.execute(queue_stmt)
            queue_entry = queue_result.scalar_one_or_none()
            if queue_entry:
                estimated_wait = 5  # Simple estimate, can be improved
        
        return VerificationStatusResponse(
            verification_id=verification.id,
            status=verification.verification_status.value,
            ai_score=verification.fraud_score,
            risk_level=verification.risk_level,
            estimated_wait_minutes=estimated_wait,
            blockchain_tx_hash=verification.blockchain_tx_hash,
            created_at=verification.created_at,
            updated_at=verification.verified_at
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Status check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.websocket("/ws/{verification_id}")
async def client_websocket(
    websocket: WebSocket,
    verification_id: int
):
    """
    WebSocket endpoint for real-time verification status updates.
    """
    await client_manager.connect(verification_id, websocket)
    try:
        while True:
            # Keep connection alive with heartbeat
            data = await websocket.receive_json()
            if data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        client_manager.disconnect(verification_id)
    except Exception as e:
        logger.error(f"WebSocket error for verification {verification_id}: {e}")
        client_manager.disconnect(verification_id)
