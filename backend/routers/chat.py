from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from dependencies.database import get_db
from dependencies.auth import get_current_user
from schemas.auth import UserResponse
from schemas.chat import (
    ConversationCreate,
    ConversationResponse,
    MessageCreate,
    MessageResponse,
    ParticipantResponse,
    TypingIndicatorCreate,
    UserPresenceUpdate,
    UserPresenceResponse,
    DirectMessageRequest,
    WebSocketMessagePayload
)
from services.chat import ChatService
from typing import List, Dict
import json
from datetime import datetime
import logging

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])
logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manage WebSocket connections for real-time chat"""
    
    def __init__(self):
        # conversation_id -> list of (websocket, user_id)
        self.active_connections: Dict[int, List[tuple]] = {}
        # user_id -> list of websockets
        self.user_connections: Dict[str, List[WebSocket]] = {}
    
    async def connect(self, websocket: WebSocket, conversation_id: int, user_id: str):
        """Connect a user to a conversation"""
        await websocket.accept()
        
        if conversation_id not in self.active_connections:
            self.active_connections[conversation_id] = []
        self.active_connections[conversation_id].append((websocket, user_id))
        
        if user_id not in self.user_connections:
            self.user_connections[user_id] = []
        self.user_connections[user_id].append(websocket)
        
        logger.info(f"User {user_id} connected to conversation {conversation_id}")
    
    def disconnect(self, websocket: WebSocket, conversation_id: int, user_id: str):
        """Disconnect a user from a conversation"""
        if conversation_id in self.active_connections:
            self.active_connections[conversation_id] = [
                (ws, uid) for ws, uid in self.active_connections[conversation_id]
                if ws != websocket
            ]
            if not self.active_connections[conversation_id]:
                del self.active_connections[conversation_id]
        
        if user_id in self.user_connections:
            self.user_connections[user_id] = [
                ws for ws in self.user_connections[user_id] if ws != websocket
            ]
            if not self.user_connections[user_id]:
                del self.user_connections[user_id]
        
        logger.info(f"User {user_id} disconnected from conversation {conversation_id}")
    
    async def broadcast_to_conversation(self, message: dict, conversation_id: int, exclude_user: str = None):
        """Broadcast message to all users in a conversation"""
        if conversation_id not in self.active_connections:
            return
        
        disconnected = []
        for websocket, user_id in self.active_connections[conversation_id]:
            if exclude_user and user_id == exclude_user:
                continue
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.error(f"Error sending to user {user_id}: {e}")
                disconnected.append((websocket, user_id))
        
        # Clean up disconnected websockets
        for ws, uid in disconnected:
            self.disconnect(ws, conversation_id, uid)
    
    async def send_to_user(self, message: dict, user_id: str):
        """Send message to all connections of a specific user"""
        if user_id not in self.user_connections:
            return
        
        disconnected = []
        for websocket in self.user_connections[user_id]:
            try:
                await websocket.send_json(message)
            except Exception as e:
                logger.error(f"Error sending to user {user_id}: {e}")
                disconnected.append(websocket)
        
        # Clean up disconnected websockets
        for ws in disconnected:
            if user_id in self.user_connections:
                self.user_connections[user_id].remove(ws)


manager = ConnectionManager()


@router.post("/conversations", response_model=ConversationResponse)
async def create_conversation(
    data: ConversationCreate,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Create a new conversation (group or direct)"""
    try:
        conversation = await ChatService.create_conversation(
            db, current_user.id, current_user.email, data
        )
        
        return ConversationResponse(
            id=conversation.id,
            conversation_type=conversation.conversation_type,
            name=conversation.name,
            description=conversation.description,
            avatar_url=conversation.avatar_url,
            is_active=conversation.is_active,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
            last_message_at=conversation.last_message_at,
            participant_count=len(data.participant_ids) + 1,
            unread_count=0
        )
    except Exception as e:
        logger.error(f"Error creating conversation: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conversations", response_model=List[ConversationResponse])
async def get_conversations(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all conversations for the current user"""
    try:
        conversations_data = await ChatService.get_user_conversations(db, current_user.id)
        
        return [
            ConversationResponse(
                id=conv.id,
                conversation_type=conv.conversation_type,
                name=conv.name,
                description=conv.description,
                avatar_url=conv.avatar_url,
                is_active=conv.is_active,
                created_at=conv.created_at,
                updated_at=conv.updated_at,
                last_message_at=conv.last_message_at,
                participant_count=participant_count,
                unread_count=unread_count
            )
            for conv, participant_count, unread_count in conversations_data
        ]
    except Exception as e:
        logger.error(f"Error getting conversations: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/messages", response_model=MessageResponse)
async def send_message(
    data: MessageCreate,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Send a message to a conversation"""
    try:
        message = await ChatService.send_message(
            db, current_user.id, current_user.email, data
        )
        
        # Broadcast to WebSocket connections
        message_payload = {
            "type": "message",
            "conversation_id": message.conversation_id,
            "message": {
                "id": message.id,
                "user_id": message.user_id,
                "conversation_id": message.conversation_id,
                "username": message.username,
                "user_avatar": message.user_avatar,
                "content": message.content,
                "message_type": message.message_type,
                "reply_to_id": message.reply_to_id,
                "is_edited": message.is_edited,
                "is_deleted": message.is_deleted,
                "created_at": message.created_at.isoformat(),
                "edited_at": message.edited_at.isoformat() if message.edited_at else None
            },
            "timestamp": datetime.now().isoformat()
        }
        
        await manager.broadcast_to_conversation(
            message_payload,
            data.conversation_id
        )
        
        return message
    except Exception as e:
        logger.error(f"Error sending message: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conversations/{conversation_id}/messages", response_model=List[MessageResponse])
async def get_messages(
    conversation_id: int,
    limit: int = 50,
    before_id: int = None,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get messages from a conversation"""
    try:
        messages = await ChatService.get_conversation_messages(
            db, conversation_id, limit, before_id
        )
        return messages
    except Exception as e:
        logger.error(f"Error getting messages: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/conversations/{conversation_id}/read")
async def mark_as_read(
    conversation_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Mark all messages in a conversation as read"""
    success = await ChatService.mark_as_read(db, conversation_id, current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"success": True}


@router.post("/typing")
async def update_typing(
    data: TypingIndicatorCreate,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update typing indicator"""
    try:
        indicator = await ChatService.update_typing_indicator(
            db, current_user.id, current_user.email, data
        )
        
        # Broadcast typing indicator
        if data.is_typing:
            typing_payload = {
                "type": "typing",
                "conversation_id": data.conversation_id,
                "typing": {
                    "user_id": current_user.id,
                    "username": current_user.email,
                    "is_typing": True,
                    "started_at": datetime.now().isoformat()
                },
                "timestamp": datetime.now().isoformat()
            }
            
            await manager.broadcast_to_conversation(
                typing_payload,
                data.conversation_id,
                exclude_user=current_user.id
            )
        
        return {"success": True}
    except Exception as e:
        logger.error(f"Error updating typing: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/presence", response_model=UserPresenceResponse)
async def update_presence(
    data: UserPresenceUpdate,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update user presence status"""
    try:
        presence = await ChatService.update_user_presence(
            db, current_user.id, current_user.email, data
        )
        return presence
    except Exception as e:
        logger.error(f"Error updating presence: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/online", response_model=List[UserPresenceResponse])
async def get_online_users(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all online users"""
    try:
        users = await ChatService.get_online_users(db)
        return users
    except Exception as e:
        logger.error(f"Error getting online users: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conversations/{conversation_id}/participants", response_model=List[ParticipantResponse])
async def get_participants(
    conversation_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all participants in a conversation"""
    try:
        participants = await ChatService.get_conversation_participants(db, conversation_id)
        return participants
    except Exception as e:
        logger.error(f"Error getting participants: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/direct", response_model=ConversationResponse)
async def send_direct_message(
    data: DirectMessageRequest,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Send a direct message to another user"""
    try:
        # Create or get direct conversation
        conversation_data = ConversationCreate(
            conversation_type="direct",
            participant_ids=[data.recipient_user_id]
        )
        
        conversation = await ChatService.create_conversation(
            db, current_user.id, current_user.email, conversation_data
        )
        
        # Send message
        message_data = MessageCreate(
            conversation_id=conversation.id,
            content=data.content
        )
        
        await ChatService.send_message(
            db, current_user.id, current_user.email, message_data
        )
        
        return ConversationResponse(
            id=conversation.id,
            conversation_type=conversation.conversation_type,
            name=conversation.name,
            description=conversation.description,
            avatar_url=conversation.avatar_url,
            is_active=conversation.is_active,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
            last_message_at=conversation.last_message_at,
            participant_count=2,
            unread_count=0
        )
    except Exception as e:
        logger.error(f"Error sending direct message: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Delete a message"""
    success = await ChatService.delete_message(db, message_id, current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Message not found or unauthorized")
    return {"success": True}


@router.put("/messages/{message_id}", response_model=MessageResponse)
async def edit_message(
    message_id: int,
    content: str,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Edit a message"""
    message = await ChatService.edit_message(db, message_id, current_user.id, content)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found or unauthorized")
    return message


@router.websocket("/ws/{conversation_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    conversation_id: int,
    token: str,
    db: AsyncSession = Depends(get_db)
):
    """WebSocket endpoint for real-time chat"""
    # Validate token and get user
    # Note: In production, implement proper token validation
    user_id = token  # Simplified for demo
    
    await manager.connect(websocket, conversation_id, user_id)
    
    try:
        # Send connection confirmation
        await websocket.send_json({
            "type": "connected",
            "conversation_id": conversation_id,
            "timestamp": datetime.now().isoformat()
        })
        
        # Update user presence to online
        presence_data = UserPresenceUpdate(status="online")
        await ChatService.update_user_presence(db, user_id, f"User-{user_id[:8]}", presence_data)
        
        # Listen for messages
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            # Handle different message types
            if message_data.get("type") == "ping":
                await websocket.send_json({"type": "pong", "timestamp": datetime.now().isoformat()})
            
    except WebSocketDisconnect:
        manager.disconnect(websocket, conversation_id, user_id)
        
        # Update user presence to offline if no other connections
        if user_id not in manager.user_connections or not manager.user_connections[user_id]:
            presence_data = UserPresenceUpdate(status="offline")
            await ChatService.update_user_presence(db, user_id, f"User-{user_id[:8]}", presence_data)
        
        logger.info(f"WebSocket disconnected for user {user_id} in conversation {conversation_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, conversation_id, user_id)