import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.video_call_queue import VideoCallQueue, CallStatus, CallPriority
from models.agent_availability import AgentAvailability, AgentStatus
from models.verifications import Verifications

logger = logging.getLogger(__name__)


class VideoCallService:
    """Service for managing video call queue and agent assignments"""

    @staticmethod
    async def add_to_queue(
        db: AsyncSession,
        verification_id: int,
        customer_id: str,
        priority: CallPriority = CallPriority.NORMAL
    ) -> VideoCallQueue:
        """Add a verification to the video call queue"""
        try:
            call = VideoCallQueue(
                verification_id=verification_id,
                customer_id=customer_id,
                priority=priority,
                status=CallStatus.PENDING,
                created_at=datetime.now()
            )
            db.add(call)
            await db.commit()
            await db.refresh(call)
            logger.info(f"Added verification {verification_id} to video call queue")
            return call
        except Exception as e:
            await db.rollback()
            logger.error(f"Error adding to queue: {e}")
            raise

    @staticmethod
    async def get_pending_calls(
        db: AsyncSession,
        limit: int = 50
    ) -> List[VideoCallQueue]:
        """Get pending video calls ordered by priority and creation time"""
        try:
            # Priority order: urgent > high > normal > low
            priority_order = {
                CallPriority.URGENT: 0,
                CallPriority.HIGH: 1,
                CallPriority.NORMAL: 2,
                CallPriority.LOW: 3
            }

            stmt = (
                select(VideoCallQueue)
                .options(selectinload(VideoCallQueue.verification))
                .where(VideoCallQueue.status == CallStatus.PENDING)
                .order_by(VideoCallQueue.created_at)
                .limit(limit)
            )

            result = await db.execute(stmt)
            calls = result.scalars().all()

            # Sort by priority then by creation time
            sorted_calls = sorted(
                calls,
                key=lambda x: (priority_order.get(x.priority, 99), x.created_at)
            )

            return sorted_calls
        except Exception as e:
            logger.error(f"Error getting pending calls: {e}")
            raise

    @staticmethod
    async def assign_agent(
        db: AsyncSession,
        call_id: int,
        agent_id: str
    ) -> VideoCallQueue:
        """Assign an agent to a video call"""
        try:
            stmt = select(VideoCallQueue).where(VideoCallQueue.id == call_id)
            result = await db.execute(stmt)
            call = result.scalar_one_or_none()

            if not call:
                raise ValueError(f"Call {call_id} not found")

            if call.status != CallStatus.PENDING:
                raise ValueError(f"Call {call_id} is not in pending status")

            call.agent_id = agent_id
            call.status = CallStatus.ASSIGNED
            call.assigned_at = datetime.now()

            # Update agent status
            agent_stmt = select(AgentAvailability).where(AgentAvailability.agent_id == agent_id)
            agent_result = await db.execute(agent_stmt)
            agent = agent_result.scalar_one_or_none()

            if agent:
                agent.status = AgentStatus.BUSY
                agent.current_call_id = call_id

            await db.commit()
            await db.refresh(call)
            logger.info(f"Assigned agent {agent_id} to call {call_id}")
            return call
        except Exception as e:
            await db.rollback()
            logger.error(f"Error assigning agent: {e}")
            raise

    @staticmethod
    async def start_call(
        db: AsyncSession,
        call_id: int
    ) -> VideoCallQueue:
        """Start a video call"""
        try:
            stmt = select(VideoCallQueue).where(VideoCallQueue.id == call_id)
            result = await db.execute(stmt)
            call = result.scalar_one_or_none()

            if not call:
                raise ValueError(f"Call {call_id} not found")

            if call.status != CallStatus.ASSIGNED:
                raise ValueError(f"Call {call_id} is not assigned")

            call.status = CallStatus.IN_PROGRESS
            call.started_at = datetime.now()

            # Update agent status
            if call.agent_id:
                agent_stmt = select(AgentAvailability).where(AgentAvailability.agent_id == call.agent_id)
                agent_result = await db.execute(agent_stmt)
                agent = agent_result.scalar_one_or_none()

                if agent:
                    agent.status = AgentStatus.IN_CALL

            await db.commit()
            await db.refresh(call)
            logger.info(f"Started call {call_id}")
            return call
        except Exception as e:
            await db.rollback()
            logger.error(f"Error starting call: {e}")
            raise

    @staticmethod
    async def complete_call(
        db: AsyncSession,
        call_id: int,
        notes: Optional[str] = None
    ) -> VideoCallQueue:
        """Complete a video call"""
        try:
            stmt = select(VideoCallQueue).where(VideoCallQueue.id == call_id)
            result = await db.execute(stmt)
            call = result.scalar_one_or_none()

            if not call:
                raise ValueError(f"Call {call_id} not found")

            call.status = CallStatus.COMPLETED
            call.completed_at = datetime.now()
            if notes:
                call.notes = notes

            # Update agent status and increment call count
            if call.agent_id:
                agent_stmt = select(AgentAvailability).where(AgentAvailability.agent_id == call.agent_id)
                agent_result = await db.execute(agent_stmt)
                agent = agent_result.scalar_one_or_none()

                if agent:
                    agent.status = AgentStatus.ONLINE
                    agent.current_call_id = None
                    agent.total_calls_today += 1

            await db.commit()
            await db.refresh(call)
            logger.info(f"Completed call {call_id}")
            return call
        except Exception as e:
            await db.rollback()
            logger.error(f"Error completing call: {e}")
            raise

    @staticmethod
    async def get_available_agents(
        db: AsyncSession
    ) -> List[AgentAvailability]:
        """Get list of available agents"""
        try:
            # Consider agents available if online and last heartbeat within 60 seconds
            cutoff_time = datetime.now() - timedelta(seconds=60)

            stmt = (
                select(AgentAvailability)
                .where(
                    and_(
                        AgentAvailability.status == AgentStatus.ONLINE,
                        AgentAvailability.last_heartbeat >= cutoff_time
                    )
                )
                .order_by(AgentAvailability.total_calls_today)
            )

            result = await db.execute(stmt)
            return result.scalars().all()
        except Exception as e:
            logger.error(f"Error getting available agents: {e}")
            raise

    @staticmethod
    async def update_agent_status(
        db: AsyncSession,
        agent_id: str,
        status: AgentStatus
    ) -> AgentAvailability:
        """Update agent availability status"""
        try:
            stmt = select(AgentAvailability).where(AgentAvailability.agent_id == agent_id)
            result = await db.execute(stmt)
            agent = result.scalar_one_or_none()

            if not agent:
                # Create new agent record
                agent = AgentAvailability(
                    agent_id=agent_id,
                    status=status,
                    last_heartbeat=datetime.now(),
                    total_calls_today=0
                )
                db.add(agent)
            else:
                agent.status = status
                agent.last_heartbeat = datetime.now()

            await db.commit()
            await db.refresh(agent)
            return agent
        except Exception as e:
            await db.rollback()
            logger.error(f"Error updating agent status: {e}")
            raise

    @staticmethod
    async def auto_assign_next_call(
        db: AsyncSession
    ) -> Optional[VideoCallQueue]:
        """Automatically assign the next pending call to an available agent"""
        try:
            # Get available agents
            available_agents = await VideoCallService.get_available_agents(db)

            if not available_agents:
                logger.info("No available agents for auto-assignment")
                return None

            # Get next pending call (highest priority)
            pending_calls = await VideoCallService.get_pending_calls(db, limit=1)

            if not pending_calls:
                logger.info("No pending calls for auto-assignment")
                return None

            # Assign to agent with least calls today
            agent = available_agents[0]
            call = pending_calls[0]

            return await VideoCallService.assign_agent(db, call.id, agent.agent_id)

        except Exception as e:
            logger.error(f"Error in auto-assignment: {e}")
            return None