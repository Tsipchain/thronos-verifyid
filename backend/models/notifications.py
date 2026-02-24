"""In-app notification model.

Notifications are per-user records that drive the bell-icon badge in the UI
and the /notifications page.  They are created by:
  - the subscription expiry monitor (category="billing")
  - the ticket system (category="ticket")
  - any system event that calls services.notify.create_notification()

The internal Management Alerts chat is a separate channel (group conversation)
handled by services/internal_notify.py; both channels are used in parallel.
"""

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text

from .base import Base


class Notification(Base):
    __tablename__ = "notifications"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    user_id     = Column(String(255), nullable=False, index=True)

    title       = Column(String(255), nullable=False)
    body        = Column(Text, nullable=True)

    # Category drives the icon/color in the UI
    # general | billing | ticket | system | verification
    category    = Column(String(50), nullable=False, default="general")

    # Optional reference to the related entity
    entity_type = Column(String(50), nullable=True)   # org | ticket | verification
    entity_id   = Column(String(255), nullable=True)  # the entity's primary key

    is_read     = Column(Boolean, default=False, nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow, nullable=False)
