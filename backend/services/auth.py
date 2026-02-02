import hashlib
import logging
import secrets
import time
from datetime import datetime, timezone
from typing import Optional

# Εισάγουμε απευθείας το AsyncSessionLocal από εκεί που ορίζεται η βάση
from core.database import db_manager, AsyncSessionLocal 
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
        stmt = select(User).where(or_(User.id == str(platform_sub), User.email == email))
        result = await self.db.execute(stmt)
        user = result.scalar_one_or_none()
        
        if user:
            user.email = email
            if name: user.name = name
            user.last_login = datetime.now(timezone.utc)
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
        
        await self.db.commit()
        return user

async def initialize_admin_user():
    """
    Διόρθωση AttributeError: Χρήση του AsyncSessionLocal απευθείας 
    αντί για την ανύπαρκτη μέθοδο get_session().
    """
    logger.info("🎬 Initializing admin user from schema specs...")
    
    # Αλλαγή εδώ: Χρησιμοποιούμε το εργοστάσιο sessions απευθείας
    async with AsyncSessionLocal() as db:
        try:
            admin_email = "admin@example.com"
            admin_pass = "admin123" 
            admin_id = "admin_root"
            
            stmt = select(User).where(User.email == admin_email)
            result = await db.execute(stmt)
            admin = result.scalar_one_or_none()

            if not admin:
                logger.info(f"Admin not found. Creating...")
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
                logger.info("✅ User 'admin' created.")

            # Διασφάλιση Ρόλου
            role_stmt = select(Roles).where(Roles.name == "admin")
            role_res = await db.execute(role_stmt)
            admin_role = role_res.scalar_one_or_none()
            
            if not admin_role:
                admin_role = Roles(name="admin", description="Full Access")
                db.add(admin_role)
                await db.commit()
                await db.refresh(admin_role)

            # Σύνδεση UserRoles
            ur_stmt = select(UserRoles).where(
                UserRoles.user_id == admin.id, 
                UserRoles.role_id == admin_role.id
            )
            ur_res = await db.execute(ur_stmt)
            if not ur_res.scalar_one_or_none():
                db.add(UserRoles(user_id=admin.id, role_id=admin_role.id, assigned_by="system"))
                await db.commit()

            logger.info("🚀 Admin initialization successful.")

        except Exception as e:
            await db.rollback()
            logger.error(f"❌ Failed to initialize admin: {str(e)}")
