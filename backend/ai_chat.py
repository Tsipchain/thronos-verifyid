"""AI Chat endpoint for Agent Dashboard modal

This module provides AI assistance to VerifyID KYC agents via the dashboard modal.
Forwards chat requests to Thronos AI Core (ai.thronoschain.org) using internal key.

Endpoints:
- POST /api/ai/chat - Send message to AI assistant
- GET /api/ai/status - Check AI Core availability
"""
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
import httpx
import os
import logging
from typing import Optional

router = APIRouter()
logger = logging.getLogger(__name__)

AI_CORE_URL = os.getenv("THRONOS_AI_CORE_URL", "https://ai.thronoschain.org")
AI_KEY = os.getenv("APP_AI_KEY", "")

class ChatRequest(BaseModel):
    """Agent chat request payload"""
    message: str = Field(..., min_length=1, max_length=4000, description="User message to AI")
    context: Optional[str] = Field(default=None, description="Optional conversation context")
    agent_id: Optional[str] = Field(default=None, description="Agent making the request")

class ChatResponse(BaseModel):
    """AI chat response"""
    response: str = Field(..., description="AI assistant response")
    model: str = Field(default="claude-sonnet-4.5", description="AI model used")
    tokens_used: int = Field(default=0, description="Tokens consumed")

@router.post("/api/ai/chat", response_model=ChatResponse, tags=["ai"])
async def agent_ai_chat(
    payload: ChatRequest,
    authorization: str = Header(None)
):
    """
    AI chat endpoint for Agent Dashboard modal.
    Forwards requests to Thronos AI Core for processing.
    
    Args:
        payload: Chat request with message and optional context
        authorization: Bearer token (optional for now)
    
    Returns:
        ChatResponse with AI-generated reply
    
    Raises:
        HTTPException: If AI_KEY not configured or AI Core unavailable
    """
    if not AI_KEY:
        logger.error("[AI Chat] APP_AI_KEY not configured")
        raise HTTPException(500, "AI chat not configured")
    
    logger.info(f"[AI Chat] Agent {payload.agent_id or 'unknown'} asked: {payload.message[:50]}...")
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{AI_CORE_URL}/api/chat",
                json={
                    "message": payload.message,
                    "context": payload.context or "VerifyID KYC Agent Dashboard",
                    "system_prompt": (
                        "You are a helpful AI assistant for VerifyID KYC agents. "
                        "Provide accurate information about KYC processes, fraud detection, "
                        "document verification, and Delphi-3 training. Be concise and professional."
                    )
                },
                headers={
                    "X-Internal-Key": AI_KEY,
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code != 200:
                logger.error(f"[AI Chat] AI Core returned {response.status_code}: {response.text}")
                raise HTTPException(502, "AI Core unavailable")
            
            data = response.json()
            
            logger.info(f"[AI Chat] Response received: {len(data.get('response', ''))} chars")
            
            return ChatResponse(
                response=data.get("response", "No response from AI"),
                model=data.get("model", "claude-sonnet-4.5"),
                tokens_used=data.get("tokens_used", 0)
            )
    
    except httpx.TimeoutException:
        logger.error("[AI Chat] Request to AI Core timed out")
        raise HTTPException(504, "AI request timed out - please try again")
    except httpx.HTTPError as e:
        logger.error(f"[AI Chat] HTTP error: {e}")
        raise HTTPException(502, f"AI Core error: {str(e)}")
    except Exception as e:
        logger.error(f"[AI Chat] Unexpected error: {e}")
        raise HTTPException(500, f"Chat failed: {str(e)}")

@router.get("/api/ai/status", tags=["ai"])
async def ai_status():
    """
    Check if AI Core is available and properly configured.
    
    Returns:
        Status object with availability and configuration info
    """
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
        logger.warning(f"[AI Status] AI Core health check failed: {e}")
        return {
            "ok": False,
            "ai_core": AI_CORE_URL,
            "enabled": bool(AI_KEY),
            "status": "unavailable"
        }
