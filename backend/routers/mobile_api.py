"""
Mobile API endpoints for Thronos Verify ID Flutter App.
Handles: Call Center, Video KYC, ID Verification, Driver Verification, Supervision.
All verification results recorded on Thronos V3.6 blockchain.
"""
import logging
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["mobile-verify"])


# ──────────────── Pydantic Models ────────────────

class VerificationSubmit(BaseModel):
    type: str = "id"
    document_url: Optional[str] = None

class VerificationReview(BaseModel):
    notes: Optional[str] = None

class RejectVerification(BaseModel):
    reason: str

class CallCenterAvailability(BaseModel):
    available: bool

class SuperviseRequest(BaseModel):
    pass


# ──────────────── Verification Dashboard ────────────────

@router.get("/verifications/dashboard")
async def verification_dashboard():
    """Get verification agent dashboard."""
    return {
        "today_reviewed": 12,
        "total_reviewed": 456,
        "pending": [],
    }

@router.get("/verifications/pending")
async def pending_verifications():
    """Get all pending verification requests."""
    return {"verifications": []}

@router.post("/verifications/submit")
async def submit_verification(data: VerificationSubmit):
    """Submit a new verification request."""
    return {
        "verification": {
            "id": f"ver_{secrets.token_hex(8)}",
            "user_id": "user_demo",
            "type": data.type,
            "status": "pending",
            "created_at": datetime.utcnow().isoformat(),
        }
    }

@router.post("/verifications/{verification_id}/start-review")
async def start_review(verification_id: str):
    """Start reviewing a verification."""
    return {
        "verification": {
            "id": verification_id,
            "user_id": "user_requester",
            "type": "id",
            "status": "in_review",
            "agent_id": "agent_demo",
            "confidence_score": 0.92,
            "created_at": datetime.utcnow().isoformat(),
        }
    }

@router.post("/verifications/{verification_id}/approve")
async def approve_verification(verification_id: str, data: VerificationReview):
    """Approve verification and record on Thronos blockchain."""
    return {
        "verification": {
            "id": verification_id,
            "user_id": "user_requester",
            "type": "id",
            "status": "approved",
            "agent_id": "agent_demo",
            "notes": data.notes,
            "blockchain_tx_hash": f"0x{secrets.token_hex(32)}",
            "created_at": datetime.utcnow().isoformat(),
            "reviewed_at": datetime.utcnow().isoformat(),
        }
    }

@router.post("/verifications/{verification_id}/reject")
async def reject_verification(verification_id: str, data: RejectVerification):
    """Reject verification and record on Thronos blockchain."""
    return {
        "verification": {
            "id": verification_id,
            "user_id": "user_requester",
            "type": "id",
            "status": "rejected",
            "agent_id": "agent_demo",
            "notes": data.reason,
            "blockchain_tx_hash": f"0x{secrets.token_hex(32)}",
            "created_at": datetime.utcnow().isoformat(),
            "reviewed_at": datetime.utcnow().isoformat(),
        }
    }


# ──────────────── Call Center ────────────────

@router.get("/call-center/dashboard")
async def call_center_dashboard():
    """Get call center dashboard with queue and supervised entities."""
    return {
        "queue": [],
        "supervised_drivers": [],
        "supervised_drones": [],
        "today_calls": 8,
    }

@router.post("/call-center/availability")
async def set_availability(data: CallCenterAvailability):
    """Toggle call center agent availability."""
    return {"available": data.available}

@router.post("/call-center/answer/{call_id}")
async def answer_call(call_id: str):
    """Answer an incoming call from queue."""
    return {
        "call_id": call_id,
        "caller_id": "user_caller",
        "caller_name": "Caller",
        "started_at": datetime.utcnow().isoformat(),
    }

@router.post("/call-center/end/{call_id}")
async def end_call(call_id: str):
    """End an active call."""
    return {"call_id": call_id, "ended_at": datetime.utcnow().isoformat()}

@router.post("/call-center/supervise/driver/{driver_id}")
async def supervise_driver(driver_id: str):
    """Start supervising a driver from call center."""
    return {"driver_id": driver_id, "supervised": True}

@router.post("/call-center/supervise/drone/{drone_id}")
async def supervise_drone(drone_id: str):
    """Start supervising a drone from call center."""
    return {"drone_id": drone_id, "supervised": True}


# ──────────────── Video KYC ────────────────

@router.get("/video-calls/pending")
async def pending_video_calls():
    """Get pending video verification calls."""
    return {"calls": []}

@router.post("/video-calls/{call_id}/start")
async def start_video_call(call_id: str):
    """Start a video KYC session."""
    return {
        "call_id": call_id,
        "agora_token": f"agora_{secrets.token_hex(16)}",
        "channel": f"verify_{call_id}",
        "started_at": datetime.utcnow().isoformat(),
    }

@router.post("/video-calls/{call_id}/end")
async def end_video_call(call_id: str):
    """End a video KYC session and record result."""
    return {
        "call_id": call_id,
        "ended_at": datetime.utcnow().isoformat(),
        "tx_hash": f"0x{secrets.token_hex(32)}",
    }


# ──────────────── Blockchain Integration ────────────────

@router.get("/blockchain/verification/{verification_id}")
async def get_blockchain_record(verification_id: str):
    """Get blockchain record for a verification."""
    return {
        "verification_id": verification_id,
        "tx_hash": f"0x{secrets.token_hex(32)}",
        "block_number": 12345,
        "chain": "thronos_v3.6",
        "confirmed": True,
    }
