import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import List, Optional

from core.database import get_db
from dependencies.auth import get_current_user
from schemas.auth import UserResponse
from services.thronos_blockchain import thronos_service
from models.blockchain_transactions import BlockchainTransactions, BlockchainStatus
from models.verifications import Verifications
from sqlalchemy import select

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/blockchain", tags=["blockchain"])


class DocumentHashRequest(BaseModel):
    file_data: str  # Base64 encoded file data


class DocumentHashResponse(BaseModel):
    document_hash: str
    algorithm: str = "SHA256"


class StoreVerificationRequest(BaseModel):
    verification_id: int
    document_hashes: List[str]


class StoreVerificationResponse(BaseModel):
    success: bool
    tx_hash: str
    node_url: str
    blockchain_record_id: int


class VerifyRecordResponse(BaseModel):
    success: bool
    tx_hash: str
    verification_data: dict
    node: str
    status: str


@router.post("/hash-document", response_model=DocumentHashResponse)
async def hash_document(
    file: UploadFile = File(...),
    current_user: UserResponse = Depends(get_current_user)
):
    """Calculate SHA256 hash of uploaded document"""
    try:
        file_data = await file.read()
        document_hash = thronos_service.calculate_document_hash(file_data)

        return DocumentHashResponse(
            document_hash=document_hash,
            algorithm="SHA256"
        )
    except Exception as e:
        logger.error(f"Error hashing document: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to hash document: {str(e)}")


@router.post("/store-verification", response_model=StoreVerificationResponse)
async def store_verification(
    request: StoreVerificationRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Store verification record on Thronos blockchain"""
    try:
        # Get verification details
        stmt = select(Verifications).where(Verifications.id == request.verification_id)
        result = await db.execute(stmt)
        verification = result.scalar_one_or_none()

        if not verification:
            raise HTTPException(status_code=404, detail="Verification not found")

        # Store on blockchain
        blockchain_result = thronos_service.store_verification_on_blockchain(
            verification_id=verification.id,
            user_id=verification.user_id,
            verification_type=verification.verification_type.value,
            document_hashes=request.document_hashes,
            status=verification.status.value,
            verified_by=verification.reviewed_by
        )

        if not blockchain_result["success"]:
            raise HTTPException(
                status_code=500,
                detail=f"Blockchain storage failed: {blockchain_result.get('error')}"
            )

        # Save blockchain transaction record
        blockchain_tx = BlockchainTransactions(
            verification_id=verification.id,
            tx_hash=blockchain_result["tx_hash"],
            document_hash=",".join(request.document_hashes),
            node_url=blockchain_result["node_url"],
            status=BlockchainStatus.CONFIRMED
        )
        db.add(blockchain_tx)
        await db.commit()
        await db.refresh(blockchain_tx)

        return StoreVerificationResponse(
            success=True,
            tx_hash=blockchain_result["tx_hash"],
            node_url=blockchain_result["node_url"],
            blockchain_record_id=blockchain_tx.id
        )

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Error storing verification on blockchain: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/verify/{tx_hash}", response_model=VerifyRecordResponse)
async def verify_blockchain_record(
    tx_hash: str,
    current_user: UserResponse = Depends(get_current_user)
):
    """Verify and retrieve verification record from blockchain"""
    try:
        result = thronos_service.verify_blockchain_record(tx_hash)

        if not result["success"]:
            raise HTTPException(
                status_code=404,
                detail=f"Blockchain record not found: {result.get('error')}"
            )

        return VerifyRecordResponse(
            success=True,
            tx_hash=tx_hash,
            verification_data=result["data"],
            node=result["node"],
            status="confirmed"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error verifying blockchain record: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/ai/risk-score/{verification_id}")
async def get_ai_risk_score(
    verification_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get AI-powered risk score for verification"""
    try:
        # Get verification details
        stmt = select(Verifications).where(Verifications.id == verification_id)
        result = await db.execute(stmt)
        verification = result.scalar_one_or_none()

        if not verification:
            raise HTTPException(status_code=404, detail="Verification not found")

        # Get blockchain transactions for document hashes
        bc_stmt = select(BlockchainTransactions).where(
            BlockchainTransactions.verification_id == verification_id
        )
        bc_result = await db.execute(bc_stmt)
        blockchain_txs = bc_result.scalars().all()

        # Prepare verification data for AI analysis
        verification_data = {
            "user_id": verification.user_id,
            "verification_type": verification.verification_type.value,
            "document_count": len(blockchain_txs),
            "document_hashes": [tx.document_hash for tx in blockchain_txs],
            "upload_time": verification.created_at.isoformat(),
            "account_age_days": 30,  # TODO: Calculate from user creation date
            "previous_verifications": 0,  # TODO: Count previous verifications
            "ip_location": "Unknown"  # TODO: Get from request metadata
        }

        # Calculate AI risk score
        risk_result = await thronos_service.calculate_ai_risk_score(verification_data)

        if not risk_result["success"]:
            return {
                "success": False,
                "error": risk_result.get("error"),
                "risk_assessment": risk_result.get("risk_assessment", {})
            }

        return {
            "success": True,
            "verification_id": verification_id,
            "risk_assessment": risk_result["risk_assessment"]
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting AI risk score: {e}")
        raise HTTPException(status_code=500, detail=str(e))