from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from .base import Base


class BlockchainStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    FAILED = "failed"


class BlockchainTransactions(Base):
    __tablename__ = "blockchain_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    verification_id = Column(Integer, ForeignKey("verifications.id"), nullable=False)
    tx_hash = Column(String, unique=True, nullable=False)
    document_hash = Column(String, nullable=False)
    node_url = Column(String, nullable=False)
    status = Column(SQLEnum(BlockchainStatus), default=BlockchainStatus.PENDING, nullable=False)
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    confirmed_at = Column(DateTime, nullable=True)
    error_message = Column(String, nullable=True)

    # Relationships
    verification = relationship("Verifications", back_populates="blockchain_txs")