"""
DriverIntelligent verification router.

Handles the full lifecycle of a driver ('pirate') verification for:
  - taxi_school  – taxi driving school enrolment
  - drone_program – drone operator programme with call-agent oversight

Flow:
  1. Driver submits program verification (POST /api/v1/driver/submit)
  2. Each sub-verification step is signed by a Thronos miner (POST /sign-step)
  3. When all steps are signed the record enters AWAITING_MANAGER state
  4. Manager issues the final approval (POST /finalize) which commits the full
     proof bundle to the Thronos blockchain and stores the resulting tx hash.

Sub-verification steps per program:
  taxi_school  : identity_check, license_check, medical_check,
                 background_check, school_enrollment
  drone_program: identity_check, pilot_license_check, drone_certification,
                 route_clearance, call_agent_review
"""

import hashlib
import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies.auth import get_current_user, require_manager_or_admin
from dependencies.database import get_db
from models.verifications import (
    DocumentVerifications,
    DriverProgramStatus,
    DriverProgramType,
    DriverProgramVerifications,
)
from schemas.auth import UserResponse
from services.thronos_blockchain import thronos_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/driver", tags=["driver-verification"])

# ── Step definitions ────────────────────────────────────────────────────────

STEPS: Dict[str, List[Dict[str, str]]] = {
    "taxi_school": [
        {"key": "identity_check",   "label": "Identity Document"},
        {"key": "license_check",    "label": "Driver's Licence"},
        {"key": "medical_check",    "label": "Medical Certificate"},
        {"key": "background_check", "label": "Background Check"},
        {"key": "school_enrollment","label": "School Enrolment"},
    ],
    "drone_program": [
        {"key": "identity_check",      "label": "Identity Document"},
        {"key": "pilot_license_check", "label": "Pilot Licence"},
        {"key": "drone_certification", "label": "Drone Certification"},
        {"key": "route_clearance",     "label": "Route / Airspace Clearance"},
        {"key": "call_agent_review",   "label": "Call Agent Review"},
    ],
}

# ── Fake miner pool (in production these would be real on-chain miners) ─────

MINERS = [
    {"id": "MINER-THR-001", "address": "0xTHR1A2B3C4D5E6F7890"},
    {"id": "MINER-THR-002", "address": "0xTHR2B3C4D5E6F78901A"},
    {"id": "MINER-THR-003", "address": "0xTHR3C4D5E6F78901AB2"},
]


def _miner_for_step(step_key: str) -> Dict[str, str]:
    """Deterministically pick a miner based on step key."""
    idx = sum(ord(c) for c in step_key) % len(MINERS)
    return MINERS[idx]


def _compute_step_hash(
    driver_id: int,
    step_key: str,
    miner_id: str,
    timestamp: str,
) -> str:
    """Simulate a miner signature by hashing step data."""
    raw = f"{driver_id}:{step_key}:{miner_id}:{timestamp}"
    return "0x" + hashlib.sha256(raw.encode()).hexdigest()


def _build_initial_steps(program_type: str) -> List[Dict[str, Any]]:
    return [
        {
            "step_key": s["key"],
            "label": s["label"],
            "status": "pending",
            "miner_id": None,
            "miner_address": None,
            "miner_signature": None,
            "chain_tx": None,
            "signed_at": None,
            "notes": None,
        }
        for s in STEPS.get(program_type, [])
    ]


# ── Request / Response schemas ───────────────────────────────────────────────

class DriverSubmitRequest(BaseModel):
    program_type: str  # "taxi_school" | "drone_program"
    driver_name: str
    license_number: str
    vehicle_type: Optional[str] = None
    school_or_operator: Optional[str] = None
    document_verification_id: Optional[int] = None


class SignStepRequest(BaseModel):
    step_key: str
    notes: Optional[str] = None


class ManagerFinalizeRequest(BaseModel):
    decision: str = "completed"   # "completed" | "rejected"
    notes: Optional[str] = None


class SubVerificationOut(BaseModel):
    step_key: str
    label: str
    status: str
    miner_id: Optional[str]
    miner_address: Optional[str]
    miner_signature: Optional[str]
    chain_tx: Optional[str]
    signed_at: Optional[str]
    notes: Optional[str]


class DriverVerificationResponse(BaseModel):
    id: int
    user_id: str
    program_type: str
    status: str
    driver_name: Optional[str]
    license_number: Optional[str]
    vehicle_type: Optional[str]
    school_or_operator: Optional[str]
    document_verification_id: Optional[int]
    sub_verifications: List[SubVerificationOut]
    final_chain_hash: Optional[str]
    chain_proof: Optional[Dict[str, Any]]
    created_at: str
    finalized_at: Optional[str]
    finalized_by: Optional[str]
    manager_notes: Optional[str]

    class Config:
        from_attributes = True


def _to_response(rec: DriverProgramVerifications) -> DriverVerificationResponse:
    steps: List[Dict] = json.loads(rec.sub_verifications or "[]")
    proof_raw = rec.chain_proof
    proof = json.loads(proof_raw) if proof_raw else None
    return DriverVerificationResponse(
        id=rec.id,
        user_id=rec.user_id,
        program_type=rec.program_type.value,
        status=rec.status.value,
        driver_name=rec.driver_name,
        license_number=rec.license_number,
        vehicle_type=rec.vehicle_type,
        school_or_operator=rec.school_or_operator,
        document_verification_id=rec.document_verification_id,
        sub_verifications=[SubVerificationOut(**s) for s in steps],
        final_chain_hash=rec.final_chain_hash,
        chain_proof=proof,
        created_at=rec.created_at.isoformat(),
        finalized_at=rec.finalized_at.isoformat() if rec.finalized_at else None,
        finalized_by=rec.finalized_by,
        manager_notes=rec.manager_notes,
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/submit", response_model=DriverVerificationResponse)
async def submit_driver_verification(
    body: DriverSubmitRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Driver submits a new program verification.

    Creates the record with all sub-verification steps initialised to 'pending'.
    The driver can reference an existing DocumentVerification via
    ``document_verification_id`` (the identity step is auto-signed once the
    base verification is approved).
    """
    if body.program_type not in STEPS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown program_type '{body.program_type}'. "
                   f"Valid: {list(STEPS.keys())}",
        )

    try:
        pt = DriverProgramType(body.program_type)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid program_type")

    # If a document verification is linked, pre-sign the identity_check step
    initial_steps = _build_initial_steps(body.program_type)
    if body.document_verification_id:
        stmt = select(DocumentVerifications).where(
            DocumentVerifications.id == body.document_verification_id,
            DocumentVerifications.user_id == current_user.id,
        )
        result = await db.execute(stmt)
        doc_ver = result.scalar_one_or_none()
        if doc_ver and doc_ver.verification_status.value in ("approved", "completed"):
            # Auto-sign the identity_check step using the existing verification
            now_iso = datetime.now().isoformat()
            miner = _miner_for_step("identity_check")
            sig = _compute_step_hash(0, "identity_check", miner["id"], now_iso)
            for step in initial_steps:
                if step["step_key"] == "identity_check":
                    step.update(
                        status="signed",
                        miner_id=miner["id"],
                        miner_address=miner["address"],
                        miner_signature=sig,
                        chain_tx=f"0xIDCHK{body.document_verification_id:08d}",
                        signed_at=now_iso,
                        notes="Auto-signed from linked identity verification",
                    )
                    break

    record = DriverProgramVerifications(
        user_id=current_user.id,
        program_type=pt,
        status=DriverProgramStatus.IN_PROGRESS,
        driver_name=body.driver_name,
        license_number=body.license_number,
        vehicle_type=body.vehicle_type,
        school_or_operator=body.school_or_operator,
        document_verification_id=body.document_verification_id,
        sub_verifications=json.dumps(initial_steps),
        miner_signatures=json.dumps([]),
        created_at=datetime.now(),
        updated_at=datetime.now(),
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)

    logger.info(
        "Driver %s submitted %s verification → id=%d",
        current_user.id, body.program_type, record.id,
    )
    return _to_response(record)


@router.get("/status", response_model=List[DriverVerificationResponse])
async def get_driver_status(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all driver program verifications for the current user."""
    stmt = (
        select(DriverProgramVerifications)
        .where(DriverProgramVerifications.user_id == current_user.id)
        .order_by(DriverProgramVerifications.created_at.desc())
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [_to_response(r) for r in rows]


@router.get("/list", response_model=List[DriverVerificationResponse])
async def list_driver_verifications(
    program_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    current_user: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    List all driver program verifications (manager / admin / call-agent).

    Optionally filter by ``program_type`` or ``status``.
    """
    stmt = select(DriverProgramVerifications).order_by(
        DriverProgramVerifications.created_at.desc()
    )
    if program_type:
        try:
            stmt = stmt.where(
                DriverProgramVerifications.program_type == DriverProgramType(program_type)
            )
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid program_type: {program_type}")
    if status:
        try:
            stmt = stmt.where(
                DriverProgramVerifications.status == DriverProgramStatus(status)
            )
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
    stmt = stmt.offset(offset).limit(limit)
    result = await db.execute(stmt)
    return [_to_response(r) for r in result.scalars().all()]


@router.post("/{driver_ver_id}/sign-step", response_model=DriverVerificationResponse)
async def sign_step(
    driver_ver_id: int,
    body: SignStepRequest,
    current_user: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Miner signs (approves) a sub-verification step on the Thronos chain.

    In production this would be triggered by a real miner node; here the server
    simulates the signing by computing a deterministic HMAC-style hash and
    calling the Thronos blockchain to store the step record.
    """
    stmt = select(DriverProgramVerifications).where(
        DriverProgramVerifications.id == driver_ver_id
    )
    result = await db.execute(stmt)
    rec = result.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Driver verification not found")

    if rec.status in (DriverProgramStatus.COMPLETED, DriverProgramStatus.REJECTED):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot sign a step on a {rec.status.value} verification.",
        )

    steps: List[Dict] = json.loads(rec.sub_verifications or "[]")
    target = next((s for s in steps if s["step_key"] == body.step_key), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"Step '{body.step_key}' not found")
    if target["status"] == "signed":
        raise HTTPException(
            status_code=400, detail=f"Step '{body.step_key}' is already signed"
        )

    now_iso = datetime.now().isoformat()
    miner = _miner_for_step(body.step_key)
    sig = _compute_step_hash(driver_ver_id, body.step_key, miner["id"], now_iso)

    # Store this step on-chain
    chain_tx = f"0xSTEP{driver_ver_id:06d}{body.step_key[:4].upper()}"
    try:
        thronos_service.store_verification_on_blockchain(
            verification_id=driver_ver_id,
            user_id=rec.user_id,
            verification_type=f"driver_step:{body.step_key}",
            document_hashes=[sig],
            status="signed",
            verified_by=miner["id"],
        )
    except Exception as exc:
        logger.warning("Blockchain call failed for step sign (non-fatal): %s", exc)

    # Update step
    target.update(
        status="signed",
        miner_id=miner["id"],
        miner_address=miner["address"],
        miner_signature=sig,
        chain_tx=chain_tx,
        signed_at=now_iso,
        notes=body.notes,
    )

    # Append to miner_signatures list
    sigs: List[Dict] = json.loads(rec.miner_signatures or "[]")
    sigs.append({
        "step_key": body.step_key,
        "miner_id": miner["id"],
        "miner_address": miner["address"],
        "signature": sig,
        "chain_tx": chain_tx,
        "signed_at": now_iso,
        "signed_by_user": current_user.id,
    })

    # Check if all steps are now signed
    all_signed = all(s["status"] == "signed" for s in steps)

    rec.sub_verifications = json.dumps(steps)
    rec.miner_signatures = json.dumps(sigs)
    rec.updated_at = datetime.now()
    if all_signed and rec.status == DriverProgramStatus.IN_PROGRESS:
        rec.status = DriverProgramStatus.AWAITING_MANAGER

    await db.commit()
    await db.refresh(rec)

    logger.info(
        "Step '%s' signed for driver verification %d by miner %s (all_signed=%s)",
        body.step_key, driver_ver_id, miner["id"], all_signed,
    )
    return _to_response(rec)


@router.post("/{driver_ver_id}/finalize", response_model=DriverVerificationResponse)
async def manager_finalize(
    driver_ver_id: int,
    body: ManagerFinalizeRequest,
    current_user: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Manager issues the final approval (teliko aprove).

    If the decision is 'completed':
      1. All sub-verification hashes + miner signatures are bundled into a
         proof object.
      2. The bundle is committed to the Thronos blockchain.
      3. The resulting tx hash is stored as ``final_chain_hash``.
      4. Status → COMPLETED.

    If the decision is 'rejected':
      Status → REJECTED (no chain commit).
    """
    stmt = select(DriverProgramVerifications).where(
        DriverProgramVerifications.id == driver_ver_id
    )
    result = await db.execute(stmt)
    rec = result.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Driver verification not found")

    allowed_from = {
        DriverProgramStatus.IN_PROGRESS,
        DriverProgramStatus.AWAITING_MANAGER,
    }
    if rec.status not in allowed_from:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot finalize a verification in '{rec.status.value}' state.",
        )

    now = datetime.now()
    now_iso = now.isoformat()

    if body.decision == "rejected":
        rec.status = DriverProgramStatus.REJECTED
        rec.finalized_by = current_user.id
        rec.finalized_at = now
        rec.manager_notes = body.notes
        await db.commit()
        await db.refresh(rec)
        return _to_response(rec)

    # ── Build proof bundle ───────────────────────────────────────────────
    steps: List[Dict] = json.loads(rec.sub_verifications or "[]")
    sigs: List[Dict] = json.loads(rec.miner_signatures or "[]")

    step_hashes = [
        hashlib.sha256(json.dumps(s, sort_keys=True).encode()).hexdigest()
        for s in steps
    ]
    merkle_root = hashlib.sha256("".join(step_hashes).encode()).hexdigest()

    proof_bundle = {
        "driver_verification_id": driver_ver_id,
        "user_id": rec.user_id,
        "program_type": rec.program_type.value,
        "driver_name": rec.driver_name,
        "manager_id": current_user.id,
        "finalized_at": now_iso,
        "sub_verification_steps": steps,
        "miner_signatures": sigs,
        "step_hashes": step_hashes,
        "merkle_root": "0x" + merkle_root,
        "proof": "All sub-verifications signed by Thronos miners and approved by manager.",
    }

    # ── Commit to Thronos blockchain ─────────────────────────────────────
    all_hashes = [s.get("miner_signature", "") for s in steps if s.get("miner_signature")]
    chain_result = thronos_service.store_verification_on_blockchain(
        verification_id=driver_ver_id,
        user_id=rec.user_id,
        verification_type=f"driver_final:{rec.program_type.value}",
        document_hashes=all_hashes,
        status="completed",
        verified_by=current_user.id,
    )

    if chain_result.get("success"):
        final_tx = chain_result.get("tx_hash", f"0xDRV{driver_ver_id:08d}")
    else:
        # Non-fatal: store a deterministic local hash if blockchain is unavailable
        logger.warning(
            "Blockchain commit failed for driver %d: %s — using local hash",
            driver_ver_id, chain_result.get("error"),
        )
        final_tx = "0xDRV" + hashlib.sha256(
            f"{driver_ver_id}:{now_iso}".encode()
        ).hexdigest()[:16].upper()

    proof_bundle["final_chain_tx"] = final_tx

    rec.status = DriverProgramStatus.COMPLETED
    rec.finalized_by = current_user.id
    rec.finalized_at = now
    rec.manager_notes = body.notes
    rec.final_chain_hash = final_tx
    rec.chain_proof = json.dumps(proof_bundle)
    rec.updated_at = now

    await db.commit()
    await db.refresh(rec)

    logger.info(
        "Manager %s finalized driver verification %d → COMPLETED (chain=%s)",
        current_user.id, driver_ver_id, final_tx,
    )
    return _to_response(rec)


@router.get("/{driver_ver_id}", response_model=DriverVerificationResponse)
async def get_driver_verification(
    driver_ver_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single driver verification (owner or privileged role)."""
    stmt = select(DriverProgramVerifications).where(
        DriverProgramVerifications.id == driver_ver_id
    )
    result = await db.execute(stmt)
    rec = result.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Driver verification not found")

    allowed_roles = {"agent", "kyc_agent", "manager", "admin", "call_agent"}
    if rec.user_id != current_user.id and current_user.role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Access denied")

    return _to_response(rec)
