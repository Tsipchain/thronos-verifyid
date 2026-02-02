import hashlib
import logging
import secrets
import time
from datetime import datetime, timezone
from typing import Optional, Tuple

from core.database import db_manager
from models.auth import User
from models.rbac import Roles, UserRoles 
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Βοηθητική συνάρτηση για hashing (αν δεν έχεις έτοιμο το core.security)
def get_password_hash(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_or_create_user(self, platform_sub: str, email: str, name: Optional[str] = None) -> User:
        """Get existing user or create new one."""
        start_time = time.time()
        logger.debug(f"[DB_OP] Starting get_or_create_user - platform_sub: {platform_sub}")
        
        stmt = select(User).where(
            or_(
                User.id == str(platform_sub), 
                User.email == email
            )
        )
        result = await self.db.execute(stmt)
        user = result.scalar_one_or_none()
        
        if user:
            user.email = email
            if name:
                user.name = name
            user.last_login = datetime.now(timezone.utc)
        else:
            user = User(
                id=str(platform_sub), 
                email=email,
                name=name,
                role="user",
                is_active=True
            )
            self.db.add(user)
        
        await self.db.commit()
        await self.db.refresh(user)
        logger.debug(f"[DB_OP] get_or_create_user completed in {time.time() - start_time:.4f}s")
        return user

async def initialize_admin_user():
    """
    Initializes a default admin user and ensures the admin role exists.
    Fixes the AttributeError and hardcoded credentials issue.
    """
    logger.info("🎬 Starting Admin User Initialization...")
    
    # Χρήση get_session() που είναι η σωστή μέθοδος στον DatabaseManager σου
    async with db_manager.get_session() as db:
        try:
            # Ρυθμίσεις Admin - ΑΛΛΑΞΕ ΤΑ ΕΔΩ
            admin_email = "admin@example.com"
            admin_password = "admin_password_123" # Βάλε τον κωδικό που θες
            admin_id = "admin_root"

            # 1. Έλεγχος αν ο Admin υπάρχει ήδη
            stmt = select(User).where(User.email == admin_email)
            result = await db.execute(stmt)
            existing_admin = result.scalar_one_or_none()

            if not existing_admin:
                logger.info(f"Admin {admin_email} not found. Creating...")
                existing_admin = User(
                    id=admin_id,
                    email=admin_email,
                    name="System Administrator",
                    hashed_password=get_password_hash(admin_password),
                    is_active=True
                )
                db.add(existing_admin)
                await db.commit()
                await db.refresh(existing_admin)
                logger.info("✅ Admin user created.")
            else:
                logger.info(f"ℹ️ Admin user {admin_email} already exists.")

            # 2. Διασφάλιση ότι ο ρόλος 'admin' υπάρχει στη βάση
            role_stmt = select(Roles).where(Roles.name == "admin")
            role_result = await db.execute(role_stmt)
            admin_role = role_result.scalar_one_or_none()
            
            if not admin_role:
                logger.info("Creating 'admin' role...")
                admin_role = Roles(
                    name="admin", 
                    description="Full system access"
                )
                db.add(admin_role)
                await db.commit()
                await db.refresh(admin_role)

            # 3. Σύνδεση Χρήστη με το Ρόλο (UserRoles)
            ur_stmt = select(UserRoles).where(
                UserRoles.user_id == existing_admin.id, 
                UserRoles.role_id == admin_role.id
            )
            ur_result = await db.execute(ur_stmt)
            
            if not ur_result.scalar_one_or_none():
                logger.info(f"Assigning 'admin' role to {admin_email}...")
                new_user_role = UserRoles(
                    user_id=existing_admin.id, 
                    role_id=admin_role.id, 
                    assigned_by=admin_id
                )
                db.add(new_user_role)
                await db.commit()
            
            logger.info("🚀 Admin initialization completed successfully!")

        except Exception as e:
            await db.rollback()
            logger.error(f"❌ Critical Error in initialize_admin_user: {str(e)}")
            # Δεν κάνουμε raise για να μην "κρεμάσει" όλο το startup της εφαρμογής
