import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from models.verifications import (
    DocumentVerifications,
    AgeVerifications,
    KYCForms,
    VideoVerifications,
    DigitalSignatures,
    FraudAnalysis,
    VerificationStatus,
    DocumentType
)
from schemas.verifications import (
    DocumentVerificationCreate,
    AgeVerificationCreate,
    KYCFormCreate,
    VideoVerificationCreate,
    DigitalSignatureCreate,
    FraudAnalysisCreate
)
from datetime import datetime
import random
import string
import json

logger = logging.getLogger(__name__)


class VerificationService:
    
    @staticmethod
    async def create_document_verification(
        db: AsyncSession,
        user_id: str,
        data: DocumentVerificationCreate
    ) -> DocumentVerifications:
        """Create a new document verification record"""
        # Simulate document extraction
        verification = DocumentVerifications(
            user_id=user_id,
            document_type=DocumentType(data.document_type),
            document_number=f"P{random.randint(10000000, 99999999)}",
            full_name="John Michael Doe",
            date_of_birth="1990-05-15",
            nationality="United States",
            issue_date="2020-01-10",
            expiry_date="2030-01-10",
            document_image_url=data.document_image_url,
            verification_status=VerificationStatus.PENDING,  # Start as PENDING for AI review
            fraud_score=0,  # Will be set by AI
            verified_at=None  # Not verified yet
        )
        
        db.add(verification)
        await db.commit()
        await db.refresh(verification)
        return verification

    @staticmethod
    async def auto_ai_review_and_queue(verification_id: int, user_id: str) -> None:
        """
        Background task: AI fraud analysis + auto-queue for video call.

        This runs after document upload completes. It:
        1. Calls AIFraudService to analyze the document
        2. Updates the verification with fraud_score and risk_level
        3. Auto-rejects if fraud_score is too low
        4. Adds to video call queue if passes threshold

        Args:
            verification_id: ID of the verification to analyze
            user_id: User ID who submitted the verification
        """
        from core.database import db_manager
        from services.ai_fraud_service import AIFraudService
        from services.video_call_service import VideoCallService

        # Use a fresh DB session (background tasks don't have request context)
        async with db_manager.async_session_maker() as db:
            try:
                # 1. Fetch verification
                stmt = select(DocumentVerifications).where(
                    DocumentVerifications.id == verification_id
                )
                result = await db.execute(stmt)
                verification = result.scalar_one_or_none()

                if not verification:
                    logger.error(f"Verification {verification_id} not found for AI review")
                    return

                logger.info(f"Starting AI review for verification {verification_id}")

                # 2. Run AI fraud analysis
                ai_result = await AIFraudService.analyze_document(
                    db=db,
                    verification=verification,
                )

                # 3. Update verification with AI results
                verification.fraud_score = ai_result.fraud_score
                verification.risk_level = ai_result.risk_level

                # 4. Decision logic
                if AIFraudService.should_auto_reject(ai_result.fraud_score):
                    # Auto-reject without human review
                    verification.verification_status = VerificationStatus.REJECTED
                    verification.verified_at = datetime.now()
                    await db.commit()

                    logger.info(
                        f"Verification {verification_id} auto-rejected: "
                        f"fraud_score={ai_result.fraud_score}"
                    )
                    # TODO: Send notification to user
                    return

                # 5. Add to video call queue for human review
                logger.info(
                    f"Adding verification {verification_id} to video call queue "
                    f"with priority {ai_result.priority.value}"
                )

                await VideoCallService.add_to_queue(
                    db=db,
                    verification_id=verification.id,
                    customer_id=user_id,
                    priority=ai_result.priority,
                )

                # Update status to IN_REVIEW (waiting for agent)
                verification.verification_status = VerificationStatus.IN_REVIEW
                await db.commit()

                logger.info(f"Verification {verification_id} successfully queued for review")

            except Exception as e:
                logger.error(
                    f"Error in auto_ai_review_and_queue for verification {verification_id}: {e}",
                    exc_info=True
                )
                # Don't let background task crash silently
                # TODO: Add monitoring/alerting here
    
    @staticmethod
    async def get_user_document_verification(
        db: AsyncSession,
        user_id: str
    ) -> DocumentVerifications:
        """Get user's latest document verification"""
        result = await db.execute(
            select(DocumentVerifications)
            .where(DocumentVerifications.user_id == user_id)
            .order_by(desc(DocumentVerifications.created_at))
            .limit(1)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def create_age_verification(
        db: AsyncSession,
        user_id: str,
        data: AgeVerificationCreate
    ) -> AgeVerifications:
        """Create age verification record"""
        # Calculate age
        from datetime import datetime
        birth_date = datetime.strptime(data.date_of_birth, "%Y-%m-%d")
        today = datetime.now()
        age = today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))
        
        verification = AgeVerifications(
            user_id=user_id,
            date_of_birth=data.date_of_birth,
            age=age,
            is_verified=age >= 18
        )
        
        db.add(verification)
        await db.commit()
        await db.refresh(verification)
        return verification
    
    @staticmethod
    async def get_user_age_verification(
        db: AsyncSession,
        user_id: str
    ) -> AgeVerifications:
        """Get user's age verification"""
        result = await db.execute(
            select(AgeVerifications)
            .where(AgeVerifications.user_id == user_id)
            .order_by(desc(AgeVerifications.created_at))
            .limit(1)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def create_kyc_form(
        db: AsyncSession,
        user_id: str,
        data: KYCFormCreate
    ) -> KYCForms:
        """Create KYC form record"""
        kyc = KYCForms(
            user_id=user_id,
            full_name=data.full_name,
            email=data.email,
            phone=data.phone,
            address=data.address,
            city=data.city,
            country=data.country,
            postal_code=data.postal_code,
            nationality=data.nationality,
            occupation=data.occupation,
            source_of_funds=data.source_of_funds,
            status=VerificationStatus.COMPLETED
        )
        
        db.add(kyc)
        await db.commit()
        await db.refresh(kyc)
        return kyc
    
    @staticmethod
    async def get_user_kyc_form(
        db: AsyncSession,
        user_id: str
    ) -> KYCForms:
        """Get user's KYC form"""
        result = await db.execute(
            select(KYCForms)
            .where(KYCForms.user_id == user_id)
            .order_by(desc(KYCForms.created_at))
            .limit(1)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def create_video_verification(
        db: AsyncSession,
        user_id: str,
        data: VideoVerificationCreate
    ) -> VideoVerifications:
        """Create video verification record"""
        verification = VideoVerifications(
            user_id=user_id,
            agent_name=data.agent_name,
            agent_id=data.agent_id,
            session_duration=data.session_duration or 300,  # 5 minutes default
            verification_status=VerificationStatus.COMPLETED,
            notes=data.notes or "All verification steps completed successfully",
            completed_at=datetime.now()
        )
        
        db.add(verification)
        await db.commit()
        await db.refresh(verification)
        return verification
    
    @staticmethod
    async def get_user_video_verification(
        db: AsyncSession,
        user_id: str
    ) -> VideoVerifications:
        """Get user's video verification"""
        result = await db.execute(
            select(VideoVerifications)
            .where(VideoVerifications.user_id == user_id)
            .order_by(desc(VideoVerifications.created_at))
            .limit(1)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def create_digital_signature(
        db: AsyncSession,
        user_id: str,
        data: DigitalSignatureCreate
    ) -> DigitalSignatures:
        """Create digital signature record"""
        # Generate unique signature ID
        signature_id = f"SIG-{''.join(random.choices(string.ascii_uppercase + string.digits, k=9))}"
        
        signature = DigitalSignatures(
            user_id=user_id,
            signature_data=data.signature_data,
            document_type=data.document_type,
            signature_id=signature_id,
            is_legally_binding=True
        )
        
        db.add(signature)
        await db.commit()
        await db.refresh(signature)
        return signature
    
    @staticmethod
    async def get_user_digital_signature(
        db: AsyncSession,
        user_id: str
    ) -> DigitalSignatures:
        """Get user's digital signature"""
        result = await db.execute(
            select(DigitalSignatures)
            .where(DigitalSignatures.user_id == user_id)
            .order_by(desc(DigitalSignatures.created_at))
            .limit(1)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def create_fraud_analysis(
        db: AsyncSession,
        user_id: str,
        data: FraudAnalysisCreate
    ) -> FraudAnalysis:
        """Create fraud analysis record"""
        # Simulate AI fraud detection scores
        scores = {
            "document_quality": random.randint(92, 99),
            "security_features": random.randint(90, 98),
            "biometric": random.randint(93, 99),
            "liveness": random.randint(91, 97),
            "data_consistency": random.randint(95, 100),
            "manipulation_detection": random.randint(94, 99),
            "deepfake": random.randint(93, 98)
        }
        
        overall_score = sum(scores.values()) // len(scores)
        
        # Determine risk level
        if overall_score >= 90:
            risk_level = "low"
        elif overall_score >= 70:
            risk_level = "medium"
        else:
            risk_level = "high"
        
        # Create detailed analysis
        analysis_details = {
            "checks": {
                "document_analysis": {
                    "image_quality": scores["document_quality"],
                    "security_features": scores["security_features"],
                    "microprints": 92,
                    "fonts": 97
                },
                "biometric_analysis": {
                    "face_recognition": scores["biometric"],
                    "liveness_detection": scores["liveness"],
                    "photo_comparison": 93
                },
                "data_validation": {
                    "expiry_date": 100,
                    "document_number": 99,
                    "data_consistency": scores["data_consistency"],
                    "cross_reference": 95
                },
                "manipulation_detection": {
                    "digital_editing": scores["manipulation_detection"],
                    "deepfake_detection": scores["deepfake"],
                    "photo_manipulation": 94
                }
            },
            "findings": [
                "All security features are authentic and detectable",
                "Biometric analysis confirms identity",
                "No signs of digital manipulation detected",
                "Data is consistent and verifiable"
            ],
            "recommendation": "Document passed all checks successfully. Verification approval recommended."
        }
        
        analysis = FraudAnalysis(
            user_id=user_id,
            document_verification_id=data.document_verification_id,
            overall_score=overall_score,
            document_quality_score=scores["document_quality"],
            security_features_score=scores["security_features"],
            biometric_score=scores["biometric"],
            liveness_score=scores["liveness"],
            data_consistency_score=scores["data_consistency"],
            manipulation_detection_score=scores["manipulation_detection"],
            deepfake_score=scores["deepfake"],
            risk_level=risk_level,
            analysis_details=json.dumps(analysis_details)
        )
        
        db.add(analysis)
        await db.commit()
        await db.refresh(analysis)
        return analysis
    
    @staticmethod
    async def get_user_fraud_analysis(
        db: AsyncSession,
        user_id: str
    ) -> FraudAnalysis:
        """Get user's latest fraud analysis"""
        result = await db.execute(
            select(FraudAnalysis)
            .where(FraudAnalysis.user_id == user_id)
            .order_by(desc(FraudAnalysis.created_at))
            .limit(1)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def get_verification_status(
        db: AsyncSession,
        user_id: str
    ) -> dict:
        """Get complete verification status for user"""
        document = await VerificationService.get_user_document_verification(db, user_id)
        age = await VerificationService.get_user_age_verification(db, user_id)
        kyc = await VerificationService.get_user_kyc_form(db, user_id)
        video = await VerificationService.get_user_video_verification(db, user_id)
        signature = await VerificationService.get_user_digital_signature(db, user_id)
        fraud = await VerificationService.get_user_fraud_analysis(db, user_id)
        
        # Calculate overall progress
        steps_completed = sum([
            1 if document else 0,
            1 if age else 0,
            1 if kyc else 0,
            1 if video else 0,
            1 if signature else 0
        ])
        overall_progress = (steps_completed / 5) * 100
        
        verification_complete = steps_completed == 5
        
        return {
            "user_id": user_id,
            "overall_progress": int(overall_progress),
            "document_verification": document,
            "age_verification": age,
            "kyc_form": kyc,
            "video_verification": video,
            "digital_signature": signature,
            "fraud_analysis": fraud,
            "verification_complete": verification_complete
        }