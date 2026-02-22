"""Compatibility router for legacy AI Assistant endpoints.

Supports both of the old frontend paths:
- /api/v1/ai/hub/thronos-chat
- /api/v1/aihub/thronos-chat

Both are forwarded to the new AI chat handler defined
in `ai_chat.py` (POST /api/ai/chat).
"""
import logging

from fastapi import APIRouter, Header

from .ai_chat import ChatRequest, agent_chat

logger = logging.getLogger(__name__)

# No prefix so we can register full legacy paths explicitly
router = APIRouter(tags=["ai-compat"])


@router.post("/api/v1/ai/hub/thronos-chat")
async def thronos_chat_legacy_hub(
    payload: ChatRequest,
    authorization: str = Header(None),
):
    """Legacy endpoint with `/api/v1/ai/hub` prefix."""
    logger.info("[AI Compat] /api/v1/ai/hub/thronos-chat → /api/ai/chat")
    return await agent_chat(payload=payload, authorization=authorization)


@router.post("/api/v1/aihub/thronos-chat")
async def thronos_chat_legacy_aihubsquashed(
    payload: ChatRequest,
    authorization: str = Header(None),
):
    """Legacy endpoint with `/api/v1/aihub` (missing slash) prefix.

    Some frontend builds send requests to `/api/v1/aihub/thronos-chat`.
    This route ensures those still work by forwarding them to the same
    AI chat handler as the proper path.
    """
    logger.info("[AI Compat] /api/v1/aihub/thronos-chat → /api/ai/chat")
    return await agent_chat(payload=payload, authorization=authorization)
