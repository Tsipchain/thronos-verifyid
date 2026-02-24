"""Support ticket router.

Endpoints:
  GET  /api/v1/tickets               list tickets (own for clients, all for staff)
  POST /api/v1/tickets               create ticket
  GET  /api/v1/tickets/{id}          ticket detail with comments
  PUT  /api/v1/tickets/{id}          update status / priority / assignment (staff only)
  POST /api/v1/tickets/{id}/comments add comment/note
  DELETE /api/v1/tickets/{id}        close/delete (admin only)

Notification hooks:
  - Create   → notify_managers() + in-app notification for all admins
  - Update   → in-app notification for ticket creator
  - Comment  → in-app notification for the other party
"""

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies.auth import get_current_user
from dependencies.database import get_db
from models.tickets import Ticket, TicketCategory, TicketComment, TicketPriority, TicketStatus
from schemas.auth import UserResponse
from services.internal_notify import notify_managers
from services.notify import create_notification, notify_all_admins

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/tickets", tags=["tickets"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class TicketCreate(BaseModel):
    subject: str
    description: Optional[str] = None
    category: str = "general"
    priority: str = "medium"
    org_id: Optional[str] = None


class TicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None
    subject: Optional[str] = None
    description: Optional[str] = None


class CommentCreate(BaseModel):
    content: str
    is_internal: bool = False  # True = staff-only note


class CommentOut(BaseModel):
    id: int
    ticket_id: int
    user_id: str
    username: Optional[str]
    content: str
    is_internal: bool
    created_at: str

    class Config:
        from_attributes = True


class TicketOut(BaseModel):
    id: int
    reference: str
    created_by: str
    created_by_email: Optional[str]
    assigned_to: Optional[str]
    org_id: Optional[str]
    category: str
    priority: str
    status: str
    subject: str
    description: Optional[str]
    created_at: str
    updated_at: str
    resolved_at: Optional[str]
    comments: List[CommentOut] = []

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────

def _is_staff(user: UserResponse) -> bool:
    return getattr(user, "role", "") in ("manager", "admin")


async def _get_ticket(db: AsyncSession, ticket_id: int) -> Ticket:
    result = await db.execute(select(Ticket).where(Ticket.id == ticket_id))
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return t


async def _get_next_reference(db: AsyncSession) -> str:
    result = await db.execute(select(Ticket).order_by(Ticket.id.desc()).limit(1))
    last = result.scalar_one_or_none()
    next_id = (last.id + 1) if last else 1
    return f"TKT-{next_id:05d}"


def _ticket_out(t: Ticket, comments: List[TicketComment] = None) -> TicketOut:
    return TicketOut(
        id=t.id,
        reference=t.reference,
        created_by=t.created_by,
        created_by_email=t.created_by_email,
        assigned_to=t.assigned_to,
        org_id=t.org_id,
        category=t.category.value if hasattr(t.category, "value") else t.category,
        priority=t.priority.value if hasattr(t.priority, "value") else t.priority,
        status=t.status.value if hasattr(t.status, "value") else t.status,
        subject=t.subject,
        description=t.description,
        created_at=t.created_at.isoformat(),
        updated_at=t.updated_at.isoformat(),
        resolved_at=t.resolved_at.isoformat() if t.resolved_at else None,
        comments=[
            CommentOut(
                id=c.id,
                ticket_id=c.ticket_id,
                user_id=c.user_id,
                username=c.username,
                content=c.content,
                is_internal=c.is_internal,
                created_at=c.created_at.isoformat(),
            )
            for c in (comments or [])
        ],
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=List[TicketOut], summary="List tickets")
async def list_tickets(
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(Ticket)
    if not _is_staff(current_user):
        # Non-staff can only see their own tickets
        q = q.where(Ticket.created_by == current_user.id)
    if status:
        q = q.where(Ticket.status == status)
    if priority:
        q = q.where(Ticket.priority == priority)
    if category:
        q = q.where(Ticket.category == category)
    q = q.order_by(Ticket.created_at.desc()).limit(limit)
    result = await db.execute(q)
    return [_ticket_out(t) for t in result.scalars().all()]


@router.post("", response_model=TicketOut, status_code=201, summary="Open a support ticket")
async def create_ticket(
    body: TicketCreate,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    reference = await _get_next_reference(db)

    try:
        cat = TicketCategory(body.category)
    except ValueError:
        cat = TicketCategory.GENERAL
    try:
        pri = TicketPriority(body.priority)
    except ValueError:
        pri = TicketPriority.MEDIUM

    ticket = Ticket(
        reference=reference,
        created_by=current_user.id,
        created_by_email=current_user.email,
        org_id=body.org_id,
        category=cat,
        priority=pri,
        status=TicketStatus.OPEN,
        subject=body.subject,
        description=body.description,
    )
    db.add(ticket)
    await db.commit()
    await db.refresh(ticket)

    # Notify management via internal chat
    priority_label = pri.value.upper()
    await notify_managers(
        db,
        f"🎫 New ticket {reference} [{priority_label}] — {body.subject}\n"
        f"From: {current_user.email}\n"
        f"Category: {cat.value}",
    )

    # In-app notification for all admins
    await notify_all_admins(
        db,
        title=f"New ticket {reference}: {body.subject}",
        body=f"Priority: {pri.value} | Category: {cat.value} | From: {current_user.email}",
        category="ticket",
        entity_type="ticket",
        entity_id=str(ticket.id),
    )

    return _ticket_out(ticket)


@router.get("/{ticket_id}", response_model=TicketOut, summary="Ticket detail with comments")
async def get_ticket(
    ticket_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = await _get_ticket(db, ticket_id)
    if not _is_staff(current_user) and ticket.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorised")

    q = select(TicketComment).where(TicketComment.ticket_id == ticket_id)
    if not _is_staff(current_user):
        q = q.where(TicketComment.is_internal.is_(False))
    q = q.order_by(TicketComment.created_at.asc())
    comments_result = await db.execute(q)
    return _ticket_out(ticket, comments_result.scalars().all())


@router.put("/{ticket_id}", response_model=TicketOut, summary="Update ticket (staff only)")
async def update_ticket(
    ticket_id: int,
    body: TicketUpdate,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _is_staff(current_user):
        raise HTTPException(status_code=403, detail="Staff only")

    ticket = await _get_ticket(db, ticket_id)
    old_status = ticket.status

    if body.status is not None:
        try:
            ticket.status = TicketStatus(body.status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")
        if ticket.status in (TicketStatus.RESOLVED, TicketStatus.CLOSED) and not ticket.resolved_at:
            ticket.resolved_at = datetime.utcnow()

    if body.priority is not None:
        try:
            ticket.priority = TicketPriority(body.priority)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid priority: {body.priority}")

    if body.assigned_to is not None:
        ticket.assigned_to = body.assigned_to
    if body.subject is not None:
        ticket.subject = body.subject
    if body.description is not None:
        ticket.description = body.description

    ticket.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(ticket)

    # Notify the ticket creator about status change
    new_status = ticket.status.value if hasattr(ticket.status, "value") else ticket.status
    old_status_v = old_status.value if hasattr(old_status, "value") else old_status
    if body.status and new_status != old_status_v:
        await create_notification(
            db,
            user_id=ticket.created_by,
            title=f"Ticket {ticket.reference} updated",
            body=f"Status changed from {old_status_v} → {new_status}",
            category="ticket",
            entity_type="ticket",
            entity_id=str(ticket.id),
        )

    return _ticket_out(ticket)


@router.post("/{ticket_id}/comments", response_model=CommentOut, status_code=201,
             summary="Add a comment to a ticket")
async def add_comment(
    ticket_id: int,
    body: CommentCreate,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = await _get_ticket(db, ticket_id)

    # Non-staff can only comment on their own tickets and cannot post internal notes
    if not _is_staff(current_user):
        if ticket.created_by != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorised")
        if body.is_internal:
            raise HTTPException(status_code=403, detail="Internal notes are staff-only")

    comment = TicketComment(
        ticket_id=ticket_id,
        user_id=current_user.id,
        username=current_user.email,
        content=body.content,
        is_internal=body.is_internal,
    )
    db.add(comment)
    ticket.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(comment)

    # Notify the other party
    if current_user.id == ticket.created_by:
        # User commented → notify assigned agent / all admins
        if not body.is_internal:
            await notify_all_admins(
                db,
                title=f"New reply on {ticket.reference}",
                body=f"{current_user.email}: {body.content[:120]}",
                category="ticket",
                entity_type="ticket",
                entity_id=str(ticket.id),
            )
    else:
        # Staff commented → notify ticket creator
        if not body.is_internal:
            await create_notification(
                db,
                user_id=ticket.created_by,
                title=f"New reply on {ticket.reference}",
                body=f"Staff reply: {body.content[:120]}",
                category="ticket",
                entity_type="ticket",
                entity_id=str(ticket.id),
            )

    return CommentOut(
        id=comment.id,
        ticket_id=comment.ticket_id,
        user_id=comment.user_id,
        username=comment.username,
        content=comment.content,
        is_internal=comment.is_internal,
        created_at=comment.created_at.isoformat(),
    )


@router.delete("/{ticket_id}", summary="Delete a ticket (admin only)")
async def delete_ticket(
    ticket_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if getattr(current_user, "role", "") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    ticket = await _get_ticket(db, ticket_id)
    await db.delete(ticket)
    await db.commit()
    return {"ok": True}
