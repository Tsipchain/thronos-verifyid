"""Internal AI callback handler for VerifyID SaaS.

Receives AI analysis results from Thronos AI Core (ai.thronoschain.org)
after document verification and fraud detection.

Flow:
1. VerifyID receives KYC upload from customer
2. VerifyID sends documents to AI Core for analysis
3. AI Core processes with Claude Sonnet 4.5
4. AI Core calls this callback with results
5. VerifyID updates database and notifies customer
"""
import logging
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
import os
from typing import List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

INTERNAL_KEY = os.getenv("THRONOS_AI_INTERNAL_KEY", "verifyid-saas-internal-20260222-xyz789")

router = APIRouter(prefix="/internal", tags=["internal"])

class AICallbackPayload(BaseModel):
    """AI analysis result payload from Thronos AI Core"""
    request_id: str = Field(..., description="KYC request ID")
    fraud_score: float = Field(..., ge=0.0, le=1.0, description="Fraud probability 0-1")
    flags: List[str] = Field(default_factory=list, description="Detected fraud indicators")
    requires_agent: bool = Field(..., description="Whether human review is needed")
    status: str = Field(..., description="New status: ai_review, ai_approved, ai_rejected")
    ai_job_id: str = Field(..., description="AI Core job ID for tracking")
    analyzed_at: str = Field(..., description="ISO timestamp of analysis")
    confidence: Optional[float] = Field(default=None, description="AI confidence score")
    document_quality: Optional[str] = Field(default=None, description="low, medium, high")

@router.post("/ai/callback")
async def ai_callback_handler(
    payload: AICallbackPayload,
    x_internal_key: str = Header(None)
):
    """
    Receives AI analysis result from Thronos AI Core.
    Updates KYC request status in database with fraud score and flags.
    
    Called by: verifyid_ai_endpoint.py in Thronos AI Core after GPT-4o analysis
    
    Security: Requires X-Internal-Key header matching THRONOS_AI_INTERNAL_KEY
    
    Returns:
        Success confirmation with request_id
    
    Raises:
        401: Unauthorized (invalid internal key)
        500: Database error during update
    """
    # Validate internal key
    if x_internal_key != INTERNAL_KEY:
        logger.warning(
            f"[AI Callback] Unauthorized attempt from key: {x_internal_key[:8] if x_internal_key else 'None'}..."
        )
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    logger.info(
        f"[AI Callback] Received for KYC {payload.request_id}: "
        f"score={payload.fraud_score:.2f}, status={payload.status}, flags={len(payload.flags)}"
    )
    
    try:
        # TODO: Update database with AI results
        # This would normally call a service function like:
        # 
        # await kyc_service.update_kyc_request(
        #     request_id=payload.request_id,
        #     status=payload.status,
        #     fraud_score=payload.fraud_score,
        #     ai_flags=payload.flags,
        #     ai_job_id=payload.ai_job_id,
        #     requires_agent=payload.requires_agent,
        #     document_quality=payload.document_quality,
        #     analyzed_at=payload.analyzed_at
        # )
        
        # For now, just log the result
        logger.info(
            f"[AI Callback] ✅ KYC {payload.request_id} updated: "
            f"fraud_score={payload.fraud_score}, requires_agent={payload.requires_agent}"
        )
        
        # If requires human review, could trigger notification here
        if payload.requires_agent:
            logger.warning(
                f"[AI Callback] ⚠️ KYC {payload.request_id} needs human agent review. "
                f"Flags: {', '.join(payload.flags)}"
            )
        
        return {
            "ok": True,
            "message": "Callback received and processed",
            "request_id": payload.request_id,
            "status": payload.status,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
    
    except Exception as e:
        logger.error(f"[AI Callback] Error processing callback for {payload.request_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process callback: {str(e)}"
        )

@router.get("/health")
async def internal_health():
    """Internal services health check"""
    return {
        "status": "healthy",
        "service": "verifyid-internal",
        "endpoints": ["/internal/ai/callback"],
        "ai_key_configured": bool(INTERNAL_KEY)
    }
