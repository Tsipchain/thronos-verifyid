"""Compatibility router for legacy AI Assistant endpoint.

Maps old frontend path `/api/v1/ai/hub/thronos-chat` to the new
AI chat handler defined in `ai_chat.py`.

This lets existing frontends keep using the old URL while the
backend forwards everything to the unified `/api/ai/chat` logic.
"""
import logging

from fastapi import APIRouter, Header

from .ai_chat import ChatRequest, agent_chat

logger = logging.getLogger(__name__)

# Legacy prefix used by the existing frontend
router = APIRouter(prefix="/api/v1/ai/hub", tags=["ai-compat"])


@router.post("/thronos-chat")
async def thronos_chat_legacy(
    payload: ChatRequest,
    authorization: str = Header(None),
):
    """Backward‑compatible AI chat endpoint.

    The current frontend still calls:
        POST /api/v1/ai/hub/thronos-chat

    This wrapper just forwards the request to the new
    `agent_chat` handler in `ai_chat.py`, so all billing,
    logging and error handling stays in one place.

    We also return a plain dict (no response_model) to avoid
    any Pydantic serialization by_alias issues.
    """
    logger.info("[AI Compat] /api/v1/ai/hub/thronos-chat → /api/ai/chat")
    return await agent_chat(payload=payload, authorization=authorization)
