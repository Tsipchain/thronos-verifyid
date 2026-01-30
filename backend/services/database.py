import logging
from core.database import db_manager, get_db
from services.rbac import RBACService

logger = logging.getLogger(__name__)


async def initialize_database():
    """Initialize database tables and seed data"""
    logger.debug("[DB_OP] Starting database initialization")
    logger.info("🔧 Starting database initialization...")
    
    try:
        await db_manager.init_db()
        await db_manager.create_tables()
        
        # Initialize RBAC roles and permissions
        async for db in get_db():
            await RBACService.initialize_default_roles(db)
            logger.info("✅ RBAC roles and permissions initialized")
            break
        
        logger.info("✅ Database initialization completed successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise


async def close_database():
    """Close database connections"""
    logger.info("Closing database connections...")
    await db_manager.close_db()
    logger.info("Database connections closed")


async def check_database_health() -> bool:
    """Check if database connection is healthy"""
    try:
        async for db in get_db():
            # Try to execute a simple query to verify connection
            await db.execute("SELECT 1")
            return True
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        return False