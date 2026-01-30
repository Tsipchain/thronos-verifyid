from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class ConversationCreate(BaseModel):
    conversation_type: str = Field(..., description="direct or group")
    name: Optional[str] = None
    description: Optional[str] = None
    participant_ids: List[str] = Field(..., description="List of user IDs to add")


class ConversationResponse(BaseModel):
    id: int
    conversation_type: str
    name: Optional[str] = None
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime
    participant_count: int = 0
    unread_count: int = 0
    last_message: Optional[str] = None

    class Config:
        from_attributes = True


class MessageCreate(BaseModel):
    conversation_id: int
    content: str
    message_type: str = "text"
    reply_to_id: Optional[int] = None


class MessageResponse(BaseModel):
    id: int
    user_id: str
    conversation_id: int
    username: str
    user_avatar: Optional[str] = None
    content: str
    message_type: str
    reply_to_id: Optional[int] = None
    is_edited: bool
    is_deleted: bool
    created_at: datetime
    edited_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ParticipantResponse(BaseModel):
    id: int
    user_id: str
    conversation_id: int
    username: str
    user_avatar: Optional[str] = None
    role: str
    is_muted: bool
    joined_at: datetime
    last_read_at: datetime

    class Config:
        from_attributes = True


class TypingIndicatorCreate(BaseModel):
    conversation_id: int
    is_typing: bool


class TypingIndicatorResponse(BaseModel):
    user_id: str
    conversation_id: int
    username: str
    is_typing: bool
    started_at: datetime

    class Config:
        from_attributes = True


class UserPresenceUpdate(BaseModel):
    status: str = Field(..., description="online, offline, away, busy")
    status_message: Optional[str] = None


class UserPresenceResponse(BaseModel):
    user_id: str
    username: str
    user_avatar: Optional[str] = None
    status: str
    status_message: Optional[str] = None
    last_active: datetime

    class Config:
        from_attributes = True


class DirectMessageRequest(BaseModel):
    recipient_user_id: str
    content: str


class WebSocketMessagePayload(BaseModel):
    type: str  # message, typing, presence, read_receipt, user_joined, user_left
    conversation_id: Optional[int] = None
    message: Optional[MessageResponse] = None
    typing: Optional[TypingIndicatorResponse] = None
    presence: Optional[UserPresenceResponse] = None
    user_id: Optional[str] = None
    username: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.now)


class ConversationStats(BaseModel):
    total_messages: int
    unread_messages: int
    participants: List[ParticipantResponse]
    last_message: Optional[MessageResponse] = None