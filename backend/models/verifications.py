from sqlalchemy import Column, Integer, String, DateTime, Enum as SQLEnum, Text
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from .base import Base

class VerificationType(str, enum.Enum):
    IDENTITY = "identity"
    ADDRESS = "address"
    INCOME = "income"
    # ... (τα υπόλοιπα ίδια)

class VerificationStatus(str, enum.Enum):
    PENDING = "pending"
    # ... (τα υπόλοιπα ίδια)

class DocumentVerifications(Base):
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

    # Relationships
    video_calls = relationship("VideoCallQueue", back_populates="verification", cascade="all, delete-orphan")

# Η ΚΙΝΗΣΗ ΜΑΤ: Δημιουργούμε ένα Alias. 
# Έτσι, όποιο αρχείο ψάχνει το 'Verifications' θα βρίσκει το 'DocumentVerifications'.
Verifications = DocumentVerifications
