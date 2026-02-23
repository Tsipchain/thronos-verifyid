import logging
from sqlalchemy import text
from core.database import db_manager, get_db
from services.rbac import RBACService

logger = logging.getLogger(__name__)


async def _run_startup_migrations():
    """Run one-time schema migrations for existing databases."""
    try:
        async with db_manager.async_session_maker() as db:
            dialect = db_manager.engine.dialect.name

            if dialect == "postgresql":
                # Ensure document_image_url is TEXT (not VARCHAR) to support large base64 images
                try:
                    await db.execute(text(
                        "ALTER TABLE document_verifications "
                        "ALTER COLUMN document_image_url TYPE TEXT"
                    ))
                    await db.commit()
                    logger.info("✅ Migration: document_image_url column ensured as TEXT")
                except Exception as e:
                    await db.rollback()
                    logger.debug(f"document_image_url migration skipped: {e}")

                # Fix broken FK on video_call_queue: old constraint points to "verifications"
                # table (renamed to "document_verifications"). Drop old FK and recreate.
                try:
                    result = await db.execute(text(
                        """
                        SELECT tc.constraint_name
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.referential_constraints rc
                            ON tc.constraint_name = rc.constraint_name
                        JOIN information_schema.constraint_column_usage ccu
                            ON rc.unique_constraint_name = ccu.constraint_name
                        WHERE tc.table_name = 'video_call_queue'
                          AND tc.constraint_type = 'FOREIGN KEY'
                          AND ccu.table_name = 'verifications'
                        """
                    ))
                    old_constraints = [row[0] for row in result.fetchall()]

                    for constraint_name in old_constraints:
                        await db.execute(text(
                            f"ALTER TABLE video_call_queue DROP CONSTRAINT {constraint_name}"
                        ))
                        await db.execute(text(
                            "ALTER TABLE video_call_queue "
                            "ADD CONSTRAINT video_call_queue_verification_id_fkey "
                            "FOREIGN KEY (verification_id) REFERENCES document_verifications(id)"
                        ))
                        logger.info(
                            f"✅ Migration: fixed video_call_queue FK "
                            f"(dropped '{constraint_name}', now points to document_verifications)"
                        )

                    await db.commit()
                except Exception as e:
                    await db.rollback()
                    logger.debug(f"video_call_queue FK migration skipped: {e}")

    except Exception as e:
        logger.debug(f"Startup migration skipped or not needed: {e}")


async def initialize_database():
    """Initialize database tables and seed data"""
    logger.debug("[DB_OP] Starting database initialization")
    logger.info("🔧 Starting database initialization...")

    try:
        await db_manager.init_db()
        await db_manager.create_tables()

        # Run any pending schema migrations
        await _run_startup_migrations()

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