"""
Call-center analytics router.

Provides daily and monthly KPIs for:
  - The call center as a whole (volume, wait times, handle times, outcomes)
  - Individual human agents
  - AI agent (auto-verifications marked with agent_id="ai")

All endpoints require manager or admin role.
"""
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies.auth import require_manager_or_admin
from dependencies.database import get_db
from models.verifications import DocumentVerifications, VerificationStatus
from models.video_call_queue import CallStatus, VideoCallQueue
from schemas.auth import UserResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


def _period_bounds(period: str):
    """Return (start, end) datetime for 'daily' (today) or 'monthly' (this month)."""
    now = datetime.now()
    if period == "monthly":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:  # daily
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, now


# ── Call-center overview ──────────────────────────────────────────────────────

@router.get("/call-center")
async def call_center_stats(
    period: str = Query(default="daily", pattern="^(daily|monthly)$"),
    current_user: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Overall call-center KPIs for today (daily) or this calendar month (monthly).

    Returns:
      - total_calls        : calls that entered the queue in the period
      - completed_calls    : calls that reached COMPLETED status
      - pending_calls      : still waiting / in progress right now
      - cancelled_calls    : cancelled before being answered
      - approved           : verifications with outcome APPROVED or COMPLETED
      - rejected           : verifications with outcome REJECTED
      - avg_wait_seconds   : average time from queue entry to call start
      - avg_handle_seconds : average time from call start to completion
      - approval_rate_pct  : approved / (approved + rejected) * 100
    """
    start, end = _period_bounds(period)

    # All queue entries created in the period
    base = select(VideoCallQueue).where(
        VideoCallQueue.created_at >= start,
        VideoCallQueue.created_at <= end,
    )
    result = await db.execute(base)
    calls = result.scalars().all()

    total = len(calls)
    completed = [c for c in calls if c.status == CallStatus.COMPLETED]
    pending = [c for c in calls if c.status in (CallStatus.PENDING, CallStatus.ASSIGNED, CallStatus.IN_PROGRESS)]
    cancelled = [c for c in calls if c.status == CallStatus.CANCELLED]

    # Wait time: started_at - created_at  (only for calls that were started)
    wait_times = [
        (c.started_at - c.created_at).total_seconds()
        for c in calls
        if c.started_at and c.created_at
    ]
    avg_wait = sum(wait_times) / len(wait_times) if wait_times else 0

    # Handle time: completed_at - started_at
    handle_times = [
        (c.completed_at - c.started_at).total_seconds()
        for c in completed
        if c.completed_at and c.started_at
    ]
    avg_handle = sum(handle_times) / len(handle_times) if handle_times else 0

    # Verification outcomes for calls in this period
    ver_ids = [c.verification_id for c in calls]
    approved_count = 0
    rejected_count = 0
    if ver_ids:
        ver_stmt = select(DocumentVerifications).where(DocumentVerifications.id.in_(ver_ids))
        ver_result = await db.execute(ver_stmt)
        verifications = ver_result.scalars().all()
        approved_count = sum(
            1 for v in verifications
            if v.verification_status in (VerificationStatus.APPROVED, VerificationStatus.COMPLETED)
        )
        rejected_count = sum(
            1 for v in verifications
            if v.verification_status == VerificationStatus.REJECTED
        )

    decided = approved_count + rejected_count
    approval_rate = round(approved_count / decided * 100, 1) if decided else 0.0

    return {
        "period": period,
        "range_start": start.isoformat(),
        "range_end": end.isoformat(),
        "total_calls": total,
        "completed_calls": len(completed),
        "pending_calls": len(pending),
        "cancelled_calls": len(cancelled),
        "approved": approved_count,
        "rejected": rejected_count,
        "approval_rate_pct": approval_rate,
        "avg_wait_seconds": round(avg_wait),
        "avg_handle_seconds": round(avg_handle),
    }


# ── Per-agent performance ─────────────────────────────────────────────────────

@router.get("/agents")
async def agent_performance(
    period: str = Query(default="daily", pattern="^(daily|monthly)$"),
    current_user: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Per-agent performance for the given period.

    Returns a list sorted by calls_handled desc.  The special agent_id "ai"
    represents autonomous AI verifications.

    Each entry contains:
      - agent_id
      - calls_handled
      - calls_completed
      - approved / rejected
      - approval_rate_pct
      - avg_handle_seconds
      - avg_wait_seconds
    """
    start, end = _period_bounds(period)

    stmt = select(VideoCallQueue).where(
        VideoCallQueue.created_at >= start,
        VideoCallQueue.created_at <= end,
        VideoCallQueue.agent_id.isnot(None),
    )
    result = await db.execute(stmt)
    calls = result.scalars().all()

    # Group by agent
    by_agent: Dict[str, List[VideoCallQueue]] = {}
    for c in calls:
        by_agent.setdefault(c.agent_id, []).append(c)

    # Fetch all relevant verifications in one query
    ver_ids = [c.verification_id for c in calls]
    ver_map: Dict[int, DocumentVerifications] = {}
    if ver_ids:
        ver_stmt = select(DocumentVerifications).where(DocumentVerifications.id.in_(ver_ids))
        ver_result = await db.execute(ver_stmt)
        ver_map = {v.id: v for v in ver_result.scalars().all()}

    rows = []
    for agent_id, agent_calls in by_agent.items():
        completed = [c for c in agent_calls if c.status == CallStatus.COMPLETED]

        handle_times = [
            (c.completed_at - c.started_at).total_seconds()
            for c in completed
            if c.completed_at and c.started_at
        ]
        avg_handle = round(sum(handle_times) / len(handle_times)) if handle_times else 0

        wait_times = [
            (c.started_at - c.created_at).total_seconds()
            for c in agent_calls
            if c.started_at and c.created_at
        ]
        avg_wait = round(sum(wait_times) / len(wait_times)) if wait_times else 0

        approved = sum(
            1 for c in agent_calls
            if ver_map.get(c.verification_id) and
            ver_map[c.verification_id].verification_status in (
                VerificationStatus.APPROVED, VerificationStatus.COMPLETED
            )
        )
        rejected = sum(
            1 for c in agent_calls
            if ver_map.get(c.verification_id) and
            ver_map[c.verification_id].verification_status == VerificationStatus.REJECTED
        )
        decided = approved + rejected
        approval_rate = round(approved / decided * 100, 1) if decided else 0.0

        rows.append({
            "agent_id": agent_id,
            "is_ai": agent_id == "ai",
            "calls_handled": len(agent_calls),
            "calls_completed": len(completed),
            "approved": approved,
            "rejected": rejected,
            "approval_rate_pct": approval_rate,
            "avg_handle_seconds": avg_handle,
            "avg_wait_seconds": avg_wait,
        })

    rows.sort(key=lambda r: r["calls_handled"], reverse=True)
    return rows


# ── Time-series (hourly buckets for today, daily buckets for month) ───────────

@router.get("/call-center/timeseries")
async def call_center_timeseries(
    period: str = Query(default="daily", pattern="^(daily|monthly)$"),
    current_user: UserResponse = Depends(require_manager_or_admin),
    db: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Bucketed call counts for charts.

    daily   → one bucket per hour (24 points)
    monthly → one bucket per day  (up to 31 points)
    """
    start, end = _period_bounds(period)

    stmt = select(VideoCallQueue).where(
        VideoCallQueue.created_at >= start,
        VideoCallQueue.created_at <= end,
    )
    result = await db.execute(stmt)
    calls = result.scalars().all()

    buckets: Dict[str, int] = {}
    if period == "daily":
        # Hourly
        for h in range(24):
            buckets[f"{h:02d}:00"] = 0
        for c in calls:
            key = f"{c.created_at.hour:02d}:00"
            buckets[key] = buckets.get(key, 0) + 1
    else:
        # Daily within month
        current = start
        while current <= end:
            buckets[current.strftime("%Y-%m-%d")] = 0
            current += timedelta(days=1)
        for c in calls:
            key = c.created_at.strftime("%Y-%m-%d")
            if key in buckets:
                buckets[key] += 1

    return [{"label": k, "calls": v} for k, v in sorted(buckets.items())]
