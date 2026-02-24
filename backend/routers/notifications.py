"""Notification router — per-user in-app notifications.

Endpoints:
  GET  /api/v1/notifications              list my notifications (newest first)
  GET  /api/v1/notifications/unread-count  {count: N}
  POST /api/v1/notifications/{id}/read    mark one as read
  POST /api/v1/notifications/read-all     mark all mine as read
  DELETE /api/v1/notifications/{id}       delete one notification
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies.auth import get_current_user
from dependencies.database import get_db
from models.notifications import Notification
from schemas.auth import UserResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: int
    title: str
    body: Optional[str]
    category: str
    entity_type: Optional[str]
    entity_id: Optional[str]
    is_read: bool
    created_at: str

    class Config:
        from_attributes = True


class UnreadCount(BaseModel):
    count: int


# ── Helpers ───────────────────────────────────────────────────────────────────

def _out(n: Notification) -> NotificationOut:
    return NotificationOut(
        id=n.id,
        title=n.title,
        body=n.body,
        category=n.category,
        entity_type=n.entity_type,
        entity_id=n.entity_id,
        is_read=n.is_read,
        created_at=n.created_at.isoformat(),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=List[NotificationOut], summary="List my notifications")
async def list_notifications(
    unread_only: bool = Query(False, description="Return only unread notifications"),
    limit: int = Query(50, le=200),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(Notification).where(Notification.user_id == current_user.id)
    if unread_only:
        q = q.where(Notification.is_read.is_(False))
    q = q.order_by(Notification.created_at.desc()).limit(limit)
    result = await db.execute(q)
    return [_out(n) for n in result.scalars().all()]


@router.get("/unread-count", response_model=UnreadCount, summary="Unread notification count")
async def unread_count(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification).where(
            Notification.user_id == current_user.id,
            Notification.is_read.is_(False),
        )
    )
    count = len(result.scalars().all())
    return UnreadCount(count=count)


@router.post("/read-all", summary="Mark all notifications as read")
async def read_all(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(Notification)
        .where(
            Notification.user_id == current_user.id,
            Notification.is_read.is_(False),
        )
        .values(is_read=True)
    )
    await db.commit()
    return {"ok": True}


@router.post("/{notification_id}/read", summary="Mark a notification as read")
async def mark_read(
    notification_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.is_read = True
    await db.commit()
    return {"ok": True}


@router.delete("/{notification_id}", summary="Delete a notification")
async def delete_notification(
    notification_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    await db.delete(notif)
    await db.commit()
    return {"ok": True}
