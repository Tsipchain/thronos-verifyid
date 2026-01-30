"""Middleware for tracking API performance metrics."""
import time
from typing import Callable
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
from core.database import get_db
from services.performance_tracker import PerformanceTracker
import logging

logger = logging.getLogger(__name__)


class PerformanceTrackingMiddleware(BaseHTTPMiddleware):
    """Middleware to track API endpoint performance."""
    
    def __init__(self, app: ASGIApp):
        super().__init__(app)
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Track request/response performance."""
        # Skip performance tracking for certain paths
        skip_paths = ['/health', '/docs', '/openapi.json', '/redoc']
        if any(request.url.path.startswith(path) for path in skip_paths):
            return await call_next(request)
        
        # Start timing
        start_time = time.time()
        
        # Get request size
        request_size = 0
        if request.headers.get('content-length'):
            try:
                request_size = int(request.headers.get('content-length', 0))
            except ValueError:
                pass
        
        # Get user ID if available
        user_id = None
        if hasattr(request.state, 'user') and request.state.user:
            user_id = str(request.state.user.get('id', ''))
        
        # Process request
        response = None
        error_message = None
        status_code = 500
        
        try:
            response = await call_next(request)
            status_code = response.status_code
        except Exception as e:
            error_message = str(e)
            logger.error(f"Error processing request: {e}")
            raise
        finally:
            # Calculate response time
            response_time_ms = (time.time() - start_time) * 1000
            
            # Get response size
            response_size = 0
            if response and hasattr(response, 'headers'):
                if response.headers.get('content-length'):
                    try:
                        response_size = int(response.headers.get('content-length', 0))
                    except ValueError:
                        pass
            
            # Log performance asynchronously
            try:
                async for db in get_db():
                    await PerformanceTracker.log_api_performance(
                        db=db,
                        endpoint=request.url.path,
                        method=request.method,
                        response_time_ms=response_time_ms,
                        status_code=status_code,
                        user_id=user_id,
                        request_size_bytes=request_size,
                        response_size_bytes=response_size,
                        error_message=error_message
                    )
                    break
            except Exception as e:
                logger.error(f"Failed to log API performance: {e}")
        
        return response