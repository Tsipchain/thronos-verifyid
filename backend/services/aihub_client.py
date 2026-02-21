"""Thronos AI Core HTTP Client

Handles communication with Thronos AI Core for fraud detection
and document analysis.
"""
import logging
from typing import Dict, Any

import httpx
from fastapi import HTTPException

from core.config import settings

logger = logging.getLogger(__name__)


class AIHubClient:
    """HTTP client for Thronos AI Core"""

    # Timeout for AI analysis requests (seconds)
    REQUEST_TIMEOUT = 30.0

    @staticmethod
    async def analyze_document(payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Send document data to Thronos AI Core for fraud analysis.

        Args:
            payload: Document data including:
                - document_type: Type of document (passport, id_card, etc.)
                - full_name: Person's full name
                - document_number: Document identification number
                - date_of_birth: ISO date string
                - nationality: Country code
                - age: Calculated age

        Returns:
            Dict containing:
                - fraud_score (int): 0-100, higher = more legitimate
                - risk_level (str): "low" | "medium" | "high"
                - explanation (str): Human-readable analysis
                - confidence (float): Model confidence 0-1

        Raises:
            HTTPException: If AI Core is unavailable or returns error
        """
        # Validate configuration
        if not settings.THRONOS_AI_CORE_URL:
            logger.error("THRONOS_AI_CORE_URL not configured")
            raise HTTPException(
                status_code=500,
                detail="AI Core URL not configured"
            )

        if not settings.THRONOS_AI_INTERNAL_KEY:
            logger.error("THRONOS_AI_INTERNAL_KEY not configured")
            raise HTTPException(
                status_code=500,
                detail="AI Core authentication not configured"
            )

        # Construct endpoint URL
        url = f"{settings.THRONOS_AI_CORE_URL}/api/v1/fraud/document"

        # Prepare headers with authentication
        headers = {
            "X-API-Key": settings.THRONOS_AI_INTERNAL_KEY,
            "Content-Type": "application/json",
            "X-Service-Name": "thronos-verifyid",
        }

        try:
            logger.info(f"Calling AI Core at {url}")
            async with httpx.AsyncClient(timeout=AIHubClient.REQUEST_TIMEOUT) as client:
                response = await client.post(
                    url,
                    json=payload,
                    headers=headers,
                )

                # Check response status
                if response.status_code == 401:
                    logger.error("AI Core authentication failed")
                    raise HTTPException(
                        status_code=500,
                        detail="AI Core authentication failed"
                    )

                if response.status_code == 429:
                    logger.warning("AI Core rate limit exceeded")
                    raise HTTPException(
                        status_code=503,
                        detail="AI analysis temporarily unavailable (rate limit)"
                    )

                response.raise_for_status()
                result = response.json()

                logger.info(f"AI Core response: fraud_score={result.get('fraud_score')}")
                return result

        except httpx.TimeoutException:
            logger.error(f"AI Core request timed out after {AIHubClient.REQUEST_TIMEOUT}s")
            raise HTTPException(
                status_code=504,
                detail="AI analysis timed out"
            )

        except httpx.HTTPError as e:
            logger.error(f"AI Core HTTP error: {e}")
            raise HTTPException(
                status_code=503,
                detail=f"AI Core unavailable: {str(e)}"
            )

        except Exception as e:
            logger.error(f"Unexpected error calling AI Core: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"AI analysis failed: {str(e)}"
            )

    @staticmethod
    async def health_check() -> bool:
        """
        Check if AI Core is reachable.

        Returns:
            True if AI Core is healthy, False otherwise
        """
        if not settings.THRONOS_AI_CORE_URL:
            return False

        try:
            url = f"{settings.THRONOS_AI_CORE_URL}/health"
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
                return response.status_code == 200
        except Exception as e:
            logger.warning(f"AI Core health check failed: {e}")
            return False
