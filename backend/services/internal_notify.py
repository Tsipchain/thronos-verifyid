"""Internal notification service.

Sends management alerts via the internal chat system — no SMTP required.

A "Management Alerts" group conversation is created automatically the first
time a notification is sent.  All active manager/admin users are added as
participants, so the message appears in their chat widget immediately via
WebSocket.
"""

import logging
from datetime import datetime

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.auth import User
from models.chat import ConversationParticipants, Conversations, Messages

logger = logging.getLogger(__name__)

ALERTS_GROUP_NAME = "Management Alerts"
SYSTEM_USER_ID = "SYSTEM"
SYSTEM_USERNAME = "System"


async def _get_or_create_alerts_group(db: AsyncSession) -> int:
    """Find or create the Management Alerts group and sync all active managers."""
    result = await db.execute(
        select(Conversations).where(
            and_(
                Conversations.conversation_type == "group",
                Conversations.name == ALERTS_GROUP_NAME,
                Conversations.is_active == True,  # noqa: E712
            )
        )
    )
    group = result.scalar_one_or_none()

    if not group:
        group = Conversations(
            user_id=SYSTEM_USER_ID,
            conversation_type="group",
            name=ALERTS_GROUP_NAME,
            description="Automated system notifications for management",
        )
        db.add(group)
        await db.commit()
        await db.refresh(group)

    # Sync all active managers/admins as participants
    mgr_result = await db.execute(
        select(User).where(
            User.role.in_(["manager", "admin"]),
            User.is_active.is_(True),
        )
    )
    managers = mgr_result.scalars().all()

    for mgr in managers:
        existing = await db.execute(
            select(ConversationParticipants).where(
                and_(
                    ConversationParticipants.conversation_id == group.id,
                    ConversationParticipants.user_id == mgr.id,
                )
            )
        )
        if not existing.scalar_one_or_none():
            db.add(
                ConversationParticipants(
                    user_id=mgr.id,
                    conversation_id=group.id,
                    username=getattr(mgr, "email", None) or mgr.id,
                    role="member",
                )
            )

    await db.commit()
    return group.id


async def notify_managers(db: AsyncSession, content: str) -> None:
    """Post a system message to the Management Alerts chat group.

    Managers who are currently connected via WebSocket receive the message
    instantly through the video-calls signaling channel (best-effort).
    The message is always persisted in the database so it's visible when
    they next open the chat widget.
    """
    try:
        conversation_id = await _get_or_create_alerts_group(db)

        msg = Messages(
            user_id=SYSTEM_USER_ID,
            conversation_id=conversation_id,
            username=SYSTEM_USERNAME,
            content=content,
            message_type="system",
        )
        db.add(msg)

        conv_result = await db.execute(
            select(Conversations).where(Conversations.id == conversation_id)
        )
        conv = conv_result.scalar_one_or_none()
        if conv:
            conv.last_message_at = datetime.now()
            conv.updated_at = datetime.now()

        await db.commit()

        # Best-effort: push a real-time alert to connected managers via the
        # video-calls WebSocket manager (already imported everywhere).
        try:
            from routers.video_calls import manager as _ws

            mgr_result = await db.execute(
                select(User).where(
                    User.role.in_(["manager", "admin"]),
                    User.is_active.is_(True),
                )
            )
            for mgr in mgr_result.scalars().all():
                await _ws.send_personal_message(
                    {
                        "type": "system_alert",
                        "conversation_id": conversation_id,
                        "content": content,
                        "timestamp": datetime.now().isoformat(),
                    },
                    mgr.id,
                )
        except Exception as ws_exc:
            logger.debug("WS push for system alert skipped: %s", ws_exc)

        logger.info("Management alert sent (conv=%d): %.80s", conversation_id, content)

    except Exception as exc:
        logger.error("Failed to send management alert: %s", exc)
