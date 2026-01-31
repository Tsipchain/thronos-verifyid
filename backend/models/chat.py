from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, ForeignKey, Index
from datetime import datetime
from models.base import Base


class Conversations(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(255), nullable=False, index=True)
    conversation_type = Column(String(50), nullable=False)  # direct, group
    name = Column(String(255))
    description = Column(Text)
    avatar_url = Column(String(500))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    last_message_at = Column(DateTime, default=datetime.now)

    __table_args__ = (
        Index('idx_user_conversations', 'user_id', 'is_active'),
    )


class ConversationParticipants(Base):
    __tablename__ = "conversation_participants"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(255), nullable=False, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False)
    username = Column(String(255), nullable=False)
    user_avatar = Column(String(500))
    role = Column(String(50), default="member")  # admin, member
    is_muted = Column(Boolean, default=False)
    joined_at = Column(DateTime, default=datetime.now)
    last_read_at = Column(DateTime, default=datetime.now)

    __table_args__ = (
        Index('idx_conversation_participants', 'conversation_id', 'user_id'),
    )


class Messages(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(255), nullable=False, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False)
    username = Column(String(255), nullable=False)
    user_avatar = Column(String(500))
    content = Column(Text, nullable=False)
    message_type = Column(String(50), default="text")  # text, image, file, system
    reply_to_id = Column(Integer, ForeignKey("messages.id"), nullable=True)
    is_edited = Column(Boolean, default=False)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now, index=True)
    edited_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index('idx_conversation_messages', 'conversation_id', 'created_at'),
    )


class TypingIndicators(Base):
    __tablename__ = "typing_indicators"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(255), nullable=False, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False)
    username = Column(String(255), nullable=False)
    is_typing = Column(Boolean, default=True)
    started_at = Column(DateTime, default=datetime.now)
    expires_at = Column(DateTime, nullable=False)

    __table_args__ = (
        Index('idx_typing_indicators', 'conversation_id', 'expires_at'),
    )


class UserPresence(Base):
    __tablename__ = "user_presence"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(String(255), nullable=False, unique=True, index=True)
    username = Column(String(255), nullable=False)
    user_avatar = Column(String(500))
    status = Column(String(50), default="offline")  # online, offline, away, busy
    status_message = Column(String(255))
    last_active = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# Backwards-compatible aliases (do NOT remove)
ChatMessage = Messages
ChatRoom = Conversations
ChatRoomMember = ConversationParticipants
ChatMessages = ChatMessage
ChatRooms = ChatRoom
ChatRoomMembers = ChatRoomMember
