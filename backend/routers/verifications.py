import json
import logging
from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies.auth import get_current_user, require_manager_or_admin
from dependencies.database import get_db
from models.verifications import DocumentVerifications, VerificationStatus
from schemas.auth import UserResponse
from schemas.verifications import (
    AgeVerificationCreate,
    AgeVerificationResponse,
    DigitalSignatureCreate,
    DigitalSignatureResponse,
    DocumentVerificationCreate,
    DocumentVerificationResponse,
    FraudAnalysisCreate,
    FraudAnalysisResponse,
    KYCFormCreate,
    KYCFormResponse,
    VerificationStatusResponse,
    VideoVerificationCreate,
    VideoVerificationResponse,
)
from services.verifications import VerificationService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/verifications", tags=["verifications"])


# ── Manager / admin list + finalize ──────────────────────────────────────────

class VerificationListItem(BaseModel):
    id: int
    user_id: str
    document_type: str
    verification_status: str
    fraud_score: int
    risk_level: Optional[str]
    created_at: datetime
    verified_at: Optional[datetime]
    blockchain_tx_hash: Optional[str]
    # Audit trail: list of review events (AI fraud check, human agent, AI fallback)
    review_history: List[Any] = []

    class Config:
        from_attributes = True


class VerificationDetailResponse(BaseModel):
    id: int
    document_type: str
    verification_status: str
    document_image_url: Optional[str]
    extracted_data: Optional[str]
    full_name: Optional[str]
    document_number: Optional[str]
    date_of_birth: Optional[str]
    nationality: Optional[str]
    fraud_score: int
    risk_level: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class ManagerFinalizeRequest(BaseModel):
    decision: str = "completed"  # "completed" | "rejected"
    notes: Optional[str] = None


@router.get("/list", response_model=List[VerificationListItem])
async def list_all_verifications(
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    current_user: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all document verifications (manager/admin only).

    Optionally filter by status: pending, in_review, approved, rejected, completed.
    """
    stmt = select(DocumentVerifications).order_by(DocumentVerifications.created_at.desc())
    if status:
        try:
            s = VerificationStatus(status)
            stmt = stmt.where(DocumentVerifications.verification_status == s)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status value: {status}")
    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    rows = result.scalars().all()
    def _parse_history(extracted_data: Optional[str]) -> list:
        try:
            return json.loads(extracted_data or "{}").get("review_history", [])
        except Exception:
            return []

    return [
        VerificationListItem(
            id=r.id,
            user_id=r.user_id,
            document_type=r.document_type.value,
            verification_status=r.verification_status.value,
            fraud_score=r.fraud_score,
            risk_level=r.risk_level,
            created_at=r.created_at,
            verified_at=r.verified_at,
            blockchain_tx_hash=r.blockchain_tx_hash,
            review_history=_parse_history(r.extracted_data),
        )
        for r in rows
    ]


@router.post("/{verification_id}/manager-finalize")
async def manager_finalize(
    verification_id: int,
    body: ManagerFinalizeRequest,
    current_user: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """Manager final seal (κλείδωμα).

    Moves an agent-approved verification to COMPLETED status (or back to
    REJECTED if the manager overrides).  This is the definitive, immutable
    lock that closes the verification event.
    """
    stmt = select(DocumentVerifications).where(DocumentVerifications.id == verification_id)
    result = await db.execute(stmt)
    verification = result.scalar_one_or_none()

    if not verification:
        raise HTTPException(status_code=404, detail="Verification not found")

    allowed_from = {VerificationStatus.APPROVED, VerificationStatus.IN_REVIEW}
    if verification.verification_status not in allowed_from:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot finalize a verification in '{verification.verification_status.value}' status. "
                   "Only agent-approved or in-review verifications can be finalized.",
        )

    if body.decision == "completed":
        verification.verification_status = VerificationStatus.COMPLETED
    else:
        verification.verification_status = VerificationStatus.REJECTED

    verification.verified_at = datetime.now()
    await db.commit()
    await db.refresh(verification)

    logger.info(
        "Manager %s finalized verification %s → %s",
        current_user.id, verification_id, verification.verification_status.value,
    )

    return {
        "id": verification.id,
        "verification_status": verification.verification_status.value,
        "verified_at": verification.verified_at.isoformat(),
        "finalized_by": current_user.id,
    }


@router.post("/document", response_model=DocumentVerificationResponse)
async def create_document_verification(
    data: DocumentVerificationCreate,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new document verification"""
    try:
        verification = await VerificationService.create_document_verification(
            db, current_user.id, data
        )
        return verification
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/document", response_model=DocumentVerificationResponse)
async def get_document_verification(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user's document verification"""
    verification = await VerificationService.get_user_document_verification(
        db, current_user.id
    )
    if not verification:
        raise HTTPException(status_code=404, detail="Document verification not found")
    return verification


@router.post("/age", response_model=AgeVerificationResponse)
async def create_age_verification(
    data: AgeVerificationCreate,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create age verification"""
    try:
        verification = await VerificationService.create_age_verification(
            db, current_user.id, data
        )
        return verification
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/age", response_model=AgeVerificationResponse)
async def get_age_verification(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user's age verification"""
    verification = await VerificationService.get_user_age_verification(
        db, current_user.id
    )
    if not verification:
        raise HTTPException(status_code=404, detail="Age verification not found")
    return verification


@router.post("/kyc", response_model=KYCFormResponse)
async def create_kyc_form(
    data: KYCFormCreate,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Submit KYC form"""
    try:
        kyc = await VerificationService.create_kyc_form(
            db, current_user.id, data
        )
        return kyc
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/kyc", response_model=KYCFormResponse)
async def get_kyc_form(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user's KYC form"""
    kyc = await VerificationService.get_user_kyc_form(db, current_user.id)
    if not kyc:
        raise HTTPException(status_code=404, detail="KYC form not found")
    return kyc


@router.post("/video", response_model=VideoVerificationResponse)
async def create_video_verification(
    data: VideoVerificationCreate,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create video verification record"""
    try:
        verification = await VerificationService.create_video_verification(
            db, current_user.id, data
        )
        return verification
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/video", response_model=VideoVerificationResponse)
async def get_video_verification(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user's video verification"""
    verification = await VerificationService.get_user_video_verification(
        db, current_user.id
    )
    if not verification:
        raise HTTPException(status_code=404, detail="Video verification not found")
    return verification


@router.post("/signature", response_model=DigitalSignatureResponse)
async def create_digital_signature(
    data: DigitalSignatureCreate,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create digital signature"""
    try:
        signature = await VerificationService.create_digital_signature(
            db, current_user.id, data
        )
        return signature
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/signature", response_model=DigitalSignatureResponse)
async def get_digital_signature(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user's digital signature"""
    signature = await VerificationService.get_user_digital_signature(
        db, current_user.id
    )
    if not signature:
        raise HTTPException(status_code=404, detail="Digital signature not found")
    return signature


@router.post("/fraud-analysis", response_model=FraudAnalysisResponse)
async def create_fraud_analysis(
    data: FraudAnalysisCreate,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create fraud analysis"""
    try:
        analysis = await VerificationService.create_fraud_analysis(
            db, current_user.id, data
        )
        return analysis
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/fraud-analysis", response_model=FraudAnalysisResponse)
async def get_fraud_analysis(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get user's fraud analysis"""
    analysis = await VerificationService.get_user_fraud_analysis(
        db, current_user.id
    )
    if not analysis:
        raise HTTPException(status_code=404, detail="Fraud analysis not found")
    return analysis


@router.get("/status", response_model=VerificationStatusResponse)
async def get_verification_status(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get complete verification status"""
    try:
        status = await VerificationService.get_verification_status(
            db, current_user.id
        )
        return status
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Must be last: catches any /{verification_id} after all fixed-path routes ──

@router.get("/{verification_id}", response_model=VerificationDetailResponse)
async def get_verification_detail(
    verification_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get full verification details including document images.
    Accessible by agents, managers, and admins, plus the owning client.
    """
    stmt = select(DocumentVerifications).where(DocumentVerifications.id == verification_id)
    result = await db.execute(stmt)
    v = result.scalar_one_or_none()
    if not v:
        raise HTTPException(status_code=404, detail="Verification not found")

    allowed_roles = {"agent", "kyc_agent", "manager", "admin"}
    if v.user_id != current_user.id and current_user.role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Access denied")

    return VerificationDetailResponse(
        id=v.id,
        document_type=v.document_type.value,
        verification_status=v.verification_status.value,
        document_image_url=v.document_image_url,
        extracted_data=v.extracted_data,
        full_name=v.full_name,
        document_number=v.document_number,
        date_of_birth=v.date_of_birth,
        nationality=v.nationality,
        fraud_score=v.fraud_score,
        risk_level=v.risk_level,
        created_at=v.created_at,
    )