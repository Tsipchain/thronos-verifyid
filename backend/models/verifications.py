from sqlalchemy import Column, Integer, String, DateTime, Enum as SQLEnum, Text
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from .base import Base

class VerificationType(str, enum.Enum):
    IDENTITY = "identity"
    ADDRESS = "address"
    INCOME = "income"
    EMPLOYMENT = "employment"
    EDUCATION = "education"

class VerificationStatus(str, enum.Enum):
    PENDING = "pending"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    COMPLETED = "completed"

class Verifications(Base):
    __tablename__ = "verifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False)
    verification_type = Column(SQLEnum(VerificationType), nullable=False)
    status = Column(SQLEnum(VerificationStatus), default=VerificationStatus.PENDING, nullable=False)
    document_urls = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    reviewed_by = Column(String, nullable=True)
    thronos_tx_hash = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now, nullable=False)
    completed_at = Column(DateTime, nullable=True)

    # ΣΧΕΣΕΙΣ (Εδώ ήταν το πρόβλημα)
    video_calls = relationship("VideoCallQueue", back_populates="verification", cascade="all, delete-orphan")
    
    # ΠΡΟΣΘΕΣΕ ΑΥΤΗ ΤΗ ΓΡΑΜΜΗ - Αυτό ψάχνει το Blockchain Transactions
    blockchain_txs = relationship("BlockchainTransactions", back_populates="verification")

# Aliases για συμβατότητα
DocumentVerifications = Verifications
DocumentVerification = Verifications
AgeVerifications = Verifications
AgeVerification = Verifications
KYCForms = Verifications
