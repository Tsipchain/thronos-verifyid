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
            verification_status=VerificationStatus.COMPLETED,
            fraud_score=96,
            verified_at=datetime.now()
        )
        
        db.add(verification)
        await db.commit()
        await db.refresh(verification)
        return verification
    
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