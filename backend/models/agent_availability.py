from sqlalchemy import Column, String, DateTime, Integer, Enum as SQLEnum
from datetime import datetime
import enum
from .base import Base


class AgentStatus(str, enum.Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    BUSY = "busy"
    IN_CALL = "in_call"


class AgentAvailability(Base):
    __tablename__ = "agent_availability"

    agent_id = Column(String, primary_key=True)
    status = Column(SQLEnum(AgentStatus), default=AgentStatus.OFFLINE, nullable=False)
    last_heartbeat = Column(DateTime, default=datetime.now, nullable=False)
    current_call_id = Column(Integer, nullable=True)
    total_calls_today = Column(Integer, default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now, nullable=False)