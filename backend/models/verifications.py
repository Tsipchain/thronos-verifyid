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


class DriverProgramType(str, enum.Enum):
    TAXI_SCHOOL = "taxi_school"
    DRONE_PROGRAM = "drone_program"


class DriverProgramStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    AWAITING_MANAGER = "awaiting_manager"
    COMPLETED = "completed"
    REJECTED = "rejected"


class DriverProgramVerifications(Base):
    """
    VerifyID program verification — records the full lifecycle of a
    driver ('pirate') verification for a specific program (taxi school or drone).

    Sub-verifications are stored as a JSON array in `sub_verifications`, each
    entry signed by a Thronos miner via `miner_signatures`.  When the manager
    issues the final approval the entire proof bundle is committed on-chain
    and the resulting tx hash is stored in `final_chain_hash`.
    """
    __tablename__ = "driver_program_verifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String, nullable=False, index=True)
    program_type = Column(SQLEnum(DriverProgramType), nullable=False)
    status = Column(SQLEnum(DriverProgramStatus), default=DriverProgramStatus.PENDING, nullable=False)

    # Driver-specific fields
    driver_name = Column(String, nullable=True)
    license_number = Column(String, nullable=True)
    vehicle_type = Column(String, nullable=True)        # e.g. taxi, helicopter, fixed-wing, multirotor
    school_or_operator = Column(String, nullable=True)  # taxi school name or drone operator

    # FK to the base identity document verification (existing flow)
    document_verification_id = Column(Integer, ForeignKey("document_verifications.id"), nullable=True)

    # JSON array of sub-verification step objects:
    # [{step_key, label, status, miner_id, miner_signature, chain_tx, signed_at, notes}]
    sub_verifications = Column(Text, nullable=True)

    # JSON array of miner signature records (mirrors signed steps for quick lookup)
    miner_signatures = Column(Text, nullable=True)

    # Manager finalization
    finalized_by = Column(String, nullable=True)
    finalized_at = Column(DateTime, nullable=True)
    manager_notes = Column(Text, nullable=True)

    # Final on-chain proof (set after manager approval)
    final_chain_hash = Column(String, nullable=True)
    chain_proof = Column(Text, nullable=True)  # JSON with full proof bundle

    created_at = Column(DateTime, default=datetime.now, nullable=False)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now, nullable=False)
