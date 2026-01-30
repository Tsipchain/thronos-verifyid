"""Video call signaling server for WebRTC connections."""
import logging
import uuid
from datetime import datetime
from typing import Dict, List, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel
from core.database import get_db
from dependencies.auth import get_current_user
from schemas.auth import UserResponse

router = APIRouter(prefix="/api/v1/video-call", tags=["video-call"])
logger = logging.getLogger(__name__)


class CallSession(BaseModel):
    """Video call session information."""
    session_id: str
    caller_id: str
    callee_id: str
    status: str  # pending, active, ended
    created_at: str
    ended_at: Optional[str] = None


class ConnectionManager:
    """Manage WebSocket connections for video calls."""
    
    def __init__(self):
        # Store active connections: user_id -> WebSocket
        self.active_connections: Dict[str, WebSocket] = {}
        # Store call sessions: session_id -> CallSession
        self.call_sessions: Dict[str, CallSession] = {}
    
    async def connect(self, user_id: str, websocket: WebSocket):
        """Register a new WebSocket connection."""
        await websocket.accept()
        self.active_connections[user_id] = websocket
        logger.info(f"User {user_id} connected to video call service")
    
    def disconnect(self, user_id: str):
        """Remove a WebSocket connection."""
        if user_id in self.active_connections:
            del self.active_connections[user_id]
            logger.info(f"User {user_id} disconnected from video call service")
    
    async def send_personal_message(self, message: dict, user_id: str):
        """Send a message to a specific user."""
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
            except Exception as e:
                logger.error(f"Failed to send message to user {user_id}: {e}")
    
    def create_call_session(self, caller_id: str, callee_id: str) -> str:
        """Create a new call session."""
        session_id = str(uuid.uuid4())
        session = CallSession(
            session_id=session_id,
            caller_id=caller_id,
            callee_id=callee_id,
            status="pending",
            created_at=datetime.now().isoformat()
        )
        self.call_sessions[session_id] = session
        logger.info(f"Created call session {session_id} between {caller_id} and {callee_id}")
        return session_id
    
    def get_call_session(self, session_id: str) -> Optional[CallSession]:
        """Get call session by ID."""
        return self.call_sessions.get(session_id)
    
    def update_call_status(self, session_id: str, status: str):
        """Update call session status."""
        if session_id in self.call_sessions:
            self.call_sessions[session_id].status = status
            if status == "ended":
                self.call_sessions[session_id].ended_at = datetime.now().isoformat()
            logger.info(f"Updated call session {session_id} status to {status}")
    
    def is_user_online(self, user_id: str) -> bool:
        """Check if a user is online."""
        return user_id in self.active_connections


# Global connection manager
manager = ConnectionManager()


class InitiateCallRequest(BaseModel):
    """Request to initiate a video call."""
    callee_id: str


class CallResponse(BaseModel):
    """Response for call initiation."""
    session_id: str
    status: str
    message: str


@router.post("/initiate", response_model=CallResponse)
async def initiate_call(
    request: InitiateCallRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Initiate a video call to another user.
    
    The caller must be online (connected via WebSocket).
    The callee will receive a call notification if they are online.
    """
    caller_id = current_user.id
    callee_id = request.callee_id
    
    # Check if caller is online
    if not manager.is_user_online(caller_id):
        raise HTTPException(
            status_code=400,
            detail="You must be connected to the video call service to initiate a call"
        )
    
    # Check if callee exists and is online
    if not manager.is_user_online(callee_id):
        raise HTTPException(
            status_code=404,
            detail="The user you are trying to call is not online"
        )
    
    # Create call session
    session_id = manager.create_call_session(caller_id, callee_id)
    
    # Send call notification to callee
    await manager.send_personal_message(
        {
            "type": "incoming_call",
            "session_id": session_id,
            "caller_id": caller_id,
            "caller_email": current_user.email
        },
        callee_id
    )
    
    return CallResponse(
        session_id=session_id,
        status="pending",
        message="Call initiated successfully"
    )


class CallActionRequest(BaseModel):
    """Request to accept or reject a call."""
    session_id: str
    action: str  # accept, reject


@router.post("/respond")
async def respond_to_call(
    request: CallActionRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Accept or reject an incoming call.
    
    Only the callee can respond to a call.
    """
    session = manager.get_call_session(request.session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Call session not found")
    
    if session.callee_id != current_user.id:
        raise HTTPException(status_code=403, detail="You are not authorized to respond to this call")
    
    if request.action == "accept":
        manager.update_call_status(request.session_id, "active")
        
        # Notify caller that call was accepted
        await manager.send_personal_message(
            {
                "type": "call_accepted",
                "session_id": request.session_id,
                "callee_id": current_user.id
            },
            session.caller_id
        )
        
        return {"message": "Call accepted", "session_id": request.session_id}
    
    elif request.action == "reject":
        manager.update_call_status(request.session_id, "ended")
        
        # Notify caller that call was rejected
        await manager.send_personal_message(
            {
                "type": "call_rejected",
                "session_id": request.session_id,
                "callee_id": current_user.id
            },
            session.caller_id
        )
        
        return {"message": "Call rejected", "session_id": request.session_id}
    
    else:
        raise HTTPException(status_code=400, detail="Invalid action. Use 'accept' or 'reject'")


@router.post("/end/{session_id}")
async def end_call(
    session_id: str,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    End an active call.
    
    Either the caller or callee can end the call.
    """
    session = manager.get_call_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Call session not found")
    
    if session.caller_id != current_user.id and session.callee_id != current_user.id:
        raise HTTPException(status_code=403, detail="You are not part of this call")
    
    manager.update_call_status(session_id, "ended")
    
    # Notify the other party
    other_user_id = session.callee_id if session.caller_id == current_user.id else session.caller_id
    await manager.send_personal_message(
        {
            "type": "call_ended",
            "session_id": session_id,
            "ended_by": current_user.id
        },
        other_user_id
    )
    
    return {"message": "Call ended successfully"}


@router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """
    WebSocket endpoint for video call signaling.
    
    Handles WebRTC signaling messages (offer, answer, ICE candidates).
    """
    await manager.connect(user_id, websocket)
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_json()
            message_type = data.get("type")
            
            if message_type == "offer":
                # Forward WebRTC offer to the other peer
                session_id = data.get("session_id")
                session = manager.get_call_session(session_id)
                
                if session:
                    target_user = session.callee_id if session.caller_id == user_id else session.caller_id
                    await manager.send_personal_message(
                        {
                            "type": "offer",
                            "session_id": session_id,
                            "offer": data.get("offer"),
                            "from": user_id
                        },
                        target_user
                    )
            
            elif message_type == "answer":
                # Forward WebRTC answer to the other peer
                session_id = data.get("session_id")
                session = manager.get_call_session(session_id)
                
                if session:
                    target_user = session.caller_id if session.callee_id == user_id else session.callee_id
                    await manager.send_personal_message(
                        {
                            "type": "answer",
                            "session_id": session_id,
                            "answer": data.get("answer"),
                            "from": user_id
                        },
                        target_user
                    )
            
            elif message_type == "ice_candidate":
                # Forward ICE candidate to the other peer
                session_id = data.get("session_id")
                session = manager.get_call_session(session_id)
                
                if session:
                    target_user = session.callee_id if session.caller_id == user_id else session.caller_id
                    await manager.send_personal_message(
                        {
                            "type": "ice_candidate",
                            "session_id": session_id,
                            "candidate": data.get("candidate"),
                            "from": user_id
                        },
                        target_user
                    )
            
            elif message_type == "ping":
                # Respond to ping to keep connection alive
                await websocket.send_json({"type": "pong"})
    
    except WebSocketDisconnect:
        manager.disconnect(user_id)
        logger.info(f"User {user_id} disconnected from video call")
    except Exception as e:
        logger.error(f"WebSocket error for user {user_id}: {e}")
        manager.disconnect(user_id)


@router.get("/online-users")
async def get_online_users(
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Get list of users currently online and available for video calls.
    """
    online_user_ids = list(manager.active_connections.keys())
    
    # Remove current user from the list
    if current_user.id in online_user_ids:
        online_user_ids.remove(current_user.id)
    
    return {
        "online_users": online_user_ids,
        "count": len(online_user_ids)
    }


@router.get("/session/{session_id}")
async def get_call_session(
    session_id: str,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Get information about a call session.
    """
    session = manager.get_call_session(session_id)
    
    if not session:
        raise HTTPException(status_code=404, detail="Call session not found")
    
    if session.caller_id != current_user.id and session.callee_id != current_user.id:
        raise HTTPException(status_code=403, detail="You are not part of this call")
    
    return session