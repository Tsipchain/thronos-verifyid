"""AI Chat endpoint for Agent Dashboard modal.

Simple chat interface for agents without credit billing.
Forwards requests to Thronos AI Core (ai.thronoschain.org).

This is separate from the credit-billed ai_assistant router.
"""
import logging
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
import httpx
import os
from typing import Optional

logger = logging.getLogger(__name__)

AI_CORE_URL = os.getenv("THRONOS_AI_CORE_URL", "https://ai.thronoschain.org")
AI_KEY = os.getenv("APP_AI_KEY", "")

router = APIRouter(prefix="/api/ai", tags=["ai-chat"])

class ChatRequest(BaseModel):
    """Simple chat request"""
    message: str = Field(..., min_length=1, max_length=4000)
    context: Optional[str] = Field(default=None)
    agent_id: Optional[str] = Field(default=None)

class ChatResponse(BaseModel):
    """AI chat response"""
    response: str
    model: str = "claude-sonnet-4.5"
    tokens_used: int = 0

@router.post("/chat", response_model=ChatResponse)
async def agent_chat(
    payload: ChatRequest,
    authorization: str = Header(None)
):
    """
    Free AI chat for Agent Dashboard modal.
    No credit billing - simple forward to AI Core.
    """
    if not AI_KEY:
        logger.error("[AI Chat] APP_AI_KEY not configured")
        raise HTTPException(500, "AI chat not configured")
    
    logger.info(f"[AI Chat] Agent {payload.agent_id or 'unknown'}: {payload.message[:50]}...")
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{AI_CORE_URL}/api/chat",
                json={
                    "message": payload.message,
                    "context": payload.context or "VerifyID Agent",
                    "system_prompt": "You are a helpful AI assistant for VerifyID KYC agents. Provide concise, professional answers about KYC processes, fraud detection, and document verification."
                },
                headers={
                    "X-Internal-Key": AI_KEY,
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code != 200:
                logger.error(f"[AI Chat] AI Core {response.status_code}: {response.text}")
                raise HTTPException(502, "AI Core unavailable")
            
            data = response.json()
            logger.info(f"[AI Chat] Response: {len(data.get('response', ''))} chars")
            
            return ChatResponse(
                response=data.get("response", "No response from AI"),
                model=data.get("model", "claude-sonnet-4.5"),
                tokens_used=data.get("tokens_used", 0)
            )
    
    except httpx.TimeoutException:
        logger.error("[AI Chat] Timeout")
        raise HTTPException(504, "AI request timed out - please try again")
    except httpx.HTTPError as e:
        logger.error(f"[AI Chat] HTTP error: {e}")
        raise HTTPException(502, f"AI Core error: {str(e)}")
    except Exception as e:
        logger.error(f"[AI Chat] Unexpected error: {e}")
        raise HTTPException(500, f"Chat failed: {str(e)}")

@router.get("/status")
async def chat_status():
    """Check AI Core availability"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{AI_CORE_URL}/health")
            is_available = response.status_code == 200
            return {
                "ok": is_available,
                "ai_core": AI_CORE_URL,
                "enabled": bool(AI_KEY),
                "status": "operational" if is_available else "degraded"
            }
    except Exception as e:
        logger.warning(f"[AI Status] Health check failed: {e}")
        return {
            "ok": False,
            "ai_core": AI_CORE_URL,
            "enabled": bool(AI_KEY),
            "status": "unavailable"
        }
