"""AI Assistant router — credit-billed AI help for agents and managers."""

import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from dependencies.auth import get_current_user
from schemas.auth import UserResponse
from routers.credits import deduct_credits, add_credits, AI_REQUEST_COST
from services.aihub_client import AIHubClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ai-assistant", tags=["ai-assistant"])


class AssistantRequest(BaseModel):
    prompt: str
    context: str = ""  # e.g., "verification_id:123", "document_type:passport"


class AssistantResponse(BaseModel):
    response: str
    confidence: float = 0.0
    sources: list[str] = []
    credits_remaining: int
    cost: int = AI_REQUEST_COST


class HealthCheckResponse(BaseModel):
    status: str
    ai_core_reachable: bool


@router.post("/ask", response_model=AssistantResponse)
async def ask_assistant(
    request: AssistantRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    AI Assistant for Agents/Managers.
    
    **Use cases:**
    - Analyze suspicious documents
    - Get fraud detection suggestions
    - Answer KYC/AML questions
    - Translate or explain document fields
    
    **Cost:** 10 credits per request.
    
    **Example:**
    ```json
    {
      "prompt": "Is this passport number format valid for Greece?",
      "context": "document_type:passport,nationality:GR"
    }
    ```
    """
    # 1. Deduct credits first (fail fast if insufficient)
    try:
        remaining = await deduct_credits(
            db=db,
            user_id=current_user.id,
            amount=AI_REQUEST_COST,
            description=f"AI Assistant: {request.prompt[:50]}...",
            reference_id=f"assistant_{current_user.id}",
        )
    except HTTPException as e:
        # 402 Payment Required → insufficient credits
        raise e

    # 2. Call Thronos AI Core
    try:
        ai_response = await AIHubClient.ask_assistant(
            prompt=request.prompt,
            context=request.context,
            user_role=current_user.role,
        )
        
        return AssistantResponse(
            response=ai_response.get("answer", ""),
            confidence=ai_response.get("confidence", 0.0),
            sources=ai_response.get("sources", []),
            credits_remaining=remaining,
            cost=AI_REQUEST_COST,
        )
        
    except Exception as e:
        logger.error(f"AI Assistant error: {e}")
        
        # Refund credits on AI Core failure
        await add_credits(
            db=db,
            user_id=current_user.id,
            amount=AI_REQUEST_COST,
            tx_type="refund",
            description="AI Assistant error - automatic refund",
            reference_id=f"refund_{current_user.id}",
        )
        
        raise HTTPException(
            status_code=503,
            detail="AI Assistant temporarily unavailable. Your credits have been refunded."
        )


@router.get("/health", response_model=HealthCheckResponse)
async def health_check(
    current_user: UserResponse = Depends(get_current_user),
):
    """Check if AI Core is reachable."""
    ai_reachable = await AIHubClient.health_check()
    return HealthCheckResponse(
        status="ok" if ai_reachable else "degraded",
        ai_core_reachable=ai_reachable,
    )
