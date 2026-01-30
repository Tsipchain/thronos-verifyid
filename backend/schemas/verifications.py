from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class DocumentVerificationCreate(BaseModel):
    document_type: str
    document_image_url: Optional[str] = None


class DocumentVerificationResponse(BaseModel):
    id: int
    user_id: str
    document_type: str
    document_number: Optional[str] = None
    full_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    nationality: Optional[str] = None
    issue_date: Optional[str] = None
    expiry_date: Optional[str] = None
    verification_status: str
    fraud_score: int
    created_at: datetime
    verified_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class AgeVerificationCreate(BaseModel):
    date_of_birth: str


class AgeVerificationResponse(BaseModel):
    id: int
    user_id: str
    date_of_birth: str
    age: int
    is_verified: bool
    created_at: datetime

    class Config:
        from_attributes = True


class KYCFormCreate(BaseModel):
    full_name: str
    email: str
    phone: str
    address: str
    city: str
    country: str
    postal_code: Optional[str] = None
    nationality: str
    occupation: str
    source_of_funds: Optional[str] = None


class KYCFormResponse(BaseModel):
    id: int
    user_id: str
    full_name: str
    email: str
    phone: str
    address: str
    city: str
    country: str
    postal_code: Optional[str] = None
    nationality: str
    occupation: str
    source_of_funds: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VideoVerificationCreate(BaseModel):
    agent_name: Optional[str] = "Sarah Johnson"
    agent_id: Optional[str] = "VER-2024-1234"
    session_duration: Optional[int] = None
    notes: Optional[str] = None


class VideoVerificationResponse(BaseModel):
    id: int
    user_id: str
    agent_name: Optional[str] = None
    agent_id: Optional[str] = None
    session_duration: Optional[int] = None
    verification_status: str
    notes: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class DigitalSignatureCreate(BaseModel):
    signature_data: str
    document_type: Optional[str] = "Identity Verification Consent Agreement"


class DigitalSignatureResponse(BaseModel):
    id: int
    user_id: str
    signature_id: str
    document_type: str
    is_legally_binding: bool
    created_at: datetime

    class Config:
        from_attributes = True


class FraudAnalysisCreate(BaseModel):
    document_verification_id: Optional[int] = None
    document_image_url: Optional[str] = None


class FraudAnalysisResponse(BaseModel):
    id: int
    user_id: str
    overall_score: int
    document_quality_score: Optional[int] = None
    security_features_score: Optional[int] = None
    biometric_score: Optional[int] = None
    liveness_score: Optional[int] = None
    data_consistency_score: Optional[int] = None
    manipulation_detection_score: Optional[int] = None
    deepfake_score: Optional[int] = None
    risk_level: str
    analysis_details: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class VerificationStatusResponse(BaseModel):
    user_id: str
    overall_progress: int
    document_verification: Optional[DocumentVerificationResponse] = None
    age_verification: Optional[AgeVerificationResponse] = None
    kyc_form: Optional[KYCFormResponse] = None
    video_verification: Optional[VideoVerificationResponse] = None
    digital_signature: Optional[DigitalSignatureResponse] = None
    fraud_analysis: Optional[FraudAnalysisResponse] = None
    verification_complete: bool