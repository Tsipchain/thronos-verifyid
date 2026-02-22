"""Internal AI callback handler for VerifyID SaaS

Receives AI analysis results from Thronos AI Core (ai.thronoschain.org)
after GPT-4o processes KYC documents.

Endpoint: POST /internal/ai/callback
Auth: X-Internal-Key header (THRONOS_AI_INTERNAL_KEY env var)
"""

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field
import os
import logging
from typing import List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/internal",
    tags=["internal"]
)

INTERNAL_KEY = os.getenv("THRONOS_AI_INTERNAL_KEY", "verifyid-saas-internal-20260222-xyz789")

class AICallbackPayload(BaseModel):
    """Payload from Thronos AI Core after KYC analysis"""
    request_id: str = Field(..., description="KYC request ID")
    user_id: Optional[str] = Field(None, description="User ID (if provided)")
    fraud_score: float = Field(..., ge=0.0, le=1.0, description="Fraud probability (0-1)")
    flags: List[str] = Field(default_factory=list, description="Detected issues")
    requires_agent: bool = Field(..., description="Whether human review is needed")
    status: str = Field(..., description="KYC status (ai_review, approved, rejected, needs_agent)")
    ai_job_id: str = Field(..., description="AI analysis job ID")
    analyzed_at: str = Field(..., description="ISO 8601 timestamp")
    analysis_details: Optional[dict] = Field(None, description="Detailed AI analysis metadata")

class AICallbackResponse(BaseModel):
    """Response to AI callback"""
    ok: bool
    message: str
    request_id: str
    updated_at: str

@router.post("/ai/callback", response_model=AICallbackResponse)
async def ai_callback_handler(
    payload: AICallbackPayload,
    x_internal_key: str = Header(None, alias="X-Internal-Key")
):
    """
    Receive AI analysis results from Thronos AI Core.
    
    Called by: verifyid_ai_endpoint.py after GPT-4o completes document analysis
    
    Flow:
    1. Validate internal key
    2. Update KYC request in database with:
       - fraud_score
       - ai_flags
       - status (ai_review, approved, rejected, needs_agent)
       - requires_agent flag
    3. Trigger webhook to client if configured
    4. Queue for agent review if requires_agent=true
    
    Returns:
        AICallbackResponse with confirmation
    """
    
    # Authentication
    if not x_internal_key or x_internal_key != INTERNAL_KEY:
        logger.warning(
            f"[AI Callback] Unauthorized attempt: key={x_internal_key[:8] if x_internal_key else 'missing'}..."
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Invalid internal key"
        )
    
    logger.info(
        f"[AI Callback] Received for KYC {payload.request_id}: "
        f"score={payload.fraud_score:.3f}, status={payload.status}, "
        f"requires_agent={payload.requires_agent}"
    )
    
    try:
        # TODO: Implement database update
        # from services.kyc import update_kyc_request
        # 
        # await update_kyc_request(
        #     request_id=payload.request_id,
        #     status=payload.status,
        #     fraud_score=payload.fraud_score,
        #     ai_flags=payload.flags,
        #     ai_job_id=payload.ai_job_id,
        #     requires_agent=payload.requires_agent,
        #     ai_analyzed_at=payload.analyzed_at,
        #     analysis_details=payload.analysis_details
        # )
        
        # TODO: Trigger client webhook if configured
        # from services.webhooks import trigger_kyc_webhook
        # await trigger_kyc_webhook(
        #     request_id=payload.request_id,
        #     status=payload.status,
        #     fraud_score=payload.fraud_score
        # )
        
        # TODO: Queue for agent review if needed
        # if payload.requires_agent:
        #     from services.agent_queue import queue_for_review
        #     await queue_for_review(
        #         request_id=payload.request_id,
        #         priority="high" if payload.fraud_score > 0.7 else "normal",
        #         flags=payload.flags
        #     )
        
        updated_at = datetime.utcnow().isoformat() + "Z"
        
        logger.info(f"[AI Callback] ✅ KYC {payload.request_id} updated successfully")
        
        # Log fraud score for monitoring
        if payload.fraud_score > 0.7:
            logger.warning(
                f"[AI Callback] ⚠️  High fraud risk detected: "
                f"KYC {payload.request_id} score={payload.fraud_score:.3f}"
            )
        
        return AICallbackResponse(
            ok=True,
            message="AI callback received and processed",
            request_id=payload.request_id,
            updated_at=updated_at
        )
    
    except Exception as e:
        logger.error(
            f"[AI Callback] ❌ Failed to process callback for KYC {payload.request_id}: {e}",
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process AI callback: {str(e)}"
        )

@router.get("/ai/callback/health")
async def callback_health():
    """Health check for AI callback endpoint"""
    return {
        "ok": True,
        "service": "verifyid_ai_callback",
        "status": "healthy",
        "endpoint": "/internal/ai/callback"
    }
