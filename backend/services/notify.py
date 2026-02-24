"""Unified notification helper.

Usage:
    from services.notify import create_notification, notify_all_admins

    # Single user
    await create_notification(db, user_id="xyz", title="Your ticket was updated",
                               body="Ticket TKT-0001 moved to In Progress",
                               category="ticket", entity_type="ticket", entity_id="1")

    # All admins
    await notify_all_admins(db, title="Org ABC subscription expiring",
                             body="...", category="billing",
                             entity_type="org", entity_id="org-uuid")
"""

import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.auth import User
from models.notifications import Notification

logger = logging.getLogger(__name__)


async def create_notification(
    db: AsyncSession,
    user_id: str,
    title: str,
    body: Optional[str] = None,
    category: str = "general",
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
) -> Notification:
    notif = Notification(
        user_id=user_id,
        title=title,
        body=body,
        category=category,
        entity_type=entity_type,
        entity_id=entity_id,
    )
    db.add(notif)
    await db.commit()
    await db.refresh(notif)

    # Best-effort WebSocket push
    try:
        from routers.video_calls import manager as _ws
        await _ws.send_personal_message(
            {
                "type": "notification",
                "id": notif.id,
                "title": title,
                "body": body,
                "category": category,
                "entity_type": entity_type,
                "entity_id": entity_id,
            },
            user_id,
        )
    except Exception:
        pass

    return notif


async def notify_all_admins(
    db: AsyncSession,
    title: str,
    body: Optional[str] = None,
    category: str = "general",
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
) -> None:
    result = await db.execute(
        select(User).where(
            User.role.in_(["manager", "admin"]),
            User.is_active.is_(True),
        )
    )
    for user in result.scalars().all():
        try:
            await create_notification(
                db=db,
                user_id=user.id,
                title=title,
                body=body,
                category=category,
                entity_type=entity_type,
                entity_id=entity_id,
            )
        except Exception as exc:
            logger.error("Failed to create notification for %s: %s", user.id, exc)
