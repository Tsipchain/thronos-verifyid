"""Service for tracking and analyzing performance metrics."""
import hashlib
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager
from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from core.database import get_db
from models.performance_metrics import QueryPerformanceLog, APIPerformanceLog, PerformanceAlert
import logging

logger = logging.getLogger(__name__)


class PerformanceTracker:
    """Track and analyze performance metrics for queries and API endpoints."""
    
    # Thresholds for alerts
    SLOW_QUERY_THRESHOLD_MS = 1000  # 1 second
    SLOW_API_THRESHOLD_MS = 2000  # 2 seconds
    HIGH_ERROR_RATE_THRESHOLD = 0.1  # 10% error rate
    
    @staticmethod
    def _hash_query(query: str) -> str:
        """Generate a hash for query grouping."""
        return hashlib.md5(query.encode()).hexdigest()
    
    @staticmethod
    def _truncate_query(query: str, max_length: int = 1000) -> str:
        """Truncate long queries for storage."""
        if len(query) <= max_length:
            return query
        return query[:max_length] + "..."
    
    @staticmethod
    async def log_query_performance(
        db: AsyncSession,
        query: str,
        execution_time_ms: float,
        rows_affected: Optional[int] = None,
        endpoint: Optional[str] = None,
        user_id: Optional[str] = None,
        status: str = "success",
        error_message: Optional[str] = None
    ):
        """Log database query performance metrics."""
        try:
            query_hash = PerformanceTracker._hash_query(query)
            query_text = PerformanceTracker._truncate_query(query)
            
            log_entry = QueryPerformanceLog(
                query_hash=query_hash,
                query_text=query_text,
                execution_time_ms=execution_time_ms,
                rows_affected=rows_affected,
                endpoint=endpoint,
                user_id=user_id,
                status=status,
                error_message=error_message,
                created_at=datetime.now()
            )
            
            db.add(log_entry)
            await db.commit()
            
            # Check for slow query alert
            if execution_time_ms > PerformanceTracker.SLOW_QUERY_THRESHOLD_MS:
                await PerformanceTracker._create_alert(
                    db=db,
                    alert_type="slow_query",
                    severity="high" if execution_time_ms > 5000 else "medium",
                    endpoint=endpoint,
                    metric_value=execution_time_ms,
                    threshold_value=PerformanceTracker.SLOW_QUERY_THRESHOLD_MS,
                    description=f"Slow query detected: {execution_time_ms:.2f}ms (threshold: {PerformanceTracker.SLOW_QUERY_THRESHOLD_MS}ms)"
                )
        except Exception as e:
            logger.error(f"Failed to log query performance: {e}")
    
    @staticmethod
    async def log_api_performance(
        db: AsyncSession,
        endpoint: str,
        method: str,
        response_time_ms: float,
        status_code: int,
        user_id: Optional[str] = None,
        request_size_bytes: Optional[int] = None,
        response_size_bytes: Optional[int] = None,
        db_query_count: int = 0,
        db_query_time_ms: float = 0.0,
        error_message: Optional[str] = None
    ):
        """Log API endpoint performance metrics."""
        try:
            log_entry = APIPerformanceLog(
                endpoint=endpoint,
                method=method,
                response_time_ms=response_time_ms,
                status_code=status_code,
                user_id=user_id,
                request_size_bytes=request_size_bytes,
                response_size_bytes=response_size_bytes,
                db_query_count=db_query_count,
                db_query_time_ms=db_query_time_ms,
                error_message=error_message,
                created_at=datetime.now()
            )
            
            db.add(log_entry)
            await db.commit()
            
            # Check for slow API alert
            if response_time_ms > PerformanceTracker.SLOW_API_THRESHOLD_MS:
                await PerformanceTracker._create_alert(
                    db=db,
                    alert_type="slow_api",
                    severity="high" if response_time_ms > 5000 else "medium",
                    endpoint=endpoint,
                    metric_value=response_time_ms,
                    threshold_value=PerformanceTracker.SLOW_API_THRESHOLD_MS,
                    description=f"Slow API endpoint: {endpoint} took {response_time_ms:.2f}ms"
                )
        except Exception as e:
            logger.error(f"Failed to log API performance: {e}")
    
    @staticmethod
    async def _create_alert(
        db: AsyncSession,
        alert_type: str,
        severity: str,
        metric_value: float,
        threshold_value: float,
        description: str,
        endpoint: Optional[str] = None
    ):
        """Create a performance alert."""
        try:
            alert = PerformanceAlert(
                alert_type=alert_type,
                severity=severity,
                endpoint=endpoint,
                metric_value=metric_value,
                threshold_value=threshold_value,
                description=description,
                resolved=0,
                created_at=datetime.now()
            )
            
            db.add(alert)
            await db.commit()
        except Exception as e:
            logger.error(f"Failed to create performance alert: {e}")
    
    @staticmethod
    async def get_slow_queries(
        db: AsyncSession,
        hours: int = 24,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Get slow queries from the last N hours."""
        cutoff_time = datetime.now() - timedelta(hours=hours)
        
        stmt = (
            select(
                QueryPerformanceLog.query_hash,
                QueryPerformanceLog.query_text,
                func.count(QueryPerformanceLog.id).label('count'),
                func.avg(QueryPerformanceLog.execution_time_ms).label('avg_time'),
                func.max(QueryPerformanceLog.execution_time_ms).label('max_time'),
                func.min(QueryPerformanceLog.execution_time_ms).label('min_time')
            )
            .where(
                and_(
                    QueryPerformanceLog.created_at >= cutoff_time,
                    QueryPerformanceLog.execution_time_ms > PerformanceTracker.SLOW_QUERY_THRESHOLD_MS
                )
            )
            .group_by(QueryPerformanceLog.query_hash, QueryPerformanceLog.query_text)
            .order_by(desc('avg_time'))
            .limit(limit)
        )
        
        result = await db.execute(stmt)
        rows = result.all()
        
        return [
            {
                'query_hash': row.query_hash,
                'query_text': row.query_text,
                'count': row.count,
                'avg_time_ms': round(row.avg_time, 2),
                'max_time_ms': round(row.max_time, 2),
                'min_time_ms': round(row.min_time, 2)
            }
            for row in rows
        ]
    
    @staticmethod
    async def get_endpoint_performance(
        db: AsyncSession,
        hours: int = 24
    ) -> List[Dict[str, Any]]:
        """Get API endpoint performance statistics."""
        cutoff_time = datetime.now() - timedelta(hours=hours)
        
        stmt = (
            select(
                APIPerformanceLog.endpoint,
                APIPerformanceLog.method,
                func.count(APIPerformanceLog.id).label('request_count'),
                func.avg(APIPerformanceLog.response_time_ms).label('avg_response_time'),
                func.max(APIPerformanceLog.response_time_ms).label('max_response_time'),
                func.sum(
                    func.case((APIPerformanceLog.status_code >= 400, 1), else_=0)
                ).label('error_count')
            )
            .where(APIPerformanceLog.created_at >= cutoff_time)
            .group_by(APIPerformanceLog.endpoint, APIPerformanceLog.method)
            .order_by(desc('request_count'))
        )
        
        result = await db.execute(stmt)
        rows = result.all()
        
        return [
            {
                'endpoint': row.endpoint,
                'method': row.method,
                'request_count': row.request_count,
                'avg_response_time_ms': round(row.avg_response_time, 2),
                'max_response_time_ms': round(row.max_response_time, 2),
                'error_count': row.error_count,
                'error_rate': round(row.error_count / row.request_count * 100, 2) if row.request_count > 0 else 0
            }
            for row in rows
        ]
    
    @staticmethod
    async def get_performance_trends(
        db: AsyncSession,
        hours: int = 24,
        interval_minutes: int = 60
    ) -> Dict[str, Any]:
        """Get performance trends over time."""
        cutoff_time = datetime.now() - timedelta(hours=hours)
        
        # API performance trends
        api_stmt = (
            select(
                func.date_trunc('hour', APIPerformanceLog.created_at).label('time_bucket'),
                func.count(APIPerformanceLog.id).label('request_count'),
                func.avg(APIPerformanceLog.response_time_ms).label('avg_response_time'),
                func.sum(
                    func.case((APIPerformanceLog.status_code >= 400, 1), else_=0)
                ).label('error_count')
            )
            .where(APIPerformanceLog.created_at >= cutoff_time)
            .group_by('time_bucket')
            .order_by('time_bucket')
        )
        
        api_result = await db.execute(api_stmt)
        api_rows = api_result.all()
        
        # Query performance trends
        query_stmt = (
            select(
                func.date_trunc('hour', QueryPerformanceLog.created_at).label('time_bucket'),
                func.count(QueryPerformanceLog.id).label('query_count'),
                func.avg(QueryPerformanceLog.execution_time_ms).label('avg_execution_time')
            )
            .where(QueryPerformanceLog.created_at >= cutoff_time)
            .group_by('time_bucket')
            .order_by('time_bucket')
        )
        
        query_result = await db.execute(query_stmt)
        query_rows = query_result.all()
        
        return {
            'api_trends': [
                {
                    'timestamp': row.time_bucket.isoformat(),
                    'request_count': row.request_count,
                    'avg_response_time_ms': round(row.avg_response_time, 2),
                    'error_count': row.error_count
                }
                for row in api_rows
            ],
            'query_trends': [
                {
                    'timestamp': row.time_bucket.isoformat(),
                    'query_count': row.query_count,
                    'avg_execution_time_ms': round(row.avg_execution_time, 2)
                }
                for row in query_rows
            ]
        }
    
    @staticmethod
    async def get_active_alerts(
        db: AsyncSession,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Get active performance alerts."""
        stmt = (
            select(PerformanceAlert)
            .where(PerformanceAlert.resolved == 0)
            .order_by(desc(PerformanceAlert.created_at))
            .limit(limit)
        )
        
        result = await db.execute(stmt)
        alerts = result.scalars().all()
        
        return [
            {
                'id': alert.id,
                'alert_type': alert.alert_type,
                'severity': alert.severity,
                'endpoint': alert.endpoint,
                'metric_value': alert.metric_value,
                'threshold_value': alert.threshold_value,
                'description': alert.description,
                'created_at': alert.created_at.isoformat()
            }
            for alert in alerts
        ]


@asynccontextmanager
async def track_query_performance(
    query: str,
    endpoint: Optional[str] = None,
    user_id: Optional[str] = None
):
    """Context manager for tracking query performance."""
    start_time = time.time()
    rows_affected = None
    status = "success"
    error_message = None
    
    try:
        yield
    except Exception as e:
        status = "error"
        error_message = str(e)
        raise
    finally:
        execution_time_ms = (time.time() - start_time) * 1000
        
        try:
            async for db in get_db():
                await PerformanceTracker.log_query_performance(
                    db=db,
                    query=query,
                    execution_time_ms=execution_time_ms,
                    rows_affected=rows_affected,
                    endpoint=endpoint,
                    user_id=user_id,
                    status=status,
                    error_message=error_message
                )
                break
        except Exception as e:
            logger.error(f"Failed to track query performance: {e}")