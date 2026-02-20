"""
AI Hub router module.
Provides Generate Text (gentxt) and Generate Image (genimg) API endpoints.
thronos-chat: authenticated chat with credit deduction, Thronos AI Core primary
with OpenAI-compatible gentxt fallback, and document fraud knowledge injection.
"""

import ast
import json
import logging
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.database import get_db
from dependencies.auth import get_current_user
from schemas.auth import UserResponse
from schemas.aihub import ChatMessage, GenImgRequest, GenImgResponse, GenTxtRequest
from services.aihub import AIHubService, InvalidImageInputError
from services.fraud_knowledge import get_fraud_knowledge_system_prompt
from sse_starlette.sse import EventSourceResponse

logger = logging.getLogger(__name__)


def _try_extract_message_from_dict(data: dict) -> str | None:
    """Try to extract message field from a dictionary."""
    # Try to extract error.message format
    if "error" in data and isinstance(data["error"], dict):
        if "message" in data["error"]:
            return data["error"]["message"]
    # Try to extract message field directly
    if "message" in data:
        return data["message"]
    return None


def _try_parse_dict(s: str) -> dict | None:
    """
    Try to parse a string as a dictionary.
    First attempts JSON parsing, then falls back to Python literal eval (for single quotes).
    """
    # Try JSON parsing (double quotes format)
    try:
        data = json.loads(s)
        if isinstance(data, dict):
            return data
    except (json.JSONDecodeError, TypeError):
        pass

    # Try Python literal eval (single quotes format)
    try:
        data = ast.literal_eval(s)
        if isinstance(data, dict):
            return data
    except (ValueError, SyntaxError, TypeError):
        pass

    return None


def extract_error_message(error: Any) -> str:
    """
    Extract a readable error message from an error object.
    Attempts to parse JSON/Python dict format and extract the message field.
    Falls back to the full error string if parsing fails.

    Supported formats:
    - Pure JSON: {"error": {"message": "..."}}
    - Python dict: {'error': {'message': '...'}}
    - With prefix: Error code: 400 - {'error': {'message': '...'}}

    Args:
        error: Error object, can be an Exception or other types

    Returns:
        Extracted error message string
    """
    error_str = str(error)

    # Try to parse the entire string directly
    error_data = _try_parse_dict(error_str)
    if error_data:
        message = _try_extract_message_from_dict(error_data)
        if message:
            return message

    # Try to extract dict portion from string (handles "Error code: 400 - {...}" format)
    start_idx = error_str.find("{")
    end_idx = error_str.rfind("}")
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        dict_str = error_str[start_idx : end_idx + 1]
        error_data = _try_parse_dict(dict_str)
        if error_data:
            message = _try_extract_message_from_dict(error_data)
            if message:
                return message

    # If parsing fails, return the original error string
    return error_str


router = APIRouter(prefix="/api/v1/aihub", tags=["aihub"])


class ThronosChatMessage(BaseModel):
    role: str
    content: str


class ThronosChatRequest(BaseModel):
    messages: list[ThronosChatMessage]
    # First available model on Thronos AI Core / gentxt fallback
    model: str = Field(default="claude-sonnet-4-6")
    temperature: float = Field(default=0.3, ge=0.0, le=1.0)


class ThronosChatResponse(BaseModel):
    content: str
    credits_used: int = 10
    credits_remaining: Optional[int] = None


async def _chat_via_thronos_core(messages: list[dict], model: str, temperature: float) -> Optional[str]:
    """Try Thronos AI Core. Returns response text or None on failure."""
    if not settings.thronos_ai_core_url:
        return None
    headers = {"X-Admin-Secret": settings.thronos_admin_secret} if settings.thronos_admin_secret else {}
    payload = {"model": model, "messages": messages, "temperature": temperature}
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{settings.thronos_ai_core_url}/api/ai/chat", json=payload, headers=headers)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("response") or data.get("content") or None
        logger.warning(f"Thronos AI Core returned {resp.status_code}")
    except Exception as e:
        logger.warning(f"Thronos AI Core unreachable, using fallback: {e}")
    return None


async def _chat_via_gentxt(messages: list[dict], model: str, temperature: float) -> str:
    """Fallback: use the OpenAI-compatible gentxt service."""
    service = AIHubService()
    chat_messages = [ChatMessage(role=m["role"], content=m["content"]) for m in messages]
    req = GenTxtRequest(messages=chat_messages, model=model, temperature=temperature, stream=False)
    result = await service.gentxt(req)
    return result.content


def _inject_fraud_knowledge(messages: list[ThronosChatMessage]) -> list[dict]:
    """Prepend fraud detection knowledge to the system message (or insert one)."""
    fraud_knowledge = get_fraud_knowledge_system_prompt()
    msgs = [m.model_dump() for m in messages]
    for msg in msgs:
        if msg["role"] == "system":
            msg["content"] = fraud_knowledge + "\n\n" + msg["content"]
            return msgs
    msgs.insert(0, {"role": "system", "content": fraud_knowledge})
    return msgs


@router.post("/gentxt")
async def generate_text(
    request: GenTxtRequest,
):
    """
    Generate Text endpoint (supports text and image input).

    Use the `stream` request parameter to control streaming behavior:
    - stream=false: return a full JSON response
    - stream=true: return an SSE streaming response

    Available models:
    - gpt-5-chat: high stability and compliance, suitable for JSON output and customer service scenarios
    - gemini-2.5-pro: production-grade multimodal model for daily multimodal tasks
    - gemini-3-pro-preview: deep reasoning and ultra-long context (1M+ tokens)
    - claude-4-5-sonnet: ideal for complex engineering and cross-file code refactoring
    - deepseek-v3.2: large-scale batch processing in cost-sensitive scenarios (text only)
    """
    try:
        service = AIHubService()

        # Decide response mode based on the `stream` parameter
        if request.stream:
            # Streaming response - wrap content in JSON for SSE
            async def event_generator():
                try:
                    async for content in service.gentxt_stream(request):
                        yield json.dumps({"content": content})
                except Exception as e:
                    logger.error(f"Stream error: {e}")
                    yield json.dumps({"content": f"[ERROR] {extract_error_message(e)}"})
                finally:
                    yield "[DONE]"

            return EventSourceResponse(event_generator(), media_type="text/event-stream")
        else:
            # Non-streaming response
            response = await service.gentxt(request)
            return response

    except ValueError as e:
        logger.error(f"AI service configuration error: {e}")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=extract_error_message(e))
    except Exception as e:
        logger.error(f"Text generation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=extract_error_message(e),
        )


@router.post("/thronos-chat", response_model=ThronosChatResponse)
async def thronos_chat(
    request: ThronosChatRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Authenticated AI assistant chat with credit deduction.
    Primary: Thronos AI Core. Fallback: gentxt (OpenAI-compatible).
    Document fraud detection knowledge is automatically injected.
    Each request costs 10 credits. New users receive 50 free credits.
    """
    from routers.credits import deduct_credits, get_or_create_credits, AI_REQUEST_COST

    # Check credit balance (fail fast before expensive AI call)
    ledger = await get_or_create_credits(db, current_user.id)
    if ledger.balance < AI_REQUEST_COST:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=f"Insufficient credits ({ledger.balance}/{AI_REQUEST_COST}). Please purchase more credits at /credits.",
        )

    # Inject fraud detection knowledge into the conversation
    enriched_messages = _inject_fraud_knowledge(request.messages)

    # --- Primary: Thronos AI Core ---
    content = await _chat_via_thronos_core(enriched_messages, request.model, request.temperature)

    # --- Fallback: OpenAI-compatible gentxt ---
    if content is None:
        try:
            content = await _chat_via_gentxt(enriched_messages, request.model, request.temperature)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI service unavailable. Configure APP_AI_BASE_URL and APP_AI_KEY.",
            )
        except Exception as e:
            logger.error(f"gentxt fallback failed: {e}")
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=extract_error_message(e))

    if not content:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI returned an empty response")

    # Deduct credits after successful response
    new_balance = await deduct_credits(
        db=db,
        user_id=current_user.id,
        amount=AI_REQUEST_COST,
        description=f"AI assistant chat ({request.model})",
    )

    return ThronosChatResponse(content=content, credits_used=AI_REQUEST_COST, credits_remaining=new_balance)


@router.post("/genimg", response_model=GenImgResponse)
async def generate_image(
    request: GenImgRequest,
):
    """
    Text-to-Image / Image-to-Image endpoint.

    Generate images based on the given prompt.
    If `image` is provided, the endpoint uses the OpenAI-compatible `images/edits` API to edit the input image.

    Available models:
    - gemini-2.5-flash-image: visual creativity and editing, marketing asset generation, partial image editing
    - gemini-3-pro-image-preview: higher quality image generation/editing

    Parameters:
    - image: optional input image(s). Supports a base64 data URI string or a list of base64 data URIs. If provided, runs image editing (img2img).
    - size: image size (1024x1024 / 1024x1792 / 1792x1024)
    - quality: image quality (standard / hd). Only effective for text-to-image; ignored when `image` is provided.
    - n: number of images to generate (1-4)
    """
    try:
        service = AIHubService()
        return await service.genimg(request)

    except InvalidImageInputError as e:
        logger.warning(f"Invalid image input: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except ValueError as e:
        logger.error(f"AI service configuration error: {e}")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=extract_error_message(e))
    except Exception as e:
        logger.error(f"Image generation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=extract_error_message(e),
        )
