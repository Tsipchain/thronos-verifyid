import hashlib
import time
import logging
from typing import Dict, Any, Optional
import requests
from core.config import settings

logger = logging.getLogger(__name__)


class ThronosBlockchainService:
    """Service for integrating with Thronos blockchain"""

    def __init__(self):
        self.node1_url = getattr(settings, 'thronos_node1_url', 'https://thrchain.up.railway.app')
        self.node2_url = getattr(settings, 'thronos_node2_url', 'https://node-2.up.railway.app')
        self.ai_core_url = getattr(settings, 'thronos_ai_core_url', 'https://thronos-v3-6.onrender.com')
        self.admin_secret = getattr(settings, 'thronos_admin_secret', '')
        self.headers = {"X-Admin-Secret": self.admin_secret} if self.admin_secret else {}
        self.timeout = 30

    def calculate_document_hash(self, file_data: bytes) -> str:
        """Calculate SHA256 hash of document"""
        try:
            return hashlib.sha256(file_data).hexdigest()
        except Exception as e:
            logger.error(f"Error calculating document hash: {e}")
            raise

    def store_verification_on_blockchain(
        self,
        verification_id: int,
        user_id: str,
        verification_type: str,
        document_hashes: list,
        status: str,
        verified_by: Optional[str] = None
    ) -> Dict[str, Any]:
        """Store verification record on Thronos blockchain"""
        try:
            payload = {
                "tx": f"0xVERIF{verification_id:08d}",
                "network": "mainnet",
                "verification_data": {
                    "verification_id": verification_id,
                    "user_id": user_id,
                    "verification_type": verification_type,
                    "status": status,
                    "documents": document_hashes,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "verified_by": verified_by or "system"
                }
            }

            response = requests.post(
                f"{self.node1_url}/submit_block",
                json=payload,
                headers=self.headers,
                timeout=self.timeout
            )

            if response.status_code == 200:
                result = response.json()
                logger.info(f"Successfully stored verification {verification_id} on blockchain")
                return {
                    "success": True,
                    "tx_hash": payload["tx"],
                    "node_url": self.node1_url,
                    "response": result
                }
            else:
                logger.error(f"Blockchain submission failed: {response.status_code} - {response.text}")
                return {
                    "success": False,
                    "error": f"HTTP {response.status_code}: {response.text}"
                }

        except requests.exceptions.Timeout:
            logger.error(f"Blockchain submission timeout for verification {verification_id}")
            return {"success": False, "error": "Request timeout"}
        except Exception as e:
            logger.error(f"Error storing verification on blockchain: {e}")
            return {"success": False, "error": str(e)}

    def verify_blockchain_record(self, tx_hash: str) -> Dict[str, Any]:
        """Verify and retrieve verification record from blockchain"""
        try:
            # Try Node 1 first
            response = requests.get(
                f"{self.node1_url}/api/v1/tx/{tx_hash}",
                headers=self.headers,
                timeout=self.timeout
            )

            if response.status_code == 200:
                return {
                    "success": True,
                    "data": response.json(),
                    "node": "node1"
                }

            # Fallback to Node 2 (replica)
            response = requests.get(
                f"{self.node2_url}/api/v1/tx/{tx_hash}",
                headers=self.headers,
                timeout=self.timeout
            )

            if response.status_code == 200:
                return {
                    "success": True,
                    "data": response.json(),
                    "node": "node2"
                }

            return {
                "success": False,
                "error": "Transaction not found on blockchain"
            }

        except Exception as e:
            logger.error(f"Error verifying blockchain record: {e}")
            return {"success": False, "error": str(e)}

    async def calculate_ai_risk_score(
        self,
        verification_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Calculate risk score using Thronos AI Core"""
        try:
            prompt = f"""
Analyze the following verification data and provide a risk score (0-100):

User Information:
- User ID: {verification_data.get('user_id')}
- Verification Type: {verification_data.get('verification_type')}
- Document Count: {verification_data.get('document_count', 0)}

Document Analysis:
- Document Hashes: {len(verification_data.get('document_hashes', []))} documents
- Upload Time: {verification_data.get('upload_time')}

Behavioral Indicators:
- Account Age: {verification_data.get('account_age_days', 0)} days
- Previous Verifications: {verification_data.get('previous_verifications', 0)}
- IP Location: {verification_data.get('ip_location', 'Unknown')}

Provide a JSON response with:
1. risk_score (0-100, where 0=no risk, 100=high risk)
2. risk_level (low/medium/high)
3. risk_factors (list of concerns)
4. recommendation (approve/review/reject)
5. confidence (0.0-1.0)
"""

            payload = {
                "model": "claude-3.5-sonnet-latest",
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a fraud detection expert for identity verification. Respond only with valid JSON."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "temperature": 0.3
            }

            response = requests.post(
                f"{self.ai_core_url}/api/ai/chat",
                json=payload,
                headers=self.headers,
                timeout=90
            )

            if response.status_code == 200:
                result = response.json()
                # Parse AI response
                ai_response = result.get("response", "{}")
                
                # Try to extract JSON from response
                import json
                try:
                    risk_data = json.loads(ai_response)
                except:
                    # Fallback if AI doesn't return valid JSON
                    risk_data = {
                        "risk_score": 50,
                        "risk_level": "medium",
                        "risk_factors": ["Unable to parse AI response"],
                        "recommendation": "review",
                        "confidence": 0.5
                    }

                return {
                    "success": True,
                    "risk_assessment": risk_data
                }
            else:
                logger.warning(f"AI Core request failed: {response.status_code}")
                return {
                    "success": False,
                    "error": f"AI Core returned status {response.status_code}"
                }

        except Exception as e:
            logger.error(f"Error calculating AI risk score: {e}")
            return {
                "success": False,
                "error": str(e),
                "risk_assessment": {
                    "risk_score": 50,
                    "risk_level": "medium",
                    "risk_factors": ["AI analysis unavailable"],
                    "recommendation": "review",
                    "confidence": 0.0
                }
            }


# Singleton instance
thronos_service = ThronosBlockchainService()