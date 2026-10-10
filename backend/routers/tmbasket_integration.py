import hmac
import json
import os
from datetime import datetime, timedelta

from fastapi import APIRouter, Header, HTTPException, Query
from sqlalchemy import func, select

from core.database import db_manager
from models.agent_availability import AgentAvailability, AgentStatus
from models.verifications import DocumentVerifications, VerificationStatus

router = APIRouter(prefix="/api/v1/integrations/tmbasket", tags=["integrations"])

AGENT_HEARTBEAT_TTL_SECONDS = 120


def _require_service_token(x_service_token: str | None) -> None:
    expected = os.getenv("TMBASKET_SERVICE_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="TMBasket integration is not configured")
    if not x_service_token or not hmac.compare_digest(x_service_token, expected):
        raise HTTPException(status_code=401, detail="Invalid integration token")


def _route_from_history(extracted_data: str | None) -> str | None:
    try:
        history = json.loads(extracted_data or "{}").get("review_history", [])
    except Exception:
        return None
    for item in reversed(history):
        route = item.get("route") if isinstance(item, dict) else None
        if route:
            return str(route)
    return None


@router.get("/availability")
async def integration_availability(x_service_token: str | None = Header(default=None)):
    _require_service_token(x_service_token)
    cutoff = datetime.now() - timedelta(seconds=AGENT_HEARTBEAT_TTL_SECONDS)
    async with db_manager.async_session_maker() as db:
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
        count = int(result.scalar_one() or 0)
    return {"live_agents": count, "route": "webrtc" if count else "ai_admin_review"}


@router.get("/verifications/{verification_id}")
async def integration_verification_status(
    verification_id: int,
    subject: str = Query(min_length=1),
    x_service_token: str | None = Header(default=None),
):
    """Minimal server-to-server verification result for TMBasket.

    No document images or extracted PII are returned. The caller must provide the
    VerifyID subject and a shared service token. Final identity is accepted only
    after a human-agent approval or admin completion; AI-only review remains pending.
    """
    _require_service_token(x_service_token)

    async with db_manager.async_session_maker() as db:
        stmt = select(DocumentVerifications).where(DocumentVerifications.id == verification_id)
        result = await db.execute(stmt)
        verification = result.scalar_one_or_none()

        if not verification or verification.user_id != subject:
            raise HTTPException(status_code=404, detail="Verification not found")

        status = verification.verification_status.value
        route = _route_from_history(verification.extracted_data)
        completed = verification.verification_status in {
            VerificationStatus.APPROVED,
            VerificationStatus.COMPLETED,
        }

        return {
            "verification_id": verification.id,
            "subject": verification.user_id,
            "verification_status": status,
            "route": route,
            "fraud_score": verification.fraud_score,
            "risk_level": verification.risk_level,
            "blockchain_tx_hash": verification.blockchain_tx_hash,
            "completed": completed,
            "requires_admin_approval": (
                route == "ai_admin_review"
                and verification.verification_status == VerificationStatus.IN_REVIEW
            ),
        }
