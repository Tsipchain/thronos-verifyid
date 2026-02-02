import hashlib
import logging
import secrets
import time
from datetime import datetime, timezone
from typing import Optional

from core.database import db_manager
from models.auth import User
from models.rbac import Roles, UserRoles 
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

def hash_password(password: str, salt: str) -> str:
    return hashlib.sha256((password + salt).encode()).hexdigest()

class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_or_create_user(self, platform_sub: str, email: str, name: Optional[str] = None) -> User:
        """
        Αναζήτηση ή δημιουργία χρήστη με βάση το platform_sub (ID) ή το email.
        """
        # 1. Αναζήτηση χρήστη
        stmt = select(User).where(or_(User.id == str(platform_sub), User.email == email))
        result = await self.db.execute(stmt)
        user = result.scalar_one_or_none()
        
        # 2. Update αν υπάρχει
        if user:
            user.email = email
            if name: 
                user.name = name
            user.last_login = datetime.now(timezone.utc)
            # Αν τυχόν δεν είναι active, το κάνουμε active
            if not user.is_active:
                user.is_active = True
        
        # 3. Create αν δεν υπάρχει
        else:
            user = User(
                id=str(platform_sub), 
                email=email,
                name=name,
                role="user",
                is_active=True,
                productivity_points=0,
                created_at=datetime.now(timezone.utc)
            )
            self.db.add(user)
        
        try:
            await self.db.commit()
            # Κάνουμε refresh για να έχουμε τα τελευταία δεδομένα (π.χ. IDs)
            await self.db.refresh(user)
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error saving user: {e}")
            raise e
            
        return user

async def initialize_admin_user():
    """
    Δημιουργία αρχικού Admin χρήστη και των Ρόλων κατά την εκκίνηση.
    Χρησιμοποιεί το db_manager.get_db() με async for iteration.
    """
    logger.info("🎬 Initializing system admin and roles...")
    
    # === Η ΔΙΟΡΘΩΣΗ ΕΙΝΑΙ ΕΔΩ ===
    # Το get_db() είναι generator (yield). Δεν λειτουργεί με 'async with' απευθείας.
    # Πρέπει να κάνουμε iterate (async for) για να πάρουμε το session.
    async for db in db_manager.get_db():
        try:
            # 1. Setup Admin User
            admin_email = "admin@example.com"
            admin_pass = "admin123" 
            admin_id = "admin_root"
            
            stmt = select(User).where(User.email == admin_email)
            result = await db.execute(stmt)
            admin = result.scalar_one_or_none()

            if not admin:
                logger.info("Creating default admin user...")
                salt = secrets.token_hex(16)
                admin = User(
                    id=admin_id,
                    email=admin_email,
                    name="System Admin",
                    role="admin",
                    password_hash=hash_password(admin_pass, salt),
                    password_salt=salt,
                    is_active=True,
                    productivity_points=0,
                    created_at=datetime.now(timezone.utc)
                )
                db.add(admin)
                await db.commit()
                await db.refresh(admin)
            else:
                logger.info("Admin user already exists.")

            # 2. Setup Roles (RBAC)
            # Ελέγχουμε αν υπάρχει ο ρόλος 'admin'
            role_stmt = select(Roles).where(Roles.name == "admin")
            role_res = await db.execute(role_stmt)
            admin_role = role_res.scalar_one_or_none()
            
            if not admin_role:
                logger.info("Creating 'admin' role...")
                admin_role = Roles(name="admin", description="Full System Access")
                db.add(admin_role)
                await db.commit()
                await db.refresh(admin_role)

            # 3. Link Admin User -> Admin Role
            ur_stmt = select(UserRoles).where(
                UserRoles.user_id == admin.id, 
                UserRoles.role_id == admin_role.id
            )
            ur_res = await db.execute(ur_stmt)
            
            if not ur_res.scalar_one_or_none():
                logger.info("Assigning 'admin' role to admin user...")
                # Χρησιμοποιούμε "system" ως assigned_by
                user_role = UserRoles(
                    user_id=admin.id, 
                    role_id=admin_role.id, 
                    assigned_by="system"
                )
                db.add(user_role)
                await db.commit()

            logger.info("✅ Admin initialization completed successfully.")
            
            # Σημαντικό: Βγαίνουμε από το loop αφού τελειώσουμε τη δουλειά
            break 

        except Exception as e:
            await db.rollback()
            logger.error(f"❌ Failed to initialize admin: {str(e)}")
            # Δεν κάνουμε raise εδώ για να μην κρασάρει όλο το app αν αποτύχει αυτό,
            # αλλά καταγράφουμε το λάθος.
            break
