"""Notify CareerForge that a user's KYC verification has been completed.

Triggers the one-time free pack grant on the CareerForge side.
Fire-and-forget: errors are logged but never re-raised so they cannot
break the verification finalize flow.

Env vars:
    CAREERFORGE_URL       – base URL of the CareerForge service
                            (e.g. https://careerforge.thronoschain.org)
    VERIFYID_INTERNAL_KEY – shared secret sent as X-Internal-Key header
"""
import os
import logging

import httpx

logger = logging.getLogger(__name__)

_CAREERFORGE_URL: str = os.getenv('CAREERFORGE_URL', '').rstrip('/')
_INTERNAL_KEY: str = os.getenv('VERIFYID_INTERNAL_KEY', '')


async def notify_verification_complete(user_id: str, verification_id: int) -> None:
    """POST to CareerForge /v1/verifyid/callback to grant the free pack.

    Safe to await directly from a FastAPI endpoint – all exceptions are
    caught internally so the caller's response is never affected.
    """
    if not _CAREERFORGE_URL:
        logger.warning(
            '[CF notify] CAREERFORGE_URL not set – skipping free-pack grant for user %s',
            user_id,
        )
        return

    url = f'{_CAREERFORGE_URL}/v1/verifyid/callback'
    payload = {'user_id': user_id, 'verification_id': verification_id}
    headers = {
        'X-Internal-Key': _INTERNAL_KEY,
        'Content-Type': 'application/json',
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            if data.get('granted'):
                logger.info(
                    '[CF notify] Free pack granted – user=%s verification=%d credits=%s',
                    user_id, verification_id, data.get('credits'),
                )
            else:
                logger.info(
                    '[CF notify] Free pack already granted – user=%s reason=%s',
                    user_id, data.get('reason'),
                )
    except Exception as exc:
        logger.error(
            '[CF notify] Failed to notify CareerForge for user=%s verification=%d: %s',
            user_id, verification_id, exc,
        )
