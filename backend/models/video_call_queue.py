from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from .base import Base


class CallPriority(str, enum.Enum):
    URGENT = "urgent"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class CallStatus(str, enum.Enum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class VideoCallQueue(Base):
    __tablename__ = "video_call_queue"

    id = Column(Integer, primary_key=True, autoincrement=True)
    verification_id = Column(Integer, ForeignKey("verifications.id"), nullable=False)
    customer_id = Column(String, nullable=False)
    agent_id = Column(String, nullable=True)
    priority = Column(SQLEnum(CallPriority), default=CallPriority.NORMAL, nullable=False)
    status = Column(SQLEnum(CallStatus), default=CallStatus.PENDING, nullable=False)
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    assigned_at = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    notes = Column(String, nullable=True)

    # Relationships
    verification = relationship("Verifications", back_populates="video_calls")