import hashlib
import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import db_manager, get_db
from dependencies.auth import get_current_user
from models.agent_availability import AgentAvailability, AgentStatus
from models.blockchain_transactions import BlockchainStatus, BlockchainTransactions
from models.verifications import DocumentVerifications, VerificationStatus
from models.video_call_queue import CallPriority, CallStatus, VideoCallQueue
from schemas.auth import UserResponse
from services.rbac import RBACService
from services.thronos_blockchain import thronos_service
from services.video_call_service import VideoCallService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/video-calls", tags=["video-calls"])


# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        # call_id → set of user_ids currently in that call room
        self.call_participants: dict[int, set[str]] = {}
        # user_id → call_id
        self.user_call_map: dict[str, int] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.info(f"WebSocket connected: {user_id}")

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            logger.info(f"WebSocket disconnected: {user_id}")
        call_id = self.user_call_map.pop(user_id, None)
        if call_id and call_id in self.call_participants:
            self.call_participants[call_id].discard(user_id)

    def join_call(self, user_id: str, call_id: int) -> list[str]:
        """Add user to a call room. Returns list of previously existing participants."""
        self.user_call_map[user_id] = call_id
        if call_id not in self.call_participants:
            self.call_participants[call_id] = set()
        existing = list(self.call_participants[call_id])
        self.call_participants[call_id].add(user_id)
        return existing

    def get_call_peers(self, user_id: str) -> list[str]:
        """Return all participants in the same call, excluding user_id."""
        call_id = self.user_call_map.get(user_id)
        if call_id is None:
            return []
        return [p for p in self.call_participants.get(call_id, set()) if p != user_id]

    async def send_personal_message(self, message: dict, user_id: str):
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
            except Exception as e:
                logger.error(f"Error sending message to {user_id}: {e}")

    async def relay_to_peers(self, from_user_id: str, message: dict):
        """Forward a signaling message to all peers in the same call."""
        for peer_id in self.get_call_peers(from_user_id):
            await self.send_personal_message(message, peer_id)

    async def broadcast(self, message: dict):
        for user_id, connection in self.active_connections.items():
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting to {user_id}: {e}")


manager = ConnectionManager()


async def _anchor_to_blockchain(
    verification_id: int,
    user_id: str,
    doc_type: str,
    outcome: str,
    agent_id: str,
    timestamp: str,
) -> None:
    """
    Background task: hash the verification outcome and submit it to the
    Thronos blockchain through the ACICS miners.  Updates
    DocumentVerifications.blockchain_tx_hash and creates a
    BlockchainTransactions record when the submission succeeds.
    """
    # Deterministic hash of the verification outcome
    raw = f"{verification_id}:{user_id}:{doc_type}:{outcome}:{agent_id}:{timestamp}"
    doc_hash = hashlib.sha256(raw.encode()).hexdigest()

    result = thronos_service.store_verification_on_blockchain(
        verification_id=verification_id,
        user_id=user_id,
        verification_type=doc_type,
        document_hashes=[doc_hash],
        status=outcome,
        verified_by=agent_id,
    )

    if not result["success"]:
        logger.error(
            "Blockchain anchoring failed for verification %s: %s",
            verification_id,
            result.get("error"),
        )
        return

    tx_hash = result["tx_hash"]
    node_url = result["node_url"]
    logger.info("Verification %s anchored on Thronos blockchain: %s", verification_id, tx_hash)

    # Persist the transaction using a fresh DB session (background task has no request session)
    try:
        async with db_manager.async_session_maker() as db:
            # 1. Store tx_hash on the verification record
            stmt = select(DocumentVerifications).where(DocumentVerifications.id == verification_id)
            res = await db.execute(stmt)
            verification = res.scalar_one_or_none()
            if verification:
                verification.blockchain_tx_hash = tx_hash

            # 2. Create a BlockchainTransactions row
            bc_tx = BlockchainTransactions(
                verification_id=verification_id,
                tx_hash=tx_hash,
                document_hash=doc_hash,
                node_url=node_url,
                status=BlockchainStatus.CONFIRMED,
                confirmed_at=datetime.now(),
            )
            db.add(bc_tx)
            await db.commit()

        # 3. Notify the client via WebSocket (best-effort)
        await manager.send_personal_message(
            {
                "type": "verification_anchored",
                "verification_id": verification_id,
                "outcome": outcome,
                "tx_hash": tx_hash,
                "node": node_url,
            },
            user_id,
        )
    except Exception as exc:
        logger.error("Failed to persist blockchain record for verification %s: %s", verification_id, exc)


# Pydantic models
class AddToQueueRequest(BaseModel):
    verification_id: int
    customer_id: str
    priority: CallPriority = CallPriority.NORMAL


class AssignAgentRequest(BaseModel):
    agent_id: str


class CompleteCallRequest(BaseModel):
    notes: Optional[str] = None
    outcome: str = "approved"  # "approved" | "rejected"


class UpdateAgentStatusRequest(BaseModel):
    status: AgentStatus


class CallResponse(BaseModel):
    id: int
    verification_id: int
    customer_id: str
    agent_id: Optional[str]
    priority: str
    status: str
    created_at: datetime
    assigned_at: Optional[datetime]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    wait_time_seconds: Optional[int] = None
    client_online: Optional[bool] = None  # True if client's WebSocket is currently connected
    is_stuck: bool = False  # True for IN_PROGRESS calls that have no completed_at (stuck)
    outcome: Optional[str] = None  # "approved" | "rejected" — set for completed calls


class AgentResponse(BaseModel):
    agent_id: str
    status: str
    last_heartbeat: datetime
    current_call_id: Optional[int]
    total_calls_today: int


@router.post("/queue", response_model=CallResponse)
async def add_to_queue(
    request: AddToQueueRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Add a verification to the video call queue"""
    try:
        call = await VideoCallService.add_to_queue(
            db=db,
            verification_id=request.verification_id,
            customer_id=request.customer_id,
            priority=request.priority
        )

        # Broadcast new call to all connected agents
        await manager.broadcast({
            "type": "new_call",
            "call_id": call.id,
            "verification_id": call.verification_id,
            "priority": call.priority.value
        })

        # Try auto-assignment
        await VideoCallService.auto_assign_next_call(db)

        return CallResponse(
            id=call.id,
            verification_id=call.verification_id,
            customer_id=call.customer_id,
            agent_id=call.agent_id,
            priority=call.priority.value,
            status=call.status.value,
            created_at=call.created_at,
            assigned_at=call.assigned_at,
            started_at=call.started_at,
            completed_at=call.completed_at
        )

    except Exception as e:
        logger.error(f"Error adding to queue: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pending", response_model=List[CallResponse])
async def get_pending_calls(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get pending video calls (requires Agent or Manager role)"""
    try:
        # Check if user has Agent or Manager permissions
        can_access = await RBACService.check_permission(db, current_user.id, "verifications", "read")
        can_manage = await RBACService.check_permission(db, current_user.id, "users", "read")
        if not (can_access or can_manage):
            raise HTTPException(status_code=403, detail="Access denied. Agent or Manager role required.")

        calls = await VideoCallService.get_pending_calls(db)

        # Also include stuck IN_PROGRESS calls (agent disconnected without completing)
        stuck_stmt = (
            select(VideoCallQueue)
            .where(
                VideoCallQueue.status == CallStatus.IN_PROGRESS,
                VideoCallQueue.completed_at == None,  # noqa: E711
            )
        )
        stuck_result = await db.execute(stuck_stmt)
        stuck_calls = stuck_result.scalars().all()

        def _to_response(call: VideoCallQueue, stuck: bool = False) -> CallResponse:
            return CallResponse(
                id=call.id,
                verification_id=call.verification_id,
                customer_id=call.customer_id,
                agent_id=call.agent_id,
                priority=call.priority.value,
                status=call.status.value,
                created_at=call.created_at,
                assigned_at=call.assigned_at,
                started_at=call.started_at,
                completed_at=call.completed_at,
                wait_time_seconds=int((datetime.now() - call.created_at).total_seconds()),
                client_online=call.customer_id in manager.active_connections,
                is_stuck=stuck,
            )

        return (
            [_to_response(c) for c in calls]
            + [_to_response(c, stuck=True) for c in stuck_calls]
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting pending calls: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{call_id}", response_model=CallResponse)
async def get_call(
    call_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch a single video call queue entry by ID (any status)."""
    stmt = select(VideoCallQueue).where(VideoCallQueue.id == call_id)
    result = await db.execute(stmt)
    call = result.scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=404, detail=f"Call {call_id} not found")
    return CallResponse(
        id=call.id,
        verification_id=call.verification_id,
        customer_id=call.customer_id,
        agent_id=call.agent_id,
        priority=call.priority.value,
        status=call.status.value,
        created_at=call.created_at,
        assigned_at=call.assigned_at,
        started_at=call.started_at,
        completed_at=call.completed_at,
        wait_time_seconds=int((datetime.now() - call.created_at).total_seconds()),
        client_online=call.customer_id in manager.active_connections,
        is_stuck=call.status == CallStatus.IN_PROGRESS and call.completed_at is None,
    )


@router.post("/{call_id}/assign", response_model=CallResponse)
async def assign_agent(
    call_id: int,
    request: AssignAgentRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Assign an agent to a video call"""
    try:
        call = await VideoCallService.assign_agent(db, call_id, request.agent_id)

        # Notify assigned agent
        await manager.send_personal_message(
            {
                "type": "call_assigned",
                "call_id": call.id,
                "verification_id": call.verification_id
            },
            request.agent_id
        )

        return CallResponse(
            id=call.id,
            verification_id=call.verification_id,
            customer_id=call.customer_id,
            agent_id=call.agent_id,
            priority=call.priority.value,
            status=call.status.value,
            created_at=call.created_at,
            assigned_at=call.assigned_at,
            started_at=call.started_at,
            completed_at=call.completed_at
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error assigning agent: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{call_id}/start", response_model=CallResponse)
async def start_call(
    call_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Start a video call and notify the customer via WebSocket."""
    try:
        call = await VideoCallService.start_call(db, call_id)

        # Notify the customer so their waiting screen navigates to the video call page
        await manager.send_personal_message(
            {
                "type": "call_started",
                "call_id": call.id,
                "verification_id": call.verification_id,
            },
            call.customer_id,
        )

        return CallResponse(
            id=call.id,
            verification_id=call.verification_id,
            customer_id=call.customer_id,
            agent_id=call.agent_id,
            priority=call.priority.value,
            status=call.status.value,
            created_at=call.created_at,
            assigned_at=call.assigned_at,
            started_at=call.started_at,
            completed_at=call.completed_at
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error starting call: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{call_id}/complete", response_model=CallResponse)
async def complete_call(
    call_id: int,
    request: CompleteCallRequest,
    background_tasks: BackgroundTasks,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Complete a video call.

    Sets the verification outcome (approved / rejected) on the
    DocumentVerifications record, then kicks off a background task that
    hashes the result and anchors it on the Thronos blockchain via the
    ACICS miners.  The client is notified via WebSocket when the
    blockchain transaction is confirmed.
    """
    try:
        call = await VideoCallService.complete_call(db, call_id, request.notes)

        # 1. Update the verification record with the agent's decision
        outcome = request.outcome.lower()
        new_status = VerificationStatus.APPROVED if outcome == "approved" else VerificationStatus.REJECTED

        stmt = select(DocumentVerifications).where(DocumentVerifications.id == call.verification_id)
        res = await db.execute(stmt)
        verification = res.scalar_one_or_none()

        if verification:
            verification.verification_status = new_status
            verification.verified_at = datetime.now()

            # Append human-agent review to the audit history
            import json as _json
            try:
                _data: dict = _json.loads(verification.extracted_data or "{}")
            except Exception:
                _data = {}
            _data.setdefault("review_history", []).append({
                "source": "human_agent",
                "agent_id": current_user.id,
                "outcome": outcome,
                "notes": request.notes or "",
                "completed_at": datetime.now().isoformat(),
            })
            verification.extracted_data = _json.dumps(_data)

            await db.commit()
            await db.refresh(verification)

            # 2. Anchor on Thronos blockchain (non-blocking)
            background_tasks.add_task(
                _anchor_to_blockchain,
                verification_id=verification.id,
                user_id=verification.user_id,
                doc_type=verification.document_type.value,
                outcome=outcome,
                agent_id=current_user.id,
                timestamp=datetime.now().isoformat(),
            )

        # 3. Notify client of verification result immediately (before blockchain confirms)
        await manager.send_personal_message(
            {
                "type": "verification_complete",
                "outcome": outcome,
                "verification_id": call.verification_id,
                "tx_hash": "pending",
            },
            call.customer_id,
        )

        # 4. Broadcast to all agents
        await manager.broadcast({"type": "call_completed", "call_id": call.id})

        # 5. Auto-assign next pending call
        await VideoCallService.auto_assign_next_call(db)

        return CallResponse(
            id=call.id,
            verification_id=call.verification_id,
            customer_id=call.customer_id,
            agent_id=call.agent_id,
            priority=call.priority.value,
            status=call.status.value,
            created_at=call.created_at,
            assigned_at=call.assigned_at,
            started_at=call.started_at,
            completed_at=call.completed_at,
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Error completing call: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history", response_model=List[CallResponse])
async def get_call_history(
    limit: int = 50,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch completed calls handled by the current agent, with verification outcome."""
    from sqlalchemy import select as _select, desc as _desc, outerjoin as _outerjoin
    # Join with DocumentVerifications to get outcome
    stmt = (
        _select(VideoCallQueue, DocumentVerifications.verification_status)
        .join(DocumentVerifications, VideoCallQueue.verification_id == DocumentVerifications.id, isouter=True)
        .where(
            VideoCallQueue.agent_id == current_user.id,
            VideoCallQueue.status == CallStatus.COMPLETED,
        )
        .order_by(_desc(VideoCallQueue.completed_at))
        .limit(limit)
    )
    result = await db.execute(stmt)
    rows = result.all()

    history = []
    for call, ver_status in rows:
        outcome: str | None = None
        if ver_status is not None:
            outcome = ver_status.value  # "approved" | "rejected" | etc.
        elif call.notes:
            # Fallback: parse from notes string
            notes_lower = call.notes.lower()
            if "approved" in notes_lower:
                outcome = "approved"
            elif "rejected" in notes_lower:
                outcome = "rejected"

        history.append(CallResponse(
            id=call.id,
            verification_id=call.verification_id,
            customer_id=call.customer_id,
            agent_id=call.agent_id,
            priority=call.priority.value,
            status=call.status.value,
            created_at=call.created_at,
            assigned_at=call.assigned_at,
            started_at=call.started_at,
            completed_at=call.completed_at,
            outcome=outcome,
        ))
    return history


@router.get("/agents/availability", response_model=List[AgentResponse])
async def get_available_agents(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get list of available agents"""
    try:
        agents = await VideoCallService.get_available_agents(db)

        return [
            AgentResponse(
                agent_id=agent.agent_id,
                status=agent.status.value,
                last_heartbeat=agent.last_heartbeat,
                current_call_id=agent.current_call_id,
                total_calls_today=agent.total_calls_today
            )
            for agent in agents
        ]

    except Exception as e:
        logger.error(f"Error getting available agents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/agents/status", response_model=AgentResponse)
async def update_agent_status(
    request: UpdateAgentStatusRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update agent availability status (heartbeat)"""
    try:
        agent = await VideoCallService.update_agent_status(
            db=db,
            agent_id=current_user.id,
            status=request.status
        )

        return AgentResponse(
            agent_id=agent.agent_id,
            status=agent.status.value,
            last_heartbeat=agent.last_heartbeat,
            current_call_id=agent.current_call_id,
            total_calls_today=agent.total_calls_today
        )

    except Exception as e:
        logger.error(f"Error updating agent status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """WebSocket endpoint — handles signaling (offer/answer/ICE) and heartbeats."""
    await manager.connect(user_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "heartbeat":
                await websocket.send_json({"type": "heartbeat_ack"})

            elif msg_type == "join_call":
                # Register user in the call room and inform both sides
                call_id = data.get("call_id")
                if call_id:
                    existing = manager.join_call(user_id, int(call_id))
                    # Tell the joiner who is already in the room
                    await websocket.send_json({
                        "type": "call_joined",
                        "call_id": call_id,
                        "existing_peers": existing,
                    })
                    # Tell existing peers that this user has arrived
                    for peer_id in existing:
                        await manager.send_personal_message(
                            {"type": "peer_joined", "user_id": user_id, "call_id": call_id},
                            peer_id,
                        )
                    logger.info("User %s joined call %s (existing peers: %s)", user_id, call_id, existing)

            elif msg_type in ("offer", "answer", "ice_candidate"):
                # Relay WebRTC signaling message to the other participant(s)
                await manager.relay_to_peers(user_id, data)

    except WebSocketDisconnect:
        peers = manager.get_call_peers(user_id)
        manager.disconnect(user_id)
        for peer_id in peers:
            await manager.send_personal_message({"type": "peer_left", "user_id": user_id}, peer_id)
        await manager.broadcast({"type": "client_disconnected", "user_id": user_id})
    except Exception as e:
        logger.error(f"WebSocket error for {user_id}: {e}")
        manager.disconnect(user_id)
        await manager.broadcast({"type": "client_disconnected", "user_id": user_id})
