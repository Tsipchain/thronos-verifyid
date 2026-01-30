"""Performance monitoring dashboard API endpoints."""
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from core.database import get_db
from services.performance_tracker import PerformanceTracker
from dependencies.auth import get_current_user
from schemas.auth import UserResponse

router = APIRouter(prefix="/api/v1/performance", tags=["performance"])


class SlowQueryResponse(BaseModel):
    """Response model for slow query data."""
    query_hash: str
    query_text: str
    count: int
    avg_time_ms: float
    max_time_ms: float
    min_time_ms: float


class EndpointPerformanceResponse(BaseModel):
    """Response model for endpoint performance data."""
    endpoint: str
    method: str
    request_count: int
    avg_response_time_ms: float
    max_response_time_ms: float
    error_count: int
    error_rate: float


class PerformanceTrendPoint(BaseModel):
    """Single data point in performance trend."""
    timestamp: str
    request_count: Optional[int] = None
    avg_response_time_ms: Optional[float] = None
    error_count: Optional[int] = None
    query_count: Optional[int] = None
    avg_execution_time_ms: Optional[float] = None


class PerformanceTrendsResponse(BaseModel):
    """Response model for performance trends."""
    api_trends: List[PerformanceTrendPoint]
    query_trends: List[PerformanceTrendPoint]


class PerformanceAlertResponse(BaseModel):
    """Response model for performance alerts."""
    id: int
    alert_type: str
    severity: str
    endpoint: Optional[str]
    metric_value: float
    threshold_value: float
    description: str
    created_at: str


class DashboardSummaryResponse(BaseModel):
    """Response model for dashboard summary."""
    total_requests_24h: int
    avg_response_time_ms: float
    error_rate_percent: float
    slow_queries_count: int
    active_alerts_count: int
    top_slow_endpoint: Optional[str]
    top_slow_endpoint_time_ms: Optional[float]


@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
async def get_dashboard_summary(
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get performance dashboard summary with key metrics.
    
    Returns overview of system performance including:
    - Total requests in last 24 hours
    - Average response time
    - Error rate
    - Slow queries count
    - Active alerts count
    """
    # Get endpoint performance
    endpoints = await PerformanceTracker.get_endpoint_performance(db, hours=24)
    
    # Calculate summary metrics
    total_requests = sum(e['request_count'] for e in endpoints)
    total_errors = sum(e['error_count'] for e in endpoints)
    avg_response_time = sum(e['avg_response_time_ms'] * e['request_count'] for e in endpoints) / total_requests if total_requests > 0 else 0
    error_rate = (total_errors / total_requests * 100) if total_requests > 0 else 0
    
    # Get slow queries
    slow_queries = await PerformanceTracker.get_slow_queries(db, hours=24)
    
    # Get active alerts
    alerts = await PerformanceTracker.get_active_alerts(db)
    
    # Find slowest endpoint
    top_slow_endpoint = None
    top_slow_endpoint_time = None
    if endpoints:
        slowest = max(endpoints, key=lambda x: x['avg_response_time_ms'])
        top_slow_endpoint = f"{slowest['method']} {slowest['endpoint']}"
        top_slow_endpoint_time = slowest['avg_response_time_ms']
    
    return DashboardSummaryResponse(
        total_requests_24h=total_requests,
        avg_response_time_ms=round(avg_response_time, 2),
        error_rate_percent=round(error_rate, 2),
        slow_queries_count=len(slow_queries),
        active_alerts_count=len(alerts),
        top_slow_endpoint=top_slow_endpoint,
        top_slow_endpoint_time_ms=top_slow_endpoint_time
    )


@router.get("/slow-queries", response_model=List[SlowQueryResponse])
async def get_slow_queries(
    hours: int = Query(24, ge=1, le=168, description="Number of hours to look back"),
    limit: int = Query(50, ge=1, le=200, description="Maximum number of results"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get slow database queries.
    
    Returns queries that exceeded the slow query threshold,
    grouped by query hash with statistics.
    """
    slow_queries = await PerformanceTracker.get_slow_queries(db, hours=hours, limit=limit)
    return [SlowQueryResponse(**query) for query in slow_queries]


@router.get("/endpoints", response_model=List[EndpointPerformanceResponse])
async def get_endpoint_performance(
    hours: int = Query(24, ge=1, le=168, description="Number of hours to look back"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get API endpoint performance statistics.
    
    Returns performance metrics for all API endpoints including:
    - Request count
    - Average/max response times
    - Error counts and rates
    """
    endpoints = await PerformanceTracker.get_endpoint_performance(db, hours=hours)
    return [EndpointPerformanceResponse(**endpoint) for endpoint in endpoints]


@router.get("/trends", response_model=PerformanceTrendsResponse)
async def get_performance_trends(
    hours: int = Query(24, ge=1, le=168, description="Number of hours to look back"),
    interval_minutes: int = Query(60, ge=5, le=1440, description="Time interval in minutes"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get performance trends over time.
    
    Returns time-series data for:
    - API request counts and response times
    - Database query counts and execution times
    - Error rates over time
    """
    trends = await PerformanceTracker.get_performance_trends(db, hours=hours, interval_minutes=interval_minutes)
    
    api_trends = [PerformanceTrendPoint(**point) for point in trends['api_trends']]
    query_trends = [PerformanceTrendPoint(**point) for point in trends['query_trends']]
    
    return PerformanceTrendsResponse(
        api_trends=api_trends,
        query_trends=query_trends
    )


@router.get("/alerts", response_model=List[PerformanceAlertResponse])
async def get_active_alerts(
    limit: int = Query(50, ge=1, le=200, description="Maximum number of results"),
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get active performance alerts.
    
    Returns unresolved alerts for:
    - Slow queries
    - Slow API endpoints
    - High error rates
    - Other performance anomalies
    """
    alerts = await PerformanceTracker.get_active_alerts(db, limit=limit)
    return [PerformanceAlertResponse(**alert) for alert in alerts]


@router.post("/alerts/{alert_id}/resolve")
async def resolve_alert(
    alert_id: int,
    current_user: UserResponse = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Resolve a performance alert.
    
    Marks the specified alert as resolved.
    """
    from sqlalchemy import update
    from models.performance_metrics import PerformanceAlert
    
    stmt = (
        update(PerformanceAlert)
        .where(PerformanceAlert.id == alert_id)
        .values(resolved=1, resolved_at=datetime.now())
    )
    
    await db.execute(stmt)
    await db.commit()
    
    return {"message": "Alert resolved successfully", "alert_id": alert_id}