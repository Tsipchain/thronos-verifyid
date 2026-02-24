"""Queue monitor: AI agent fallback when no human agent picks up within 15 minutes.

Flow:
  Every CHECK_INTERVAL_SECONDS seconds, scan for VideoCallQueue entries that
  have been PENDING for more than TIMEOUT_MINUTES without being picked up by a
  human agent.  For each such entry:
    1. Mark queue entry as CANCELLED (so no human agent can claim it now).
    2. Run AI document analysis via AIHubClient.
    3. Set verification status to IN_REVIEW (awaiting manager final approval).
    4. Email the client: "under review, you'll hear from management".
    5. Email all active manager/admin users: "action required, please approve".
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta

from sqlalchemy import select

from models.verifications import DocumentVerifications, VerificationStatus
from models.video_call_queue import CallStatus, VideoCallQueue
from services.aihub_client import AIHubClient
from services.internal_notify import notify_managers

logger = logging.getLogger(__name__)

TIMEOUT_MINUTES = 15
CHECK_INTERVAL_SECONDS = 60  # run the check once per minute


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _handle_timed_out_entry(db, queue_entry: VideoCallQueue) -> None:
    """Process a single timed-out queue entry via AI review."""
    # 1. Cancel queue entry immediately so no human agent can claim it
    queue_entry.status = CallStatus.CANCELLED
    queue_entry.notes = (
        f"AI agent fallback: no human agent available within {TIMEOUT_MINUTES} minutes."
    )

    # 2. Fetch verification record
    ver_stmt = select(DocumentVerifications).where(
        DocumentVerifications.id == queue_entry.verification_id
    )
    ver_result = await db.execute(ver_stmt)
    verification = ver_result.scalar_one_or_none()
    if not verification:
        logger.warning("Queue entry %d has no matching verification.", queue_entry.id)
        await db.commit()
        return

    # 3. Run AI analysis (best-effort — failures do not block the flow)
    ai_result: dict = {}
    try:
        ai_result = await AIHubClient.analyze_document({
            "document_type": verification.document_type.value,
            "verification_id": verification.id,
            "mode": "ai_agent_review",
        })
        verification.fraud_score = ai_result.get("fraud_score", 50)
        verification.risk_level = ai_result.get("risk_level", "medium")
        logger.info(
            "AI review complete for verification %d: score=%s risk=%s",
            verification.id,
            verification.fraud_score,
            verification.risk_level,
        )
    except Exception as exc:
        logger.error("AI review error for verification %d: %s", verification.id, exc)

    # Persist AI-fallback audit entry into extracted_data.review_history
    try:
        existing_data: dict = json.loads(verification.extracted_data or "{}")
    except Exception:
        existing_data = {}
    existing_data.setdefault("review_history", []).append({
        "source": "ai_agent_fallback",
        "fraud_score": ai_result.get("fraud_score", 50),
        "risk_level": ai_result.get("risk_level", "medium"),
        "flags": ai_result.get("flags", []),
        "explanation": ai_result.get("explanation", ""),
        "triggered_at": datetime.now().isoformat(),
        "reason": f"No human agent available within {TIMEOUT_MINUTES} minutes",
    })
    verification.extracted_data = json.dumps(existing_data)

    # 4. Move to IN_REVIEW — manager must give the final OK
    verification.verification_status = VerificationStatus.IN_REVIEW
    await db.commit()

    # 5. Notify client via WebSocket (best-effort)
    try:
        from routers.video_calls import manager as _ws
        await _ws.send_personal_message(
            {
                "type": "ai_reviewed",
                "verification_id": verification.id,
                "message": "Your documents have been reviewed by our AI system. A manager will make the final decision shortly.",
            },
            queue_entry.customer_id,
        )
    except Exception as ws_exc:
        logger.debug("WS notify to client failed for verification %d: %s", verification.id, ws_exc)

    # 6. Notify managers via internal chat (no SMTP required)
    await notify_managers(
        db,
        f"[Action Required] Verification #{verification.id} (Client: {queue_entry.customer_id}) "
        f"was reviewed by the AI agent because no human agent was available within "
        f"{TIMEOUT_MINUTES} minutes.\n"
        f"AI score: {ai_result.get('fraud_score', '?')}/100 · "
        f"Risk: {ai_result.get('risk_level', '?')}\n"
        f"Please log in to the VerifyID platform to give the final approval.",
    )

    logger.info(
        "Timed-out queue entry %d handled. Verification %d → IN_REVIEW.",
        queue_entry.id, verification.id,
    )


# ---------------------------------------------------------------------------
# Main monitor loop (runs forever as an asyncio task)
# ---------------------------------------------------------------------------

async def run_queue_monitor() -> None:
    """Infinite loop that checks for timed-out pending queue entries."""
    # Lazy import to avoid circular import at module load time
    from core.database import db_manager

    logger.info(
        "Queue monitor started (timeout=%d min, interval=%ds).",
        TIMEOUT_MINUTES, CHECK_INTERVAL_SECONDS,
    )

    while True:
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
        try:
            cutoff = datetime.now() - timedelta(minutes=TIMEOUT_MINUTES)
            async with db_manager.async_session_maker() as db:
                stmt = (
                    select(VideoCallQueue)
                    .where(
                        VideoCallQueue.status == CallStatus.PENDING,
                        VideoCallQueue.created_at <= cutoff,
                    )
                )
                result = await db.execute(stmt)
                timed_out_entries = result.scalars().all()

                if timed_out_entries:
                    logger.info(
                        "Queue monitor: found %d timed-out entry/entries.",
                        len(timed_out_entries),
                    )

                for entry in timed_out_entries:
                    try:
                        await _handle_timed_out_entry(db, entry)
                    except Exception as exc:
                        logger.error(
                            "Unexpected error handling timed-out queue entry %d: %s",
                            entry.id, exc,
                        )

        except asyncio.CancelledError:
            logger.info("Queue monitor task cancelled — shutting down.")
            return
        except Exception as exc:
            logger.error("Queue monitor cycle error: %s", exc)
