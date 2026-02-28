"""AI Chat endpoint for Agent Dashboard modal.

Simple chat interface for agents without credit billing.
Forwards to /v1/assistant/ask on AI Core so the assistant answers as
VerifyID Assistant (KYC specialist), not as the generic Thronos AI.

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


@router.post("/chat")
async def agent_chat(
    payload: ChatRequest,
    authorization: str = Header(None)
):
    """Free AI chat for Agent Dashboard modal.

    Calls /v1/assistant/ask on AI Core — the KYC-specific endpoint —
    so the assistant answers as VerifyID Assistant, not as Thronos AI.
    """
    if not AI_KEY:
        logger.error("[AI Chat] APP_AI_KEY not configured")
        raise HTTPException(500, "AI chat not configured")

    logger.info(f"[AI Chat] Agent {payload.agent_id or 'unknown'}: {payload.message[:50]}...")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{AI_CORE_URL}/v1/assistant/ask",
                json={
                    "prompt": payload.message,
                    "context": payload.context or "",
                    "role": "agent",
                    "service": "verifyid",
                },
                headers={
                    "X-API-Key": AI_KEY,
                    "Content-Type": "application/json",
                },
            )

            if response.status_code != 200:
                logger.error("[AI Chat] AI Core %s: %s", response.status_code, response.text)
                raise HTTPException(502, "AI Core unavailable")

            data = response.json() or {}
            answer = data.get("answer") or data.get("response") or "No response from AI"
            logger.info("[AI Chat] Response: %d chars", len(answer))

            return {
                "response": answer,
                "model": "verifyid-assistant",
                "tokens_used": 0,
            }

    except httpx.TimeoutException:
        logger.error("[AI Chat] Timeout")
        raise HTTPException(504, "AI request timed out - please try again")
    except httpx.HTTPError as e:
        logger.error("[AI Chat] HTTP error: %s", e)
        raise HTTPException(502, f"AI Core error: {str(e)}")
    except Exception as e:
        logger.error("[AI Chat] Unexpected error: %s", e)
        raise HTTPException(500, f"Chat failed: {str(e)}")


@router.get("/status")
async def chat_status():
    """Check AI Core availability."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{AI_CORE_URL}/health")
            is_available = response.status_code == 200
            return {
                "ok": is_available,
                "ai_core": AI_CORE_URL,
                "enabled": bool(AI_KEY),
                "status": "operational" if is_available else "degraded",
            }
    except Exception as e:
        logger.warning("[AI Status] Health check failed: %s", e)
        return {
            "ok": False,
            "ai_core": AI_CORE_URL,
            "enabled": bool(AI_KEY),
            "status": "unavailable",
        }
