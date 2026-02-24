"""AI Fraud Service — automated fraud detection and risk scoring.

fraud_score semantics: 0 = certainly genuine, 100 = certainly fraudulent.
Higher score = higher fraud probability = higher urgency for human review.
"""

from datetime import date
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

    # Thresholds (fraud_score = 0–100, higher = more suspicious)
    AUTO_REJECT_THRESHOLD = 88     # fraud_score >= 88  → auto-reject (clearly fraudulent)
    AUTO_APPROVE_THRESHOLD = 15    # fraud_score <= 15  → auto-approve (clearly genuine)
    URGENT_THRESHOLD = 75          # fraud_score >= 75  → URGENT queue
    HIGH_THRESHOLD = 55            # fraud_score >= 55  → HIGH priority
    NORMAL_THRESHOLD = 35          # fraud_score >= 35  → NORMAL priority
    # fraud_score < 35             → LOW priority (likely genuine, routine check)

    # ── Public API ────────────────────────────────────────────────────────────

    @staticmethod
    async def analyze_document(
        db: AsyncSession,
        verification: DocumentVerifications,
    ) -> AIFraudResult:
        """
        Run AI fraud analysis on a document verification.

        Tries the external AI Hub first.  If unavailable, falls back to a
        local rule-based heuristic that inspects the actual document fields.
        """
        payload = {
            "document_type": verification.document_type.value,
            "full_name": verification.full_name,
            "document_number": verification.document_number,
            "date_of_birth": verification.date_of_birth.isoformat() if verification.date_of_birth else None,
            "nationality": verification.nationality,
            "issuing_country": verification.issuing_country,
            "expiry_date": verification.expiry_date.isoformat() if verification.expiry_date else None,
        }

        ai_response = await AIHubClient.analyze_document(payload)

        # Detect fallback / unavailable response from the client
        if ai_response.get("explanation") == "AI analysis temporarily unavailable":
            logger.info("AI Hub unavailable — using local heuristic scorer for verification %s", verification.id)
            return AIFraudService._local_heuristic_score(verification)

        fraud_score = max(0, min(100, int(ai_response.get("fraud_score", 50))))
        risk_level  = ai_response.get("risk_level", "medium")
        explanation = ai_response.get("explanation", "AI analysis completed")
        flags       = ai_response.get("flags", [])

        priority = AIFraudService._score_to_priority(fraud_score)

        logger.info(
            "AI fraud analysis: verification_id=%s fraud_score=%s risk=%s priority=%s",
            verification.id, fraud_score, risk_level, priority.value,
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
        """True when the document is almost certainly fraudulent (no human review needed)."""
        return fraud_score >= AIFraudService.AUTO_REJECT_THRESHOLD

    @staticmethod
    def should_auto_approve(fraud_score: int) -> bool:
        """True when the document is almost certainly genuine (no human review needed)."""
        return fraud_score <= AIFraudService.AUTO_APPROVE_THRESHOLD

    @staticmethod
    def should_require_video(fraud_score: int) -> bool:
        """True when a human video verification session is advisable."""
        return AIFraudService.AUTO_APPROVE_THRESHOLD < fraud_score < AIFraudService.AUTO_REJECT_THRESHOLD

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _score_to_priority(fraud_score: int) -> CallPriority:
        if fraud_score >= AIFraudService.URGENT_THRESHOLD:
            return CallPriority.URGENT
        if fraud_score >= AIFraudService.HIGH_THRESHOLD:
            return CallPriority.HIGH
        if fraud_score >= AIFraudService.NORMAL_THRESHOLD:
            return CallPriority.NORMAL
        return CallPriority.LOW

    @staticmethod
    def _local_heuristic_score(verification: DocumentVerifications) -> AIFraudResult:
        """
        Rule-based fraud scorer used when the external AI Hub is unavailable.
        Starts from a moderate base and adjusts based on document field quality.

        Score increases (more suspicious) for:
          • Expired documents                (+55)
          • Missing full name                (+15)
          • Missing document number          (+15)
          • Missing date of birth            (+10)
          • Missing nationality/country      ( +5 each)
          • Expiry < 1 month away (nearly expiring, higher forgery risk) (+10)

        Score decreases (less suspicious) for:
          • All key fields present           (-10)
          • Valid expiry > 1 year away       ( -5)
        """
        score: int = 35  # moderate baseline — assume unknown
        flags: list[str] = []

        today = date.today()

        # ── Expiry checks ──────────────────────────────────────────────────
        if verification.expiry_date:
            exp = verification.expiry_date
            if isinstance(exp, str):
                try:
                    from datetime import datetime as _dt
                    exp = _dt.fromisoformat(exp).date()
                except Exception:
                    exp = None

            if exp:
                if exp < today:
                    score += 55
                    flags.append("Document is expired")
                elif (exp - today).days < 30:
                    score += 10
                    flags.append("Document expires within 30 days (elevated risk)")
                elif (exp - today).days > 365:
                    score -= 5  # valid long-dated doc is less suspicious
        else:
            score += 8
            flags.append("Expiry date not extracted")

        # ── Field completeness ─────────────────────────────────────────────
        missing: list[str] = []
        if not verification.full_name:
            score += 15
            missing.append("full name")
        if not verification.document_number:
            score += 15
            missing.append("document number")
        if not verification.date_of_birth:
            score += 10
            missing.append("date of birth")
        if not verification.nationality:
            score += 5
            missing.append("nationality")
        if not verification.issuing_country:
            score += 5
            missing.append("issuing country")

        if missing:
            flags.append(f"Fields not extracted: {', '.join(missing)}")
        else:
            score -= 10  # all fields present — encouraging sign

        score = max(0, min(100, score))

        if score >= 75:
            risk_level = "high"
        elif score >= 50:
            risk_level = "medium"
        elif score >= 25:
            risk_level = "low"
        else:
            risk_level = "very_low"

        priority = AIFraudService._score_to_priority(score)
        flag_summary = "; ".join(flags) if flags else "No red flags detected"
        explanation = (
            f"Local rule-based score (AI Hub unavailable). "
            f"Score: {score}/100. Findings: {flag_summary}."
        )

        logger.info(
            "Local heuristic score: verification_id=%s fraud_score=%s flags=%s",
            verification.id, score, flags,
        )

        return AIFraudResult(
            fraud_score=score,
            risk_level=risk_level,
            priority=priority,
            explanation=explanation,
            flags=flags,
        )
