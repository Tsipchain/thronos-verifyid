"""Support ticket models.

Two tables:
  tickets          — one row per support request
  ticket_comments  — threaded comments/notes per ticket

Tickets can be opened by any authenticated user and are visible to staff
(managers and admins).  Organisation context (org_id) is optional and links
a ticket to a specific tenant organisation.

Notification hooks (handled in the router):
  - On ticket create   → notify_managers() + Notification for assigned user
  - On status change   → Notification for ticket creator
  - On new comment     → Notification for the other party
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum as SQLEnum, Integer, String, Text

from .base import Base


class TicketStatus(str, enum.Enum):
    OPEN        = "open"
    IN_PROGRESS = "in_progress"
    WAITING     = "waiting"      # waiting for customer reply
    RESOLVED    = "resolved"
    CLOSED      = "closed"


class TicketPriority(str, enum.Enum):
    LOW    = "low"
    MEDIUM = "medium"
    HIGH   = "high"
    URGENT = "urgent"


class TicketCategory(str, enum.Enum):
    BILLING      = "billing"
    TECHNICAL    = "technical"
    VERIFICATION = "verification"
    GENERAL      = "general"


class Ticket(Base):
    __tablename__ = "tickets"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    reference = Column(String(20), nullable=False, unique=True)
    # e.g. TKT-00042 — generated on creation

    created_by  = Column(String(255), nullable=False)           # user_id of opener
    created_by_email = Column(String(255), nullable=True)       # denormalised for display
    assigned_to = Column(String(255), nullable=True)            # user_id of handler
    org_id      = Column(String(36), nullable=True, index=True) # optional tenant context

    category = Column(SQLEnum(TicketCategory), nullable=False, default=TicketCategory.GENERAL)
    priority = Column(SQLEnum(TicketPriority), nullable=False, default=TicketPriority.MEDIUM)
    status   = Column(SQLEnum(TicketStatus),   nullable=False, default=TicketStatus.OPEN)

    subject     = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    created_at  = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    resolved_at = Column(DateTime, nullable=True)


class TicketComment(Base):
    __tablename__ = "ticket_comments"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    ticket_id = Column(Integer, nullable=False, index=True)
    user_id   = Column(String(255), nullable=False)
    username  = Column(String(255), nullable=True)  # denormalised display name

    content     = Column(Text, nullable=False)
    is_internal = Column(Boolean, default=False, nullable=False)
    # is_internal=True means the comment is a staff-only note, hidden from the opener

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
