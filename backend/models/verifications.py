from sqlalchemy import Column, Integer, String, DateTime, Boolean, Enum as SQLEnum, Text, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from .base import Base


class DocumentType(str, enum.Enum):
    PASSPORT = "passport"
    DRIVERS_LICENSE = "drivers_license"
    NATIONAL_ID = "national_id"
    RESIDENCE_PERMIT = "residence_permit"


class VerificationStatus(str, enum.Enum):
    PENDING = "pending"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    COMPLETED = "completed"


class DocumentVerifications(Base):
    __tablename__ = "document_verifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False)
    document_type = Column(SQLEnum(DocumentType), nullable=False)
    document_number = Column(String, nullable=True)
    full_name = Column(String, nullable=True)
    date_of_birth = Column(String, nullable=True)
    nationality = Column(String, nullable=True)
    issue_date = Column(String, nullable=True)
    expiry_date = Column(String, nullable=True)
    document_image_url = Column(Text, nullable=True)
    verification_status = Column(SQLEnum(VerificationStatus), default=VerificationStatus.PENDING, nullable=False)
    fraud_score = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    verified_at = Column(DateTime, nullable=True)
    blockchain_tx_hash = Column(String, nullable=True)
    risk_level = Column(String, default="low", nullable=True)
    extracted_data = Column(Text, nullable=True)

    # Relationships
    video_calls = relationship("VideoCallQueue", back_populates="verification", cascade="all, delete-orphan")
    blockchain_txs = relationship("BlockchainTransactions", back_populates="verification")


# Backward-compatible alias
DocumentVerification = DocumentVerifications


class AgeVerifications(Base):
    __tablename__ = "age_verifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False)
    date_of_birth = Column(String, nullable=False)
    age = Column(Integer, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.now, nullable=False)


# Backward-compatible alias
AgeVerification = AgeVerifications


class KYCForms(Base):
    __tablename__ = "kyc_forms"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    address = Column(String, nullable=False)
    city = Column(String, nullable=False)
    country = Column(String, nullable=False)
    postal_code = Column(String, nullable=True)
    nationality = Column(String, nullable=False)
    occupation = Column(String, nullable=False)
    source_of_funds = Column(String, nullable=True)
    status = Column(SQLEnum(VerificationStatus), default=VerificationStatus.PENDING, nullable=False)
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now, nullable=False)


class VideoVerifications(Base):
    __tablename__ = "video_verifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False)
    agent_name = Column(String, nullable=True)
    agent_id = Column(String, nullable=True)
    session_duration = Column(Integer, nullable=True)
    verification_status = Column(SQLEnum(VerificationStatus), default=VerificationStatus.PENDING, nullable=False)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.now, nullable=False)
    completed_at = Column(DateTime, nullable=True)


class DigitalSignatures(Base):
    __tablename__ = "digital_signatures"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False)
    signature_data = Column(Text, nullable=False)
    document_type = Column(String, nullable=True)
    signature_id = Column(String, unique=True, nullable=False)
    is_legally_binding = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.now, nullable=False)


class FraudAnalysis(Base):
    __tablename__ = "fraud_analysis"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False)
    document_verification_id = Column(Integer, ForeignKey("document_verifications.id"), nullable=True)
    overall_score = Column(Integer, nullable=False)
    document_quality_score = Column(Integer, nullable=True)
    security_features_score = Column(Integer, nullable=True)
    biometric_score = Column(Integer, nullable=True)
    liveness_score = Column(Integer, nullable=True)
    data_consistency_score = Column(Integer, nullable=True)
    manipulation_detection_score = Column(Integer, nullable=True)
    deepfake_score = Column(Integer, nullable=True)
    risk_level = Column(String, nullable=False)
    analysis_details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.now, nullable=False)
