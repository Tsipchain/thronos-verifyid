"""Performance metrics models for tracking database and API performance."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Index
from core.database import Base


class QueryPerformanceLog(Base):
    """Track database query execution times and performance metrics."""
    
    __tablename__ = "query_performance_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    query_hash = Column(String(64), nullable=False, index=True)  # Hash of the query for grouping
    query_text = Column(Text, nullable=True)  # Actual query text (truncated for long queries)
    execution_time_ms = Column(Float, nullable=False)  # Execution time in milliseconds
    rows_affected = Column(Integer, nullable=True)  # Number of rows affected/returned
    endpoint = Column(String(255), nullable=True)  # API endpoint that triggered the query
    user_id = Column(String(255), nullable=True)  # User who executed the query
    status = Column(String(50), nullable=False, default="success")  # success, error, timeout
    error_message = Column(Text, nullable=True)  # Error details if failed
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_query_hash_created', 'query_hash', 'created_at'),
        Index('idx_execution_time', 'execution_time_ms'),
        Index('idx_query_endpoint_created', 'endpoint', 'created_at'),
        Index('idx_created_at', 'created_at'),
    )


class APIPerformanceLog(Base):
    """Track API endpoint response times and performance metrics."""
    
    __tablename__ = "api_performance_logs"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    endpoint = Column(String(255), nullable=False, index=True)  # API endpoint path
    method = Column(String(10), nullable=False)  # HTTP method (GET, POST, etc.)
    response_time_ms = Column(Float, nullable=False)  # Total response time in milliseconds
    status_code = Column(Integer, nullable=False)  # HTTP status code
    user_id = Column(String(255), nullable=True)  # User who made the request
    request_size_bytes = Column(Integer, nullable=True)  # Request payload size
    response_size_bytes = Column(Integer, nullable=True)  # Response payload size
    db_query_count = Column(Integer, nullable=True, default=0)  # Number of DB queries executed
    db_query_time_ms = Column(Float, nullable=True, default=0.0)  # Total DB query time
    error_message = Column(Text, nullable=True)  # Error details if failed
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_api_endpoint_created', 'endpoint', 'created_at'),
        Index('idx_response_time', 'response_time_ms'),
        Index('idx_status_code', 'status_code'),
        Index('idx_created_at', 'created_at'),
    )


class PerformanceAlert(Base):
    """Track performance alerts and anomalies."""
    
    __tablename__ = "performance_alerts"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    alert_type = Column(String(50), nullable=False)  # slow_query, high_error_rate, etc.
    severity = Column(String(20), nullable=False)  # low, medium, high, critical
    endpoint = Column(String(255), nullable=True)  # Related endpoint if applicable
    metric_value = Column(Float, nullable=False)  # The metric value that triggered the alert
    threshold_value = Column(Float, nullable=False)  # The threshold that was exceeded
    description = Column(Text, nullable=False)  # Alert description
    resolved = Column(Integer, nullable=False, default=0)  # 0 = open, 1 = resolved
    resolved_at = Column(DateTime, nullable=True)  # When the alert was resolved
    created_at = Column(DateTime, nullable=False, default=datetime.now)
    
    # Indexes
    __table_args__ = (
        Index('idx_alert_type_created', 'alert_type', 'created_at'),
        Index('idx_resolved', 'resolved'),
        Index('idx_severity', 'severity'),
    )
