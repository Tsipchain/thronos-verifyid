"""AI Fraud Detection Service

Integrates with Thronos AI Core to analyze verification documents
and determine fraud risk level.
"""
import logging
from datetime import date
from typing import Optional

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from models.verifications import DocumentVerifications
from models.video_call_queue import CallPriority
from services.aihub_client import AIHubClient

logger = logging.getLogger(__name__)


class AIFraudResult(BaseModel):
    """Result of AI fraud analysis"""
    fraud_score: int  # 0-100 (higher = more likely legitimate)
    risk_level: str  # "low" | "medium" | "high"
    priority: CallPriority  # Queue priority for video call
    explanation: Optional[str] = None  # Human-readable explanation
    confidence: Optional[float] = None  # Model confidence 0-1


class AIFraudService:
    """Service for AI-powered fraud detection"""

    # Thresholds for decision making
    AUTO_REJECT_THRESHOLD = 30  # Below this, auto-reject
    HIGH_RISK_THRESHOLD = 50  # Below this, high priority review
    LOW_RISK_THRESHOLD = 80  # Above this, low priority

    @staticmethod
    async def analyze_document(
        db: AsyncSession,
        verification: DocumentVerifications,
    ) -> AIFraudResult:
        """
        Analyze a document verification using Thronos AI Core.

        Args:
            db: Database session
            verification: DocumentVerification record to analyze

        Returns:
            AIFraudResult with fraud score and risk assessment
        """
        try:
            # Prepare payload for AI Core
            payload = {
                "document_type": verification.document_type.value,
                "full_name": verification.full_name,
                "document_number": verification.document_number,
                "date_of_birth": verification.date_of_birth.isoformat() if verification.date_of_birth else None,
                "nationality": verification.nationality,
                "issuing_country": verification.issuing_country,
                "expiry_date": verification.expiry_date.isoformat() if verification.expiry_date else None,
                # Age calculation
                "age": AIFraudService._calculate_age(verification.date_of_birth) if verification.date_of_birth else None,
            }

            # Call AI Core
            logger.info(f"Requesting AI analysis for verification {verification.id}")
            ai_response = await AIHubClient.analyze_document(payload)

            # Parse response
            fraud_score = int(ai_response.get("fraud_score", 50))
            risk_level = ai_response.get("risk_level", "medium")
            explanation = ai_response.get("explanation")
            confidence = ai_response.get("confidence")

            # Determine priority
            priority = AIFraudService._determine_priority(fraud_score)

            logger.info(
                f"AI analysis complete for verification {verification.id}: "
                f"score={fraud_score}, risk={risk_level}, priority={priority.value}"
            )

            return AIFraudResult(
                fraud_score=fraud_score,
                risk_level=risk_level,
                priority=priority,
                explanation=explanation,
                confidence=confidence,
            )

        except Exception as e:
            logger.error(f"AI fraud analysis failed for verification {verification.id}: {e}")
            # Fallback to medium risk if AI fails
            return AIFraudResult(
                fraud_score=50,
                risk_level="medium",
                priority=CallPriority.NORMAL,
                explanation=f"AI analysis unavailable: {str(e)}",
                confidence=0.0,
            )

    @staticmethod
    def _determine_priority(fraud_score: int) -> CallPriority:
        """
        Determine video call priority based on fraud score.

        Args:
            fraud_score: AI fraud score (0-100)

        Returns:
            CallPriority enum value
        """
        if fraud_score >= AIFraudService.LOW_RISK_THRESHOLD:
            return CallPriority.LOW
        elif fraud_score <= AIFraudService.HIGH_RISK_THRESHOLD:
            return CallPriority.HIGH
        else:
            return CallPriority.NORMAL

    @staticmethod
    def _calculate_age(dob: date) -> int:
        """Calculate age from date of birth"""
        today = date.today()
        return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))

    @staticmethod
    def should_auto_reject(fraud_score: int) -> bool:
        """
        Determine if verification should be auto-rejected without human review.

        Args:
            fraud_score: AI fraud score (0-100)

        Returns:
            True if should auto-reject
        """
        return fraud_score < AIFraudService.AUTO_REJECT_THRESHOLD
