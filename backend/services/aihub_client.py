"""AI Hub client — wrapper for Thronos AI Core internal service calls."""

import httpx
import logging
from typing import Optional
from core.config import settings

logger = logging.getLogger(__name__)


class AIHubClient:
    """Client for communicating with Thronos AI Core."""

    @staticmethod
    async def analyze_document(payload: dict) -> dict:
        """
        Analyze document for fraud detection.
        
        Args:
            payload: Document metadata and features
            
        Returns:
            {
                "fraud_score": int,
                "risk_level": str,
                "explanation": str,
                "flags": list
            }
        """
        url = f"{settings.THRONOS_AI_CORE_URL}/api/v1/fraud/document"
        headers = {
            "X-API-Key": settings.THRONOS_AI_INTERNAL_KEY,
            "Content-Type": "application/json",
        }
        
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPError as e:
            logger.error(f"AI Hub document analysis failed: {e}")
            # Return safe defaults on error
            return {
                "fraud_score": 50,
                "risk_level": "medium",
                "explanation": "AI analysis temporarily unavailable",
                "flags": [],
            }

    @staticmethod
    async def ask_assistant(
        prompt: str,
        context: str = "",
        user_role: str = "agent",
    ) -> dict:
        """
        Ask AI Assistant for help.
        
        Args:
            prompt: User's question
            context: Additional context (verification ID, document type, etc.)
            user_role: agent | manager | admin
            
        Returns:
            {
                "answer": str,
                "confidence": float,
                "sources": list
            }
        """
        url = f"{settings.THRONOS_AI_CORE_URL}/api/v1/assistant/ask"
        headers = {
            "X-API-Key": settings.THRONOS_AI_INTERNAL_KEY,
            "Content-Type": "application/json",
        }
        
        payload = {
            "prompt": prompt,
            "context": context,
            "role": user_role,
            "service": "verifyid",
        }
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(url, json=payload, headers=headers)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPError as e:
            logger.error(f"AI Assistant request failed: {e}")
            raise Exception(f"AI Assistant unavailable: {str(e)}")

    @staticmethod
    async def health_check() -> bool:
        """Check if AI Core is reachable."""
        url = f"{settings.THRONOS_AI_CORE_URL}/health"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
                return response.status_code == 200
        except:
            return False
