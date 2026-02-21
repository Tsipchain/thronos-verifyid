"""AI Fraud Service — automated fraud detection and risk scoring."""

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from models.verifications import DocumentVerifications
from models.video_call_queue import CallPriority
from services.aihub_client import AIHubClient
import logging

logger = logging.getLogger(__name__)


class AIFraudResult(BaseModel):
    fraud_score: int
    risk_level: str
    priority: CallPriority
    explanation: str
    flags: list[str]


class AIFraudService:
    """Service for AI-powered fraud detection."""

    # Thresholds
    AUTO_REJECT_THRESHOLD = 30  # fraud_score < 30 → auto-reject
    HIGH_PRIORITY_THRESHOLD = 80  # fraud_score > 80 → high priority queue
    
    @staticmethod
    async def analyze_document(
        db: AsyncSession,
        verification: DocumentVerifications,
    ) -> AIFraudResult:
        """
        Run AI fraud analysis on a document verification.
        
        Returns:
            AIFraudResult with fraud_score, risk_level, priority, etc.
        """
        # Build payload for AI Core
        payload = {
            "document_type": verification.document_type.value,
            "full_name": verification.full_name,
            "document_number": verification.document_number,
            "date_of_birth": verification.date_of_birth.isoformat() if verification.date_of_birth else None,
            "nationality": verification.nationality,
            "issuing_country": verification.issuing_country,
            "expiry_date": verification.expiry_date.isoformat() if verification.expiry_date else None,
        }

        # Call AI Hub
        ai_response = await AIHubClient.analyze_document(payload)

        fraud_score = ai_response.get("fraud_score", 50)
        risk_level = ai_response.get("risk_level", "medium")
        explanation = ai_response.get("explanation", "")
        flags = ai_response.get("flags", [])

        # Determine priority for video call queue
        if fraud_score >= AIFraudService.HIGH_PRIORITY_THRESHOLD:
            priority = CallPriority.HIGH
        elif fraud_score <= 40:
            priority = CallPriority.LOW
        else:
            priority = CallPriority.NORMAL

        logger.info(
            f"AI fraud analysis complete: verification_id={verification.id} "
            f"fraud_score={fraud_score} risk={risk_level} priority={priority.value}"
        )

        return AIFraudResult(
            fraud_score=fraud_score,
            risk_level=risk_level,
            priority=priority,
            explanation=explanation,
            flags=flags,
        )

    @staticmethod
    def should_auto_reject(fraud_score: int) -> bool:
        """Check if verification should be auto-rejected."""
        return fraud_score < AIFraudService.AUTO_REJECT_THRESHOLD

    @staticmethod
    def should_require_video(fraud_score: int) -> bool:
        """Check if verification requires video call."""
        return fraud_score >= AIFraudService.AUTO_REJECT_THRESHOLD
