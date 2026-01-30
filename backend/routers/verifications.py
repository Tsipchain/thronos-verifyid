from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from dependencies.database import get_db
from dependencies.auth import get_current_user
from schemas.auth import UserResponse
from schemas.verifications import (
    DocumentVerificationCreate,
    DocumentVerificationResponse,
    AgeVerificationCreate,
    AgeVerificationResponse,
    KYCFormCreate,
    KYCFormResponse,
    VideoVerificationCreate,
    VideoVerificationResponse,
    DigitalSignatureCreate,
    DigitalSignatureResponse,
    FraudAnalysisCreate,
    FraudAnalysisResponse,
    VerificationStatusResponse
)
from services.verifications import VerificationService

router = APIRouter(prefix="/api/v1/verifications", tags=["verifications"])


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