import logging
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from core.database import get_db
from dependencies.auth import get_current_user
from schemas.auth import UserResponse
from services.video_call_service import VideoCallService
from models.video_call_queue import VideoCallQueue, CallStatus, CallPriority
from models.agent_availability import AgentAvailability, AgentStatus
from lib.rbac import rbac

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/video-calls", tags=["video-calls"])


# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.info(f"WebSocket connected: {user_id}")

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            logger.info(f"WebSocket disconnected: {user_id}")

    async def send_personal_message(self, message: dict, user_id: str):
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
            except Exception as e:
                logger.error(f"Error sending message to {user_id}: {e}")

    async def broadcast(self, message: dict):
        for user_id, connection in self.active_connections.items():
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Error broadcasting to {user_id}: {e}")


manager = ConnectionManager()


# Pydantic models
class AddToQueueRequest(BaseModel):
    verification_id: int
    customer_id: str
    priority: CallPriority = CallPriority.NORMAL


class AssignAgentRequest(BaseModel):
    agent_id: str


class CompleteCallRequest(BaseModel):
    notes: Optional[str] = None


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
        # Check if user has Agent or Manager role
        await rbac.initialize()
        if not (rbac.canAccessVerifications() or rbac.canAccessUsers()):
            raise HTTPException(status_code=403, detail="Access denied. Agent or Manager role required.")

        calls = await VideoCallService.get_pending_calls(db)

        return [
            CallResponse(
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
                wait_time_seconds=int((datetime.now() - call.created_at).total_seconds())
            )
            for call in calls
        ]

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting pending calls: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
    """Start a video call"""
    try:
        call = await VideoCallService.start_call(db, call_id)

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
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Complete a video call"""
    try:
        call = await VideoCallService.complete_call(db, call_id, request.notes)

        # Broadcast call completion
        await manager.broadcast({
            "type": "call_completed",
            "call_id": call.id
        })

        # Try to auto-assign next call
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

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error completing call: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
    """WebSocket endpoint for real-time updates"""
    await manager.connect(user_id, websocket)
    try:
        while True:
            # Receive heartbeat messages
            data = await websocket.receive_json()
            if data.get("type") == "heartbeat":
                await websocket.send_json({"type": "heartbeat_ack"})
    except WebSocketDisconnect:
        manager.disconnect(user_id)
    except Exception as e:
        logger.error(f"WebSocket error for {user_id}: {e}")
        manager.disconnect(user_id)