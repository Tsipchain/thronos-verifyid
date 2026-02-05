from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func, and_, or_, delete
from models.chat import (
    Conversations,
    ConversationParticipants,
    Messages,
    TypingIndicators,
    UserPresence
)
from schemas.chat import (
    ConversationCreate,
    MessageCreate,
    TypingIndicatorCreate,
    UserPresenceUpdate
)
from datetime import datetime, timedelta
from typing import List, Optional, Tuple


class ChatService:

    @staticmethod
    async def ensure_user_in_default_group(
        db: AsyncSession,
        user_id: str,
        username: str,
        default_group_name: str = "Main Discussion",
    ) -> None:
        """Ensure user is in default team discussion group."""
        group_result = await db.execute(
            select(Conversations).where(
                and_(
                    Conversations.conversation_type == "group",
                    Conversations.name == default_group_name,
                    Conversations.is_active == True,
                )
            )
        )
        group = group_result.scalar_one_or_none()

        if not group:
            group = Conversations(
                user_id=user_id,
                conversation_type="group",
                name=default_group_name,
                description="Main team discussion room",
            )
            db.add(group)
            await db.commit()
            await db.refresh(group)

        existing_participant = await db.execute(
            select(ConversationParticipants).where(
                and_(
                    ConversationParticipants.conversation_id == group.id,
                    ConversationParticipants.user_id == user_id,
                )
            )
        )
        if existing_participant.scalar_one_or_none():
            return

        # First member of a new room is admin, all others are members
        participant_count = await db.execute(
            select(func.count(ConversationParticipants.id)).where(
                ConversationParticipants.conversation_id == group.id
            )
        )
        role = "admin" if (participant_count.scalar() or 0) == 0 else "member"

        db.add(
            ConversationParticipants(
                user_id=user_id,
                conversation_id=group.id,
                username=username,
                role=role,
            )
        )
        await db.commit()
    
    @staticmethod
    async def create_conversation(
        db: AsyncSession,
        user_id: str,
        username: str,
        data: ConversationCreate
    ) -> Conversations:
        """Create a new conversation (group or direct)"""
        # For direct messages, check if conversation already exists
        if data.conversation_type == "direct" and len(data.participant_ids) == 1:
            other_user_id = data.participant_ids[0]
            existing = await ChatService._find_direct_conversation(
                db, user_id, other_user_id
            )
            if existing:
                return existing
        
        # Create conversation
        conversation = Conversations(
            user_id=user_id,
            conversation_type=data.conversation_type,
            name=data.name,
            description=data.description
        )
        
        db.add(conversation)
        await db.commit()
        await db.refresh(conversation)
        
        # Add creator as admin
        creator_participant = ConversationParticipants(
            user_id=user_id,
            conversation_id=conversation.id,
            username=username,
            role="admin"
        )
        db.add(creator_participant)
        
        # Add other participants
        for participant_id in data.participant_ids:
            if participant_id != user_id:
                participant = ConversationParticipants(
                    user_id=participant_id,
                    conversation_id=conversation.id,
                    username=f"User-{participant_id[:8]}",  # Should fetch from user table
                    role="member"
                )
                db.add(participant)
        
        await db.commit()
        return conversation
    
    @staticmethod
    async def _find_direct_conversation(
        db: AsyncSession,
        user1_id: str,
        user2_id: str
    ) -> Optional[Conversations]:
        """Find existing direct conversation between two users"""
        result = await db.execute(
            select(Conversations)
            .join(ConversationParticipants)
            .where(
                and_(
                    Conversations.conversation_type == "direct",
                    ConversationParticipants.user_id.in_([user1_id, user2_id])
                )
            )
            .group_by(Conversations.id)
            .having(func.count(ConversationParticipants.user_id) == 2)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def get_user_conversations(
        db: AsyncSession,
        user_id: str
    ) -> List[Tuple[Conversations, int, int]]:
        """Get all conversations for a user with unread count"""
        # Get conversations with participant count
        result = await db.execute(
            select(
                Conversations,
                func.count(ConversationParticipants.id).label('participant_count')
            )
            .join(ConversationParticipants, Conversations.id == ConversationParticipants.conversation_id)
            .where(
                and_(
                    ConversationParticipants.user_id == user_id,
                    Conversations.is_active == True
                )
            )
            .group_by(Conversations.id)
            .order_by(desc(Conversations.last_message_at))
        )
        
        conversations_data = result.all()
        
        # Calculate unread count for each conversation
        result_with_unread = []
        for conv, participant_count in conversations_data:
            # Get user's last_read_at
            participant_result = await db.execute(
                select(ConversationParticipants.last_read_at)
                .where(
                    and_(
                        ConversationParticipants.conversation_id == conv.id,
                        ConversationParticipants.user_id == user_id
                    )
                )
            )
            last_read_at = participant_result.scalar_one_or_none()
            
            # Count unread messages
            unread_result = await db.execute(
                select(func.count(Messages.id))
                .where(
                    and_(
                        Messages.conversation_id == conv.id,
                        Messages.created_at > (last_read_at or datetime.min),
                        Messages.user_id != user_id
                    )
                )
            )
            unread_count = unread_result.scalar_one()
            
            result_with_unread.append((conv, participant_count, unread_count))
        
        return result_with_unread
    
    @staticmethod
    async def send_message(
        db: AsyncSession,
        user_id: str,
        username: str,
        data: MessageCreate
    ) -> Messages:
        """Send a message to a conversation"""
        message = Messages(
            user_id=user_id,
            conversation_id=data.conversation_id,
            username=username,
            content=data.content,
            message_type=data.message_type,
            reply_to_id=data.reply_to_id
        )
        
        db.add(message)
        
        # Update conversation's last_message_at
        await db.execute(
            select(Conversations)
            .where(Conversations.id == data.conversation_id)
        )
        conversation = (await db.execute(
            select(Conversations).where(Conversations.id == data.conversation_id)
        )).scalar_one_or_none()
        
        if conversation:
            conversation.last_message_at = datetime.now()
            conversation.updated_at = datetime.now()
        
        await db.commit()
        await db.refresh(message)
        return message
    
    @staticmethod
    async def get_conversation_messages(
        db: AsyncSession,
        conversation_id: int,
        limit: int = 50,
        before_id: Optional[int] = None
    ) -> List[Messages]:
        """Get messages from a conversation with pagination"""
        query = select(Messages).where(
            and_(
                Messages.conversation_id == conversation_id,
                Messages.is_deleted == False
            )
        )
        
        if before_id:
            query = query.where(Messages.id < before_id)
        
        query = query.order_by(desc(Messages.created_at)).limit(limit)
        
        result = await db.execute(query)
        messages = result.scalars().all()
        return list(reversed(messages))
    
    @staticmethod
    async def mark_as_read(
        db: AsyncSession,
        conversation_id: int,
        user_id: str
    ) -> bool:
        """Mark all messages in a conversation as read"""
        result = await db.execute(
            select(ConversationParticipants).where(
                and_(
                    ConversationParticipants.conversation_id == conversation_id,
                    ConversationParticipants.user_id == user_id
                )
            )
        )
        participant = result.scalar_one_or_none()
        
        if participant:
            participant.last_read_at = datetime.now()
            await db.commit()
            return True
        return False
    
    @staticmethod
    async def update_typing_indicator(
        db: AsyncSession,
        user_id: str,
        username: str,
        data: TypingIndicatorCreate
    ) -> TypingIndicators:
        """Update typing indicator for a user in a conversation"""
        # Delete old typing indicators for this user in this conversation
        await db.execute(
            delete(TypingIndicators).where(
                and_(
                    TypingIndicators.user_id == user_id,
                    TypingIndicators.conversation_id == data.conversation_id
                )
            )
        )
        
        if data.is_typing:
            # Create new typing indicator
            indicator = TypingIndicators(
                user_id=user_id,
                conversation_id=data.conversation_id,
                username=username,
                is_typing=True,
                expires_at=datetime.now() + timedelta(seconds=5)
            )
            db.add(indicator)
            await db.commit()
            await db.refresh(indicator)
            return indicator
        
        await db.commit()
        return None
    
    @staticmethod
    async def get_typing_users(
        db: AsyncSession,
        conversation_id: int
    ) -> List[TypingIndicators]:
        """Get users currently typing in a conversation"""
        # Clean up expired indicators
        await db.execute(
            delete(TypingIndicators).where(
                TypingIndicators.expires_at < datetime.now()
            )
        )
        await db.commit()
        
        result = await db.execute(
            select(TypingIndicators).where(
                and_(
                    TypingIndicators.conversation_id == conversation_id,
                    TypingIndicators.is_typing == True,
                    TypingIndicators.expires_at > datetime.now()
                )
            )
        )
        return result.scalars().all()
    
    @staticmethod
    async def update_user_presence(
        db: AsyncSession,
        user_id: str,
        username: str,
        data: UserPresenceUpdate
    ) -> UserPresence:
        """Update user's online presence"""
        result = await db.execute(
            select(UserPresence).where(UserPresence.user_id == user_id)
        )
        presence = result.scalar_one_or_none()
        
        if presence:
            presence.status = data.status
            presence.status_message = data.status_message
            presence.last_active = datetime.now()
            presence.updated_at = datetime.now()
        else:
            presence = UserPresence(
                user_id=user_id,
                username=username,
                status=data.status,
                status_message=data.status_message
            )
            db.add(presence)
        
        await db.commit()
        await db.refresh(presence)
        return presence
    
    @staticmethod
    async def get_online_users(db: AsyncSession) -> List[UserPresence]:
        """Get all online users"""
        result = await db.execute(
            select(UserPresence)
            .where(UserPresence.status == "online")
            .order_by(UserPresence.username)
        )
        return result.scalars().all()
    
    @staticmethod
    async def get_conversation_participants(
        db: AsyncSession,
        conversation_id: int
    ) -> List[ConversationParticipants]:
        """Get all participants in a conversation"""
        result = await db.execute(
            select(ConversationParticipants)
            .where(ConversationParticipants.conversation_id == conversation_id)
            .order_by(ConversationParticipants.joined_at)
        )
        return result.scalars().all()
    
    @staticmethod
    async def delete_message(
        db: AsyncSession,
        message_id: int,
        user_id: str
    ) -> bool:
        """Soft delete a message"""
        result = await db.execute(
            select(Messages).where(
                and_(
                    Messages.id == message_id,
                    Messages.user_id == user_id
                )
            )
        )
        message = result.scalar_one_or_none()
        
        if message:
            message.is_deleted = True
            message.content = "[Message deleted]"
            await db.commit()
            return True
        return False
    
    @staticmethod
    async def edit_message(
        db: AsyncSession,
        message_id: int,
        user_id: str,
        new_content: str
    ) -> Optional[Messages]:
        """Edit a message"""
        result = await db.execute(
            select(Messages).where(
                and_(
                    Messages.id == message_id,
                    Messages.user_id == user_id,
                    Messages.is_deleted == False
                )
            )
        )
        message = result.scalar_one_or_none()
        
        if message:
            message.content = new_content
            message.is_edited = True
            message.edited_at = datetime.now()
            await db.commit()
            await db.refresh(message)
            return message
        return None
