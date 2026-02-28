"""Subscription expiry monitor.

Runs as an asyncio background task (started from main.py lifespan).
Checks every 12 hours for organisations whose subscription is about to expire
and fires:
  1. An email to the organisation's contact_email
  2. A Management Alerts chat message (internal_notify.notify_managers)
  3. In-app notifications for all Thronos admin/manager users

Warning thresholds: 14 days out (first warning), 7 days out (urgent warning).
Flags expiry_warned_14d / expiry_warned_7d on the Organisation row prevent
duplicate alerts.
"""

import asyncio
import logging
from datetime import datetime, timedelta

from asyncpg.exceptions import InvalidPasswordError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from models.organizations import Organization
from services.internal_notify import notify_managers
from services.notify import notify_all_admins

logger = logging.getLogger(__name__)

_CHECK_INTERVAL_SECONDS = 12 * 60 * 60  # 12 hours


async def _check_expirations(db: AsyncSession) -> None:
    now = datetime.utcnow()

    # Load all active orgs with a set plan_expires_at
    result = await db.execute(
        select(Organization).where(
            Organization.plan_status == "active",
            Organization.plan_expires_at.isnot(None),
        )
    )
    orgs = result.scalars().all()

    for org in orgs:
        days_left = (org.plan_expires_at - now).days

        if days_left <= 0:
            # Subscription actually expired — downgrade to past_due if not already
            if org.plan_status == "active":
                org.plan_status = "past_due"
                logger.info("Org %s (%s) subscription expired — set to past_due", org.id, org.name)
                await notify_managers(
                    db,
                    f"⚠️ Organisation '{org.name}' subscription has EXPIRED.\n"
                    f"Contact: {org.contact_email}\n"
                    f"Widget API key is now locked.",
                )
                await notify_all_admins(
                    db,
                    title=f"Subscription expired: {org.name}",
                    body=f"The subscription for '{org.name}' has expired. Widget API key locked.",
                    category="billing",
                    entity_type="org",
                    entity_id=org.id,
                )
            continue

        # 7-day urgent warning
        if days_left <= 7 and not org.expiry_warned_7d:
            org.expiry_warned_7d = True
            logger.info("Org %s (%s) — urgent 7-day expiry warning", org.id, org.name)
            msg = (
                f"🔴 URGENT — Organisation '{org.name}' subscription expires in "
                f"{days_left} day(s) ({org.plan_expires_at.strftime('%Y-%m-%d')}).\n"
                f"Contact: {org.contact_name or 'N/A'} <{org.contact_email}>\n"
                f"Plan: {org.plan}"
            )
            await notify_managers(db, msg)
            await notify_all_admins(
                db,
                title=f"URGENT: {org.name} subscription expires in {days_left}d",
                body=f"Plan: {org.plan} | Contact: {org.contact_email}",
                category="billing",
                entity_type="org",
                entity_id=org.id,
            )
            _send_expiry_email(org, days_left, urgent=True)

        # 14-day first warning
        elif days_left <= 14 and not org.expiry_warned_14d:
            org.expiry_warned_14d = True
            logger.info("Org %s (%s) — 14-day expiry warning", org.id, org.name)
            msg = (
                f"🟡 Organisation '{org.name}' subscription expires in "
                f"{days_left} day(s) ({org.plan_expires_at.strftime('%Y-%m-%d')}).\n"
                f"Contact: {org.contact_name or 'N/A'} <{org.contact_email}>\n"
                f"Plan: {org.plan}"
            )
            await notify_managers(db, msg)
            await notify_all_admins(
                db,
                title=f"{org.name} subscription expires in {days_left}d",
                body=f"Plan: {org.plan} | Contact: {org.contact_email}",
                category="billing",
                entity_type="org",
                entity_id=org.id,
            )
            _send_expiry_email(org, days_left, urgent=False)

    await db.commit()


def _send_expiry_email(org: Organization, days_left: int, urgent: bool) -> None:
    """Fire-and-forget email to the organisation contact.  Silently skips if SMTP not configured."""
    try:
        from services.email import EmailService
        if not EmailService.is_configured():
            return

        subject_prefix = "URGENT: " if urgent else ""
        subject = f"{subject_prefix}Your DriverIntelligent subscription expires in {days_left} day(s)"
        html = f"""
        <h2>{'⚠️ Urgent: ' if urgent else ''}Subscription Expiry Notice</h2>
        <p>Dear {org.contact_name or org.name},</p>
        <p>Your <strong>DriverIntelligent</strong> subscription ({org.plan} plan)
           will expire in <strong>{days_left} day(s)</strong>
           on <strong>{org.plan_expires_at.strftime('%d %B %Y')}</strong>.</p>
        <p>To avoid interruption to your service and loss of access to your widget API key,
           please renew your subscription as soon as possible.</p>
        <p>If you need assistance, please open a support ticket or contact your
           Thronos account manager.</p>
        <p>Best regards,<br/>The Thronos DriverIntelligent Team</p>
        """
        EmailService.send_email(
            to_email=org.contact_email,
            subject=subject,
            html_body=html,
        )
        logger.info("Expiry warning email sent to %s for org %s", org.contact_email, org.id)
    except Exception as exc:
        logger.warning("Failed to send expiry email for org %s: %s", org.id, exc)


async def run_subscription_monitor() -> None:
    """Long-running loop.  Intended to be started as an asyncio task at startup."""
    logger.info("Subscription monitor started (interval=%ds)", _CHECK_INTERVAL_SECONDS)
    while True:
        try:
            async for db in get_db():
                await _check_expirations(db)
        except InvalidPasswordError as exc:
            logger.error(
                "Subscription monitor disabled due to invalid database credentials: %s. "
                "Please verify DATABASE_URL.",
                exc,
            )
            return
        except Exception as exc:
            logger.error("Subscription monitor error: %s", exc, exc_info=True)
        await asyncio.sleep(_CHECK_INTERVAL_SECONDS)
