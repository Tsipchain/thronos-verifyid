"""Compatibility router for legacy AI Assistant endpoints.

Supports the old frontend path:
- /api/v1/ai/hub/thronos-chat

This is kept only for backwards compatibility. New frontends
should call the billed /api/v1/aihub/thronos-chat endpoint,
which is handled by `aihub.thronos_chat` and performs
proper credit deduction.
"""
import logging

from fastapi import APIRouter, Header

from .ai_chat import ChatRequest, agent_chat

logger = logging.getLogger(__name__)

# No prefix so we can register the full legacy path explicitly
router = APIRouter(tags=["ai-compat"])


@router.post("/api/v1/ai/hub/thronos-chat")
async def thronos_chat_legacy_hub(
    payload: ChatRequest,
    authorization: str = Header(None),
):
    """Legacy endpoint with `/api/v1/ai/hub` prefix.

    Forwards to the free /api/ai/chat endpoint without
    any credit billing. New VerifyID frontends should
    NOT use this path; they should call /api/v1/aihub/thronos-chat
    instead so that credits are deducted correctly.
    """
    logger.info("[AI Compat] /api/v1/ai/hub/thronos-chat → /api/ai/chat")
    return await agent_chat(payload=payload, authorization=authorization)
