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
import logging
from datetime import datetime, timedelta

from sqlalchemy import select

from models.auth import User
from models.verifications import DocumentVerifications, VerificationStatus
from models.video_call_queue import CallStatus, VideoCallQueue
from services.aihub_client import AIHubClient
from services.email import EmailService

logger = logging.getLogger(__name__)

TIMEOUT_MINUTES = 15
CHECK_INTERVAL_SECONDS = 60  # run the check once per minute


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _send_client_notification(to_email: str, verification_id: int) -> None:
    """Send best-effort email to the client whose doc was AI-reviewed."""
    try:
        EmailService.send_email(
            to_email=to_email,
            subject="Your Identity Verification — Under Review",
            html_body=f"""
<h2>Verification Update</h2>
<p>Your identity verification request (ID: <strong>{verification_id}</strong>) has been
processed by our automated review system and is now awaiting final approval from our
management team.</p>
<p>You will receive an official email from our team once the final decision has been made.
Thank you for your patience.</p>
<p><em>— Thronos VerifyID Team</em></p>
""",
            text_body=(
                f"Your identity verification (ID: {verification_id}) has been reviewed by our "
                "automated system and is now awaiting final approval from our management team. "
                "You will receive an email from our team with the final decision."
            ),
        )
    except Exception as exc:
        logger.error(
            "Failed to send client notification email for verification %d: %s",
            verification_id, exc,
        )


def _send_manager_notification(to_email: str, verification_id: int, customer_id: str) -> None:
    """Send best-effort email to a manager requesting their final approval."""
    try:
        EmailService.send_email(
            to_email=to_email,
            subject=f"[Action Required] AI-Reviewed Verification #{verification_id}",
            html_body=f"""
<h2>Verification Requires Your Approval</h2>
<p>Verification <strong>#{verification_id}</strong> (Client ID: <code>{customer_id}</code>)
was reviewed by the AI agent because no human agent was available within the
{TIMEOUT_MINUTES}-minute window.</p>
<p>Please log in to the VerifyID platform to review the AI findings and provide the
<strong>final approval or rejection</strong>.</p>
<p><em>— Thronos VerifyID System</em></p>
""",
            text_body=(
                f"Verification #{verification_id} (Client ID: {customer_id}) has been AI-reviewed "
                f"because no human agent was available within {TIMEOUT_MINUTES} minutes. "
                "Please log in to the VerifyID platform to give the final approval."
            ),
        )
    except Exception as exc:
        logger.error(
            "Failed to send manager notification email for verification %d: %s",
            verification_id, exc,
        )


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

    # 4. Move to IN_REVIEW — manager must give the final OK
    verification.verification_status = VerificationStatus.IN_REVIEW
    await db.commit()

    # 5. Fetch client and manager emails then notify (outside the DB transaction)
    client_email: str | None = None
    try:
        client_stmt = select(User).where(User.id == queue_entry.customer_id)
        client_result = await db.execute(client_stmt)
        client_user = client_result.scalar_one_or_none()
        if client_user:
            client_email = client_user.email
    except Exception as exc:
        logger.error("Could not fetch client user for queue entry %d: %s", queue_entry.id, exc)

    manager_emails: list[str] = []
    try:
        mgr_stmt = select(User).where(
            User.role.in_(["manager", "admin"]),
            User.is_active.is_(True),
        )
        mgr_result = await db.execute(mgr_stmt)
        managers = mgr_result.scalars().all()
        manager_emails = [m.email for m in managers if m.email]
    except Exception as exc:
        logger.error("Could not fetch manager list for queue entry %d: %s", queue_entry.id, exc)

    if EmailService.is_configured():
        if client_email:
            _send_client_notification(client_email, verification.id)
        for mgr_email in manager_emails:
            _send_manager_notification(mgr_email, verification.id, queue_entry.customer_id)
    else:
        logger.info(
            "Email service not configured — skipping notifications for verification %d.",
            verification.id,
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
